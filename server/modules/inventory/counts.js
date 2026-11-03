import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { runningCode } from '../../lib/codes.js';
import { audit } from '../../lib/events.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { applyMovement, getLevel } from './service.js';

const db = () => getDb();

function addLines(countId, warehouseId, variantIds) {
  const ins = db().prepare('INSERT OR IGNORE INTO stock_count_lines (id, count_id, variant_id, system_qty) VALUES (?,?,?,?)');
  for (const vid of variantIds) {
    const v = db().prepare('SELECT kind FROM variants WHERE id = ?').get(vid);
    if (!v) throw notFound('Biến thể');
    if (v.kind === 'bundle') throw badRequest('BUNDLE_NO_STOCK', 'Combo không có tồn riêng nên không kiểm kê. Kiểm kê từng thành phần.');
    ins.run(newId('scl'), countId, vid, getLevel(warehouseId, vid).on_hand);
  }
}

/**
 * Tạo phiếu kiểm kê. mode:
 *  - 'in_stock': mọi sản phẩm đơn đang có tồn khác 0 trong kho (mặc định)
 *  - 'variants': chỉ các biến thể trong variantIds (kể cả tồn 0)
 *  - 'empty': phiếu trống, thêm dần
 * Tồn hệ thống được chụp lúc thêm vào phiếu và chụp lại lúc nhập số đếm của từng dòng (xem updateCount).
 */
export function createCount({ warehouseId, note, mode = 'in_stock', variantIds = [] }, actor) {
  if (!db().prepare('SELECT 1 FROM warehouses WHERE id = ?').get(warehouseId)) throw notFound('Kho');
  const id = newId('stc');
  db().prepare('INSERT INTO stock_counts (id, code, warehouse_id, note, actor_id, created_at) VALUES (?,?,?,?,?,?)').run(id, runningCode('KK', 5), warehouseId, note ?? null, actor?.id ?? null, nowIso());
  let ids = variantIds;
  if (mode === 'in_stock') {
    ids = db()
      .prepare(`SELECT s.variant_id FROM stock_levels s JOIN variants v ON v.id = s.variant_id WHERE s.warehouse_id = ? AND s.on_hand != 0 AND v.kind = 'single' AND v.archived_at IS NULL`)
      .all(warehouseId)
      .map((r) => r.variant_id);
  } else if (mode === 'empty') ids = [];
  addLines(id, warehouseId, ids);
  audit(actor, 'stock_count.created', 'stock_count', id);
  return getCount(id);
}

export function getCount(id) {
  const c = db().prepare('SELECT * FROM stock_counts WHERE id = ?').get(id);
  if (!c) throw notFound('Phiếu kiểm kê');
  const lines = db()
    .prepare(
      `SELECT l.*, v.sku, v.name AS variant_name, p.name AS product_name FROM stock_count_lines l
       JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id WHERE l.count_id = ? ORDER BY p.name, v.sku`,
    )
    .all(id)
    .map((l) => {
      const current = getLevel(c.warehouse_id, l.variant_id).on_hand;
      return {
        ...l,
        current_on_hand: current,
        // Có bán/nhập sau khi chụp tồn hệ thống: cảnh báo, nhưng chênh lệch vẫn tính theo số đã chụp
        moved_since: c.status === 'draft' && current !== l.system_qty,
        variance: l.counted_qty === null ? null : l.counted_qty - l.system_qty,
      };
    });
  const counted = lines.filter((l) => l.counted_qty !== null);
  return {
    ...c,
    lines,
    summary: {
      total: lines.length,
      counted: counted.length,
      uncounted: lines.length - counted.length,
      with_variance: counted.filter((l) => l.counted_qty !== l.system_qty).length,
    },
  };
}

export function listCounts(limit = 50) {
  return db()
    .prepare(
      `SELECT c.*, w.name AS warehouse_name, (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.id) AS line_count,
              (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.id AND l.counted_qty IS NOT NULL) AS counted_count
       FROM stock_counts c JOIN warehouses w ON w.id = c.warehouse_id ORDER BY c.id DESC LIMIT ?`,
    )
    .all(limit);
}

function assertDraft(c) {
  if (c.status !== 'draft') throw conflict('COUNT_CLOSED', `Phiếu ${c.code} đã ${c.status === 'completed' ? 'hoàn tất' : 'huỷ'}, không sửa được`);
}

/** Lưu số đếm, thêm hoặc bỏ dòng. Có thể gọi nhiều lần trong lúc đếm. */
export function updateCount(id, { lines = [], addVariantIds = [], removeVariantIds = [], note }) {
  const c = db().prepare('SELECT * FROM stock_counts WHERE id = ?').get(id);
  if (!c) throw notFound('Phiếu kiểm kê');
  assertDraft(c);
  if (addVariantIds.length) addLines(id, c.warehouse_id, addVariantIds);
  for (const vid of removeVariantIds) db().prepare('DELETE FROM stock_count_lines WHERE count_id = ? AND variant_id = ?').run(id, vid);
  for (const l of lines) {
    const row = db().prepare('SELECT id, counted_qty FROM stock_count_lines WHERE count_id = ? AND variant_id = ?').get(id, l.variant_id);
    if (!row) throw notFound(`Dòng kiểm kê ${l.variant_id}`);
    const sets = [];
    const vals = [];
    if (l.counted_qty !== undefined) {
      sets.push('counted_qty = ?');
      vals.push(l.counted_qty);
      // Chênh lệch tính theo tồn hệ thống TẠI LÚC NHẬP số đếm (người đếm nhập ngay sau khi đếm). Nhờ vậy hàng bán
      // trước hoặc sau lúc đếm đều không làm sai chênh lệch. Chỉ chụp lại khi số đếm thật sự đổi.
      if (l.counted_qty !== null && l.counted_qty !== row.counted_qty) {
        sets.push('system_qty = ?');
        vals.push(getLevel(c.warehouse_id, l.variant_id).on_hand);
      }
    }
    if (l.unit_cost !== undefined) (sets.push('unit_cost = ?'), vals.push(l.unit_cost));
    if (l.note !== undefined) (sets.push('note = ?'), vals.push(l.note));
    if (sets.length) db().prepare(`UPDATE stock_count_lines SET ${sets.join(', ')} WHERE id = ?`).run(...vals, row.id);
  }
  if (note !== undefined) db().prepare('UPDATE stock_counts SET note = ? WHERE id = ?').run(note, id);
  return getCount(id);
}

/**
 * Hoàn tất: mỗi dòng đã đếm có chênh lệch (số đếm − tồn đã chụp) sinh một biến động điều chỉnh.
 * Dòng chưa đếm: mặc định bỏ qua (không đụng tồn); uncounted='zero' coi như đếm được 0.
 * Phải chạy trong transaction: thiếu giá vốn cho hàng nhập lần đầu thì cả phiếu không áp.
 */
export function completeCount(id, { uncounted = 'skip' } = {}, actor) {
  const c = db().prepare('SELECT * FROM stock_counts WHERE id = ?').get(id);
  if (!c) throw notFound('Phiếu kiểm kê');
  assertDraft(c);
  const adjId = newId('adj');
  const at = nowIso();
  const done = [];
  const lines = db().prepare('SELECT * FROM stock_count_lines WHERE count_id = ?').all(id);
  for (const l of lines) {
    const counted = l.counted_qty ?? (uncounted === 'zero' ? 0 : null);
    if (counted === null) continue;
    const change = counted - l.system_qty;
    const level = getLevel(c.warehouse_id, l.variant_id);
    if (change === 0) {
      db().prepare('UPDATE stock_count_lines SET applied_change = 0 WHERE id = ?').run(l.id);
      continue;
    }
    if (change > 0 && level.on_hand <= 0 && level.avg_cost === 0 && l.unit_cost == null) {
      throw badRequest('COST_REQUIRED', 'Cần nhập giá vốn cho hàng đưa vào kho lần đầu', { variant_id: l.variant_id });
    }
    const res = applyMovement({
      warehouseId: c.warehouse_id,
      variantId: l.variant_id,
      type: change > 0 ? 'adjust_in' : 'adjust_out',
      qty: Math.abs(change),
      unitCost: change > 0 ? l.unit_cost ?? undefined : undefined,
      refType: 'adjustment',
      refId: adjId,
      note: `Kiểm kê ${c.code}`,
      actorId: actor?.id,
      allowNegative: true, // hàng đã bán trong lúc đếm có thể làm tồn hiện tại thấp hơn chênh lệch
      at,
    });
    db().prepare('UPDATE stock_count_lines SET applied_change = ? WHERE id = ?').run(change, l.id);
    done.push({ variant_id: l.variant_id, before: level.on_hand, after: res.balanceAfter, change, unit_cost: res.unitCost });
  }
  db()
    .prepare('INSERT INTO stock_adjustments (id, code, warehouse_id, kind, reason, lines, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(adjId, runningCode('DC', 5), c.warehouse_id, 'count', `Kiểm kê ${c.code}`, JSON.stringify(done), actor?.id ?? null, at);
  db().prepare("UPDATE stock_counts SET status = 'completed', adjustment_id = ?, completed_at = ? WHERE id = ?").run(adjId, at, id);
  audit(actor, 'stock_count.completed', 'stock_count', id, null, { adjustment_id: adjId, changes: done });
  return getCount(id);
}

export function cancelCount(id, actor) {
  const c = db().prepare('SELECT * FROM stock_counts WHERE id = ?').get(id);
  if (!c) throw notFound('Phiếu kiểm kê');
  assertDraft(c);
  db().prepare("UPDATE stock_counts SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(nowIso(), id);
  audit(actor, 'stock_count.cancelled', 'stock_count', id);
  return getCount(id);
}
