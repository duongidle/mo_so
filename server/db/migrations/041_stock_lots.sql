-- Lô hàng và hạn dùng. Sổ phụ của sổ kho: chỉ hàng nhập có ghi lô/hạn mới có dòng ở đây; hàng xuất ưu tiên lô hết hạn trước (FEFO).
ALTER TABLE purchase_lines ADD COLUMN lot_no TEXT;
ALTER TABLE purchase_lines ADD COLUMN expiry_date TEXT;   -- YYYY-MM-DD

CREATE TABLE stock_lots (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  variant_id TEXT NOT NULL REFERENCES variants(id),
  lot_no TEXT,
  expiry_date TEXT,
  qty REAL NOT NULL,                 -- còn lại
  received_at TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  ref_line_id TEXT
);
CREATE INDEX idx_stock_lots_lv ON stock_lots(warehouse_id, variant_id, expiry_date);
CREATE INDEX idx_stock_lots_expiry ON stock_lots(expiry_date);
