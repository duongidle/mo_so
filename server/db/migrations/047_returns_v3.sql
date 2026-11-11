-- Trả hàng v3: (A) phí sàn được hoàn khi trả hàng đơn sàn, (B) giảm giá sau bán / bồi thường (phiếu không có dòng hàng), (C) hàng nhập lại về đúng lô.
-- Chỉ THÊM cột/bảng; phiếu và đơn cũ có các khoản mới bằng 0 / kind = 'return'.

-- A. Phí sàn được sàn hoàn lại trên từng phiếu trả; tổng trên đơn. KHÔNG sửa platform_fee_amount gốc.
ALTER TABLE order_returns ADD COLUMN platform_fee_refund_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN platform_fee_refunded_amount INTEGER NOT NULL DEFAULT 0;

-- B. kind: 'return' (trả hàng) hoặc 'allowance' (giảm giá sau bán, không có hàng quay về). Phiếu allowance có lines với qty = 0 và value = phần giảm của dòng.
ALTER TABLE order_returns ADD COLUMN kind TEXT NOT NULL DEFAULT 'return';

-- C. Lô mà mỗi lần xuất kho cho đơn đã lấy hàng, để nhập lại (huỷ đơn, trả hàng) cộng đúng về các lô đó.
CREATE TABLE order_line_lots (
  id TEXT PRIMARY KEY,
  order_line_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  lot_no TEXT,
  expiry_date TEXT,
  received_at TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  ref_line_id TEXT,
  qty REAL NOT NULL,                       -- số đã lấy từ lô này
  restocked_qty REAL NOT NULL DEFAULT 0    -- số đã cộng lại
);
CREATE INDEX idx_oll_line ON order_line_lots(order_line_id, variant_id, warehouse_id);

-- Phí sàn trong bảng đệm báo cáo là phí sàn THUẦN (phí − phí được hoàn): dựng lại mọi ô
INSERT OR IGNORE INTO daily_stats_dirty SELECT DISTINCT business_date, shop_id, channel_id FROM orders;
