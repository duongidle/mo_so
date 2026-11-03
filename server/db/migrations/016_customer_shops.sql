-- Khách hàng là "thành viên" của từng shop, và nhãn khách là của từng shop.
-- Hồ sơ khách vẫn dùng chung (một người, một hồ sơ), nhưng mỗi shop có danh sách khách riêng:
-- xoá khách khỏi shop này không ảnh hưởng shop kia dù là cùng một người.

CREATE TABLE customer_shops (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  shop_id TEXT NOT NULL REFERENCES shops(id),
  added_at TEXT NOT NULL,
  removed_at TEXT,                      -- đã xoá khỏi shop này (không còn trong danh sách khách của shop)
  PRIMARY KEY (customer_id, shop_id)
);
CREATE INDEX idx_customer_shops_shop ON customer_shops(shop_id, removed_at);

CREATE TABLE customer_tags (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  shop_id TEXT NOT NULL REFERENCES shops(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (customer_id, shop_id, tag)
);
CREATE INDEX idx_customer_tags_shop ON customer_tags(shop_id, tag);

-- Dữ liệu có sẵn: ai đã mua ở shop nào, có thông tin riêng ở shop nào, có ghi chú ở shop nào thì là khách của shop đó
INSERT OR IGNORE INTO customer_shops (customer_id, shop_id, added_at)
  SELECT o.customer_id, o.shop_id, MIN(o.created_at) FROM orders o WHERE o.customer_id IS NOT NULL GROUP BY o.customer_id, o.shop_id;
INSERT OR IGNORE INTO customer_shops (customer_id, shop_id, added_at)
  SELECT DISTINCT v.entity_id, f.shop_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM custom_values v JOIN custom_fields f ON f.id = v.field_id WHERE v.entity_type = 'customer' AND f.shop_id IS NOT NULL;
INSERT OR IGNORE INTO customer_shops (customer_id, shop_id, added_at)
  SELECT DISTINCT n.customer_id, n.shop_id, MIN(n.created_at) FROM customer_notes n WHERE n.shop_id IS NOT NULL GROUP BY n.customer_id, n.shop_id;
-- Khách đã bị gộp: thành viên theo hồ sơ giữ lại, không theo hồ sơ cũ
DELETE FROM customer_shops WHERE customer_id IN (SELECT id FROM customers WHERE merged_into IS NOT NULL);
