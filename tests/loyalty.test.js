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
  // Mệnh là thông tin riêng của shop phong thuỷ
  assert.equal((await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' })).status, 200);
  const cust = (await api.post('/customers', { name: 'Nguyễn Văn Tài', phone: '0911000111' })).body.data;
  const setMenh = await api.put(`/custom/values/customer/${cust.id}?shop_id=${pt.id}`, { menh: 'Mộc', ngay_sinh: `1990-${today.slice(5)}` });
  assert.equal(setMenh.status, 200, JSON.stringify(setMenh.body));

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
  const sg = (await api.get(`/loyalty/customers/${cust.id}/suggestions?shop_id=${pt.id}`)).body;
  assert.equal(sg.element, 'Mộc');
  assert.deepEqual(sg.data.map((d) => d.name), ['Vòng thuỷ']);
  assert.deepEqual(sg.data[0].shop_ids, [pt.id]);
  const wrongShop = (await api.get(`/loyalty/customers/${cust.id}/suggestions?shop_id=${nh.id}`)).body;
  assert.equal(wrongShop.data.length, 0, 'shop không theo ngành phong thuỷ thì không gợi ý theo mệnh');
  assert.equal((await api.get(`/loyalty/customers/${c2.id}/suggestions?shop_id=${pt.id}`)).body.data.length, 0, 'khách chưa biết mệnh thì không gợi ý bừa');

  // Mẫu tin: điền biến, biến thiếu giữ nguyên để báo
  const msg = (await api.post('/loyalty/render', { template_id: 'tpl_reorder', customer_id: cust.id, product_id: perfume.id, shop_id: nh.id })).body.data;
  assert.match(msg.message, /Chào Tài, Nước hoa ô tô bên /);
  const partial = (await api.post('/loyalty/render', { template_id: 'tpl_reorder', customer_id: cust.id })).body.data;
  assert.deepEqual(partial.unresolved.sort(), ['san_pham', 'shop']);
  void water;
});

test('Loyalty & Campaign: chiến dịch theo mệnh cho cả shop; khách bị xoá khỏi shop không còn bị nhắc ở shop đó; xoá mẫu tin', async () => {
  const { api, nh, pt, wh } = await setup();
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' });
  const perfume = (await api.post('/products', { name: 'Nước hoa ô tô', consumption_days: 30, variants: [{ sku: 'NH-1', default_price: 150000 }], shop_ids: [nh.id] })).body.data;
  const water = (await api.post('/products', { name: 'Vòng thuỷ', elements: ['Thuỷ'], variants: [{ sku: 'PT-THUY', default_price: 400000 }], shop_ids: [pt.id] })).body.data;
  await api.post('/products', { name: 'Nến hoả', elements: ['Hoả'], variants: [{ sku: 'PT-HOA', default_price: 100000 }], shop_ids: [pt.id] });
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: perfume.variants[0].id, qty: 20, unit_cost: 40000 }, { variant_id: water.variants[0].id, qty: 5, unit_cost: 100000 }] });

  // Khách mệnh Mộc (hợp Thuỷ), khách không rõ mệnh, khách mệnh Mộc đã mua vòng thuỷ
  const mk = async (name, phone) => (await api.post('/customers', { name, phone, shop_id: pt.id })).body.data;
  const a = await mk('Mộc Một', '0911000001');
  const b = await mk('Không rõ mệnh', '0911000002');
  const c = await mk('Mộc Đã Mua', '0911000003');
  await api.put(`/custom/values/customer/${a.id}?shop_id=${pt.id}`, { menh: 'Mộc' });
  await api.put(`/custom/values/customer/${c.id}?shop_id=${pt.id}`, { menh: 'Mộc' });
  await api.post('/orders', { shop_id: pt.id, customer_id: c.id, lines: [{ sku: 'PT-THUY', qty: 1 }], status: 'completed' });

  const camp = (await api.get(`/loyalty/element-campaign?shop_id=${pt.id}`)).body;
  assert.equal(camp.total, 1, 'chỉ khách biết mệnh và còn món hợp chưa mua');
  assert.equal(camp.data[0].customer.id, a.id);
  assert.equal(camp.data[0].element, 'Mộc');
  assert.deepEqual(camp.data[0].suggestions.map((s) => s.name), ['Vòng thuỷ'], 'Hoả không hợp Mộc');
  assert.ok(!camp.data.some((r) => r.customer.id === b.id));
  // Shop không phải phong thuỷ: rỗng kèm lý do; thiếu shop: lỗi
  const none = (await api.get(`/loyalty/element-campaign?shop_id=${nh.id}`)).body;
  assert.equal(none.total, 0);
  assert.ok(none.reason);
  assert.equal((await api.get('/loyalty/element-campaign')).status, 400);
  // Xoá khỏi shop thì ra khỏi chiến dịch
  await api.delete(`/customers/${a.id}?shop_id=${pt.id}`);
  assert.equal((await api.get(`/loyalty/element-campaign?shop_id=${pt.id}`)).body.total, 0);

  // Nhắc mua lại: khách mua nước hoa ô tô ở NH, bị xoá khỏi NH → NH không nhắc nữa; shop khác không liên quan
  const today = businessDate();
  const d = (await api.post('/customers', { name: 'Anh Dùng', phone: '0944000444', shop_id: nh.id })).body.data;
  await api.post('/orders', { shop_id: nh.id, customer_id: d.id, lines: [{ sku: 'NH-1', qty: 1 }], status: 'completed', ordered_at: `${addDays(today, -40)}T05:00:00.000Z` });
  assert.equal((await api.get(`/loyalty/today?shop_id=${nh.id}`)).body.data.reminders.length, 1);
  await api.delete(`/customers/${d.id}?shop_id=${nh.id}`);
  assert.equal((await api.get(`/loyalty/today?shop_id=${nh.id}`)).body.data.reminders.length, 0);
  assert.equal((await api.get('/loyalty/today')).body.data.reminders.length, 0);

  // Mẫu tin nhắn: thêm rồi xoá
  const tpl = (await api.post('/loyalty/templates', { name: 'Thử', kind: 'general', body: 'Chào {ten}' })).body.data;
  assert.equal((await api.delete(`/loyalty/templates/${tpl.id}`)).status, 200);
  assert.ok(!(await api.get('/loyalty/templates')).body.data.some((t) => t.id === tpl.id));
  assert.equal((await api.delete(`/loyalty/templates/${tpl.id}`)).status, 404);
});
