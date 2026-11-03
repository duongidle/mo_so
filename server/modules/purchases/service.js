import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, toIso } from '../../lib/time.js';
import { allocate } from '../../lib/money.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, emit } from '../../lib/events.js';
import { dailyCode, runningCode } from '../../lib/codes.js';
import { applyMovement, getLevel } from '../inventory/service.js';
import { recordPayment, listPaymentsFor } from '../payments/service.js';

const db = () => getDb();

// ---------- Nhà cung cấp ----------
export function listSuppliers(q) {
  const rows = db()
    .prepare(
      `SELECT s.*,
        COALESCE((SELECT SUM(total_amount - paid_amount) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'received'),0) AS debt
       FROM suppliers s WHERE s.archived_at IS NULL ${q ? 'AND (s.name LIKE ? OR s.phone LIKE ?)' : ''} ORDER BY s.name`,
    )
    .all(...(q ? [`%${q}%`, `%${q}%`] : []));
  return rows;
}

export function createSupplier(input, actor) {
  const id = newId('sup');
  const at = nowIso();
  db()
    .prepare('INSERT INTO suppliers (id, code, name, phone, address, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, runningCode('NCC', 4), input.name, input.phone ?? null, input.address ?? null, input.note ?? null, at, at);
  const s = db().prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  audit(actor, 'supplier.created', 'supplier', id, null, s);
  return s;
}

export function updateSupplier(id, input, actor) {
  const before = db().prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!before) throw notFound('Nhà cung cấp');
  const n = { ...before, ...input, updated_at: nowIso() };
  db()
    .prepare('UPDATE suppliers SET name=?, phone=?, address=?, note=?, archived_at=?, updated_at=? WHERE id=?')
    .run(n.name, n.phone, n.address, n.note, n.archived_at, n.updated_at, id);
  audit(actor, 'supplier.updated', 'supplier', id, before, n);
  return db().prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
}

// ---------- Phiếu nhập ----------
export function getPurchase(id) {
  const p = db()
    .prepare(
      `SELECT p.*, s.name AS supplier_name, w.name AS warehouse_name FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id JOIN warehouses w ON w.id = p.warehouse_id WHERE p.id = ?`,
    )
    .get(id);
  if (!p) throw notFound('Phiếu nhập');
  p.lines = db()
    .prepare(
      `SELECT l.*, v.sku, v.name AS variant_name, pr.name AS product_name, pr.unit FROM purchase_lines l
       JOIN variants v ON v.id = l.variant_id JOIN products pr ON pr.id = v.product_id
       WHERE l.purchase_id = ? ORDER BY l.sort_order`,
    )
    .all(id);
  p.payments = listPaymentsFor('purchase', id);
  p.debt = p.status === 'received' ? p.total_amount - p.paid_amount : 0;
  return p;
}

export function listPurchases({ status, supplierId, shopId, limit = 50, cursor }) {
  const where = [];
  const params = [];
  if (status) (where.push('p.status = ?'), params.push(status));
  if (supplierId) (where.push('p.supplier_id = ?'), params.push(supplierId));
  if (shopId) (where.push('p.shop_id = ?'), params.push(shopId));
  if (cursor) (where.push('p.id < ?'), params.push(cursor));
  const rows = db()
    .prepare(
      `SELECT p.*, s.name AS supplier_name, (SELECT COUNT(*) FROM purchase_lines l WHERE l.purchase_id = p.id) AS line_count
       FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT ?`,
    )
    .all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, next_cursor: hasMore ? data[data.length - 1].id : null };
}

function computeTotals(lines, { discount_amount = 0, shipping_fee = 0, other_fee = 0 }) {
  const subtotal = lines.reduce((a, l) => a + l.qty * l.unit_cost, 0);
  if (discount_amount > subtotal) throw badRequest('INVALID_DISCOUNT', 'Chiết khấu lớn hơn tổng tiền hàng');
  const total = subtotal - discount_amount + shipping_fee + other_fee;
  // Phân bổ (phí − chiết khấu) theo giá trị dòng để ra giá vốn thực
  const extra = shipping_fee + other_fee - discount_amount;
  const alloc = allocate(Math.abs(extra), lines.map((l) => l.qty * l.unit_cost)).map((x) => (extra < 0 ? -x : x));
  const computed = lines.map((l, i) => {
    const lineTotal = l.qty * l.unit_cost;
    const landedTotal = lineTotal + alloc[i];
    return { ...l, line_total: lineTotal, allocated_cost: alloc[i], landed_unit_cost: Math.round(landedTotal / l.qty) };
  });
  return { subtotal, total, lines: computed };
}

function writeLines(purchaseId, lines) {
  db().prepare('DELETE FROM purchase_lines WHERE purchase_id = ?').run(purchaseId);
  const ins = db().prepare(
    `INSERT INTO purchase_lines (id, purchase_id, variant_id, qty, unit_cost, line_total, allocated_cost, landed_unit_cost, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  lines.forEach((l, i) => {
    const v = db().prepare('SELECT id, kind FROM variants WHERE id = ?').get(l.variant_id);
    if (!v) throw notFound(`Biến thể ${l.variant_id}`);
    if (v.kind === 'bundle') throw badRequest('BUNDLE_NO_STOCK', 'Không nhập hàng cho combo. Nhập từng sản phẩm thành phần.');
    ins.run(newId('pul'), purchaseId, l.variant_id, l.qty, l.unit_cost, l.line_total, l.allocated_cost, l.landed_unit_cost, i);
  });
}

export function createPurchase(input, actor) {
  const id = newId('pur');
  const at = nowIso();
  const orderedAt = toIso(input.ordered_at) || at;
  const t = computeTotals(input.lines, input);
  const code = dailyCode('PN', null, orderedAt);
  db()
    .prepare(
      `INSERT INTO purchases (id, code, supplier_id, warehouse_id, shop_id, status, subtotal, discount_amount, shipping_fee, other_fee,
         total_amount, paid_amount, note, supplier_ref, ordered_at, created_at, updated_at)
       VALUES (?,?,?,?,?,'draft',?,?,?,?,?,0,?,?,?,?,?)`,
    )
    .run(id, code, input.supplier_id ?? null, input.warehouse_id, input.shop_id ?? null, t.subtotal, input.discount_amount ?? 0, input.shipping_fee ?? 0, input.other_fee ?? 0, t.total, input.note ?? null, input.supplier_ref ?? null, orderedAt, at, at);
  writeLines(id, t.lines);
  audit(actor, 'purchase.created', 'purchase', id, null, input);
  if (input.receive) receivePurchase(id, actor);
  if (input.paid_amount) addPurchasePayment(id, { amount: input.paid_amount, method: input.payment_method ?? 'cash' }, actor);
  return getPurchase(id);
}

export function updatePurchase(id, input, actor) {
  const before = getPurchase(id);
  if (before.status !== 'draft') throw conflict('NOT_DRAFT', 'Chỉ sửa được phiếu nhập ở trạng thái nháp');
  const merged = { ...before, ...input };
  const lines = input.lines ?? before.lines.map((l) => ({ variant_id: l.variant_id, qty: l.qty, unit_cost: l.unit_cost }));
  const t = computeTotals(lines, merged);
  db()
    .prepare(
      `UPDATE purchases SET supplier_id=?, warehouse_id=?, shop_id=?, subtotal=?, discount_amount=?, shipping_fee=?, other_fee=?,
        total_amount=?, note=?, supplier_ref=?, ordered_at=?, updated_at=? WHERE id=?`,
    )
    .run(merged.supplier_id, merged.warehouse_id, merged.shop_id, t.subtotal, merged.discount_amount, merged.shipping_fee, merged.other_fee, t.total, merged.note, merged.supplier_ref, toIso(merged.ordered_at) || before.ordered_at, nowIso(), id);
  writeLines(id, t.lines);
  const after = getPurchase(id);
  audit(actor, 'purchase.updated', 'purchase', id, before, after);
  return after;
}

export function receivePurchase(id, actor) {
  const p = getPurchase(id);
  if (p.status !== 'draft') throw conflict('INVALID_STATUS', 'Phiếu nhập đã được nhận hoặc đã huỷ');
  const at = nowIso();
  for (const l of p.lines) {
    applyMovement({
      warehouseId: p.warehouse_id,
      variantId: l.variant_id,
      type: 'purchase_in',
      qty: l.qty,
      unitCost: l.landed_unit_cost,
      refType: 'purchase',
      refId: id,
      refLineId: l.id,
      shopId: p.shop_id,
      actorId: actor?.id,
      at,
    });
  }
  db().prepare("UPDATE purchases SET status='received', received_at=?, updated_at=? WHERE id=?").run(at, at, id);
  const after = getPurchase(id);
  audit(actor, 'purchase.received', 'purchase', id, p, after);
  emit('purchase.received', { entityType: 'purchase', entityId: id, shopId: p.shop_id, data: after });
  return after;
}

export function cancelPurchase(id, reason, actor, { refundMethod } = {}) {
  const p = getPurchase(id);
  if (p.status === 'cancelled') throw conflict('INVALID_STATUS', 'Phiếu nhập đã huỷ');
  // Đã trả tiền NCC thì huỷ phiếu phải kèm việc NCC hoàn lại tiền, nếu không tiền đã chi nằm đó mà không có hàng, không có công nợ
  if (p.paid_amount > 0 && !refundMethod) {
    throw conflict('PURCHASE_PAID', `Phiếu đã trả NCC ${p.paid_amount} ₫. Huỷ phiếu cần ghi nhận NCC hoàn lại số tiền này (chọn phương thức hoàn).`, { paid_amount: p.paid_amount });
  }
  const at = nowIso();
  if (p.status === 'received') {
    for (const l of p.lines) {
      const level = getLevel(p.warehouse_id, l.variant_id);
      if (level.on_hand < l.qty) {
        throw conflict('STOCK_NOT_ENOUGH', `Không thể huỷ: hàng ${l.sku} đã bán bớt (còn ${level.on_hand}, cần rút ${l.qty}). Hãy tạo phiếu điều chỉnh thay vì huỷ.`);
      }
    }
    for (const l of p.lines) {
      applyMovement({ warehouseId: p.warehouse_id, variantId: l.variant_id, type: 'purchase_cancel_out', qty: l.qty, unitCost: l.landed_unit_cost, refType: 'purchase', refId: id, refLineId: l.id, shopId: p.shop_id, note: reason, actorId: actor?.id, at });
    }
  }
  if (p.paid_amount > 0) {
    recordPayment({ direction: 'in', refType: 'purchase', refId: id, shopId: p.shop_id, amount: p.paid_amount, method: refundMethod, paidAt: at, note: 'NCC hoàn tiền do huỷ phiếu nhập' }, actor);
    db().prepare('UPDATE purchases SET paid_amount = 0 WHERE id = ?').run(id);
  }
  db().prepare("UPDATE purchases SET status='cancelled', cancelled_at=?, note=COALESCE(note || ' | ', '') || ?, updated_at=? WHERE id=?").run(at, `Huỷ: ${reason || ''}`, at, id);
  const after = getPurchase(id);
  audit(actor, 'purchase.cancelled', 'purchase', id, p, after);
  emit('purchase.cancelled', { entityType: 'purchase', entityId: id, shopId: p.shop_id, data: after });
  return after;
}

export function addPurchasePayment(id, { amount, method, paidAt, note }, actor) {
  const p = getPurchase(id);
  if (p.status === 'cancelled') throw conflict('INVALID_STATUS', 'Phiếu nhập đã huỷ');
  if (p.paid_amount + amount > p.total_amount) throw badRequest('OVERPAID', 'Số tiền trả vượt tổng phiếu nhập');
  recordPayment({ direction: 'out', refType: 'purchase', refId: id, shopId: p.shop_id, amount, method, paidAt, note }, actor);
  db().prepare('UPDATE purchases SET paid_amount = paid_amount + ?, updated_at = ? WHERE id = ?').run(amount, nowIso(), id);
  const after = getPurchase(id);
  audit(actor, 'purchase.payment', 'purchase', id, null, { amount, method });
  return after;
}
