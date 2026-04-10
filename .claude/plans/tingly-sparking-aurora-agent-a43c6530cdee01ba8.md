# Members-Only Section Implementation Plan
## Walden's Revisited — Cloudflare Workers Static Site

---

## 1. Infrastructure Setup

### 1.1 Cloudflare Resources to Create

```bash
# D1 Database
npx wrangler d1 create waldensrevisited-db

# KV Namespace (sessions)
npx wrangler kv namespace create SESSIONS
npx wrangler kv namespace create SESSIONS --preview

# R2 Bucket (image uploads)
npx wrangler r2 bucket create waldensrevisited-uploads

# Worker Secrets
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

### 1.2 Updated wrangler.toml

```toml
name = "waldensrevisited"
main = "src/worker.js"
compatibility_date = "2024-12-01"

[observability]
enabled = true
head_sampling_rate = 1

[assets]
directory = "./public"
binding = "ASSETS"
run_worker_first = true

[[d1_databases]]
binding = "DB"
database_name = "waldensrevisited-db"
database_id = "<ID_FROM_CREATE>"

[[kv_namespaces]]
binding = "SESSIONS"
id = "<ID_FROM_CREATE>"
preview_id = "<PREVIEW_ID>"

[[r2_buckets]]
binding = "UPLOADS"
bucket_name = "waldensrevisited-uploads"

[vars]
GOOGLE_CLIENT_ID = "865105554486-uu5ilnjk0oshjlu4iib4aidaptii476r.apps.googleusercontent.com"
ADMIN_EMAILS = "kabron@example.com"  # comma-separated global admins

[env.beta]
name = "waldensrevisited-beta"

[[env.beta.d1_databases]]
binding = "DB"
database_name = "waldensrevisited-db-beta"
database_id = "<BETA_ID>"

[[env.beta.kv_namespaces]]
binding = "SESSIONS"
id = "<BETA_KV_ID>"
preview_id = "<BETA_PREVIEW_ID>"

[[env.beta.r2_buckets]]
binding = "UPLOADS"
bucket_name = "waldensrevisited-uploads-beta"

[env.beta.vars]
GOOGLE_CLIENT_ID = "865105554486-uu5ilnjk0oshjlu4iib4aidaptii476r.apps.googleusercontent.com"
ADMIN_EMAILS = "kabron@example.com"
```

---

## 2. Database Schema (D1)

Create file: `src/schema.sql`

```sql
-- Run with: npx wrangler d1 execute waldensrevisited-db --file=src/schema.sql

-- 25 neighborhood addresses (seed data)
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parcel_type TEXT NOT NULL,           -- 'Lot' or 'Tract'
  parcel_number TEXT NOT NULL,         -- '1', '2/3', '10/11', etc.
  parcel_id TEXT NOT NULL,             -- County Auditor parcel ID
  street_address TEXT NOT NULL,        -- '423 Brindle Road'
  UNIQUE(parcel_id)
);

-- Users table (populated on first Google login)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  google_picture_url TEXT,
  profile_picture_key TEXT,           -- R2 key for uploaded profile pic
  address_id INTEGER,                 -- FK to addresses
  is_anonymous INTEGER DEFAULT 0,     -- 0 = visible, 1 = anonymous
  role TEXT DEFAULT 'pending',        -- 'pending', 'member', 'contributor', 'admin'
  agreement_signed_at TEXT,           -- ISO timestamp when agreement signed
  agreement_version TEXT,             -- version of agreement signed
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (address_id) REFERENCES addresses(id)
);

-- Dogs table (up to 5 per user)
CREATE TABLE IF NOT EXISTS dogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  breed TEXT,
  age_years INTEGER,
  description TEXT,
  photo_key TEXT,                     -- R2 key for dog photo
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Audit log for admin actions
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,               -- 'role_change', 'user_delete', etc.
  target_user_id INTEGER,
  details TEXT,                       -- JSON string with old/new values
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (admin_user_id) REFERENCES users(id),
  FOREIGN KEY (target_user_id) REFERENCES users(id)
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_dogs_user_id ON dogs(user_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
```

Create file: `src/seed-addresses.sql`

```sql
-- All 25 voting parcels from the Walden's Revisited HOA
INSERT INTO addresses (parcel_type, parcel_number, parcel_id, street_address) VALUES
  ('Lot', '1', '20040001060002', '423 Brindle Road'),
  ('Tract', '1', '20040001061016', '475 Brindle Road'),
  ('Lot', '2/3', '20040001060004', '427 Brindle Road'),
  ('Tract', '2', '20040001061002', '497 Brindle Road'),
  ('Tract', '3', '20040001061003', '505 Brindle Road'),
  ('Lot', '4', '20040001060003', '431 Brindle Road'),
  ('Tract', '4', '20040001061004', '541 Brindle Road'),
  ('Tract', '5', '20040001061005', 'Brindle Road'),
  ('Tract', '6', '20040001061006', 'Brindle Road'),
  ('Tract', '7', '20040001061007', 'Brindle Road'),
  ('Tract', '8', '20040001061008', '623 Brindle Road'),
  ('Tract', '9', '20040001061009', '661 Brindle Road'),
  ('Tract', '10/11', '20040001061010', '675 Brindle Road'),
  ('Tract', '12', '20040001061012', '6810 Houseman Rd'),
  ('Tract', '13', '20040001061013', '6724 Houseman Rd'),
  ('Tract', '14', '20040001061014', '6720 Houseman Rd'),
  ('Tract', '15', '20040001061015', 'Houseman Rd'),
  ('Tract', '20', '20040002003005', '7070 Slocum Road'),
  ('Tract', '21', '20040002003004', '7058 Slocum Road'),
  ('Tract', '22', '20040001061022', '554 Brindle Road'),
  ('Tract', '23', '20040001061023', '510 Brindle Road'),
  ('Tract', '24', '20040001061024', '494 Brindle Road'),
  ('Tract', '25', '20040001061025', 'Brindle Road'),
  ('Tract', '26', '20040001061026', '440 Brindle Road'),
  ('Tract', '27', '20040001061027', '420 Brindle Road');
```

---

## 3. Authentication Flow (Server-Side Google OAuth)

Use server-side authorization code flow (NOT PKCE). The Worker acts as a confidential client since it holds the client secret.

### 3.1 Flow

```
User clicks "Sign In with Google"
  -> GET /auth/google
     Worker generates random `state`, stores in KV with 5min TTL
     Redirects to:
       https://accounts.google.com/o/oauth2/v2/auth?
         client_id=...&
         redirect_uri=https://waldensrevisited.org/auth/callback&
         response_type=code&
         scope=openid email profile&
         state={random_state}&
         prompt=select_account

  -> Google redirects to GET /auth/callback?code=...&state=...
     Worker:
       1. Validates state against KV (then deletes it)
       2. Exchanges code for tokens via POST to https://oauth2.googleapis.com/token
       3. Decodes id_token to get {sub, email, name, picture}
       4. Upserts user in D1 (INSERT OR IGNORE, then UPDATE)
       5. Creates session: random 64-char hex ID, stores in KV
          Key: session:{id}
          Value: JSON {userId, email, role, ...}
          TTL: 7 days (604800 seconds)
       6. Sets HttpOnly, Secure, SameSite=Lax cookie: __wr_session={id}; Path=/; Max-Age=604800
       7. If user.agreement_signed_at is NULL -> redirect to /members/agreement.html
       8. Else redirect to /members/ (or the originally requested protected URL)
```

### 3.2 Google Cloud Console — Redirect URIs to Configure

```
Production:
  https://waldensrevisited.org/auth/callback

Beta:
  https://waldensrevisited-beta.<account>.workers.dev/auth/callback
  (or whatever the beta domain is)

Local dev:
  http://localhost:8787/auth/callback
```

### 3.3 Logout Flow

```
GET /auth/logout
  -> Delete session from KV
  -> Clear cookie
  -> Redirect to /
```

---

## 4. Session Management

### 4.1 KV Session Structure

```
Key:    session:{64-char-hex}
Value:  {
  "userId": 1,
  "googleId": "1234567890",
  "email": "user@gmail.com",
  "displayName": "John Doe",
  "role": "member",          // pending | member | contributor | admin
  "agreementSigned": true,
  "createdAt": "2026-04-10T..."
}
TTL:    604800 (7 days)
```

### 4.2 Session Helper (in worker)

A `getSession(request, env)` function that:
1. Reads `__wr_session` cookie from request
2. Looks up `session:{id}` in KV
3. Returns parsed session object or null
4. Used by every protected route and API endpoint

---

## 5. API Routes

All API routes return JSON. The worker's fetch handler routes based on URL pathname prefix.

### 5.1 Auth Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/google` | Initiate Google OAuth |
| GET | `/auth/callback` | Google OAuth callback |
| GET | `/auth/logout` | Destroy session, redirect |
| GET | `/auth/me` | Return current user info (for frontend JS) |

### 5.2 Member Profile Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/profile` | Get current user's profile |
| PUT | `/api/profile` | Update profile (address, anonymity, name) |
| POST | `/api/profile/picture` | Upload profile picture |
| DELETE | `/api/profile/picture` | Remove profile picture |
| POST | `/api/agreement` | Sign the membership agreement |

### 5.3 Dogs Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dogs` | List current user's dogs |
| POST | `/api/dogs` | Create a dog (max 5 check) |
| PUT | `/api/dogs/:id` | Update a dog |
| DELETE | `/api/dogs/:id` | Delete a dog |
| POST | `/api/dogs/:id/photo` | Upload dog photo |
| DELETE | `/api/dogs/:id/photo` | Remove dog photo |

### 5.4 Public Directory Routes (for "Neighbor Dogs" page)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/directory/dogs` | All dogs from non-anonymous members |
| GET | `/api/directory/members` | Non-anonymous member profiles |

### 5.5 Admin Routes (require role=admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/users` | List all users with roles |
| PUT | `/api/admin/users/:id/role` | Change user role |
| GET | `/api/admin/audit-log` | View audit log |

### 5.6 Utility Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/addresses` | List all 25 addresses (for profile dropdown) |
| GET | `/uploads/:key` | Serve images from R2 (with caching headers) |

---

## 6. Route Protection Strategy

### 6.1 Protected Path Patterns

```javascript
const PROTECTED_PATHS = [
  '/governance.html',
  '/governance/',              // catches all governance subpaths
  '/voting-register.html',
  '/votes/',                   // catches all vote subpaths
  '/members/',                 // all members-only pages
];
```

### 6.2 Protection Logic in Worker

The worker's fetch handler checks BEFORE serving static assets:

```
1. Is the path in PROTECTED_PATHS?
   -> No: serve static asset as normal (existing behavior)
   -> Yes: continue

2. Call getSession(request, env)
   -> No session: redirect to /login.html?redirect={original_path}
   -> Session exists but role === 'pending': redirect to /members/pending.html
   -> Session exists but !agreementSigned: redirect to /members/agreement.html
   -> Session valid: serve the static asset (or use HTMLRewriter to inject user data)
```

### 6.3 HTMLRewriter for Protected Pages

Use HTMLRewriter to inject user session data into protected pages, so client-side JS can show user info without an extra API call:

```javascript
class SessionInjector {
  constructor(session) { this.session = session; }
  element(el) {
    el.prepend(`<script>window.__wrSession = ${JSON.stringify(this.session)};</script>`, { html: true });
  }
}
```

This is the same pattern already used for `BodyEndRewriter` with signerKey.

---

## 7. File and Directory Organization

### 7.1 New Source Files

```
src/
  worker.js              # EXISTING - expand with routing
  schema.sql             # NEW - D1 schema
  seed-addresses.sql     # NEW - 25 address seed data
  auth.js                # NEW - Google OAuth handlers
  session.js             # NEW - Session helpers (getSession, createSession, deleteSession)
  api/
    profile.js           # NEW - Profile CRUD handlers
    dogs.js              # NEW - Dogs CRUD handlers
    admin.js             # NEW - Admin handlers
    directory.js         # NEW - Public directory handlers
    addresses.js         # NEW - Address listing
  middleware.js          # NEW - requireAuth, requireRole helpers
  upload.js              # NEW - R2 upload/serve helpers
  router.js              # NEW - Route matching utility
```

### 7.2 New Public Pages

```
public/
  login.html                     # NEW - Login page with Google button
  members/
    index.html                   # NEW - Members dashboard/home
    agreement.html               # NEW - Membership agreement screen
    pending.html                 # NEW - "Awaiting approval" screen
    profile.html                 # NEW - Edit profile page
    dogs.html                    # NEW - Manage your dogs
    directory.html               # NEW - Neighbor dogs directory (public to members)
  members/
    members.css                  # NEW - Members section styles
    members.js                   # NEW - Members section JS (API calls, forms)
```

### 7.3 Worker.js Restructure

The current `worker.js` is ~134 lines. The new routing logic should keep the existing OG-rewriting logic intact and add new route handling before the static asset fallthrough. Recommended approach:

```javascript
// src/worker.js - restructured

import { handleAuth } from './auth.js';
import { handleApi } from './router.js';
import { getSession } from './session.js';
import { serveUpload } from './upload.js';

// ... existing signerData, HTMLRewriter classes stay here ...

const PROTECTED_PATHS = [
  '/governance.html',
  '/governance/',
  '/voting-register.html',
  '/votes/',
  '/members/',
];

function isProtected(pathname) {
  return PROTECTED_PATHS.some(p => pathname === p || pathname.startsWith(p));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    // ... existing logging ...

    // Auth routes
    if (pathname.startsWith('/auth/')) {
      return handleAuth(request, env, url);
    }

    // API routes
    if (pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    // Serve uploaded images from R2
    if (pathname.startsWith('/uploads/')) {
      return serveUpload(request, env, pathname);
    }

    // ... existing redirect for /voting-records.html ...

    // Protected route check
    if (isProtected(pathname)) {
      const session = await getSession(request, env);
      if (!session) {
        return Response.redirect(
          new URL(`/login.html?redirect=${encodeURIComponent(url.pathname)}`, url.origin),
          302
        );
      }
      if (!session.agreementSigned) {
        return Response.redirect(new URL('/members/agreement.html', url.origin), 302);
      }
      if (session.role === 'pending') {
        return Response.redirect(new URL('/members/pending.html', url.origin), 302);
      }

      // Serve protected asset with session injection
      const response = await env.ASSETS.fetch(request);
      return new HTMLRewriter()
        .on('body', new SessionInjector(session))
        .transform(response);
    }

    // ... existing signer OG tag rewriting ...

    // Default: serve static asset
    return env.ASSETS.fetch(request);
  }
};
```

---

## 8. Image Upload Approach with R2

### 8.1 Strategy: Direct Worker Upload (NOT presigned URLs)

Use the R2 Worker binding directly, since images are small (profile pics, dog photos) and the Worker can handle the multipart form data. This avoids needing R2 API tokens and the aws4fetch dependency.

### 8.2 Upload Flow

```
1. Client submits <form> with <input type="file"> via fetch() with FormData
2. Worker receives multipart request
3. Worker validates:
   - User is authenticated
   - File type is image (jpeg, png, webp, gif)
   - File size < 5MB
4. Worker generates R2 key: {type}/{userId}/{timestamp}-{random}.{ext}
   e.g., "profiles/42/1712764800-a1b2c3.jpg"
        "dogs/42/1712764800-d4e5f6.jpg"
5. Worker puts to R2: env.UPLOADS.put(key, body, { httpMetadata: { contentType } })
6. Worker updates D1 record with the R2 key
7. If replacing existing photo, delete old R2 object
8. Returns JSON { key, url: "/uploads/{key}" }
```

### 8.3 Serving Images

```
GET /uploads/{key}
  -> Worker fetches from R2: env.UPLOADS.get(key)
  -> Returns with Cache-Control headers and correct Content-Type
  -> Only serve if requester is authenticated (prevents hotlinking of profile pics)
```

---

## 9. Admin Management Flow

### 9.1 Global Admin Bootstrap

Global admins are configured via the `ADMIN_EMAILS` environment variable (comma-separated). On first login, if the user's email matches `ADMIN_EMAILS`, their role is set to `admin` instead of `pending`.

### 9.2 Admin Capabilities

- **View all users**: See email, name, role, address, agreement status
- **Change roles**: Set any user to `pending`, `member`, `contributor`, or `admin`
- **View audit log**: All role changes and admin actions are logged

### 9.3 Admin UI

Add an admin page at `public/members/admin.html` (only rendered if session.role === 'admin'). The page shows:
- User table with role dropdowns
- Audit log view
- The client-side JS checks `window.__wrSession.role === 'admin'` to show/hide admin nav link
- API endpoints verify admin role server-side regardless of what the client sends

---

## 10. Agreement Screen Flow

### 10.1 Flow

```
1. User logs in for the first time via Google OAuth
2. D1 user record has agreement_signed_at = NULL
3. Worker detects this, redirects to /members/agreement.html
4. Page displays the full HOA membership agreement text
5. User must:
   a. Scroll through (or at minimum see) the agreement
   b. Check a checkbox: "I have read and agree to the terms"
   c. Type their full legal name in a text field
   d. Click "I Agree"
6. Client sends POST /api/agreement with:
   { fullName: "John Doe", agreedAt: "2026-04-10T12:00:00Z", version: "1.0" }
7. Worker validates session, updates D1:
   UPDATE users SET agreement_signed_at = ?, agreement_version = ? WHERE id = ?
8. Updates KV session to set agreementSigned = true
9. Redirects to /members/ (or the originally-intended protected page)
```

### 10.2 Agreement Page Design

The agreement page should:
- Match the existing Thoreau/nature aesthetic of the site
- Display the agreement in a scrollable container
- Have the submit button disabled until the checkbox is checked and name is entered
- Store the agreement version so future agreement changes can require re-signing
- NOT be bypassable (no way to reach /members/* without signing)

---

## 11. Frontend Page Details

### 11.1 Login Page (`public/login.html`)

- Matches site design (Cormorant Garamond headings, Inter body, earth tones)
- "Welcome to the Members Area" heading
- Google Sign-In button (styled to match site, not Google's default branding)
- Brief description of what members get access to
- Links back to public homepage
- Reads `?redirect=` param and passes it to `/auth/google?redirect=...`

### 11.2 Members Dashboard (`public/members/index.html`)

- Welcome message with user name
- Quick links: Edit Profile, My Dogs, Neighbor Dogs, Governance
- If admin: link to Admin panel
- Navigation includes both public site links and members links

### 11.3 Profile Page (`public/members/profile.html`)

- Profile picture upload (circular preview, click-to-change)
- Display name (pre-filled from Google)
- Address dropdown: SELECT populated from GET /api/addresses
  - Shows: "Lot 1 — 423 Brindle Road" format
  - One address per user (optional, nullable)
- Anonymity toggle: checkbox "Keep my profile private"
  - When checked: name/photo not shown on directory
- Save button -> PUT /api/profile

### 11.4 Dogs Page (`public/members/dogs.html`)

- List of user's dogs (cards with photo, name, breed, age)
- "Add Dog" button (disabled if already at 5)
- Each card has Edit/Delete buttons
- Add/Edit form: name (required), breed, age, description, photo upload
- Photo preview with remove option

### 11.5 Directory Page (`public/members/directory.html`)

- Grid of neighbor dog cards fetched from GET /api/directory/dogs
- Each card: photo, dog name, owner name (if not anonymous), address (if not anonymous)
- Search/filter by breed or name (client-side)

### 11.6 Navigation Updates

Add a "Members" link to the nav in ALL pages (public and members). The nav in `public/index.html` and `governance.html` etc. should include:

```html
<li><a href="/members/">Members</a></li>
```

On members pages, expand the nav to include:
```html
<li><a href="/members/">Dashboard</a></li>
<li><a href="/members/profile.html">Profile</a></li>
<li><a href="/members/dogs.html">My Dogs</a></li>
<li><a href="/members/directory.html">Neighbor Dogs</a></li>
<li><a href="/governance.html">Governance</a></li>
```

---

## 12. Implementation Sequence

### Phase 1: Infrastructure & Auth (do first)
1. Create D1 database, KV namespace, R2 bucket via wrangler CLI
2. Update wrangler.toml with bindings
3. Run schema.sql and seed-addresses.sql against D1
4. Implement `src/session.js` (getSession, createSession, deleteSession)
5. Implement `src/auth.js` (Google OAuth flow)
6. Create `public/login.html`
7. Add route protection logic to `src/worker.js`
8. Test: can login, get session, get redirected on protected pages

### Phase 2: Agreement & Profile
9. Create `public/members/agreement.html` with agreement text
10. Implement POST `/api/agreement` endpoint
11. Create `public/members/profile.html`
12. Implement GET/PUT `/api/profile` and GET `/api/addresses`
13. Implement image upload: `src/upload.js`, POST `/api/profile/picture`
14. Add `/uploads/*` serving route

### Phase 3: Dogs
15. Create `public/members/dogs.html`
16. Implement CRUD: GET/POST/PUT/DELETE `/api/dogs`
17. Implement dog photo upload: POST `/api/dogs/:id/photo`
18. Create `public/members/directory.html`
19. Implement GET `/api/directory/dogs` and `/api/directory/members`

### Phase 4: Admin
20. Create `public/members/admin.html`
21. Implement GET `/api/admin/users`, PUT `/api/admin/users/:id/role`
22. Implement GET `/api/admin/audit-log`
23. Add admin-email bootstrap logic to auth flow

### Phase 5: Polish & Deploy
24. Add "Members" nav link to all existing public pages
25. Create `public/members/members.css` matching site aesthetic
26. Create `public/members/members.js` with all client-side logic
27. Test on beta environment
28. Deploy to production

---

## 13. Security Considerations

- **Session cookies**: HttpOnly, Secure, SameSite=Lax — not accessible from JS
- **CSRF**: For state-changing API calls, validate Origin header matches the site
- **R2 keys**: Include userId in path to prevent enumeration
- **Image validation**: Check magic bytes, not just Content-Type header
- **Rate limiting**: Consider Cloudflare rate limiting rules for auth endpoints
- **SQL injection**: Always use D1 prepared statements with .bind()
- **Role checks**: Every admin API endpoint validates role server-side
- **Agreement enforcement**: Checked on every protected page load, not just once

---

## 14. Key Technical Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Server-side OAuth (not PKCE) | Worker holds client secret securely; simpler flow |
| KV for sessions (not D1) | KV has built-in TTL, globally replicated, fast reads |
| Direct R2 upload (not presigned) | Simpler code, no aws4fetch dependency, images are small |
| HTMLRewriter session injection | Matches existing pattern (BodyEndRewriter), avoids extra API call on page load |
| Vanilla JS (no framework) | Matches existing site architecture; keeps bundle size zero |
| Separate SQL files | Can run migrations with wrangler d1 execute; version-controlled |
| ADMIN_EMAILS env var | Simple bootstrap mechanism; no chicken-and-egg problem |

