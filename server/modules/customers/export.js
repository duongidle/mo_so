import { getDb } from '../../db/index.js';
import { config } from '../../lib/config.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { addDays, businessDate } from '../../lib/time.js';
import { listFields, getValues, roleValues } from '../custom/service.js';
import { shopHasFeature } from '../shops/service.js';
import { listTiers, tierFor } from '../loyalty/service.js';
import { listCustomers, fengShuiOf } from './service.js';

const db = () => getDb();
const MAX_ROWS = 50000;
const COUNTED = `('confirmed','shipping','completed','returned')`;

/** Ngày theo giờ Việt Nam: 03/11/2026 */
function vnDate(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: config.businessTz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}
const vnDay = (d) => (d ? d.split('-').reverse().join('/') : '');
const MARK = { true: 'Có', false: 'Không' };

/** Giá trị trường tuỳ chỉnh thành ô văn bản/số cho file */
function fieldCell(f, v) {
  if (v === null || v === undefined) return '';
  if (f.type === 'boolean') return MARK[v];
  if (f.type === 'multiselect') return Array.isArray(v) ? v.join(', ') : v;
  if (f.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return vnDay(v);
  return v;
}

/** Mọi khách khớp bộ lọc, theo đúng thứ tự và điều kiện của danh sách khách (dùng chung listCustomers nên không thể lệch) */
function allMatching(filters) {
  const out = [];
  let cursor;
  do {
    const page = listCustomers({ ...filters, limit: 200, cursor });
    out.push(...page.data);
    cursor = page.next_cursor;
    if (out.length > MAX_ROWS) throw badRequest('TOO_MANY_ROWS', `Có hơn ${MAX_ROWS} khách, vượt giới hạn. Hãy lọc theo nhãn hoặc mệnh để thu hẹp.`);
  } while (cursor);
  return out;
}

/**
 * Xuất danh sách khách theo cùng bộ lọc với danh sách khách.
 * - Có shop_id: file của shop đó — thông tin riêng (mọi trường chưa ẩn), nhãn, mệnh (shop phong thuỷ),
 *   số đơn và chi tiêu TẠI SHOP ĐÓ. Không lộ dữ liệu riêng của shop khác.
 * - Không có shop_id: chỉ thông tin chung + tổng hợp toàn hệ thống + các shop khách thuộc về.
 * Trả { headers, rows, count }; nơi gọi quyết CSV hay Excel.
 */
export function exportCustomers(filters = {}) {
  const { shopId } = filters;
  if (shopId && !db().prepare('SELECT 1 FROM shops WHERE id = ?').get(shopId)) throw notFound('Shop');
  const customers = allMatching(filters);
  const ids = customers.map((c) => c.id);
  const inIds = ids.map(() => '?').join(',');
  const today = businessDate();

  // Hạng: chi tiêu 12 tháng toàn hệ thống (hạng là của khách, không của riêng shop)
  const tiers = listTiers();
  const spent12 = new Map();
  if (ids.length) {
    for (const r of db().prepare(`SELECT customer_id, SUM(net_revenue) AS v FROM orders WHERE status IN ${COUNTED} AND business_date > ? AND customer_id IN (${inIds}) GROUP BY customer_id`).all(addDays(today, -365), ...ids)) spent12.set(r.customer_id, r.v);
  }
  const tierName = (id) => tierFor(spent12.get(id) ?? 0, tiers).tier?.name ?? '';

  const base = [
    ['Mã khách', (c) => c.code],
    ['Họ tên', (c) => c.name],
    ['Số điện thoại', (c) => c.phone ?? ''],
    ['Số điện thoại 2', (c) => c.phone2 ?? ''],
    ['Email', (c) => c.email ?? ''],
    ['Facebook', (c) => c.facebook_url ?? ''],
    ['Tài khoản Shopee', (c) => c.shopee_username ?? ''],
    ['Địa chỉ', (c) => c.address ?? ''],
    // Ngày sinh / năm sinh là thông tin chung của hồ sơ khách nên có ở cả hai kiểu file (có hay không chọn shop)
    ['Ngày sinh', (c) => vnDay(c.birth_date)],
    ['Năm sinh', (c) => c.birth_year ?? ''],
    ['Tuổi', (c) => c.age ?? ''],
  ];
  let cols;
  if (shopId) {
    const fields = listFields('customer', { shopId });
    const hasFormula = fields.some((f) => f.type === 'formula');
    // Giá trị nhập tay của cả lô trong một truy vấn; trường công thức mới tính từng khách (hiếm)
    const stored = new Map();
    if (ids.length) {
      const fids = fields.filter((f) => f.type !== 'formula');
      if (fids.length) {
        const byId = new Map(fids.map((f) => [f.id, f]));
        const rows = db()
          .prepare(`SELECT entity_id, field_id, value_text, value_num FROM custom_values WHERE entity_type = 'customer' AND field_id IN (${fids.map(() => '?').join(',')}) AND entity_id IN (${inIds})`)
          .all(...fids.map((f) => f.id), ...ids);
        for (const r of rows) {
          const f = byId.get(r.field_id);
          if (!stored.has(r.entity_id)) stored.set(r.entity_id, {});
          stored.get(r.entity_id)[f.key] = f.type === 'boolean' ? r.value_num === 1 : r.value_num !== null ? r.value_num : f.type === 'multiselect' ? JSON.parse(r.value_text) : r.value_text;
        }
      }
    }
    const values = (c) => (hasFormula ? getValues('customer', c.id, { shopId }) : stored.get(c.id) || {});
    const fengShui = shopHasFeature(shopId, 'feng_shui');
    const rv = fengShui ? roleValues(shopId, ids) : new Map();
    const shopStats = new Map();
    const since = new Map();
    const shopNotes = new Map();
    if (ids.length) {
      for (const r of db().prepare(`SELECT customer_id, COUNT(*) AS n, SUM(net_revenue) AS spent, MIN(ordered_at) AS first_at, MAX(ordered_at) AS last_at FROM orders WHERE shop_id = ? AND status IN ${COUNTED} AND customer_id IN (${inIds}) GROUP BY customer_id`).all(shopId, ...ids)) shopStats.set(r.customer_id, r);
      for (const r of db().prepare(`SELECT customer_id, added_at FROM customer_shops WHERE shop_id = ? AND customer_id IN (${inIds})`).all(shopId, ...ids)) since.set(r.customer_id, r.added_at);
      for (const r of db().prepare(`SELECT customer_id, content FROM customer_notes WHERE shop_id = ? AND customer_id IN (${inIds}) ORDER BY created_at`).all(shopId, ...ids)) shopNotes.set(r.customer_id, [...(shopNotes.get(r.customer_id) || []), r.content]);
    }
    cols = [
      ...base,
      ['Nhãn', (c) => (c.shop_tags || []).join(', ')],
      ...(fengShui
        ? [
            ['Mệnh', (c) => fengShuiOf(rv.get(c.id))?.element ?? ''],
            ['Nạp âm', (c) => fengShuiOf(rv.get(c.id))?.nap_am ?? ''],
          ]
        : []),
      // Trường "mệnh" (ghi đè tay) đã gộp vào cột Mệnh ở trên nên không lặp lại
      ...fields.filter((f) => !(fengShui && f.role === 'element')).map((f) => [f.label, (c) => fieldCell(f, values(c)[f.key])]),
      ['Số đơn tại shop', (c) => shopStats.get(c.id)?.n ?? 0],
      ['Chi tiêu tại shop', (c) => shopStats.get(c.id)?.spent ?? 0],
      ['Đơn đầu tại shop', (c) => vnDate(shopStats.get(c.id)?.first_at)],
      ['Đơn gần nhất tại shop', (c) => vnDate(shopStats.get(c.id)?.last_at)],
      ['Hạng', (c) => tierName(c.id)],
      ['Thêm vào shop ngày', (c) => vnDate(since.get(c.id))],
      ['Ghi chú chung', (c) => c.note ?? ''],
      ['Ghi chú của shop', (c) => (shopNotes.get(c.id) || []).join(' | ')],
    ];
  } else {
    const shopNames = new Map();
    if (ids.length) {
      for (const r of db().prepare(`SELECT m.customer_id, s.name FROM customer_shops m JOIN shops s ON s.id = m.shop_id WHERE m.removed_at IS NULL AND m.customer_id IN (${inIds}) ORDER BY s.name`).all(...ids)) shopNames.set(r.customer_id, [...(shopNames.get(r.customer_id) || []), r.name]);
    }
    cols = [
      ...base,
      ['Các shop', (c) => (shopNames.get(c.id) || []).join(', ')],
      ['Số đơn', (c) => c.order_count],
      ['Tổng chi tiêu', (c) => c.total_spent],
      ['Đơn đầu', (c) => vnDate(c.first_order_at)],
      ['Đơn gần nhất', (c) => vnDate(c.last_order_at)],
      ['Hạng', (c) => tierName(c.id)],
      ['Ghi chú', (c) => c.note ?? ''],
    ];
  }
  return { headers: cols.map((c) => c[0]), rows: customers.map((c) => cols.map((col) => col[1](c))), count: customers.length };
}

export const exportFileName = (shopCode) => `khach-hang-${shopCode ? shopCode.toLowerCase() + '-' : ''}${businessDate().replaceAll('-', '')}.csv`;
