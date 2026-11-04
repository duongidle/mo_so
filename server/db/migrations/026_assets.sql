-- Kế toán 8b (2/2): tài sản cố định, chi phí trả trước, mốc làm mới khấu hao.
-- Bút toán mua / khấu hao hằng tháng / thanh lý là DẪN XUẤT (source_type = 'asset'), sinh lại khi tài sản đổi hoặc khi sang ngày mới.

CREATE TABLE assets (
  id TEXT PRIMARY KEY,                    -- ast_…
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed_asset','prepaid')),
  cost INTEGER NOT NULL CHECK (cost > 0),
  start_date TEXT NOT NULL,               -- ngày mua; kỳ khấu hao đầu tiên là tháng của ngày này
  months INTEGER NOT NULL CHECK (months BETWEEN 1 AND 600),
  account_code TEXT NOT NULL REFERENCES accounts(code),          -- 211 | 242
  expense_account_code TEXT NOT NULL REFERENCES accounts(code),  -- 641x | 642x nhận chi phí khấu hao/phân bổ
  shop_id TEXT REFERENCES shops(id),
  paid_via TEXT NOT NULL DEFAULT 'cash',  -- phương thức thanh toán, hoặc 'unpaid' = ghi phải trả người bán 331
  note TEXT,
  disposed_at TEXT,
  voided_at TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Mốc làm mới: khấu hao phụ thuộc "hôm nay" nên khi qua ngày, mọi tài sản được đánh dấu bẩn một lần (journal.js)
CREATE TABLE journal_meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TRIGGER assets_gl_ai AFTER INSERT ON assets BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('asset', NEW.id);
END;
CREATE TRIGGER assets_gl_au AFTER UPDATE ON assets BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('asset', NEW.id);
END;
CREATE TRIGGER assets_gl_ad AFTER DELETE ON assets BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('asset', OLD.id);
END;
-- Đổi ánh xạ phương thức → quỹ làm đổi tài khoản tiền của khoản mua tài sản
CREATE TRIGGER cash_accounts_gl_map_assets AFTER UPDATE ON cash_accounts
  WHEN OLD.methods IS NOT NEW.methods OR OLD.opening_date IS NOT NEW.opening_date OR (OLD.account_code IS NOT NULL AND OLD.account_code IS NOT NEW.account_code) OR OLD.archived_at IS NOT NEW.archived_at BEGIN
  INSERT OR IGNORE INTO journal_dirty SELECT 'asset', id FROM assets;
END;

-- Ảnh chụp số liệu kỳ đã khoá sổ, để cảnh báo khi đơn/phiếu nhập làm đổi số sau khoá
CREATE TABLE period_lock_snapshots (
  lock_date TEXT PRIMARY KEY,
  taken_at TEXT NOT NULL,
  hash TEXT NOT NULL,
  balances TEXT NOT NULL                  -- JSON { mã tài khoản: số dư ròng (Nợ − Có) đến ngày khoá }
);
