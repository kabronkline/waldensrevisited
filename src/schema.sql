-- Walden's Revisited Members Database Schema

-- 25 fixed neighborhood addresses
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY,
  tract_lot TEXT NOT NULL,
  street_address TEXT NOT NULL,
  full_address TEXT,
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
  show_name INTEGER DEFAULT 1,
  show_contact INTEGER DEFAULT 1,
  role TEXT DEFAULT 'pending',
  roles TEXT DEFAULT 'pending',
  avatar_id INTEGER,
  owner_type TEXT DEFAULT 'natural',
  is_authorized_agent INTEGER DEFAULT 0,
  agent_for_entity TEXT,
  pre_registered INTEGER DEFAULT 0,
  pre_registered_email TEXT,
  profile_confirmed INTEGER DEFAULT 0,
  birthday TEXT,
  agreement_signed_at TEXT,
  agreement_ip TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Dog profiles (max 5 per user, enforced in application)
CREATE TABLE IF NOT EXISTS dogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address_id INTEGER REFERENCES addresses(id),
  name TEXT NOT NULL,
  breed TEXT,
  age TEXT,
  birthday TEXT,
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
  visibility TEXT DEFAULT 'everybody',
  allow_comments INTEGER DEFAULT 1,
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

-- Play date matching
CREATE TABLE IF NOT EXISTS playdate_dogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dog_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tagline TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(dog_id)
);

CREATE TABLE IF NOT EXISTS playdate_swipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_dog_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
  to_dog_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(from_dog_id, to_dog_id)
);

CREATE TABLE IF NOT EXISTS playdate_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dog_a_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
  dog_b_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playdate_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES playdate_matches(id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Friend requests and friendships
CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(from_user_id, to_user_id)
);

CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT DEFAULT 'friend',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Unified chat system (friend + playdate threads)
CREATE TABLE IF NOT EXISTS chat_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  ref_id INTEGER,
  user_a_id INTEGER NOT NULL,
  user_b_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Chat participants (for group chats like officer threads)
CREATE TABLE IF NOT EXISTS chat_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT DEFAULT (datetime('now')),
  last_read_at TEXT,
  UNIQUE(thread_id, user_id)
);

-- Address change requests (require officer/admin approval)
CREATE TABLE IF NOT EXISTS address_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_address_id INTEGER NOT NULL REFERENCES addresses(id),
  current_address_id INTEGER,
  status TEXT DEFAULT 'pending',
  reviewed_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Content reports (user-reported posts and chat messages)
CREATE TABLE IF NOT EXISTS content_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id),
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  reviewed_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Content edit history (posts and comments, max 5 versions retained)
CREATE TABLE IF NOT EXISTS content_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  previous_content TEXT NOT NULL,
  edited_by_user_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
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
INSERT OR IGNORE INTO addresses (id, tract_lot, street_address, full_address, full_label) VALUES
  (1,  'Lot 1',       '423 Brindle Road',   '423 Brindle Road, Ostrander, OH 43061',   'Lot 1 — 423 Brindle Road'),
  (2,  'Lot 2/3',     '427 Brindle Road',   '427 Brindle Road, Ostrander, OH 43061',   'Lot 2/3 — 427 Brindle Road'),
  (3,  'Lot 4',       '431 Brindle Road',   '431 Brindle Road, Ostrander, OH 43061',   'Lot 4 — 431 Brindle Road'),
  (4,  'Tract 1',     '475 Brindle Road',   '475 Brindle Road, Ostrander, OH 43061',   'Tract 1 — 475 Brindle Road'),
  (5,  'Tract 3',     '505 Brindle Road',   '505 Brindle Road, Ostrander, OH 43061',   'Tract 3 — 505 Brindle Road'),
  (6,  'Tract 4',     '541 Brindle Road',   '541 Brindle Road, Ostrander, OH 43061',   'Tract 4 — 541 Brindle Road'),
  (7,  'Tract 5',     '563 Brindle Rd',     '563 Brindle Road, Ostrander, OH 43061',   'Tract 5 — 563 Brindle Rd'),
  (8,  'Tract 6',     '561 Brindle Rd',     '561 Brindle Road, Ostrander, OH 43061',   'Tract 6 — 561 Brindle Rd'),
  (9,  'Tract 7',     '585 Brindle Rd',     '585 Brindle Road, Ostrander, OH 43061',   'Tract 7 — 585 Brindle Rd'),
  (10, 'Tract 8',     '623 Brindle Road',   '623 Brindle Road, Ostrander, OH 43061',   'Tract 8 — 623 Brindle Road'),
  (11, 'Tract 9',     '661 Brindle Road',   '661 Brindle Road, Ostrander, OH 43061',   'Tract 9 — 661 Brindle Road'),
  (12, 'Tract 10/11', '675 Brindle Road',   '675 Brindle Road, Ostrander, OH 43061',   'Tract 10/11 — 675 Brindle Road'),
  (13, 'Tract 12',    '6810 Houseman Road', '6810 Houseman Road, Ostrander, OH 43061', 'Tract 12 — 6810 Houseman Road'),
  (14, 'Tract 13',    '6724 Houseman Road', '6724 Houseman Road, Ostrander, OH 43061', 'Tract 13 — 6724 Houseman Road'),
  (15, 'Tract 14',    '6720 Houseman Road', '6720 Houseman Road, Ostrander, OH 43061', 'Tract 14 — 6720 Houseman Road'),
  (16, 'Tract 15',    '6670 Houseman Rd',   '6670 Houseman Road, Ostrander, OH 43061', 'Tract 15 — 6670 Houseman Rd'),
  (17, 'Tract 20',    '7070 Slocum Road',   '7070 Slocum Road, Ostrander, OH 43061',   'Tract 20 — 7070 Slocum Road'),
  (18, 'Tract 21',    '7058 Slocum Road',   '7058 Slocum Road, Ostrander, OH 43061',   'Tract 21 — 7058 Slocum Road'),
  (19, 'Tract 22',    '554 Brindle Road',   '554 Brindle Road, Ostrander, OH 43061',   'Tract 22 — 554 Brindle Road'),
  (20, 'Tract 23',    '510 Brindle Road',   '510 Brindle Road, Ostrander, OH 43061',   'Tract 23 — 510 Brindle Road'),
  (21, 'Tract 24',    '494 Brindle Road',   '494 Brindle Road, Ostrander, OH 43061',   'Tract 24 — 494 Brindle Road'),
  (22, 'Tract 25',    '480 Brindle Road',   '480 Brindle Road, Ostrander, OH 43061',   'Tract 25 — 480 Brindle Road'),
  (23, 'Tract 26',    '440 Brindle Road',   '440 Brindle Road, Ostrander, OH 43061',   'Tract 26 — 440 Brindle Road'),
  (24, 'Tract 27',    '420 Brindle Road',   '420 Brindle Road, Ostrander, OH 43061',   'Tract 27 — 420 Brindle Road'),
  (25, 'Tract 16',    'Houseman Road',      'Houseman Road, Ostrander, OH 43061',      'Tract 16 — Houseman Road'),
  (26, 'Tract 2',     '497 Brindle Rd',     '497 Brindle Road, Ostrander, OH 43061',   'Tract 2 — 497 Brindle Rd');
