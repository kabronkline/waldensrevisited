// API route handlers for members section

const VALID_ROLES = ['pending', 'member', 'contributor', 'president', 'secretary', 'treasurer', 'other_officer', 'admin', 'auditor'];
const OFFICER_ROLES = ['president', 'secretary', 'treasurer', 'other_officer', 'admin'];
const AUTO_APPROVE_ROLES = ['contributor', 'president', 'secretary', 'treasurer', 'other_officer', 'admin'];
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
    const tract = record.address_label ? record.address_label.split('—')[0].trim() : null;
    record[nameField] = tract ? 'Neighbor at ' + tract : 'Anonymous Neighbor';
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

  // --- Access gate (re-check DB for fresh role) ---
  if (!session.user.agreementSigned || !hasAccess(session.user.role)) {
    const fresh = await env.DB.prepare('SELECT role, agreement_signed_at FROM users WHERE id = ?').bind(userId).first();
    if (fresh) {
      session.user.role = fresh.role;
      session.user.agreementSigned = !!fresh.agreement_signed_at;
      await env.SESSIONS.put(`session:${session.id}`, JSON.stringify(session.user), { expirationTtl: 60 * 60 * 24 * 7 });
    }
  }
  if (!session.user.agreementSigned && session.user.role !== 'auditor') return json({ error: 'Agreement not signed' }, 403);
  if (!hasAccess(session.user.role)) return json({ error: 'Account pending approval' }, 403);

  // --- Profile ---
  if (path === '/api/me' && method === 'PUT') {
    const body = await request.json();
    const updates = [];
    const params = [];

    if (body.address_id !== undefined) {
      if (body.address_id !== null) {
        const addr = await env.DB.prepare('SELECT id FROM addresses WHERE id = ?').bind(body.address_id).first();
        if (!addr) return json({ error: 'Invalid address' }, 400);
      }
      updates.push('address_id = ?');
      params.push(body.address_id);
    }
    if (body.is_anonymous !== undefined) { updates.push('is_anonymous = ?'); params.push(body.is_anonymous ? 1 : 0); }
    if (body.show_name !== undefined) { updates.push('show_name = ?'); params.push(body.show_name ? 1 : 0); }
    if (body.show_contact !== undefined) { updates.push('show_contact = ?'); params.push(body.show_contact ? 1 : 0); }
    if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name); }
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
    const { results } = await env.DB.prepare('SELECT * FROM dogs WHERE user_id = ? ORDER BY created_at').bind(userId).all();
    return json(results);
  }

  if (path === '/api/dogs' && method === 'POST') {
    const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM dogs WHERE user_id = ?').bind(userId).first();
    if (count.cnt >= MAX_DOGS) return json({ error: `Maximum of ${MAX_DOGS} dogs allowed` }, 400);

    const body = await request.json();
    if (!body.name || !body.name.trim()) return json({ error: 'Dog name is required' }, 400);

    const result = await env.DB.prepare(
      'INSERT INTO dogs (user_id, name, breed, age, bio) VALUES (?, ?, ?, ?, ?)'
    ).bind(userId, body.name.trim(), body.breed || null, body.age || null, body.bio || null).run();
    return json({ id: result.meta.last_row_id, success: true }, 201);
  }

  const dogMatch = path.match(/^\/api\/dogs\/(\d+)$/);
  if (dogMatch && method === 'PUT') {
    const dogId = parseInt(dogMatch[1]);
    const dog = await env.DB.prepare('SELECT * FROM dogs WHERE id = ? AND user_id = ?').bind(dogId, userId).first();
    if (!dog) return json({ error: 'Dog not found' }, 404);

    const body = await request.json();
    await env.DB.prepare(
      "UPDATE dogs SET name = ?, breed = ?, age = ?, bio = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(body.name?.trim() || dog.name, body.breed !== undefined ? body.breed : dog.breed, body.age !== undefined ? body.age : dog.age, body.bio !== undefined ? body.bio : dog.bio, dogId).run();
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

    // Auto-approve for contributors, officers, and admins
    const autoApprove = canAutoApprovePost(session.user.role) ? 1 : 0;

    const visibility = ['everybody', 'friends', 'officers'].includes(body.visibility) ? body.visibility : 'everybody';

    const result = await env.DB.prepare(
      'INSERT INTO posts (user_id, content, image, approved, visibility) VALUES (?, ?, ?, ?, ?)'
    ).bind(userId, body.content.trim(), body.image || null, autoApprove, visibility).run();

    const message = autoApprove ? 'Post published.' : 'Post submitted for approval.';
    return json({ id: result.meta.last_row_id, approved: autoApprove, success: true, message }, 201);
  }

  // DELETE /api/posts/:id — delete own post
  const postDeleteMatch = path.match(/^\/api\/posts\/(\d+)$/);
  if (postDeleteMatch && method === 'DELETE') {
    const postId = parseInt(postDeleteMatch[1]);
    const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ? AND user_id = ?').bind(postId, userId).first();
    if (!post) return json({ error: 'Post not found' }, 404);
    await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();
    return json({ success: true });
  }

  // --- Comments ---

  // GET /api/posts/:id/comments
  const commentsGetMatch = path.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (commentsGetMatch && method === 'GET') {
    const postId = parseInt(commentsGetMatch[1]);
    const { results } = await env.DB.prepare(
      `SELECT c.*, u.name as author_name, u.profile_picture as author_profile_picture,
              u.google_picture as author_google_picture, u.is_anonymous as author_anonymous, u.show_name, u.show_contact
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

  // --- Neighbors (properties without owner PII) ---
  if (path === '/api/neighbors' && method === 'GET') {
    // Return properties with address info — supports multiple users per address
    const { results } = await env.DB.prepare(
      `SELECT a.id as address_id, a.tract_lot, a.street_address, a.full_label,
              p.acres, p.wr_designation,
              u.id as resident_user_id,
              u.is_anonymous, u.show_name
       FROM addresses a
       LEFT JOIN properties p ON a.id = p.address_id
       LEFT JOIN users u ON u.address_id = a.id AND u.role != 'pending' AND u.agreement_signed_at IS NOT NULL
       ORDER BY a.id`
    ).bind().all();

    // Check friendships for each neighbor
    const { results: myFriends } = await env.DB.prepare(
      `SELECT CASE WHEN user_a_id = ? THEN user_b_id ELSE user_a_id END as fid
       FROM friendships WHERE user_a_id = ? OR user_b_id = ?`
    ).bind(userId, userId, userId).all();
    const friendSet = new Set(myFriends.map(f => f.fid));

    // Check pending friend requests
    const { results: sentReqs } = await env.DB.prepare(
      `SELECT to_user_id FROM friend_requests WHERE from_user_id = ? AND status = 'pending'`
    ).bind(userId).all();
    const sentSet = new Set(sentReqs.map(r => r.to_user_id));

    const { results: recvReqs } = await env.DB.prepare(
      `SELECT from_user_id FROM friend_requests WHERE to_user_id = ? AND status = 'pending'`
    ).bind(userId).all();
    const recvSet = new Set(recvReqs.map(r => r.from_user_id));

    // Group by address to support multiple users per address
    const addressMap = new Map();
    for (const r of results) {
      if (!addressMap.has(r.address_id)) {
        addressMap.set(r.address_id, {
          address_id: r.address_id,
          tract_lot: r.tract_lot,
          street_address: r.street_address,
          full_label: r.full_label,
          acres: r.acres,
          wr_designation: r.wr_designation,
          resident_user_ids: [],
          registered_user_count: 0,
          has_registered_user: false,
          is_self: false,
          is_friend: false,
          request_sent: false,
          request_received: false,
          can_connect: false,
        });
      }
      const entry = addressMap.get(r.address_id);
      if (r.resident_user_id) {
        entry.resident_user_ids.push(r.resident_user_id);
        entry.registered_user_count++;
        entry.has_registered_user = true;
        if (r.resident_user_id === userId) entry.is_self = true;
        if (friendSet.has(r.resident_user_id)) entry.is_friend = true;
        if (sentSet.has(r.resident_user_id)) entry.request_sent = true;
        if (recvSet.has(r.resident_user_id)) entry.request_received = true;
        // Can connect if at least one non-anonymous user at the address
        if (!r.is_anonymous && r.show_name !== 0) entry.can_connect = true;
      }
    }

    const neighbors = Array.from(addressMap.values());
    return json(neighbors);
  }

  // POST /api/neighbors/connect — send friend request to property resident
  if (path === '/api/neighbors/connect' && method === 'POST') {
    const body = await request.json();
    if (!body.address_id) return json({ error: 'address_id required' }, 400);

    // Find the registered user at this address
    const resident = await env.DB.prepare(
      `SELECT id FROM users WHERE address_id = ? AND role != 'pending' AND agreement_signed_at IS NOT NULL`
    ).bind(body.address_id).first();
    if (!resident) return json({ error: 'No registered member at this address' }, 404);
    if (resident.id === userId) return json({ error: 'You cannot connect with yourself' }, 400);

    // Check existing friendship
    const existingFriend = await env.DB.prepare(
      `SELECT id FROM friendships WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)`
    ).bind(userId, resident.id, resident.id, userId).first();
    if (existingFriend) return json({ error: 'Already connected' }, 400);

    // Check existing request
    const existingReq = await env.DB.prepare(
      `SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`
    ).bind(userId, resident.id).first();
    if (existingReq) return json({ error: 'Request already sent' }, 400);

    await env.DB.prepare(
      "INSERT INTO friend_requests (from_user_id, to_user_id, status, created_at) VALUES (?, ?, 'pending', datetime('now'))"
    ).bind(userId, resident.id).run();

    return json({ success: true, message: 'Connection request sent' });
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

    // Only discover dogs belonging to friends
    // First get friend user IDs
    const { results: friendRows } = await env.DB.prepare(
      `SELECT CASE WHEN user_a_id = ? THEN user_b_id ELSE user_a_id END as friend_id
       FROM friendships WHERE user_a_id = ? OR user_b_id = ?`
    ).bind(userId, userId, userId).all();
    const friendIds = friendRows.map(r => r.friend_id);

    let candidate = null;
    if (friendIds.length > 0) {
      const placeholders = friendIds.map(() => '?').join(',');
      candidate = await env.DB.prepare(
        `SELECT d.id, d.name, d.breed, d.age, d.bio, d.picture, u.name as owner_name, u.id as owner_id, u.is_anonymous, u.show_name, u.show_contact, pd.tagline
         FROM playdate_dogs pd
         JOIN dogs d ON pd.dog_id = d.id
         JOIN users u ON d.user_id = u.id
         WHERE pd.is_active = 1
           AND d.user_id IN (${placeholders})
           AND d.id NOT IN (SELECT to_dog_id FROM playdate_swipes WHERE from_dog_id = ?)
         ORDER BY RANDOM()
         LIMIT 1`
      ).bind(...friendIds, fromDogId).first();
    }
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

        // Find existing friend chat thread and send match notification
        const toUser = toDogInfo.user_id;
        const thread = await env.DB.prepare(
          `SELECT id FROM chat_threads WHERE type = 'friend'
           AND ((user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?))`
        ).bind(userId, toUser, toUser, userId).first();

        if (thread) {
          await env.DB.prepare(
            "INSERT INTO chat_messages (thread_id, sender_user_id, content, created_at) VALUES (?, 0, ?, datetime('now'))"
          ).bind(thread.id, `🐾 Play Date Match! ${fromDogInfo.name} and ${toDogInfo.name} both want to play! Arrange a meetup in this chat.`).run();
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

    const result = await env.DB.prepare(
      "INSERT INTO chat_messages (thread_id, sender_user_id, content, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(threadId, userId, body.content.trim()).run();

    // Enforce 500 message cap
    const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE thread_id = ?').bind(threadId).first();
    if (count.cnt > 500) {
      await env.DB.prepare(
        'DELETE FROM chat_messages WHERE thread_id = ? AND id NOT IN (SELECT id FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 500)'
      ).bind(threadId, threadId).run();
    }

    return json({ id: result.meta.last_row_id, success: true }, 201);
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
    // Check if user already has an active officer thread
    const existing = await env.DB.prepare(
      "SELECT id FROM chat_threads WHERE type = 'officer' AND user_a_id = ?"
    ).bind(userId).first();

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

    // Find all users with officer roles who have signed the agreement
    const { results: officers } = await env.DB.prepare(
      "SELECT id FROM users WHERE role IN ('president','secretary','treasurer','other_officer','admin') AND agreement_signed_at IS NOT NULL"
    ).all();

    // Add each officer as participant
    for (const officer of officers) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO chat_participants (thread_id, user_id, joined_at) VALUES (?, ?, datetime('now'))"
      ).bind(newThreadId, officer.id).run();
    }

    // Add system message
    await env.DB.prepare(
      "INSERT INTO chat_messages (thread_id, sender_user_id, content, created_at) VALUES (?, 0, 'Thread opened with HOA officers', datetime('now'))"
    ).bind(newThreadId).run();

    return json({ thread_id: newThreadId, success: true });
  }

  // --- Admin/Officer endpoints ---
  if (path.startsWith('/api/admin/')) {
    const userRole = session.user.role;

    if (!isOfficerOrAdmin(userRole) && userRole !== 'contributor') {
      return json({ error: 'Elevated access required' }, 403);
    }

    // GET /api/admin/users — admin only
    if (path === '/api/admin/users' && method === 'GET') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.role, u.roles, u.address_id, u.google_picture, u.profile_picture,
                u.agreement_signed_at, u.agreement_ip, u.created_at, a.full_label as address_label
         FROM users u LEFT JOIN addresses a ON u.address_id = a.id
         ORDER BY u.created_at DESC`
      ).all();
      return json(results);
    }

    // PUT /api/admin/users/:id/role — admin only
    // Now supports multi-role: body.roles is an array like ['member','officer','president']
    const roleMatch = path.match(/^\/api\/admin\/users\/(\d+)\/role$/);
    if (roleMatch && method === 'PUT') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const targetId = parseInt(roleMatch[1]);
      const body = await request.json();

      // Support both old single-role and new multi-role format
      let roles = body.roles || [body.role];
      if (typeof roles === 'string') roles = roles.split(',').map(r => r.trim());

      // Validate all roles
      const validSet = ['member', 'contributor', 'officer', 'president', 'secretary', 'treasurer', 'other_officer', 'admin', 'auditor'];
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
        if (roles.includes('officer') || roles.includes('contributor') || roles.includes('admin')) {
          if (!roles.includes('member')) roles.push('member');
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
      const rolePriority = ['admin', 'president', 'secretary', 'treasurer', 'other_officer', 'officer', 'contributor', 'member'];
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
      return json({ users: users.cnt, posts: posts.cnt, total: users.cnt + posts.cnt });
    }

    // GET /api/admin/pending-users — users awaiting role assignment
    if (path === '/api/admin/pending-users' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT id, email, name, google_picture, created_at
         FROM users WHERE role = 'pending'
         ORDER BY created_at DESC`
      ).all();
      return json(results);
    }

    // GET /api/admin/pending-posts — posts awaiting approval
    if (path === '/api/admin/pending-posts' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT p.*, u.name as author_name, u.email as author_email
         FROM posts p JOIN users u ON p.user_id = u.id
         WHERE p.approved = 0
         ORDER BY p.created_at DESC`
      ).all();
      return json(results);
    }

    // PUT /api/admin/approve/post/:id
    const approvePostMatch = path.match(/^\/api\/admin\/approve\/post\/(\d+)$/);
    if (approvePostMatch && method === 'PUT') {
      const postId = parseInt(approvePostMatch[1]);
      await env.DB.prepare("UPDATE posts SET approved = 1, updated_at = datetime('now') WHERE id = ?").bind(postId).run();
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
      const { results } = await env.DB.prepare(
        `SELECT p.*, a.full_label as address_label FROM properties p
         JOIN addresses a ON p.address_id = a.id ORDER BY a.id`
      ).all();
      return json(results);
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
      if ((roles.includes('officer') || roles.includes('contributor') || roles.includes('admin')) && !roles.includes('member')) roles.push('member');
      const rolePriority = ['admin', 'president', 'secretary', 'treasurer', 'other_officer', 'officer', 'contributor', 'member'];
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
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.role, u.agreement_signed_at, u.agreement_ip,
                u.google_picture, u.profile_picture, a.full_label as address_label
         FROM users u LEFT JOIN addresses a ON u.address_id = a.id
         WHERE u.agreement_signed_at IS NOT NULL
         ORDER BY u.agreement_signed_at DESC`
      ).all();
      return json(results);
    }

    // GET /api/admin/audit-log
    if (path === '/api/admin/audit-log' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT al.*, u.name as admin_name, t.name as target_name, t.email as target_email
         FROM audit_log al
         JOIN users u ON al.admin_user_id = u.id
         LEFT JOIN users t ON al.target_user_id = t.id
         ORDER BY al.created_at DESC LIMIT 100`
      ).all();
      return json(results);
    }

    // GET /api/admin/officer-chats — list all officer group threads
    if (path === '/api/admin/officer-chats' && method === 'GET') {
      if (userRole !== 'admin') return json({ error: 'Admin access required' }, 403);
      const { results } = await env.DB.prepare(
        `SELECT ct.id, ct.created_at, u.name as initiator_name, u.email as initiator_email,
                (SELECT COUNT(*) FROM chat_messages WHERE thread_id = ct.id) as message_count,
                (SELECT content FROM chat_messages WHERE thread_id = ct.id ORDER BY created_at DESC LIMIT 1) as latest_message
         FROM chat_threads ct
         JOIN users u ON ct.user_a_id = u.id
         WHERE ct.type = 'officer'
         ORDER BY ct.created_at DESC`
      ).all();
      return json(results);
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
  }

  return json({ error: 'Not found' }, 404);
}
