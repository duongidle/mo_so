-- Đơn trả từ sàn có thể chờ hàng về kho trước khi nhập lại tồn.
-- Các phiếu cũ được ghi nhận theo luồng nhập kho ngay lúc lập nên xem như đã nhận.
ALTER TABLE order_returns ADD COLUMN goods_received_at TEXT;
UPDATE order_returns SET goods_received_at = returned_at;
