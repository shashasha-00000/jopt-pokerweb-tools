-- FAQ imports are immutable drafts. Only explicit deployment pointers enable replies.
CREATE TABLE IF NOT EXISTS faq_releases (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES line_accounts(id),
  content_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  validation TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, content_hash)
);
CREATE TABLE IF NOT EXISTS faq_deployments (
  account_id TEXT NOT NULL REFERENCES line_accounts(id),
  audience TEXT NOT NULL CHECK(audience IN ('test','production')),
  release_id TEXT NOT NULL REFERENCES faq_releases(id),
  test_friend_ids TEXT NOT NULL DEFAULT '[]',
  test_open INTEGER NOT NULL DEFAULT 0 CHECK(test_open IN (0,1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(account_id, audience)
);
CREATE TABLE IF NOT EXISTS faq_release_audit (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, release_id TEXT,
  action TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS faq_sessions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, friend_id TEXT NOT NULL,
  release_id TEXT NOT NULL, audience TEXT NOT NULL,
  node_id TEXT NOT NULL DEFAULT 'root', event_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'browsing' CHECK(outcome IN ('browsing','answered','redirected','handoff','resolved')),
  preserve_unread INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_faq_sessions_pending ON faq_sessions(account_id,friend_id,outcome);
CREATE TABLE IF NOT EXISTS faq_webhook_receipts (
  account_id TEXT NOT NULL, event_id TEXT NOT NULL, state TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY(account_id,event_id)
);
