import { getDb } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';

const db = () => getDb();

export const isBundle = (variantId) => db().prepare('SELECT kind FROM variants WHERE id = ?').get(variantId)?.kind === 'bundle';

export function componentsOf(bundleId) {
  return db()
    .prepare(
      `SELECT c.component_variant_id, c.qty, v.sku, v.name FROM bundle_components c JOIN variants v ON v.id = c.component_variant_id
       WHERE c.bundle_variant_id = ? ORDER BY v.sku`,
    )
    .all(bundleId);
}

/** Đặt lại danh sách thành phần của một combo. Thành phần phải là biến thể đơn, không trùng, SL nguyên dương. */
export function setComponents(bundleId, comps) {
  if (!comps?.length) throw badRequest('BUNDLE_EMPTY', 'Combo cần ít nhất 1 thành phần');
  const seen = new Set();
  for (const c of comps) {
    if (!Number.isInteger(c.qty) || c.qty <= 0) throw badRequest('BUNDLE_QTY', 'Số lượng thành phần phải là số nguyên dương');
    if (c.variant_id === bundleId) throw badRequest('BUNDLE_SELF', 'Combo không thể chứa chính nó');
    if (seen.has(c.variant_id)) throw badRequest('BUNDLE_DUPLICATE', 'Một thành phần chỉ khai báo một lần');
    seen.add(c.variant_id);
    const v = db().prepare('SELECT kind FROM variants WHERE id = ?').get(c.variant_id);
    if (!v) throw notFound('Biến thể thành phần');
    if (v.kind === 'bundle') throw badRequest('BUNDLE_NESTED', 'Thành phần của combo phải là sản phẩm đơn, không lồng combo trong combo');
  }
  db().prepare('DELETE FROM bundle_components WHERE bundle_variant_id = ?').run(bundleId);
  const ins = db().prepare('INSERT INTO bundle_components (bundle_variant_id, component_variant_id, qty) VALUES (?,?,?)');
  for (const c of comps) ins.run(bundleId, c.variant_id, c.qty);
}

/** Số combo bán được ngay = min theo từng thành phần (tồn / SL mỗi combo). warehouseId rỗng = cộng mọi kho. */
export function availableBundles(bundleId, warehouseId) {
  const comps = componentsOf(bundleId);
  if (!comps.length) return 0;
  return Math.min(
    ...comps.map((c) => {
      const onHand = warehouseId
        ? db().prepare('SELECT COALESCE(on_hand,0) AS n FROM stock_levels WHERE warehouse_id = ? AND variant_id = ?').get(warehouseId, c.component_variant_id)?.n ?? 0
        : db().prepare('SELECT COALESCE(SUM(on_hand),0) AS n FROM stock_levels WHERE variant_id = ?').get(c.component_variant_id).n;
      return Math.floor(Math.max(0, onHand) / c.qty);
    }),
  );
}

/** Đổi loại biến thể (đơn ↔ combo) chỉ khi chưa có lịch sử, nếu không sổ cái kho và đơn cũ sẽ sai nghĩa. */
export function assertKindChangeAllowed(variantId) {
  const used =
    db().prepare('SELECT 1 FROM stock_movements WHERE variant_id = ? LIMIT 1').get(variantId) ||
    db().prepare('SELECT 1 FROM order_lines WHERE variant_id = ? LIMIT 1').get(variantId) ||
    db().prepare('SELECT 1 FROM purchase_lines WHERE variant_id = ? LIMIT 1').get(variantId) ||
    db().prepare('SELECT 1 FROM bundle_components WHERE component_variant_id = ? LIMIT 1').get(variantId);
  if (used) throw conflict('KIND_LOCKED', 'Biến thể đã có lịch sử kho/đơn hàng nên không đổi giữa sản phẩm đơn và combo được. Tạo biến thể mới.');
}
