-- Phiếu đóng gói / chuyển đổi hàng (DG-…): xuất hàng nguồn (kg, bao bì), nhập thành phẩm (hộp) trong một giao dịch.
-- Biến động kho dùng lại loại transfer_out / transfer_in với ref_type = 'conversion' (không bút toán: 156 chuyển từ mã này sang mã khác, không lãi lỗ).
-- Chỉ THÊM bảng/cột.
CREATE TABLE stock_conversions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                    -- DG-00001
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  shop_id TEXT,
  note TEXT,
  source_value INTEGER NOT NULL DEFAULT 0,      -- Σ giá trị xuất thật (bình quân hoặc từng lớp FIFO)
  output_value INTEGER NOT NULL DEFAULT 0,      -- Σ giá trị nhập; luôn bằng source_value
  converted_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT,
  voided_by TEXT
);
CREATE INDEX idx_stock_conversions_date ON stock_conversions(business_date);

CREATE TABLE stock_conversion_lines (
  id TEXT PRIMARY KEY,
  conversion_id TEXT NOT NULL REFERENCES stock_conversions(id),
  side TEXT NOT NULL CHECK (side IN ('source','output')),
  position INTEGER NOT NULL DEFAULT 0,
  variant_id TEXT NOT NULL,
  qty REAL NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,            -- source: giá trị xuất; output: phần giá trị nhận được (Σ = source_value)
  unit_cost INTEGER NOT NULL DEFAULT 0,         -- đơn giá trung bình hiển thị = round(amount / qty)
  weight REAL,                                  -- output: trọng số chia giá vốn
  norm_qty REAL,                                -- source: định mức theo công thức "đóng từ" lúc lập phiếu (null = không có định mức)
  lot_no TEXT,                                  -- output: lô của thành phẩm
  expiry_date TEXT,                             -- output: hạn dùng của thành phẩm
  slices TEXT,                                  -- JSON các phần: source = các phần xuất [{qty, unitCost, receivedAt}]; output = hai phần nhập [{qty, unitCost}]
  lots TEXT                                     -- JSON source: lô đã rút, để huỷ phiếu đưa lại đúng lô
);
CREATE INDEX idx_conv_lines_conv ON stock_conversion_lines(conversion_id);

-- Công thức "đóng từ": 1 đơn vị thành phẩm cần bao nhiêu hàng nguồn (bao bì lấy từ packaging_specs của sản phẩm). Chỉ để gợi ý.
CREATE TABLE conversion_recipes (
  variant_id TEXT PRIMARY KEY REFERENCES variants(id),   -- thành phẩm
  source_variant_id TEXT NOT NULL REFERENCES variants(id),
  qty_per_unit REAL NOT NULL,
  updated_at TEXT NOT NULL
);

-- Lý do xuất huỷ có mã (phiếu cũ không có mã = 'other')
ALTER TABLE stock_adjustments ADD COLUMN reason_code TEXT;
