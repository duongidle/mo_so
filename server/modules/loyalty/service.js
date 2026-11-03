import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, addDays, daysBetween } from '../../lib/time.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { getCustomer, fengShuiOf } from '../customers/service.js';
import { roleValues } from '../custom/service.js';
import { shopHasFeature } from '../shops/service.js';

const db = () => getDb();
const COUNTED = `('confirmed','shipping','completed','returned')`;

// ---------- Hạng khách ----------
export function listTiers() {
  return db().prepare('SELECT * FROM loyalty_tiers ORDER BY min_spent').all();
}

/** Thay toàn bộ bảng hạng. Hạng thấp nhất phải bắt đầu từ 0 để ai cũng có hạng. */
export function replaceTiers(tiers) {
  const sorted = [...tiers].sort((a, b) => a.min_spent - b.min_spent);
  if (sorted[0].min_spent !== 0) throw badRequest('INVALID_TIERS', 'Hạng thấp nhất phải có ngưỡng chi tiêu 0');
  if (new Set(sorted.map((t) => t.min_spent)).size !== sorted.length) throw badRequest('INVALID_TIERS', 'Hai hạng không được cùng ngưỡng');
  db().prepare('DELETE FROM loyalty_tiers').run();
  const ins = db().prepare('INSERT INTO loyalty_tiers (id, name, min_spent, discount_pct, sort_order) VALUES (?,?,?,?,?)');
  sorted.forEach((t, i) => ins.run(t.id || newId('tier'), t.name, t.min_spent, t.discount_pct, i + 1));
  return listTiers();
}

export function spent12m(customerId, today = businessDate()) {
  return db()
    .prepare(`SELECT COALESCE(SUM(net_revenue),0) AS v FROM orders WHERE customer_id = ? AND status IN ${COUNTED} AND business_date > ?`)
    .get(customerId, addDays(today, -365)).v;
}

export function tierFor(spent, tiers = listTiers()) {
  let cur = tiers[0];
  for (const t of tiers) if (spent >= t.min_spent) cur = t;
  const next = tiers.find((t) => t.min_spent > spent) || null;
  return { tier: cur, next_tier: next, to_next: next ? next.min_spent - spent : 0 };
}

export function customerLoyalty(customerId) {
  const c = getCustomer(customerId); // theo hồ sơ gốc nếu đã gộp
  const spent = spent12m(c.id);
  return { customer_id: c.id, spent_12m: spent, ...tierFor(spent) };
}

// ---------- Nhắc mua lại ----------
/**
 * Mỗi (khách, sản phẩm có chu kỳ dùng) → ngày dự kiến hết = ngày mua gần nhất + chu kỳ × SL của lần mua đó.
 * Hàng đã trả lại không tính là đã mua.
 */
export function reorderCandidates({ shopId } = {}) {
  const rows = db()
    .prepare(
      `SELECT o.customer_id, p.id AS product_id, p.name AS product_name, p.consumption_days,
              o.business_date, o.shop_id, s.name AS shop_name, SUM(l.qty - l.returned_qty) AS qty, o.id AS order_id
       FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN shops s ON s.id = o.shop_id
       JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
       WHERE o.customer_id IS NOT NULL AND o.status IN ${COUNTED} AND p.consumption_days IS NOT NULL AND p.consumption_days > 0
         AND l.qty - l.returned_qty > 0
       GROUP BY o.id, p.id ORDER BY o.business_date, o.id`,
    )
    .all();
  // Lấy lần mua cuối của mỗi cặp (khách, sản phẩm)
  const last = new Map();
  for (const r of rows) last.set(`${r.customer_id}|${r.product_id}`, r);
  let out = [...last.values()].map((r) => ({
    customer_id: r.customer_id,
    product_id: r.product_id,
    product_name: r.product_name,
    shop_id: r.shop_id,
    shop_name: r.shop_name,
    last_purchase_date: r.business_date,
    qty: r.qty,
    due_date: addDays(r.business_date, r.consumption_days * Math.max(1, r.qty)),
  }));
  if (shopId) out = out.filter((r) => r.shop_id === shopId);
  return out;
}

/**
 * "Hôm nay nên liên hệ": nhắc nhở đã đến hạn (hoặc sắp đến trong `lookaheadDays` ngày),
 * trừ cái đã xử lý/bỏ qua/hoãn.
 */
export function dueReminders({ shopId, lookaheadDays = 3, today = businessDate() } = {}) {
  const states = new Map(
    db().prepare('SELECT * FROM reminder_state').all().map((s) => [`${s.customer_id}|${s.product_id}|${s.base_date}`, s]),
  );
  const cust = db().prepare('SELECT id, code, name, phone, facebook_url, merged_into, archived_at FROM customers');
  const customers = new Map(cust.all().map((c) => [c.id, c]));
  // Khách đã bị xoá khỏi shop thì shop đó không còn nhắc họ nữa (đơn cũ vẫn còn, nhưng họ không còn là khách của shop)
  const members = new Set(db().prepare('SELECT customer_id, shop_id FROM customer_shops WHERE removed_at IS NULL').all().map((m) => `${m.customer_id}|${m.shop_id}`));
  const out = [];
  for (const r of reorderCandidates({ shopId })) {
    if (!members.has(`${r.customer_id}|${r.shop_id}`)) continue;
    if (r.due_date > addDays(today, lookaheadDays)) continue;
    const st = states.get(`${r.customer_id}|${r.product_id}|${r.last_purchase_date}`);
    if (st && (st.status === 'done' || st.status === 'dismissed')) continue;
    if (st?.status === 'snoozed' && st.snooze_until > today) continue;
    const c = customers.get(r.customer_id);
    if (!c || c.merged_into || c.archived_at) continue;
    out.push({ ...r, customer: { id: c.id, code: c.code, name: c.name, phone: c.phone, facebook_url: c.facebook_url }, overdue_days: daysBetween(r.due_date, today) });
  }
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date));
}

export function actOnReminder({ customerId, productId, baseDate, action, snoozeDays = 3 }) {
  const status = { done: 'done', dismiss: 'dismissed', snooze: 'snoozed' }[action];
  if (!status) throw badRequest('INVALID_ACTION', 'action phải là done | dismiss | snooze');
  const exists = reorderCandidates().find((r) => r.customer_id === customerId && r.product_id === productId && r.last_purchase_date === baseDate);
  if (!exists) throw notFound('Nhắc nhở (có thể khách đã mua lại)');
  db()
    .prepare(
      `INSERT INTO reminder_state (customer_id, product_id, base_date, status, snooze_until, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(customer_id, product_id, base_date) DO UPDATE SET status = excluded.status, snooze_until = excluded.snooze_until, updated_at = excluded.updated_at`,
    )
    .run(customerId, productId, baseDate, status, status === 'snoozed' ? addDays(businessDate(), snoozeDays) : null, nowIso());
  return { customer_id: customerId, product_id: productId, base_date: baseDate, status };
}

// ---------- Sinh nhật ----------
/**
 * Sinh nhật sắp tới, đọc từ trường có vai trò birth_date của từng shop (shop nào không hỏi ngày sinh thì không có).
 * Có shopId: chỉ shop đó. Không có: gộp các shop, mỗi khách một dòng.
 */
export function upcomingBirthdays({ withinDays = 7, today = businessDate(), shopId } = {}) {
  const rows = db()
    .prepare(
      `SELECT c.id, c.code, c.name, c.phone, c.facebook_url, v.value_text AS birth_date, f.shop_id, s.name AS shop_name
       FROM custom_values v JOIN custom_fields f ON f.id = v.field_id AND f.role = 'birth_date' AND f.archived_at IS NULL
       JOIN shops s ON s.id = f.shop_id AND s.archived_at IS NULL
       JOIN customers c ON c.id = v.entity_id AND c.merged_into IS NULL AND c.archived_at IS NULL
       WHERE v.entity_type = 'customer' AND v.value_text IS NOT NULL ${shopId ? 'AND f.shop_id = ?' : ''}
       ORDER BY f.shop_id`,
    )
    .all(...(shopId ? [shopId] : []));
  const seen = new Set();
  const out = [];
  for (const c of rows) {
    if (seen.has(c.id)) continue;
    const [, m, d] = c.birth_date.split('-');
    let next = `${today.slice(0, 4)}-${m}-${d}`;
    if (next < today) next = `${Number(today.slice(0, 4)) + 1}-${m}-${d}`;
    const inDays = daysBetween(today, next);
    if (inDays <= withinDays) {
      seen.add(c.id);
      out.push({ ...c, next_birthday: next, in_days: inDays, turning: Number(next.slice(0, 4)) - Number(c.birth_date.slice(0, 4)) });
    }
  }
  return out.sort((a, b) => a.in_days - b.in_days);
}

// ---------- Gợi ý theo mệnh ----------
/**
 * Vật phẩm có ngũ hành hợp với mệnh khách (mệnh ghi trong shop `shopId`), khách chưa mua, đang niêm yết ở shop đó.
 * Chỉ dùng được ở shop có ngành phong thuỷ: mệnh là thông tin riêng của shop.
 */
export function elementSuggestions(customerId, { shopId, limit = 10 } = {}) {
  const c = getCustomer(customerId);
  if (!shopId || !shopHasFeature(shopId, 'feng_shui')) return { element: null, approximate: false, data: [], reason: 'Shop này không theo ngành phong thuỷ' };
  const fs = fengShuiOf(roleValues(shopId, [c.id]).get(c.id));
  if (!fs) return { element: null, approximate: false, data: [], reason: 'Chưa biết mệnh của khách (thiếu ngày/năm sinh)' };
  const bought = new Set(
    db()
      .prepare(`SELECT DISTINCT v.product_id AS id FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN variants v ON v.id = l.variant_id WHERE o.customer_id = ? AND o.status IN ${COUNTED}`)
      .all(c.id)
      .map((r) => r.id),
  );
  const products = db()
    .prepare(
      `SELECT p.id, p.name, p.elements, GROUP_CONCAT(DISTINCT s.id) AS shop_ids, GROUP_CONCAT(DISTINCT s.name) AS shop_names, MIN(l.price) AS price
       FROM products p JOIN variants v ON v.product_id = p.id AND v.archived_at IS NULL
       JOIN shop_listings l ON l.variant_id = v.id AND l.active = 1 JOIN shops s ON s.id = l.shop_id AND s.archived_at IS NULL
       WHERE p.archived_at IS NULL AND p.elements IS NOT NULL AND s.id = ? GROUP BY p.id`,
    )
    .all(shopId);
  const data = [];
  for (const p of products) {
    if (bought.has(p.id)) continue;
    const els = JSON.parse(p.elements || '[]');
    const match = els.filter((e) => fs.compatible_elements.includes(e));
    if (!match.length) continue;
    // Cùng hành với khách (bình hoà) xếp sau hành sinh ra khách (tương sinh)? Ở đây coi tương sinh là ưu tiên cao hơn.
    const score = match.some((e) => e !== fs.element) ? 2 : 1;
    data.push({ product_id: p.id, name: p.name, elements: els, matched: match, price: p.price, shop_ids: p.shop_ids.split(','), shop_names: p.shop_names.split(','), score });
  }
  data.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { element: fs.element, approximate: fs.approximate, data: data.slice(0, limit) };
}

/**
 * Chiến dịch theo mệnh cho cả shop: mỗi khách còn trong shop, biết mệnh, và còn vật phẩm hợp chưa mua → một dòng.
 * Dùng cho trang Loyalty & Campaign. Chỉ shop phong thuỷ; shop khác trả rỗng kèm lý do.
 */
export function elementCampaign({ shopId, perCustomer = 3, limit = 100 } = {}) {
  if (!shopId || !shopHasFeature(shopId, 'feng_shui')) return { data: [], total: 0, reason: 'Chỉ dùng cho shop theo ngành phong thuỷ' };
  const members = db()
    .prepare(
      `SELECT c.id FROM customers c JOIN customer_shops m ON m.customer_id = c.id AND m.shop_id = ? AND m.removed_at IS NULL
       WHERE c.merged_into IS NULL AND c.archived_at IS NULL ORDER BY c.total_spent DESC, c.id`,
    )
    .all(shopId);
  const rv = roleValues(shopId, members.map((m) => m.id));
  const rows = [];
  for (const m of members) {
    if (!fengShuiOf(rv.get(m.id))) continue; // chưa biết mệnh
    const sug = elementSuggestions(m.id, { shopId, limit: perCustomer });
    if (!sug.data.length) continue;
    const c = getCustomer(m.id);
    rows.push({ customer: { id: c.id, code: c.code, name: c.name, phone: c.phone, facebook_url: c.facebook_url, total_spent: c.total_spent }, element: sug.element, approximate: sug.approximate, suggestions: sug.data });
  }
  return { data: rows.slice(0, limit), total: rows.length };
}

// ---------- Mẫu tin nhắn ----------
export const listTemplates = (kind) =>
  db().prepare(`SELECT * FROM message_templates ${kind ? 'WHERE kind = ?' : ''} ORDER BY created_at`).all(...(kind ? [kind] : []));

export function deleteTemplate(id) {
  const r = db().prepare('DELETE FROM message_templates WHERE id = ?').run(id);
  if (!r.changes) throw notFound('Mẫu tin nhắn');
}

export function saveTemplate(id, { name, kind, body }) {
  const at = nowIso();
  if (id) {
    if (!db().prepare('SELECT 1 FROM message_templates WHERE id = ?').get(id)) throw notFound('Mẫu tin nhắn');
    db().prepare('UPDATE message_templates SET name=?, kind=?, body=?, updated_at=? WHERE id=?').run(name, kind, body, at, id);
    return db().prepare('SELECT * FROM message_templates WHERE id = ?').get(id);
  }
  const nid = newId('tpl');
  db().prepare('INSERT INTO message_templates (id, name, kind, body, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(nid, name, kind, body, at, at);
  return db().prepare('SELECT * FROM message_templates WHERE id = ?').get(nid);
}

/** Điền biến. Biến không biết giá trị thì GIỮ NGUYÊN chỗ trống rõ ràng để người gửi thấy, không tự bịa. */
export function renderTemplate(body, vars) {
  return body.replace(/\{(ten|san_pham|shop)\}/g, (m, k) => vars[k] || m);
}
