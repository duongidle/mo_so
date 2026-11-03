-- Trường thông tin khách có thể hiện thành cột ở danh sách khách của shop
ALTER TABLE custom_fields ADD COLUMN show_in_list INTEGER NOT NULL DEFAULT 0;
