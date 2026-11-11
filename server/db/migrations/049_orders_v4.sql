-- Đơn bán v4: (A) giữ cọc khi huỷ đơn, (B) cảnh báo lô hết hạn trên đơn, (C) sản phẩm dịch vụ không tồn kho.
-- Chỉ THÊM cột / tài khoản; đơn và sản phẩm cũ có giá trị mặc định 0.

-- A. Số tiền khách đã thu mà shop GIỮ LẠI khi huỷ đơn (cọc bị bỏ) = thu nhập khác của shop, tính vào ngày của đơn.
--    Chỉ đơn đã huỷ mới > 0. Phần còn lại của tiền đã thu (paid_amount - forfeited_amount) là khoản shop còn nợ khách (refund_owed_amount).
ALTER TABLE orders ADD COLUMN forfeited_amount INTEGER NOT NULL DEFAULT 0;
-- Tài khoản riêng cho cọc giữ lại để KQKD thấy rõ dòng này (5118 chỉ là phí trả hàng)
INSERT OR IGNORE INTO accounts (code, name, type, parent_code, normal_side, is_system) VALUES
  ('5119', 'Doanh thu khác (cọc giữ lại)', 'revenue', NULL, 'credit', 1);
-- Bảng đệm báo cáo: thêm cột; dựng lại mọi ô
ALTER TABLE daily_stats ADD COLUMN forfeit INTEGER NOT NULL DEFAULT 0;
INSERT OR IGNORE INTO daily_stats_dirty SELECT DISTINCT business_date, shop_id, channel_id FROM orders;

-- B. Đơn đã xác nhận mà phần xuất kho chạm lô quá hạn (chủ shop xác nhận vẫn bán)
ALTER TABLE orders ADD COLUMN expired_lot_warning INTEGER NOT NULL DEFAULT 0;

-- C. Dịch vụ: bán và niêm yết như hàng nhưng không có kho. Dùng cột riêng thay vì mở rộng CHECK của item_type
--    (SQLite phải dựng lại bảng products cùng khoá ngoại, chỉ mục, trigger: rủi ro cao). Dịch vụ có item_type = 'product' và is_service = 1.
ALTER TABLE products ADD COLUMN is_service INTEGER NOT NULL DEFAULT 0;
