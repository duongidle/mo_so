-- Tách đơn (giao từng phần), giữ hàng cho đơn nháp, bảo hành theo sản phẩm.
ALTER TABLE orders ADD COLUMN parent_order_id TEXT;      -- đơn được tách ra từ đơn này
ALTER TABLE orders ADD COLUMN reserve_stock INTEGER NOT NULL DEFAULT 0;  -- đơn nháp đang giữ hàng
ALTER TABLE orders ADD COLUMN reserved_until TEXT;       -- hết hạn giữ hàng (YYYY-MM-DD, giờ VN); NULL = không hạn
CREATE INDEX idx_orders_reserved ON orders(reserve_stock) WHERE reserve_stock = 1;
ALTER TABLE products ADD COLUMN warranty_days INTEGER;   -- số ngày bảo hành kể từ ngày hoàn thành đơn; NULL = không bảo hành
