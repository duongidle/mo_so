import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

const ids = (r) => r.body.data.map((c) => c.id);

test('Khách theo shop: mua ở shop nào là khách của shop đó; xoá khỏi shop này không mất khách ở shop kia', async () => {
  const { api, nh, pt, wh } = await setup();
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' });
  const a = (await api.post('/products', { name: 'Nước hoa', variants: [{ sku: 'NH-1', default_price: 150000 }], shop_ids: [nh.id] })).body.data.variants[0];
  const b = (await api.post('/products', { name: 'Tỳ hưu', variants: [{ sku: 'PT-1', default_price: 500000 }], shop_ids: [pt.id] })).body.data.variants[0];
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 10, unit_cost: 50000 }, { variant_id: b.id, qty: 10, unit_cost: 200000 }] });

  // Cùng một người mua ở cả hai shop
  const o1 = (await api.post('/orders', { shop_id: nh.id, customer: { name: 'Anh Tài', phone: '0911000111' }, lines: [{ sku: 'NH-1', qty: 1 }], status: 'completed', payments: [{ amount: 150000 }] })).body.data;
  await api.post('/orders', { shop_id: pt.id, customer: { phone: '0911000111', name: 'Anh Tài' }, lines: [{ sku: 'PT-1', qty: 1 }], status: 'completed', payments: [{ amount: 500000 }] });
  const cid = o1.customer_id;
  assert.ok(ids(await api.get(`/customers?shop_id=${nh.id}`)).includes(cid));
  assert.ok(ids(await api.get(`/customers?shop_id=${pt.id}`)).includes(cid));

  // Thông tin riêng + nhãn ở cả hai shop
  await api.put(`/custom/values/customer/${cid}?shop_id=${nh.id}`, { dong_xe: 'Camry' });
  await api.put(`/custom/values/customer/${cid}?shop_id=${pt.id}`, { menh: 'Kim' });
  await api.put(`/customers/${cid}/tags`, { shop_id: nh.id, tags: ['VIP'] });
  await api.put(`/customers/${cid}/tags`, { shop_id: pt.id, tags: ['Hay hỏi'] });

  // Xoá khỏi shop NH
  assert.equal((await api.delete(`/customers/${cid}`)).status, 400, 'phải chỉ rõ shop');
  const del = await api.delete(`/customers/${cid}?shop_id=${nh.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.data.archived, false);
  assert.equal(del.body.data.still_in_shops, 1);
  assert.equal(del.body.data.orders_kept, 2);

  assert.ok(!ids(await api.get(`/customers?shop_id=${nh.id}`)).includes(cid), 'khỏi danh sách shop NH');
  const ptList = await api.get(`/customers?shop_id=${pt.id}`);
  assert.ok(ids(ptList).includes(cid), 'vẫn ở shop PT');
  const dPt = (await api.get(`/customers/${cid}?shop_id=${pt.id}`)).body.data;
  assert.equal(dPt.shop_profile.values.menh, 'Kim', 'thông tin riêng shop PT còn nguyên');
  assert.deepEqual(dPt.shop_profile.tags, ['Hay hỏi']);
  assert.equal((await api.get(`/customers/${cid}?shop_id=${nh.id}`)).body.data.shop_profile.values.dong_xe, undefined, 'thông tin riêng shop NH đã xoá');
  assert.deepEqual((await api.get(`/customers/${cid}?shop_id=${nh.id}`)).body.data.shop_profile.tags, []);
  // Lịch sử đơn không mất
  assert.equal((await api.get(`/orders?customer_id=${cid}`)).body.data.length, 2);
  // Xoá lần hai: báo lỗi rõ
  assert.equal((await api.delete(`/customers/${cid}?shop_id=${nh.id}`)).status, 409);

  // Mua lại ở shop NH thì khách quay về danh sách shop NH
  await api.post('/orders', { shop_id: nh.id, customer_id: cid, lines: [{ sku: 'NH-1', qty: 1 }], status: 'completed', payments: [{ amount: 150000 }] });
  assert.ok(ids(await api.get(`/customers?shop_id=${nh.id}`)).includes(cid));
});

test('Xoá khách nhập nhầm (chưa có đơn, chỉ ở một shop) thì ẩn hồ sơ; nhập lại cùng SĐT dùng lại hồ sơ', async () => {
  const { api, nh, pt } = await setup();
  const c = (await api.post('/customers', { name: 'Nhầm', phone: '0933000333', shop_id: nh.id })).body.data;
  assert.ok(ids(await api.get(`/customers?shop_id=${nh.id}`)).includes(c.id));
  assert.equal((await api.get(`/customers?shop_id=${pt.id}`)).body.data.length, 0, 'tạo ở NH thì PT không thấy');

  const del = await api.delete(`/customers/${c.id}?shop_id=${nh.id}`);
  assert.equal(del.body.data.archived, true);
  assert.equal((await api.get(`/customers?shop_id=${nh.id}`)).body.data.length, 0);

  // Tạo lại cùng SĐT ở shop PT: không báo trùng, dùng lại hồ sơ cũ
  const again = await api.post('/customers', { name: 'Đúng rồi', phone: '0933000333', shop_id: pt.id });
  assert.equal(again.status, 201);
  assert.equal(again.body.data.id, c.id);
  assert.equal(again.body.data.archived_at, null);
  assert.ok(ids(await api.get(`/customers?shop_id=${pt.id}`)).includes(c.id));
  assert.ok(!ids(await api.get(`/customers?shop_id=${nh.id}`)).includes(c.id), 'NH vẫn không có vì đã xoá ở đó');

  // Trùng SĐT với khách đang có: báo rõ họ đã ở shop nào
  const dup = await api.post('/customers', { name: 'X', phone: '0933000333', shop_id: nh.id });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.details.customer_id, c.id);
  assert.equal(dup.body.error.details.is_member, false);
  // Thêm khách có sẵn vào shop NH
  assert.equal((await api.post(`/customers/${c.id}/shops`, { shop_id: nh.id })).status, 200);
  assert.ok(ids(await api.get(`/customers?shop_id=${nh.id}`)).includes(c.id));
});

test('Nhãn khách là của từng shop: gán, chuẩn hoá, lọc, đếm; không lộ sang shop khác', async () => {
  const { api, nh, pt } = await setup();
  const a = (await api.post('/customers', { name: 'A', phone: '0911000001', shop_id: nh.id })).body.data;
  const b = (await api.post('/customers', { name: 'B', phone: '0911000002', shop_id: nh.id })).body.data;
  await api.post(`/customers/${a.id}/shops`, { shop_id: pt.id });

  const set = await api.put(`/customers/${a.id}/tags`, { shop_id: nh.id, tags: ['  VIP ', 'vip', 'Mua sỉ', ''] });
  assert.deepEqual(set.body.data, ['Mua sỉ', 'VIP'], 'bỏ trùng không phân biệt hoa thường, bỏ rỗng, cắt khoảng trắng');
  await api.put(`/customers/${b.id}/tags`, { shop_id: nh.id, tags: ['VIP'] });
  await api.put(`/customers/${a.id}/tags`, { shop_id: pt.id, tags: ['Khác'] });

  assert.deepEqual((await api.get(`/customers/tags?shop_id=${nh.id}`)).body.data, [{ tag: 'VIP', count: 2 }, { tag: 'Mua sỉ', count: 1 }]);
  assert.deepEqual((await api.get(`/customers/tags?shop_id=${pt.id}`)).body.data, [{ tag: 'Khác', count: 1 }]);
  assert.equal((await api.get('/customers/tags')).status, 400);

  assert.equal((await api.get(`/customers?shop_id=${nh.id}&tag=vip`)).body.data.length, 2, 'lọc không phân biệt hoa thường');
  assert.equal((await api.get(`/customers?shop_id=${pt.id}&tag=VIP`)).body.data.length, 0, 'nhãn shop NH không lộ sang PT');
  assert.equal((await api.get('/customers?tag=VIP')).status, 400, 'lọc nhãn cần shop');
  const row = (await api.get(`/customers?shop_id=${nh.id}`)).body.data.find((c) => c.id === a.id);
  assert.deepEqual(row.shop_tags, ['Mua sỉ', 'VIP']);

  // Xoá khách ở NH thì nhãn NH biến mất khỏi thống kê; nhãn PT còn
  await api.delete(`/customers/${b.id}?shop_id=${nh.id}`);
  assert.deepEqual((await api.get(`/customers/tags?shop_id=${nh.id}`)).body.data, [{ tag: 'Mua sỉ', count: 1 }, { tag: 'VIP', count: 1 }]);
  const tooMany = await api.put(`/customers/${a.id}/tags`, { shop_id: nh.id, tags: Array.from({ length: 25 }, (_, i) => `n${i}`) });
  assert.equal(tooMany.status, 400);
});

test('Gộp khách: hợp thành viên shop và nhãn của hai hồ sơ', async () => {
  const { api, nh, pt } = await setup();
  const a = (await api.post('/customers', { name: 'A', phone: '0911000001', shop_id: nh.id })).body.data;
  const b = (await api.post('/customers', { name: 'A (trùng)', phone: '0911000009', shop_id: pt.id })).body.data;
  await api.put(`/customers/${a.id}/tags`, { shop_id: nh.id, tags: ['VIP'] });
  await api.put(`/customers/${b.id}/tags`, { shop_id: pt.id, tags: ['Khác'] });
  assert.equal((await api.post(`/customers/${a.id}/merge`, { source_id: b.id })).status, 200);
  assert.ok(ids(await api.get(`/customers?shop_id=${pt.id}`)).includes(a.id), 'hồ sơ giữ lại giờ cũng thuộc shop PT');
  assert.ok(!ids(await api.get(`/customers?shop_id=${pt.id}`)).includes(b.id));
  assert.deepEqual((await api.get(`/customers/${a.id}?shop_id=${pt.id}`)).body.data.shop_profile.tags, ['Khác']);
  assert.deepEqual((await api.get(`/customers/${a.id}?shop_id=${nh.id}`)).body.data.shop_profile.tags, ['VIP']);
});
