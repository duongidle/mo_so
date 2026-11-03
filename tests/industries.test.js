import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';

const fieldKeys = async (api, shopId) => (await api.get(`/custom/fields?entity_type=customer&shop_id=${shopId}`)).body.data.map((f) => f.key);

test('Ngành bán: chọn ngành tạo sẵn trường khách riêng cho shop, đổi ngành không mất dữ liệu', async () => {
  const { api, nh, pt } = await setup();
  const inds = (await api.get('/industries')).body.data;
  assert.deepEqual(inds.map((i) => i.id).sort(), ['general', 'nuoc_hoa', 'phong_thuy']);
  assert.equal((await api.get('/shops')).body.data[0].industry, 'general');
  assert.deepEqual(await fieldKeys(api, nh.id), [], 'ngành chung không có trường tạo sẵn');

  assert.equal((await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' })).body.data.industry, 'phong_thuy');
  assert.equal((await api.patch(`/shops/${nh.id}`, { industry: 'nuoc_hoa' })).status, 200);
  assert.equal((await api.patch(`/shops/${nh.id}`, { industry: 'khong_co' })).status, 400);
  assert.deepEqual(await fieldKeys(api, pt.id), ['ngay_sinh', 'nam_sinh', 'gioi_tinh', 'menh']);
  assert.deepEqual(await fieldKeys(api, nh.id), ['nhom_huong', 'dong_xe', 'dip_dung', 'sinh_nhat']);

  // Đặt lại cùng ngành: không tạo trùng
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy', name: 'PT mới' });
  assert.equal((await fieldKeys(api, pt.id)).length, 4);

  // Đổi ngành: trường và dữ liệu của ngành cũ vẫn còn
  const cust = (await api.post('/customers', { name: 'Anh Tài', phone: '0911000111' })).body.data;
  await api.put(`/custom/values/customer/${cust.id}?shop_id=${pt.id}`, { menh: 'Kim' });
  await api.patch(`/shops/${pt.id}`, { industry: 'nuoc_hoa' });
  const after = await fieldKeys(api, pt.id);
  assert.ok(after.includes('menh') && after.includes('nhom_huong'));
  assert.equal((await api.get(`/custom/values/customer/${cust.id}?shop_id=${pt.id}`)).body.data.menh, 'Kim');
});

test('Trường khách chỉ thuộc từng shop: cùng một khách, shop này không thấy dữ liệu của shop kia', async () => {
  const { api, nh, pt } = await setup();
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' });
  await api.patch(`/shops/${nh.id}`, { industry: 'nuoc_hoa' });
  const cust = (await api.post('/customers', { name: 'Chị Lan', phone: '0922000222' })).body.data;

  await api.put(`/custom/values/customer/${cust.id}?shop_id=${pt.id}`, { menh: 'Thuỷ', ngay_sinh: '1992-05-10' });
  await api.put(`/custom/values/customer/${cust.id}?shop_id=${nh.id}`, { nhom_huong: ['Gỗ', 'Biển'], dong_xe: 'Mazda CX-5' });

  const vPt = (await api.get(`/custom/values/customer/${cust.id}?shop_id=${pt.id}`)).body.data;
  const vNh = (await api.get(`/custom/values/customer/${cust.id}?shop_id=${nh.id}`)).body.data;
  assert.deepEqual(Object.keys(vPt).sort(), ['menh', 'ngay_sinh']);
  assert.deepEqual(Object.keys(vNh).sort(), ['dong_xe', 'nhom_huong']);
  assert.equal(vNh.menh, undefined, 'mệnh của shop phong thuỷ không lọt sang shop nước hoa');

  // Không ghi được trường của shop khác, không đọc/ghi khi thiếu shop
  assert.equal((await api.put(`/custom/values/customer/${cust.id}?shop_id=${nh.id}`, { menh: 'Kim' })).status, 400);
  assert.equal((await api.put(`/custom/values/customer/${cust.id}`, { menh: 'Kim' })).status, 400);
  assert.equal((await api.get(`/custom/values/customer/${cust.id}`)).status, 400);

  // Chi tiết khách theo shop: chỉ phần riêng của shop đó
  const dPt = (await api.get(`/customers/${cust.id}?shop_id=${pt.id}`)).body.data;
  const dNh = (await api.get(`/customers/${cust.id}?shop_id=${nh.id}`)).body.data;
  assert.equal(dPt.feng_shui.element, 'Thuỷ');
  assert.equal(dNh.feng_shui, null, 'shop nước hoa không có mệnh');
  assert.deepEqual(dNh.shop_profile.fields.map((f) => f.key), ['nhom_huong', 'dong_xe', 'dip_dung', 'sinh_nhat']);
  assert.equal((await api.get(`/customers/${cust.id}`)).body.data.shop_profile, undefined, 'xem chung (không chọn shop) thì không có phần riêng');

  // Mệnh: danh sách khách chỉ lọc theo mệnh trong shop phong thuỷ
  assert.equal((await api.get(`/customers?shop_id=${pt.id}&element=Thuỷ`)).body.data.length, 1);
  assert.equal((await api.get(`/customers?shop_id=${pt.id}&element=Kim`)).body.data.length, 0);
  assert.equal((await api.get(`/customers?shop_id=${nh.id}`)).body.data[0].feng_shui, undefined);

  // Tự tạo trường cho shop: cùng khoá ở hai shop khác nhau là được, trong cùng shop thì không
  const mk = (shop, key) => api.post('/custom/fields', { entity_type: 'customer', shop_id: shop, key, label: key, type: 'text' });
  assert.equal((await mk(pt.id, 'ghi_chu_rieng')).status, 201);
  assert.equal((await mk(nh.id, 'ghi_chu_rieng')).status, 201, 'khoá chỉ cần duy nhất trong shop');
  assert.equal((await mk(pt.id, 'ghi_chu_rieng')).status, 409);
  assert.deepEqual((await fieldKeys(api, pt.id)).slice(-1), ['ghi_chu_rieng'], 'trường mới nằm cuối danh sách');
  assert.equal((await api.post('/custom/fields', { entity_type: 'customer', key: 'khong_shop', label: 'x', type: 'text' })).status, 400, 'trường khách phải thuộc một shop');
  assert.ok(!(await fieldKeys(api, nh.id)).includes('menh'));
  // Liệt kê trường toàn hệ thống không lẫn trường khách của các shop
  assert.ok(!(await api.get('/custom/fields')).body.data.some((f) => f.entity_type === 'customer'));
});

test('Ngành phong thuỷ: chép ngày sinh/mệnh cũ trên hồ sơ khách sang shop khi bật ngành; gộp khách giữ thông tin theo shop', async () => {
  const { api, nh, pt, wh } = await setup();
  const p = (await api.post('/products', { name: 'Vòng', variants: [{ sku: 'V1', default_price: 100000 }], shop_ids: [pt.id] })).body.data;
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: p.variants[0].id, qty: 5, unit_cost: 1000 }] });
  const a = (await api.post('/customers', { name: 'A', phone: '0933000111' })).body.data;
  const b = (await api.post('/customers', { name: 'B', phone: '0933000222' })).body.data;
  // dữ liệu cũ từ trước khi có ngành (cột trên hồ sơ khách)
  getDb().prepare("UPDATE customers SET birth_date = '1990-01-20', gender = 'female' WHERE id = ?").run(a.id);
  getDb().prepare("UPDATE customers SET element_override = 'Hoả' WHERE id = ?").run(b.id);
  await api.post('/orders', { shop_id: pt.id, customer_id: a.id, lines: [{ sku: 'V1', qty: 1 }], status: 'completed' });
  // b chưa mua ở shop này → không chép

  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' });
  const va = (await api.get(`/custom/values/customer/${a.id}?shop_id=${pt.id}`)).body.data;
  assert.equal(va.ngay_sinh, '1990-01-20');
  assert.equal(va.gioi_tinh, 'Nữ');
  assert.equal((await api.get(`/customers/${a.id}?shop_id=${pt.id}`)).body.data.feng_shui.element, 'Mộc', 'sinh trước Tết 1990 → Kỷ Tỵ, Đại Lâm Mộc');
  assert.deepEqual((await api.get(`/custom/values/customer/${b.id}?shop_id=${pt.id}`)).body.data, {});

  // Gộp: b vào a, thông tin shop của b chuyển sang a nếu a chưa có
  await api.put(`/custom/values/customer/${b.id}?shop_id=${pt.id}`, { gioi_tinh: 'Nam', menh: 'Hoả' });
  await api.post(`/customers/${a.id}/merge`, { source_id: b.id });
  const merged = (await api.get(`/custom/values/customer/${a.id}?shop_id=${pt.id}`)).body.data;
  assert.equal(merged.gioi_tinh, 'Nữ', 'giá trị của hồ sơ giữ lại thắng');
  assert.equal(merged.menh, 'Hoả', 'trường chưa có thì lấy từ hồ sơ bị gộp');
  void nh;
});
