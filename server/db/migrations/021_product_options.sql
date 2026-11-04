-- Biến thể dạng ma trận + ngũ hành thành trường sản phẩm theo ngành.

-- products.options: JSON [{"name":"Mùi","values":["Cam","Chanh"]}, …] (tối đa 3 thuộc tính)
-- variants.option_values: JSON {"Mùi":"Cam","Size":"10ml"}
ALTER TABLE products ADD COLUMN options TEXT;
ALTER TABLE variants ADD COLUMN option_values TEXT;

-- Trường sản phẩm riêng của từng shop (vd "Ngũ hành hợp" của mỗi shop phong thuỷ): khoá duy nhất trong phạm vi shop,
-- không còn duy nhất toàn hệ thống như trước. Trường toàn hệ thống (shop_id NULL) giữ quy tắc cũ.
DROP INDEX idx_custom_fields_key;
CREATE UNIQUE INDEX idx_custom_fields_key ON custom_fields(entity_type, key) WHERE archived_at IS NULL AND entity_type != 'customer' AND shop_id IS NULL;
CREATE UNIQUE INDEX idx_custom_fields_shop_key ON custom_fields(shop_id, entity_type, key) WHERE archived_at IS NULL AND entity_type != 'customer' AND shop_id IS NOT NULL;

-- Mỗi shop ngành phong thuỷ có trường "Ngũ hành hợp" (vai trò element) cho sản phẩm, nếu chưa có.
INSERT INTO custom_fields (id, entity_type, key, label, type, options, shop_id, sort_order, role, created_at, updated_at)
SELECT 'cf_' || upper(hex(randomblob(13))), 'product', 'ngu_hanh', 'Ngũ hành hợp', 'multiselect',
       '["Kim","Thuỷ","Mộc","Hoả","Thổ"]', s.id,
       (SELECT COALESCE(MAX(f.sort_order), -1) + 1 FROM custom_fields f WHERE f.entity_type = 'product' AND f.shop_id = s.id AND f.archived_at IS NULL),
       'element', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM shops s
WHERE s.industry = 'phong_thuy'
  AND NOT EXISTS (SELECT 1 FROM custom_fields f WHERE f.entity_type = 'product' AND f.shop_id = s.id AND f.archived_at IS NULL AND (f.key = 'ngu_hanh' OR f.role = 'element'));

-- Chép products.elements sang giá trị trường cho sản phẩm niêm yết ở shop đó. Cột cũ giữ nguyên, app ngừng ghi.
INSERT OR IGNORE INTO custom_values (entity_type, entity_id, field_id, value_text, value_num)
SELECT 'product', p.id, f.id, p.elements, NULL
FROM products p JOIN custom_fields f ON f.entity_type = 'product' AND f.role = 'element' AND f.archived_at IS NULL
JOIN shops s ON s.id = f.shop_id AND s.industry = 'phong_thuy'
WHERE p.elements IS NOT NULL AND p.elements != '[]' AND json_valid(p.elements)
  AND EXISTS (SELECT 1 FROM variants v JOIN shop_listings l ON l.variant_id = v.id WHERE v.product_id = p.id AND l.shop_id = s.id);
