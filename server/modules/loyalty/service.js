import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso, businessDate, addDays, daysBetween } from '../../lib/time.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { getCustomer } from '../customers/service.js';

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
  const out = [];
  for (const r of reorderCandidates({ shopId })) {
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
export function upcomingBirthdays({ withinDays = 7, today = businessDate() } = {}) {
  const rows = db()
    .prepare(`SELECT id, code, name, phone, facebook_url, birth_date FROM customers WHERE birth_date IS NOT NULL AND merged_into IS NULL AND archived_at IS NULL`)
    .all();
  const out = [];
  for (const c of rows) {
    const [, m, d] = c.birth_date.split('-');
    let next = `${today.slice(0, 4)}-${m}-${d}`;
    if (next < today) next = `${Number(today.slice(0, 4)) + 1}-${m}-${d}`;
    const inDays = daysBetween(today, next);
    if (inDays <= withinDays) out.push({ ...c, next_birthday: next, in_days: inDays, turning: Number(next.slice(0, 4)) - Number(c.birth_date.slice(0, 4)) });
  }
  return out.sort((a, b) => a.in_days - b.in_days);
}

// ---------- Gợi ý theo mệnh ----------
/**
 * Vật phẩm có ngũ hành hợp với mệnh khách, khách chưa mua, đang niêm yết ở ít nhất 1 shop.
 * Không lọc theo shop để bán chéo giữa các shop; mỗi gợi ý ghi rõ shop nào đang bán.
 */
export function elementSuggestions(customerId, { limit = 10 } = {}) {
  const c = getCustomer(customerId);
  const fs = c.feng_shui;
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
       WHERE p.archived_at IS NULL AND p.elements IS NOT NULL GROUP BY p.id`,
    )
    .all();
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

// ---------- Mẫu tin nhắn ----------
export const listTemplates = (kind) =>
  db().prepare(`SELECT * FROM message_templates ${kind ? 'WHERE kind = ?' : ''} ORDER BY created_at`).all(...(kind ? [kind] : []));

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
