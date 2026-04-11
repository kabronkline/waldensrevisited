// API route handlers for members section

const VALID_ROLES = ['pending', 'member', 'president', 'secretary', 'treasurer', 'other_officer', 'admin', 'auditor'];
const OFFICER_ROLES = ['president', 'secretary', 'treasurer', 'other_officer', 'admin'];
const AUTO_APPROVE_ROLES = ['president', 'secretary', 'treasurer', 'other_officer', 'admin'];
const MAX_DOGS = 5;
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hasAccess(role) {
  return role && role !== 'pending';
}

// Privacy masking: respects show_name and show_contact fields
// is_anonymous=1 is treated as show_name=0 AND show_contact=0 (legacy compat)
// Friendship does NOT override privacy — only officers/admins can see hidden PII
function maskIfAnonymous(record, nameField, picFields, viewerRole) {
  if (!record || OFFICER_ROLES.includes(viewerRole)) return record;

  const hideName = record.is_anonymous || record.show_name === 0;
  const hideContact = record.is_anonymous || record.show_contact === 0;

  if (hideName) {
    // Use abbreviated address (house number + road) e.g. "480 Brindle Road"
    const parts = record.address_label ? record.address_label.split('—') : [];
    const streetAddr = parts.length > 1 ? parts[1].trim() : (parts[0] || '').trim();
    record[nameField] = streetAddr ? 'Neighbor at ' + streetAddr : 'Anonymous Neighbor';
    for (const f of picFields) { if (record[f] !== undefined) record[f] = null; }
  }
  if (hideContact) {
    if (record.email) record.email = null;
    // Keep address_label for tract reference only (public county data), but hide street address details
  }
  return record;
}

function isOfficerOrAdmin(role) {
  return OFFICER_ROLES.includes(role);
}

function canAutoApprovePost(role) {
  return AUTO_APPROVE_ROLES.includes(role);
}

function validateImage(image) {
  if (!image) return 'No image provided';
  const match = image.match(/^data:(image\/(jpeg|png|webp|gif));base64,/);
  if (!match) return 'Invalid image format. Use JPEG, PNG, WebP, or GIF.';
  const base64Data = image.split(',')[1];
  if (base64Data.length > MAX_IMAGE_SIZE * 1.4) return 'Image too large (max 2MB)';
  return null;
}

export async function handleApi(request, env, session) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (!session) return json({ error: 'Unauthorized' }, 401);

  const userId = session.user.userId;

  // --- Agreement (pre-access) ---
  if (path === '/api/me/agreement' && method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    let isAnonymous = 0, showName = 1, showContact = 1;
    try {
      const body = await request.json();
      if (body.is_anonymous) isAnonymous = 1;
      if (body.show_name !== undefined) showName = body.show_name ? 1 : 0;
      if (body.show_contact !== undefined) showContact = body.show_contact ? 1 : 0;
      if (!showName && !showContact) isAnonymous = 1;
    } catch (e) {}
    await env.DB.prepare(
      "UPDATE users SET agreement_signed_at = datetime('now'), agreement_ip = ?, is_anonymous = ?, show_name = ?, show_contact = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(ip, isAnonymous, showName, showContact, userId).run();

    const sessionData = { ...session.user, agreementSigned: true };
    await env.SESSIONS.put(`session:${session.id}`, JSON.stringify(sessionData), { expirationTtl: 60 * 60 * 24 * 7 });
    return json({ success: true });
  }

  // GET /api/me — accessible even when pending
  if (path === '/api/me' && method === 'GET') {
    const user = await env.DB.prepare(
      'SELECT u.*, a.full_label as address_label FROM users u LEFT JOIN addresses a ON u.address_id = a.id WHERE u.id = ?'
    ).bind(userId).first();
    if (!user) return json({ error: 'User not found' }, 404);
    const { google_id, agreement_ip, ...safe } = user;
    return json(safe);
  }

  // POST /api/me/address-request — request address selection/change (no role needed)
  if (path === '/api/me/address-request' && method === 'POST') {
    const body = await request.json();
    if (!body.address_id) return json({ error: 'Address is required' }, 400);
    const addr = await env.DB.prepare('SELECT id FROM addresses WHERE id = ?').bind(body.address_id).first();
    if (!addr) return json({ error: 'Invalid address' }, 400);

    // Check for existing pending request
    const existing = await env.DB.prepare(
      "SELECT id FROM address_requests WHERE user_id = ? AND status = 'pending'"
    ).bind(userId).first();
    if (existing) {
      // Update existing request
      await env.DB.prepare(
        "UPDATE address_requests SET requested_address_id = ?, created_at = datetime('now') WHERE id = ?"
      ).bind(body.address_id, existing.id).run();
    } else {
      const user = await env.DB.prepare('SELECT address_id FROM users WHERE id = ?').bind(userId).first();
      await env.DB.prepare(
        "INSERT INTO address_requests (user_id, requested_address_id, current_address_id) VALUES (?, ?, ?)"
      ).bind(userId, body.address_id, user?.address_id || null).run();
    }
    return json({ success: true });
  }

  // GET /api/me/address-request — check if user has a pending request
  if (path === '/api/me/address-request' && method === 'GET') {
    const req = await env.DB.prepare(
      "SELECT ar.*, a.full_label FROM address_requests ar JOIN addresses a ON ar.requested_address_id = a.id WHERE ar.user_id = ? AND ar.status = 'pending'"
    ).bind(userId).first();
    return json(req || null);
  }

  // --- Access gate (re-check DB for fresh role) ---
  if (!session.user.agreementSigned || !hasAccess(session.user.role)) {
    const fresh = await env.DB.prepare('SELECT role, agreement_signed_at FROM users WHERE id = ?').bind(userId).first();
    if (fresh) {
      session.user.role = fresh.role;
      session.user.agreementSigned = !!fresh.agreement_signed_at;
      await env.SESSIONS.put(`session:${session.id}`, JSON.stringify(session.user), { expirationTtl: 60 * 60 * 24 * 7 });
    }
  }
  if (!session.user.agreementSigned && session.user.role !== 'auditor' && session.user.role !== 'admin') return json({ error: 'Agreement not signed' }, 403);
  if (!hasAccess(session.user.role)) return json({ error: 'Account pending approval' }, 403);

  // --- Profile ---
  if (path === '/api/me' && method === 'PUT') {
    const body = await request.json();
    const updates = [];
    const params = [];

    // address_id changes require approval — use /api/me/address-request instead
    if (body.is_anonymous !== undefined) { updates.push('is_anonymous = ?'); params.push(body.is_anonymous ? 1 : 0); }
    if (body.show_name !== undefined) { updates.push('show_name = ?'); params.push(body.show_name ? 1 : 0); }
    if (body.show_contact !== undefined) { updates.push('show_contact = ?'); params.push(body.show_contact ? 1 : 0); }
    if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name); }
    if (body.birthday !== undefined) { updates.push('birthday = ?'); params.push(body.birthday || null); }
    if (body.avatar_id !== undefined) { updates.push('avatar_id = ?'); params.push(body.avatar_id); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      params.push(userId);
      await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
    }
    return json({ success: true });
  }

  // POST /api/me/profile-picture — no approval needed
  if (path === '/api/me/profile-picture' && method === 'POST') {
    const body = await request.json();
    const err = validateImage(body.image);
    if (err) return json({ error: err }, 400);

    await env.DB.prepare(
      "UPDATE users SET profile_picture = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(body.image, userId).run();
    return json({ success: true });
  }

  // DELETE /api/me/profile-picture
  if (path === '/api/me/profile-picture' && method === 'DELETE') {
    await env.DB.prepare(
      "UPDATE users SET profile_picture = NULL, updated_at = datetime('now') WHERE id = ?"
    ).bind(userId).run();
    return json({ success: true });
  }

  // GET /api/addresses
  if (path === '/api/addresses' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM addresses ORDER BY id').all();
    return json(results);
  }

  // --- Dogs (no approval needed) ---
  if (path === '/api/dogs' && method === 'GET') {
    // Get own dogs + dogs at the same property by other residents
    const user = await env.DB.prepare('SELECT address_id FROM users WHERE id = ?').bind(userId).first();
    let results;
    if (user?.address_id) {
      const { results: dogs } = await env.DB.prepare(
        `SELECT d.*, u.name as added_by_name, CASE WHEN d.user_id = ? THEN 1 ELSE 0 END as is_mine
         FROM dogs d JOIN users u ON d.user_id = u.id
         WHERE d.user_id = ? OR d.address_id = ?
         ORDER BY d.created_at`
      ).bind(userId, userId, user.address_id).all();
      results = dogs;
    } else {
      const { results: dogs } = await env.DB.prepare('SELECT *, 1 as is_mine FROM dogs WHERE user_id = ? ORDER BY created_at').bind(userId).all();
      results = dogs;
    }
    return json(results);
  }

  if (path === '/api/dogs' && method === 'POST') {
    // Anonymous users cannot add dogs (needed for play date community building)
    const user = await env.DB.prepare('SELECT is_anonymous, address_id FROM users WHERE id = ?').bind(userId).first();
    if (user?.is_anonymous) return json({ error: 'Anonymous users cannot add dogs. Update your privacy settings first.' }, 403);

    const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM dogs WHERE user_id = ?').bind(userId).first();
    if (count.cnt >= MAX_DOGS) return json({ error: `Maximum of ${MAX_DOGS} dogs allowed` }, 400);

    const body = await request.json();
    if (!body.name || !body.name.trim()) return json({ error: 'Dog name is required' }, 400);

    const result = await env.DB.prepare(
      'INSERT INTO dogs (user_id, address_id, name, breed, age, birthday, bio) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(userId, user?.address_id || null, body.name.trim(), body.breed || null, body.age || null, body.birthday || null, body.bio || null).run();
    return json({ id: result.meta.last_row_id, success: true }, 201);
  }

  const dogMatch = path.match(/^\/api\/dogs\/(\d+)$/);
  if (dogMatch && method === 'PUT') {
    const dogId = parseInt(dogMatch[1]);
    const dog = await env.DB.prepare('SELECT * FROM dogs WHERE id = ? AND user_id = ?').bind(dogId, userId).first();
    if (!dog) return json({ error: 'Dog not found' }, 404);

    const body = await request.json();
    await env.DB.prepare(
      "UPDATE dogs SET name = ?, breed = ?, age = ?, birthday = ?, bio = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(body.name?.trim() || dog.name, body.breed !== undefined ? body.breed : dog.breed, body.age !== undefined ? body.age : dog.age, body.birthday !== undefined ? body.birthday : dog.birthday, body.bio !== undefined ? body.bio : dog.bio, dogId).run();
    return json({ success: true });
  }

  if (dogMatch && method === 'DELETE') {
    const dogId = parseInt(dogMatch[1]);
    const dog = await env.DB.prepare('SELECT * FROM dogs WHERE id = ? AND user_id = ?').bind(dogId, userId).first();
    if (!dog) return json({ error: 'Dog not found' }, 404);
    await env.DB.prepare('DELETE FROM dogs WHERE id = ?').bind(dogId).run();
    return json({ success: true });
  }

  const dogPicMatch = path.match(/^\/api\/dogs\/(\d+)\/picture$/);
  if (dogPicMatch && method === 'POST') {
    const dogId = parseInt(dogPicMatch[1]);
    const dog = await env.DB.prepare('SELECT * FROM dogs WHERE id = ? AND user_id = ?').bind(dogId, userId).first();
    if (!dog) return json({ error: 'Dog not found' }, 404);

    const body = await request.json();
    const err = validateImage(body.image);
    if (err) return json({ error: err }, 400);

    await env.DB.prepare("UPDATE dogs SET picture = ?, updated_at = datetime('now') WHERE id = ?").bind(body.image, dogId).run();
    return json({ success: true });
  }

  if (dogPicMatch && method === 'DELETE') {
    const dogId = parseInt(dogPicMatch[1]);
    const dog = await env.DB.prepare('SELECT * FROM dogs WHERE id = ? AND user_id = ?').bind(dogId, userId).first();
    if (!dog) return json({ error: 'Dog not found' }, 404);
    await env.DB.prepare("UPDATE dogs SET picture = NULL, updated_at = datetime('now') WHERE id = ?").bind(dogId).run();
    return json({ success: true });
  }

  // --- Posts (social wall) ---

  // GET /api/posts — approved posts visible to all members; own pending posts also visible
  if (path === '/api/posts' && method === 'GET') {
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = 20;
    const offset = (page - 1) * limit;

    // Get friend IDs for visibility filtering
    const { results: myFriends } = await env.DB.prepare(
      `SELECT CASE WHEN user_a_id = ? THEN user_b_id ELSE user_a_id END as fid
       FROM friendships WHERE user_a_id = ? OR user_b_id = ?`
    ).bind(userId, userId, userId).all();
    const myFriendIds = myFriends.map(f => f.fid);

    const userRole = session.user.role;
    const isOfficerOrAdmin = OFFICER_ROLES.includes(userRole);

    // Build visibility filter:
    // - Own posts always visible
    // - 'everybody' visible to all
    // - 'friends' visible to poster's friends
    // - 'officers' visible to officers/admins
    const { results } = await env.DB.prepare(
      `SELECT p.*, u.name as author_name, u.role as author_role,
              u.profile_picture as author_profile_picture, u.google_picture as author_google_picture,
              u.is_anonymous as author_anonymous, u.show_name, u.show_contact, u.avatar_id as author_avatar_id,
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE (p.approved = 1 OR p.user_id = ?)
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(userId, limit, offset).all();

    // Filter by visibility in JS (D1 doesn't support complex IN clauses well)
    const filtered = results.filter(p => {
      if (p.user_id === userId) return true; // own posts always visible
      const vis = p.visibility || 'everybody';
      if (vis === 'everybody') return true;
      if (vis === 'friends') return myFriendIds.includes(p.user_id);
      if (vis === 'officers') return isOfficerOrAdmin;
      return true;
    });
    // Defense-in-depth: mask anonymous authors at API level
    if (!isOfficerOrAdmin) {
      filtered.forEach(p => {
        if (p.author_anonymous) {
          p.author_name = 'Anonymous Member';
          p.author_profile_picture = null;
          p.author_google_picture = null;
        }
      });
    }
    return json(filtered);
  }

  // POST /api/posts — create a post
  if (path === '/api/posts' && method === 'POST') {
    const body = await request.json();
    if (!body.content || !body.content.trim()) return json({ error: 'Post content is required' }, 400);
    if (body.content.length > 2000) return json({ error: 'Post content too long (max 2000 characters)' }, 400);

    // Validate image if provided
    if (body.image) {
      const err = validateImage(body.image);
      if (err) return json({ error: err }, 400);
    }

    const visibility = ['everybody', 'friends', 'officers'].includes(body.visibility) ? body.visibility : 'everybody';

    // Auto-approve: friends/officers posts always approved; "everybody" posts need approval unless from elevated roles
    const autoApprove = (visibility !== 'everybody' || canAutoApprovePost(session.user.role)) ? 1 : 0;

    const result = await env.DB.prepare(
      'INSERT INTO posts (user_id, content, image, approved, visibility, allow_comments) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(userId, body.content.trim(), body.image || null, autoApprove, visibility, body.allow_comments !== undefined ? (body.allow_comments ? 1 : 0) : 1).run();

    const message = autoApprove ? 'Post published.' : 'Post visible after approval.';
    return json({ id: result.meta.last_row_id, approved: autoApprove, success: true, message }, 201);
  }

  // PUT /api/posts/:id — edit own post (saves version history, max 5)
  const postPutMatch = path.match(/^\/api\/posts\/(\d+)$/);
  if (postPutMatch && method === 'PUT') {
    const postId = parseInt(postPutMatch[1]);
    const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ? AND user_id = ?').bind(postId, userId).first();
    if (!post) return json({ error: 'Post not found' }, 404);

    const body = await request.json();
    if (!body.content?.trim()) return json({ error: 'Content required' }, 400);
    if (body.content.length > 2000) return json({ error: 'Too long (max 2000)' }, 400);

    // Count existing versions
    const verCount = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM content_history WHERE content_type = 'post' AND content_id = ?"
    ).bind(postId).first();
    const nextVersion = (verCount.cnt || 0) + 1;

    // Save current content as history
    await env.DB.prepare(
      "INSERT INTO content_history (content_type, content_id, previous_content, edited_by_user_id, version) VALUES ('post', ?, ?, ?, ?)"
    ).bind(postId, post.content, userId, nextVersion).run();

    // Prune to keep only last 5 versions
    if (nextVersion > 5) {
      await env.DB.prepare(
        `DELETE FROM content_history WHERE content_type = 'post' AND content_id = ? AND id NOT IN (
          SELECT id FROM content_history WHERE content_type = 'post' AND content_id = ? ORDER BY version DESC LIMIT 5
        )`
      ).bind(postId, postId).run();
    }

    // Update the post
    await env.DB.prepare(
      "UPDATE posts SET content = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(body.content.trim(), postId).run();

    return json({ success: true });
  }

  // DELETE /api/posts/:id — delete own post, or officers/admins can delete officer-visibility posts
  const postDeleteMatch = path.match(/^\/api\/posts\/(\d+)$/);
  if (postDeleteMatch && method === 'DELETE') {
    const postId = parseInt(postDeleteMatch[1]);
    let post = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first();
    if (!post) return json({ error: 'Post not found' }, 404);
    // Allow delete if: own post, OR admin can delete any post, OR officer deleting officer-visibility post
    const isAdmin = session.user.role === 'admin';
    const canDelete = post.user_id === userId || isAdmin || (OFFICER_ROLES.includes(session.user.role) && post.visibility === 'officers');
    if (!canDelete) return json({ error: 'Not authorized' }, 403);
    await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();
    return json({ success: true });
  }

  // GET /api/dogs/birthdays — upcoming dog birthdays (next 30 days)
  if (path === '/api/dogs/birthdays' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT d.id, d.name, d.breed, d.birthday, d.picture, d.user_id,
              u.name as owner_name, u.is_anonymous, u.show_name, u.show_contact, a.full_label as address_label
       FROM dogs d
       JOIN users u ON d.user_id = u.id
       LEFT JOIN addresses a ON u.address_id = a.id
       WHERE d.birthday IS NOT NULL
       AND u.role != 'pending' AND u.agreement_signed_at IS NOT NULL`
    ).all();

    // Filter to birthdays in next 30 days (compare month-day)
    const now = new Date();
    const upcoming = results.filter(d => {
      try {
        const bday = new Date(d.birthday);
        const thisYear = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
        const diffDays = (thisYear - now) / 86400000;
        if (diffDays >= -1 && diffDays <= 30) return true;
        // Also check next year wrap
        const nextYear = new Date(now.getFullYear() + 1, bday.getMonth(), bday.getDate());
        const diffNext = (nextYear - now) / 86400000;
        return diffNext >= 0 && diffNext <= 30;
      } catch (e) { return false; }
    }).sort((a, b) => {
      const aDate = new Date(a.birthday);
      const bDate = new Date(b.birthday);
      const aDay = (aDate.getMonth() * 31 + aDate.getDate());
      const bDay = (bDate.getMonth() * 31 + bDate.getDate());
      return aDay - bDay;
    });

    // Mask anonymous owners
    const viewerRole = session.user.role;
    upcoming.forEach(d => maskIfAnonymous(d, 'owner_name', [], viewerRole));

    return json(upcoming);
  }

  // --- Comments ---

  // GET /api/posts/:id/comments
  const commentsGetMatch = path.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (commentsGetMatch && method === 'GET') {
    const postId = parseInt(commentsGetMatch[1]);
    const { results } = await env.DB.prepare(
      `SELECT c.*, u.name as author_name, u.profile_picture as author_profile_picture,
              u.google_picture as author_google_picture, u.avatar_id as author_avatar_id, u.is_anonymous as author_anonymous, u.show_name, u.show_contact
       FROM comments c JOIN users u ON c.user_id = u.id
       WHERE c.post_id = ?
       ORDER BY c.created_at ASC`
    ).bind(postId).all();
    // Defense-in-depth: mask anonymous authors at API level
    const viewerRole = session.user.role;
    if (!OFFICER_ROLES.includes(viewerRole)) {
      results.forEach(c => {
        if (c.author_anonymous) {
          c.author_name = 'Anonymous Member';
          c.author_profile_picture = null;
          c.author_google_picture = null;
        }
      });
    }
    return json(results);
  }

  // POST /api/posts/:id/comments
  const commentsPostMatch = path.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (commentsPostMatch && method === 'POST') {
    const postId = parseInt(commentsPostMatch[1]);
    const post = await env.DB.prepare('SELECT id FROM posts WHERE id = ? AND approved = 1').bind(postId).first();
    if (!post) return json({ error: 'Post not found' }, 404);

    const body = await request.json();
    if (!body.content?.trim()) return json({ error: 'Comment content is required' }, 400);
    if (body.content.length > 1000) return json({ error: 'Comment too long (max 1000 characters)' }, 400);

    const result = await env.DB.prepare(
      'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)'
    ).bind(postId, userId, body.content.trim()).run();
    return json({ id: result.meta.last_row_id, success: true }, 201);
  }

  // PUT /api/comments/:id — edit own comment (saves version history, max 5)
  const commentPutMatch = path.match(/^\/api\/comments\/(\d+)$/);
  if (commentPutMatch && method === 'PUT') {
    const commentId = parseInt(commentPutMatch[1]);
    const comment = await env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(commentId).first();
    if (!comment) return json({ error: 'Comment not found' }, 404);
    if (comment.user_id !== userId && session.user.role !== 'admin') return json({ error: 'Not authorized' }, 403);

    const body = await request.json();
    if (!body.content?.trim()) return json({ error: 'Content required' }, 400);
    if (body.content.length > 1000) return json({ error: 'Too long (max 1000)' }, 400);

    const verCount = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM content_history WHERE content_type = 'comment' AND content_id = ?"
    ).bind(commentId).first();
    const nextVersion = (verCount.cnt || 0) + 1;

    await env.DB.prepare(
      "INSERT INTO content_history (content_type, content_id, previous_content, edited_by_user_id, version) VALUES ('comment', ?, ?, ?, ?)"
    ).bind(commentId, comment.content, userId, nextVersion).run();

    if (nextVersion > 5) {
      await env.DB.prepare(
        `DELETE FROM content_history WHERE content_type = 'comment' AND content_id = ? AND id NOT IN (
          SELECT id FROM content_history WHERE content_type = 'comment' AND content_id = ? ORDER BY version DESC LIMIT 5
        )`
      ).bind(commentId, commentId).run();
    }

    await env.DB.prepare(
      "UPDATE comments SET content = ? WHERE id = ?"
    ).bind(body.content.trim(), commentId).run();

    return json({ success: true });
  }

  // DELETE /api/comments/:id — delete own comment (or admin)
  const commentDeleteMatch = path.match(/^\/api\/comments\/(\d+)$/);
  if (commentDeleteMatch && method === 'DELETE') {
    const commentId = parseInt(commentDeleteMatch[1]);
    const comment = await env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(commentId).first();
    if (!comment) return json({ error: 'Comment not found' }, 404);
    if (comment.user_id !== userId && session.user.role !== 'admin') {
      return json({ error: 'Not authorized' }, 403);
    }
    await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(commentId).run();
    return json({ success: true });
  }

  // GET /api/users/search?q=... — for @mention autocomplete (friends only)
  if (path === '/api/users/search' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (q.length < 1) return json([]);
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.name, u.profile_picture, u.google_picture FROM users u
       WHERE u.name LIKE ? AND u.role != 'pending' AND u.agreement_signed_at IS NOT NULL
       AND u.is_anonymous = 0
       AND u.id IN (
         SELECT CASE WHEN user_a_id = ? THEN user_b_id ELSE user_a_id END
         FROM friendships WHERE user_a_id = ? OR user_b_id = ?
       )
       LIMIT 10`
    ).bind(`%${q}%`, userId, userId, userId).all();
    return json(results);
  }

  // --- Neighbors (properties with residents) ---
  if (path === '/api/neighbors' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT a.id as address_id, a.tract_lot, a.street_address,
              p.acres, p.wr_designation,
              u.id as user_id, u.name, u.is_anonymous, u.show_name, u.role
       FROM addresses a
       LEFT JOIN properties p ON a.id = p.address_id
       LEFT JOIN users u ON u.address_id = a.id AND u.role != 'pending' AND u.agreement_signed_at IS NOT NULL
       ORDER BY a.id, u.id`
    ).all();

    const { results: myFriends } = await env.DB.prepare(
      `SELECT CASE WHEN user_a_id = ? THEN user_b_id ELSE user_a_id END as fid
       FROM friendships WHERE user_a_id = ? OR user_b_id = ?`
    ).bind(userId, userId, userId).all();
    const friendSet = new Set(myFriends.map(f => f.fid));

    const { results: pendingReqs } = await env.DB.prepare(
      `SELECT to_user_id, from_user_id FROM friend_requests
       WHERE (from_user_id = ? OR to_user_id = ?) AND status = 'pending'`
    ).bind(userId, userId).all();
    const sentSet = new Set(pendingReqs.filter(r => r.from_user_id === userId).map(r => r.to_user_id));
    const receivedSet = new Set(pendingReqs.filter(r => r.to_user_id === userId).map(r => r.from_user_id));

    const isViewerOfficer = OFFICER_ROLES.includes(session.user.role);
    const addressMap = new Map();

    for (const r of results) {
      if (!addressMap.has(r.address_id)) {
        addressMap.set(r.address_id, {
          address_id: r.address_id,
          tract_lot: r.tract_lot,
          street_address: r.street_address,
          acres: r.acres,
          users: [],
          registered_user_count: 0
        });
      }
      const entry = addressMap.get(r.address_id);
      if (r.user_id) {
        entry.registered_user_count++;
        const isSelf = r.user_id === userId;
        const hideCompletely = r.is_anonymous && !isSelf && !isViewerOfficer;
        
        if (!hideCompletely) {
          let displayName = r.name;
          if (!isSelf && !isViewerOfficer && r.show_name === 0) {
            displayName = `A resident at ${r.street_address}`;
          }

          let status = null;
          if (isSelf) status = 'you';
          else if (friendSet.has(r.user_id)) status = 'friend';
          else if (sentSet.has(r.user_id)) status = 'pending';
          else if (receivedSet.has(r.user_id)) status = 'incoming';

          entry.users.push({ id: r.user_id, name: displayName, status, is_self: isSelf });
        }
      }
    }
    return json(Array.from(addressMap.values()));
  }

  // --- Members directory ---
  if (path === '/api/members' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.name, u.role, u.profile_picture, u.google_picture, a.full_label as address_label
       FROM users u
       LEFT JOIN addresses a ON u.address_id = a.id
       WHERE u.is_anonymous = 0 AND u.role != 'pending' AND u.role != 'auditor' AND u.agreement_signed_at IS NOT NULL
       ORDER BY u.name`
    ).all();
    return json(results);
  }

  const memberDogsMatch = path.match(/^\/api\/members\/(\d+)\/dogs$/);
  if (memberDogsMatch && method === 'GET') {
    const memberId = parseInt(memberDogsMatch[1]);
    const member = await env.DB.prepare("SELECT id, is_anonymous FROM users WHERE id = ? AND role != 'pending'").bind(memberId).first();
    if (!member) return json({ error: 'Member not found' }, 404);
    if (member.is_anonymous && memberId !== userId) return json({ error: 'Member is anonymous' }, 403);

    const { results } = await env.DB.prepare(
      'SELECT id, name, breed, age, bio, picture FROM dogs WHERE user_id = ? ORDER BY created_at'
    ).bind(memberId).all();
    return json(results);
  }

  // --- Playdate endpoints ---

  // POST /api/playdate/dogs — opt dog into play dates
  if (path === '/api/playdate/dogs' && method === 'POST') {
    const body = await request.json();
    if (!body.dog_id) return json({ error: 'dog_id is required' }, 400);
    const dog = await env.DB.prepare('SELECT id FROM dogs WHERE id = ? AND user_id = ?').bind(body.dog_id, userId).first();
    if (!dog) return json({ error: 'Dog not found or not yours' }, 404);
    await env.DB.prepare(
      "INSERT INTO playdate_dogs (dog_id, user_id, tagline, is_active, created_at) VALUES (?, ?, ?, 1, datetime('now'))"
    ).bind(body.dog_id, userId, body.tagline || null).run();
    return json({ success: true }, 201);
  }

  // DELETE /api/playdate/dogs/:dogId — remove from play dates
  const playdateDogDeleteMatch = path.match(/^\/api\/playdate\/dogs\/(\d+)$/);
  if (playdateDogDeleteMatch && method === 'DELETE') {
    const dogId = parseInt(playdateDogDeleteMatch[1]);
    const dog = await env.DB.prepare('SELECT id FROM dogs WHERE id = ? AND user_id = ?').bind(dogId, userId).first();
    if (!dog) return json({ error: 'Dog not found or not yours' }, 404);
    await env.DB.prepare('DELETE FROM playdate_dogs WHERE dog_id = ? AND user_id = ?').bind(dogId, userId).run();
    return json({ success: true });
  }

  // GET /api/playdate/dogs — list current user's playdate-active dogs
  if (path === '/api/playdate/dogs' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT pd.*, d.name, d.breed, d.age, d.bio, d.picture
       FROM playdate_dogs pd
       JOIN dogs d ON pd.dog_id = d.id
       WHERE pd.user_id = ? AND pd.is_active = 1
       ORDER BY pd.created_at`
    ).bind(userId).all();
    return json(results);
  }

  // GET /api/playdate/discover/:dogId — get next unswiped dog to show
  const playdateDiscoverMatch = path.match(/^\/api\/playdate\/discover\/(\d+)$/);
  if (playdateDiscoverMatch && method === 'GET') {
    const fromDogId = parseInt(playdateDiscoverMatch[1]);
    const fromDog = await env.DB.prepare('SELECT id FROM dogs WHERE id = ? AND user_id = ?').bind(fromDogId, userId).first();
    if (!fromDog) return json({ error: 'Dog not found or not yours' }, 404);

    // Discover ANY active playdate dog (not own) — play dates are the gateway to friendships
    const candidate = await env.DB.prepare(
      `SELECT d.id, d.name, d.breed, d.age, d.bio, d.picture, d.birthday,
              u.name as owner_name, u.id as owner_id, u.is_anonymous, u.show_name, u.show_contact,
              a.full_label as address_label, pd.tagline
       FROM playdate_dogs pd
       JOIN dogs d ON pd.dog_id = d.id
       JOIN users u ON d.user_id = u.id
       LEFT JOIN addresses a ON u.address_id = a.id
       WHERE pd.is_active = 1
         AND d.user_id != ?
         AND d.id NOT IN (SELECT to_dog_id FROM playdate_swipes WHERE from_dog_id = ?)
       ORDER BY RANDOM()
       LIMIT 1`
    ).bind(userId, fromDogId).first();
    if (!candidate) return json(null);
    if (candidate.is_anonymous && !OFFICER_ROLES.includes(session.user.role)) {
      candidate.owner_name = 'Anonymous Neighbor';
    }
    return json(candidate);
  }

  // POST /api/playdate/swipe — swipe on a dog
  if (path === '/api/playdate/swipe' && method === 'POST') {
    const body = await request.json();
    if (!body.from_dog_id || !body.to_dog_id || !body.action) return json({ error: 'from_dog_id, to_dog_id, and action are required' }, 400);
    if (body.action !== 'like' && body.action !== 'pass') return json({ error: 'action must be like or pass' }, 400);

    const fromDog = await env.DB.prepare('SELECT id FROM dogs WHERE id = ? AND user_id = ?').bind(body.from_dog_id, userId).first();
    if (!fromDog) return json({ error: 'from_dog not found or not yours' }, 404);

    await env.DB.prepare(
      "INSERT OR REPLACE INTO playdate_swipes (from_dog_id, to_dog_id, action, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(body.from_dog_id, body.to_dog_id, body.action).run();

    let matched = false;
    let match_id = null;

    if (body.action === 'like') {
      const reverse = await env.DB.prepare(
        "SELECT id FROM playdate_swipes WHERE from_dog_id = ? AND to_dog_id = ? AND action = 'like'"
      ).bind(body.to_dog_id, body.from_dog_id).first();

      if (reverse) {
        // Get dog names for the match notification
        const fromDogInfo = await env.DB.prepare('SELECT name FROM dogs WHERE id = ?').bind(body.from_dog_id).first();
        const toDogInfo = await env.DB.prepare('SELECT name, user_id FROM dogs WHERE id = ?').bind(body.to_dog_id).first();

        const matchResult = await env.DB.prepare(
          "INSERT INTO playdate_matches (dog_a_id, dog_b_id, created_at) VALUES (?, ?, datetime('now'))"
        ).bind(body.from_dog_id, body.to_dog_id).run();
        match_id = matchResult.meta.last_row_id;

        const toUser = toDogInfo.user_id;

        // Auto-create friendship if not already friends (play dates build community!)
        const existingFriend = await env.DB.prepare(
          `SELECT id FROM friendships WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)`
        ).bind(userId, toUser, toUser, userId).first();

        let threadId;
        if (!existingFriend) {
          // Create friendship
          await env.DB.prepare(
            "INSERT INTO friendships (user_a_id, user_b_id, source, created_at) VALUES (?, ?, 'playdate', datetime('now'))"
          ).bind(userId, toUser).run();
          // Create chat thread
          const chatResult = await env.DB.prepare(
            "INSERT INTO chat_threads (type, ref_id, user_a_id, user_b_id, created_at) VALUES ('friend', ?, ?, ?, datetime('now'))"
          ).bind(match_id, userId, toUser).run();
          threadId = chatResult.meta.last_row_id;
          // Remove any pending friend requests between them
          await env.DB.prepare(
            "DELETE FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)"
          ).bind(userId, toUser, toUser, userId).run();
        } else {
          // Find existing chat thread
          const t = await env.DB.prepare(
            `SELECT id FROM chat_threads WHERE type = 'friend'
             AND ((user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?))`
          ).bind(userId, toUser, toUser, userId).first();
          threadId = t?.id;
        }

        // Send match notification in chat
        if (threadId) {
          await env.DB.prepare(
            "INSERT INTO chat_messages (thread_id, sender_user_id, content, created_at) VALUES (?, ?, ?, datetime('now'))"
          ).bind(threadId, userId, `[System] 🐾 Play Date Match! ${fromDogInfo.name} and ${toDogInfo.name} both want to play! Arrange a meetup in this chat.`).run();
        }

        matched = true;
      }
    }

    return json({ matched, match_id });
  }

  // GET /api/playdate/matches — list all matches for current user's dogs
  if (path === '/api/playdate/matches' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT pm.id as match_id, pm.created_at as matched_at,
              da.id as dog_a_id, da.name as dog_a_name, da.picture as dog_a_picture, ua.name as owner_a_name, ua.is_anonymous as owner_a_anonymous,
              db.id as dog_b_id, db.name as dog_b_name, db.picture as dog_b_picture, ub.name as owner_b_name, ub.is_anonymous as owner_b_anonymous,
              ct.id as thread_id,
              (SELECT content FROM chat_messages WHERE thread_id = ct.id ORDER BY created_at DESC LIMIT 1) as latest_message
       FROM playdate_matches pm
       JOIN dogs da ON pm.dog_a_id = da.id
       JOIN dogs db ON pm.dog_b_id = db.id
       JOIN users ua ON da.user_id = ua.id
       JOIN users ub ON db.user_id = ub.id
       LEFT JOIN chat_threads ct ON ct.type = 'playdate' AND ct.ref_id = pm.id
       WHERE da.user_id = ? OR db.user_id = ?
       ORDER BY pm.created_at DESC`
    ).bind(userId, userId).all();
    const viewerRole = session.user.role;
    if (!OFFICER_ROLES.includes(viewerRole)) {
      results.forEach(r => {
        if (r.owner_a_anonymous) r.owner_a_name = 'Anonymous Neighbor';
        if (r.owner_b_anonymous) r.owner_b_name = 'Anonymous Neighbor';
      });
    }
    return json(results);
  }

  // --- Friends endpoints ---

  // POST /api/friends/request — send friend request
  if (path === '/api/friends/request' && method === 'POST') {
    const body = await request.json();
    if (!body.to_user_id) return json({ error: 'to_user_id is required' }, 400);
    if (body.to_user_id === userId) return json({ error: 'Cannot friend yourself' }, 400);

    const existing = await env.DB.prepare(
      'SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ?'
    ).bind(userId, body.to_user_id).first();
    if (existing) return json({ error: 'Friend request already sent' }, 409);

    const alreadyFriends = await env.DB.prepare(
      'SELECT id FROM friendships WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)'
    ).bind(userId, body.to_user_id, body.to_user_id, userId).first();
    if (alreadyFriends) return json({ error: 'Already friends' }, 409);

    await env.DB.prepare(
      "INSERT INTO friend_requests (from_user_id, to_user_id, status, created_at) VALUES (?, ?, 'pending', datetime('now'))"
    ).bind(userId, body.to_user_id).run();
    return json({ success: true }, 201);
  }

  // GET /api/friends/requests — list pending incoming requests
  if (path === '/api/friends/requests' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT fr.id, fr.from_user_id, fr.created_at,
              u.name, u.profile_picture, u.google_picture, u.is_anonymous, u.show_name, u.show_contact,
              a.full_label as address_label
       FROM friend_requests fr
       JOIN users u ON fr.from_user_id = u.id
       LEFT JOIN addresses a ON u.address_id = a.id
       WHERE fr.to_user_id = ? AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`
    ).bind(userId).all();
    const viewerRole = session.user.role;
    results.forEach(r => maskIfAnonymous(r, 'name', ['profile_picture', 'google_picture'], viewerRole));
    return json(results);
  }

  // PUT /api/friends/requests/:id/accept — accept friend request
  const friendAcceptMatch = path.match(/^\/api\/friends\/requests\/(\d+)\/accept$/);
  if (friendAcceptMatch && method === 'PUT') {
    const reqId = parseInt(friendAcceptMatch[1]);
    const req = await env.DB.prepare(
      "SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'"
    ).bind(reqId, userId).first();
    if (!req) return json({ error: 'Request not found' }, 404);

    await env.DB.prepare(
      "INSERT INTO friendships (user_a_id, user_b_id, source, created_at) VALUES (?, ?, 'request', datetime('now'))"
    ).bind(req.from_user_id, userId).run();

    await env.DB.prepare(
      "INSERT INTO chat_threads (type, ref_id, user_a_id, user_b_id, created_at) VALUES ('friend', NULL, ?, ?, datetime('now'))"
    ).bind(req.from_user_id, userId).run();

    await env.DB.prepare('DELETE FROM friend_requests WHERE id = ?').bind(reqId).run();
    return json({ success: true });
  }

  // DELETE /api/friends/requests/:id — reject/cancel request
  const friendReqDeleteMatch = path.match(/^\/api\/friends\/requests\/(\d+)$/);
  if (friendReqDeleteMatch && method === 'DELETE') {
    const reqId = parseInt(friendReqDeleteMatch[1]);
    const req = await env.DB.prepare(
      'SELECT * FROM friend_requests WHERE id = ? AND (from_user_id = ? OR to_user_id = ?)'
    ).bind(reqId, userId, userId).first();
    if (!req) return json({ error: 'Request not found' }, 404);
    await env.DB.prepare('DELETE FROM friend_requests WHERE id = ?').bind(reqId).run();
    return json({ success: true });
  }

  // GET /api/friends — list current user's friends
  if (path === '/api/friends' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT f.id as friendship_id, f.created_at as friends_since,
              u.id as user_id, u.name, u.profile_picture, u.google_picture, u.email,
              u.is_anonymous, u.show_name, u.show_contact, a.full_label as address_label
       FROM friendships f
       JOIN users u ON (CASE WHEN f.user_a_id = ? THEN f.user_b_id ELSE f.user_a_id END) = u.id
       LEFT JOIN addresses a ON u.address_id = a.id
       WHERE f.user_a_id = ? OR f.user_b_id = ?
       ORDER BY u.name`
    ).bind(userId, userId, userId).all();
    const viewerRole = session.user.role;
    results.forEach(r => maskIfAnonymous(r, 'name', ['profile_picture', 'google_picture'], viewerRole));
    return json(results);
  }

  // DELETE /api/friends/:friendshipId — unfriend
  const unfriendMatch = path.match(/^\/api\/friends\/(\d+)$/);
  if (unfriendMatch && method === 'DELETE') {
    const friendshipId = parseInt(unfriendMatch[1]);
    const friendship = await env.DB.prepare(
      'SELECT * FROM friendships WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)'
    ).bind(friendshipId, userId, userId).first();
    if (!friendship) return json({ error: 'Friendship not found' }, 404);

    const otherUserId = friendship.user_a_id === userId ? friendship.user_b_id : friendship.user_a_id;
    await env.DB.prepare(
      "DELETE FROM chat_threads WHERE type = 'friend' AND ((user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?))"
    ).bind(userId, otherUserId, otherUserId, userId).run();

    await env.DB.prepare('DELETE FROM friendships WHERE id = ?').bind(friendshipId).run();
    return json({ success: true });
  }

  // --- Chat endpoints (unified — friend and playdate threads) ---

  // GET /api/chat/threads — list all chat threads for current user
  if (path === '/api/chat/threads' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT ct.id, ct.type, ct.ref_id, ct.created_at,
              CASE WHEN ct.user_a_id = ? THEN ub.name ELSE ua.name END as other_user_name,
              CASE WHEN ct.user_a_id = ? THEN ub.id ELSE ua.id END as other_user_id,
              CASE WHEN ct.user_a_id = ? THEN ub.profile_picture ELSE ua.profile_picture END as other_user_picture,
              CASE WHEN ct.user_a_id = ? THEN ub.google_picture ELSE ua.google_picture END as other_user_google_picture,
              CASE WHEN ct.user_a_id = ? THEN ub.is_anonymous ELSE ua.is_anonymous END as is_anonymous,
              CASE WHEN ct.user_a_id = ? THEN ub.show_name ELSE ua.show_name END as show_name,
              CASE WHEN ct.user_a_id = ? THEN ub.show_contact ELSE ua.show_contact END as show_contact,
              CASE WHEN ct.user_a_id = ? THEN ab.full_label ELSE aa.full_label END as address_label,
              (SELECT content FROM chat_messages WHERE thread_id = ct.id ORDER BY created_at DESC LIMIT 1) as latest_message,
              (SELECT created_at FROM chat_messages WHERE thread_id = ct.id ORDER BY created_at DESC LIMIT 1) as latest_message_at
       FROM chat_threads ct
       JOIN users ua ON ct.user_a_id = ua.id
       JOIN users ub ON ct.user_b_id = ub.id
       LEFT JOIN addresses aa ON ua.address_id = aa.id
       LEFT JOIN addresses ab ON ub.address_id = ab.id
       WHERE ct.user_a_id = ? OR ct.user_b_id = ?
       ORDER BY latest_message_at DESC NULLS LAST`
    ).bind(userId, userId, userId, userId, userId, userId, userId, userId, userId, userId).all();
    // Also fetch officer group threads where user is a participant
    const { results: groupThreads } = await env.DB.prepare(
      `SELECT ct.id, ct.type, ct.ref_id, ct.created_at,
              'HOA Officers' as other_user_name, 0 as other_user_id,
              NULL as other_user_picture, NULL as other_user_google_picture,
              0 as is_anonymous, 1 as show_name, 1 as show_contact,
              NULL as address_label,
              (SELECT content FROM chat_messages WHERE thread_id = ct.id ORDER BY created_at DESC LIMIT 1) as latest_message,
              (SELECT created_at FROM chat_messages WHERE thread_id = ct.id ORDER BY created_at DESC LIMIT 1) as latest_message_at
       FROM chat_threads ct
       JOIN chat_participants cp ON ct.id = cp.thread_id
       WHERE ct.type = 'officer' AND cp.user_id = ?
       ORDER BY latest_message_at DESC NULLS LAST`
    ).bind(userId).all();

    // Merge and re-sort
    results.push(...groupThreads);
    results.sort((a, b) => (b.latest_message_at || '') > (a.latest_message_at || '') ? 1 : -1);

    const viewerRole = session.user.role;
    results.forEach(r => maskIfAnonymous(r, 'other_user_name', ['other_user_picture', 'other_user_google_picture'], viewerRole));
    return json(results);
  }

  // GET /api/chat/threads/:threadId/messages — get messages for a thread
  const chatMessagesMatch = path.match(/^\/api\/chat\/threads\/(\d+)\/messages$/);
  if (chatMessagesMatch && method === 'GET') {
    const threadId = parseInt(chatMessagesMatch[1]);
    let thread = await env.DB.prepare(
      'SELECT * FROM chat_threads WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)'
    ).bind(threadId, userId, userId).first();
    // Also check chat_participants for group threads (e.g. officer threads)
    if (!thread) {
      const participant = await env.DB.prepare(
        'SELECT id FROM chat_participants WHERE thread_id = ? AND user_id = ?'
      ).bind(threadId, userId).first();
      if (participant) {
        thread = await env.DB.prepare('SELECT * FROM chat_threads WHERE id = ?').bind(threadId).first();
      }
    }
    if (!thread) return json({ error: 'Thread not found' }, 404);

    // Prune messages older than 1 year
    await env.DB.prepare(
      "DELETE FROM chat_messages WHERE thread_id = ? AND created_at < datetime('now', '-1 year')"
    ).bind(threadId).run();

    const before = url.searchParams.get('before');
    let results;
    if (before) {
      const resp = await env.DB.prepare(
        `SELECT cm.*, u.name as sender_name, u.is_anonymous, u.show_name, u.show_contact
         FROM chat_messages cm
         JOIN users u ON cm.sender_user_id = u.id
         WHERE cm.thread_id = ? AND cm.id < ?
         ORDER BY cm.created_at DESC
         LIMIT 50`
      ).bind(threadId, parseInt(before)).all();
      results = resp.results;
    } else {
      const resp = await env.DB.prepare(
        `SELECT cm.*, u.name as sender_name, u.is_anonymous, u.show_name, u.show_contact
         FROM chat_messages cm
         JOIN users u ON cm.sender_user_id = u.id
         WHERE cm.thread_id = ?
         ORDER BY cm.created_at DESC
         LIMIT 50`
      ).bind(threadId).all();
      results = resp.results;
    }
    const viewerRole = session.user.role;
    if (!OFFICER_ROLES.includes(viewerRole)) {
      results.forEach(r => { if (r.is_anonymous) r.sender_name = 'Anonymous Neighbor'; });
    }
    return json(results);
  }

  // POST /api/chat/threads/:threadId/messages — send a message
  if (chatMessagesMatch && method === 'POST') {
    const threadId = parseInt(chatMessagesMatch[1]);
    let thread = await env.DB.prepare(
      'SELECT * FROM chat_threads WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)'
    ).bind(threadId, userId, userId).first();
    // Also check chat_participants for group threads (e.g. officer threads)
    if (!thread) {
      const participant = await env.DB.prepare(
        'SELECT id FROM chat_participants WHERE thread_id = ? AND user_id = ?'
      ).bind(threadId, userId).first();
      if (participant) {
        thread = await env.DB.prepare('SELECT * FROM chat_threads WHERE id = ?').bind(threadId).first();
      }
    }
    if (!thread) return json({ error: 'Thread not found' }, 404);

    const body = await request.json();
    if (!body.content?.trim()) return json({ error: 'Message content is required' }, 400);
    if (body.content.length > 1000) return json({ error: 'Message too long (max 1000 characters)' }, 400);

    // Insert message and enforce 500 cap atomically via batch
    const [insertResult] = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO chat_messages (thread_id, sender_user_id, content, created_at) VALUES (?, ?, ?, datetime('now'))"
      ).bind(threadId, userId, body.content.trim()),
      env.DB.prepare(
        `DELETE FROM chat_messages WHERE thread_id = ?
         AND id <= (SELECT id FROM chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1 OFFSET 500)`
      ).bind(threadId, threadId),
    ]);

    return json({ id: insertResult.meta.last_row_id, success: true }, 201);
  }

  // POST /api/chat/threads/:threadId/share-contact — share contact info as system message
  const chatShareContactMatch = path.match(/^\/api\/chat\/threads\/(\d+)\/share-contact$/);
  if (chatShareContactMatch && method === 'POST') {
    const threadId = parseInt(chatShareContactMatch[1]);
    const thread = await env.DB.prepare(
      'SELECT * FROM chat_threads WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)'
    ).bind(threadId, userId, userId).first();
    if (!thread) return json({ error: 'Thread not found' }, 404);

    const user = await env.DB.prepare(
      'SELECT u.name, u.email, u.is_anonymous, u.show_name, u.show_contact, a.full_label as address_label FROM users u LEFT JOIN addresses a ON u.address_id = a.id WHERE u.id = ?'
    ).bind(userId).first();

    if (user.is_anonymous) {
      return json({ error: 'Anonymous members cannot share contact details. Change your privacy settings in your profile first.' }, 403);
    }

    const contactMessage = `[Contact Shared] ${user.name} | ${user.email || 'No email'}${user.address_label ? ' | ' + user.address_label : ''}`;

    const result = await env.DB.prepare(
      "INSERT INTO chat_messages (thread_id, sender_user_id, content, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(threadId, userId, contactMessage).run();

    // Enforce 500 message cap
    const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE thread_id = ?').bind(threadId).first();
    if (count.cnt > 500) {
      await env.DB.prepare(
        'DELETE FROM chat_messages WHERE thread_id = ? AND id NOT IN (SELECT id FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 500)'
      ).bind(threadId, threadId).run();
    }

    return json({ id: result.meta.last_row_id, success: true }, 201);
  }

  // DELETE /api/chat/threads/:threadId — delete a chat thread
  const chatDeleteMatch = path.match(/^\/api\/chat\/threads\/(\d+)$/);
  if (chatDeleteMatch && method === 'DELETE') {
    const threadId = parseInt(chatDeleteMatch[1]);
    const thread = await env.DB.prepare('SELECT * FROM chat_threads WHERE id = ?').bind(threadId).first();
    if (!thread) return json({ error: 'Thread not found' }, 404);

    // Verify participant
    const isParticipant = thread.user_a_id === userId || thread.user_b_id === userId ||
      await env.DB.prepare('SELECT id FROM chat_participants WHERE thread_id = ? AND user_id = ?').bind(threadId, userId).first();
    if (!isParticipant) return json({ error: 'Not authorized' }, 403);

    // Delete thread and all messages (CASCADE handles messages and participants)
    await env.DB.prepare('DELETE FROM chat_messages WHERE thread_id = ?').bind(threadId).run();
    await env.DB.prepare('DELETE FROM chat_participants WHERE thread_id = ?').bind(threadId).run();
    await env.DB.prepare('DELETE FROM chat_threads WHERE id = ?').bind(threadId).run();

    return json({ success: true });
  }

  // --- Friends pending count ---
  if (path === '/api/friends/pending-count' && method === 'GET') {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM friend_requests WHERE to_user_id = ? AND status = 'pending'"
    ).bind(userId).first();
    return json({ count: count.cnt });
  }

  // --- Officer chat (group thread) ---

  // POST /api/chat/officer — create or return existing officer group thread
  if (path === '/api/chat/officer' && method === 'POST') {
    try {
    // Check if user already has an active officer thread (as creator or participant)
    let existing = await env.DB.prepare(
      "SELECT id FROM chat_threads WHERE type = 'officer' AND user_a_id = ?"
    ).bind(userId).first();
    if (!existing) {
      const asParticipant = await env.DB.prepare(
        "SELECT ct.id FROM chat_threads ct JOIN chat_participants cp ON ct.id = cp.thread_id WHERE ct.type = 'officer' AND cp.user_id = ? LIMIT 1"
      ).bind(userId).first();
      if (asParticipant) existing = asParticipant;
    }

    if (existing) {
      return json({ thread_id: existing.id, existing: true });
    }

    // Create new officer group thread (user_b_id=0 since it's a group thread)
    const threadResult = await env.DB.prepare(
      "INSERT INTO chat_threads (type, user_a_id, user_b_id, created_at) VALUES ('officer', ?, 0, datetime('now'))"
    ).bind(userId).run();
    const newThreadId = threadResult.meta.last_row_id;

    // Add current user as participant
    await env.DB.prepare(
      "INSERT INTO chat_participants (thread_id, user_id, joined_at) VALUES (?, ?, datetime('now'))"
    ).bind(newThreadId, userId).run();

    // Find all users with officer roles (include pre-registered who haven't logged in yet)
    const { results: officers } = await env.DB.prepare(
      "SELECT id FROM users WHERE role IN ('president','secretary','treasurer','other_officer','admin')"
    ).all();

    // Add each officer as participant (they'll see it when they log in)
    for (const officer of officers) {
      if (officer.id !== userId) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO chat_participants (thread_id, user_id, joined_at) VALUES (?, ?, datetime('now'))"
        ).bind(newThreadId, officer.id).run();
      }
    }

    // Add system message (use current user as sender since FK requires valid user_id)
    await env.DB.prepare(
      "INSERT INTO chat_messages (thread_id, sender_user_id, content, created_at) VALUES (?, ?, '[System] Thread opened with HOA officers', datetime('now'))"
    ).bind(newThreadId, userId).run();

    return json({ thread_id: newThreadId, success: true });
    } catch (err) {
      console.log('Officer chat error:', err.message, err.stack);
      return json({ error: 'Failed to create officer thread: ' + err.message }, 500);
    }
  }

  // --- Admin/Officer endpoints ---
  if (path.startsWith('/api/admin/')) {
    const userRole = session.user.role;

    if (!isOfficerOrAdmin(userRole)) {
      return json({ error: 'Elevated access required' }, 403);
    }

    // GET /api/admin/users — admin only
    if (path === '/api/admin/users' && method === 'GET') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
      const offset = (page - 1) * limit;
      const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM users u`
      ).first();
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.role, u.roles, u.address_id, u.google_picture, u.profile_picture,
                u.agreement_signed_at, u.agreement_ip, u.created_at, a.full_label as address_label
         FROM users u LEFT JOIN addresses a ON u.address_id = a.id
         ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
      ).bind(limit, offset).all();
      // Mark global admins (configured via ADMIN_EMAILS env var)
      const globalAdmins = (env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
      results.forEach(u => { u.is_global_admin = globalAdmins.includes((u.email || '').toLowerCase()); });
      return json({ results, page, limit, total: countResult.cnt });
    }

    // PUT /api/admin/users/:id/role — admin only
    // Now supports multi-role: body.roles is an array like ['member','officer','president']
    const roleMatch = path.match(/^\/api\/admin\/users\/(\d+)\/role$/);
    if (roleMatch && method === 'PUT') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const targetId = parseInt(roleMatch[1]);

      // Protect global admins from role changes
      const targetUser = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(targetId).first();
      const globalAdmins = (env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
      if (targetUser && globalAdmins.includes((targetUser.email || '').toLowerCase())) {
        return json({ error: 'Global admin roles cannot be modified. They are configured in the deployment.' }, 400);
      }
      const body = await request.json();

      // Support both old single-role and new multi-role format
      let roles = body.roles || [body.role];
      if (typeof roles === 'string') roles = roles.split(',').map(r => r.trim());

      // Validate all roles
      const validSet = ['member', 'officer', 'president', 'secretary', 'treasurer', 'other_officer', 'admin', 'auditor'];
      for (const r of roles) {
        if (!validSet.includes(r)) return json({ error: `Invalid role: ${r}` }, 400);
      }

      // Auditor is mutually exclusive — cannot combine with any other role
      if (roles.includes('auditor')) {
        if (roles.length > 1) return json({ error: 'Auditor role is mutually exclusive and cannot be combined with other roles' }, 400);
        roles = ['auditor'];
      } else {
        // Enforce role hierarchy:
        // President/Secretary/Treasurer/Other Officer → auto-include officer + member
        const officerTitles = ['president', 'secretary', 'treasurer', 'other_officer'];
        if (roles.some(r => officerTitles.includes(r))) {
          if (!roles.includes('officer')) roles.push('officer');
        }
        // Officers are always members
        if (roles.includes('officer') && !roles.includes('member')) roles.push('member');
        // Admin and Auditor are system roles — cannot combine with Member
        if (roles.includes('admin') && roles.includes('member')) {
          return json({ error: 'Admin is a system role and cannot be combined with Member. Use Officer roles for board members who are also property owners.' }, 400);
        }
        if (roles.includes('auditor') && roles.includes('member')) {
          return json({ error: 'Auditor is a system role and cannot be combined with Member.' }, 400);
        }
      }

      // Member role requires address
      if (roles.includes('member') && body.address_id === undefined) {
        // Check if user already has an address
        const target = await env.DB.prepare('SELECT address_id FROM users WHERE id = ?').bind(targetId).first();
        if (!target || !target.address_id) {
          if (!body.address_id) return json({ error: 'Address is required when assigning the Member role' }, 400);
        }
      }

      const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(targetId).first();
      if (!target) return json({ error: 'User not found' }, 404);

      // Determine primary role for backward compat (highest privilege)
      const rolePriority = ['admin', 'president', 'secretary', 'treasurer', 'other_officer', 'officer', 'member'];
      const primaryRole = rolePriority.find(r => roles.includes(r)) || 'member';
      const rolesStr = roles.join(',');

      const updates = ["role = ?", "roles = ?", "updated_at = datetime('now')"];
      const params = [primaryRole, rolesStr];

      if (body.address_id !== undefined) {
        if (body.address_id !== null) {
          const addr = await env.DB.prepare('SELECT id FROM addresses WHERE id = ?').bind(body.address_id).first();
          if (!addr) return json({ error: 'Invalid address' }, 400);
        }
        updates.push('address_id = ?');
        params.push(body.address_id);
      }

      params.push(targetId);
      await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

      await env.DB.prepare(
        'INSERT INTO audit_log (admin_user_id, action, target_user_id, details) VALUES (?, ?, ?, ?)'
      ).bind(userId, 'role_change', targetId, `${target.roles || target.role} -> ${rolesStr}`).run();
      return json({ success: true });
    }

    // GET /api/admin/pending-count — count of items needing approval
    if (path === '/api/admin/pending-count' && method === 'GET') {
      const users = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'pending'").first();
      const posts = await env.DB.prepare("SELECT COUNT(*) as cnt FROM posts WHERE approved = 0").first();
      const addresses = await env.DB.prepare("SELECT COUNT(*) as cnt FROM address_requests WHERE status = 'pending'").first();
      return json({ users: users.cnt, posts: posts.cnt, addresses: addresses.cnt, total: users.cnt + posts.cnt + addresses.cnt });
    }

    // GET /api/admin/address-requests — pending address change requests
    if (path === '/api/admin/address-requests' && method === 'GET') {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
      const offset = (page - 1) * limit;
      const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM address_requests WHERE status = 'pending'`
      ).first();
      const { results } = await env.DB.prepare(
        `SELECT ar.id, ar.user_id, ar.requested_address_id, ar.current_address_id, ar.created_at,
                u.name, u.email, u.role,
                ra.full_label as requested_address, ca.full_label as current_address
         FROM address_requests ar
         JOIN users u ON ar.user_id = u.id
         JOIN addresses ra ON ar.requested_address_id = ra.id
         LEFT JOIN addresses ca ON ar.current_address_id = ca.id
         WHERE ar.status = 'pending'
         ORDER BY ar.created_at DESC LIMIT ? OFFSET ?`
      ).bind(limit, offset).all();
      return json({ results, page, limit, total: countResult.cnt });
    }

    // PUT /api/admin/address-requests/:id/approve
    const addrApproveMatch = path.match(/^\/api\/admin\/address-requests\/(\d+)\/approve$/);
    if (addrApproveMatch && method === 'PUT') {
      const reqId = parseInt(addrApproveMatch[1]);
      const req = await env.DB.prepare("SELECT * FROM address_requests WHERE id = ? AND status = 'pending'").bind(reqId).first();
      if (!req) return json({ error: 'Request not found' }, 404);

      await env.DB.batch([
        env.DB.prepare("UPDATE users SET address_id = ?, updated_at = datetime('now') WHERE id = ?").bind(req.requested_address_id, req.user_id),
        env.DB.prepare("UPDATE address_requests SET status = 'approved', reviewed_by = ? WHERE id = ?").bind(userId, reqId),
      ]);

      await env.DB.prepare(
        'INSERT INTO audit_log (admin_user_id, action, target_user_id, details) VALUES (?, ?, ?, ?)'
      ).bind(userId, 'address_approved', req.user_id, `Address changed to ${req.requested_address_id}`).run();

      return json({ success: true });
    }

    // PUT /api/admin/address-requests/:id/reject
    const addrRejectMatch = path.match(/^\/api\/admin\/address-requests\/(\d+)\/reject$/);
    if (addrRejectMatch && method === 'PUT') {
      const reqId = parseInt(addrRejectMatch[1]);
      await env.DB.prepare("UPDATE address_requests SET status = 'rejected', reviewed_by = ? WHERE id = ?").bind(userId, reqId).run();
      return json({ success: true });
    }

    // GET /api/admin/pending-users — users awaiting role assignment
    if (path === '/api/admin/pending-users' && method === 'GET') {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
      const offset = (page - 1) * limit;
      const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM users WHERE role = 'pending'`
      ).first();
      const { results } = await env.DB.prepare(
        `SELECT id, email, name, google_picture, created_at
         FROM users WHERE role = 'pending'
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
      ).bind(limit, offset).all();
      return json({ results, page, limit, total: countResult.cnt });
    }

    // GET /api/admin/pending-posts — posts awaiting approval
    if (path === '/api/admin/pending-posts' && method === 'GET') {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
      const offset = (page - 1) * limit;
      const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM posts WHERE approved = 0`
      ).first();
      const { results } = await env.DB.prepare(
        `SELECT p.*, u.name as author_name, u.email as author_email
         FROM posts p JOIN users u ON p.user_id = u.id
         WHERE p.approved = 0
         ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
      ).bind(limit, offset).all();
      return json({ results, page, limit, total: countResult.cnt });
    }

    // PUT /api/admin/approve/post/:id
    const approvePostMatch = path.match(/^\/api\/admin\/approve\/post\/(\d+)$/);
    if (approvePostMatch && method === 'PUT') {
      const postId = parseInt(approvePostMatch[1]);
      await env.DB.prepare("UPDATE posts SET approved = 1 WHERE id = ?").bind(postId).run();
      await env.DB.prepare(
        'INSERT INTO audit_log (admin_user_id, action, target_user_id, details) VALUES (?, ?, ?, ?)'
      ).bind(userId, 'approve_post', null, `approved post #${postId}`).run();
      return json({ success: true });
    }

    // DELETE /api/admin/reject/post/:id
    const rejectPostMatch = path.match(/^\/api\/admin\/reject\/post\/(\d+)$/);
    if (rejectPostMatch && method === 'DELETE') {
      const postId = parseInt(rejectPostMatch[1]);
      const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first();
      if (!post) return json({ error: 'Post not found' }, 404);
      await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();
      await env.DB.prepare(
        'INSERT INTO audit_log (admin_user_id, action, target_user_id, details) VALUES (?, ?, ?, ?)'
      ).bind(userId, 'reject_post', post.user_id, `rejected post #${postId}`).run();
      return json({ success: true });
    }

    // --- Properties management (admin only) ---

    // GET /api/admin/properties
    if (path === '/api/admin/properties' && method === 'GET') {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
      const offset = (page - 1) * limit;
      const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM properties`
      ).first();
      const { results } = await env.DB.prepare(
        `SELECT p.*, a.full_label as address_label FROM properties p
         JOIN addresses a ON p.address_id = a.id ORDER BY a.id LIMIT ? OFFSET ?`
      ).bind(limit, offset).all();
      return json({ results, page, limit, total: countResult.cnt });
    }

    // POST /api/admin/properties — create a new property
    if (path === '/api/admin/properties' && method === 'POST') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const body = await request.json();
      if (!body.address_id || !body.owner_name) return json({ error: 'address_id and owner_name required' }, 400);
      const result = await env.DB.prepare(
        'INSERT INTO properties (address_id, parcel_number, acres, wr_designation, owner_name, owner_type, transfer_type, provenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(body.address_id, body.parcel_number || null, body.acres || null, body.wr_designation || null, body.owner_name, body.owner_type || 'natural', body.transfer_type || null, body.provenance || null).run();
      return json({ id: result.meta.last_row_id, success: true }, 201);
    }

    // DELETE /api/admin/properties/:id
    const propDeleteMatch = path.match(/^\/api\/admin\/properties\/(\d+)$/);
    if (propDeleteMatch && method === 'DELETE') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      await env.DB.prepare('DELETE FROM properties WHERE id = ?').bind(parseInt(propDeleteMatch[1])).run();
      return json({ success: true });
    }

    // PUT /api/admin/properties/:id
    const propMatch = path.match(/^\/api\/admin\/properties\/(\d+)$/);
    if (propMatch && method === 'PUT') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const propId = parseInt(propMatch[1]);
      const body = await request.json();
      const fields = [];
      const params = [];
      for (const key of ['owner_name', 'owner_type', 'parcel_number', 'acres', 'transfer_type', 'provenance']) {
        if (body[key] !== undefined) { fields.push(`${key} = ?`); params.push(body[key]); }
      }
      if (fields.length > 0) {
        fields.push("updated_at = datetime('now')");
        params.push(propId);
        await env.DB.prepare(`UPDATE properties SET ${fields.join(', ')} WHERE id = ?`).bind(...params).run();
      }
      return json({ success: true });
    }

    // --- Pre-registration (admin only) ---

    // POST /api/admin/pre-register — create a user record before they log in
    if (path === '/api/admin/pre-register' && method === 'POST') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const body = await request.json();

      if (!body.email?.trim()) return json({ error: 'Email is required' }, 400);
      if (!body.name?.trim()) return json({ error: 'Name is required' }, 400);
      if (!body.address_id) return json({ error: 'Address is required' }, 400);

      // Check email not already registered
      const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ? OR pre_registered_email = ?')
        .bind(body.email.trim().toLowerCase(), body.email.trim().toLowerCase()).first();
      if (existing) return json({ error: 'A user with this email already exists' }, 400);

      // Validate address
      const addr = await env.DB.prepare('SELECT id FROM addresses WHERE id = ?').bind(body.address_id).first();
      if (!addr) return json({ error: 'Invalid address' }, 400);

      // Build roles
      let roles = body.roles || ['member'];
      if (typeof roles === 'string') roles = roles.split(',');
      const officerTitles = ['president', 'secretary', 'treasurer', 'other_officer'];
      if (roles.some(r => officerTitles.includes(r)) && !roles.includes('officer')) roles.push('officer');
      if ((roles.includes('officer')) && !roles.includes('member')) roles.push('member');
      const rolePriority = ['admin', 'president', 'secretary', 'treasurer', 'other_officer', 'officer', 'member'];
      const primaryRole = rolePriority.find(r => roles.includes(r)) || 'member';

      const avatarId = Math.floor(Math.random() * 50) + 1;

      const result = await env.DB.prepare(
        `INSERT INTO users (google_id, email, name, role, roles, address_id, avatar_id,
         owner_type, is_authorized_agent, agent_for_entity, is_anonymous, pre_registered, pre_registered_email, profile_confirmed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0)`
      ).bind(
        'pre_reg_' + Date.now() + '_' + Math.random().toString(36).slice(2),
        body.email.trim().toLowerCase(),
        body.name.trim(),
        primaryRole,
        roles.join(','),
        body.address_id,
        avatarId,
        body.owner_type || 'natural',
        body.is_authorized_agent ? 1 : 0,
        body.agent_for_entity || null,
        body.is_anonymous ? 1 : 0,
        body.email.trim().toLowerCase()
      ).run();

      await env.DB.prepare(
        'INSERT INTO audit_log (admin_user_id, action, target_user_id, details) VALUES (?, ?, ?, ?)'
      ).bind(userId, 'pre_register', result.meta.last_row_id, `Pre-registered ${body.email} as ${roles.join(',')}`).run();

      return json({ id: result.meta.last_row_id, success: true });
    }

    // GET /api/admin/consent-records — users who signed the agreement
    if (path === '/api/admin/consent-records' && method === 'GET') {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
      const offset = (page - 1) * limit;
      const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM users WHERE agreement_signed_at IS NOT NULL`
      ).first();
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.role, u.agreement_signed_at, u.agreement_ip,
                u.google_picture, u.profile_picture, a.full_label as address_label
         FROM users u LEFT JOIN addresses a ON u.address_id = a.id
         WHERE u.agreement_signed_at IS NOT NULL
         ORDER BY u.agreement_signed_at DESC LIMIT ? OFFSET ?`
      ).bind(limit, offset).all();
      return json({ results, page, limit, total: countResult.cnt });
    }

    // GET /api/admin/content-history/:type/:id — view edit history for a post or comment
    const historyMatch = path.match(/^\/api\/admin\/content-history\/(post|comment)\/(\d+)$/);
    if (historyMatch && method === 'GET') {
      const [, type, id] = historyMatch;
      const { results } = await env.DB.prepare(
        `SELECT ch.*, u.name as editor_name FROM content_history ch
         JOIN users u ON ch.edited_by_user_id = u.id
         WHERE ch.content_type = ? AND ch.content_id = ?
         ORDER BY ch.version DESC`
      ).bind(type, parseInt(id)).all();
      return json(results);
    }

    // GET /api/admin/audit-log
    if (path === '/api/admin/audit-log' && method === 'GET') {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
      const offset = (page - 1) * limit;
      const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM audit_log`
      ).first();
      const { results } = await env.DB.prepare(
        `SELECT al.*, u.name as admin_name, t.name as target_name, t.email as target_email
         FROM audit_log al
         JOIN users u ON al.admin_user_id = u.id
         LEFT JOIN users t ON al.target_user_id = t.id
         ORDER BY al.created_at DESC LIMIT ? OFFSET ?`
      ).bind(limit, offset).all();
      return json({ results, page, limit, total: countResult.cnt });
    }

    // GET /api/admin/officer-chats — list all officer group threads
    if (path === '/api/admin/officer-chats' && method === 'GET') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
      const offset = (page - 1) * limit;
      const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM chat_threads WHERE type = 'officer'`
      ).first();
      const { results } = await env.DB.prepare(
        `SELECT ct.id, ct.created_at, u.name as initiator_name, u.email as initiator_email,
                (SELECT COUNT(*) FROM chat_messages WHERE thread_id = ct.id) as message_count,
                (SELECT content FROM chat_messages WHERE thread_id = ct.id ORDER BY created_at DESC LIMIT 1) as latest_message
         FROM chat_threads ct
         JOIN users u ON ct.user_a_id = u.id
         WHERE ct.type = 'officer'
         ORDER BY ct.created_at DESC LIMIT ? OFFSET ?`
      ).bind(limit, offset).all();
      return json({ results, page, limit, total: countResult.cnt });
    }

    // GET /api/admin/export/chat/:threadId — export all messages in a thread as JSON
    const exportChatMatch = path.match(/^\/api\/admin\/export\/chat\/(\d+)$/);
    if (exportChatMatch && method === 'GET') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const threadId = parseInt(exportChatMatch[1]);
      const { results } = await env.DB.prepare(
        `SELECT cm.id, cm.content, cm.created_at, u.name as sender_name, u.email as sender_email
         FROM chat_messages cm
         LEFT JOIN users u ON cm.sender_user_id = u.id
         WHERE cm.thread_id = ?
         ORDER BY cm.created_at ASC`
      ).bind(threadId).all();
      return json({ thread_id: threadId, messages: results, exported_at: new Date().toISOString() });
    }

    // GET /api/admin/export/user/:userId/chats — export a user's complete chat history
    const exportUserChatsMatch = path.match(/^\/api\/admin\/export\/user\/(\d+)\/chats$/);
    if (exportUserChatsMatch && method === 'GET') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const targetUserId = parseInt(exportUserChatsMatch[1]);

      // Find all threads this user participates in (via user_a/user_b or chat_participants)
      const { results: threads } = await env.DB.prepare(
        `SELECT DISTINCT ct.id, ct.type, ct.ref_id, ct.created_at
         FROM chat_threads ct
         LEFT JOIN chat_participants cp ON ct.id = cp.thread_id
         WHERE ct.user_a_id = ? OR ct.user_b_id = ? OR cp.user_id = ?
         ORDER BY ct.created_at DESC`
      ).bind(targetUserId, targetUserId, targetUserId).all();

      const threadData = [];
      for (const thread of threads) {
        const { results: messages } = await env.DB.prepare(
          `SELECT cm.id, cm.content, cm.created_at, u.name as sender_name, u.email as sender_email
           FROM chat_messages cm
           LEFT JOIN users u ON cm.sender_user_id = u.id
           WHERE cm.thread_id = ?
           ORDER BY cm.created_at ASC`
        ).bind(thread.id).all();
        threadData.push({ ...thread, messages });
      }

      return json({ user_id: targetUserId, threads: threadData, exported_at: new Date().toISOString() });
    }

    // --- Backup & Restore (admin only) ---

    // GET /api/admin/backup/export — Export entire database as JSON
    if (path === '/api/admin/backup/export' && method === 'GET') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const includeBlobs = url.searchParams.get('includeBlobs') === 'true';

      const tables = [
        'addresses', 'properties', 'users', 'dogs', 'posts', 'surveys',
        'survey_responses', 'comments', 'playdate_dogs', 'playdate_swipes',
        'playdate_matches', 'playdate_messages', 'friend_requests', 'friendships',
        'chat_threads', 'chat_participants', 'chat_messages', 'content_history', 'audit_log'
      ];

      const backup = {
        version: 1,
        exported_at: new Date().toISOString(),
        tables: {}
      };

      for (const table of tables) {
        let query = `SELECT * FROM ${table}`;
        if (!includeBlobs) {
          // Exclude large base64 strings if requested
          if (table === 'users') query = 'SELECT id, google_id, email, name, google_picture, address_id, is_anonymous, show_name, show_contact, role, roles, avatar_id, owner_type, is_authorized_agent, agent_for_entity, pre_registered, pre_registered_email, profile_confirmed, agreement_signed_at, agreement_ip, created_at, updated_at FROM users';
          if (table === 'dogs') query = 'SELECT id, user_id, name, breed, age, bio, created_at, updated_at FROM dogs';
          if (table === 'posts') query = 'SELECT id, user_id, content, approved, visibility, created_at, updated_at FROM posts';
        }
        const { results } = await env.DB.prepare(query).all();
        backup.tables[table] = results;
      }

      return json(backup);
    }

    // POST /api/admin/backup/import — Restore database from JSON (WARNING: overwrites all tables)
    if (path === '/api/admin/backup/import' && method === 'POST') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const data = await request.json();
      if (!data.tables) return json({ error: 'Invalid backup format' }, 400);

      const tables = [
        'addresses', 'properties', 'users', 'dogs', 'posts', 'surveys',
        'survey_responses', 'comments', 'playdate_dogs', 'playdate_swipes',
        'playdate_matches', 'playdate_messages', 'friend_requests', 'friendships',
        'chat_threads', 'chat_participants', 'chat_messages', 'content_history', 'audit_log'
      ];

      const batch = [];

      // 1. Delete all existing data in reverse dependency order
      const reverseTables = [...tables].reverse();
      for (const table of reverseTables) {
        batch.push(env.DB.prepare(`DELETE FROM ${table}`));
      }

      // 2. Insert backup data in dependency order
      for (const table of tables) {
        const rows = data.tables[table];
        if (!rows || rows.length === 0) continue;

        const columns = Object.keys(rows[0]);
        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

        for (const row of rows) {
          const values = columns.map(c => row[c]);
          batch.push(env.DB.prepare(sql).bind(...values));
        }
      }

      // 3. Execute everything in a single transaction
      await env.DB.batch(batch);

      // 4. Log the action
      await env.DB.prepare(
        'INSERT INTO audit_log (admin_user_id, action, target_user_id, details) VALUES (?, ?, ?, ?)'
      ).bind(userId, 'backup_restore', null, `Restored backup from ${data.exported_at}`).run();

      return json({ success: true });
    }
  }

  return json({ error: 'Not found' }, 404);
}
