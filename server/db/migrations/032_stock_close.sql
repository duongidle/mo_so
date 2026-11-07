-- Chốt kỳ kho: ngày chốt khoá mọi biến động kho có ngày ≤ ngày chốt; mỗi lần chốt chụp tồn từng kho × biến thể.
CREATE TABLE stock_closes (
  id TEXT PRIMARY KEY,
  close_date TEXT NOT NULL,          -- chốt đến hết ngày này (giờ VN)
  taken_at TEXT NOT NULL,
  actor_id TEXT,
  note TEXT,
  line_count INTEGER NOT NULL,
  total_qty REAL NOT NULL,
  total_value INTEGER NOT NULL,      -- Σ SL × giá vốn của các biến động đến ngày chốt (theo sổ kho)
  hash TEXT NOT NULL,                -- băm các dòng, để phát hiện thay đổi sau chốt
  reopened_at TEXT,                  -- mở lại (lùi ngày chốt về trước ngày này)
  reopen_reason TEXT
);
CREATE TABLE stock_close_lines (
  close_id TEXT NOT NULL REFERENCES stock_closes(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  qty REAL NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (close_id, warehouse_id, variant_id)
);
CREATE INDEX idx_stock_closes_date ON stock_closes(close_date);
