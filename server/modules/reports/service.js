import { getDb } from '../../db/index.js';
import { addDays, daysBetween, businessDate } from '../../lib/time.js';
import { getSettings } from '../settings/service.js';
import { listStock } from '../inventory/service.js';

const db = () => getDb();

// Đơn tính vào doanh thu: đã xác nhận trở đi (kể cả đã trả toàn phần, khi đó net_revenue = 0 nhưng vẫn là một đơn đã bán)
const COUNTED = `('confirmed','shipping','completed','returned')`;

/**
 * Chuẩn hoá bộ lọc. Khoảng ngày mặc định = tháng hiện tại (giờ VN).
 */
export function normalizeFilter(f = {}) {
  const today = businessDate();
  const from = f.from || `${today.slice(0, 7)}-01`;
  const to = f.to || today;
  return { from, to, shopIds: f.shopIds?.length ? f.shopIds : null, channel: f.channel || null };
}

function orderWhere(f, alias = 'o') {
  const where = [`${alias}.business_date >= ?`, `${alias}.business_date <= ?`];
  const params = [f.from, f.to];
  if (f.shopIds) (where.push(`${alias}.shop_id IN (${f.shopIds.map(() => '?').join(',')})`), params.push(...f.shopIds));
  if (f.channel) (where.push(`${alias}.channel_id = ?`), params.push(f.channel));
  return { where, params };
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** Tổng hợp tiền theo đơn trong khoảng + lọc. Dùng chung cho tổng quan, so sánh kỳ trước, theo shop/kênh. */
function sumOrders(f, groupBy = null) {
  const { where, params } = orderWhere(f);
  const sel = groupBy ? `${groupBy} AS k,` : '';
  const rows = db()
    .prepare(
      `SELECT ${sel}
        COUNT(CASE WHEN o.status IN ${COUNTED} THEN 1 END) AS order_count,
        COUNT(CASE WHEN o.status = 'cancelled' THEN 1 END) AS cancelled_count,
        COUNT(CASE WHEN o.status IN ${COUNTED} AND o.returned_amount > 0 THEN 1 END) AS returned_count,
        COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.subtotal END),0) AS subtotal,
        COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.line_discount_amount + o.discount_amount END),0) AS discount_amount,
        COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.goods_revenue END),0) AS goods_revenue,
        COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.returned_amount END),0) AS returned_amount,
        COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.net_revenue END),0) AS net_revenue,
        COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.shipping_fee END),0) AS shipping_fee,
        COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.platform_fee_amount END),0) AS platform_fee,
        COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.seller_shipping_amount END),0) AS seller_shipping,
        COALESCE(SUM(CASE WHEN o.status IN ${COUNTED} THEN o.cogs_amount END),0) AS cogs
       FROM orders o WHERE ${where.join(' AND ')} AND o.status != 'draft' ${groupBy ? 'GROUP BY k' : ''}`,
    )
    .all(...params);
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
  return groupBy ? rows.map((r) => ({ ...finish(r) })) : finish(rows[0]);
}

/**
 * Chi phí trong khoảng, gồm phần chi phí chung phân bổ về từng shop.
 * Quy tắc: revenue (theo doanh thu thuần, mặc định) | equal (chia đều cho shop đang hoạt động).
 * Trả về { total, direct, shared, byShop: Map(shopId → số tiền) }.
 */
function expensesFor(f, byShopRevenue) {
  const rows = db()
    .prepare(
      `SELECT shop_id, COALESCE(SUM(amount),0) AS amt FROM expenses
       WHERE voided_at IS NULL AND expense_date >= ? AND expense_date <= ? ${f.channel ? 'AND (channel_id = ? OR channel_id IS NULL)' : ''} GROUP BY shop_id`,
    )
    .all(...(f.channel ? [f.from, f.to, f.channel] : [f.from, f.to]));
  const shared = rows.find((r) => r.shop_id === null)?.amt || 0;
  const byShop = new Map();
  for (const r of rows) if (r.shop_id) byShop.set(r.shop_id, r.amt);

  const allShops = db().prepare('SELECT id FROM shops WHERE archived_at IS NULL').all().map((s) => s.id);
  const target = f.shopIds ?? allShops;
  const mode = getSettings().expense_allocation;
  const revTotal = allShops.reduce((a, id) => a + (byShopRevenue.get(id) || 0), 0);
  const alloc = new Map();
  for (const id of allShops) {
    let share = 0;
    if (mode === 'equal' || revTotal <= 0) share = Math.round(shared / (allShops.length || 1));
    else share = Math.round((shared * (byShopRevenue.get(id) || 0)) / revTotal);
    alloc.set(id, (byShop.get(id) || 0) + share);
  }
  const total = target.reduce((a, id) => a + (alloc.get(id) || 0), 0);
  const direct = target.reduce((a, id) => a + (byShop.get(id) || 0), 0);
  return { total, direct, shared: total - direct, perShop: alloc };
}

function revenueByShop(f) {
  // Doanh thu để phân bổ chi phí chung phải tính trên MỌI shop (không lọc shop), nếu không tỷ lệ sẽ sai
  const all = { ...f, shopIds: null };
  return new Map(sumOrders(all, 'o.shop_id').map((r) => [r.k, r.net_revenue]));
}

export function previousPeriod(f) {
  const len = daysBetween(f.from, f.to) + 1;
  return { ...f, from: addDays(f.from, -len), to: addDays(f.from, -1) };
}

function withProfit(s, expenses) {
  return { ...s, expenses_amount: expenses, net_profit_estimate: s.gross_profit - expenses };
}

export function overview(filter) {
  const f = normalizeFilter(filter);
  const cur = sumOrders(f);
  const exp = expensesFor(f, revenueByShop(f));
  const prevF = previousPeriod(f);
  const prev = sumOrders(prevF);
  const prevExp = expensesFor(prevF, revenueByShop(prevF));
  const current = withProfit(cur, exp.total);
  const previous = withProfit(prev, prevExp.total);
  const change = {};
  for (const k of ['net_revenue', 'gross_profit', 'order_count', 'net_profit_estimate', 'aov']) {
    change[k] = previous[k] ? Math.round(((current[k] - previous[k]) / Math.abs(previous[k])) * 1000) / 10 : null;
  }
  return { filter: f, previous_filter: { from: prevF.from, to: prevF.to }, current, previous, change_pct: change };
}

export function revenueSeries(filter) {
  const f = normalizeFilter(filter);
  const { where, params } = orderWhere(f);
  const rows = db()
    .prepare(
      `SELECT o.business_date AS date, COUNT(*) AS order_count, COALESCE(SUM(o.net_revenue),0) AS net_revenue,
              COALESCE(SUM(o.net_revenue + o.shipping_fee - o.platform_fee_amount - o.seller_shipping_amount - o.cogs_amount),0) AS gross_profit
       FROM orders o WHERE ${where.join(' AND ')} AND o.status IN ${COUNTED} GROUP BY o.business_date ORDER BY o.business_date`,
    )
    .all(...params);
  // Điền ngày trống để biểu đồ liên tục
  const map = new Map(rows.map((r) => [r.date, r]));
  const out = [];
  for (let d = f.from; d <= f.to; d = addDays(d, 1)) out.push(map.get(d) || { date: d, order_count: 0, net_revenue: 0, gross_profit: 0 });
  return { filter: f, data: out };
}

export function byShop(filter) {
  const f = normalizeFilter(filter);
  const rows = sumOrders({ ...f, shopIds: null }, 'o.shop_id');
  const exp = expensesFor({ ...f, shopIds: null }, new Map(rows.map((r) => [r.k, r.net_revenue])));
  const shops = db().prepare('SELECT id, code, name, color FROM shops WHERE archived_at IS NULL').all();
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
  const rows = sumOrders(f, 'o.channel_id');
  const names = new Map(db().prepare('SELECT id, name FROM channels').all().map((c) => [c.id, c.name]));
  return { filter: f, data: rows.map((r) => ({ channel_id: r.k, channel_name: names.get(r.k) || r.k, ...r })).sort((a, b) => b.net_revenue - a.net_revenue) };
}

export function byProduct(filter, { limit = 50 } = {}) {
  const f = normalizeFilter(filter);
  const { where, params } = orderWhere(f);
  const rows = db()
    .prepare(
      `SELECT v.id AS variant_id, v.sku, p.name AS product_name, v.name AS variant_name,
              SUM(l.qty - l.returned_qty) AS qty_sold,
              SUM(l.line_total - l.allocated_order_discount) AS revenue,
              SUM((l.qty - l.restocked_qty) * l.unit_cost) AS cogs
       FROM order_lines l JOIN orders o ON o.id = l.order_id
       JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
       WHERE ${where.join(' AND ')} AND o.status IN ${COUNTED}
       GROUP BY v.id ORDER BY revenue DESC LIMIT ?`,
    )
    .all(...params, limit);
  return { filter: f, data: rows.map((r) => ({ ...r, gross_profit: r.revenue - r.cogs, margin_pct: pct(r.revenue - r.cogs, r.revenue) })) };
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
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const cogs30 = db()
    .prepare(
      `SELECT COALESCE(SUM(-qty * unit_cost),0) AS v FROM stock_movements WHERE type = 'sale_out' AND created_at >= ?`,
    )
    .get(since).v;
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
  const sum = (dir) => pay.filter((p) => p.direction === dir).reduce((a, p) => a + p.amt, 0);
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
  const payable = db()
    .prepare(`SELECT COALESCE(SUM(total_amount - paid_amount),0) AS v, COUNT(*) AS n FROM purchases WHERE status = 'received' AND total_amount - paid_amount > 0`)
    .get();
  return {
    filter: f,
    cash_in: sum('in'),
    cash_out: sum('out'),
    net_cash: sum('in') - sum('out'),
    by_method: pay,
    customer_receivable: receivable.v,
    customer_receivable_orders: receivable.n,
    marketplace_pending: hanging.v,
    marketplace_pending_orders: hanging.n,
    supplier_payable: payable.v,
    supplier_payable_purchases: payable.n,
  };
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
