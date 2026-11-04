-- Phiếu trả hàng kiểu KiotViet: hoàn phí ship, phí trả hàng shop giữ lại, phí ship chiều về, cần trả khách / còn nợ khách.
-- Chỉ THÊM cột; phiếu cũ có các khoản mới bằng 0.

ALTER TABLE order_returns ADD COLUMN shipping_refund_amount INTEGER NOT NULL DEFAULT 0;  -- hoàn phí ship cho khách (giảm doanh thu phí ship)
ALTER TABLE order_returns ADD COLUMN return_fee_amount INTEGER NOT NULL DEFAULT 0;        -- phí trả hàng shop giữ lại (doanh thu khác)
ALTER TABLE order_returns ADD COLUMN return_shipping_cost INTEGER NOT NULL DEFAULT 0;     -- phí ship chiều về shop chịu (chi phí)

-- orders.returned_amount đổi nghĩa thành "giảm số phải thu do trả hàng" = hàng trả + ship hoàn − phí trả hàng
-- (mọi công thức công nợ `total − returned_amount − paid` giữ nguyên). Phần hàng thuần nằm ở returned_goods_amount.
ALTER TABLE orders ADD COLUMN returned_goods_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN returned_shipping_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN return_fee_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN return_shipping_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN refund_owed_amount INTEGER NOT NULL DEFAULT 0;              -- shop còn nợ khách (đã thu nhiều hơn phải thu)

-- Dữ liệu cũ: toàn bộ returned_amount cũ là tiền hàng
UPDATE orders SET returned_goods_amount = returned_amount;
UPDATE orders SET refund_owed_amount = MAX(0, paid_amount - MAX(0, total_amount - returned_amount))
  WHERE status IN ('confirmed','shipping','completed','returned')
    AND channel_id NOT IN (SELECT id FROM channels WHERE is_marketplace = 1);

INSERT INTO accounts (code, name, type, parent_code, normal_side, is_system) VALUES
  ('5118', 'Doanh thu khác (phí trả hàng)', 'revenue', NULL, 'credit', 1);

-- Bảng đệm báo cáo: thêm 2 cột; đánh dấu mọi ô để dựng lại
ALTER TABLE daily_stats ADD COLUMN return_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN return_shipping_cost INTEGER NOT NULL DEFAULT 0;
INSERT OR IGNORE INTO daily_stats_dirty SELECT DISTINCT business_date, shop_id, channel_id FROM orders;
