-- Quỹ tiền: két tiền mặt, tài khoản ngân hàng, ví…
-- Số dư = số dư đầu + tiền thu − tiền chi (payments và chi phí theo phương thức gán cho quỹ) + chuyển quỹ + điều chỉnh kiểm đếm.
-- Không lưu số dư: luôn tính từ sổ nên không thể lệch với thu chi.
CREATE TABLE cash_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'cash' CHECK (kind IN ('cash','bank','ewallet','other')),
  methods TEXT NOT NULL DEFAULT '[]',          -- các phương thức thanh toán đổ vào quỹ này (mỗi phương thức chỉ thuộc một quỹ)
  opening_balance INTEGER NOT NULL DEFAULT 0,  -- số dư tại đầu ngày opening_date
  opening_date TEXT,                           -- NULL = tính từ toàn bộ lịch sử
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Chuyển quỹ (2 dòng cùng pair_id) và điều chỉnh sau kiểm đếm. amount có dấu: + làm tăng số dư quỹ.
CREATE TABLE cash_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cash_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('transfer','adjust')),
  amount INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  pair_id TEXT,
  note TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  voided_at TEXT
);
CREATE INDEX idx_cash_entries_account ON cash_entries(account_id, entry_date);

INSERT INTO cash_accounts (id, name, kind, methods, sort_order, created_at, updated_at) VALUES
  ('cac_cash', 'Tiền mặt', 'cash', '["cash","cod"]', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cac_bank', 'Ngân hàng', 'bank', '["bank","shopee_payout","card","ewallet","other"]', 2, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
