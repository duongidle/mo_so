-- Sổ tài khoản (cơ sở dữ liệu chung). Mỗi tài khoản có MỘT file cơ sở dữ liệu riêng chứa toàn bộ shop, kho,
-- sản phẩm, khách, đơn của tài khoản đó. Sổ này chỉ biết "ai là ai" và "dữ liệu của họ nằm ở file nào".

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,         -- chữ thường
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  db_file TEXT NOT NULL UNIQUE,          -- đường dẫn tương đối trong thư mục dữ liệu
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                   -- hash của token
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_account ON sessions(account_id);

-- Để biết một API key thuộc tài khoản nào mà không phải mở mọi file dữ liệu. Key thật (đã băm, có thể thu hồi) nằm trong file của tài khoản.
CREATE TABLE api_key_index (
  key_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id)
);
