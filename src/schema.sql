-- Walden's Revisited Members Database Schema

-- 25 fixed neighborhood addresses
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY,
  tract_lot TEXT NOT NULL,
  street_address TEXT NOT NULL,
  full_label TEXT NOT NULL
);

-- Users (created on Google OAuth login)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  google_picture TEXT,
  profile_picture TEXT,
  address_id INTEGER REFERENCES addresses(id),
  is_anonymous INTEGER DEFAULT 0,
  role TEXT DEFAULT 'pending',
  roles TEXT DEFAULT 'pending',
  avatar_id INTEGER,
  owner_type TEXT DEFAULT 'natural',
  is_authorized_agent INTEGER DEFAULT 0,
  agent_for_entity TEXT,
  pre_registered INTEGER DEFAULT 0,
  pre_registered_email TEXT,
  profile_confirmed INTEGER DEFAULT 0,
  agreement_signed_at TEXT,
  agreement_ip TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Dog profiles (max 5 per user, enforced in application)
CREATE TABLE IF NOT EXISTS dogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  breed TEXT,
  age TEXT,
  bio TEXT,
  picture TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Community wall posts
-- Posts from officers/admins/contributors are auto-approved (approved=1)
-- Posts from regular members require approval by officer/admin/contributor
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  image TEXT,
  approved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Surveys created by officers/contributors
CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  options TEXT NOT NULL,            -- JSON array of option strings
  is_active INTEGER DEFAULT 1,
  allow_multiple INTEGER DEFAULT 0, -- allow selecting multiple options
  created_at TEXT DEFAULT (datetime('now')),
  closes_at TEXT                    -- optional close date
);

-- Survey responses
CREATE TABLE IF NOT EXISTS survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  selected_option INTEGER NOT NULL, -- index into options array
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(survey_id, user_id, selected_option)
);

-- Comments on posts
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Properties / parcels in the neighborhood
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address_id INTEGER NOT NULL REFERENCES addresses(id),
  parcel_number TEXT,
  acres REAL,
  wr_designation TEXT,
  owner_name TEXT NOT NULL,
  owner_type TEXT DEFAULT 'natural',
  transfer_type TEXT,
  provenance TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Audit log for admin actions
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_user_id INTEGER,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_dogs_user_id ON dogs(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_approved ON posts(approved);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_log(admin_user_id);

-- Seed 25 neighborhood addresses
INSERT OR IGNORE INTO addresses (id, tract_lot, street_address, full_label) VALUES
  (1,  'Lot 1',       '423 Brindle Road',   'Lot 1 — 423 Brindle Road'),
  (2,  'Lot 2/3',     '427 Brindle Road',   'Lot 2/3 — 427 Brindle Road'),
  (3,  'Lot 4',       '431 Brindle Road',   'Lot 4 — 431 Brindle Road'),
  (4,  'Tract 1',     '475 Brindle Road',   'Tract 1 — 475 Brindle Road'),
  (5,  'Tract 3',     '505 Brindle Road',   'Tract 3 — 505 Brindle Road'),
  (6,  'Tract 4',     '541 Brindle Road',   'Tract 4 — 541 Brindle Road'),
  (7,  'Tract 5',     'Brindle Road',       'Tract 5 — Brindle Road'),
  (8,  'Tract 6',     'Brindle Road',       'Tract 6 — Brindle Road'),
  (9,  'Tract 7',     'Brindle Road',       'Tract 7 — Brindle Road'),
  (10, 'Tract 8',     '623 Brindle Road',   'Tract 8 — 623 Brindle Road'),
  (11, 'Tract 9',     '661 Brindle Road',   'Tract 9 — 661 Brindle Road'),
  (12, 'Tract 10/11', '675 Brindle Road',   'Tract 10/11 — 675 Brindle Road'),
  (13, 'Tract 12',    '6810 Houseman Road', 'Tract 12 — 6810 Houseman Road'),
  (14, 'Tract 13',    '6724 Houseman Road', 'Tract 13 — 6724 Houseman Road'),
  (15, 'Tract 14',    '6720 Houseman Road', 'Tract 14 — 6720 Houseman Road'),
  (16, 'Tract 15',    'Houseman Road',      'Tract 15 — Houseman Road'),
  (17, 'Tract 20',    '7070 Slocum Road',   'Tract 20 — 7070 Slocum Road'),
  (18, 'Tract 21',    '7058 Slocum Road',   'Tract 21 — 7058 Slocum Road'),
  (19, 'Tract 22',    '554 Brindle Road',   'Tract 22 — 554 Brindle Road'),
  (20, 'Tract 23',    '510 Brindle Road',   'Tract 23 — 510 Brindle Road'),
  (21, 'Tract 24',    '494 Brindle Road',   'Tract 24 — 494 Brindle Road'),
  (22, 'Tract 25',    '480 Brindle Road',   'Tract 25 — 480 Brindle Road'),
  (23, 'Tract 26',    '440 Brindle Road',   'Tract 26 — 440 Brindle Road'),
  (24, 'Tract 27',    '420 Brindle Road',   'Tract 27 — 420 Brindle Road'),
  (25, 'Tract 16',    'Houseman Road',      'Tract 16 — Houseman Road');
