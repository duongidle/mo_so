import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { calc } from '../server/lib/formula.js';

test('M10: bộ tính công thức — đúng, an toàn, không văng lỗi khi chia 0', () => {
  const ctx = { a: 1000, b: 600, z: 0, d: '2026-11-01', 'custom.pack': 50 };
  assert.equal(calc('{a} - {b} - {custom.pack}', ctx), 350);
  assert.equal(calc('2 + 3 * 4', ctx), 14);
  assert.equal(calc('(2 + 3) * 4', ctx), 20);
  assert.equal(calc('{a} / {z}', ctx), null);
  assert.equal(calc('{khong_co} + 1', ctx), null, 'thiếu giá trị → null, không phải 1');
  assert.equal(calc('IF({a} > 500, "cao", "thấp")', ctx), 'cao');
  assert.equal(calc('ROUND(10 / 3, 2)', ctx), 3.33);
  assert.equal(calc('MAX(1, {a}, 3) - MIN(5, 2)', ctx), 998);
  assert.equal(calc('ABS(-7)', ctx), 7);
  assert.equal(calc('DAYS_BETWEEN("2026-11-01", "2026-11-11")', ctx), 10);
  for (const evil of ['process.exit()', 'constructor', '{a}.__proto__', 'a=1;b', '1 +', 'IF(1,2)', 'FOO(1)', '`x`']) {
    assert.throws(() => calc(evil, ctx), undefined, `phải chặn: ${evil}`);
  }
});

test('M10: trường tuỳ chỉnh, công thức trên đơn, chỉ số báo cáo tuỳ chỉnh', async () => {
  const { api, nh, pt, wh } = await setup();
  const p = (await api.post('/products', { name: 'Nước hoa', variants: [{ sku: 'NH-1', default_price: 150000 }], shop_ids: [nh.id, pt.id] })).body.data;
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: p.variants[0].id, qty: 10, unit_cost: 50000 }] });
  const o = (await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'NH-1', qty: 2 }], status: 'completed' })).body.data;

  const mk = (b) => api.post('/custom/fields', b);
  const pack = await mk({ entity_type: 'order', key: 'phi_dong_goi', label: 'Phí đóng gói', type: 'money' });
  assert.equal(pack.status, 201);
  assert.equal((await mk({ entity_type: 'order', key: 'phi_dong_goi', label: 'Trùng', type: 'money' })).status, 409, 'khoá trùng');
  assert.equal((await mk({ entity_type: 'order', key: 'status', label: 'x', type: 'text' })).status, 400, 'không trùng tên cột có sẵn');
  assert.equal((await mk({ entity_type: 'order', key: 'Sai Khoa', label: 'x', type: 'text' })).status, 400);
  assert.equal((await mk({ entity_type: 'order', key: 'loai_goi', label: 'Loại gói', type: 'select' })).status, 400, 'select cần lựa chọn');
  await mk({ entity_type: 'order', key: 'loai_goi', label: 'Loại gói', type: 'select', options: ['Thường', 'Quà'] });

  // Công thức: LN sau đóng gói = tổng − giá vốn − phí đóng gói
  assert.equal((await mk({ entity_type: 'order', key: 'ln', label: 'LN', type: 'formula', formula: '{total_amount} - {cogs_amount} - {custom.khong_co}' })).status, 400);
  assert.equal((await mk({ entity_type: 'order', key: 'ln', label: 'LN', type: 'formula', formula: '{cot_la} + 1' })).status, 400);
  const ln = await mk({ entity_type: 'order', key: 'ln', label: 'LN sau đóng gói', type: 'formula', formula: '{total_amount} - {cogs_amount} - {custom.phi_dong_goi}' });
  assert.equal(ln.status, 201, JSON.stringify(ln.body));

  // Vòng lặp bị chặn
  const a = await mk({ entity_type: 'order', key: 'va', label: 'A', type: 'formula', formula: '{custom.ln} + 1' });
  assert.equal(a.status, 201);
  const cyc = await api.patch(`/custom/fields/${ln.body.data.id}`, { formula: '{custom.va} + 1' });
  assert.equal(cyc.status, 400);
  assert.equal(cyc.body.error.code, 'FORMULA_CYCLE');

  // Chưa nhập phí đóng gói → công thức null (không tự coi là 0)
  assert.equal((await api.get(`/custom/values/order/${o.id}`)).body.data.ln, null);
  const set = await api.put(`/custom/values/order/${o.id}`, { phi_dong_goi: 12000, loai_goi: 'Quà' });
  assert.equal(set.status, 200);
  assert.equal(set.body.data.ln, 300000 - 100000 - 12000);
  assert.equal(set.body.data.va, set.body.data.ln + 1, 'công thức dùng công thức khác');
  assert.equal((await api.put(`/custom/values/order/${o.id}`, { loai_goi: 'Lạ' })).status, 400);
  assert.equal((await api.put(`/custom/values/order/${o.id}`, { phi_dong_goi: 1.5 })).status, 400, 'tiền phải nguyên');
  assert.equal((await api.put(`/custom/values/order/${o.id}`, { ln: 5 })).status, 400, 'công thức không nhập tay');
  assert.equal((await api.put(`/custom/values/order/${o.id}`, { khong_co: 5 })).status, 400);
  assert.equal((await api.put(`/custom/values/order/${o.id}`, { phi_dong_goi: null })).body.data.ln, null, 'xoá giá trị');

  // Trường riêng của shop PT không hiện ở NH
  await mk({ entity_type: 'order', key: 'rieng_pt', label: 'Riêng PT', type: 'text', shop_id: pt.id });
  const keys = async (shop) => (await api.get(`/custom/fields?entity_type=order&shop_id=${shop}`)).body.data.map((f) => f.key);
  assert.ok(!(await keys(nh.id)).includes('rieng_pt'));
  assert.ok((await keys(pt.id)).includes('rieng_pt'));

  // Chỉ số báo cáo tuỳ chỉnh: doanh thu thuần / số đơn; chỉ số riêng shop PT không hiện khi lọc NH
  assert.equal((await api.post('/custom/metrics', { key: 'bad', name: 'x', formula: '{a} +' })).status, 400);
  await api.post('/custom/metrics', { key: 'dt_don', name: 'Doanh thu / đơn', formula: '{net_revenue} / {order_count}', format: 'money' });
  await api.post('/custom/metrics', { key: 'chi_pt', name: 'Chỉ PT', formula: '{order_count}', shop_id: pt.id });
  await api.post('/custom/metrics', { key: 'loi', name: 'Chia 0', formula: '{net_revenue} / ({order_count} - 1)' });
  const m = (await api.get(`/reports/custom-metrics?shop_id=${nh.id}`)).body.data;
  assert.equal(m.find((x) => x.key === 'dt_don').value, 300000);
  assert.ok(!m.some((x) => x.key === 'chi_pt'));
  assert.equal(m.find((x) => x.key === 'loi').value, null, 'chia 0 → null');
});
