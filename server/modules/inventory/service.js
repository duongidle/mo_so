import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, addDays } from '../../lib/time.js';
import { stockLockDate } from '../../lib/stockperiod.js';
import { conflict, badRequest, notFound } from '../../lib/errors.js';
import { emit, audit } from '../../lib/events.js';
import { lineAmount, qty3 } from '../../lib/money.js';
import { runningCode } from '../../lib/codes.js';
import { getSetting } from '../settings/service.js';
import { availableBundles } from '../catalog/bundles.js';
import { categoryClause } from '../../lib/categories.js';
import { reservedByVariant } from '../orders/reservation.js';
import { consumeLots, addLot } from './lots.js';
import { STOCK_REASON_CODES } from '../../lib/stockReasons.js';
import { costingMethod, addLayer, consumeLayers, layerAverage, summarize } from './costing.js';

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
 * @param {boolean} [m.allowNegative] cho phép âm kho (ví dụ đơn import từ sàn)
 * @param {boolean} [m.exactCost] biến động ra kho với unitCost đã biết (bình quân): rút đúng giá đó, không dùng giá bình quân hiện tại
 * @param {{refId:string, refLineId:string}} [m.preferRef] lớp giá/lô của dòng phiếu nhập này được lấy trước (trả hàng nhập; huỷ phiếu nhập tự suy ra từ refId)
 * @returns {{ unitCost:number, balanceAfter:number, negative:boolean }}
 */
export function applyMovement(m) {
  if (!Number.isFinite(m.qty) || m.qty <= 0 || Math.abs(m.qty * 1000 - Math.round(m.qty * 1000)) >= 1e-7) throw badRequest('INVALID_QTY', 'Số lượng phải dương, tối đa 3 chữ số thập phân');
  if (db().prepare("SELECT 1 FROM variants WHERE id = ? AND kind = 'bundle'").get(m.variantId)) {
    throw badRequest('BUNDLE_NO_STOCK', 'Combo không có tồn kho riêng. Nhập, điều chỉnh, chuyển kho cho từng sản phẩm thành phần.', { variant_id: m.variantId });
  }
  if (db().prepare('SELECT 1 FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND p.is_service = 1').get(m.variantId)) {
    throw badRequest('SERVICE_NO_STOCK', 'Dịch vụ không có tồn kho: không nhập, xuất, điều chỉnh, chuyển kho hay kiểm kê cho dịch vụ.', { variant_id: m.variantId });
  }
  const isIn = IN_TYPES.has(m.type);
  const level = getLevel(m.warehouseId, m.variantId);
  let at = m.at || nowIso();
  let closedNote = null;
  const lock = stockLockDate();
  if (lock && businessDate(at) <= lock) {
    if (!m.clampIfClosed) throw conflict('STOCK_PERIOD_CLOSED', `Kho đã chốt đến hết ngày ${lock}: không ghi được biến động ngày ${businessDate(at)}. Mở lại kỳ ở Kho → Chốt kho nếu cần sửa.`, { lock_date: lock, date: businessDate(at) });
    // Đơn đặt trong kỳ đã chốt (import muộn, đơn tạo lùi ngày): vẫn phải trừ kho, ghi vào ngày đầu tiên của kỳ mở để số kỳ đã chốt không đổi
    closedNote = `Ngày gốc ${businessDate(at)} thuộc kỳ kho đã chốt, ghi vào ${addDays(lock, 1)}`;
    at = new Date(`${addDays(lock, 1)}T00:00:00+07:00`).toISOString();
  }
  const fifo = costingMethod() === 'fifo';
  // Mỗi biến động gồm một hay nhiều "phần", mỗi phần một đơn giá nguyên: bình quân luôn một phần; FIFO xuất qua nhiều lớp giá thì nhiều phần
  let slices;
  let newOnHand;
  let newAvg = level.avg_cost;

  if (isIn) {
    const inCost = m.unitCost ?? level.avg_cost;
    slices = [{ qty: m.qty, unitCost: inCost }];
    newOnHand = qty3(level.on_hand + m.qty);
    if (fifo) {
      // Phần hàng vào bù chỗ âm kho không tạo lớp giá (hàng đó đã bán rồi)
      const fill = Math.min(m.qty, Math.max(0, -level.on_hand));
      addLayer({ warehouseId: m.warehouseId, variantId: m.variantId, qty: m.qty - fill, unitCost: inCost, receivedAt: m.layerAt ?? at, refType: m.refType, refId: m.refId, refLineId: m.refLineId });
      newAvg = layerAverage(m.warehouseId, m.variantId) ?? inCost;
    } else if (level.on_hand <= 0) newAvg = inCost;
    else newAvg = Math.round((lineAmount(level.on_hand, level.avg_cost) + lineAmount(m.qty, inCost)) / newOnHand);
  } else {
    newOnHand = qty3(level.on_hand - m.qty);
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
    if (fifo) {
      // Huỷ phiếu nhập lấy lớp giá của chính phiếu đó trước; còn lại lấy lớp cũ nhất
      const first = m.preferRef ?? (m.type === 'purchase_cancel_out' && m.refId ? { refId: m.refId, refLineId: m.refLineId } : null);
      const got = consumeLayers(m.warehouseId, m.variantId, m.qty, first);
      slices = got.slices;
      if (got.shortfall > 0) slices.push({ qty: got.shortfall, unitCost: level.avg_cost }); // âm kho: không có lớp nào, tạm tính theo giá gần nhất
      newAvg = layerAverage(m.warehouseId, m.variantId) ?? level.avg_cost;
    } else if (m.unitCost !== undefined && (m.type === 'purchase_cancel_out' || m.exactCost)) {
      // Huỷ phiếu nhập / huỷ phiếu đóng gói (exactCost): rút đúng giá vốn đã nhập ra khỏi bình quân
      slices = [{ qty: m.qty, unitCost: m.unitCost }];
      newAvg = newOnHand > 0 ? Math.max(0, Math.round((lineAmount(level.on_hand, level.avg_cost) - lineAmount(m.qty, m.unitCost)) / newOnHand)) : level.avg_cost;
    } else {
      slices = [{ qty: m.qty, unitCost: level.avg_cost }];
    }
  }
  const unitCost = slices.length === 1 ? slices[0].unitCost : summarize(slices).unitCost;

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
        // Biến động ghi lùi ngày (đơn import đặt từ trước) không được kéo "lần nhập/xuất gần nhất" về quá khứ
        `UPDATE stock_levels SET on_hand = ?, avg_cost = ?,
           ${isIn ? 'last_in_at' : 'last_out_at'} = CASE WHEN ${isIn ? 'last_in_at' : 'last_out_at'} IS NULL OR ${isIn ? 'last_in_at' : 'last_out_at'} < ? THEN ? ELSE ${isIn ? 'last_in_at' : 'last_out_at'} END,
           updated_at = ?
         WHERE warehouse_id = ? AND variant_id = ?`,
      )
      .run(newOnHand, newAvg, at, at, nowIso(), m.warehouseId, m.variantId);
  }

  // Sổ phụ lô/hạn: xuất thì lấy lô hết hạn sớm nhất trước (huỷ phiếu nhập thì lấy lô của chính phiếu đó trước)
  const lots = isIn ? [] : consumeLots(m.warehouseId, m.variantId, m.qty, m.preferRef ?? (m.type === 'purchase_cancel_out' && m.refId ? { refId: m.refId, refLineId: m.refLineId } : null), m.lotId ?? null);
  const ins = db().prepare(
    `INSERT INTO stock_movements (id, warehouse_id, variant_id, type, qty, unit_cost, balance_after, avg_cost_after,
      ref_type, ref_id, ref_line_id, shop_id, note, actor_id, created_at, business_date, expense_account_code)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  let running = level.on_hand;
  slices.forEach((sl, i) => {
    running = i === slices.length - 1 ? newOnHand : qty3(running + (isIn ? sl.qty : -sl.qty));
    ins.run(
      newId('mov'), m.warehouseId, m.variantId, m.type, isIn ? sl.qty : -sl.qty, sl.unitCost, running, newAvg,
      m.refType ?? null, m.refId ?? null, m.refLineId ?? null, m.shopId ?? null,
      closedNote ? (m.note ? `${m.note} · ${closedNote}` : closedNote) : m.note ?? null,
      m.actorId ?? null, at, businessDate(at), m.expenseAccountCode ?? null,
    );
  });

  emit('stock.changed', {
    entityType: 'variant',
    entityId: m.variantId,
    shopId: m.shopId ?? null,
    data: { warehouse_id: m.warehouseId, variant_id: m.variantId, type: m.type, qty: isIn ? m.qty : -m.qty, on_hand: newOnHand },
  });
  return { unitCost, balanceAfter: newOnHand, negative: newOnHand < 0, slices, lots, totalCost: slices.reduce((a, x) => a + lineAmount(x.qty, x.unitCost), 0) };
}

// ---------- Truy vấn ----------
export function listStock({ warehouseId, shopId, q, categoryId, filter, limit = 200 }) {
  const params = [];
  const where = ['v.archived_at IS NULL', 'p.archived_at IS NULL', 'p.is_service = 0']; // dịch vụ không có tồn kho
  let join = '';
  if (shopId) {
    join = 'JOIN shop_listings l ON l.variant_id = v.id AND l.shop_id = ?';
    params.push(shopId);
  }
  let levelJoin = 'LEFT JOIN stock_levels s ON s.variant_id = v.id';
  if (warehouseId) {
    levelJoin += ' AND s.warehouse_id = ?';
    params.push(warehouseId);
    // Chọn một kho thì chỉ liệt kê hàng đã từng có mặt ở kho đó (có dòng tồn, kể cả đã về 0). Hàng chưa từng nhập vào kho này không phải
    // "sắp hết" của kho này. Combo hiện khi có thành phần nào từng nằm trong kho.
    where.push(`(s.warehouse_id IS NOT NULL OR (v.kind = 'bundle' AND EXISTS (
      SELECT 1 FROM bundle_components bc JOIN stock_levels sl ON sl.variant_id = bc.component_variant_id AND sl.warehouse_id = ? WHERE bc.bundle_variant_id = v.id)))`);
    params.push(warehouseId); // thứ tự ? trong WHERE: điều kiện kho đứng trước ô tìm và danh mục
  }
  if (q) {
    where.push('(v.sku LIKE ? OR v.name LIKE ? OR p.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const cat = categoryClause(categoryId);
  if (cat.sql) where.push(cat.sql.slice(5));
  const rows = db()
    .prepare(
      `SELECT v.id AS variant_id, v.sku, v.kind, v.name AS variant_name, v.min_stock, p.id AS product_id, p.name AS product_name, p.unit, p.item_type,
              COALESCE('/api/v1/files/images/' || v.image_id, p.image_url) AS image_url,
              COALESCE(SUM(s.on_hand),0) AS on_hand,
              CASE WHEN SUM(CASE WHEN s.on_hand > 0 THEN s.on_hand END) > 0
                   THEN ROUND(SUM(CASE WHEN s.on_hand > 0 THEN ROUND(s.on_hand * 1000) * s.avg_cost / 1000.0 END) * 1.0 / SUM(CASE WHEN s.on_hand > 0 THEN s.on_hand END))
                   ELSE COALESCE(MAX(s.avg_cost),0) END AS avg_cost,
              MAX(s.last_out_at) AS last_out_at, MAX(s.last_in_at) AS last_in_at
       FROM variants v JOIN products p ON p.id = v.product_id ${join} ${levelJoin}
       WHERE ${where.join(' AND ')}
       GROUP BY v.id ORDER BY p.name, v.sku LIMIT ?`,
    )
    .all(...params, ...cat.params, limit);
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
  const held = reservedByVariant();
  let out = rows.map((r) => {
    // Combo không có tồn riêng: số bán được = min theo thành phần; giá trị tồn nằm ở thành phần nên không cộng lần nữa
    if (r.kind === 'bundle') {
      const avail = availableBundles(r.variant_id, warehouseId);
      return { ...r, is_bundle: true, on_hand: avail, avg_cost: 0, stock_value: 0, sold_30d: 0, days_left: null, is_low: false, is_slow: false, is_negative: false };
    }
    const sold30 = soldMap.get(r.variant_id) || 0;
    const perDay = sold30 / 30;
    const daysLeft = r.item_type === 'product' && perDay > 0 ? Math.floor(r.on_hand / perDay) : null;
    const low = r.on_hand <= r.min_stock || (daysLeft !== null && daysLeft < lowDays);
    const slow = r.item_type === 'product' && r.on_hand > 0 && (!r.last_out_at || r.last_out_at < slowBefore);
    return { ...r, reserved_qty: held.get(r.variant_id) || 0, stock_value: lineAmount(Math.max(0, r.on_hand), r.avg_cost), sold_30d: sold30, days_left: daysLeft, is_low: low, is_slow: slow, is_negative: r.on_hand < 0 };
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
export function createAdjustment({ warehouseId, kind, reason, reasonCode, lines }, actor) {
  if (reasonCode != null && !STOCK_REASON_CODES.includes(reasonCode)) throw badRequest('INVALID_REASON_CODE', 'Lý do không hợp lệ', { allowed: STOCK_REASON_CODES });
  const w = db().prepare('SELECT id FROM warehouses WHERE id = ?').get(warehouseId);
  if (!w) throw notFound('Kho');
  const id = newId('adj');
  const code = runningCode('DC', 5);
  const at = nowIso();
  const result = [];
  for (const l of lines) {
    const level = getLevel(warehouseId, l.variant_id);
    let change;
    if (kind === 'count') change = qty3(l.counted - level.on_hand);
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
      lotId: l.lot_id,
      at,
    });
    result.push({ variant_id: l.variant_id, before: level.on_hand, after: res.balanceAfter, change, unit_cost: res.unitCost });
  }
  db()
    .prepare('INSERT INTO stock_adjustments (id, code, warehouse_id, kind, reason, reason_code, lines, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, code, warehouseId, kind, reason ?? null, reasonCode ?? null, JSON.stringify(result), actor?.id ?? null, at);
  audit(actor, `stock.${kind}`, 'stock_adjustment', id, null, result);
  return { id, code, warehouse_id: warehouseId, kind, reason, reason_code: reasonCode ?? null, lines: result, created_at: at };
}

/**
 * Xuất huỷ một lô đã hết hạn: lập phiếu hàng hỏng (damage_out, ghi 811) đúng số còn lại của lô và trừ đúng lô đó (không theo FEFO).
 * Chỉ lô có hạn < hôm nay giờ VN (LOT_NOT_EXPIRED nếu chưa hết hạn: hàng còn bán được thì không huỷ bằng nút này).
 */
export function writeOffExpiredLot(lotId, { reason } = {}, actor) {
  const lot = db().prepare('SELECT * FROM stock_lots WHERE id = ? AND qty > 0').get(lotId);
  if (!lot) throw notFound('Lô hàng');
  if (!lot.expiry_date || lot.expiry_date >= businessDate(nowIso())) throw conflict('LOT_NOT_EXPIRED', 'Lô này chưa hết hạn nên không xuất huỷ bằng nút này. Dùng Điều chỉnh → Hàng hỏng nếu thật sự cần bỏ.', { lot_id: lot.id, expiry_date: lot.expiry_date });
  const sku = db().prepare('SELECT sku FROM variants WHERE id = ?').get(lot.variant_id)?.sku;
  const adj = createAdjustment({
    warehouseId: lot.warehouse_id,
    kind: 'damage',
    reasonCode: 'expired',
    reason: reason || `Xuất huỷ lô hết hạn ${sku}${lot.lot_no ? ` · lô ${lot.lot_no}` : ''} · hạn ${lot.expiry_date}`,
    lines: [{ variant_id: lot.variant_id, change: lot.qty, lot_id: lot.id }],
  }, actor);
  return { ...adj, lot_id: lot.id, sku, lot_no: lot.lot_no, expiry_date: lot.expiry_date, qty: lot.qty };
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
    // Mỗi phần xuất (FIFO có thể nhiều lớp giá) nhập sang kho đến đúng giá và giữ tuổi lớp, nên FIFO ở kho đến vẫn đúng thứ tự
    // Lô/hạn dùng đi theo hàng sang kho đến
    for (const lt of out.lots) addLot({ warehouseId: toWarehouseId, variantId: l.variant_id, qty: lt.qty, lotNo: lt.lot_no, expiryDate: lt.expiry_date, receivedAt: lt.received_at, refType: 'transfer', refId: id });
    for (const sl of out.slices) applyMovement({ warehouseId: toWarehouseId, variantId: l.variant_id, type: 'transfer_in', qty: sl.qty, unitCost: sl.unitCost, layerAt: sl.receivedAt, refType: 'transfer', refId: id, note, actorId: actor?.id, at });
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
       FROM stock_levels s LEFT JOIN (SELECT warehouse_id, variant_id, ROUND(SUM(qty), 3) total FROM stock_movements GROUP BY 1,2) m
       ON m.warehouse_id = s.warehouse_id AND m.variant_id = s.variant_id
       WHERE ROUND(s.on_hand, 3) != COALESCE(m.total,0)`,
    )
    .all();
}
