import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate } from '../../lib/time.js';
import { conflict, badRequest, notFound } from '../../lib/errors.js';
import { emit, audit } from '../../lib/events.js';
import { runningCode } from '../../lib/codes.js';
import { getSetting } from '../settings/service.js';
import { availableBundles } from '../catalog/bundles.js';

const db = () => getDb();

const IN_TYPES = new Set(['opening', 'purchase_in', 'sale_cancel_in', 'sale_return_in', 'adjust_in', 'transfer_in']);

export function getLevel(warehouseId, variantId) {
  return (
    db().prepare('SELECT * FROM stock_levels WHERE warehouse_id = ? AND variant_id = ?').get(warehouseId, variantId) || {
      warehouse_id: warehouseId,
      variant_id: variantId,
      on_hand: 0,
      reserved: 0,
      avg_cost: 0,
      _new: true,
    }
  );
}

/**
 * Ghi một biến động kho và cập nhật tồn + giá vốn bình quân.
 * ĐÂY LÀ ĐƯỜNG DUY NHẤT ĐƯỢC PHÉP THAY ĐỔI TỒN KHO. Phải gọi trong transaction.
 *
 * @param {object} m
 * @param {number} m.qty  số dương; dấu được suy ra từ type
 * @param {number} [m.unitCost] bắt buộc với biến động vào kho có giá (purchase_in, opening, adjust_in, sale_*_in, transfer_in);
 *                              với biến động ra kho, bỏ trống = dùng giá vốn bình quân hiện tại
 * @param {boolean} [m.allowNegative] cho phép âm kho (vd đơn import từ sàn)
 * @returns {{ unitCost:number, balanceAfter:number, negative:boolean }}
 */
export function applyMovement(m) {
  if (!Number.isInteger(m.qty) || m.qty <= 0) throw badRequest('INVALID_QTY', 'Số lượng phải là số nguyên dương');
  if (db().prepare("SELECT 1 FROM variants WHERE id = ? AND kind = 'bundle'").get(m.variantId)) {
    throw badRequest('BUNDLE_NO_STOCK', 'Combo không có tồn kho riêng. Nhập, điều chỉnh, chuyển kho cho từng sản phẩm thành phần.', { variant_id: m.variantId });
  }
  const isIn = IN_TYPES.has(m.type);
  const level = getLevel(m.warehouseId, m.variantId);
  const at = m.at || nowIso();
  let unitCost;
  let newOnHand;
  let newAvg = level.avg_cost;

  if (isIn) {
    unitCost = m.unitCost ?? level.avg_cost;
    newOnHand = level.on_hand + m.qty;
    if (level.on_hand <= 0) newAvg = unitCost;
    else newAvg = Math.round((level.on_hand * level.avg_cost + m.qty * unitCost) / newOnHand);
  } else {
    newOnHand = level.on_hand - m.qty;
    const allowNeg = m.allowNegative ?? getSetting('allow_negative_stock');
    if (newOnHand < 0 && !allowNeg) {
      const v = db().prepare('SELECT sku FROM variants WHERE id = ?').get(m.variantId);
      throw conflict('STOCK_NOT_ENOUGH', `Không đủ tồn kho cho ${v?.sku ?? m.variantId} (còn ${level.on_hand}, cần ${m.qty})`, {
        variant_id: m.variantId,
        sku: v?.sku,
        on_hand: level.on_hand,
        required: m.qty,
      });
    }
    if (m.unitCost !== undefined && m.type === 'purchase_cancel_out') {
      // Huỷ phiếu nhập: rút đúng giá vốn đã nhập ra khỏi bình quân
      unitCost = m.unitCost;
      newAvg = newOnHand > 0 ? Math.max(0, Math.round((level.on_hand * level.avg_cost - m.qty * unitCost) / newOnHand)) : level.avg_cost;
    } else {
      unitCost = level.avg_cost;
    }
  }

  if (level._new) {
    db()
      .prepare(
        `INSERT INTO stock_levels (warehouse_id, variant_id, on_hand, reserved, avg_cost, last_in_at, last_out_at, updated_at)
         VALUES (?,?,?,0,?,?,?,?)`,
      )
      .run(m.warehouseId, m.variantId, newOnHand, newAvg, isIn ? at : null, isIn ? null : at, at);
  } else {
    db()
      .prepare(
        `UPDATE stock_levels SET on_hand = ?, avg_cost = ?, ${isIn ? 'last_in_at' : 'last_out_at'} = ?, updated_at = ?
         WHERE warehouse_id = ? AND variant_id = ?`,
      )
      .run(newOnHand, newAvg, at, at, m.warehouseId, m.variantId);
  }

  db()
    .prepare(
      `INSERT INTO stock_movements (id, warehouse_id, variant_id, type, qty, unit_cost, balance_after, avg_cost_after,
        ref_type, ref_id, ref_line_id, shop_id, note, actor_id, created_at, business_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      newId('mov'),
      m.warehouseId,
      m.variantId,
      m.type,
      isIn ? m.qty : -m.qty,
      unitCost,
      newOnHand,
      newAvg,
      m.refType ?? null,
      m.refId ?? null,
      m.refLineId ?? null,
      m.shopId ?? null,
      m.note ?? null,
      m.actorId ?? null,
      at,
      businessDate(at),
    );

  emit('stock.changed', {
    entityType: 'variant',
    entityId: m.variantId,
    shopId: m.shopId ?? null,
    data: { warehouse_id: m.warehouseId, variant_id: m.variantId, type: m.type, qty: isIn ? m.qty : -m.qty, on_hand: newOnHand },
  });
  return { unitCost, balanceAfter: newOnHand, negative: newOnHand < 0 };
}

// ---------- Truy vấn ----------
export function listStock({ warehouseId, shopId, q, filter, limit = 200 }) {
  const params = [];
  const where = ['v.archived_at IS NULL', 'p.archived_at IS NULL'];
  let join = '';
  if (shopId) {
    join = 'JOIN shop_listings l ON l.variant_id = v.id AND l.shop_id = ?';
    params.push(shopId);
  }
  let levelJoin = 'LEFT JOIN stock_levels s ON s.variant_id = v.id';
  if (warehouseId) {
    levelJoin += ' AND s.warehouse_id = ?';
    params.push(warehouseId);
  }
  if (q) {
    where.push('(v.sku LIKE ? OR v.name LIKE ? OR p.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = db()
    .prepare(
      `SELECT v.id AS variant_id, v.sku, v.kind, v.name AS variant_name, v.min_stock, p.id AS product_id, p.name AS product_name, p.unit,
              COALESCE(SUM(s.on_hand),0) AS on_hand,
              CASE WHEN SUM(CASE WHEN s.on_hand > 0 THEN s.on_hand END) > 0
                   THEN ROUND(SUM(CASE WHEN s.on_hand > 0 THEN s.on_hand * s.avg_cost END) * 1.0 / SUM(CASE WHEN s.on_hand > 0 THEN s.on_hand END))
                   ELSE COALESCE(MAX(s.avg_cost),0) END AS avg_cost,
              MAX(s.last_out_at) AS last_out_at, MAX(s.last_in_at) AS last_in_at
       FROM variants v JOIN products p ON p.id = v.product_id ${join} ${levelJoin}
       WHERE ${where.join(' AND ')}
       GROUP BY v.id ORDER BY p.name, v.sku LIMIT ?`,
    )
    .all(...params, limit);
  // Tốc độ bán 30 ngày gần nhất để tính số ngày còn đủ hàng
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const sales = db()
    .prepare(
      `SELECT variant_id, -SUM(qty) AS sold FROM stock_movements
       WHERE type = 'sale_out' AND created_at >= ? ${warehouseId ? 'AND warehouse_id = ?' : ''} GROUP BY variant_id`,
    )
    .all(...(warehouseId ? [since, warehouseId] : [since]));
  const soldMap = new Map(sales.map((s) => [s.variant_id, s.sold]));
  const lowDays = getSetting('low_stock_days');
  const slowDays = getSetting('slow_moving_days');
  const slowBefore = new Date(Date.now() - slowDays * 86400000).toISOString();
  let out = rows.map((r) => {
    // Combo không có tồn riêng: số bán được = min theo thành phần; giá trị tồn nằm ở thành phần nên không cộng lần nữa
    if (r.kind === 'bundle') {
      const avail = availableBundles(r.variant_id, warehouseId);
      return { ...r, is_bundle: true, on_hand: avail, avg_cost: 0, stock_value: 0, sold_30d: 0, days_left: null, is_low: false, is_slow: false, is_negative: false };
    }
    const sold30 = soldMap.get(r.variant_id) || 0;
    const perDay = sold30 / 30;
    const daysLeft = perDay > 0 ? Math.floor(r.on_hand / perDay) : null;
    const low = r.on_hand <= r.min_stock || (daysLeft !== null && daysLeft < lowDays);
    const slow = r.on_hand > 0 && (!r.last_out_at || r.last_out_at < slowBefore);
    return { ...r, stock_value: Math.max(0, r.on_hand) * r.avg_cost, sold_30d: sold30, days_left: daysLeft, is_low: low, is_slow: slow, is_negative: r.on_hand < 0 };
  });
  if (filter === 'low') out = out.filter((r) => r.is_low);
  if (filter === 'slow') out = out.filter((r) => r.is_slow);
  if (filter === 'negative') out = out.filter((r) => r.is_negative);
  if (filter === 'in_stock') out = out.filter((r) => r.on_hand > 0);
  return out;
}

export function listMovements({ variantId, warehouseId, refType, refId, limit = 100, cursor }) {
  const where = [];
  const params = [];
  if (variantId) (where.push('m.variant_id = ?'), params.push(variantId));
  if (warehouseId) (where.push('m.warehouse_id = ?'), params.push(warehouseId));
  if (refType) (where.push('m.ref_type = ?'), params.push(refType));
  if (refId) (where.push('m.ref_id = ?'), params.push(refId));
  if (cursor) (where.push('m.id < ?'), params.push(cursor));
  const rows = db()
    .prepare(
      `SELECT m.*, v.sku, p.name AS product_name, v.name AS variant_name FROM stock_movements m
       JOIN variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT ?`,
    )
    .all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, next_cursor: hasMore ? data[data.length - 1].id : null };
}

// ---------- Điều chỉnh / kiểm kê / tồn đầu ----------
/**
 * kind: opening (tồn đầu kỳ, cần unit_cost), count (kiểm kê: nhập số đếm được), adjust (+/-), damage (hư hỏng, chỉ trừ)
 * lines: [{ variant_id, counted? , change?, unit_cost? }]
 */
export function createAdjustment({ warehouseId, kind, reason, lines }, actor) {
  const w = db().prepare('SELECT id FROM warehouses WHERE id = ?').get(warehouseId);
  if (!w) throw notFound('Kho');
  const id = newId('adj');
  const code = runningCode('DC', 5);
  const at = nowIso();
  const result = [];
  for (const l of lines) {
    const level = getLevel(warehouseId, l.variant_id);
    let change;
    if (kind === 'count') change = l.counted - level.on_hand;
    else if (kind === 'damage') change = -Math.abs(l.change);
    else if (kind === 'opening') change = Math.abs(l.change ?? l.counted ?? 0);
    else change = l.change;
    if (!change) {
      result.push({ variant_id: l.variant_id, before: level.on_hand, after: level.on_hand, change: 0 });
      continue;
    }
    if ((kind === 'opening' || (change > 0 && level.on_hand <= 0)) && l.unit_cost == null && level.avg_cost === 0) {
      throw badRequest('COST_REQUIRED', 'Cần nhập giá vốn cho hàng đưa vào kho lần đầu', { variant_id: l.variant_id });
    }
    const type = kind === 'opening' ? 'opening' : kind === 'damage' ? 'damage_out' : change > 0 ? 'adjust_in' : 'adjust_out';
    const res = applyMovement({
      warehouseId,
      variantId: l.variant_id,
      type,
      qty: Math.abs(change),
      unitCost: change > 0 ? l.unit_cost ?? undefined : undefined,
      refType: 'adjustment',
      refId: id,
      note: reason,
      actorId: actor?.id,
      allowNegative: kind === 'count' ? true : undefined,
      at,
    });
    result.push({ variant_id: l.variant_id, before: level.on_hand, after: res.balanceAfter, change, unit_cost: res.unitCost });
  }
  db()
    .prepare('INSERT INTO stock_adjustments (id, code, warehouse_id, kind, reason, lines, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, code, warehouseId, kind, reason ?? null, JSON.stringify(result), actor?.id ?? null, at);
  audit(actor, `stock.${kind}`, 'stock_adjustment', id, null, result);
  return { id, code, warehouse_id: warehouseId, kind, reason, lines: result, created_at: at };
}

export function listAdjustments(limit = 50) {
  return db()
    .prepare('SELECT * FROM stock_adjustments ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((a) => ({ ...a, lines: JSON.parse(a.lines) }));
}

// ---------- Chuyển kho ----------
export function createTransfer({ fromWarehouseId, toWarehouseId, lines, note }, actor) {
  if (fromWarehouseId === toWarehouseId) throw badRequest('SAME_WAREHOUSE', 'Kho đi và kho đến phải khác nhau');
  const id = newId('trf');
  const code = runningCode('CK', 5);
  const at = nowIso();
  const done = [];
  for (const l of lines) {
    const out = applyMovement({ warehouseId: fromWarehouseId, variantId: l.variant_id, type: 'transfer_out', qty: l.qty, refType: 'transfer', refId: id, note, actorId: actor?.id, allowNegative: false, at });
    applyMovement({ warehouseId: toWarehouseId, variantId: l.variant_id, type: 'transfer_in', qty: l.qty, unitCost: out.unitCost, refType: 'transfer', refId: id, note, actorId: actor?.id, at });
    done.push({ variant_id: l.variant_id, qty: l.qty, unit_cost: out.unitCost });
  }
  db()
    .prepare('INSERT INTO stock_transfers (id, code, from_warehouse_id, to_warehouse_id, lines, note, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, code, fromWarehouseId, toWarehouseId, JSON.stringify(done), note ?? null, actor?.id ?? null, at);
  audit(actor, 'stock.transfer', 'stock_transfer', id, null, done);
  return { id, code, from_warehouse_id: fromWarehouseId, to_warehouse_id: toWarehouseId, lines: done, created_at: at };
}

/** Kiểm tra sổ cái khớp với tồn tổng hợp. Trả về danh sách lệch (rỗng = khớp). */
export function verifyStockIntegrity() {
  return db()
    .prepare(
      `SELECT s.warehouse_id, s.variant_id, s.on_hand, COALESCE(m.total,0) AS ledger
       FROM stock_levels s LEFT JOIN (SELECT warehouse_id, variant_id, SUM(qty) total FROM stock_movements GROUP BY 1,2) m
       ON m.warehouse_id = s.warehouse_id AND m.variant_id = s.variant_id
       WHERE s.on_hand != COALESCE(m.total,0)`,
    )
    .all();
}
