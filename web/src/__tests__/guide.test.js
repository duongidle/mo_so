import { describe, it, expect } from 'vitest';
import { buildChecks, summarize } from '../guide.js';
import { reportTables, sheetName } from '../reportTables.js';

const bucket = (label, min, amount, count) => ({ label, min, max: null, amount, count });
const emptyAging = () => ({ total: 0, count: 0, items: [], buckets: [bucket('0–7 ngày', 0, 0, 0), bucket('8–30 ngày', 8, 0, 0), bucket('31–60 ngày', 31, 0, 0), bucket('61–90 ngày', 61, 0, 0), bucket('Trên 90 ngày', 91, 0, 0)] });
const th = { direction: 'higher_better', warn: 35, bad: 25 };
const health = (over = {}) => ({ data: [
  { key: 'gross_margin_pct', label: 'Biên', value: 40, status: 'green', threshold: th, ...over.margin },
  { key: 'cancel_rate_pct', label: 'Huỷ', value: 2, status: 'green', threshold: { direction: 'lower_better', warn: 5, bad: 10 }, ...over.cancel },
  { key: 'return_rate_pct', label: 'Hoàn', value: 1, status: 'green', threshold: { direction: 'lower_better', warn: 3, bad: 6 }, ...over.ret },
  { key: 'days_of_inventory', label: 'Ngày tồn', value: 40, status: 'green', threshold: { direction: 'lower_better', warn: 90, bad: 150 }, ...over.doi },
  { key: 'repeat_rate_pct', label: 'Mua lại', value: 30, status: 'green', threshold: th, ...over.repeat },
] });
const base = (o = {}) => ({
  health: health(o.health),
  overview: { current: { order_count: 20, net_revenue: 10000000, gross_profit: 4000000, gross_margin_pct: 40, net_profit_estimate: 1500000, ...o.current } },
  cash: { customer_receivable: 0, marketplace_pending: 0, supplier_payable: 0, ...o.cash },
  aging: { customer: emptyAging(), marketplace: emptyAging(), supplier: emptyAging(), ...o.aging },
  accounts: { total_balance: 5000000, data: [{ name: 'Tiền mặt', balance: 2000000 }, { name: 'Ngân hàng', balance: 3000000 }], unassigned: { has_activity: false }, ...o.accounts },
  inventory: { stock_value: 8000000, days_of_inventory: 40, sku_count: 10, low_stock: [], slow_moving: [], negative: [], ...o.inventory },
  expense: { total: 2000000, previous_total: 2000000, change_pct: 0, expense_ratio_pct: 20, by_category: [{ name: 'Quảng cáo', amount: 1000000, previous_amount: 1000000, change_pct: 0 }], ...o.expense },
});
const by = (checks, id) => checks.find((c) => c.id === id);

describe('buildChecks: 5 câu hỏi sức khoẻ', () => {
  it('mọi thứ ổn → 5 xanh, không việc gấp', () => {
    const c = buildChecks(base());
    expect(c.map((x) => x.id)).toEqual(['money', 'profit', 'stock', 'customers', 'expenses']);
    expect(c.every((x) => x.status === 'green')).toBe(true);
    expect(summarize(c)).toMatchObject({ red: 0, yellow: 0, green: 5, first: expect.anything() });
  });

  it('tiền: quỹ âm → đỏ; nợ khách/sàn/NCC quá 30 ngày hoặc chưa gán quỹ → vàng, nói rõ số khoản và số tiền', () => {
    expect(by(buildChecks(base({ accounts: { total_balance: -1, data: [{ name: 'Két', balance: -1 }], unassigned: { has_activity: false } } })), 'money').status).toBe('red');
    const old = emptyAging();
    old.buckets[2] = bucket('31–60 ngày', 31, 300000, 2);
    old.buckets[4] = bucket('Trên 90 ngày', 91, 100000, 1);
    const m = by(buildChecks(base({ aging: { customer: old, marketplace: emptyAging(), supplier: emptyAging() } })), 'money');
    expect(m.status).toBe('yellow');
    expect(m.todo.join(' ')).toContain('3 khoản khách nợ quá 30 ngày');
    expect(m.todo.join(' ')).toContain('400.000');
    expect(by(buildChecks(base({ accounts: { total_balance: 1, data: [{ name: 'a', balance: 1 }], unassigned: { has_activity: true } } })), 'money').status).toBe('yellow');
    // nợ mới (dưới 30 ngày) là bình thường
    const fresh = emptyAging();
    fresh.buckets[0] = bucket('0–7 ngày', 0, 900000, 5);
    expect(by(buildChecks(base({ aging: { customer: fresh, marketplace: emptyAging(), supplier: emptyAging() } })), 'money').status).toBe('green');
  });

  it('lãi: theo ngưỡng người dùng đặt; lỗ sau chi phí luôn đỏ dù biên gộp xanh; chưa có đơn → không đánh giá', () => {
    expect(by(buildChecks(base({ health: { margin: { status: 'yellow', value: 30 } } })), 'profit').status).toBe('yellow');
    expect(by(buildChecks(base({ health: { margin: { status: 'red', value: 20 } } })), 'profit').status).toBe('red');
    const loss = by(buildChecks(base({ current: { net_profit_estimate: -500000 } })), 'profit');
    expect(loss.status).toBe('red');
    expect(loss.todo.join(' ')).toContain('lỗ 500.000');
    const none = by(buildChecks(base({ current: { order_count: 0, net_profit_estimate: 0 } })), 'profit');
    expect(none.status).toBeNull();
    expect(none.headline).toContain('Chưa có đơn');
  });

  it('hàng: sắp hết, tồn âm → vàng; số ngày tồn đỏ theo ngưỡng; chưa có sản phẩm → không đánh giá', () => {
    expect(by(buildChecks(base({ inventory: { low_stock: [{ sku: 'A' }], stock_value: 1, days_of_inventory: 5, sku_count: 1, slow_moving: [], negative: [] } })), 'stock').status).toBe('yellow');
    expect(by(buildChecks(base({ inventory: { negative: [{ sku: 'A' }], low_stock: [], slow_moving: [], stock_value: 1, days_of_inventory: 5, sku_count: 1 } })), 'stock').todo.join(' ')).toContain('tồn âm');
    expect(by(buildChecks(base({ health: { doi: { status: 'red', value: 200 } } })), 'stock').status).toBe('red');
    expect(by(buildChecks(base({ inventory: { sku_count: 0, stock_value: 0, days_of_inventory: null, low_stock: [], slow_moving: [], negative: [] } })), 'stock').status).toBeNull();
  });

  it('khách: lấy mức xấu nhất trong mua lại, huỷ, hoàn; gợi ý đúng việc', () => {
    const c = by(buildChecks(base({ health: { repeat: { status: 'red', value: 5 }, cancel: { status: 'yellow', value: 7 } } })), 'customers');
    expect(c.status).toBe('red');
    expect(c.todo.join(' ')).toContain('Loyalty & Campaign');
    expect(c.todo.join(' ')).toContain('đơn huỷ');
  });

  it('chi phí: một danh mục tăng trên 20% → vàng và nêu đúng danh mục; giảm hay tăng nhỏ thì không báo', () => {
    const jump = by(buildChecks(base({ expense: { total: 3000000, previous_total: 2000000, change_pct: 50, expense_ratio_pct: 30, by_category: [{ name: 'Quảng cáo', amount: 2000000, previous_amount: 1000000, change_pct: 100 }, { name: 'Bao bì', amount: 1000000, previous_amount: 1000000, change_pct: 0 }] } })), 'expenses');
    expect(jump.status).toBe('yellow');
    expect(jump.todo[0]).toContain('“Quảng cáo” tăng 100%');
    const drop = by(buildChecks(base({ expense: { total: 1000000, previous_total: 2000000, change_pct: -50, expense_ratio_pct: 10, by_category: [{ name: 'Quảng cáo', amount: 1000000, previous_amount: 2000000, change_pct: -50 }] } })), 'expenses');
    expect(drop.status).toBe('green');
    expect(by(buildChecks(base({ expense: { total: 0, previous_total: 0, change_pct: null, expense_ratio_pct: null, by_category: [] } })), 'expenses').status).toBeNull();
  });

  it('tóm tắt: đếm đỏ/vàng, việc xử lý trước là việc đỏ', () => {
    const c = buildChecks(base({ health: { margin: { status: 'red', value: 10 } }, inventory: { low_stock: [{ sku: 'x' }], stock_value: 1, days_of_inventory: 5, sku_count: 1, slow_moving: [], negative: [] } }));
    const s = summarize(c);
    expect(s.red).toBe(1);
    expect(s.yellow).toBe(1);
    expect(s.first.id).toBe('profit');
  });
});

describe('reportTables: xuất đúng những gì đang xem', () => {
  const range = { from: '2026-11-01', to: '2026-11-03' };
  const cur = { gross_revenue: 1000, discount_amount: 100, returned_amount: 50, net_revenue: 850, order_count: 3, aov: 283, cancel_rate_pct: 0, return_rate_pct: 33.3, shipping_fee: 10, platform_fee: 20, seller_shipping: 5, cogs: 400, gross_profit: 435, gross_margin_pct: 51.2, expenses_amount: 100, net_profit_estimate: 335 };

  it('mọi bảng có số cột khớp số tiêu đề; tiền là số, không phải chuỗi', () => {
    const tabs = {
      revenue: [{ data: { current: cur } }, { data: [{ date: '2026-11-01', order_count: 1, net_revenue: 850, gross_profit: 435 }] }],
      profit: [{ data: { current: cur, tax: { applicable: true, items: [{ name: 'Thuế', rate_pct: 1, base_label: 'x', exempt_threshold_year: 0, taxable_amount: 850, tax: 9 }] } } }, { data: [{ shop_name: 'A', net_revenue: 850, gross_profit: 435, expenses_amount: 100, net_profit_estimate: 335 }] }],
      channels: { data: [{ channel_name: 'Shopee', order_count: 1, net_revenue: 1, platform_fee: 2, gross_profit: 3, gross_margin_pct: 4, cancel_rate_pct: 5 }] },
      products: [{ data: [{ sku: 'A', product_name: 'P', variant_name: 'v', is_bundle: false, qty_sold: 1, qty_in_combos: 2, revenue: 3, cogs: 4, gross_profit: 5, margin_pct: 6 }] }, { data: [{ element: null, revenue: 1, qty: 1 }] }],
      customers: { data: { buyers: 1, new_customers: 1, returning_customers: 0, repeat_rate_pct: 0, top_customers: [{ code: 'KH1', name: 'A', phone: '09', order_count: 1, net_revenue: 5 }] } },
      inventory: { data: { stock_value: 1, days_of_inventory: 2, sku_count: 3, low_stock: [{ sku: 'a', product_name: 'p', on_hand: 1 }], slow_moving: [{ sku: 'b', product_name: 'q', on_hand: 2, stock_value: 3 }] } },
      cash: [{ data: { cash_in: 1, cash_out: 2, cash_out_expenses: 1, net_cash: -1, customer_receivable: 0, marketplace_pending: 0, supplier_payable: 0 } }, { data: { customer: { buckets: [{ label: '0–7 ngày', count: 1, amount: 5 }] }, marketplace: { buckets: [] }, supplier: { buckets: [] } } }, { as_of: '2026-11-03', data: [{ name: 'Tiền mặt', kind: 'cash', balance: 7 }] }],
      expenses: { data: { total: 1, direct: 1, shared: 0, previous_total: 0, expense_ratio_pct: 1, by_category: [{ name: 'QC', amount: 1, direct: 1, shared: 0, share_pct: 100, previous_amount: 0, change_pct: null }], by_shop: [{ shop_name: 'A', amount: 1, share_pct: 100 }], largest: [{ expense_date: '2026-11-01', category_name: 'QC', shop_name: null, payee: null, amount: 1 }] } },
      custom: { data: [{ name: 'M', value: 1, error: null }] },
      health: { data: [{ label: 'Biên', value: 40, status: 'green', threshold: { warn: 35, bad: 25 } }] },
    };
    for (const [tab, d] of Object.entries(tabs)) {
      const tables = reportTables(tab, d, { range, shopName: 'Shop A' });
      expect(tables.length, tab).toBeGreaterThan(1);
      expect(tables[0].rows).toContainEqual(['Shop', 'Shop A']);
      for (const t of tables) for (const r of t.rows) expect(r.length, `${tab}/${t.name}`).toBe(t.headers.length);
    }
    const profit = reportTables('profit', tabs.profit, { range });
    const row = Object.fromEntries(profit.find((t) => t.name === 'Lợi nhuận').rows);
    expect(row['Phí sàn']).toBe(-20);
    expect(row['Lợi nhuận ròng ước tính (trước thuế)']).toBe(335);
    expect(profit.find((t) => t.name === 'Ước tính thuế').rows[0][5]).toBe(9);
    expect(reportTables('revenue', tabs.revenue, { range }).find((t) => t.name === 'Theo ngày').rows[0][0]).toBe('01/11/2026');
  });

  it('tên sheet Excel hợp lệ (≤ 31 ký tự, bỏ ký tự cấm)', () => {
    expect(sheetName('Khoản chi lớn nhất / danh mục [x]: rất dài rất dài rất dài').length).toBeLessThanOrEqual(31);
    expect(sheetName('A/B:C')).toBe('A B C');
  });
});
