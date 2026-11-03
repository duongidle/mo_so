-- Ngành bán của shop + trường thông tin khách theo từng shop

ALTER TABLE shops ADD COLUMN industry TEXT NOT NULL DEFAULT 'general';

-- Vai trò đặc biệt của trường (vd 'birth_date', 'birth_year', 'element'): để app biết đọc ngày sinh/mệnh từ trường nào
ALTER TABLE custom_fields ADD COLUMN role TEXT;

-- Trường của khách chỉ tồn tại trong phạm vi một shop: khoá chỉ cần duy nhất trong shop đó.
-- Các đối tượng khác (sản phẩm, đơn, phiếu nhập) giữ quy tắc cũ: khoá duy nhất toàn hệ thống.
DROP INDEX idx_custom_fields_key;
CREATE UNIQUE INDEX idx_custom_fields_key ON custom_fields(entity_type, key) WHERE archived_at IS NULL AND entity_type != 'customer';
CREATE UNIQUE INDEX idx_custom_fields_customer_key ON custom_fields(shop_id, key) WHERE archived_at IS NULL AND entity_type = 'customer';

-- Trường khách "toàn hệ thống" (nếu có) không còn chỗ đứng: ẩn đi, không xoá giá trị
UPDATE custom_fields SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE entity_type = 'customer' AND shop_id IS NULL AND archived_at IS NULL;
