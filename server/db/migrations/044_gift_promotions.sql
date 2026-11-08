-- Quà tặng kèm khác sản phẩm: khuyến mãi loại "gift" tặng một sản phẩm khác (giá 0 trên đơn, vẫn trừ kho và vào giá vốn).
-- SQLite không sửa được ràng buộc CHECK của cột kind nên dựng lại bảng khuyến mãi; bảng lượt dùng bỏ khoá ngoại tới khuyến mãi để dựng lại an toàn.
CREATE TABLE promotions_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('order_percent','order_amount','item_percent','buy_x_get_y','tier_percent','gift')),
  code TEXT,
  value INTEGER NOT NULL DEFAULT 0,
  buy_qty INTEGER,
  free_qty INTEGER,
  min_subtotal INTEGER NOT NULL DEFAULT 0,
  max_discount INTEGER,
  variant_ids TEXT,
  category_ids TEXT,
  shop_ids TEXT,
  channel_ids TEXT,
  starts_on TEXT,
  ends_on TEXT,
  usage_limit INTEGER,
  per_customer_limit INTEGER,
  stackable INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  gift_variant_id TEXT,               -- gift: sản phẩm tặng
  gift_qty INTEGER                    -- gift: số lượng tặng mỗi đơn
);
INSERT INTO promotions_new (id, name, kind, code, value, buy_qty, free_qty, min_subtotal, max_discount, variant_ids, category_ids, shop_ids, channel_ids, starts_on, ends_on, usage_limit, per_customer_limit, stackable, active, archived_at, created_at, updated_at)
  SELECT id, name, kind, code, value, buy_qty, free_qty, min_subtotal, max_discount, variant_ids, category_ids, shop_ids, channel_ids, starts_on, ends_on, usage_limit, per_customer_limit, stackable, active, archived_at, created_at, updated_at FROM promotions;
CREATE TABLE promotion_uses_new (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  customer_id TEXT,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO promotion_uses_new SELECT id, promotion_id, order_id, customer_id, amount, created_at FROM promotion_uses;
DROP TABLE promotion_uses;
DROP TABLE promotions;
ALTER TABLE promotions_new RENAME TO promotions;
ALTER TABLE promotion_uses_new RENAME TO promotion_uses;
CREATE UNIQUE INDEX idx_promotions_code ON promotions(code) WHERE code IS NOT NULL AND archived_at IS NULL;
CREATE INDEX idx_promotion_uses_promo ON promotion_uses(promotion_id);
CREATE INDEX idx_promotion_uses_order ON promotion_uses(order_id);

ALTER TABLE order_lines ADD COLUMN is_gift INTEGER NOT NULL DEFAULT 0;   -- dòng quà tặng kèm từ khuyến mãi
