-- M3: tồn kho, sổ cái kho, nhập hàng, thanh toán

CREATE TABLE stock_levels (
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  variant_id TEXT NOT NULL REFERENCES variants(id),
  on_hand INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  avg_cost INTEGER NOT NULL DEFAULT 0,      -- giá vốn bình quân / đơn vị (VND)
  last_in_at TEXT,
  last_out_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (warehouse_id, variant_id)
);
CREATE INDEX idx_stock_variant ON stock_levels(variant_id);

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  variant_id TEXT NOT NULL REFERENCES variants(id),
  type TEXT NOT NULL CHECK (type IN (
    'opening','purchase_in','purchase_cancel_out','sale_out','sale_cancel_in','sale_return_in',
    'adjust_in','adjust_out','damage_out','transfer_out','transfer_in')),
  qty INTEGER NOT NULL,                      -- có dấu: + vào kho, − ra kho
  unit_cost INTEGER NOT NULL,                -- giá vốn / đơn vị của biến động này
  balance_after INTEGER NOT NULL,
  avg_cost_after INTEGER NOT NULL,
  ref_type TEXT,                             -- order | purchase | adjustment | transfer
  ref_id TEXT,
  ref_line_id TEXT,
  shop_id TEXT,
  note TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  business_date TEXT NOT NULL
);
CREATE INDEX idx_movements_variant ON stock_movements(variant_id, created_at);
CREATE INDEX idx_movements_ref ON stock_movements(ref_type, ref_id);
CREATE INDEX idx_movements_date ON stock_movements(business_date);

CREATE TABLE stock_adjustments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  kind TEXT NOT NULL CHECK (kind IN ('opening','count','adjust','damage')),
  reason TEXT,
  lines TEXT NOT NULL,                       -- JSON: [{variant_id, before, after, change, unit_cost}]
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE stock_transfers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  from_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  lines TEXT NOT NULL,                       -- JSON: [{variant_id, qty, unit_cost}]
  note TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  note TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  supplier_id TEXT REFERENCES suppliers(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  shop_id TEXT REFERENCES shops(id),        -- nhập cho shop nào (tuỳ chọn, để báo cáo)
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','received','cancelled')),
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  shipping_fee INTEGER NOT NULL DEFAULT 0,
  other_fee INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  supplier_ref TEXT,                         -- số hoá đơn / chứng từ của NCC
  ordered_at TEXT NOT NULL,
  received_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX idx_purchases_status ON purchases(status);

CREATE TABLE purchase_lines (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  variant_id TEXT NOT NULL REFERENCES variants(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost INTEGER NOT NULL,                -- giá nhập trên chứng từ
  line_total INTEGER NOT NULL,
  allocated_cost INTEGER NOT NULL DEFAULT 0, -- phí ship/khác − chiết khấu phân bổ vào dòng
  landed_unit_cost INTEGER NOT NULL DEFAULT 0, -- giá vốn thực / đơn vị sau phân bổ
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_purchase_lines_purchase ON purchase_lines(purchase_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),  -- in: thu tiền, out: chi tiền
  ref_type TEXT NOT NULL,                    -- order | purchase | refund | other
  ref_id TEXT,
  shop_id TEXT REFERENCES shops(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'cash',       -- cash | bank | shopee_payout | cod | other
  paid_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  note TEXT,
  voided_at TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_payments_ref ON payments(ref_type, ref_id);
CREATE INDEX idx_payments_date ON payments(business_date);
