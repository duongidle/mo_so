-- M5: đơn bán, trạng thái, trả hàng

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  channel_id TEXT NOT NULL REFERENCES channels(id),
  external_id TEXT,                         -- mã đơn trên kênh (Shopee…), dùng chống trùng khi import
  customer_id TEXT REFERENCES customers(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','shipping','completed','cancelled','returned')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid','refunded')),

  -- ảnh chụp thông tin khách tại thời điểm đặt
  customer_name TEXT,
  customer_phone TEXT,
  shipping_address TEXT,

  -- tiền (VND)
  subtotal INTEGER NOT NULL DEFAULT 0,               -- Σ SL × đơn giá
  line_discount_amount INTEGER NOT NULL DEFAULT 0,   -- Σ giảm giá từng dòng
  discount_amount INTEGER NOT NULL DEFAULT 0,        -- giảm giá cấp đơn
  goods_revenue INTEGER NOT NULL DEFAULT 0,          -- subtotal − giảm giá: doanh thu hàng
  shipping_fee INTEGER NOT NULL DEFAULT 0,           -- phí ship khách trả
  total_amount INTEGER NOT NULL DEFAULT 0,           -- khách phải trả = goods_revenue + shipping_fee
  platform_fee_amount INTEGER NOT NULL DEFAULT 0,    -- phí sàn (hoa hồng, thanh toán, dịch vụ…)
  seller_shipping_amount INTEGER NOT NULL DEFAULT 0, -- phí ship shop chịu / trả hãng vận chuyển
  net_amount INTEGER NOT NULL DEFAULT 0,             -- shop thực nhận = total − phí sàn − ship shop chịu
  returned_amount INTEGER NOT NULL DEFAULT 0,        -- giá trị hàng bị trả (giảm doanh thu)
  net_revenue INTEGER NOT NULL DEFAULT 0,            -- doanh thu thuần = goods_revenue − returned_amount (0 nếu huỷ)
  cogs_amount INTEGER NOT NULL DEFAULT 0,            -- giá vốn hàng bán (sau trả hàng nhập lại kho)
  paid_amount INTEGER NOT NULL DEFAULT 0,            -- đã thu ròng (thu − hoàn)

  note TEXT,
  internal_note TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  tracking_code TEXT,
  carrier TEXT,
  stock_warning INTEGER NOT NULL DEFAULT 0,          -- 1 nếu xuất kho làm âm tồn
  source TEXT NOT NULL DEFAULT 'manual',             -- manual | pos | import | api

  ordered_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  confirmed_at TEXT,
  shipped_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_orders_external ON orders(shop_id, channel_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_orders_shop_date ON orders(shop_id, business_date);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_date ON orders(business_date);

CREATE TABLE order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  variant_id TEXT NOT NULL REFERENCES variants(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL,              -- qty × unit_price − discount
  allocated_order_discount INTEGER NOT NULL DEFAULT 0, -- phần giảm giá đơn phân bổ vào dòng
  unit_cost INTEGER NOT NULL DEFAULT 0,     -- giá vốn chụp lúc xuất kho
  returned_qty INTEGER NOT NULL DEFAULT 0,
  restocked_qty INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_order_lines_order ON order_lines(order_id);
CREATE INDEX idx_order_lines_variant ON order_lines(variant_id);

CREATE TABLE order_status_history (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_order_history_order ON order_status_history(order_id);

CREATE TABLE order_returns (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL REFERENCES orders(id),
  shop_id TEXT NOT NULL REFERENCES shops(id),
  goods_amount INTEGER NOT NULL,            -- giá trị hàng trả (giảm doanh thu)
  refund_amount INTEGER NOT NULL DEFAULT 0, -- tiền thực hoàn cho khách
  reason TEXT,
  lines TEXT NOT NULL,                      -- JSON [{order_line_id, variant_id, qty, restock, value, unit_cost}]
  returned_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_returns_order ON order_returns(order_id);
CREATE INDEX idx_returns_date ON order_returns(business_date);
