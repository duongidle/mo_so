-- M4: khách hàng dùng chung toàn hệ thống

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,                         -- đã chuẩn hoá 0xxxxxxxxx
  phone2 TEXT,
  email TEXT,
  facebook_url TEXT,
  shopee_username TEXT,
  gender TEXT CHECK (gender IN ('male','female','other') OR gender IS NULL),
  birth_date TEXT,                    -- YYYY-MM-DD dương lịch
  birth_year INTEGER,                 -- khi chỉ biết năm
  element_override TEXT,              -- mệnh ghi đè tay
  address TEXT,
  note TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  source_channel TEXT,                -- kênh mua lần đầu
  first_order_at TEXT,
  last_order_at TEXT,
  order_count INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0, -- tổng doanh thu thuần (sau hoàn) từ khách, mọi shop
  merged_into TEXT REFERENCES customers(id),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_customers_phone ON customers(phone) WHERE phone IS NOT NULL AND merged_into IS NULL;
CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_last_order ON customers(last_order_at);

CREATE TABLE customer_notes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  shop_id TEXT REFERENCES shops(id),
  content TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_customer_notes_customer ON customer_notes(customer_id);
