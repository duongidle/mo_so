import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate } from '../../lib/time.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { dailyCode } from '../../lib/codes.js';
import { assertUnlocked } from '../../lib/period.js';
import { getOrder, transitionOrder, addOrderPayment, addSellerShippingPayment, createReturn, voidOrderPayment, removeAwaitingReturn, revertOrderCompletion } from '../orders/service.js';
import { createExpense, voidExpense, getExpense } from '../expenses/service.js';

const db = () => getDb();
const norm = (c) => String(c ?? '').trim().toUpperCase();
const money = (n) => Math.max(0, Math.round(Number(n) || 0));
const PAYOUT = 'carrier_payout';

// ---------- Hãng vận chuyển ----------
export const listCarriers = ({ includeArchived = false } = {}) =>
  db().prepare(`SELECT * FROM carriers ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY name`).all();

export function createCarrier(input) {
  const name = input.name.trim();
  if (db().prepare('SELECT 1 FROM carriers WHERE lower(name) = lower(?)').get(name)) throw conflict('DUPLICATE_CARRIER', `Hãng ${name} đã có`);
  const id = newId('car');
  db().prepare('INSERT INTO carriers (id, name, tracking_url, remit_note, created_at) VALUES (?,?,?,?,?)').run(id, name, input.tracking_url ?? null, input.remit_note ?? null, nowIso());
  return db().prepare('SELECT * FROM carriers WHERE id = ?').get(id);
}

export function updateCarrier(id, input) {
  const c = db().prepare('SELECT * FROM carriers WHERE id = ?').get(id);
  if (!c) throw notFound('Hãng vận chuyển');
  const m = { ...c, ...input };
  db().prepare('UPDATE carriers SET name = ?, tracking_url = ?, remit_note = ?, archived_at = ? WHERE id = ?')
    .run(m.name, m.tracking_url ?? null, m.remit_note ?? null, input.archived === true ? nowIso() : input.archived === false ? null : c.archived_at, id);
  return db().prepare('SELECT * FROM carriers WHERE id = ?').get(id);
}

// ---------- Vận đơn ----------
const SHIP_SELECT = `SELECT s.*, c.name AS carrier_name, c.tracking_url, o.code AS order_code, o.status AS order_status, o.customer_name, o.customer_phone, o.shop_id
  FROM shipments s JOIN carriers c ON c.id = s.carrier_id JOIN orders o ON o.id = s.order_id`;
const withLink = (r) => ({ ...r, tracking_link: r.tracking_url ? r.tracking_url.replace('{code}', encodeURIComponent(r.tracking_code)) : null });

export function listShipmentsFor(orderId) {
  return db().prepare(`${SHIP_SELECT} WHERE s.order_id = ? ORDER BY s.created_at`).all(orderId).map(withLink);
}

/** bucket: in_transit (đang giao), unreconciled (đã giao, hãng chưa đối soát), returned (hoàn), done (đã đối soát) */
export function listShipments({ bucket, carrierId, q, shopIds, limit = 100 }) {
  const where = [];
  const params = [];
  if (carrierId) (where.push('s.carrier_id = ?'), params.push(carrierId));
  if (shopIds?.length) (where.push(`o.shop_id IN (${shopIds.map(() => '?').join(',')})`), params.push(...shopIds));
  if (q) (where.push('(s.tracking_code LIKE ? OR o.code LIKE ? OR o.customer_phone LIKE ? OR o.customer_name LIKE ?)'), params.push(...Array(4).fill(`%${q}%`)));
  if (bucket === 'in_transit') where.push("s.status = 'in_transit'");
  else if (bucket === 'unreconciled') where.push("s.status = 'delivered' AND s.statement_id IS NULL");
  else if (bucket === 'returned') where.push("s.status = 'returned'");
  else if (bucket === 'done') where.push('s.statement_id IS NOT NULL');
  return db().prepare(`${SHIP_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.created_at DESC LIMIT ?`).all(...params, limit).map(withLink);
}

export function shipmentSummary({ carrierId, shopIds } = {}) {
  const f = [];
  const p = [];
  if (carrierId) (f.push('s.carrier_id = ?'), p.push(carrierId));
  if (shopIds?.length) (f.push(`o.shop_id IN (${shopIds.map(() => '?').join(',')})`), p.push(...shopIds));
  const base = `FROM shipments s JOIN orders o ON o.id = s.order_id ${f.length ? 'WHERE ' + f.join(' AND ') : ''}`;
  const row = (cond) => db().prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(s.cod_amount),0) AS cod ${base} ${f.length ? 'AND' : 'WHERE'} ${cond}`).get(...p);
  return {
    in_transit: row("s.status = 'in_transit'"),
    unreconciled: row("s.status = 'delivered' AND s.statement_id IS NULL"),
    returned: row("s.status = 'returned'"),
  };
}

/** Giao đơn cho hãng: tạo vận đơn, đưa đơn sang "đang giao". COD mặc định = số khách còn phải trả. */
export function shipOrder(orderId, { carrierId, trackingCode, codAmount }, actor) {
  const o = getOrder(orderId);
  const carrier = db().prepare('SELECT * FROM carriers WHERE id = ? AND archived_at IS NULL').get(carrierId);
  if (!carrier) throw notFound('Hãng vận chuyển');
  if (!['confirmed', 'shipping'].includes(o.status)) throw conflict('INVALID_STATUS', 'Chỉ giao đơn đã xác nhận');
  if (o.is_marketplace) throw badRequest('MARKETPLACE_SHIPMENT', 'Đơn sàn do sàn lo vận chuyển, không tạo vận đơn ở đây');
  const code = norm(trackingCode);
  if (!code) throw badRequest('TRACKING_REQUIRED', 'Cần mã vận đơn');
  if (db().prepare('SELECT 1 FROM shipments WHERE carrier_id = ? AND tracking_code = ?').get(carrierId, code)) throw conflict('DUPLICATE_TRACKING', `Mã vận đơn ${code} đã có`);
  const cod = codAmount == null ? o.amount_due : money(codAmount);
  if (cod > o.amount_due) throw badRequest('COD_TOO_HIGH', `COD không được lớn hơn số khách còn phải trả (${o.amount_due})`, { max: o.amount_due });
  if (o.status === 'confirmed') transitionOrder(o.id, 'shipping', { actor, note: `Giao ${carrier.name} ${code}` });
  const id = newId('shp');
  const at = nowIso();
  db().prepare("INSERT INTO shipments (id, order_id, carrier_id, tracking_code, cod_amount, status, shipped_at, created_at, updated_at) VALUES (?,?,?,?,?,'in_transit',?,?,?)").run(id, o.id, carrierId, code, cod, at, at, at);
  db().prepare('UPDATE orders SET carrier = ?, tracking_code = ?, updated_at = ? WHERE id = ?').run(carrier.name, code, at, o.id);
  audit(actor, 'shipment.created', 'order', o.id, null, { shipment_id: id, carrier: carrier.name, tracking_code: code, cod_amount: cod });
  return { order: getOrder(o.id), shipment: listShipmentsFor(o.id).find((s) => s.id === id) };
}

/** Hãng báo hoàn: lập phiếu trả toàn bộ, hàng chờ về. Phí ship khách trả được hoàn (khách chưa nhận hàng). */
function autoReturnAll(o, actor, reason) {
  const lines = o.lines.filter((l) => l.qty - l.returned_qty > 0).map((l) => ({ order_line_id: l.id, qty: l.qty - l.returned_qty, restock: true }));
  if (!lines.length) return null;
  createReturn(o.id, { lines, reason, reasonCode: 'customer_refused', awaitingGoods: true, shippingRefund: Math.max(0, o.shipping_fee - o.returned_shipping_amount) }, actor);
  return db().prepare('SELECT id FROM order_returns WHERE order_id = ? ORDER BY rowid DESC LIMIT 1').get(o.id)?.id ?? null;
}

/** Cập nhật tay trạng thái vận đơn (khi không có file đối soát). Giao xong thì đơn hoàn thành; hoàn thì lập phiếu trả chờ hàng về. */
export function setShipmentStatus(id, { status }, actor) {
  const s = db().prepare('SELECT * FROM shipments WHERE id = ?').get(id);
  if (!s) throw notFound('Vận đơn');
  if (s.statement_id) throw conflict('ALREADY_RECONCILED', 'Vận đơn đã đối soát, không đổi trạng thái');
  if (!['delivered', 'returned', 'lost', 'in_transit'].includes(status)) throw badRequest('INVALID_STATUS', 'Trạng thái không hợp lệ');
  const o = getOrder(s.order_id);
  const at = nowIso();
  if (status === 'delivered' && o.status === 'shipping') transitionOrder(o.id, 'completed', { actor });
  if (status === 'returned' && o.status === 'shipping') autoReturnAll(o, actor, 'Hãng báo hoàn hàng');
  db().prepare('UPDATE shipments SET status = ?, delivered_at = ?, returned_at = ?, updated_at = ? WHERE id = ?')
    .run(status, status === 'delivered' ? at : null, status === 'returned' ? at : null, at, id);
  audit(actor, 'shipment.status', 'order', s.order_id, null, { shipment_id: id, status });
  return listShipmentsFor(s.order_id).find((x) => x.id === id);
}

// ---------- Đối soát với hãng ----------
function matchRow(carrierId, row) {
  const code = norm(row.tracking_code);
  const s = db().prepare('SELECT * FROM shipments WHERE carrier_id = ? AND tracking_code = ?').get(carrierId, code);
  const line = {
    tracking_code: code,
    outcome: row.outcome === 'returned' ? 'returned' : 'delivered',
    cod_stated: money(row.cod_amount),
    ship_fee: money(row.ship_fee),
    cod_fee: money(row.cod_fee),
    return_fee: money(row.return_fee),
    other_fee: money(row.other_fee),
    shipment_id: s?.id ?? null,
    order_id: s?.order_id ?? null,
    order_code: null,
    cod_expected: s?.cod_amount ?? 0,
    result: 'applied',
    warning: null,
  };
  if (!s) return { ...line, result: 'not_found', warning: 'Không có vận đơn này trong hệ thống' };
  const o = getOrder(s.order_id);
  line.order_code = o.code;
  if (s.statement_id) return { ...line, result: 'already_reconciled', warning: 'Vận đơn đã đối soát ở phiếu trước' };
  if (!['shipping', 'completed'].includes(o.status)) return { ...line, result: 'skipped', warning: `Đơn đang ở trạng thái “${o.status}”, không ghi nhận được` };
  if (line.outcome === 'delivered') {
    if (line.cod_stated !== s.cod_amount) line.warning = `COD hãng ghi ${line.cod_stated}, hệ thống kỳ vọng ${s.cod_amount} (lệch ${line.cod_stated - s.cod_amount})`;
    if (line.cod_stated > o.amount_due) line.warning = `${line.warning ? line.warning + '. ' : ''}Khách còn nợ ${o.amount_due}, chỉ ghi nhận tối đa số này`;
  }
  return line;
}

export function previewStatement({ carrierId, rows }) {
  if (!db().prepare('SELECT 1 FROM carriers WHERE id = ?').get(carrierId)) throw notFound('Hãng vận chuyển');
  const seen = new Set();
  const lines = rows.map((r) => {
    const l = matchRow(carrierId, r);
    if (seen.has(l.tracking_code)) return { ...l, result: 'skipped', warning: 'Mã vận đơn lặp trong file' };
    seen.add(l.tracking_code);
    return l;
  });
  const ok = lines.filter((l) => l.result === 'applied');
  return {
    lines,
    summary: {
      applied: ok.length,
      problems: lines.length - ok.length,
      cod_stated: ok.reduce((a, l) => a + (l.outcome === 'delivered' ? l.cod_stated : 0), 0),
      fees: ok.reduce((a, l) => a + l.ship_fee + l.cod_fee + l.return_fee + l.other_fee, 0),
    },
  };
}

/**
 * Chốt phiếu đối soát. Mỗi dòng khớp:
 *  - giao thành công: đơn hoàn thành (nếu đang giao), ghi thu COD qua phương thức "hãng chuyển về" (tối đa số khách còn nợ);
 *  - hoàn: lập phiếu trả toàn bộ chờ hàng về;
 *  - phí giao: phần thuộc "ship shop chịu" của đơn ghi như trả hãng (bù 3388), phần còn lại cùng phí COD/hoàn/khác thành MỘT khoản chi phí vận chuyển
 *    cho mỗi shop. Tiền thực về = COD − phí; quỹ nhận tiền là quỹ của phương thức "hãng chuyển về".
 */
export function createStatement({ carrierId, date, rows, note }, actor) {
  const carrier = db().prepare('SELECT * FROM carriers WHERE id = ?').get(carrierId);
  if (!carrier) throw notFound('Hãng vận chuyển');
  const day = date || businessDate(nowIso());
  const paidAt = `${day}T05:00:00.000Z`;
  const pv = previewStatement({ carrierId, rows });
  if (!pv.summary.applied) throw badRequest('NOTHING_TO_APPLY', 'Không có dòng nào khớp vận đơn để đối soát');
  const sid = newId('stm');
  const code = dailyCode('DS', null, `${day}T00:00:00.000Z`);
  db().prepare('INSERT INTO carrier_statements (id, code, carrier_id, statement_date, note, actor_id, created_at) VALUES (?,?,?,?,?,?,?)').run(sid, code, carrierId, day, note ?? null, actor?.id ?? null, nowIso());
  db().prepare('UPDATE carrier_statements SET effects_tracked = 1 WHERE id = ?').run(sid);
  const fx = (kind, refId, orderId, before) => db().prepare('INSERT INTO carrier_statement_effects (id, statement_id, kind, ref_id, order_id, before) VALUES (?,?,?,?,?,?)').run(newId('stf'), sid, kind, refId, orderId ?? null, before ? JSON.stringify(before) : null);
  const lastPayment = (refType, refId, direction, note) => db().prepare('SELECT id FROM payments WHERE ref_type = ? AND ref_id = ? AND method = ? AND direction = ? AND note = ? AND voided_at IS NULL ORDER BY rowid DESC LIMIT 1').get(refType, refId, PAYOUT, direction, note)?.id;
  const insLine = db().prepare('INSERT INTO carrier_statement_lines (id, statement_id, tracking_code, shipment_id, order_id, outcome, cod_stated, cod_recorded, ship_fee, cod_fee, return_fee, other_fee, result, warning) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  let totalCod = 0;
  let totalFees = 0;
  const feeByShop = new Map();
  for (const l of pv.lines) {
    let recorded = 0;
    if (l.result === 'applied') {
      const s = db().prepare('SELECT * FROM shipments WHERE id = ?').get(l.shipment_id);
      let o = getOrder(s.order_id);
      fx('shipment', s.id, o.id, { status: s.status, delivered_at: s.delivered_at, returned_at: s.returned_at });
      if (l.outcome === 'delivered') {
        if (o.status === 'shipping') {
          transitionOrder(o.id, 'completed', { actor, note: `Hãng ${carrier.name} giao thành công` });
          fx('order_completed', o.id, o.id);
        }
        o = getOrder(o.id);
        recorded = Math.min(l.cod_stated, o.amount_due);
        if (recorded > 0) {
          const note = `Đối soát ${code}`;
          addOrderPayment(o.id, { amount: recorded, method: PAYOUT, paidAt, note }, actor);
          fx('payment', lastPayment('order', o.id, 'in', note), o.id);
        }
      } else if (o.status === 'shipping') {
        const retId = autoReturnAll(o, actor, `Hãng ${carrier.name} hoàn hàng (${code})`);
        if (retId) fx('return', retId, o.id, { order_status: 'shipping' });
      }
      o = getOrder(o.id);
      const offset = Math.min(l.ship_fee, o.seller_shipping_due);
      if (offset > 0) {
        const note = `Hãng trừ phí giao khi đối soát ${code}`;
        addSellerShippingPayment(o.id, { amount: offset, method: PAYOUT, paidAt, note }, actor);
        fx('payment', lastPayment('order_seller_shipping', o.id, 'out', note), o.id);
      }
      const rest = l.ship_fee - offset + l.cod_fee + l.return_fee + l.other_fee;
      if (rest > 0) feeByShop.set(o.shop_id, (feeByShop.get(o.shop_id) ?? 0) + rest);
      totalCod += recorded;
      totalFees += l.ship_fee + l.cod_fee + l.return_fee + l.other_fee;
      db().prepare('UPDATE shipments SET status = ?, delivered_at = ?, returned_at = ?, statement_id = ?, updated_at = ? WHERE id = ?')
        .run(l.outcome === 'delivered' ? 'delivered' : 'returned', l.outcome === 'delivered' ? paidAt : null, l.outcome === 'returned' ? paidAt : null, sid, nowIso(), s.id);
    }
    insLine.run(newId('stl'), sid, l.tracking_code, l.shipment_id, l.order_id, l.outcome, l.cod_stated, recorded, l.ship_fee, l.cod_fee, l.return_fee, l.other_fee, l.result, l.warning);
  }
  for (const [shopId, amount] of feeByShop) {
    const e = createExpense({ category_id: 'ecat_shipping', shop_id: shopId, amount, expense_date: day, method: PAYOUT, payee: carrier.name, note: `Phí hãng ${carrier.name} trừ khi đối soát ${code}` }, actor);
    fx('expense', e.id, null);
  }
  db().prepare('UPDATE carrier_statements SET total_cod = ?, total_fees = ?, net_amount = ?, line_count = ? WHERE id = ?').run(totalCod, totalFees, totalCod - totalFees, pv.lines.length, sid);
  audit(actor, 'carrier_statement.created', 'carrier_statement', sid, null, { code, carrier: carrier.name, applied: pv.summary.applied, total_cod: totalCod, total_fees: totalFees });
  return getStatement(sid);
}

export function getStatement(id) {
  const s = db().prepare('SELECT st.*, c.name AS carrier_name FROM carrier_statements st JOIN carriers c ON c.id = st.carrier_id WHERE st.id = ?').get(id);
  if (!s) throw notFound('Phiếu đối soát');
  const lines = db().prepare('SELECT l.*, o.code AS order_code FROM carrier_statement_lines l LEFT JOIN orders o ON o.id = l.order_id WHERE l.statement_id = ? ORDER BY l.rowid').all(id);
  return { ...s, lines };
}

export const listStatements = ({ carrierId, limit = 50 } = {}) =>
  db().prepare(`SELECT st.*, c.name AS carrier_name FROM carrier_statements st JOIN carriers c ON c.id = st.carrier_id ${carrierId ? 'WHERE st.carrier_id = ?' : ''} ORDER BY st.created_at DESC LIMIT ?`).all(...(carrierId ? [carrierId] : []), limit);

// ---------- Huỷ cả phiếu đối soát ----------
const orderCode = (id) => db().prepare('SELECT code FROM orders WHERE id = ?').get(id)?.code ?? id;
const lockProblem = (date, what) => {
  try { assertUnlocked(date, what); return null; } catch (e) { return e.message; }
};

/**
 * Xem trước việc huỷ phiếu: những gì sẽ được hoàn tác và những gì đang cản. Không ghi gì.
 * Mọi tác động đã ghi lúc lập phiếu (`carrier_statement_effects`) được đảo ngược đúng từng thứ; tác động nào người dùng đã tự xử lý
 * (khoản thanh toán đã huỷ tay, chi phí đã huỷ) thì bỏ qua. Chỉ cản khi đảo ngược sẽ làm sai số liệu: đơn đã đổi sau đối soát,
 * hàng trả đã nhập kho, đã có khoản hoàn dựa trên tiền COD, kỳ đã khoá sổ.
 */
export function previewVoidStatement(id) {
  const st = db().prepare('SELECT * FROM carrier_statements WHERE id = ?').get(id);
  if (!st) throw notFound('Phiếu đối soát');
  const blockers = [];
  const block = (code, message, orderId) => blockers.push({ code, message, order_code: orderId ? orderCode(orderId) : null });
  const undo = { payments: 0, payments_amount: 0, expenses: 0, expenses_amount: 0, returns: 0, orders_reopened: 0, shipments: 0 };
  if (st.voided_at) return { statement: st, voided: true, blockers, undo, can_void: false };
  if (!st.effects_tracked) {
    block('STATEMENT_LEGACY', 'Phiếu này lập trước khi hệ thống ghi lại chi tiết từng thay đổi nên không huỷ tự động được. Xử lý tay từng khoản (huỷ thanh toán, huỷ chi phí) hoặc liên hệ hỗ trợ.');
    return { statement: st, voided: false, blockers, undo, can_void: false };
  }
  const fxs = db().prepare('SELECT * FROM carrier_statement_effects WHERE statement_id = ? ORDER BY rowid').all(id);
  const inByOrder = new Map(); // tiền COD sẽ huỷ theo đơn, để kiểm tra không làm đã thu âm
  for (const f of fxs) {
    if (f.kind === 'payment') {
      const p = db().prepare('SELECT * FROM payments WHERE id = ?').get(f.ref_id);
      if (!p || p.voided_at) continue;
      const lp = lockProblem(p.business_date, 'Thanh toán');
      if (lp) block('PERIOD_LOCKED', lp, f.order_id);
      if (p.direction === 'in') inByOrder.set(f.order_id, (inByOrder.get(f.order_id) ?? 0) + p.amount);
      undo.payments += 1;
      undo.payments_amount += p.amount;
    } else if (f.kind === 'expense') {
      const e = getExpense(f.ref_id);
      if (e.voided_at) continue;
      const lp = lockProblem(e.expense_date, 'Chi phí');
      if (lp) block('PERIOD_LOCKED', lp);
      undo.expenses += 1;
      undo.expenses_amount += e.amount;
    } else if (f.kind === 'return') {
      const r = db().prepare('SELECT * FROM order_returns WHERE id = ?').get(f.ref_id);
      if (!r) continue;
      if (r.goods_received_at) block('RETURN_RECEIVED', 'Hàng hoàn của đơn này đã nhập kho, không hoàn tác được. Giữ phiếu đối soát và xử lý tay nếu có sai.', f.order_id);
      else if (r.refund_amount > 0) block('RETURN_HAS_REFUND', 'Phiếu trả của đơn này đã hoàn tiền cho khách.', f.order_id);
      else undo.returns += 1;
    } else if (f.kind === 'order_completed') {
      const o = db().prepare('SELECT status FROM orders WHERE id = ?').get(f.ref_id);
      if (o && o.status !== 'completed') block('ORDER_CHANGED', `Đơn đã đổi trạng thái sang “${o.status}” sau đối soát.`, f.ref_id);
      else if (db().prepare('SELECT 1 FROM order_returns WHERE order_id = ? LIMIT 1').get(f.ref_id)) block('HAS_RETURNS', 'Đơn đã có phiếu trả hàng sau đối soát.', f.ref_id);
      else undo.orders_reopened += 1;
    } else if (f.kind === 'shipment') undo.shipments += 1;
  }
  for (const [orderId, amount] of inByOrder) {
    const paid = db().prepare('SELECT paid_amount FROM orders WHERE id = ?').get(orderId)?.paid_amount ?? 0;
    if (paid - amount < 0) block('PAYMENT_HAS_REFUND', 'Đã có khoản hoàn tiền dựa trên tiền COD của phiếu này. Huỷ khoản hoàn trước.', orderId);
  }
  return { statement: st, voided: false, blockers, undo, can_void: blockers.length === 0 };
}

/**
 * Huỷ cả phiếu đối soát: hoàn tác thu COD, trả phí giao, chi phí hãng trừ, phiếu trả chờ hàng về, đơn hoàn thành, và trả vận đơn về
 * trạng thái trước khi đối soát (đối soát lại được). Phiếu giữ lại để tra cứu, đánh dấu đã huỷ. Một giao dịch: lỗi ở đâu cũng không đổi gì.
 */
export function voidStatement(id, { reason }, actor) {
  const pv = previewVoidStatement(id);
  if (pv.voided) throw conflict('ALREADY_VOIDED', 'Phiếu đối soát này đã huỷ');
  if (pv.blockers.length) {
    throw conflict(pv.blockers[0].code === 'STATEMENT_LEGACY' ? 'STATEMENT_LEGACY' : 'STATEMENT_VOID_BLOCKED', `Không huỷ được phiếu ${pv.statement.code}: ${pv.blockers[0].order_code ? pv.blockers[0].order_code + ': ' : ''}${pv.blockers[0].message}`, { blockers: pv.blockers });
  }
  const code = pv.statement.code;
  const note = `Huỷ phiếu đối soát ${code}`;
  const fxs = db().prepare('SELECT * FROM carrier_statement_effects WHERE statement_id = ? ORDER BY rowid').all(id);
  const of = (kind) => fxs.filter((f) => f.kind === kind);
  for (const f of of('payment')) {
    const p = db().prepare('SELECT * FROM payments WHERE id = ?').get(f.ref_id);
    if (p && !p.voided_at) voidOrderPayment(p, note, actor);
  }
  for (const f of of('return')) {
    if (db().prepare('SELECT 1 FROM order_returns WHERE id = ?').get(f.ref_id)) removeAwaitingReturn(f.order_id, f.ref_id, { actor, restoreStatus: JSON.parse(f.before || '{}').order_status ?? null });
  }
  for (const f of of('order_completed')) revertOrderCompletion(f.ref_id, { actor, note });
  for (const f of of('expense')) {
    if (!getExpense(f.ref_id).voided_at) voidExpense(f.ref_id, actor);
  }
  const at = nowIso();
  for (const f of of('shipment')) {
    const b = JSON.parse(f.before || '{}');
    db().prepare('UPDATE shipments SET status = ?, delivered_at = ?, returned_at = ?, statement_id = NULL, updated_at = ? WHERE id = ?').run(b.status ?? 'in_transit', b.delivered_at ?? null, b.returned_at ?? null, at, f.ref_id);
  }
  db().prepare('UPDATE carrier_statements SET voided_at = ?, void_reason = ?, voided_by = ? WHERE id = ?').run(at, reason, actor?.id ?? null, id);
  audit(actor, 'carrier_statement.voided', 'carrier_statement', id, { code, total_cod: pv.statement.total_cod, total_fees: pv.statement.total_fees }, { reason, undone: pv.undo });
  return getStatement(id);
}
