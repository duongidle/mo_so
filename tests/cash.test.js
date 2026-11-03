import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { addDays, businessDate } from '../server/lib/time.js';

async function world() {
  const ctx = await setup();
  const { api, nh, wh } = ctx;
  const a = (await api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 100000 }], shop_ids: [nh.id] })).body.data.variants[0];
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 50, unit_cost: 40000 }] });
  const sale = (amount, method, extra = {}) => api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'A1', qty: 1 }], status: 'completed', payments: [{ amount, method }], ...extra });
  return { ...ctx, sale };
}
const accts = async (api, qs = '') => {
  const b = (await api.get(`/cash/accounts${qs}`)).body;
  return { ...b, by: Object.fromEntries(b.data.map((a) => [a.id, a])) };
};

test('Quỹ mặc định: tiền mặt (cash, cod) và ngân hàng (còn lại); số dư = thu − chi − chi phí theo phương thức', async () => {
  const { api, sale } = await world();
  let g = await accts(api);
  assert.deepEqual(g.data.map((a) => a.name), ['Tiền mặt', 'Ngân hàng']);
  assert.deepEqual(g.by.cac_cash.methods, ['cash', 'cod']);
  await sale(100000, 'cash');
  await sale(100000, 'cod');
  await sale(100000, 'bank');
  await sale(100000, 'shopee_payout');
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 30000, method: 'cash' });
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 70000, method: 'bank' });
  const gone = (await api.post('/expenses', { category_id: 'ecat_ads', amount: 999999, method: 'cash' })).body.data;
  await api.delete(`/expenses/${gone.id}`);
  g = await accts(api);
  assert.equal(g.by.cac_cash.balance, 200000 - 30000);
  assert.equal(g.by.cac_bank.balance, 200000 - 70000);
  assert.equal(g.total_balance, 300000);
  assert.equal(g.unassigned.has_activity, false);
  // Khớp báo cáo dòng tiền
  const cf = (await api.get('/reports/cashflow')).body.data;
  assert.equal(g.total_balance, cf.net_cash);
});

test('Số dư đầu kỳ: chỉ tính từ ngày mở sổ; thu chi trước đó bị bỏ qua', async () => {
  const { api, sale } = await world();
  const today = businessDate();
  const ago = `${addDays(today, -3)}T04:00:00.000Z`;
  await sale(500000, 'cash', { ordered_at: ago, payments: [{ amount: 500000, method: 'cash', paid_at: ago }] });
  await sale(100000, 'cash');
  assert.equal((await accts(api)).by.cac_cash.balance, 600000, 'mặc định tính toàn bộ lịch sử');
  const r = await api.patch('/cash/accounts/cac_cash', { opening_balance: 2000000, opening_date: today });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.balance, 2100000, 'số dư đầu 2tr tại đầu hôm nay + 100k thu hôm nay; 500k hôm trước đã nằm trong số dư đầu');
  assert.equal((await accts(api, `?as_of=${addDays(today, -1)}`)).by.cac_cash.balance, 2000000, 'xem tại ngày trước ngày mở sổ: chỉ có số dư đầu');
});

test('Chuyển quỹ: hai dòng đối ứng, tổng không đổi, huỷ được cả hai phía', async () => {
  const { api, sale } = await world();
  await sale(300000, 'bank');
  const t = await api.post('/cash/transfers', { from_account_id: 'cac_bank', to_account_id: 'cac_cash', amount: 120000, note: 'Rút về két' });
  assert.equal(t.status, 201);
  let g = await accts(api);
  assert.equal(g.by.cac_bank.balance, 180000);
  assert.equal(g.by.cac_cash.balance, 120000);
  assert.equal(g.total_balance, 300000);
  assert.equal((await api.post('/cash/transfers', { from_account_id: 'cac_bank', to_account_id: 'cac_bank', amount: 1 })).status, 400);
  assert.equal((await api.post('/cash/transfers', { from_account_id: 'cac_bank', to_account_id: 'cac_cash', amount: 0 })).status, 400);
  assert.equal((await api.post('/cash/transfers', { from_account_id: 'cac_bank', to_account_id: 'khong_co', amount: 5 })).status, 404);
  const led = (await api.get('/cash/accounts/cac_cash/ledger')).body.data;
  const entry = led.data.find((r) => r.source === 'transfer');
  assert.equal(entry.amount, 120000);
  assert.equal((await api.delete(`/cash/entries/${entry.id}`)).status, 200);
  g = await accts(api);
  assert.equal(g.by.cac_bank.balance, 300000);
  assert.equal(g.by.cac_cash.balance, 0, 'huỷ một phía thì phía kia cũng huỷ');
  assert.equal((await api.delete(`/cash/entries/${entry.id}`)).status, 409);
});

test('Kiểm đếm: ghi đúng phần chênh, đếm lại cùng số thì không ghi thêm; sổ quỹ có số dư chạy khớp', async () => {
  const { api, sale } = await world();
  await sale(100000, 'cash');
  await sale(70000, 'cash');
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 20000, method: 'cash' });
  const c1 = (await api.post('/cash/accounts/cac_cash/count', { counted_amount: 130000 })).body.data;
  assert.equal(c1.system_balance, 150000);
  assert.equal(c1.difference, -20000);
  assert.equal(c1.balance, 130000);
  const c2 = (await api.post('/cash/accounts/cac_cash/count', { counted_amount: 130000 })).body.data;
  assert.equal(c2.difference, 0);
  const led = (await api.get('/cash/accounts/cac_cash/ledger')).body.data;
  assert.equal(led.closing_balance, 130000);
  assert.equal(led.data.filter((r) => r.source === 'adjust').length, 1);
  assert.equal(led.data.at(-1).balance, 130000);
  assert.deepEqual(led.data.map((r) => r.source).sort(), ['adjust', 'expense', 'payment', 'payment']);
  // chạy: mỗi dòng cộng dồn đúng
  let run = led.opening_balance;
  for (const r of led.data) assert.equal(r.balance, (run += r.amount));
});

test('Gán phương thức: mỗi phương thức chỉ thuộc một quỹ; phương thức chưa gán được báo riêng; không lưu trữ quỹ còn phương thức', async () => {
  const { api, sale } = await world();
  const dup = await api.post('/cash/accounts', { name: 'Két phụ', methods: ['cash'] });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'METHOD_TAKEN');
  assert.equal((await api.post('/cash/accounts', { name: 'X', methods: ['bitcoin'] })).status, 400);
  assert.equal((await api.patch('/cash/accounts/cac_cash', { archived: true })).status, 409);

  // Gỡ thẻ khỏi ngân hàng → tiền thẻ không thuộc quỹ nào, hiện ở "chưa gán"
  await api.patch('/cash/accounts/cac_bank', { methods: ['bank', 'shopee_payout', 'ewallet', 'other'] });
  await sale(80000, 'card');
  let g = await accts(api);
  assert.ok(g.unassigned.methods.includes('card'));
  assert.equal(g.unassigned.net, 80000);
  assert.equal(g.unassigned.has_activity, true);
  // Tạo quỹ POS nhận thẻ
  const pos = await api.post('/cash/accounts', { name: 'Máy POS', kind: 'bank', methods: ['card'], opening_balance: 5000 });
  assert.equal(pos.status, 201);
  g = await accts(api);
  assert.equal(g.by[pos.body.data.id].balance, 85000);
  assert.equal(g.unassigned.has_activity, false);
  // Lưu trữ khi đã bỏ hết phương thức
  await api.patch(`/cash/accounts/${pos.body.data.id}`, { methods: [] });
  assert.equal((await api.patch(`/cash/accounts/${pos.body.data.id}`, { archived: true })).status, 200);
  assert.ok(!(await accts(api)).data.some((a) => a.id === pos.body.data.id));
  // PATCH một trường không xoá các trường khác
  const keep = (await api.patch('/cash/accounts/cac_bank', { name: 'Vietcombank' })).body.data;
  assert.deepEqual([keep.name, keep.methods, keep.kind], ['Vietcombank', ['bank', 'shopee_payout', 'ewallet', 'other'], 'bank']);
});

test('Tổng số dư các quỹ + chưa gán = dòng tiền ròng toàn thời gian (khi chưa có số dư đầu và điều chỉnh)', async () => {
  const { api, sale } = await world();
  await sale(100000, 'cash');
  await sale(200000, 'bank');
  await sale(50000, 'card');
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 12345, method: 'ewallet' });
  const pur = (await api.get('/purchases')).body.data[0];
  await api.post(`/purchases/${pur.id}/payments`, { amount: 100000, method: 'bank' });
  const g = await accts(api);
  const cf = (await api.get('/reports/cashflow')).body.data;
  assert.equal(g.total_balance + g.unassigned.net, cf.net_cash);
  assert.equal(cf.net_cash, 350000 - 12345 - 100000);
});
