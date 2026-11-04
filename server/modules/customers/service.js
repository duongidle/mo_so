import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { audit, emit } from '../../lib/events.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { runningCode } from '../../lib/codes.js';
import { compatibleElements } from '../../lib/lunar.js';
import { asDay } from '../../lib/formula.js';
import { businessDate } from '../../lib/time.js';
import { listFields, getValuesWithMeta, getValues, roleValues, listColumnValues, derivedValue, ageOfCustomer, applyFieldDefaults } from '../custom/service.js';
import { shopHasFeature } from '../shops/service.js';

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
  const { tags: _legacy, ...rest } = c; // cột `tags` chung cũ không còn dùng: nhãn là của từng shop (bảng customer_tags)
  return { ...rest, age: ageOfCustomer(rest) };
}

/**
 * Mệnh hiệu lực của khách trong MỘT shop: ghi đè của shop (trường vai trò element) nếu có, không thì tự tính từ ngày/năm sinh
 * CHUNG của hồ sơ khách. `values` = { birth_date, birth_year, element (ghi đè) } từ roleValues.
 * Chỉ dùng cho shop ngành bật tính năng feng_shui (nơi gọi kiểm); không có dữ liệu thì null.
 */
export function fengShuiOf(values) {
  if (!values) return null;
  const d = derivedValue('element', { birth_date: values.birth_date, birth_year: values.birth_year, override: values.element });
  if (!d) return null;
  return {
    element: d.value,
    source: d.source === 'override' ? 'manual' : d.source === 'approximate' ? 'birth_year' : 'birth_date',
    effective_source: d.source, // override | computed | approximate
    can_chi: d.can_chi,
    nap_am: d.nap_am,
    compatible_elements: compatibleElements(d.value),
    approximate: d.source === 'approximate',
  };
}

// ---------- Thành viên shop ----------
/** Khách này thuộc danh sách khách của shop. Gọi khi khách mua ở shop, được thêm vào shop, hoặc nhập thông tin riêng. */
export function ensureMember(customerId, shopId) {
  db()
    .prepare('INSERT INTO customer_shops (customer_id, shop_id, added_at) VALUES (?,?,?) ON CONFLICT(customer_id, shop_id) DO UPDATE SET removed_at = NULL')
    .run(customerId, shopId, nowIso());
  db().prepare('UPDATE customers SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL AND merged_into IS NULL').run(customerId);
}

export const isMember = (customerId, shopId) =>
  !!db().prepare('SELECT 1 FROM customer_shops WHERE customer_id = ? AND shop_id = ? AND removed_at IS NULL').get(customerId, shopId);

function assertShop(shopId) {
  const s = db().prepare('SELECT id FROM shops WHERE id = ?').get(shopId);
  if (!s) throw notFound('Shop');
}

/** Thêm một khách có sẵn (đang ở shop khác hoặc chưa thuộc shop nào) vào danh sách khách của shop */
export function addToShop(customerId, shopId, actor) {
  const c = getCustomer(customerId);
  assertShop(shopId);
  ensureMember(c.id, shopId);
  audit(actor, 'customer.added_to_shop', 'customer', c.id, null, { shop_id: shopId });
  return { customer_id: c.id, shop_id: shopId, is_member: true };
}

/**
 * Xoá khách khỏi MỘT shop. Chỉ đụng dữ liệu của shop đó: thông tin riêng, nhãn, ghi chú của shop.
 * Khách ở shop khác, hồ sơ chung và lịch sử đơn hàng (đơn vẫn lưu tên/SĐT lúc mua) giữ nguyên.
 * Khách không còn ở shop nào và chưa từng có đơn thì được lưu trữ (ẩn), không xoá cứng.
 * Dữ liệu bị xoá được ghi vào nhật ký (audit_log) để khôi phục tay nếu xoá nhầm.
 */
export function removeFromShop(customerId, shopId, actor) {
  const c = getCustomer(customerId);
  assertShop(shopId);
  if (!isMember(c.id, shopId)) throw conflict('NOT_MEMBER', 'Khách này không có trong danh sách của shop');
  const before = {
    values: getValues('customer', c.id, { shopId }),
    tags: shopTags(c.id, shopId),
    notes: db().prepare('SELECT content, created_at FROM customer_notes WHERE customer_id = ? AND shop_id = ?').all(c.id, shopId),
  };
  db().prepare(`DELETE FROM custom_values WHERE entity_type = 'customer' AND entity_id = ? AND field_id IN (SELECT id FROM custom_fields WHERE entity_type = 'customer' AND shop_id = ?)`).run(c.id, shopId);
  db().prepare('DELETE FROM customer_tags WHERE customer_id = ? AND shop_id = ?').run(c.id, shopId);
  db().prepare('DELETE FROM customer_notes WHERE customer_id = ? AND shop_id = ?').run(c.id, shopId);
  db().prepare('UPDATE customer_shops SET removed_at = ? WHERE customer_id = ? AND shop_id = ?').run(nowIso(), c.id, shopId);
  const stillIn = db().prepare('SELECT COUNT(*) AS n FROM customer_shops WHERE customer_id = ? AND removed_at IS NULL').get(c.id).n;
  const orders = db().prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?').get(c.id).n;
  const archived = stillIn === 0 && orders === 0;
  if (archived) db().prepare('UPDATE customers SET archived_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), c.id);
  audit(actor, 'customer.removed_from_shop', 'customer', c.id, { shop_id: shopId, ...before }, null);
  emit('customer.removed', { entityType: 'customer', entityId: c.id, shopId, data: { customer_id: c.id, shop_id: shopId, archived } });
  return { removed: true, archived, still_in_shops: stillIn, orders_kept: orders };
}

// ---------- Nhãn khách (của từng shop) ----------
const MAX_TAGS = 20;
const normTag = (t) => String(t).normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 30);

export const shopTags = (customerId, shopId) =>
  db().prepare('SELECT tag FROM customer_tags WHERE customer_id = ? AND shop_id = ? ORDER BY tag COLLATE NOCASE').all(customerId, shopId).map((r) => r.tag);

/** Đặt lại toàn bộ nhãn của khách trong một shop. Trùng (không phân biệt hoa thường) và rỗng bị bỏ. */
export function setShopTags(customerId, shopId, tags, actor) {
  const c = getCustomer(customerId);
  assertShop(shopId);
  const seen = new Set();
  const clean = [];
  for (const t of tags.map(normTag)) {
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    clean.push(t);
  }
  if (clean.length > MAX_TAGS) throw badRequest('TOO_MANY_TAGS', `Mỗi khách tối đa ${MAX_TAGS} nhãn trong một shop`);
  ensureMember(c.id, shopId);
  const before = shopTags(c.id, shopId);
  db().prepare('DELETE FROM customer_tags WHERE customer_id = ? AND shop_id = ?').run(c.id, shopId);
  const ins = db().prepare('INSERT INTO customer_tags (customer_id, shop_id, tag) VALUES (?,?,?)');
  for (const t of clean) ins.run(c.id, shopId, t);
  audit(actor, 'customer.tags_changed', 'customer', c.id, { shop_id: shopId, tags: before }, { shop_id: shopId, tags: clean });
  return shopTags(c.id, shopId);
}

/** Các nhãn đang dùng trong shop kèm số khách (chỉ khách còn trong shop) */
export const listShopTagCounts = (shopId) =>
  db()
    .prepare(
      `SELECT t.tag, COUNT(*) AS count FROM customer_tags t
       JOIN customer_shops m ON m.customer_id = t.customer_id AND m.shop_id = t.shop_id AND m.removed_at IS NULL
       WHERE t.shop_id = ? GROUP BY t.tag COLLATE NOCASE ORDER BY count DESC, t.tag COLLATE NOCASE`,
    )
    .all(shopId);

const shopHasFengShui = (shopId) => !!shopId && shopHasFeature(shopId, 'feng_shui');

export function getCustomer(id) {
  let c = db().prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) throw notFound('Khách hàng');
  if (c.merged_into) c = db().prepare('SELECT * FROM customers WHERE id = ?').get(c.merged_into);
  return enrich(c);
}

export function getCustomerDetail(id, { shopId } = {}) {
  const c = getCustomer(id);
  if (shopId) {
    // Phần thông tin riêng của shop đang xem; shop khác không lọt vào
    c.is_member = isMember(c.id, shopId);
    const meta = getValuesWithMeta('customer', c.id, { shopId });
    c.shop_profile = {
      shop_id: shopId,
      fields: listFields('customer', { shopId }),
      values: meta.values,
      reasons: meta.reasons, // vì sao trường công thức trống
      element: meta.element, // mệnh hiệu lực (shop phong thuỷ): { key, value, source: override|computed|approximate }
      tags: shopTags(c.id, shopId),
    };
    c.feng_shui = shopHasFengShui(shopId) ? fengShuiOf(roleValues(shopId, [c.id]).get(c.id)) : null;
  }
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
  // Shop còn nợ khách này (trả hàng mà chưa hoàn đủ tiền), cộng mọi shop
  c.refund_owed_amount = db().prepare("SELECT COALESCE(SUM(refund_owed_amount),0) AS v FROM orders WHERE customer_id = ? AND status IN ('confirmed','shipping','completed','returned')").get(c.id).v;
  return c;
}

export function findByPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  const c = db().prepare('SELECT * FROM customers WHERE (phone = ? OR phone2 = ?) AND merged_into IS NULL').get(p, p);
  return c ? enrich(c) : null;
}

export function listCustomers({ q, tag, element, shopId, limit = 50, cursor, sort = 'recent' }) {
  const where = ['merged_into IS NULL', 'archived_at IS NULL'];
  const params = [];
  if (q) {
    const p = normalizePhone(q);
    where.push(`(name LIKE ? OR code LIKE ? OR phone LIKE ? OR email LIKE ? OR shopee_username LIKE ?${p ? ' OR phone = ? OR phone2 = ?' : ''})`);
    params.push(`%${q}%`, `%${q}%`, `%${q.replace(/\D/g, '') || q}%`, `%${q}%`, `%${q}%`);
    if (p) params.push(p, p);
  }
  if (shopId) {
    // Danh sách khách của một shop = khách còn là thành viên của shop đó
    where.push('EXISTS (SELECT 1 FROM customer_shops m WHERE m.customer_id = customers.id AND m.shop_id = ? AND m.removed_at IS NULL)');
    params.push(shopId);
  }
  if (tag) {
    if (!shopId) throw badRequest('SHOP_REQUIRED', 'Nhãn là của từng shop: cần chỉ rõ shop_id khi lọc theo nhãn');
    where.push('EXISTS (SELECT 1 FROM customer_tags t WHERE t.customer_id = customers.id AND t.shop_id = ? AND t.tag = ? COLLATE NOCASE)');
    params.push(shopId, tag);
  }
  const orderBy = { recent: 'id DESC', spent: 'total_spent DESC, id DESC', last_order: 'last_order_at DESC NULLS LAST, id DESC', name: 'name, id' }[sort] || 'id DESC';
  // Lọc theo mệnh phải lọc TRƯỚC khi phân trang (mệnh tính từ trường của shop, không nằm trong SQL):
  // lấy hết khách khớp điều kiện rồi lọc, phân trang theo offset. Quy mô một chủ shop nên đủ nhanh.
  const byElement = !!element && shopHasFengShui(shopId);
  // Phân trang bằng offset khi sắp xếp khác mặc định hoặc khi lọc theo mệnh; mặc định dùng con trỏ id
  const useOffset = sort !== 'recent' || byElement;
  const offset = cursor && useOffset ? Number(cursor) : 0;
  if (cursor && !useOffset) (where.push('id < ?'), params.push(cursor));
  let rows = db()
    .prepare(`SELECT * FROM customers WHERE ${where.join(' AND ')} ORDER BY ${orderBy} ${byElement ? '' : 'LIMIT ? OFFSET ?'}`)
    .all(...params, ...(byElement ? [] : [limit + 1, offset]))
    .map(enrich);
  if (shopHasFengShui(shopId)) {
    const rv = roleValues(shopId, rows.map((r) => r.id));
    rows = rows.map((r) => ({ ...r, feng_shui: fengShuiOf(rv.get(r.id)) }));
    if (byElement) rows = rows.filter((r) => r.feng_shui?.element === element).slice(offset, offset + limit + 1);
  }
  const hasMore = rows.length > limit;
  let data = hasMore ? rows.slice(0, limit) : rows;
  const next = hasMore ? (useOffset ? String(offset + limit) : data[data.length - 1].id) : null;
  // Cột thông tin riêng của shop (chỉ khi xem theo một shop)
  let columns = [];
  if (shopId) {
    const cv = listColumnValues(shopId, data.map((r) => r.id));
    columns = cv.columns;
    // Cột mệnh (trường ghi đè) hiện giá trị HIỆU LỰC, không phải ô trống khi mệnh tự tính
    const elCol = shopHasFengShui(shopId) ? columns.find((c) => c.role === 'element') : null;
    const derivedBy = new Map(); // customerId → { khoáTrường: nguồn } cho ô không phải do người dùng nhập
    if (elCol) {
      for (const r of data) {
        const vals = cv.values.get(r.id) || {};
        if (r.feng_shui) vals[elCol.key] = r.feng_shui.element;
        if (r.feng_shui && r.feng_shui.effective_source !== 'override') derivedBy.set(r.id, { [elCol.key]: r.feng_shui.effective_source });
        cv.values.set(r.id, vals);
      }
    }
    const tagRows = data.length
      ? db().prepare(`SELECT customer_id, tag FROM customer_tags WHERE shop_id = ? AND customer_id IN (${data.map(() => '?').join(',')}) ORDER BY tag COLLATE NOCASE`).all(shopId, ...data.map((r) => r.id))
      : [];
    const tagMap = new Map();
    for (const t of tagRows) tagMap.set(t.customer_id, [...(tagMap.get(t.customer_id) || []), t.tag]);
    data = data.map((r) => ({ ...r, shop_values: cv.values.get(r.id) || {}, shop_derived: derivedBy.get(r.id) || {}, shop_tags: tagMap.get(r.id) || [] }));
  }
  return { data, next_cursor: next, columns };
}

const FIELDS = ['name', 'phone', 'phone2', 'email', 'facebook_url', 'shopee_username', 'address', 'note', 'source_channel', 'birth_date', 'birth_year', 'archived_at'];

function prepare(input) {
  const out = { ...input };
  if (out.phone !== undefined) {
    out.phone = out.phone ? normalizePhone(out.phone) : null;
    if (input.phone && !out.phone) throw badRequest('INVALID_PHONE', `Số điện thoại không hợp lệ: ${input.phone}`);
  }
  if (out.phone2 !== undefined) out.phone2 = out.phone2 ? normalizePhone(out.phone2) : null;
  // Ngày sinh / năm sinh: thông tin chung của khách. Rỗng = xoá.
  if (out.birth_date !== undefined) {
    out.birth_date = out.birth_date || null;
    if (out.birth_date && (asDay(out.birth_date) !== out.birth_date || out.birth_date > businessDate())) throw badRequest('INVALID_BIRTH_DATE', 'Ngày sinh phải là ngày có thật (YYYY-MM-DD), không ở tương lai');
  }
  if (out.birth_year !== undefined) {
    out.birth_year = out.birth_year || null;
    if (out.birth_year !== null && (!Number.isInteger(out.birth_year) || out.birth_year < 1900 || out.birth_year > Number(businessDate().slice(0, 4)))) throw badRequest('INVALID_BIRTH_YEAR', 'Năm sinh phải từ 1900 đến năm nay');
  }
  return out;
}

export function createCustomer(input, actor, { shopId = null } = {}) {
  const { shop_id: _ignored, ...rest } = input;
  const data = prepare(rest);
  if (shopId) assertShop(shopId);
  if (data.phone) {
    const dup = findByPhone(data.phone);
    if (dup?.archived_at) {
      // Khách này từng bị xoá khỏi mọi shop: dùng lại hồ sơ cũ thay vì báo trùng
      const back = updateCustomer(dup.id, { ...rest, archived_at: null }, actor);
      if (shopId) ensureMember(dup.id, shopId);
      return back;
    }
    if (dup) {
      throw conflict('CUSTOMER_EXISTS', `Số ${data.phone} đã thuộc khách ${dup.name} (${dup.code})`, {
        customer_id: dup.id,
        ...(shopId ? { is_member: isMember(dup.id, shopId) } : {}),
      });
    }
  }
  const id = newId('cus');
  const at = nowIso();
  const cols = ['id', 'code', ...FIELDS.filter((f) => data[f] !== undefined), 'created_at', 'updated_at'];
  const vals = [id, runningCode('KH', 5), ...FIELDS.filter((f) => data[f] !== undefined).map((f) => data[f]), at, at];
  db().prepare(`INSERT INTO customers (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  if (shopId) {
    ensureMember(id, shopId);
    applyFieldDefaults('customer', id, { shopId }); // khách mới nhận giá trị mặc định của các trường shop; khách cũ không bị ghi
  }
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
  // Thành viên shop và nhãn của từng shop: hợp lại. Shop nào hồ sơ bị gộp còn hoạt động thì hồ sơ giữ lại cũng hoạt động ở shop đó.
  db().prepare(`INSERT OR IGNORE INTO customer_shops (customer_id, shop_id, added_at, removed_at) SELECT ?, shop_id, added_at, removed_at FROM customer_shops WHERE customer_id = ?`).run(target.id, source.id);
  db().prepare(`UPDATE customer_shops SET removed_at = NULL WHERE customer_id = ? AND shop_id IN (SELECT shop_id FROM customer_shops WHERE customer_id = ? AND removed_at IS NULL)`).run(target.id, source.id);
  db().prepare('DELETE FROM customer_shops WHERE customer_id = ?').run(source.id);
  db().prepare('INSERT OR IGNORE INTO customer_tags (customer_id, shop_id, tag) SELECT ?, shop_id, tag FROM customer_tags WHERE customer_id = ?').run(target.id, source.id);
  db().prepare('DELETE FROM customer_tags WHERE customer_id = ?').run(source.id);
  // Thông tin riêng theo shop: chuyển giá trị sang hồ sơ giữ lại, giá trị đã có ở hồ sơ giữ lại thì thắng. Vẫn tách theo từng shop.
  db()
    .prepare(`UPDATE OR IGNORE custom_values SET entity_id = ? WHERE entity_type = 'customer' AND entity_id = ?`)
    .run(target.id, source.id);
  const fill = {};
  for (const f of ['phone2', 'email', 'facebook_url', 'shopee_username', 'address', 'birth_date', 'birth_year']) {
    if (!target[f] && source[f]) fill[f] = source[f];
  }
  if (!target.phone2 && source.phone && source.phone !== target.phone) fill.phone2 = source.phone;
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
