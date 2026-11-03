import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { audit, emit } from '../../lib/events.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { runningCode } from '../../lib/codes.js';
import { elementOfBirth, compatibleElements } from '../../lib/lunar.js';

const db = () => getDb();

/** Chuẩn hoá SĐT Việt Nam về dạng 0xxxxxxxxx. Trả null nếu không hợp lệ. */
export function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[^\d+]/g, '');
  if (p.startsWith('+84')) p = '0' + p.slice(3);
  else if (p.startsWith('84') && p.length === 11) p = '0' + p.slice(2);
  if (!p.startsWith('0')) p = '0' + p;
  return /^0\d{9,10}$/.test(p) ? p : null;
}

function enrich(c) {
  if (!c) return null;
  const el = elementOfBirth({ birthDate: c.birth_date, birthYear: c.birth_year });
  const element = c.element_override || el?.element || null;
  return {
    ...c,
    tags: JSON.parse(c.tags || '[]'),
    feng_shui: element
      ? {
          element,
          source: c.element_override ? 'manual' : el.approximate ? 'birth_year' : 'birth_date',
          can_chi: el?.can_chi ?? null,
          nap_am: el?.nap_am ?? null,
          compatible_elements: compatibleElements(element),
          approximate: !c.element_override && !!el?.approximate,
        }
      : null,
  };
}

export function getCustomer(id) {
  let c = db().prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) throw notFound('Khách hàng');
  if (c.merged_into) c = db().prepare('SELECT * FROM customers WHERE id = ?').get(c.merged_into);
  return enrich(c);
}

export function getCustomerDetail(id) {
  const c = getCustomer(id);
  c.notes = db()
    .prepare('SELECT n.*, s.name AS shop_name FROM customer_notes n LEFT JOIN shops s ON s.id = n.shop_id WHERE customer_id = ? ORDER BY created_at DESC')
    .all(c.id);
  c.by_shop = db()
    .prepare(
      `SELECT o.shop_id, s.name AS shop_name, COUNT(*) AS order_count, SUM(o.net_revenue) AS spent, MAX(o.ordered_at) AS last_order_at
       FROM orders o JOIN shops s ON s.id = o.shop_id
       WHERE o.customer_id = ? AND o.status IN ('confirmed','shipping','completed','returned') GROUP BY o.shop_id`,
    )
    .all(c.id);
  return c;
}

export function findByPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  const c = db().prepare('SELECT * FROM customers WHERE (phone = ? OR phone2 = ?) AND merged_into IS NULL').get(p, p);
  return c ? enrich(c) : null;
}

export function listCustomers({ q, tag, element, limit = 50, cursor, sort = 'recent' }) {
  const where = ['merged_into IS NULL', 'archived_at IS NULL'];
  const params = [];
  if (q) {
    const p = normalizePhone(q);
    where.push(`(name LIKE ? OR code LIKE ? OR phone LIKE ? OR email LIKE ? OR shopee_username LIKE ?${p ? ' OR phone = ? OR phone2 = ?' : ''})`);
    params.push(`%${q}%`, `%${q}%`, `%${q.replace(/\D/g, '') || q}%`, `%${q}%`, `%${q}%`);
    if (p) params.push(p, p);
  }
  if (tag) (where.push(`EXISTS (SELECT 1 FROM json_each(customers.tags) WHERE value = ?)`), params.push(tag));
  const orderBy = { recent: 'id DESC', spent: 'total_spent DESC, id DESC', last_order: 'last_order_at DESC NULLS LAST, id DESC', name: 'name, id' }[sort] || 'id DESC';
  // Phân trang bằng offset khi sắp xếp khác mặc định (đơn giản, đủ cho quy mô nhỏ)
  const offset = cursor && sort !== 'recent' ? Number(cursor) : 0;
  if (cursor && sort === 'recent') (where.push('id < ?'), params.push(cursor));
  let rows = db()
    .prepare(`SELECT * FROM customers WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, limit + 1, offset)
    .map(enrich);
  if (element) rows = rows.filter((r) => r.feng_shui?.element === element);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const next = hasMore ? (sort === 'recent' ? data[data.length - 1].id : String(offset + limit)) : null;
  return { data, next_cursor: next };
}

const FIELDS = ['name', 'phone', 'phone2', 'email', 'facebook_url', 'shopee_username', 'gender', 'birth_date', 'birth_year', 'element_override', 'address', 'note', 'tags', 'source_channel', 'archived_at'];

function prepare(input) {
  const out = { ...input };
  if (out.phone !== undefined) {
    out.phone = out.phone ? normalizePhone(out.phone) : null;
    if (input.phone && !out.phone) throw badRequest('INVALID_PHONE', `Số điện thoại không hợp lệ: ${input.phone}`);
  }
  if (out.phone2 !== undefined) out.phone2 = out.phone2 ? normalizePhone(out.phone2) : null;
  if (out.birth_date) out.birth_year = Number(out.birth_date.slice(0, 4));
  if (out.tags !== undefined) out.tags = JSON.stringify(out.tags ?? []);
  return out;
}

export function createCustomer(input, actor) {
  const data = prepare(input);
  if (data.phone) {
    const dup = findByPhone(data.phone);
    if (dup) throw conflict('CUSTOMER_EXISTS', `Số ${data.phone} đã thuộc khách ${dup.name} (${dup.code})`, { customer_id: dup.id });
  }
  const id = newId('cus');
  const at = nowIso();
  const cols = ['id', 'code', ...FIELDS.filter((f) => data[f] !== undefined), 'created_at', 'updated_at'];
  const vals = [id, runningCode('KH', 5), ...FIELDS.filter((f) => data[f] !== undefined).map((f) => data[f]), at, at];
  db().prepare(`INSERT INTO customers (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  const c = getCustomer(id);
  audit(actor, 'customer.created', 'customer', id, null, c);
  emit('customer.created', { entityType: 'customer', entityId: id, data: c });
  return c;
}

export function updateCustomer(id, input, actor) {
  const before = getCustomer(id);
  const data = prepare(input);
  if (data.phone && data.phone !== before.phone) {
    const dup = findByPhone(data.phone);
    if (dup && dup.id !== id) throw conflict('CUSTOMER_EXISTS', `Số ${data.phone} đã thuộc khách ${dup.name} (${dup.code})`, { customer_id: dup.id });
  }
  const sets = FIELDS.filter((f) => data[f] !== undefined);
  if (sets.length) {
    db()
      .prepare(`UPDATE customers SET ${sets.map((f) => `${f}=?`).join(', ')}, updated_at=? WHERE id=?`)
      .run(...sets.map((f) => data[f]), nowIso(), before.id);
  }
  const after = getCustomer(before.id);
  audit(actor, 'customer.updated', 'customer', before.id, before, after);
  emit('customer.updated', { entityType: 'customer', entityId: before.id, data: after });
  return after;
}

/**
 * Tìm hoặc tạo khách theo SĐT (dùng khi tạo đơn / import).
 * Có SĐT → tìm; không thấy thì tạo. Không SĐT → tạo mới nếu có tên (khách Facebook).
 */
export function findOrCreateCustomer({ name, phone, address, facebook_url, shopee_username, source_channel }, actor) {
  const p = normalizePhone(phone);
  if (p) {
    const found = findByPhone(p);
    if (found) {
      const patch = {};
      if (!found.address && address) patch.address = address;
      if (!found.facebook_url && facebook_url) patch.facebook_url = facebook_url;
      if (!found.shopee_username && shopee_username) patch.shopee_username = shopee_username;
      return Object.keys(patch).length ? updateCustomer(found.id, patch, actor) : found;
    }
  }
  if (!p && shopee_username) {
    const found = db().prepare('SELECT * FROM customers WHERE shopee_username = ? AND merged_into IS NULL').get(shopee_username);
    if (found) return enrich(found);
  }
  if (!p && facebook_url) {
    const found = db().prepare('SELECT * FROM customers WHERE facebook_url = ? AND merged_into IS NULL').get(facebook_url);
    if (found) return enrich(found);
  }
  if (!name && !p) return null;
  return createCustomer({ name: name || p, phone: p, address, facebook_url, shopee_username, source_channel }, actor);
}

/** Gộp khách `sourceId` vào `targetId`: chuyển đơn, ghi chú; bổ sung thông tin còn thiếu. */
export function mergeCustomers(targetId, sourceId, actor) {
  if (targetId === sourceId) throw badRequest('SAME_CUSTOMER', 'Không thể gộp một khách với chính nó');
  const target = getCustomer(targetId);
  const source = getCustomer(sourceId);
  const at = nowIso();
  db().prepare('UPDATE orders SET customer_id = ?, updated_at = ? WHERE customer_id = ?').run(target.id, at, source.id);
  db().prepare('UPDATE customer_notes SET customer_id = ? WHERE customer_id = ?').run(target.id, source.id);
  const fill = {};
  for (const f of ['phone2', 'email', 'facebook_url', 'shopee_username', 'gender', 'birth_date', 'birth_year', 'address']) {
    if (!target[f] && source[f]) fill[f] = source[f];
  }
  if (!target.phone2 && source.phone && source.phone !== target.phone) fill.phone2 = source.phone;
  fill.tags = [...new Set([...target.tags, ...source.tags])];
  // Giải phóng SĐT của hồ sơ bị gộp trước khi gán vào hồ sơ giữ lại (tránh trùng unique)
  db().prepare('UPDATE customers SET merged_into = ?, archived_at = ?, updated_at = ? WHERE id = ?').run(target.id, at, at, source.id);
  updateCustomer(target.id, fill, actor);
  recalcCustomerStats(target.id);
  const after = getCustomer(target.id);
  audit(actor, 'customer.merged', 'customer', target.id, { source }, after);
  emit('customer.merged', { entityType: 'customer', entityId: target.id, data: { target_id: target.id, source_id: source.id } });
  return after;
}

/** Danh sách nghi trùng: cùng tên chuẩn hoá, hoặc phone của người này = phone2 người kia */
export function findDuplicateCandidates(limit = 50) {
  return db()
    .prepare(
      `SELECT a.id AS a_id, a.code AS a_code, a.name AS a_name, a.phone AS a_phone,
              b.id AS b_id, b.code AS b_code, b.name AS b_name, b.phone AS b_phone,
              CASE WHEN a.phone IS NOT NULL AND (a.phone = b.phone2 OR a.phone2 = b.phone) THEN 'phone' ELSE 'name' END AS reason
       FROM customers a JOIN customers b ON a.id < b.id
       WHERE a.merged_into IS NULL AND b.merged_into IS NULL AND a.archived_at IS NULL AND b.archived_at IS NULL
         AND (lower(trim(a.name)) = lower(trim(b.name)) OR (a.phone IS NOT NULL AND (a.phone = b.phone2 OR a.phone2 = b.phone)))
       LIMIT ?`,
    )
    .all(limit);
}

/** Tính lại số đơn, tổng chi tiêu, ngày mua đầu/cuối từ đơn thật */
export function recalcCustomerStats(customerId) {
  if (!customerId) return;
  const s = db()
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(net_revenue),0) AS spent, MIN(ordered_at) AS first_at, MAX(ordered_at) AS last_at,
              (SELECT channel_id FROM orders WHERE customer_id = ? AND status IN ('confirmed','shipping','completed','returned') ORDER BY ordered_at LIMIT 1) AS first_channel
       FROM orders WHERE customer_id = ? AND status IN ('confirmed','shipping','completed','returned')`,
    )
    .get(customerId, customerId);
  db()
    .prepare(
      `UPDATE customers SET order_count = ?, total_spent = ?, first_order_at = ?, last_order_at = ?,
        source_channel = COALESCE(source_channel, ?), updated_at = ? WHERE id = ?`,
    )
    .run(s.n, s.spent, s.first_at, s.last_at, s.first_channel, nowIso(), customerId);
}

export function addNote(customerId, { content, shopId }, actor) {
  const c = getCustomer(customerId);
  const id = newId('cnt');
  db()
    .prepare('INSERT INTO customer_notes (id, customer_id, shop_id, content, actor_id, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, c.id, shopId ?? null, content, actor?.id ?? null, nowIso());
  return db().prepare('SELECT * FROM customer_notes WHERE id = ?').get(id);
}
