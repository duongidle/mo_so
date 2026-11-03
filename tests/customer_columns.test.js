import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

const fields = async (api, shopId) => (await api.get(`/custom/fields?entity_type=customer&shop_id=${shopId}`)).body.data;

test('Trường thông tin khách hiện thành cột ở danh sách khách, riêng từng shop, có giới hạn số cột', async () => {
  const { api, nh, pt } = await setup();
  await api.patch(`/shops/${nh.id}`, { industry: 'nuoc_hoa_o_to' });
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' });
  const a = (await api.post('/customers', { name: 'Anh A', phone: '0911000001', shop_id: nh.id })).body.data;
  await api.post('/customers', { name: 'Anh B', phone: '0911000002', shop_id: nh.id });
  await api.put(`/custom/values/customer/${a.id}?shop_id=${nh.id}`, { dong_xe: 'Camry', nhom_huong: ['Gỗ', 'Biển'] });

  // Mặc định chưa có cột nào
  assert.deepEqual((await api.get(`/customers?shop_id=${nh.id}`)).body.columns, []);

  const fs = await fields(api, nh.id);
  const byKey = Object.fromEntries(fs.map((f) => [f.key, f]));
  assert.equal((await api.patch(`/custom/fields/${byKey.dong_xe.id}`, { show_in_list: true })).status, 200);
  assert.equal((await api.patch(`/custom/fields/${byKey.nhom_huong.id}`, { show_in_list: true })).status, 200);

  const list = (await api.get(`/customers?shop_id=${nh.id}`)).body;
  assert.deepEqual(list.columns.map((c) => c.key), ['nhom_huong', 'dong_xe'], 'theo thứ tự trường của shop');
  const rowA = list.data.find((c) => c.id === a.id);
  assert.deepEqual(rowA.shop_values, { dong_xe: 'Camry', nhom_huong: ['Gỗ', 'Biển'] });
  assert.deepEqual(list.data.find((c) => c.name === 'Anh B').shop_values, {}, 'khách chưa nhập thì trống');

  // Shop khác và chế độ không chọn shop: không có cột, không lộ giá trị
  assert.deepEqual((await api.get(`/customers?shop_id=${pt.id}`)).body.columns, []);
  const all = (await api.get('/customers')).body;
  assert.deepEqual(all.columns, []);
  assert.equal(all.data[0].shop_values, undefined);

  // Giới hạn 4 cột mỗi shop
  const mk = (key) => api.post('/custom/fields', { entity_type: 'customer', shop_id: nh.id, key, label: key, type: 'text', show_in_list: true });
  assert.equal((await mk('c3')).status, 201);
  assert.equal((await mk('c4')).status, 201);
  const over = await mk('c5');
  assert.equal(over.body.error.code, 'TOO_MANY_COLUMNS');
  // Bỏ một cột thì thêm được
  await api.patch(`/custom/fields/${byKey.dong_xe.id}`, { show_in_list: false });
  assert.equal((await mk('c5')).status, 201);
  // Ẩn trường thì cột biến mất
  await api.patch(`/custom/fields/${byKey.nhom_huong.id}`, { archived: true });
  assert.ok(!(await api.get(`/customers?shop_id=${nh.id}`)).body.columns.some((c) => c.key === 'nhom_huong'));

  // Chỉ trường của khách mới có cột
  const bad = await api.post('/custom/fields', { entity_type: 'order', key: 'x', label: 'x', type: 'text', show_in_list: true });
  assert.equal(bad.body.error.code, 'NOT_CUSTOMER');
});

test('Lọc khách theo mệnh lọc trước khi phân trang: không bỏ sót khách ở trang sau', async () => {
  const { api, pt } = await setup();
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' });
  const ids = [];
  for (let i = 1; i <= 6; i++) ids.push((await api.post('/customers', { name: `Khách ${i}`, phone: `091100010${i}`, shop_id: pt.id })).body.data.id);
  // Hai khách CŨ NHẤT mệnh Kim, bốn khách mới mệnh Mộc → trang đầu (mới nhất trước) toàn Mộc
  for (const [i, id] of ids.entries()) await api.put(`/custom/values/customer/${id}?shop_id=${pt.id}`, { menh: i < 2 ? 'Kim' : 'Mộc' });

  const p1 = (await api.get(`/customers?shop_id=${pt.id}&element=Kim&limit=1`)).body;
  assert.equal(p1.data.length, 1, 'trang đầu phải có khách Kim dù nằm sâu trong danh sách');
  assert.ok(p1.next_cursor);
  const p2 = (await api.get(`/customers?shop_id=${pt.id}&element=Kim&limit=1&cursor=${p1.next_cursor}`)).body;
  assert.equal(p2.data.length, 1);
  assert.equal(p2.next_cursor, null);
  assert.deepEqual([p1.data[0].name, p2.data[0].name].sort(), ['Khách 1', 'Khách 2']);
  assert.equal((await api.get(`/customers?shop_id=${pt.id}&element=Mộc&limit=10`)).body.data.length, 4);
  assert.equal((await api.get(`/customers?shop_id=${pt.id}&element=Hoả`)).body.data.length, 0);
});
