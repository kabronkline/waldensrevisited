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
    let isAnonymous = 0;
    try { const body = await request.json(); if (body.is_anonymous) isAnonymous = 1; } catch (e) {}
    await env.DB.prepare(
      "UPDATE users SET agreement_signed_at = datetime('now'), agreement_ip = ?, is_anonymous = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(ip, isAnonymous, userId).run();

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

  // --- Access gate ---
  if (!session.user.agreementSigned) return json({ error: 'Agreement not signed' }, 403);
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

    const { results } = await env.DB.prepare(
      `SELECT p.*, u.name as author_name, u.role as author_role,
              u.profile_picture as author_profile_picture, u.google_picture as author_google_picture,
              u.is_anonymous as author_anonymous,
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE p.approved = 1 OR p.user_id = ?
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(userId, limit, offset).all();
    return json(results);
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

    const result = await env.DB.prepare(
      'INSERT INTO posts (user_id, content, image, approved) VALUES (?, ?, ?, ?)'
    ).bind(userId, body.content.trim(), body.image || null, autoApprove).run();

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
              u.google_picture as author_google_picture, u.is_anonymous as author_anonymous
       FROM comments c JOIN users u ON c.user_id = u.id
       WHERE c.post_id = ?
       ORDER BY c.created_at ASC`
    ).bind(postId).all();
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

  // GET /api/users/search?q=... — for @mention autocomplete
  if (path === '/api/users/search' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (q.length < 1) return json([]);
    const { results } = await env.DB.prepare(
      `SELECT id, name, profile_picture, google_picture FROM users
       WHERE name LIKE ? AND role != 'pending' AND agreement_signed_at IS NOT NULL
       LIMIT 10`
    ).bind(`%${q}%`).all();
    return json(results);
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
        `SELECT u.id, u.email, u.name, u.role, u.google_picture, u.profile_picture,
                u.agreement_signed_at, u.created_at, a.full_label as address_label
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
  }

  return json({ error: 'Not found' }, 404);
}
