import { getDb } from '../../db/index.js';
import { nowIso, businessDate } from '../../lib/time.js';

const db = () => getDb();

/** Số lượng đang được giữ cho các đơn nháp (chưa hết hạn), theo biến thể; bỏ qua một đơn (đang xác nhận chính nó). */
export function reservedByVariant(exceptOrderId = null) {
  const today = businessDate(nowIso());
  const rows = db()
    .prepare(
      `SELECT l.variant_id, SUM(l.qty) AS q FROM order_lines l JOIN orders o ON o.id = l.order_id
       WHERE o.status = 'draft' AND o.reserve_stock = 1 AND (o.reserved_until IS NULL OR o.reserved_until >= ?) AND o.id != ?
       GROUP BY l.variant_id`,
    )
    .all(today, exceptOrderId ?? '');
  return new Map(rows.map((r) => [r.variant_id, r.q]));
}

