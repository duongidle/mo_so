-- Phiếu kiểm kê nhiều bước: tạo phiếu (chụp tồn hệ thống) → nhập số đếm dần → hoàn tất (sinh điều chỉnh theo chênh lệch)

CREATE TABLE stock_counts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed','cancelled')),
  note TEXT,
  adjustment_id TEXT REFERENCES stock_adjustments(id),   -- phiếu điều chỉnh sinh ra khi hoàn tất
  actor_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT
);

CREATE TABLE stock_count_lines (
  id TEXT PRIMARY KEY,
  count_id TEXT NOT NULL REFERENCES stock_counts(id),
  variant_id TEXT NOT NULL REFERENCES variants(id),
  system_qty INTEGER NOT NULL,        -- tồn hệ thống lúc thêm vào phiếu
  counted_qty INTEGER,                -- số đếm thực tế; NULL = chưa đếm
  unit_cost INTEGER,                  -- giá vốn cho hàng nhập vào kho lần đầu (khi chưa có giá vốn)
  note TEXT,
  applied_change INTEGER,             -- chênh lệch đã áp khi hoàn tất
  UNIQUE (count_id, variant_id)
);
CREATE INDEX idx_stock_count_lines_count ON stock_count_lines(count_id);
