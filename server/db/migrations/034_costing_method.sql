-- Phương pháp tính giá vốn: mặc định bình quân gia quyền di động (settings.costing_method = 'average').
-- Chọn 'fifo' thì mỗi lần nhập tạo một lớp giá (stock_layers), xuất lấy từ lớp cũ nhất. Chỉ có dữ liệu khi đang dùng FIFO.
CREATE TABLE stock_layers (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  qty REAL NOT NULL,                 -- còn lại của lớp này
  unit_cost INTEGER NOT NULL,
  received_at TEXT NOT NULL,         -- thứ tự FIFO theo thời điểm này, rồi theo rowid
  ref_type TEXT,
  ref_id TEXT,
  ref_line_id TEXT
);
CREATE INDEX idx_stock_layers_lv ON stock_layers(warehouse_id, variant_id, received_at);
CREATE INDEX idx_stock_layers_ref ON stock_layers(ref_id, ref_line_id);
