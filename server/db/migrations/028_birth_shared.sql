-- Ngày sinh và năm sinh thành thông tin CHUNG của khách (cột customers.birth_date / birth_year), không còn là trường riêng của từng shop.
-- Không xoá giá trị nào: các trường ngày sinh/năm sinh cũ của shop chỉ bị ẨN (archived_at), giá trị vẫn nằm trong custom_values.
-- Chạy lại `npm run check-birthdates` để xem ca lệch giá trị và các công thức đã viết lại.

-- Giá trị mặc định điền sẵn của trường (JSON). Chỉ điền vào form của bản ghi mới / chưa có giá trị, không ghi vào bản ghi cũ.
ALTER TABLE custom_fields ADD COLUMN default_value TEXT;

-- 1. Gom giá trị ngày/năm sinh hợp lệ từ trường vai trò của mọi shop.
--    custom_values không có cột thời gian nên không biết giá trị nào mới nhất: ưu tiên shop ngành phong thuỷ, rồi shop lập trước.
CREATE TEMP TABLE _old_fields AS
SELECT id AS field_id, shop_id, key, role FROM custom_fields
WHERE entity_type = 'customer' AND role IN ('birth_date','birth_year') AND archived_at IS NULL;

CREATE TEMP TABLE _bd AS
SELECT v.entity_id AS customer_id, o.shop_id, o.key AS field_key, o.role,
       CASE WHEN o.role = 'birth_date' THEN trim(v.value_text) END AS d,
       CASE WHEN o.role = 'birth_year' THEN CAST(v.value_num AS INTEGER) END AS y,
       CASE WHEN s.industry = 'phong_thuy' THEN 0 ELSE 1 END AS rnk,
       s.created_at AS shop_created
FROM custom_values v
JOIN _old_fields o ON o.field_id = v.field_id
JOIN shops s ON s.id = o.shop_id
WHERE v.entity_type = 'customer'
  AND ((o.role = 'birth_date' AND date(trim(v.value_text)) = trim(v.value_text))
    OR (o.role = 'birth_year' AND v.value_num = CAST(v.value_num AS INTEGER) AND v.value_num BETWEEN 1900 AND 2100));

CREATE TEMP TABLE _pick_d AS
SELECT customer_id, d, shop_id FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY rnk, shop_created, shop_id) AS rn FROM _bd WHERE d IS NOT NULL
) WHERE rn = 1;

CREATE TEMP TABLE _pick_y AS
SELECT customer_id, y, shop_id FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY rnk, shop_created, shop_id) AS rn FROM _bd WHERE y IS NOT NULL
) WHERE rn = 1;

-- 2. Ghi nhật ký các ca lệch: các shop ghi giá trị khác nhau, hoặc khác giá trị cũ trên hồ sơ (sẽ bị ghi đè bằng giá trị đã chọn).
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, before, after, created_at)
SELECT 'aud_' || lower(hex(randomblob(12))), 'system', NULL, 'customer.birth_date_conflict', 'customer', p.customer_id,
       json_object('profile', c.birth_date,
                   'shops', json((SELECT json_group_array(json_object('shop_id', b.shop_id, 'field', b.field_key, 'value', b.d)) FROM _bd b WHERE b.customer_id = p.customer_id AND b.d IS NOT NULL))),
       json_object('birth_date', p.d, 'from_shop', p.shop_id),
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM _pick_d p JOIN customers c ON c.id = p.customer_id
WHERE (SELECT COUNT(DISTINCT b.d) FROM _bd b WHERE b.customer_id = p.customer_id AND b.d IS NOT NULL) > 1
   OR (c.birth_date IS NOT NULL AND c.birth_date != p.d);

INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, before, after, created_at)
SELECT 'aud_' || lower(hex(randomblob(12))), 'system', NULL, 'customer.birth_year_conflict', 'customer', p.customer_id,
       json_object('profile', c.birth_year,
                   'shops', json((SELECT json_group_array(json_object('shop_id', b.shop_id, 'field', b.field_key, 'value', b.y)) FROM _bd b WHERE b.customer_id = p.customer_id AND b.y IS NOT NULL))),
       json_object('birth_year', p.y, 'from_shop', p.shop_id),
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM _pick_y p JOIN customers c ON c.id = p.customer_id
WHERE (SELECT COUNT(DISTINCT b.y) FROM _bd b WHERE b.customer_id = p.customer_id AND b.y IS NOT NULL) > 1
   OR (c.birth_year IS NOT NULL AND c.birth_year != p.y);

-- 3. Ghi giá trị đã chọn vào hồ sơ chung (giá trị cũ trên hồ sơ chỉ bị thay khi có giá trị từ trường của shop)
UPDATE customers SET birth_date = (SELECT d FROM _pick_d p WHERE p.customer_id = customers.id), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (SELECT customer_id FROM _pick_d);
UPDATE customers SET birth_year = (SELECT y FROM _pick_y p WHERE p.customer_id = customers.id), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (SELECT customer_id FROM _pick_y);

-- 4. Viết lại công thức: {custom.<khoá trường ngày sinh của shop>} -> {birth_date}; năm sinh -> {birth_year}.
--    Gồm cả công thức đang ẩn (hiện lại vẫn chạy được).
CREATE TEMP TABLE _f0 AS
SELECT id, label, formula FROM custom_fields WHERE entity_type = 'customer' AND type = 'formula' AND formula IS NOT NULL;

UPDATE custom_fields SET formula = REPLACE(formula, '{custom.' || (SELECT o.key FROM _old_fields o WHERE o.shop_id = custom_fields.shop_id AND o.role = 'birth_date') || '}', '{birth_date}')
WHERE entity_type = 'customer' AND type = 'formula'
  AND EXISTS (SELECT 1 FROM _old_fields o WHERE o.shop_id = custom_fields.shop_id AND o.role = 'birth_date' AND instr(custom_fields.formula, '{custom.' || o.key || '}') > 0);
UPDATE custom_fields SET formula = REPLACE(formula, '{custom.' || (SELECT o.key FROM _old_fields o WHERE o.shop_id = custom_fields.shop_id AND o.role = 'birth_year') || '}', '{birth_year}')
WHERE entity_type = 'customer' AND type = 'formula'
  AND EXISTS (SELECT 1 FROM _old_fields o WHERE o.shop_id = custom_fields.shop_id AND o.role = 'birth_year' AND instr(custom_fields.formula, '{custom.' || o.key || '}') > 0);

-- 5. Trường có chữ "tuổi" trong nhãn mà công thức chỉ là TODAY() - {một biến}: trước đây phép trừ ngày cho kết quả trống, nay sẽ ra SỐ NGÀY.
--    Đúng ý định của chủ shop là tuổi nên viết lại thành AGE({biến}). Công thức khác giữ nguyên.
UPDATE custom_fields SET formula = 'AGE(' || substr(replace(formula, ' ', ''), 9) || ')'
WHERE entity_type = 'customer' AND type = 'formula' AND formula IS NOT NULL
  AND (label LIKE '%tuổi%' OR label LIKE '%TUỔI%')
  AND replace(formula, ' ', '') LIKE 'TODAY()-{%}'
  AND instr(replace(formula, ' ', ''), '}') = length(replace(formula, ' ', ''));

INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, before, after, created_at)
SELECT 'aud_' || lower(hex(randomblob(12))), 'system', NULL, 'custom_field.formula_rewritten', 'custom_field', f.id,
       json_object('label', o.label, 'formula', o.formula), json_object('formula', f.formula),
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM custom_fields f JOIN _f0 o ON o.id = f.id WHERE f.formula != o.formula;

-- 6. Ẩn các trường ngày sinh / năm sinh cũ của shop (giữ nguyên giá trị). Vai trò giữ lại để biết trường nào từng là gì.
UPDATE custom_fields SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (SELECT field_id FROM _old_fields);

INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, before, after, created_at)
SELECT 'aud_' || lower(hex(randomblob(12))), 'system', NULL, 'custom_field.archived_by_migration', 'custom_field', o.field_id,
       json_object('shop_id', o.shop_id, 'key', o.key, 'role', o.role), NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM _old_fields o;

DROP TABLE _old_fields;
DROP TABLE _bd;
DROP TABLE _pick_d;
DROP TABLE _pick_y;
DROP TABLE _f0;
