-- M7: chi phí

CREATE TABLE expense_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT
);
INSERT INTO expense_categories (id, name, sort_order) VALUES
  ('ecat_ads', 'Quảng cáo', 1),
  ('ecat_platform', 'Phí sàn ngoài đơn', 2),
  ('ecat_shipping', 'Vận chuyển', 3),
  ('ecat_packaging', 'Bao bì, đóng gói', 4),
  ('ecat_rent', 'Mặt bằng, điện nước', 5),
  ('ecat_other', 'Khác', 9);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  shop_id TEXT REFERENCES shops(id),          -- NULL = chi phí chung, phân bổ khi báo cáo
  channel_id TEXT REFERENCES channels(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  expense_date TEXT NOT NULL,                 -- ngày phát sinh (giờ VN)
  payee TEXT,
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  voided_at TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_shop ON expenses(shop_id, expense_date);
