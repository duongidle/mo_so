-- Trường tuỳ chỉnh có thể đánh dấu bắt buộc: lưu giá trị (PUT /custom/values) mà thiếu trường bắt buộc thì báo lỗi.
ALTER TABLE custom_fields ADD COLUMN required INTEGER NOT NULL DEFAULT 0;
