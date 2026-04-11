// Google OAuth authentication handlers

import { createSession, deleteSession, sessionCookie, clearSessionCookie } from './session.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function getRedirectUri(url) {
  return `${url.origin}/auth/callback`;
}

// Decode a JWT payload without verification (we trust Google's token endpoint response)
function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
  return JSON.parse(atob(padded));
}

export async function handleLogin(request, env) {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get('redirect') || '/members/';

  // Generate state with CSRF protection and redirect target
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const stateId = Array.from(stateBytes, b => b.toString(16).padStart(2, '0')).join('');
  const stateData = JSON.stringify({ redirect: redirectTo });
  await env.SESSIONS.put(`oauth_state:${stateId}`, stateData, { expirationTtl: 600 });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: getRedirectUri(url),
    response_type: 'code',
    scope: 'openid email profile',
    state: stateId,
    prompt: 'select_account',
  });

  return Response.redirect(`${GOOGLE_AUTH_URL}?${params}`, 302);
}

export async function handleCallback(request, env) {
  const url = new URL(request.url);

  try {
  const code = url.searchParams.get('code');
  const stateId = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return Response.redirect(`${url.origin}/login.html?error=${encodeURIComponent(error)}`, 302);
  }

  if (!code || !stateId) {
    return Response.redirect(`${url.origin}/login.html?error=missing_params`, 302);
  }

  // Validate state
  const stateData = await env.SESSIONS.get(`oauth_state:${stateId}`, 'json');
  await env.SESSIONS.delete(`oauth_state:${stateId}`);
  if (!stateData) {
    return Response.redirect(`${url.origin}/login.html?error=invalid_state`, 302);
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getRedirectUri(url),
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    console.log('Token exchange failed:', tokenResponse.status, errorBody);
    return Response.redirect(`${url.origin}/login.html?error=token_exchange_failed`, 302);
  }

  const tokens = await tokenResponse.json();
  const idPayload = decodeJwtPayload(tokens.id_token);

  const googleId = idPayload.sub;
  const email = idPayload.email;
  const name = idPayload.name || email;
  const picture = idPayload.picture || '';

  // Check if admin
  const adminEmails = (env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
  const isAdmin = adminEmails.includes(email.toLowerCase());

  // Upsert user in D1
  // First check by google_id, then check for pre-registered user by email
  let existing = await env.DB.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleId).first();

  // Check for pre-registered user (admin created before first login)
  if (!existing) {
    const preReg = await env.DB.prepare('SELECT * FROM users WHERE pre_registered_email = ? AND pre_registered = 1').bind(email.toLowerCase()).first();
    if (preReg) {
      // Link pre-registered account to this Google login
      await env.DB.prepare(
        "UPDATE users SET google_id = ?, email = ?, google_picture = ?, pre_registered = 0, updated_at = datetime('now') WHERE id = ?"
      ).bind(googleId, email, picture, preReg.id).run();
      existing = { ...preReg, google_id: googleId, email, google_picture: picture, pre_registered: 0 };
    }
  }

  let user;
  if (existing) {
    await env.DB.prepare(
      "UPDATE users SET name = ?, google_picture = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(name, picture, existing.id).run();
    user = { ...existing, name, google_picture: picture };
    // Promote to admin if in admin list and not already admin
    if (isAdmin && existing.role !== 'admin') {
      await env.DB.prepare("UPDATE users SET role = 'admin', roles = 'admin,member' WHERE id = ?").bind(existing.id).run();
      user.role = 'admin';
      user.roles = 'admin,member';
    }
  } else {
    const role = isAdmin ? 'admin' : 'pending';
    const roles = isAdmin ? 'admin,member' : 'pending';
    const avatarId = Math.floor(Math.random() * 50) + 1;
    const result = await env.DB.prepare(
      'INSERT INTO users (google_id, email, name, google_picture, role, roles, avatar_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(googleId, email, name, picture, role, roles, avatarId).run();
    user = {
      id: result.meta.last_row_id,
      google_id: googleId,
      email,
      name,
      google_picture: picture,
      role,
      agreement_signed_at: null,
      address_id: null,
      is_anonymous: 0,
      profile_picture: null,
    };
  }

  // Create session
  const sessionId = await createSession(env, {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    picture: user.google_picture,
    agreementSigned: !!user.agreement_signed_at,
  });

  const isSecure = url.protocol === 'https:';
  const cookie = sessionCookie(sessionId, isSecure);

  // Determine redirect
  let redirectTo = stateData.redirect || '/members/';
  if (user.role === 'pending') {
    // Pending users go straight to "contact admin" — no agreement needed yet
    redirectTo = '/members/pending.html';
  } else if (!user.agreement_signed_at && user.role !== 'auditor') {
    // Users with a role but no agreement must sign first (auditors exempt)
    redirectTo = '/members/agreement.html';
  }

  console.log('OAuth callback success: redirecting to', redirectTo, 'for user', user.email, 'role', user.role);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': redirectTo,
      'Set-Cookie': cookie,
    },
  });

  } catch (err) {
    console.log('OAuth callback error:', err.message, err.stack);
    return Response.redirect(`${url.origin}/login.html?error=callback_error`, 302);
  }
}

export async function handleLogout(request, env) {
  const url = new URL(request.url);
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([a-f0-9]{64})/);
  if (match) {
    await deleteSession(env, match[1]);
  }

  const isSecure = url.protocol === 'https:';
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/',
      'Set-Cookie': clearSessionCookie(isSecure),
    },
  });
}
