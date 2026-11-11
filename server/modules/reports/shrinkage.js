import { getDb } from '../../db/index.js';
import { lineAmount, qty3 } from '../../lib/money.js';
import { categoryClause } from '../../lib/categories.js';
import { STOCK_REASONS } from '../../lib/stockReasons.js';
import { businessDate } from '../../lib/time.js';

const db = () => getDb();
export const SHRINK_REASONS = [...STOCK_REASONS, { code: 'return_damaged', label: 'Hàng trả về bị hỏng' }];

/**
 * Báo cáo hao hụt theo sản phẩm. Nguồn:
 *  - phiếu điều chỉnh giảm, hàng hỏng, xuất huỷ lô (lý do có mã; phiếu cũ không mã = 'other') và kiểm kê thiếu (luôn 'other');
 *  - hàng trả về bị hỏng (return_write_offs) là lý do riêng 'return_damaged' (giá trị = giá vốn đã chụp; hàng chưa từng vào kho nên lượng chỉ để tham khảo).
 * Không tính tiêu hao bao bì/vật tư (có báo cáo riêng) và không tính đóng gói (chuyển đổi, không mất hàng).
 * Lượng nhập trong kỳ = nhập từ nhà cung cấp (purchase_in) trừ phần trả/huỷ phiếu nhập. Tỷ lệ = lượng hao hụt / lượng nhập, null khi kỳ không nhập.
 * Không có cột theo nhà cung cấp: phiếu điều chỉnh không ghi lô đã rút nên không suy ngược được hàng hao hụt thuộc phiếu nhập nào.
 */
export function shrinkageReport({ from, to, shopIds, categoryId } = {}) {
  const today = businessDate();
  from = from || `${today.slice(0, 7)}-01`;
  to = to || today;
  const cat = categoryClause(categoryId);
  const whIds = shopIds?.length
    ? [...new Set(db().prepare(`SELECT warehouse_id FROM shop_warehouses WHERE shop_id IN (${shopIds.map(() => '?').join(',')})`).all(...shopIds).map((r) => r.warehouse_id))]
    : null;
  const whSql = whIds ? ` AND m.warehouse_id IN (${whIds.length ? whIds.map(() => '?').join(',') : "''"})` : '';
  const whParams = whIds ?? [];

  const base = `FROM stock_movements m JOIN variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
    WHERE m.business_date >= ? AND m.business_date <= ? AND p.is_service = 0${whSql}${cat.sql}`;
  const losses = db()
    .prepare(`SELECT m.variant_id, m.qty, m.unit_cost, COALESCE(a.reason_code, 'other') AS reason_code, a.kind, m.ref_type ${base.replace('WHERE', 'LEFT JOIN stock_adjustments a ON a.id = m.ref_id AND m.ref_type = \'adjustment\' WHERE')}
      AND m.type IN ('adjust_out','damage_out') AND m.ref_type = 'adjustment' AND a.kind IN ('adjust','damage','count')`)
    .all(from, to, ...whParams, ...cat.params);
  const received = db()
    .prepare(`SELECT m.variant_id, SUM(CASE WHEN m.type = 'purchase_in' THEN m.qty ELSE 0 END) + SUM(CASE WHEN m.type = 'purchase_cancel_out' THEN m.qty ELSE 0 END) AS qty ${base} AND m.type IN ('purchase_in','purchase_cancel_out') GROUP BY m.variant_id`)
    .all(from, to, ...whParams, ...cat.params);
  const recvMap = new Map(received.map((r) => [r.variant_id, Math.max(0, qty3(r.qty))]));

  const rows = new Map();
  const get = (variantId) => {
    if (!rows.has(variantId)) {
      const v = db().prepare('SELECT v.id AS variant_id, v.sku, v.name AS variant_name, p.name AS product_name, p.unit FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?').get(variantId);
      rows.set(variantId, { ...v, by_reason: Object.fromEntries(SHRINK_REASONS.map((r) => [r.code, { qty: 0, value: 0 }])), qty: 0, value: 0, received_qty: recvMap.get(variantId) ?? 0 });
    }
    return rows.get(variantId);
  };
  const add = (variantId, code, q, value) => {
    const r = get(variantId);
    const b = r.by_reason[code] ?? r.by_reason.other;
    b.qty = qty3(b.qty + q);
    b.value += value;
    r.qty = qty3(r.qty + q);
    r.value += value;
  };
  for (const l of losses) add(l.variant_id, l.kind === 'count' ? 'other' : l.reason_code, Math.abs(l.qty), lineAmount(Math.abs(l.qty), l.unit_cost));

  const woWhere = ['w.business_date >= ?', 'w.business_date <= ?'];
  const woParams = [from, to];
  if (shopIds?.length) (woWhere.push(`w.shop_id IN (${shopIds.map(() => '?').join(',')})`), woParams.push(...shopIds));
  for (const w of db().prepare(`SELECT w.lines FROM return_write_offs w WHERE ${woWhere.join(' AND ')}`).all(...woParams)) {
    for (const l of JSON.parse(w.lines)) {
      if (cat.sql) {
        const ok = db().prepare(`SELECT 1 FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?${cat.sql}`).get(l.variant_id, ...cat.params);
        if (!ok) continue;
      }
      add(l.variant_id, 'return_damaged', l.qty, lineAmount(l.qty, l.unit_cost));
    }
  }

  const items = [...rows.values()]
    .map((r) => ({ ...r, shrink_rate: r.received_qty > 0 ? Math.round(((r.qty - r.by_reason.return_damaged.qty) / r.received_qty) * 10000) / 10000 : null }))
    .sort((a, b) => b.value - a.value);
  const totals = Object.fromEntries(SHRINK_REASONS.map((r) => [r.code, { label: r.label, qty_lines: items.filter((i) => i.by_reason[r.code].qty > 0).length, value: items.reduce((a, i) => a + i.by_reason[r.code].value, 0) }]));
  return {
    from,
    to,
    reasons: SHRINK_REASONS,
    items,
    totals,
    total_value: items.reduce((a, i) => a + i.value, 0),
    note_supplier: 'Chưa có cột theo nhà cung cấp: phiếu điều chỉnh không ghi hao hụt thuộc lô/phiếu nhập nào.',
  };
}
