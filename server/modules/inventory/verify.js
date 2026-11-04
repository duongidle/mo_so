import { getDb } from '../../db/index.js';

const db = () => getDb();
const ACTIVE = "('confirmed','shipping','completed','returned')";

/**
 * Đối chiếu tồn kho và giá vốn. Trả về danh sách lệch (rỗng = khớp):
 *  1. stock_levels.on_hand = Σ stock_movements.qty của từng (kho, biến thể).
 *  2. Mỗi dòng đơn đang tính: cogs_amount = Σ (SL − đã nhập lại) × giá vốn của các phân bổ; đơn nháp/huỷ: 0.
 *  3. orders.cogs_amount = Σ cogs_amount của dòng (đơn đang tính), 0 nếu không.
 *  4. Phân bổ khớp sổ kho: Σ SL phân bổ = số đã xuất (sale_out); Σ đã nhập lại = số nhập lại (huỷ + trả) theo từng dòng và biến thể.
 *     Bước này chỉ chạy với dòng có biến động kho gắn theo ref_line_id (dữ liệu chuyển từ bản cũ vẫn có).
 */
export function verifyStock() {
  const out = [];
  for (const r of db()
    .prepare(
      `SELECT l.warehouse_id, l.variant_id, l.on_hand, COALESCE(m.q,0) AS ledger FROM stock_levels l
       LEFT JOIN (SELECT warehouse_id, variant_id, SUM(qty) AS q FROM stock_movements GROUP BY 1,2) m ON m.warehouse_id = l.warehouse_id AND m.variant_id = l.variant_id
       WHERE l.on_hand != COALESCE(m.q,0)`,
    )
    .all()) out.push({ kind: 'stock_level', ...r });
  for (const r of db()
    .prepare(
      `SELECT m.warehouse_id, m.variant_id, SUM(m.qty) AS ledger FROM stock_movements m
       LEFT JOIN stock_levels l ON l.warehouse_id = m.warehouse_id AND l.variant_id = m.variant_id WHERE l.variant_id IS NULL GROUP BY 1,2 HAVING ledger != 0`,
    )
    .all()) out.push({ kind: 'stock_level_missing', ...r });

  for (const r of db()
    .prepare(
      `SELECT l.id AS line_id, l.cogs_amount, o.status,
              COALESCE((SELECT SUM((a.qty - a.restocked_qty) * a.unit_cost) FROM order_line_allocations a WHERE a.order_line_id = l.id),0) AS expected
       FROM order_lines l JOIN orders o ON o.id = l.order_id`,
    )
    .all()) {
    const want = ['confirmed', 'shipping', 'completed', 'returned'].includes(r.status) ? r.expected : 0;
    if (r.cogs_amount !== want) out.push({ kind: 'line_cogs', line_id: r.line_id, status: r.status, cogs_amount: r.cogs_amount, expected: want });
  }
  for (const r of db()
    .prepare(
      `SELECT o.id AS order_id, o.cogs_amount, COALESCE(SUM(l.cogs_amount),0) AS expected FROM orders o LEFT JOIN order_lines l ON l.order_id = o.id
       WHERE o.status IN ${ACTIVE} GROUP BY o.id HAVING o.cogs_amount != expected`,
    )
    .all()) out.push({ kind: 'order_cogs', ...r });
  for (const r of db()
    .prepare(`SELECT id AS order_id, cogs_amount FROM orders WHERE status NOT IN ${ACTIVE} AND cogs_amount != 0`)
    .all()) out.push({ kind: 'order_cogs_inactive', ...r });

  for (const r of db()
    .prepare(
      `SELECT a.order_line_id AS line_id, a.variant_id, SUM(a.qty) AS qty, SUM(a.restocked_qty) AS restocked,
              (SELECT COALESCE(-SUM(m.qty),0) FROM stock_movements m WHERE m.ref_line_id = a.order_line_id AND m.variant_id = a.variant_id AND m.type = 'sale_out') AS out_q,
              (SELECT COALESCE(SUM(m.qty),0) FROM stock_movements m WHERE m.ref_line_id = a.order_line_id AND m.variant_id = a.variant_id AND m.type IN ('sale_cancel_in','sale_return_in')) AS in_q,
              (SELECT COUNT(*) FROM stock_movements m WHERE m.ref_line_id = a.order_line_id) AS n
       FROM order_line_allocations a GROUP BY 1,2`,
    )
    .all()) {
    if (r.n > 0 && (r.qty !== r.out_q || r.restocked !== r.in_q)) out.push({ kind: 'allocation_vs_ledger', ...r });
  }
  return out;
}
