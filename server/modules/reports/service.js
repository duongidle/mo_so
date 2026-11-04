import { getDb } from '../../db/index.js';
import { addDays, daysBetween, businessDate } from '../../lib/time.js';
import { allocate } from '../../lib/money.js';
import { getSettings } from '../settings/service.js';
import { listStock } from '../inventory/service.js';
import { COUNTED, readStats } from './stats.js';
import { categoryClause as categoryClauseOf } from '../../lib/categories.js';

const db = () => getDb();


/**
 * Chuẩn hoá bộ lọc. Khoảng ngày mặc định = tháng hiện tại (giờ VN).
 */
export function normalizeFilter(f = {}) {
  const today = businessDate();
  const from = f.from || `${today.slice(0, 7)}-01`;
  const to = f.to || today;
  return { from, to, shopIds: f.shopIds?.length ? f.shopIds : null, channel: f.channel || null, categoryId: f.categoryId || null };
}

function orderWhere(f, alias = 'o') {
  const where = [`${alias}.business_date >= ?`, `${alias}.business_date <= ?`];
  const params = [f.from, f.to];
  if (f.shopIds) (where.push(`${alias}.shop_id IN (${f.shopIds.map(() => '?').join(',')})`), params.push(...f.shopIds));
  if (f.channel) (where.push(`${alias}.channel_id = ?`), params.push(f.channel));
  return { where, params };
}

// Giá trị hàng đã trả của từng dòng đơn (ghi trên phiếu trả lúc trả), để doanh thu theo sản phẩm/ngũ hành khớp doanh thu thuần của đơn
const LINE_RETURNED = `COALESCE((SELECT SUM(json_extract(j.value, '$.value')) FROM order_returns rr, json_each(rr.lines) j
  WHERE rr.order_id = l.order_id AND json_extract(j.value, '$.order_line_id') = l.id), 0)`;
const LINE_NET = `(l.line_total - l.allocated_order_discount - ${LINE_RETURNED})`;

function categoryClause(f) {
  return categoryClauseOf(f.categoryId);
}

/**
 * Biến dùng được trong chỉ số báo cáo tuỳ chỉnh (công thức chạy trên `overview().current`).
 * Một nguồn duy nhất: createMetric kiểm tra theo đây và giao diện gợi ý cũng lấy từ đây.
 */
export const REPORT_VARIABLES = [
  { key: 'order_count', label: 'Số đơn (đã xác nhận trở đi)', type: 'number', group: 'Đơn' },
  { key: 'cancelled_count', label: 'Số đơn huỷ', type: 'number', group: 'Đơn' },
  { key: 'returned_count', label: 'Số đơn có trả hàng', type: 'number', group: 'Đơn' },
  { key: 'aov', label: 'Giá trị đơn trung bình', type: 'money', group: 'Đơn' },
  { key: 'cancel_rate_pct', label: 'Tỷ lệ huỷ (%)', type: 'number', group: 'Đơn' },
  { key: 'return_rate_pct', label: 'Tỷ lệ hoàn trả (%)', type: 'number', group: 'Đơn' },
  { key: 'subtotal', label: 'Tổng tiền hàng (trước giảm giá)', type: 'money', group: 'Doanh thu' },
  { key: 'gross_revenue', label: 'Doanh thu gộp', type: 'money', group: 'Doanh thu' },
  { key: 'discount_amount', label: 'Giảm giá', type: 'money', group: 'Doanh thu' },
  { key: 'goods_revenue', label: 'Tiền hàng sau giảm giá', type: 'money', group: 'Doanh thu' },
  { key: 'returned_amount', label: 'Tiền hàng đã trả', type: 'money', group: 'Doanh thu' },
  { key: 'net_revenue', label: 'Doanh thu thuần', type: 'money', group: 'Doanh thu' },
  { key: 'shipping_fee', label: 'Phí ship khách trả', type: 'money', group: 'Doanh thu' },
  { key: 'platform_fee', label: 'Phí sàn', type: 'money', group: 'Chi phí' },
  { key: 'seller_shipping', label: 'Phí ship shop chịu', type: 'money', group: 'Chi phí' },
  { key: 'cogs', label: 'Giá vốn hàng bán', type: 'money', group: 'Chi phí' },
  { key: 'expenses_amount', label: 'Chi phí (đã gồm phần chung chia về)', type: 'money', group: 'Chi phí' },
  { key: 'gross_profit', label: 'Lợi nhuận gộp', type: 'money', group: 'Lợi nhuận' },
  { key: 'gross_margin_pct', label: 'Biên lợi nhuận gộp (%)', type: 'number', group: 'Lợi nhuận' },
  { key: 'net_profit_estimate', label: 'Lợi nhuận ròng ước tính', type: 'money', group: 'Lợi nhuận' },
  { key: 'tax_estimate_amount', label: 'Thuế ước tính (chỉ có khi bật thuế, xem cả hộ)', type: 'money', group: 'Lợi nhuận' },
  { key: 'profit_after_tax_estimate', label: 'Lợi nhuận sau thuế ước tính (như trên)', type: 'money', group: 'Lợi nhuận' },
];

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

const finish = (r) => {
  const gross_profit = r.net_revenue + r.shipping_fee - r.platform_fee - r.seller_shipping - r.cogs;
  return {
    ...r,
    gross_revenue: r.subtotal,
    gross_profit,
    gross_margin_pct: pct(gross_profit, r.net_revenue),
    aov: r.order_count ? Math.round(r.net_revenue / r.order_count) : 0,
    cancel_rate_pct: pct(r.cancelled_count, r.order_count + r.cancelled_count),
    return_rate_pct: pct(r.returned_count, r.order_count),
  };
};

/**
 * Tổng hợp tiền theo đơn trong khoảng + lọc, đọc từ bảng đệm `daily_stats` (xem migration 017).
 * Dùng chung cho tổng quan, so sánh kỳ trước, theo shop/kênh. groupBy: null | 'shop' | 'channel' | 'shop_channel'.
 */
function sumOrders(f, groupBy = null) {
  const r = readStats(f, groupBy);
  return groupBy ? r.map(finish) : finish(r);
}

// ---------- Chi phí ----------
const activeShopIds = () => db().prepare('SELECT id FROM shops WHERE archived_at IS NULL ORDER BY id').all().map((s) => s.id);
const allChannelIds = () => db().prepare('SELECT id FROM channels ORDER BY id').all().map((c) => c.id);

function revenueByShop(f) {
  // Doanh thu để phân bổ chi phí chung phải tính trên MỌI shop và MỌI kênh (không lọc), nếu không tỷ lệ sẽ sai
  return new Map(sumOrders({ ...f, shopIds: null, channel: null }, 'shop').map((r) => [r.k, r.net_revenue]));
}

/** Trọng số chia chi phí chung cho các shop đang hoạt động, theo cài đặt. Không có căn cứ (mọi trọng số 0) thì chia đều. */
function shopWeights(f, shops) {
  const settings = getSettings();
  let w = null;
  if (settings.expense_allocation === 'fixed') {
    const fixed = settings.expense_allocation_fixed || {};
    w = shops.map((id) => fixed[id] || 0);
  } else if (settings.expense_allocation === 'revenue') {
    const rev = revenueByShop(f);
    w = shops.map((id) => rev.get(id) || 0);
  }
  return w && w.some((x) => x > 0) ? w : shops.map(() => 1);
}

/** Trọng số chia theo kênh của một shop = doanh thu thuần từng kênh của shop đó trong kỳ (không có doanh thu thì chia đều) */
function channelWeightsFor(f) {
  const channels = allChannelIds();
  const byShop = new Map();
  for (const r of sumOrders({ ...f, shopIds: null, channel: null }, 'shop_channel')) {
    const [shop, ch] = r.k.split('|');
    if (!byShop.has(shop)) byShop.set(shop, new Map());
    byShop.get(shop).set(ch, r.net_revenue);
  }
  return (shopId) => channels.map((id) => byShop.get(shopId)?.get(id) || 0);
}

/**
 * Chi phí trong khoảng, đã quy về từng shop (và từng kênh nếu lọc kênh), mỗi dòng một danh mục.
 * - Chi phí của shop: về đúng shop. Chi phí chung (không shop): chia cho các shop đang hoạt động theo cài đặt (doanh thu / đều / cố định).
 * - Lọc kênh: chi phí gắn đúng kênh đó tính đủ; chi phí gắn kênh khác bỏ; chi phí không gắn kênh chia cho các kênh theo doanh thu kênh của shop.
 * Mọi phép chia dùng allocate() nên tổng các phần luôn bằng đúng số tiền gốc, không lệch đồng nào.
 */
export function expenseItems(f) {
  const rows = db()
    .prepare(
      `SELECT shop_id, channel_id, category_id, SUM(amount) AS amt FROM expenses
       WHERE voided_at IS NULL AND expense_date >= ? AND expense_date <= ?
       GROUP BY shop_id, channel_id, category_id ORDER BY shop_id, channel_id, category_id`,
    )
    .all(f.from, f.to);
  const shops = activeShopIds();
  const sw = rows.some((r) => !r.shop_id) ? shopWeights(f, shops) : null;
  const cw = f.channel && rows.some((r) => r.channel_id === null) ? channelWeightsFor(f) : null;
  const cIdx = f.channel ? allChannelIds().indexOf(f.channel) : -1;
  const items = [];
  for (const r of rows) {
    const parts = r.shop_id
      ? [{ shop_id: r.shop_id, amount: r.amt, kind: 'direct' }]
      : shops.length
        ? allocate(r.amt, sw).map((amount, i) => ({ shop_id: shops[i], amount, kind: 'shared' }))
        : [];
    for (const p of parts) {
      if (p.amount <= 0) continue;
      if (f.shopIds && !f.shopIds.includes(p.shop_id)) continue;
      let amount = p.amount;
      if (f.channel) {
        if (r.channel_id === f.channel) amount = p.amount;
        else if (r.channel_id !== null) continue;
        else amount = cIdx >= 0 ? allocate(p.amount, cw(p.shop_id))[cIdx] : 0;
      }
      if (amount > 0) items.push({ shop_id: p.shop_id, category_id: r.category_id, channel_id: r.channel_id, kind: p.kind, amount });
    }
  }
  return items;
}

/** Tổng chi phí trong phạm vi bộ lọc: { total, direct, shared, perShop: Map(shop → số tiền), items } */
export function expensesFor(f) {
  const items = expenseItems(f);
  const sum = (arr) => arr.reduce((a, i) => a + i.amount, 0);
  const perShop = new Map();
  for (const i of items) perShop.set(i.shop_id, (perShop.get(i.shop_id) || 0) + i.amount);
  const total = sum(items);
  const direct = sum(items.filter((i) => i.kind === 'direct'));
  return { total, direct, shared: total - direct, perShop, items };
}

export function previousPeriod(f) {
  const len = daysBetween(f.from, f.to) + 1;
  return { ...f, from: addDays(f.from, -len), to: addDays(f.from, -1) };
}

function withProfit(s, expenses) {
  return { ...s, expenses_amount: expenses, net_profit_estimate: s.gross_profit - expenses };
}

const TAX_BASE_LABELS = { net_revenue: 'Doanh thu thuần (hàng sau khi trừ hàng trả)', revenue_with_shipping: 'Doanh thu thuần + phí ship khách trả', net_profit: 'Lợi nhuận ròng ước tính (trước thuế)' };

/** Cơ sở tính thuế cộng dồn từ `from` đến `to` (toàn bộ shop, mọi kênh) */
function taxBase(base, from, to) {
  if (from > to) return 0;
  const all = { from, to, shopIds: null, channel: null };
  const s = sumOrders(all);
  if (base === 'net_revenue') return s.net_revenue;
  if (base === 'revenue_with_shipping') return s.net_revenue + s.shipping_fee;
  return s.gross_profit - expensesFor(all).total;
}

/**
 * Ước tính thuế theo các quy tắc người dùng tự cấu hình (mặc định tắt). Chỉ là ƯỚC TÍNH để thấy lợi nhuận sau thuế, không phải tờ khai.
 * Ngưỡng miễn thuế tính theo năm dương lịch: thuế cộng dồn đến ngày X = tỷ lệ × max(0, cơ sở cộng dồn từ đầu năm − ngưỡng);
 * thuế của một kỳ = thuế cộng dồn cuối kỳ − thuế cộng dồn trước kỳ (kỳ qua năm mới tự tách theo năm), nên cộng các kỳ liền nhau ra đúng cả năm.
 * Thuế là của cả hộ kinh doanh nên không chia theo shop hay kênh: có lọc shop/kênh thì không tính.
 */
export function taxEstimate(f) {
  const st = getSettings();
  if (!st.tax_enabled || !st.tax_rules.length) return null;
  if (f.shopIds || f.channel) return { enabled: true, applicable: false, reason: 'Thuế tính cho cả hộ kinh doanh, không chia theo shop hay kênh. Bỏ bộ lọc shop/kênh để xem.' };
  const items = st.tax_rules.map((r) => {
    const thr = r.exempt_threshold_year || 0;
    let tax = 0;
    let base = 0;
    let taxable = 0;
    for (let y = Number(f.from.slice(0, 4)); y <= Number(f.to.slice(0, 4)); y++) {
      const yStart = `${y}-01-01`;
      const segStart = f.from > yStart ? f.from : yStart;
      const segEnd = f.to < `${y}-12-31` ? f.to : `${y}-12-31`;
      const endBase = taxBase(r.base, yStart, segEnd);
      const startBase = segStart > yStart ? taxBase(r.base, yStart, addDays(segStart, -1)) : 0;
      const cum = (x) => Math.round((r.rate_pct * Math.max(0, x - thr)) / 100);
      tax += cum(endBase) - cum(startBase);
      base += endBase - startBase;
      taxable += Math.max(0, endBase - thr) - Math.max(0, startBase - thr);
    }
    return { name: r.name, rate_pct: r.rate_pct, base: r.base, base_label: TAX_BASE_LABELS[r.base], exempt_threshold_year: thr, base_amount: base, taxable_amount: taxable, tax };
  });
  return { enabled: true, applicable: true, items, total: items.reduce((a, i) => a + i.tax, 0) };
}

export function overview(filter) {
  const f = normalizeFilter(filter);
  const cur = sumOrders(f);
  const exp = expensesFor(f);
  const prevF = previousPeriod(f);
  const prev = sumOrders(prevF);
  const prevExp = expensesFor(prevF);
  const current = withProfit(cur, exp.total);
  const previous = withProfit(prev, prevExp.total);
  const change = {};
  for (const k of ['net_revenue', 'gross_profit', 'order_count', 'net_profit_estimate', 'aov']) {
    change[k] = previous[k] ? Math.round(((current[k] - previous[k]) / Math.abs(previous[k])) * 1000) / 10 : null;
  }
  const tax = taxEstimate(f);
  if (tax?.applicable) {
    current.tax_estimate_amount = tax.total;
    current.profit_after_tax_estimate = current.net_profit_estimate - tax.total;
  }
  return { filter: f, previous_filter: { from: prevF.from, to: prevF.to }, current, previous, change_pct: change, tax };
}

export function revenueSeries(filter) {
  const f = normalizeFilter(filter);
  const rows = readStats(f, 'date').map((r) => ({ date: r.k, order_count: r.order_count, net_revenue: r.net_revenue, gross_profit: finish(r).gross_profit }));
  // Điền ngày trống để biểu đồ liên tục
  const map = new Map(rows.map((r) => [r.date, r]));
  const out = [];
  for (let d = f.from; d <= f.to; d = addDays(d, 1)) out.push(map.get(d) || { date: d, order_count: 0, net_revenue: 0, gross_profit: 0 });
  return { filter: f, data: out };
}

export function byShop(filter) {
  const f = normalizeFilter(filter);
  const rows = sumOrders({ ...f, shopIds: null }, 'shop');
  const exp = expensesFor({ ...f, shopIds: null });
  // Shop đã lưu trữ vẫn hiện nếu trong kỳ có đơn hoặc chi phí, để tổng theo shop luôn khớp tổng quan
  const shops = db()
    .prepare('SELECT id, code, name, color, archived_at FROM shops ORDER BY created_at, id')
    .all()
    .filter((s) => !s.archived_at || rows.some((x) => x.k === s.id) || exp.perShop.get(s.id));
  const data = shops
    .filter((s) => !f.shopIds || f.shopIds.includes(s.id))
    .map((s) => {
      const r = rows.find((x) => x.k === s.id) || sumOrdersEmpty();
      return { shop_id: s.id, shop_code: s.code, shop_name: s.name, ...withProfit(r, exp.perShop.get(s.id) || 0) };
    });
  return { filter: f, data };
}

function sumOrdersEmpty() {
  return { order_count: 0, cancelled_count: 0, returned_count: 0, subtotal: 0, discount_amount: 0, goods_revenue: 0, returned_amount: 0, net_revenue: 0, shipping_fee: 0, platform_fee: 0, seller_shipping: 0, cogs: 0, gross_revenue: 0, gross_profit: 0, gross_margin_pct: null, aov: 0, cancel_rate_pct: null, return_rate_pct: null };
}

export function byChannel(filter) {
  const f = normalizeFilter(filter);
  const rows = sumOrders(f, 'channel');
  const names = new Map(db().prepare('SELECT id, name FROM channels').all().map((c) => [c.id, c.name]));
  return { filter: f, data: rows.map((r) => ({ channel_id: r.k, channel_name: names.get(r.k) || r.k, ...r })).sort((a, b) => b.net_revenue - a.net_revenue) };
}

/**
 * Báo cáo theo sản phẩm. Combo hiện thành dòng riêng (doanh thu theo combo, giá vốn = tổng giá vốn thành phần lúc bán).
 * Sản phẩm đơn có thêm `qty_in_combos`: số đơn vị đã bán nằm trong combo (không nằm trong `qty_sold`, để không đếm hai lần).
 * `combos` là tổng riêng của mọi combo trong kỳ.
 */
export function byProduct(filter, { limit = 50 } = {}) {
  const f = normalizeFilter(filter);
  const { where, params } = orderWhere(f);
  const cat = categoryClause(f);
  const rows = db()
    .prepare(
      `SELECT v.id AS variant_id, v.sku, v.kind, p.name AS product_name, v.name AS variant_name,
              SUM(l.qty - l.returned_qty) AS qty_sold,
              SUM(${LINE_NET}) AS revenue,
              SUM(l.cogs_amount) AS cogs
       FROM order_lines l JOIN orders o ON o.id = l.order_id
       JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
       WHERE ${where.join(' AND ')} AND o.status IN ${COUNTED}${cat.sql}
       GROUP BY v.id ORDER BY revenue DESC LIMIT ?`,
    )
    .all(...params, ...cat.params, limit);
  const inCombos = new Map(
    db()
      .prepare(
        `SELECT c.variant_id, SUM(c.per_bundle_qty * (l.qty - l.returned_qty)) AS n
         FROM order_line_components c JOIN order_lines l ON l.id = c.order_line_id JOIN orders o ON o.id = l.order_id
         WHERE ${where.join(' AND ')} AND o.status IN ${COUNTED} GROUP BY c.variant_id`,
      )
      .all(...params)
      .map((r) => [r.variant_id, r.n]),
  );
  const data = rows.map((r) => ({
    ...r,
    is_bundle: r.kind === 'bundle',
    gross_profit: r.revenue - r.cogs,
    margin_pct: pct(r.revenue - r.cogs, r.revenue),
    ...(r.kind === 'bundle' ? {} : { qty_in_combos: inCombos.get(r.variant_id) || 0 }),
  }));
  // Thành phần chỉ bán qua combo (không bán lẻ) vẫn phải hiện để biết hàng đó đi đâu
  const seen = new Set(rows.map((r) => r.variant_id));
  const extra = [...inCombos.entries()].filter(([id]) => !seen.has(id));
  if (extra.length) {
    const info = db()
      .prepare(`SELECT v.id AS variant_id, v.sku, v.kind, p.name AS product_name, v.name AS variant_name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id IN (${extra.map(() => '?').join(',')})${cat.sql}`)
      .all(...extra.map(([id]) => id), ...cat.params);
    for (const i of info) data.push({ ...i, is_bundle: false, qty_sold: 0, revenue: 0, cogs: 0, gross_profit: 0, margin_pct: null, qty_in_combos: inCombos.get(i.variant_id) });
  }
  const bundles = data.filter((d) => d.is_bundle);
  const sum = (k) => bundles.reduce((a, d) => a + d[k], 0);
  const combos = { count: bundles.length, qty: sum('qty_sold'), revenue: sum('revenue'), cogs: sum('cogs'), gross_profit: sum('gross_profit') };
  return { filter: f, data, combos };
}

/**
 * Doanh thu theo ngũ hành của sản phẩm. Ngũ hành là trường sản phẩm (vai trò `element`) của từng shop phong thuỷ,
 * nên mỗi dòng đơn đọc ngũ hành theo đúng shop của đơn; shop không có trường này (ngành khác) hoặc sản phẩm chưa gán → "chưa gán".
 * Sản phẩm hợp nhiều hành thì chia đều doanh thu cho các hành đó
 * (để tổng 5 hành + "chưa gán" luôn bằng doanh thu thuần của dòng hàng, không đếm trùng).
 */
export function byElement(filter) {
  const f = normalizeFilter(filter);
  const { where, params } = orderWhere(f);
  const cat = categoryClause(f);
  const rows = db()
    .prepare(
      `SELECT cv.value_text AS elements, SUM(l.qty - l.returned_qty) AS qty, SUM(${LINE_NET}) AS revenue
       FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
       LEFT JOIN custom_fields cf ON cf.entity_type = 'product' AND cf.role = 'element' AND cf.shop_id = o.shop_id AND cf.archived_at IS NULL
       LEFT JOIN custom_values cv ON cv.entity_type = 'product' AND cv.entity_id = p.id AND cv.field_id = cf.id
       WHERE ${where.join(' AND ')} AND o.status IN ${COUNTED}${cat.sql} GROUP BY p.id, o.shop_id`,
    )
    .all(...params, ...cat.params);
  const acc = new Map(['Kim', 'Mộc', 'Thuỷ', 'Hoả', 'Thổ', null].map((e) => [e, { element: e, revenue: 0, qty: 0 }]));
  for (const r of rows) {
    const els = JSON.parse(r.elements || '[]');
    const targets = els.length ? els : [null];
    const shares = allocate(r.revenue, targets.map(() => 1));
    targets.forEach((e, i) => {
      const a = acc.get(e) ?? acc.get(null);
      a.revenue += shares[i];
      a.qty += r.qty;
    });
  }
  return { filter: f, data: [...acc.values()] };
}

export function customerMetrics(filter, { topLimit = 10 } = {}) {
  const f = normalizeFilter(filter);
  const { where, params } = orderWhere(f);
  const base = `FROM orders o WHERE ${where.join(' AND ')} AND o.status IN ${COUNTED} AND o.customer_id IS NOT NULL`;
  const buyers = db().prepare(`SELECT COUNT(DISTINCT o.customer_id) AS n ${base}`).get(...params).n;
  // Khách mới = đơn đầu tiên (toàn hệ thống, mọi shop) nằm trong khoảng
  const newBuyers = db()
    .prepare(
      `SELECT COUNT(DISTINCT o.customer_id) AS n ${base}
       AND NOT EXISTS (SELECT 1 FROM orders p WHERE p.customer_id = o.customer_id AND p.status IN ${COUNTED} AND p.business_date < ?)`,
    )
    .get(...params, f.from).n;
  const repeat = db()
    .prepare(
      `SELECT COUNT(DISTINCT o.customer_id) AS n ${base}
       AND EXISTS (SELECT 1 FROM orders p WHERE p.customer_id = o.customer_id AND p.status IN ${COUNTED} AND p.id != o.id AND p.ordered_at < o.ordered_at)`,
    )
    .get(...params).n;
  const top = db()
    .prepare(
      `SELECT o.customer_id, c.code, c.name, c.phone, COUNT(*) AS order_count, SUM(o.net_revenue) AS net_revenue
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE ${where.join(' AND ')} AND o.status IN ${COUNTED} GROUP BY o.customer_id ORDER BY net_revenue DESC LIMIT ?`,
    )
    .all(...params, topLimit);
  return { filter: f, buyers, new_customers: newBuyers, returning_customers: repeat, repeat_rate_pct: pct(repeat, buyers), top_customers: top };
}

export function inventoryMetrics({ shopId, warehouseId } = {}) {
  const items = listStock({ shopId, warehouseId, limit: 5000 });
  const stockValue = items.reduce((a, i) => a + i.stock_value, 0);
  // Giá vốn bán ra 30 ngày gần nhất, tính trên CÙNG phạm vi với giá trị tồn (cùng shop, cùng kho) để số ngày tồn không bị lệch
  const today = businessDate();
  const where = ['o.business_date > ?', `o.status IN ${COUNTED}`];
  const params = [addDays(today, -30)];
  if (shopId) (where.push('o.shop_id = ?'), params.push(shopId));
  // Theo kho: giá vốn của đúng những phần đã xuất từ kho đó (một đơn có thể lấy từ nhiều kho); không lọc kho: cogs_amount của dòng
  const cogs30 = warehouseId
    ? db()
        .prepare(`SELECT COALESCE(SUM((a.qty - a.restocked_qty) * a.unit_cost),0) AS v FROM order_line_allocations a JOIN order_lines l ON l.id = a.order_line_id JOIN orders o ON o.id = l.order_id WHERE a.warehouse_id = ? AND ${where.join(' AND ')}`)
        .get(warehouseId, ...params).v
    : db()
        .prepare(`SELECT COALESCE(SUM(l.cogs_amount),0) AS v FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE ${where.join(' AND ')}`)
        .get(...params).v;
  const daily = cogs30 / 30;
  return {
    stock_value: stockValue,
    days_of_inventory: daily > 0 ? Math.round(stockValue / daily) : null,
    sku_count: items.length,
    low_stock: items.filter((i) => i.is_low).slice(0, 50),
    slow_moving: items.filter((i) => i.is_slow).slice(0, 50),
    negative: items.filter((i) => i.is_negative),
  };
}

export function cashflow(filter) {
  const f = normalizeFilter(filter);
  const pay = db()
    .prepare(
      `SELECT direction, method, COALESCE(SUM(amount),0) AS amt FROM payments
       WHERE voided_at IS NULL AND business_date >= ? AND business_date <= ? ${f.shopIds ? `AND shop_id IN (${f.shopIds.map(() => '?').join(',')})` : ''}
       GROUP BY direction, method`,
    )
    .all(f.from, f.to, ...(f.shopIds || []));
  // Chi phí cũng là tiền ra, vào ngày chi phí, theo phương thức đã chọn. Lọc shop: chỉ chi phí của đúng shop đó;
  // chi phí chung không thuộc shop nào nên không tính vào (số tiền đó báo riêng ở shared_expenses_not_included).
  const expRows = db()
    .prepare(
      `SELECT method, COALESCE(SUM(amount),0) AS amt FROM expenses
       WHERE voided_at IS NULL AND expense_date >= ? AND expense_date <= ? ${f.shopIds ? `AND shop_id IN (${f.shopIds.map(() => '?').join(',')})` : ''}
       GROUP BY method`,
    )
    .all(f.from, f.to, ...(f.shopIds || []));
  const sharedNotIncluded = f.shopIds
    ? db().prepare('SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE voided_at IS NULL AND shop_id IS NULL AND expense_date >= ? AND expense_date <= ?').get(f.from, f.to).v
    : 0;
  const expensesOut = expRows.reduce((a, r) => a + r.amt, 0);
  const sum = (dir) => pay.filter((p) => p.direction === dir).reduce((a, p) => a + p.amt, 0);
  const byMethod = new Map(pay.map((p) => [`${p.direction}|${p.method}`, { direction: p.direction, method: p.method, amt: p.amt }]));
  for (const r of expRows) {
    const k = `out|${r.method}`;
    byMethod.set(k, { direction: 'out', method: r.method, amt: (byMethod.get(k)?.amt || 0) + r.amt });
  }
  const shopFilter = f.shopIds ? `AND o.shop_id IN (${f.shopIds.map(() => '?').join(',')})` : '';
  // Công nợ khách: đơn kênh không phải sàn, đã xác nhận trở đi, còn thiếu tiền
  const receivable = db()
    .prepare(
      `SELECT COALESCE(SUM(o.total_amount - o.returned_amount - o.paid_amount),0) AS v, COUNT(*) AS n
       FROM orders o JOIN channels ch ON ch.id = o.channel_id
       WHERE ch.is_marketplace = 0 AND o.status IN ('confirmed','shipping','completed') AND o.total_amount - o.returned_amount - o.paid_amount > 0 ${shopFilter}`,
    )
    .get(...(f.shopIds || []));
  const hanging = db()
    .prepare(
      `SELECT COALESCE(SUM(o.net_amount - o.returned_amount - o.paid_amount),0) AS v, COUNT(*) AS n
       FROM orders o JOIN channels ch ON ch.id = o.channel_id
       WHERE ch.is_marketplace = 1 AND o.status = 'completed' AND o.net_amount - o.returned_amount - o.paid_amount > 0 ${shopFilter}`,
    )
    .get(...(f.shopIds || []));
  // Tiền sàn treo tách theo từng sàn (Shopee, TikTok Shop…); cộng lại bằng marketplace_pending
  const hangingByChannel = db()
    .prepare(
      `SELECT o.channel_id, ch.name AS channel_name, COALESCE(SUM(o.net_amount - o.returned_amount - o.paid_amount),0) AS pending, COUNT(*) AS orders
       FROM orders o JOIN channels ch ON ch.id = o.channel_id
       WHERE ch.is_marketplace = 1 AND o.status = 'completed' AND o.net_amount - o.returned_amount - o.paid_amount > 0 ${shopFilter}
       GROUP BY o.channel_id ORDER BY pending DESC`,
    )
    .all(...(f.shopIds || []));
  const payable = db()
    .prepare(`SELECT COALESCE(SUM(total_amount - paid_amount),0) AS v, COUNT(*) AS n FROM purchases WHERE status = 'received' AND total_amount - paid_amount > 0`)
    .get();
  return {
    filter: f,
    cash_in: sum('in'),
    cash_out: sum('out') + expensesOut,
    cash_out_expenses: expensesOut,
    cash_out_other: sum('out'), // trả NCC, hoàn tiền khách
    shared_expenses_not_included: sharedNotIncluded,
    net_cash: sum('in') - sum('out') - expensesOut,
    by_method: [...byMethod.values()],
    customer_receivable: receivable.v,
    customer_receivable_orders: receivable.n,
    marketplace_pending: hanging.v,
    marketplace_pending_orders: hanging.n,
    marketplace_by_channel: hangingByChannel,
    supplier_payable: payable.v,
    supplier_payable_purchases: payable.n,
  };
}

/**
 * Báo cáo chi phí: theo danh mục (tách phần của shop và phần chi phí chung đã phân bổ), theo shop, so với kỳ trước,
 * tỷ lệ trên doanh thu thuần, và vài khoản chi lớn nhất để nhìn ra khoản bất thường.
 */
export function expenseReport(filter) {
  const f = normalizeFilter(filter);
  const names = new Map(db().prepare('SELECT id, name FROM expense_categories').all().map((c) => [c.id, c.name]));
  const cur = expensesFor(f);
  const prev = expensesFor(previousPeriod(f));
  const aggregate = (items) => {
    const m = new Map();
    for (const i of items) {
      const a = m.get(i.category_id) || { direct: 0, shared: 0 };
      a[i.kind] += i.amount;
      m.set(i.category_id, a);
    }
    return m;
  };
  const curCat = aggregate(cur.items);
  const prevCat = aggregate(prev.items);
  const ids = new Set([...curCat.keys(), ...prevCat.keys()]);
  const byCategory = [...ids]
    .map((id) => {
      const c = curCat.get(id) || { direct: 0, shared: 0 };
      const amount = c.direct + c.shared;
      const p = prevCat.get(id);
      const previous = p ? p.direct + p.shared : 0;
      return { category_id: id, name: names.get(id) || id, amount, direct: c.direct, shared: c.shared, share_pct: pct(amount, cur.total), previous_amount: previous, change_pct: previous ? Math.round(((amount - previous) / previous) * 1000) / 10 : null };
    })
    .filter((r) => r.amount > 0 || r.previous_amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const shopNames = new Map(db().prepare('SELECT id, name, code FROM shops').all().map((s) => [s.id, s]));
  const byShopRows = [...cur.perShop.entries()].map(([id, amount]) => ({ shop_id: id, shop_name: shopNames.get(id)?.name || id, amount, share_pct: pct(amount, cur.total) })).sort((a, b) => b.amount - a.amount);
  const revenue = sumOrders(f).net_revenue;
  const where = ['e.voided_at IS NULL', 'e.expense_date >= ?', 'e.expense_date <= ?'];
  const params = [f.from, f.to];
  if (f.shopIds) (where.push(`(e.shop_id IN (${f.shopIds.map(() => '?').join(',')}) OR e.shop_id IS NULL)`), params.push(...f.shopIds));
  if (f.channel) (where.push('(e.channel_id = ? OR e.channel_id IS NULL)'), params.push(f.channel));
  const largest = db()
    .prepare(
      `SELECT e.id, e.expense_date, e.amount, e.payee, e.note, e.shop_id, c.name AS category_name, s.name AS shop_name
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN shops s ON s.id = e.shop_id
       WHERE ${where.join(' AND ')} ORDER BY e.amount DESC, e.id DESC LIMIT 5`,
    )
    .all(...params);
  return {
    filter: f,
    total: cur.total,
    direct: cur.direct,
    shared: cur.shared,
    previous_total: prev.total,
    change_pct: prev.total ? Math.round(((cur.total - prev.total) / prev.total) * 1000) / 10 : null,
    net_revenue: revenue,
    expense_ratio_pct: pct(cur.total, revenue),
    by_category: byCategory,
    by_shop: byShopRows,
    largest,
  };
}

const AGE_BUCKETS = [
  { label: '0–7 ngày', min: 0, max: 7 },
  { label: '8–30 ngày', min: 8, max: 30 },
  { label: '31–60 ngày', min: 31, max: 60 },
  { label: '61–90 ngày', min: 61, max: 90 },
  { label: 'Trên 90 ngày', min: 91, max: Infinity },
];
function ageBuckets(items) {
  const buckets = AGE_BUCKETS.map((b) => ({ label: b.label, min: b.min, max: b.max === Infinity ? null : b.max, amount: 0, count: 0 }));
  for (const i of items) {
    const b = AGE_BUCKETS.findIndex((x) => i.age_days >= x.min && i.age_days <= x.max);
    buckets[Math.max(0, b)].amount += i.owed;
    buckets[Math.max(0, b)].count += 1;
  }
  return { total: items.reduce((a, i) => a + i.owed, 0), count: items.length, buckets, items: [...items].sort((a, b) => b.age_days - a.age_days).slice(0, 20) };
}

/**
 * Tuổi nợ tại hôm nay: khách nợ (đơn ngoài sàn), tiền sàn chưa về, nợ nhà cung cấp.
 * Tuổi = số ngày từ ngày đặt đơn (khách, sàn) hoặc ngày nhận hàng (NCC) đến hôm nay. Chỉ lọc theo shop.
 */
export function aging(filter) {
  const f = normalizeFilter(filter);
  const today = businessDate();
  const sf = f.shopIds ? `AND o.shop_id IN (${f.shopIds.map(() => '?').join(',')})` : '';
  const sp = f.shopIds || [];
  const customer = db()
    .prepare(
      `SELECT o.id, o.code, COALESCE(o.customer_name, 'Khách lẻ') AS party, o.business_date AS date, o.total_amount - o.returned_amount - o.paid_amount AS owed
       FROM orders o JOIN channels ch ON ch.id = o.channel_id
       WHERE ch.is_marketplace = 0 AND o.status IN ('confirmed','shipping','completed') AND o.total_amount - o.returned_amount - o.paid_amount > 0 ${sf}`,
    )
    .all(...sp)
    .map((r) => ({ ...r, age_days: Math.max(0, daysBetween(r.date, today)) }));
  const marketplace = db()
    .prepare(
      `SELECT o.id, o.code, ch.name AS party, o.business_date AS date, o.net_amount - o.returned_amount - o.paid_amount AS owed
       FROM orders o JOIN channels ch ON ch.id = o.channel_id
       WHERE ch.is_marketplace = 1 AND o.status = 'completed' AND o.net_amount - o.returned_amount - o.paid_amount > 0 ${sf}`,
    )
    .all(...sp)
    .map((r) => ({ ...r, age_days: Math.max(0, daysBetween(r.date, today)) }));
  const supplier = db()
    .prepare(
      `SELECT p.id, p.code, COALESCE(s.name, 'Không rõ NCC') AS party, COALESCE(p.received_at, p.ordered_at) AS at, p.total_amount - p.paid_amount AS owed
       FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.status = 'received' AND p.total_amount - p.paid_amount > 0`,
    )
    .all()
    .map((r) => ({ id: r.id, code: r.code, party: r.party, owed: r.owed, date: businessDate(r.at), age_days: Math.max(0, daysBetween(businessDate(r.at), today)) }));
  return { as_of: today, filter: f, customer: ageBuckets(customer), marketplace: ageBuckets(marketplace), supplier: ageBuckets(supplier) };
}

/** Đánh giá một chỉ số theo ngưỡng: green | yellow | red | null (chưa có dữ liệu) */
export function grade(value, t) {
  if (value === null || value === undefined) return null;
  if (t.direction === 'higher_better') return value < t.bad ? 'red' : value < t.warn ? 'yellow' : 'green';
  return value > t.bad ? 'red' : value > t.warn ? 'yellow' : 'green';
}

const HEALTH_LABELS = {
  gross_margin_pct: 'Biên lợi nhuận gộp (%)',
  cancel_rate_pct: 'Tỷ lệ huỷ đơn (%)',
  return_rate_pct: 'Tỷ lệ hoàn trả (%)',
  days_of_inventory: 'Số ngày tồn kho',
  repeat_rate_pct: 'Tỷ lệ khách mua lại (%)',
};

export function health(filter) {
  const f = normalizeFilter(filter);
  const s = sumOrders(f);
  const cust = customerMetrics(f, { topLimit: 0 });
  const inv = inventoryMetrics({ shopId: f.shopIds?.length === 1 ? f.shopIds[0] : undefined });
  const values = {
    gross_margin_pct: s.gross_margin_pct,
    cancel_rate_pct: s.cancel_rate_pct,
    return_rate_pct: s.return_rate_pct,
    days_of_inventory: inv.days_of_inventory,
    repeat_rate_pct: cust.repeat_rate_pct,
  };
  const th = getSettings().health_thresholds;
  const order = { red: 0, yellow: 1, green: 2 };
  const data = Object.keys(th)
    .map((k) => ({ key: k, label: HEALTH_LABELS[k] || k, value: values[k] ?? null, status: grade(values[k], th[k]), threshold: th[k] }))
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
  return { filter: f, data, red_count: data.filter((d) => d.status === 'red').length, yellow_count: data.filter((d) => d.status === 'yellow').length };
}

/** Trang tổng quan: gộp các thứ cần xem đầu tiên */
export function dashboard(filter) {
  const today = businessDate();
  const f = normalizeFilter(filter);
  const todayStats = withProfit(sumOrders({ ...f, from: today, to: today }), 0);
  const pending = db()
    .prepare(
      `SELECT status, COUNT(*) AS n FROM orders WHERE status IN ('draft','confirmed','shipping') ${f.shopIds ? `AND shop_id IN (${f.shopIds.map(() => '?').join(',')})` : ''} GROUP BY status`,
    )
    .all(...(f.shopIds || []));
  const inv = inventoryMetrics({ shopId: f.shopIds?.length === 1 ? f.shopIds[0] : undefined });
  return {
    today: todayStats,
    period: overview(f),
    health: health(f),
    pending_orders: Object.fromEntries(pending.map((p) => [p.status, p.n])),
    low_stock: inv.low_stock.slice(0, 10),
    cashflow: cashflow(f),
  };
}
