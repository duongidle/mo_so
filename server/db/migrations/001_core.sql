-- M0 + M1: nền tảng, xác thực, shop, kho, kênh, sự kiện

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,           -- JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','staff')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- hash của token
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,          -- vài ký tự đầu để nhận diện
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '["read","write"]',
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE warehouses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  note TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,     -- vd NH, PT; dùng làm tiền tố mã chứng từ
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,                    -- màu nhận diện trên UI
  default_warehouse_id TEXT REFERENCES warehouses(id),
  phone TEXT,
  address TEXT,
  receipt_footer TEXT,           -- dòng chữ cuối phiếu bán hàng
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,           -- 'shopee','facebook','direct','other' hoặc ch_…
  name TEXT NOT NULL,
  is_marketplace INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT
);
INSERT INTO channels (id, name, is_marketplace, sort_order) VALUES
  ('direct', 'Bán trực tiếp', 0, 1),
  ('facebook', 'Facebook', 0, 2),
  ('shopee', 'Shopee', 1, 3),
  ('other', 'Khác', 0, 9);

CREATE TABLE sequences (
  name TEXT PRIMARY KEY,         -- vd 'order:NH:261103'
  value INTEGER NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  shop_id TEXT,
  payload TEXT NOT NULL,         -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_created ON events(created_at);
CREATE INDEX idx_events_entity ON events(entity_type, entity_id);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,      -- user | api_key | system
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before TEXT,
  after TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  response TEXT NOT NULL,
  status INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  event_types TEXT NOT NULL,     -- JSON mảng; ["*"] = tất cả
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_status_code INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_deliveries_due ON webhook_deliveries(status, next_attempt_at);
