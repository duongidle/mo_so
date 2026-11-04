import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

/** 3 shop (NH, PT, S3), hàng ở kho chung, vài đơn để có doanh thu */
async function base() {
  const ctx = await setup();
  const { api, nh, pt, wh } = ctx;
  const s3 = (await api.post('/shops', { name: 'Shop 3', code: 'S3', default_warehouse_id: wh.id })).body.data;
  const a = (await api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 100000 }], shop_ids: [nh.id] })).body.data.variants[0];
  const b = (await api.post('/products', { name: 'B', variants: [{ sku: 'B1', default_price: 100000 }], shop_ids: [pt.id] })).body.data.variants[0];
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 10, unit_cost: 40000 }, { variant_id: b.id, qty: 10, unit_cost: 40000 }] });
  return { ...ctx, s3 };
}
const order = async (api, o) => {
  const r = await api.post('/orders', { status: 'completed', ...o });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
};
const ov = async (api, qs = '') => (await api.get(`/reports/overview${qs}`)).body.data.current;

test('Chi phí chung chia cho các shop khớp từng đồng (không lệch 1 đồng khi chia 3)', async () => {
  const { api, nh, pt, s3 } = await base();
  await order(api, { shop_id: nh.id, lines: [{ sku: 'A1', qty: 2 }], payments: [{ amount: 200000 }] });
  await api.patch('/settings', { expense_allocation: 'equal' });
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 100000 });
  const sh = (await api.get('/reports/shops')).body.data;
  assert.equal(sh.length, 3);
  assert.equal(sh.reduce((a, s) => a + s.expenses_amount, 0), 100000);
  assert.equal((await ov(api)).expenses_amount, 100000);
  // Chọn từng shop riêng rồi cộng lại cũng đủ 100.000
  let sum = 0;
  for (const s of [nh, pt, s3]) sum += (await ov(api, `?shop_id=${s.id}`)).expenses_amount;
  assert.equal(sum, 100000);

  // Theo doanh thu: 7 : 3 không chia hết 100.001
  await api.patch('/settings', { expense_allocation: 'revenue' });
  await order(api, { shop_id: pt.id, lines: [{ sku: 'B1', qty: 1 }], payments: [{ amount: 100000 }] });
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 1 });
  assert.equal((await ov(api)).expenses_amount, 100001);
  assert.equal((await api.get('/reports/shops')).body.data.reduce((a, s) => a + s.expenses_amount, 0), 100001);
});

test('Phân bổ cố định theo tỷ lệ cấu hình; cài đặt sai bị từ chối', async () => {
  const { api, nh, pt, s3 } = await base();
  assert.equal((await api.patch('/settings', { expense_allocation: 'xyz' })).status, 400);
  assert.equal((await api.patch('/settings', { expense_allocation_fixed: { [nh.id]: 150 } })).status, 400);
  assert.equal((await api.patch('/settings', { expense_allocation_fixed: { [nh.id]: 'a' } })).status, 400);
  await api.patch('/settings', { expense_allocation: 'fixed', expense_allocation_fixed: { [nh.id]: 50, [pt.id]: 30, [s3.id]: 20 } });
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 1000001 });
  const sh = Object.fromEntries((await api.get('/reports/shops')).body.data.map((s) => [s.shop_code, s.expenses_amount]));
  assert.equal(sh.NH + sh.PT + sh.S3, 1000001);
  assert.ok(Math.abs(sh.NH - 500000.5) <= 1 && Math.abs(sh.PT - 300000.3) <= 1 && Math.abs(sh.S3 - 200000.2) <= 1, JSON.stringify(sh));
  // Tỷ lệ không cộng đủ 100% vẫn chia theo tỷ lệ tương đối; không có tỷ lệ nào thì chia đều
  await api.patch('/settings', { expense_allocation_fixed: { [nh.id]: 10 } });
  const only = Object.fromEntries((await api.get('/reports/shops')).body.data.map((s) => [s.shop_code, s.expenses_amount]));
  assert.deepEqual(only, { NH: 1000001, PT: 0, S3: 0 });
  await api.patch('/settings', { expense_allocation_fixed: {} });
  const eq = (await api.get('/reports/shops')).body.data.map((s) => s.expenses_amount);
  assert.equal(eq.reduce((a, b) => a + b, 0), 1000001);
  assert.ok(Math.max(...eq) - Math.min(...eq) <= 1);
});

test('Dòng tiền tính cả chi phí (tiền ra), theo phương thức; lọc shop thì chi phí chung báo riêng', async () => {
  const { api, nh } = await base();
  await order(api, { shop_id: nh.id, lines: [{ sku: 'A1', qty: 2 }], payments: [{ amount: 200000, method: 'cash' }] });
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 100000, method: 'bank' });
  await api.post('/expenses', { category_id: 'ecat_ads', shop_id: nh.id, amount: 30000, method: 'cash' });
  const cf = (await api.get('/reports/cashflow')).body.data;
  assert.equal(cf.cash_in, 200000);
  assert.equal(cf.cash_out, 130000);
  assert.equal(cf.cash_out_expenses, 130000);
  assert.equal(cf.net_cash, 70000);
  assert.equal(cf.shared_expenses_not_included, 0);
  const out = Object.fromEntries(cf.by_method.filter((m) => m.direction === 'out').map((m) => [m.method, m.amt]));
  assert.deepEqual(out, { bank: 100000, cash: 30000 });
  // Lọc theo shop: chỉ chi phí của shop; phần chi phí chung báo riêng
  const f = (await api.get(`/reports/cashflow?shop_id=${nh.id}`)).body.data;
  assert.equal(f.cash_out_expenses, 30000);
  assert.equal(f.shared_expenses_not_included, 100000);
  // Chi phí đã huỷ không tính
  const e = (await api.post('/expenses', { category_id: 'ecat_ads', amount: 5000 })).body.data;
  await api.delete(`/expenses/${e.id}`);
  assert.equal((await api.get('/reports/cashflow')).body.data.cash_out, 130000);
  // Trả NCC và hoàn tiền vẫn là tiền ra
  const pur = (await api.get('/purchases')).body.data[0];
  await api.post(`/purchases/${pur.id}/payments`, { amount: 50000, method: 'bank' });
  const cf2 = (await api.get('/reports/cashflow')).body.data;
  assert.equal(cf2.cash_out, 180000);
  assert.equal(cf2.cash_out_other, 50000);
});

test('Lọc theo kênh: chi phí chung không bị cộng lặp ở mọi kênh; chi phí gắn kênh chỉ ở kênh đó', async () => {
  const { api, nh } = await base();
  await order(api, { shop_id: nh.id, channel_id: 'direct', lines: [{ sku: 'A1', qty: 3 }], payments: [{ amount: 300000 }] });
  await order(api, { shop_id: nh.id, channel_id: 'shopee', external_id: 'S1', lines: [{ sku: 'A1', qty: 1 }] });
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 100000 }); // chung, không kênh
  await api.post('/expenses', { category_id: 'ecat_ads', shop_id: nh.id, channel_id: 'facebook', amount: 30000 });
  const channels = (await api.get('/channels')).body.data.map((c) => c.id);
  const per = {};
  for (const ch of channels) per[ch] = (await ov(api, `?channel=${ch}`)).expenses_amount;
  assert.equal(Object.values(per).reduce((a, b) => a + b, 0), 130000, `cộng các kênh phải bằng tổng: ${JSON.stringify(per)}`);
  assert.equal(per.facebook, 30000, 'chi phí gắn Facebook chỉ ở Facebook (kênh Facebook không có doanh thu nên không nhận phần chung)');
  assert.equal(per.direct, 75000, 'doanh thu direct 300k : shopee 100k → 75k / 25k');
  assert.equal(per.shopee, 25000);
  assert.equal((await ov(api)).expenses_amount, 130000);
});

test('Số ngày tồn theo shop dùng giá vốn của đúng shop đó', async () => {
  const { api, nh, pt } = await base();
  await order(api, { shop_id: nh.id, lines: [{ sku: 'A1', qty: 2 }], payments: [{ amount: 200000 }] }); // giá vốn 80.000
  await order(api, { shop_id: pt.id, lines: [{ sku: 'B1', qty: 4 }], payments: [{ amount: 400000 }] }); // giá vốn 160.000
  const inv = async (qs = '') => (await api.get(`/reports/inventory${qs}`)).body.data;
  const nhI = await inv(`?shop_id=${nh.id}`);
  const ptI = await inv(`?shop_id=${pt.id}`);
  const all = await inv();
  assert.equal(nhI.stock_value, 320000);
  assert.equal(nhI.days_of_inventory, 120, '320.000 / (80.000/30)');
  assert.equal(ptI.stock_value, 240000);
  assert.equal(ptI.days_of_inventory, 45, '240.000 / (160.000/30)');
  assert.equal(all.days_of_inventory, 70, '560.000 / (240.000/30)');
});

test('Danh sách chi phí: xem theo shop vẫn thấy chi phí chung (đánh dấu không có shop); chi phí của shop đã lưu trữ không biến mất khỏi tổng', async () => {
  const { api, nh, pt } = await base();
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 10000 });
  await api.post('/expenses', { category_id: 'ecat_ads', shop_id: nh.id, amount: 20000 });
  await api.post('/expenses', { category_id: 'ecat_ads', shop_id: pt.id, amount: 40000 });
  const l = (await api.get(`/expenses?shop_id=${nh.id}`)).body.data;
  assert.deepEqual(l.map((e) => e.amount).sort(), [10000, 20000]);
  assert.equal(l.find((e) => e.amount === 10000).shop_id, null);
  assert.deepEqual((await api.get(`/expenses?shop_id=${nh.id}&include_shared=0`)).body.data.map((e) => e.amount), [20000]);

  // Lưu trữ shop PT: chi phí 40.000 của nó vẫn nằm trong tổng và trong bảng theo shop
  await api.patch(`/shops/${pt.id}`, { archived: true });
  assert.ok(!(await api.get('/shops')).body.data.some((s) => s.id === pt.id), 'shop PT phải đã bị lưu trữ');
  const total = (await ov(api)).expenses_amount;
  const byShop = (await api.get('/reports/shops')).body.data.reduce((a, s) => a + s.expenses_amount, 0);
  assert.equal(total, 70000);
  assert.equal(byShop, 70000);
});

test('Báo cáo chi phí: theo danh mục (phần của shop và phần chung), so kỳ trước, tỷ lệ trên doanh thu, khoản lớn nhất', async () => {
  const { api, nh, pt } = await base();
  const today = new Date().toISOString().slice(0, 10);
  await order(api, { shop_id: nh.id, lines: [{ sku: 'A1', qty: 3 }], payments: [{ amount: 300000 }] }); // doanh thu thuần 300.000
  await api.patch('/settings', { expense_allocation: 'equal' });
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 60000 }); // chung: 3 shop × 20.000
  await api.post('/expenses', { category_id: 'ecat_ads', shop_id: nh.id, amount: 15000 });
  const other = (await api.post('/expense-categories', { name: 'Đóng gói' })).body.data;
  await api.post('/expenses', { category_id: other.id, shop_id: nh.id, amount: 5000, payee: 'Cửa hàng bao bì' });
  await api.post('/expenses', { category_id: other.id, shop_id: pt.id, amount: 40000 });

  const r = (await api.get('/reports/expenses')).body.data;
  assert.equal(r.total, 120000);
  assert.equal(r.direct + r.shared, r.total);
  assert.equal(r.net_revenue, 300000);
  assert.equal(r.expense_ratio_pct, 40);
  const ads = r.by_category.find((c) => c.category_id === 'ecat_ads');
  const pack = r.by_category.find((c) => c.category_id === other.id);
  assert.equal(ads.amount, 75000);
  assert.equal(ads.direct, 15000);
  assert.equal(ads.shared, 60000);
  assert.equal(pack.amount, 45000);
  assert.equal(r.by_category.reduce((a, c) => a + c.amount, 0), r.total, 'danh mục cộng lại = tổng');
  assert.equal(r.by_shop.reduce((a, s) => a + s.amount, 0), r.total, 'shop cộng lại = tổng');
  assert.equal(r.by_category[0].category_id, 'ecat_ads', 'xếp giảm dần');
  assert.equal(r.largest[0].amount, 60000);
  assert.equal(r.previous_total, 0);
  assert.equal(r.change_pct, null);

  // Lọc shop NH: 15.000 + 5.000 + phần chung 20.000 = 40.000
  const one = (await api.get(`/reports/expenses?shop_id=${nh.id}`)).body.data;
  assert.equal(one.total, 40000);
  // Khớp với tổng quan
  assert.equal((await ov(api)).expenses_amount, r.total);
  void today;
});

test('Báo cáo chi phí so kỳ trước', async () => {
  const { api, nh } = await base();
  const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  await api.post('/expenses', { category_id: 'ecat_ads', shop_id: nh.id, amount: 100000, expense_date: d(5) });
  await api.post('/expenses', { category_id: 'ecat_ads', shop_id: nh.id, amount: 150000, expense_date: d(1) });
  const r = (await api.get(`/reports/expenses?from=${d(2)}&to=${d(0)}`)).body.data;
  // kỳ 3 ngày (d2..d0), kỳ trước d5..d3 chứa khoản 100.000
  assert.equal(r.total, 150000);
  assert.equal(r.previous_total, 100000);
  assert.equal(r.change_pct, 50);
  assert.equal(r.by_category[0].previous_amount, 100000);
});

test('Tuổi nợ: khách nợ, tiền sàn chưa về, nợ NCC chia theo số ngày; tổng khớp dòng tiền', async () => {
  const { api, nh, wh } = await base();
  const ago = (n) => `${new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)}T04:00:00.000Z`;
  await order(api, { shop_id: nh.id, customer: { name: 'Nợ mới', phone: '0911000001' }, lines: [{ sku: 'A1', qty: 1 }], payments: [{ amount: 40000 }], ordered_at: ago(3) }); // nợ 60.000, 3 ngày
  await order(api, { shop_id: nh.id, customer: { name: 'Nợ cũ', phone: '0911000002' }, lines: [{ sku: 'A1', qty: 2 }], ordered_at: ago(45) }); // nợ 200.000, 45 ngày
  await order(api, { shop_id: nh.id, customer: { name: 'Nợ rất cũ', phone: '0911000003' }, lines: [{ sku: 'A1', qty: 1 }], ordered_at: ago(100) }); // nợ 100.000
  await order(api, { shop_id: nh.id, channel_id: 'shopee', external_id: 'SP1', lines: [{ sku: 'A1', qty: 1 }], platform_fee_amount: 10000, ordered_at: ago(10) });
  const pur = (await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: (await api.get('/stock?q=A1')).body.data[0].variant_id, qty: 5, unit_cost: 40000 }] })).body.data;
  await api.post(`/purchases/${pur.id}/payments`, { amount: 50000, method: 'bank' });

  const g = (await api.get('/reports/aging')).body.data;
  const by = (k) => Object.fromEntries(g[k].buckets.map((b) => [b.label, [b.amount, b.count]]));
  assert.deepEqual(by('customer'), { '0–7 ngày': [60000, 1], '8–30 ngày': [0, 0], '31–60 ngày': [200000, 1], '61–90 ngày': [0, 0], 'Trên 90 ngày': [100000, 1] });
  assert.equal(g.customer.total, 360000);
  assert.equal(g.customer.items[0].party, 'Nợ rất cũ', 'cũ nhất lên đầu');
  assert.equal(g.customer.items[0].age_days, 100);
  assert.equal(g.marketplace.total, 90000);
  assert.equal(by('marketplace')['8–30 ngày'][0], 90000);
  assert.equal(g.supplier.total, 800000 + 150000, 'phiếu nhập có sẵn 800.000 chưa trả + phiếu mới còn nợ 150.000');
  const cf = (await api.get('/reports/cashflow')).body.data;
  assert.equal(g.customer.total, cf.customer_receivable);
  assert.equal(g.marketplace.total, cf.marketplace_pending);
  assert.equal(g.supplier.total, cf.supplier_payable);
  // Lọc theo shop khác: khách/sàn rỗng, nợ NCC vẫn có (phiếu nhập không thuộc shop)
  const other = (await api.get(`/reports/aging?shop_id=${'shp_none'}`)).body.data;
  assert.equal(other.customer.total, 0);
});

test('Lọc danh mục sản phẩm (kể cả danh mục con) ở báo cáo sản phẩm và ngũ hành', async () => {
  const { api, nh, wh } = await base();
  const parent = (await api.post('/categories', { name: 'Hương' })).body.data;
  const child = (await api.post('/categories', { name: 'Hương xe', parent_id: parent.id })).body.data;
  await api.patch(`/shops/${nh.id}`, { industry: 'phong_thuy' });
  const mk = async (name, sku, cat, el) => (await api.post('/products', { name, category_id: cat, custom: { ngu_hanh: el }, custom_shop_id: nh.id, variants: [{ sku, default_price: 100000 }], shop_ids: [nh.id] })).body.data.variants[0];
  const c1 = await mk('Trong con', 'C1', child.id, ['Mộc']);
  const c2 = await mk('Ngoài', 'C2', null, ['Kim']);
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: c1.id, qty: 5, unit_cost: 10000 }, { variant_id: c2.id, qty: 5, unit_cost: 10000 }] });
  await order(api, { shop_id: nh.id, lines: [{ sku: 'C1', qty: 2 }, { sku: 'C2', qty: 3 }], payments: [{ amount: 500000 }] });
  const all = (await api.get('/reports/products')).body.data.map((p) => p.sku).sort();
  assert.deepEqual(all, ['C1', 'C2']);
  assert.deepEqual((await api.get(`/reports/products?category_id=${parent.id}`)).body.data.map((p) => p.sku), ['C1'], 'lọc danh mục cha gồm cả con');
  assert.deepEqual((await api.get(`/reports/products?category_id=${child.id}`)).body.data.map((p) => p.sku), ['C1']);
  const el = (await api.get(`/reports/elements?category_id=${parent.id}`)).body.data;
  assert.equal(el.find((e) => e.element === 'Mộc').revenue, 200000);
  assert.equal(el.find((e) => e.element === 'Kim').revenue, 0);
});

test('Ước tính thuế: mặc định tắt, tự nhập quy tắc, ngưỡng miễn thuế theo năm, cộng các kỳ liền nhau ra đúng cả năm', async () => {
  const { api, nh } = await base();
  const year = new Date().getUTCFullYear();
  const ordOn = (d, amountQty) => order(api, { shop_id: nh.id, lines: [{ sku: 'A1', qty: amountQty }], payments: [{ amount: amountQty * 100000 }], ordered_at: `${d}T04:00:00.000Z`, shipping_fee: 0 });
  // Hai tháng đầu năm: tháng 1 doanh thu 400.000, tháng 2 doanh thu 600.000
  await api.post('/purchases', { warehouse_id: (await api.get('/warehouses')).body.data[0].id, receive: true, lines: [{ variant_id: (await api.get('/stock?q=A1')).body.data[0].variant_id, qty: 20, unit_cost: 1000 }] });
  await ordOn(`${year}-01-10`, 4);
  await ordOn(`${year}-02-10`, 6);

  const jan = `from=${year}-01-01&to=${year}-01-31`;
  const feb = `from=${year}-02-01&to=${year}-02-28`;
  const both = `from=${year}-01-01&to=${year}-02-28`;
  assert.equal((await api.get(`/reports/overview?${jan}`)).body.data.tax, null, 'mặc định tắt');

  // Cài đặt sai bị từ chối
  assert.equal((await api.patch('/settings', { tax_rules: [{ name: 'x', rate_pct: 101, base: 'net_revenue' }] })).status, 400);
  assert.equal((await api.patch('/settings', { tax_rules: [{ name: 'x', rate_pct: 1, base: 'khac' }] })).status, 400);
  assert.equal((await api.patch('/settings', { tax_enabled: 'yes' })).status, 400);

  // Một quy tắc 2%, ngưỡng miễn thuế cả năm 500.000 trên doanh thu thuần
  await api.patch('/settings', { tax_enabled: true, tax_rules: [{ name: 'Thuế thử', rate_pct: 2, base: 'net_revenue', exempt_threshold_year: 500000 }] });
  const t = async (qs) => (await api.get(`/reports/overview?${qs}`)).body.data;
  const j = (await t(jan)).tax;
  const f = (await t(feb)).tax;
  const b = (await t(both)).tax;
  assert.equal(j.applicable, true);
  assert.equal(j.total, 0, 'tháng 1: 400.000 chưa vượt ngưỡng 500.000');
  assert.equal(f.total, Math.round(0.02 * (1000000 - 500000)), 'tháng 2: cộng dồn 1.000.000, vượt 500.000 → 10.000');
  assert.equal(b.total, j.total + f.total, 'cộng hai tháng liền nhau = cả kỳ');
  assert.equal(b.items[0].base_amount, 1000000);
  assert.equal(b.items[0].taxable_amount, 500000);
  const o = await t(both);
  assert.equal(o.current.tax_estimate_amount, 10000);
  assert.equal(o.current.profit_after_tax_estimate, o.current.net_profit_estimate - 10000);

  // Kỳ qua năm mới tách theo năm (ngưỡng tính lại từ đầu năm sau)
  await ordOn(`${year + 1}-01-05`, 8);
  const cross = (await t(`from=${year}-12-01&to=${year + 1}-01-31`)).tax;
  assert.equal(cross.total, Math.round(0.02 * (800000 - 500000)), 'năm sau: 800.000 − 500.000 = 300.000 → 6.000; năm trước tháng 12 không có thêm doanh thu');

  // Cơ sở khác: lợi nhuận ròng; lọc shop/kênh thì không tính
  await api.patch('/settings', { tax_rules: [{ name: 'Thuế LN', rate_pct: 10, base: 'net_profit', exempt_threshold_year: 0 }] });
  const np = (await t(both));
  assert.equal(np.tax.total, Math.round(0.1 * np.current.net_profit_estimate));
  const filtered = (await t(`${both}&shop_id=${nh.id}`)).tax;
  assert.equal(filtered.applicable, false);
  assert.ok(filtered.reason);
  // Tắt lại
  await api.patch('/settings', { tax_enabled: false });
  assert.equal((await t(both)).tax, null);
});
