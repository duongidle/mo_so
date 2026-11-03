import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { addDays, businessDate } from '../server/lib/time.js';

test('M9: hạng theo chi tiêu 12 tháng, nhắc mua lại, sinh nhật, gợi ý theo mệnh, mẫu tin', async () => {
  const { api, nh, pt, wh } = await setup();
  const perfume = (await api.post('/products', { name: 'Nước hoa ô tô', consumption_days: 45, variants: [{ sku: 'NH-1', default_price: 150000 }], shop_ids: [nh.id] })).body.data;
  const water = (await api.post('/products', { name: 'Vòng thuỷ', elements: ['Thuỷ'], variants: [{ sku: 'PT-THUY', default_price: 400000 }], shop_ids: [pt.id] })).body.data;
  await api.post('/products', { name: 'Nến hoả', elements: ['Hoả'], variants: [{ sku: 'PT-HOA', default_price: 100000 }], shop_ids: [pt.id] });
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: perfume.variants[0].id, qty: 50, unit_cost: 40000 }] });

  const today = businessDate();
  const cust = (await api.post('/customers', { name: 'Nguyễn Văn Tài', phone: '0911000111', element_override: 'Mộc', birth_date: `1990-${today.slice(5)}` })).body.data;

  // 3 chai cách đây 50 ngày: chu kỳ 45 × 3 = 135 ngày → CHƯA đến hạn
  const ago = (n) => `${addDays(today, -n)}T05:00:00.000Z`;
  const o1 = await api.post('/orders', { shop_id: nh.id, customer_id: cust.id, lines: [{ sku: 'NH-1', qty: 3 }], status: 'completed', ordered_at: ago(50), payments: [{ amount: 450000 }] });
  assert.equal(o1.status, 201, JSON.stringify(o1.body));
  assert.equal((await api.get('/loyalty/today')).body.data.reminders.length, 0);

  // Mua thêm 1 chai cách đây 50 ngày cho khách khác → đến hạn (45 ngày) và quá hạn 5 ngày
  const c2 = (await api.post('/customers', { name: 'Lê Lan', phone: '0922000222' })).body.data;
  await api.post('/orders', { shop_id: nh.id, customer_id: c2.id, lines: [{ sku: 'NH-1', qty: 1 }], status: 'completed', ordered_at: ago(50) });
  const rem = (await api.get('/loyalty/today')).body.data.reminders;
  assert.equal(rem.length, 1);
  assert.equal(rem[0].customer.id, c2.id);
  assert.equal(rem[0].overdue_days, 5);

  // Hoãn rồi bỏ qua
  const act = { customer_id: c2.id, product_id: perfume.id, base_date: rem[0].last_purchase_date };
  await api.post('/loyalty/reminders/action', { ...act, action: 'snooze', snooze_days: 2 });
  assert.equal((await api.get('/loyalty/today')).body.data.reminders.length, 0);
  // Mua lại → nhắc nhở mới theo ngày mua mới, nhắc cũ hết hiệu lực
  assert.equal((await api.post('/loyalty/reminders/action', { ...act, action: 'done' })).status, 200);
  await api.post('/orders', { shop_id: nh.id, customer_id: c2.id, lines: [{ sku: 'NH-1', qty: 1 }], status: 'completed' });
  assert.equal((await api.post('/loyalty/reminders/action', { ...act, action: 'done' })).status, 404, 'đã mua lại thì không xử lý nhắc nhở cũ');

  // Hạng: khách 1 chi 450k → Thành viên, còn thiếu 1.55tr lên Bạc
  const l = (await api.get(`/loyalty/customers/${cust.id}`)).body.data;
  assert.equal(l.tier.name, 'Thành viên');
  assert.equal(l.spent_12m, 450000);
  assert.equal(l.next_tier.name, 'Bạc');
  assert.equal(l.to_next, 1550000);
  assert.equal((await api.put('/loyalty/tiers', [{ name: 'A', min_spent: 100, discount_pct: 1 }])).status, 400, 'hạng thấp nhất phải từ 0');
  await api.put('/loyalty/tiers', [{ name: 'Thường', min_spent: 0, discount_pct: 0 }, { name: 'Quen', min_spent: 400000, discount_pct: 2 }]);
  assert.equal((await api.get(`/loyalty/customers/${cust.id}`)).body.data.tier.name, 'Quen');

  // Sinh nhật hôm nay
  const bd = (await api.get('/loyalty/today')).body.data.birthdays;
  assert.equal(bd.length, 1);
  assert.equal(bd[0].in_days, 0);

  // Gợi ý theo mệnh Mộc: hợp Mộc + Thuỷ (sinh Mộc). Hoả không hợp. Bán chéo sang shop Phong thuỷ
  const sg = (await api.get(`/loyalty/customers/${cust.id}/suggestions`)).body;
  assert.equal(sg.element, 'Mộc');
  assert.deepEqual(sg.data.map((d) => d.name), ['Vòng thuỷ']);
  assert.deepEqual(sg.data[0].shop_ids, [pt.id]);
  assert.equal((await api.get(`/loyalty/customers/${c2.id}/suggestions`)).body.data.length, 0, 'khách chưa biết mệnh thì không gợi ý bừa');

  // Mẫu tin: điền biến, biến thiếu giữ nguyên để báo
  const msg = (await api.post('/loyalty/render', { template_id: 'tpl_reorder', customer_id: cust.id, product_id: perfume.id, shop_id: nh.id })).body.data;
  assert.match(msg.message, /Chào Tài, Nước hoa ô tô bên /);
  const partial = (await api.post('/loyalty/render', { template_id: 'tpl_reorder', customer_id: cust.id })).body.data;
  assert.deepEqual(partial.unresolved.sort(), ['san_pham', 'shop']);
  void water;
});
