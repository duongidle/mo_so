import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate } from '../../lib/time.js';
import { allocate, lineAmount, shareOf, qty3 } from '../../lib/money.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, emit } from '../../lib/events.js';
import { dailyCode } from '../../lib/codes.js';
import { assertUnlocked } from '../../lib/period.js';
import { stockLockDate } from '../../lib/stockperiod.js';
import { applyMovement, getLevel } from '../inventory/service.js';
import { costingMethod, layerAverage } from '../inventory/costing.js';
import { addLot } from '../inventory/lots.js';
import { recordPayment, getPayment, voidPaymentRow } from '../payments/service.js';
import { getPurchase } from './service.js';
import { lineStates, supplierBalance } from './state.js';

const db = () => getDb();
const parse = (s) => {
  try {
    return JSON.parse(s || '[]');
  } catch {
    return [];
  }
};

function requireReceived(id) {
  const p = getPurchase(id);
  if (p.status !== 'received') throw conflict('INVALID_STATUS', 'Chỉ lập phiếu trả hàng / giảm giá cho phiếu nhập đã nhận hàng');
  return p;
}

/** NCC hoàn tiền ngay (nếu yêu cầu): ghi khoản thu, trừ số đã trả ròng của phiếu. Trả { refund_amount, refund_payment_id }. */
function refundNow(p, refund, { increase, label, actor, at }) {
  if (!refund?.now) return { refund_amount: 0, refund_payment_id: null };
  const owes = supplierBalance(getPurchase(p.id)).supplier_owes;
  const amount = refund.amount ?? increase;
  if (amount <= 0) return { refund_amount: 0, refund_payment_id: null };
  if (amount > owes) throw badRequest('REFUND_TOO_BIG', `NCC chỉ còn nợ shop ${owes} ₫, không ghi nhận hoàn ${amount} ₫`, { supplier_owes: owes });
  const pay = recordPayment({ direction: 'in', refType: 'purchase', refId: p.id, shopId: p.shop_id, amount, method: refund.method ?? 'cash', paidAt: at, note: `NCC hoàn tiền ${label}` }, actor);
  db().prepare('UPDATE purchases SET paid_amount = paid_amount - ?, updated_at = ? WHERE id = ?').run(amount, nowIso(), p.id);
  return { refund_amount: amount, refund_payment_id: pay.id };
}

export function getPurchaseReturn(id) {
  const r = db()
    .prepare('SELECT r.*, p.code AS purchase_code, s.name AS supplier_name, w.name AS warehouse_name FROM purchase_returns r JOIN purchases p ON p.id = r.purchase_id LEFT JOIN suppliers s ON s.id = r.supplier_id JOIN warehouses w ON w.id = r.warehouse_id WHERE r.id = ?')
    .get(id);
  if (!r) throw notFound('Phiếu trả hàng nhập');
  r.lines = db()
    .prepare('SELECT l.*, v.sku, v.name AS variant_name, pr.name AS product_name, pr.unit FROM purchase_return_lines l JOIN variants v ON v.id = l.variant_id JOIN products pr ON pr.id = v.product_id WHERE l.return_id = ? ORDER BY l.rowid')
    .all(id)
    .map(({ lots, ...l }) => l);
  return r;
}

export function listPurchaseReturns({ purchaseId, supplierId, shopId, limit = 50, cursor } = {}) {
  const where = [];
  const params = [];
  if (purchaseId) (where.push('r.purchase_id = ?'), params.push(purchaseId));
  if (supplierId) (where.push('r.supplier_id = ?'), params.push(supplierId));
  if (shopId) (where.push('r.shop_id = ?'), params.push(shopId));
  if (cursor) (where.push('r.id < ?'), params.push(cursor));
  const rows = db()
    .prepare(
      `SELECT r.*, p.code AS purchase_code, s.name AS supplier_name FROM purchase_returns r JOIN purchases p ON p.id = r.purchase_id LEFT JOIN suppliers s ON s.id = r.supplier_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC LIMIT ?`,
    )
    .all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, next_cursor: hasMore ? data[data.length - 1].id : null };
}

/**
 * Trả hàng cho nhà cung cấp theo dòng của một phiếu nhập đã nhận. Một transaction (gọi trong tx()):
 *  - xuất kho đúng số lượng, không cho âm. Bình quân: xuất ở giá nhập đã phân bổ của dòng (trừ phần NCC đã bớt cho hàng còn tồn), nếu làm kho về 0 hoặc
 *    làm giá trị tồn âm thì xuất ở giá bình quân hiện tại để giá trị tồn luôn bằng đúng Σ SL × giá. FIFO: rút lớp giá của chính dòng đó trước. Lô: rút lô của dòng đó trước.
 *  - NCC trả lại = phần giá mua còn lại của dòng theo tỷ lệ số lượng (đã trừ chiết khấu phiếu); phí ship / phí khác không tự hoàn.
 *    Tăng returned_amount của phiếu: nợ NCC = total − returned − allowance − paid; phần vượt thành "NCC còn nợ shop".
 *  - refund.now: ghi khoản NCC hoàn tiền ngay (chiều thu); không thì để treo trong Công nợ phải trả.
 */
export function createPurchaseReturn(purchaseId, input, actor) {
  const p = requireReceived(purchaseId);
  const at = nowIso();
  assertUnlocked(businessDate(at), 'Phiếu trả hàng nhập');
  const st = lineStates(purchaseId, p.lines, p.discount_amount);
  const byLine = new Map();
  for (const x of input.lines) byLine.set(x.purchase_line_id, qty3((byLine.get(x.purchase_line_id) ?? 0) + x.qty));
  const picked = [];
  for (const [lineId, q] of byLine) {
    const l = p.lines.find((x) => x.id === lineId);
    if (!l) throw badRequest('LINE_NOT_FOUND', 'Dòng trả không thuộc phiếu nhập này', { purchase_line_id: lineId });
    const s = st.get(lineId);
    if (q > s.net_qty + 1e-9) throw badRequest('RETURN_QTY_TOO_BIG', `${l.sku}: chỉ còn ${s.net_qty} chưa trả (đã nhập ${l.qty}, đã trả ${s.returned_qty})`, { sku: l.sku, returnable: s.net_qty });
    picked.push({ l, s, q });
  }
  // Tồn hiện có theo từng biến thể (nhiều dòng cùng biến thể cộng lại)
  const need = new Map();
  for (const x of picked) need.set(x.l.variant_id, qty3((need.get(x.l.variant_id) ?? 0) + x.q));
  for (const [vid, q] of need) {
    const have = getLevel(p.warehouse_id, vid).on_hand;
    if (have < q) {
      const sku = p.lines.find((x) => x.variant_id === vid).sku;
      throw conflict('STOCK_NOT_ENOUGH', `Không đủ tồn để trả ${sku}: còn ${have}, cần trả ${q}. Phần đã bán không trả được; chỉ trả số còn trong kho.`, { sku, on_hand: have, required: q });
    }
  }

  const retId = newId('ptn');
  const code = dailyCode('TN', null, at);
  db()
    .prepare(
      `INSERT INTO purchase_returns (id, code, purchase_id, supplier_id, warehouse_id, shop_id, returned_at, business_date, reason, note, actor_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(retId, code, purchaseId, p.supplier_id, p.warehouse_id, p.shop_id, at, businessDate(at), input.reason ?? null, input.note ?? null, actor?.id ?? null, at);
  const fifo = costingMethod() === 'fifo';
  const insLine = db().prepare('INSERT INTO purchase_return_lines (id, return_id, purchase_line_id, variant_id, qty, goods_amount, stock_value, lots) VALUES (?,?,?,?,?,?,?,?)');
  let goods = 0;
  let stockValue = 0;
  for (const { l, s, q } of picked) {
    const g = q === s.net_qty ? s.remaining_value : shareOf(s.remaining_value, q, s.net_qty);
    const lineId = newId('ptl');
    const lv = getLevel(p.warehouse_id, l.variant_id);
    // Giá xuất (bình quân): giá nhập đã phân bổ của dòng, trừ phần NCC đã bớt cho hàng còn tồn. FIFO bỏ qua giá truyền vào, lấy theo lớp.
    let unit = Math.round((l.line_total + l.allocated_cost - s.allowance_stock) / l.qty);
    if (!fifo && (qty3(lv.on_hand - q) <= 0 || lineAmount(lv.on_hand, lv.avg_cost) - lineAmount(q, unit) < 0)) unit = lv.avg_cost;
    const res = applyMovement({
      warehouseId: p.warehouse_id, variantId: l.variant_id, type: 'purchase_cancel_out', qty: q, unitCost: unit,
      refType: 'purchase_return', refId: retId, refLineId: lineId, preferRef: { refId: purchaseId, refLineId: l.id },
      allowNegative: false, shopId: p.shop_id, note: input.reason ? `Trả NCC: ${input.reason}` : 'Trả hàng NCC', actorId: actor?.id, at,
    });
    insLine.run(lineId, retId, l.id, l.variant_id, q, g, res.totalCost, JSON.stringify(res.lots ?? []));
    goods += g;
    stockValue += res.totalCost;
  }
  const before = supplierBalance(p).supplier_owes;
  db().prepare('UPDATE purchases SET returned_amount = returned_amount + ?, updated_at = ? WHERE id = ?').run(goods, nowIso(), purchaseId);
  const after = getPurchase(purchaseId);
  const refund = refundNow(after, input.refund, { increase: after.supplier_owes - before, label: `trả hàng ${code}`, actor, at });
  db().prepare('UPDATE purchase_returns SET goods_amount = ?, stock_value = ?, refund_amount = ?, refund_payment_id = ? WHERE id = ?').run(goods, stockValue, refund.refund_amount, refund.refund_payment_id, retId);
  const ret = getPurchaseReturn(retId);
  audit(actor, 'purchase.returned', 'purchase', purchaseId, null, { return_id: retId, code, goods_amount: goods, stock_value: stockValue, refund_amount: refund.refund_amount, lines: input.lines });
  emit('purchase.returned', { entityType: 'purchase_return', entityId: retId, shopId: p.shop_id, data: ret });
  return ret;
}

/** Huỷ phiếu trả (không xoá): nhập lại kho đúng giá và đúng lô, khôi phục nợ NCC, huỷ khoản NCC hoàn tiền đi kèm. */
export function voidPurchaseReturn(id, reason, actor) {
  const r = getPurchaseReturn(id);
  if (r.voided_at) throw conflict('ALREADY_VOIDED', 'Phiếu trả hàng nhập này đã huỷ');
  const p = getPurchase(r.purchase_id);
  if (p.status !== 'received') throw conflict('INVALID_STATUS', 'Phiếu nhập không còn ở trạng thái đã nhận');
  assertUnlocked(r.business_date, 'Phiếu trả hàng nhập');
  const lock = stockLockDate();
  if (lock && r.business_date <= lock) throw conflict('STOCK_PERIOD_CLOSED', `Phiếu trả ngày ${r.business_date} thuộc kỳ kho đã chốt (đến ${lock}). Mở lại kỳ ở Kho → Chốt kho nếu cần huỷ.`, { lock_date: lock });
  const at = nowIso();
  const lines = db().prepare('SELECT * FROM purchase_return_lines WHERE return_id = ? ORDER BY rowid').all(id);
  for (const l of lines) {
    const outs = db().prepare("SELECT * FROM stock_movements WHERE ref_type = 'purchase_return' AND ref_id = ? AND ref_line_id = ? ORDER BY rowid").all(id, l.id);
    for (const m of outs) {
      applyMovement({ warehouseId: m.warehouse_id, variantId: m.variant_id, type: 'purchase_in', qty: -m.qty, unitCost: m.unit_cost, refType: 'purchase_return_void', refId: id, refLineId: l.id, layerAt: p.received_at, shopId: p.shop_id, note: `Huỷ phiếu trả ${r.code}`, actorId: actor?.id, at });
    }
    for (const lot of parse(l.lots)) {
      addLot({ warehouseId: r.warehouse_id, variantId: l.variant_id, qty: lot.qty, lotNo: lot.lot_no, expiryDate: lot.expiry_date, receivedAt: lot.received_at, refType: lot.ref_type, refId: lot.ref_id, refLineId: lot.ref_line_id });
    }
  }
  db().prepare('UPDATE purchase_returns SET voided_at = ?, void_reason = ? WHERE id = ?').run(at, reason ?? null, id);
  db().prepare('UPDATE purchases SET returned_amount = returned_amount - ?, updated_at = ? WHERE id = ?').run(r.goods_amount, at, p.id);
  if (r.refund_payment_id) {
    voidPaymentRow(getPayment(r.refund_payment_id), at);
    db().prepare('UPDATE purchases SET paid_amount = paid_amount + ? WHERE id = ?').run(r.refund_amount, p.id);
  }
  const after = getPurchaseReturn(id);
  audit(actor, 'purchase.return_voided', 'purchase', p.id, { return_id: id, code: r.code }, { reason: reason ?? null });
  emit('purchase.return_voided', { entityType: 'purchase_return', entityId: id, shopId: p.shop_id, data: after });
  return after;
}

// ---------- Giảm giá sau nhận ----------
export function getPurchaseAllowance(id) {
  const a = db()
    .prepare('SELECT a.*, p.code AS purchase_code, s.name AS supplier_name FROM purchase_allowances a JOIN purchases p ON p.id = a.purchase_id LEFT JOIN suppliers s ON s.id = a.supplier_id WHERE a.id = ?')
    .get(id);
  if (!a) throw notFound('Phiếu giảm giá sau nhận');
  a.lines = db().prepare('SELECT l.*, v.sku FROM purchase_allowance_lines l JOIN variants v ON v.id = l.variant_id WHERE l.allowance_id = ? ORDER BY l.rowid').all(id);
  return a;
}

export function listPurchaseAllowances({ purchaseId, limit = 50 } = {}) {
  return db()
    .prepare(`SELECT a.*, p.code AS purchase_code FROM purchase_allowances a JOIN purchases p ON p.id = a.purchase_id ${purchaseId ? 'WHERE a.purchase_id = ?' : ''} ORDER BY a.id DESC LIMIT ?`)
    .all(...(purchaseId ? [purchaseId] : []), limit);
}

/** Số lượng của đợt nhập (dòng phiếu) còn nằm trong kho. FIFO: đúng theo lớp giá của dòng. Bình quân không theo dõi từng đợt: coi hàng cũ bán trước (đợt nhập còn lại = min(chưa trả, tồn)). */
function remainingQty(p, l, s, avail) {
  if (costingMethod() === 'fifo') {
    const q = db().prepare('SELECT COALESCE(SUM(qty),0) AS q FROM stock_layers WHERE warehouse_id = ? AND variant_id = ? AND ref_id = ? AND ref_line_id = ?').get(p.warehouse_id, l.variant_id, p.id, l.id).q;
    return Math.min(s.net_qty, qty3(q));
  }
  const q = Math.min(s.net_qty, Math.max(0, avail.get(l.variant_id) ?? 0));
  avail.set(l.variant_id, qty3((avail.get(l.variant_id) ?? 0) - q));
  return q;
}

/**
 * NCC bớt tiền sau khi đã nhận hàng (không trả hàng). amount ≤ giá trị mua còn lại của phiếu. Chia cho các dòng theo giá trị còn lại bằng allocate().
 * Với mỗi dòng, phần ứng với hàng CÒN TỒN của đợt nhập đó làm giảm giá vốn tồn kho (bình quân: giảm giá trị tồn rồi tính lại giá bình quân; FIFO: giảm đơn giá lớp của dòng);
 * phần ứng với hàng ĐÃ BÁN không sửa giá vốn đã chụp trên đơn mà ghi thu nhập khác (711). Không có biến động kho: số lượng không đổi.
 */
export function createPurchaseAllowance(purchaseId, input, actor) {
  const p = requireReceived(purchaseId);
  const at = nowIso();
  const date = businessDate(at);
  assertUnlocked(date, 'Phiếu giảm giá sau nhận');
  const lock = stockLockDate();
  if (lock && date <= lock) throw conflict('STOCK_PERIOD_CLOSED', `Kho đã chốt đến hết ngày ${lock}: không giảm giá trị tồn kho được. Mở lại kỳ ở Kho → Chốt kho nếu cần.`, { lock_date: lock });
  const st = lineStates(purchaseId, p.lines, p.discount_amount);
  const totalRemain = p.lines.reduce((a, l) => a + Math.max(0, st.get(l.id).remaining_value), 0);
  if (input.amount > totalRemain) throw badRequest('ALLOWANCE_TOO_BIG', `Số tiền giảm vượt giá trị hàng còn lại của phiếu (${totalRemain} ₫)`, { remaining_value: totalRemain });
  const parts = allocate(input.amount, p.lines.map((l) => Math.max(0, st.get(l.id).remaining_value)));
  const avail = new Map();
  for (const l of p.lines) if (!avail.has(l.variant_id)) avail.set(l.variant_id, getLevel(p.warehouse_id, l.variant_id).on_hand);
  const fifo = costingMethod() === 'fifo';
  const alId = newId('pal');
  const code = dailyCode('GG', null, at);
  db()
    .prepare(`INSERT INTO purchase_allowances (id, code, purchase_id, supplier_id, warehouse_id, shop_id, amount, reason, allowed_at, business_date, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(alId, code, purchaseId, p.supplier_id, p.warehouse_id, p.shop_id, input.amount, input.reason ?? null, at, date, actor?.id ?? null, at);
  const insLine = db().prepare('INSERT INTO purchase_allowance_lines (id, allowance_id, purchase_line_id, variant_id, amount, stock_amount, sold_amount) VALUES (?,?,?,?,?,?,?)');
  let stockTotal = 0;
  p.lines.forEach((l, i) => {
    const a = parts[i];
    if (a <= 0) return;
    const s = st.get(l.id);
    const rem = remainingQty(p, l, s, avail);
    let stockPart = rem > 0 && s.net_qty > 0 ? shareOf(a, rem, s.net_qty) : 0;
    stockPart = stockPart > 0 ? applyStockReduction(p, l, stockPart, fifo) : 0;
    insLine.run(newId('pall'), alId, l.id, l.variant_id, a, stockPart, a - stockPart);
    stockTotal += stockPart;
  });
  db().prepare('UPDATE purchase_allowances SET stock_amount = ?, sold_amount = ? WHERE id = ?').run(stockTotal, input.amount - stockTotal, alId);
  const before = supplierBalance(p).supplier_owes;
  db().prepare('UPDATE purchases SET allowance_amount = allowance_amount + ?, updated_at = ? WHERE id = ?').run(input.amount, nowIso(), purchaseId);
  const after = getPurchase(purchaseId);
  const refund = refundNow(after, input.refund, { increase: after.supplier_owes - before, label: `giảm giá ${code}`, actor, at });
  db().prepare('UPDATE purchase_allowances SET refund_amount = ?, refund_payment_id = ? WHERE id = ?').run(refund.refund_amount, refund.refund_payment_id, alId);
  const al = getPurchaseAllowance(alId);
  audit(actor, 'purchase.allowance_created', 'purchase', purchaseId, null, { allowance_id: alId, code, amount: input.amount, stock_amount: stockTotal, reason: input.reason ?? null });
  emit('purchase.allowance_created', { entityType: 'purchase_allowance', entityId: alId, shopId: p.shop_id, data: al });
  return al;
}

/** Giảm giá trị tồn kho `amount` cho dòng l (không đổi số lượng). Trả phần thực sự giảm được (không vượt giá trị đang có). */
function applyStockReduction(p, l, amount, fifo) {
  const lv = getLevel(p.warehouse_id, l.variant_id);
  if (lv._new || lv.on_hand <= 0) return 0;
  const stamp = nowIso();
  if (fifo) {
    const layer = db().prepare('SELECT * FROM stock_layers WHERE warehouse_id = ? AND variant_id = ? AND ref_id = ? AND ref_line_id = ? AND qty > 0 ORDER BY received_at, rowid LIMIT 1').get(p.warehouse_id, l.variant_id, p.id, l.id);
    if (!layer) return 0;
    const value = lineAmount(layer.qty, layer.unit_cost);
    const cut = Math.min(amount, value);
    db().prepare('UPDATE stock_layers SET unit_cost = ? WHERE id = ?').run(Math.max(0, Math.round((value - cut) / layer.qty)), layer.id);
    db().prepare('UPDATE stock_levels SET avg_cost = ?, updated_at = ? WHERE warehouse_id = ? AND variant_id = ?').run(layerAverage(p.warehouse_id, l.variant_id) ?? lv.avg_cost, stamp, p.warehouse_id, l.variant_id);
    return cut;
  }
  const value = lineAmount(lv.on_hand, lv.avg_cost);
  const cut = Math.min(amount, value);
  db().prepare('UPDATE stock_levels SET avg_cost = ?, updated_at = ? WHERE warehouse_id = ? AND variant_id = ?').run(Math.max(0, Math.round((value - cut) / lv.on_hand)), stamp, p.warehouse_id, l.variant_id);
  return cut;
}

function restoreStockReduction(p, l, amount, fifo) {
  const lv = getLevel(p.warehouse_id, l.variant_id);
  if (lv._new || lv.on_hand <= 0) throw conflict('ALLOWANCE_STOCK_GONE', `Không huỷ được: hàng ${l.sku ?? ''} của phiếu này đã hết kho nên không còn chỗ để hoàn lại phần giảm giá vốn tồn kho.`);
  const stamp = nowIso();
  if (fifo) {
    const layer = db().prepare('SELECT * FROM stock_layers WHERE warehouse_id = ? AND variant_id = ? AND ref_id = ? AND ref_line_id = ? AND qty > 0 ORDER BY received_at, rowid LIMIT 1').get(p.warehouse_id, l.variant_id, p.id, l.id);
    if (!layer) throw conflict('ALLOWANCE_STOCK_GONE', 'Không huỷ được: lớp giá của đợt nhập này đã hết hàng.');
    db().prepare('UPDATE stock_layers SET unit_cost = ? WHERE id = ?').run(Math.round((lineAmount(layer.qty, layer.unit_cost) + amount) / layer.qty), layer.id);
    db().prepare('UPDATE stock_levels SET avg_cost = ?, updated_at = ? WHERE warehouse_id = ? AND variant_id = ?').run(layerAverage(p.warehouse_id, l.variant_id) ?? lv.avg_cost, stamp, p.warehouse_id, l.variant_id);
    return;
  }
  db().prepare('UPDATE stock_levels SET avg_cost = ?, updated_at = ? WHERE warehouse_id = ? AND variant_id = ?').run(Math.round((lineAmount(lv.on_hand, lv.avg_cost) + amount) / lv.on_hand), stamp, p.warehouse_id, l.variant_id);
}

export function voidPurchaseAllowance(id, reason, actor) {
  const a = getPurchaseAllowance(id);
  if (a.voided_at) throw conflict('ALREADY_VOIDED', 'Phiếu giảm giá này đã huỷ');
  const p = getPurchase(a.purchase_id);
  if (p.status !== 'received') throw conflict('INVALID_STATUS', 'Phiếu nhập không còn ở trạng thái đã nhận');
  assertUnlocked(a.business_date, 'Phiếu giảm giá sau nhận');
  const lock = stockLockDate();
  if (lock && a.business_date <= lock) throw conflict('STOCK_PERIOD_CLOSED', `Phiếu giảm giá ngày ${a.business_date} thuộc kỳ kho đã chốt (đến ${lock}).`, { lock_date: lock });
  const fifo = costingMethod() === 'fifo';
  const at = nowIso();
  for (const al of a.lines) {
    if (al.stock_amount <= 0) continue;
    restoreStockReduction(p, p.lines.find((x) => x.id === al.purchase_line_id), al.stock_amount, fifo);
  }
  db().prepare('UPDATE purchase_allowances SET voided_at = ?, void_reason = ? WHERE id = ?').run(at, reason ?? null, id);
  db().prepare('UPDATE purchases SET allowance_amount = allowance_amount - ?, updated_at = ? WHERE id = ?').run(a.amount, at, p.id);
  if (a.refund_payment_id) {
    voidPaymentRow(getPayment(a.refund_payment_id), at);
    db().prepare('UPDATE purchases SET paid_amount = paid_amount + ? WHERE id = ?').run(a.refund_amount, p.id);
  }
  const after = getPurchaseAllowance(id);
  audit(actor, 'purchase.allowance_voided', 'purchase', p.id, { allowance_id: id, code: a.code }, { reason: reason ?? null });
  emit('purchase.allowance_voided', { entityType: 'purchase_allowance', entityId: id, shopId: p.shop_id, data: after });
  return after;
}

/** Ghi nhận NCC hoàn tiền sau (khoản "NCC còn nợ shop" treo từ phiếu trả / giảm giá). */
export function addSupplierRefund(purchaseId, { amount, method, paidAt, note }, actor) {
  const p = requireReceived(purchaseId);
  if (amount > p.supplier_owes) throw badRequest('REFUND_TOO_BIG', `NCC chỉ còn nợ shop ${p.supplier_owes} ₫`, { supplier_owes: p.supplier_owes });
  recordPayment({ direction: 'in', refType: 'purchase', refId: purchaseId, shopId: p.shop_id, amount, method, paidAt, note: note ?? 'NCC hoàn tiền' }, actor);
  db().prepare('UPDATE purchases SET paid_amount = paid_amount - ?, updated_at = ? WHERE id = ?').run(amount, nowIso(), purchaseId);
  audit(actor, 'purchase.supplier_refund', 'purchase', purchaseId, null, { amount, method });
  return getPurchase(purchaseId);
}
