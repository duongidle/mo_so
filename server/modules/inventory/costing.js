import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { badRequest } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { getSetting, writeSetting } from '../settings/service.js';

const db = () => getDb();
const r3 = (n) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;

export const METHODS = [
  { id: 'average', label: 'Bình quân gia quyền', short: 'Giá vốn = bình quân của hàng đang có trong kho, tính lại sau mỗi lần nhập. Đơn giản, giá vốn ít dao động.' },
  { id: 'fifo', label: 'Nhập trước xuất trước (FIFO)', short: 'Hàng nhập trước được coi là bán trước. Giá vốn bám sát giá nhập từng đợt, lãi phản ánh đúng khi giá nhập tăng giảm.' },
];

export const costingMethod = () => (getSetting('costing_method') === 'fifo' ? 'fifo' : 'average');

export function addLayer({ warehouseId, variantId, qty, unitCost, receivedAt, refType, refId, refLineId }) {
  if (qty <= EPS) return;
  db()
    .prepare('INSERT INTO stock_layers (id, warehouse_id, variant_id, qty, unit_cost, received_at, ref_type, ref_id, ref_line_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(newId('lyr'), warehouseId, variantId, r3(qty), unitCost, receivedAt, refType ?? null, refId ?? null, refLineId ?? null);
}

/**
 * Lấy `qty` từ các lớp giá, cũ nhất trước (`firstRef` = lớp của một phiếu nhập cụ thể được lấy trước, dùng khi huỷ phiếu).
 * Trả về các phần đã lấy, mỗi phần một đơn giá nguyên. Phần không có lớp nào phủ (âm kho) do người gọi tự định giá.
 */
export function consumeLayers(warehouseId, variantId, qty, firstRef) {
  const layers = db().prepare('SELECT * FROM stock_layers WHERE warehouse_id = ? AND variant_id = ? ORDER BY received_at, rowid').all(warehouseId, variantId);
  if (firstRef) layers.sort((a, b) => Number(b.ref_id === firstRef.refId && b.ref_line_id === firstRef.refLineId) - Number(a.ref_id === firstRef.refId && a.ref_line_id === firstRef.refLineId));
  const slices = [];
  let need = r3(qty);
  for (const l of layers) {
    if (need <= EPS) break;
    const take = Math.min(need, l.qty);
    slices.push({ qty: r3(take), unitCost: l.unit_cost, receivedAt: l.received_at });
    const left = r3(l.qty - take);
    if (left <= EPS) db().prepare('DELETE FROM stock_layers WHERE id = ?').run(l.id);
    else db().prepare('UPDATE stock_layers SET qty = ? WHERE id = ?').run(left, l.id);
    need = r3(need - take);
  }
  return { slices, shortfall: need > EPS ? need : 0 };
}

/** Giá vốn bình quân của các lớp còn lại (làm tròn đồng), null nếu không còn lớp nào. */
export function layerAverage(warehouseId, variantId) {
  const r = db().prepare('SELECT SUM(qty) AS q, SUM(qty * unit_cost) AS v FROM stock_layers WHERE warehouse_id = ? AND variant_id = ?').get(warehouseId, variantId);
  return r.q > EPS ? Math.round(r.v / r.q) : null;
}

/** Gộp các phần cùng đơn giá liền nhau thành tổng chi phí và đơn giá hiển thị (làm tròn). */
export function summarize(slices) {
  const qty = slices.reduce((a, s) => a + s.qty, 0);
  const total = slices.reduce((a, s) => a + Math.round(s.qty * s.unitCost), 0);
  return { qty, total, unitCost: qty > 0 ? Math.round(total / qty) : 0 };
}

export function costingStatus() {
  const method = costingMethod();
  const lv = db().prepare('SELECT COUNT(*) AS n, COALESCE(SUM(MAX(on_hand,0) * avg_cost),0) AS v FROM stock_levels WHERE on_hand > 0').get();
  const ly = db().prepare('SELECT COUNT(*) AS n, COALESCE(SUM(qty * unit_cost),0) AS v FROM stock_layers').get();
  // FIFO: giá trị đúng là tổng các lớp giá; bình quân: tồn × giá bình quân từng dòng
  return { method, methods: METHODS, stocked_lines: lv.n, stock_value: Math.round(method === 'fifo' ? ly.v : lv.v), layer_count: ly.n };
}

/**
 * Đổi phương pháp. Giá trị tồn kho hiện tại KHÔNG đổi:
 *  - bình quân → FIFO: mỗi dòng tồn thành một lớp giá duy nhất tại giá bình quân hiện tại;
 *  - FIFO → bình quân: giá bình quân lấy từ các lớp còn lại (đã luôn được cập nhật), bỏ các lớp.
 * Chỉ ảnh hưởng giá vốn của lần xuất SAU lúc đổi; đơn đã bán giữ nguyên giá vốn đã chụp.
 */
export function setCostingMethod(method, actor) {
  if (!METHODS.some((m) => m.id === method)) throw badRequest('INVALID_METHOD', 'Phương pháp giá vốn phải là average hoặc fifo. LIFO không hỗ trợ.');
  const before = costingMethod();
  if (before === method) return costingStatus();
  db().prepare('DELETE FROM stock_layers').run();
  if (method === 'fifo') {
    const rows = db().prepare('SELECT warehouse_id, variant_id, on_hand, avg_cost, COALESCE(last_in_at, updated_at) AS at FROM stock_levels WHERE on_hand > 0').all();
    for (const l of rows) addLayer({ warehouseId: l.warehouse_id, variantId: l.variant_id, qty: l.on_hand, unitCost: l.avg_cost, receivedAt: l.at ?? nowIso(), refType: 'switch' });
  }
  writeSetting('costing_method', method);
  audit(actor, 'costing.method_changed', 'settings', 'costing_method', { costing_method: before }, { costing_method: method });
  return costingStatus();
}

/** Đối chiếu lớp giá với tồn (chỉ khi dùng FIFO): Σ lớp từng dòng = max(tồn, 0). */
export function verifyLayers() {
  if (costingMethod() !== 'fifo') return [];
  return db()
    .prepare(
      `SELECT s.warehouse_id, s.variant_id, s.on_hand, ROUND(COALESCE(SUM(y.qty),0),3) AS layers
       FROM stock_levels s LEFT JOIN stock_layers y ON y.warehouse_id = s.warehouse_id AND y.variant_id = s.variant_id
       GROUP BY s.warehouse_id, s.variant_id HAVING ABS(layers - MAX(s.on_hand, 0)) > 0.0005`,
    )
    .all()
    .map((r) => ({ kind: 'stock_layers', ...r }));
}
