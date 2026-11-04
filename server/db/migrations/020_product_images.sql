-- Ảnh sản phẩm. File nằm ở data/uploads/<account>/<id>.<ext>, bảng này là chỉ mục (và là nơi kiểm quyền đọc ảnh).
-- product_id NULL = ảnh vừa tải lên, chưa gắn vào sản phẩm nào.
-- Ảnh gỡ khỏi sản phẩm chỉ bị đánh dấu archived_at, file vẫn giữ (không xoá dữ liệu).
-- Ảnh riêng của một biến thể ghi ở variants.image_id (một ảnh dùng chung được cho nhiều biến thể, vd cùng màu khác size).

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,                       -- img_…
  product_id TEXT REFERENCES products(id),
  file_name TEXT NOT NULL,                   -- <id>.webp | .jpg | .png
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX idx_product_images_product ON product_images(product_id, sort_order);

ALTER TABLE variants ADD COLUMN image_id TEXT REFERENCES product_images(id);
