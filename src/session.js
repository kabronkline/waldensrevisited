// Session management using Cloudflare KV

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

function generateSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(env, userData) {
  const sessionId = generateSessionId();
  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(userData), { expirationTtl: SESSION_TTL });
  return sessionId;
}

export async function getSession(env, request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([a-f0-9]{64})/);
  if (!match) return null;

  const data = await env.SESSIONS.get(`session:${match[1]}`, 'json');
  if (!data) return null;
  return { id: match[1], user: data };
}

export async function deleteSession(env, sessionId) {
  await env.SESSIONS.delete(`session:${sessionId}`);
}

export function sessionCookie(sessionId, secure) {
  const flags = `HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}${secure ? '; Secure' : ''}`;
  return `session=${sessionId}; ${flags}`;
}

export function clearSessionCookie(secure) {
  return `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
