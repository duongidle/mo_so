-- Đổi tên thương hiệu Tiệm → Mở Sổ. Migration 006 giữ nguyên (quy ước 10), chỉ cập nhật dữ liệu mẫu đã chèn.
UPDATE import_profiles SET name = 'Mẫu chuẩn của Mở Sổ' WHERE id = 'imp_standard' AND name = 'Mẫu chuẩn của Tiệm';
