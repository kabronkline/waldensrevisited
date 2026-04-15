// Walden's Revisited — Cloudflare Worker

import { handleLogin, handleCallback, handleLogout } from './auth.js';
import { getSession } from './session.js';
import { handleApi } from './api.js';

// Protected paths that require authentication
const PROTECTED_PREFIXES = [
  '/governance',
  '/voting-register',
  '/votes/',
  '/members',
];

function isProtectedPath(pathname) {
  // Static assets are never protected (CSS, JS, images, fonts)
  if (/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)$/i.test(pathname)) return false;
  if (pathname === '/governance.html') return true;
  if (pathname === '/voting-register.html') return true;
  return PROTECTED_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

// HTMLRewriter handlers
class OGMetaRewriter {
  constructor(replacements) { this.replacements = replacements; }
  element(el) {
    const key = el.getAttribute('property') || el.getAttribute('name') || '';
    if (this.replacements[key]) el.setAttribute('content', this.replacements[key]);
  }
}

class TitleRewriter {
  constructor(newTitle) { this.newTitle = newTitle; }
  element(el) { el.setInnerContent(this.newTitle); }
}

class BodyEndRewriter {
  constructor(signerKey) { this.signerKey = signerKey; }
  element(el) {
    el.prepend(`<script>window.__signerKey = '${this.signerKey}';</script>`, { html: true });
  }
}

// Inject session data into protected pages so client JS can use it
class SessionInjector {
  constructor(session) { this.session = session; }
  element(el) {
    const safeData = JSON.stringify(this.session.user).replace(/</g, '\\u003c');
    el.prepend(`<script>window.__session = ${safeData};</script>`, { html: true });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    // --- Logging ---
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    console.log(JSON.stringify({
      type: 'pageview',
      timestamp: new Date().toISOString(),
      ip,
      path: url.pathname,
      query: url.search || '',
      method: request.method,
      userAgent: request.headers.get('user-agent') || '',
      referer: request.headers.get('referer') || '',
      country: request.cf?.country || '',
      city: request.cf?.city || '',
      region: request.cf?.region || '',
      asn: request.cf?.asn || '',
      colo: request.cf?.colo || '',
    }));

    // --- Auth routes ---
    if (pathname === '/auth/login') return handleLogin(request, env);
    if (pathname === '/auth/callback') return handleCallback(request, env);
    if (pathname === '/auth/logout') return handleLogout(request, env);

    // --- API routes ---
    if (pathname.startsWith('/api/')) {
      const session = await getSession(env, request);
      return handleApi(request, env, session);
    }

    // --- R2 file serving (content-addressed, public, immutable cache) ---
    if (pathname.startsWith('/r2/')) {
      if (!env.UPLOADS) return new Response('File storage not configured', { status: 503 });
      const key = pathname.slice(4);
      if (!key) return new Response('Not found', { status: 404 });
      const object = await env.UPLOADS.get(key);
      if (!object) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
      headers.set('Content-Length', object.size);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('ETag', `"${key.split('.')[0]}"`);
      return new Response(object.body, { headers });
    }

    // --- Legacy redirects ---
    if (pathname === '/voting-records.html' || pathname === '/voting-records') {
      return Response.redirect(new URL('/governance.html', url.origin).toString(), 301);
    }
    if (pathname === '/voting-register.html' || pathname === '/voting-register') {
      return Response.redirect(new URL('/votes/2019-restated-declaration/', url.origin).toString(), 301);
    }

    // --- Protected pages ---
    if (isProtectedPath(pathname)) {
      const session = await getSession(env, request);

      if (!session) {
        const loginUrl = `/login.html?redirect=${encodeURIComponent(url.pathname + url.search)}`;
        return Response.redirect(new URL(loginUrl, url.origin).toString(), 302);
      }

      // Re-check DB for role/agreement updates (so users don't need to re-login after approval)
      if (session.user.role === 'pending' || !session.user.agreementSigned) {
        const freshUser = await env.DB.prepare('SELECT role, agreement_signed_at FROM users WHERE id = ?').bind(session.user.userId).first();
        if (freshUser) {
          if (freshUser.role !== session.user.role || !!freshUser.agreement_signed_at !== session.user.agreementSigned) {
            session.user.role = freshUser.role;
            session.user.agreementSigned = !!freshUser.agreement_signed_at;
            await env.SESSIONS.put(`session:${session.id}`, JSON.stringify(session.user), { expirationTtl: 60 * 60 * 24 * 7 });
          }
        }
      }

      // Pending users go to access request page
      if (session.user.role === 'pending' && !pathname.startsWith('/members/pending')) {
        return Response.redirect(new URL('/members/pending.html', url.origin).toString(), 302);
      }

      // Users with a role but no agreement must sign first (auditors exempt)
      if (!session.user.agreementSigned && session.user.role !== 'pending' && session.user.role !== 'auditor' && session.user.role !== 'admin' && !pathname.startsWith('/members/agreement')) {
        return Response.redirect(new URL('/members/agreement.html', url.origin).toString(), 302);
      }

      // Dynamic signer URL handling — DB-driven (within protected section)
      if (pathname.startsWith('/votes/') || pathname.startsWith('/governance/')) {
        const signerRecord = await env.DB.prepare(
          `SELECT vr.signer_key, vr.owner_name_at_vote, a.tract_lot, a.street_address,
                  ve.url_prefix, ve.title, ve.short_title, ve.event_date
           FROM voting_records vr
           JOIN voting_events ve ON vr.event_id = ve.id
           JOIN addresses a ON vr.address_id = a.id
           WHERE ve.has_signatures = 1 AND vr.signer_key IS NOT NULL
             AND ? = ve.url_prefix || '/' || vr.signer_key`
        ).bind(pathname).first();

        if (signerRecord) {
          const baseUrl = new URL(signerRecord.url_prefix + '/', url.origin);
          const response = await env.ASSETS.fetch(new Request(baseUrl.toString(), request));

          const ownerName = signerRecord.owner_name_at_vote;
          const tractLabel = signerRecord.tract_lot;
          const eventTitle = signerRecord.short_title || signerRecord.title;
          const newTitle = `${ownerName} (${tractLabel}) — ${eventTitle} — Walden's Revisited`;
          const newOgTitle = `${ownerName} — Signed the ${eventTitle}`;
          const newOgDesc = `${ownerName} (${tractLabel}, ${signerRecord.street_address}) voted to adopt the ${signerRecord.title} for Walden's Revisited on ${signerRecord.event_date}.`;
          const newOgUrl = `https://waldensrevisited.org${pathname}`;

          return new HTMLRewriter()
            .on('title', new TitleRewriter(newTitle))
            .on('meta[property="og:title"]', new OGMetaRewriter({ 'og:title': newOgTitle }))
            .on('meta[property="og:description"]', new OGMetaRewriter({ 'og:description': newOgDesc }))
            .on('meta[property="og:url"]', new OGMetaRewriter({ 'og:url': newOgUrl }))
            .on('meta[name="description"]', new OGMetaRewriter({ 'description': newOgDesc }))
            .on('body', new BodyEndRewriter(signerRecord.signer_key))
            .on('body', new SessionInjector(session))
            .transform(response);
        }
      }

      // Serve protected static page with session data injected
      const response = await env.ASSETS.fetch(request);
      if (response.status === 404) return response;

      return new HTMLRewriter()
        .on('body', new SessionInjector(session))
        .transform(response);
    }

    // --- Public static assets (inject session if logged in for nav) ---
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const session = await getSession(env, request);
      if (session) {
        return new HTMLRewriter()
          .on('body', new SessionInjector(session))
          .transform(response);
      }
    }
    return response;
  },

  // Scheduled cron trigger: purge chat messages older than 1 year
  async scheduled(event, env, ctx) {
    console.log('Running scheduled chat purge...');
    const result = await env.DB.prepare(
      "DELETE FROM chat_messages WHERE created_at < datetime('now', '-1 year')"
    ).run();
    console.log(`Chat purge complete: ${result.meta.changes} messages deleted`);
  },
};
