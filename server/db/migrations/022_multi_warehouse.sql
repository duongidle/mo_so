-- Một đơn lấy hàng từ nhiều kho.
-- Shop có DANH SÁCH kho xếp theo ưu tiên (thay cho một kho mặc định). Mỗi dòng đơn ghi rõ từng phần lấy ở kho nào, giá vốn bao nhiêu.
-- Giá vốn của dòng lưu thành tổng tiền (cogs_amount) vì chia nhiều kho thì đơn giá trung bình không còn là số nguyên.

CREATE TABLE shop_warehouses (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  priority INTEGER NOT NULL CHECK (priority >= 1),  -- 1 = lấy hàng trước
  PRIMARY KEY (shop_id, warehouse_id)
);
CREATE INDEX idx_shop_warehouses_wh ON shop_warehouses(warehouse_id);

-- shops.default_warehouse_id giữ nguyên và luôn bằng kho ưu tiên 1 (service giữ đồng bộ)
INSERT INTO shop_warehouses (shop_id, warehouse_id, priority)
SELECT id, default_warehouse_id, 1 FROM shops WHERE default_warehouse_id IS NOT NULL;

-- Phân bổ xuất kho của từng dòng đơn. variant_id là biến thể đơn có tồn (chính dòng đó, hoặc thành phần nếu dòng là combo).
-- unit_cost chụp lúc xuất và không bao giờ tính lại. restocked_qty = phần đã nhập lại kho (huỷ đơn, trả hàng).
CREATE TABLE order_line_allocations (
  id TEXT PRIMARY KEY,
  order_line_id TEXT NOT NULL REFERENCES order_lines(id),
  variant_id TEXT NOT NULL REFERENCES variants(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost INTEGER NOT NULL,
  restocked_qty INTEGER NOT NULL DEFAULT 0 CHECK (restocked_qty >= 0 AND restocked_qty <= qty),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ola_line ON order_line_allocations(order_line_id);
CREATE INDEX idx_ola_wh ON order_line_allocations(warehouse_id);

-- Giá vốn còn hiệu lực của dòng = Σ (qty - restocked_qty) × unit_cost của các phân bổ. Bằng 0 khi đơn nháp/đã huỷ.
ALTER TABLE order_lines ADD COLUMN cogs_amount INTEGER NOT NULL DEFAULT 0;
-- Phân bổ tay người dùng chọn lúc soạn đơn nháp (JSON), dùng khi xác nhận đơn
ALTER TABLE order_lines ADD COLUMN planned_allocations TEXT;

-- Chuyển đơn cũ: toàn bộ lấy từ kho của đơn (orders.warehouse_id), giá vốn chụp sẵn trên dòng / thành phần.
-- Đơn đã huỷ sau khi từng xác nhận: có phân bổ nhưng đã hoàn kho hết.
UPDATE order_lines SET cogs_amount = (qty - restocked_qty) * unit_cost
WHERE order_id IN (SELECT id FROM orders WHERE status IN ('confirmed','shipping','completed','returned'));

INSERT INTO order_line_allocations (id, order_line_id, variant_id, warehouse_id, qty, unit_cost, restocked_qty, created_at)
SELECT 'ola_' || lower(hex(randomblob(12))), l.id, l.variant_id, o.warehouse_id, l.qty, l.unit_cost,
       CASE WHEN o.status = 'cancelled' THEN l.qty ELSE l.restocked_qty END, o.created_at
FROM order_lines l
JOIN orders o ON o.id = l.order_id
JOIN variants v ON v.id = l.variant_id AND v.kind = 'single'
WHERE NOT EXISTS (SELECT 1 FROM order_line_components c WHERE c.order_line_id = l.id)
  AND (o.status IN ('confirmed','shipping','completed','returned')
       OR (o.status = 'cancelled' AND EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = 'confirmed')));

INSERT INTO order_line_allocations (id, order_line_id, variant_id, warehouse_id, qty, unit_cost, restocked_qty, created_at)
SELECT 'ola_' || lower(hex(randomblob(12))), l.id, c.variant_id, o.warehouse_id, c.per_bundle_qty * l.qty, c.unit_cost,
       c.per_bundle_qty * (CASE WHEN o.status = 'cancelled' THEN l.qty ELSE l.restocked_qty END), o.created_at
FROM order_line_components c
JOIN order_lines l ON l.id = c.order_line_id
JOIN orders o ON o.id = l.order_id;
