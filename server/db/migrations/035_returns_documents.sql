-- Lý do trả hàng có mã (thống kê được); phiếu hàng huỷ khi hàng trả về bị hỏng không nhập lại kho.
ALTER TABLE order_returns ADD COLUMN reason_code TEXT;

CREATE TABLE return_write_offs (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,         -- HH-<shop>-<ngày>-001
  return_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  shop_id TEXT NOT NULL REFERENCES shops(id),
  warehouse_id TEXT,
  lines TEXT NOT NULL,               -- JSON [{order_line_id, variant_id, sku, qty, unit_cost}]
  total_cost INTEGER NOT NULL,       -- Σ SL × giá vốn đã chụp. Chỉ để tra cứu: giá vốn này vẫn nằm trong giá vốn của đơn (không hoàn)
  reason TEXT,
  created_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  actor_id TEXT
);
CREATE INDEX idx_write_offs_return ON return_write_offs(return_id);
CREATE INDEX idx_write_offs_date ON return_write_offs(business_date);
