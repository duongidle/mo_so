import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate } from '../../lib/time.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/events.js';
import { dailyCode } from '../../lib/codes.js';
import { getOrder, transitionOrder, addOrderPayment, addSellerShippingPayment, createReturn } from '../orders/service.js';
import { createExpense } from '../expenses/service.js';

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
  if (!lines.length) return;
  createReturn(o.id, { lines, reason, reasonCode: 'customer_refused', awaitingGoods: true, shippingRefund: Math.max(0, o.shipping_fee - o.returned_shipping_amount) }, actor);
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
  const insLine = db().prepare('INSERT INTO carrier_statement_lines (id, statement_id, tracking_code, shipment_id, order_id, outcome, cod_stated, cod_recorded, ship_fee, cod_fee, return_fee, other_fee, result, warning) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  let totalCod = 0;
  let totalFees = 0;
  const feeByShop = new Map();
  for (const l of pv.lines) {
    let recorded = 0;
    if (l.result === 'applied') {
      const s = db().prepare('SELECT * FROM shipments WHERE id = ?').get(l.shipment_id);
      let o = getOrder(s.order_id);
      if (l.outcome === 'delivered') {
        if (o.status === 'shipping') transitionOrder(o.id, 'completed', { actor, note: `Hãng ${carrier.name} giao thành công` });
        o = getOrder(o.id);
        recorded = Math.min(l.cod_stated, o.amount_due);
        if (recorded > 0) addOrderPayment(o.id, { amount: recorded, method: PAYOUT, paidAt, note: `Đối soát ${code}` }, actor);
      } else if (o.status === 'shipping') {
        autoReturnAll(o, actor, `Hãng ${carrier.name} hoàn hàng (${code})`);
      }
      o = getOrder(o.id);
      const offset = Math.min(l.ship_fee, o.seller_shipping_due);
      if (offset > 0) addSellerShippingPayment(o.id, { amount: offset, method: PAYOUT, paidAt, note: `Hãng trừ phí giao khi đối soát ${code}` }, actor);
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
    createExpense({ category_id: 'ecat_shipping', shop_id: shopId, amount, expense_date: day, method: PAYOUT, payee: carrier.name, note: `Phí hãng ${carrier.name} trừ khi đối soát ${code}` }, actor);
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
