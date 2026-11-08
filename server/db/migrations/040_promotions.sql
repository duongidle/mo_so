-- Khuyến mãi (module Loyalty & Campaign): giảm theo đơn, theo sản phẩm, mua X tặng Y, ưu đãi theo hạng khách, mã voucher.
CREATE TABLE promotions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('order_percent','order_amount','item_percent','buy_x_get_y','tier_percent')),
  code TEXT,                          -- mã voucher (hoa, không dấu); NULL = tự áp dụng khi đủ điều kiện
  value INTEGER NOT NULL DEFAULT 0,   -- % (order_percent, item_percent) hoặc số tiền (order_amount)
  buy_qty INTEGER,                    -- buy_x_get_y: mua bấy nhiêu…
  free_qty INTEGER,                   -- …tặng bấy nhiêu (cùng sản phẩm, rẻ nhất = chính nó)
  min_subtotal INTEGER NOT NULL DEFAULT 0,
  max_discount INTEGER,               -- trần giảm của một đơn
  variant_ids TEXT,                   -- JSON mảng; NULL = mọi sản phẩm
  category_ids TEXT,                  -- JSON mảng (gồm danh mục con ở lúc xét); NULL = không giới hạn danh mục
  shop_ids TEXT,                      -- JSON mảng; NULL = mọi shop
  channel_ids TEXT,                   -- JSON mảng; NULL = mọi kênh
  starts_on TEXT,
  ends_on TEXT,
  usage_limit INTEGER,                -- tổng số đơn được dùng
  per_customer_limit INTEGER,
  stackable INTEGER NOT NULL DEFAULT 0, -- 1 = cộng được với khuyến mãi khác
  active INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_promotions_code ON promotions(code) WHERE code IS NOT NULL AND archived_at IS NULL;
CREATE TABLE promotion_uses (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL REFERENCES promotions(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  customer_id TEXT,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_promotion_uses_promo ON promotion_uses(promotion_id);
CREATE INDEX idx_promotion_uses_order ON promotion_uses(order_id);
