import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { calc, parse, evaluateExplain, inferType } from '../server/lib/formula.js';
import { ageOn } from '../server/lib/formula.js';
import { businessDate, addDays } from '../server/lib/time.js';

const mkField = (api, shop, b) => api.post('/custom/fields', { entity_type: 'customer', shop_id: shop, ...b });
const putVals = (api, id, shop, v) => api.put(`/custom/values/customer/${id}?shop_id=${shop}`, v);
const valsOf = async (api, id, shop) => (await api.get(`/custom/values/customer/${id}?shop_id=${shop}`)).body.data;

test('Xoá trường: chưa có dữ liệu xoá hẳn; có dữ liệu cần confirm và lưu snapshot; bị công thức dùng thì 409; khoá dùng lại được', async () => {
  const { api, nh } = await setup();
  const empty = (await mkField(api, nh.id, { key: 'trong', label: 'Trống', type: 'text' })).body.data;
  const del = await api.delete(`/custom/fields/${empty.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.data.values_removed, 0);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM custom_fields WHERE id = ?').get(empty.id).n, 0, 'xoá hẳn');
  assert.equal((await api.delete(`/custom/fields/${empty.id}`)).status, 404);

  const f = (await mkField(api, nh.id, { key: 'xe', label: 'Dòng xe', type: 'text' })).body.data;
  const c1 = (await api.post('/customers', { name: 'A', phone: '0911000001', shop_id: nh.id })).body.data;
  const c2 = (await api.post('/customers', { name: 'B', phone: '0911000002', shop_id: nh.id })).body.data;
  await putVals(api, c1.id, nh.id, { xe: 'Mazda' });
  await putVals(api, c2.id, nh.id, { xe: 'Kia' });
  const noConfirm = await api.delete(`/custom/fields/${f.id}`);
  assert.equal(noConfirm.status, 409);
  assert.equal(noConfirm.body.error.code, 'CONFIRM_REQUIRED');
  assert.equal(noConfirm.body.error.details.values_count, 2);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM custom_values WHERE field_id = ?').get(f.id).n, 2, 'chưa confirm thì chưa mất gì');

  // Bị công thức dùng: chặn, kể cả khi đã có confirm
  const fm = (await mkField(api, nh.id, { key: 'ct', label: 'CT', type: 'formula', formula: 'CONCAT({custom.xe}, "!")' })).body.data;
  const ref = await api.delete(`/custom/fields/${f.id}`, { confirm: true });
  assert.equal(ref.status, 409);
  assert.equal(ref.body.error.code, 'FIELD_REFERENCED');
  assert.deepEqual(ref.body.error.details.fields.map((x) => x.key), ['ct']);
  await api.delete(`/custom/fields/${fm.id}`);

  const ok = await api.delete(`/custom/fields/${f.id}`, { confirm: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.values_removed, 2);
  const snap = getDb().prepare("SELECT before FROM audit_log WHERE action = 'custom_field.deleted' AND entity_id = ?").get(f.id);
  const before = JSON.parse(snap.before);
  assert.equal(before.field.key, 'xe');
  assert.deepEqual(before.values.map((v) => [v.entity_id, v.value_text]).sort(), [[c1.id, 'Mazda'], [c2.id, 'Kia']].sort(), 'giá trị được chép vào audit_log trước khi xoá');
  assert.ok(getDb().prepare("SELECT 1 FROM events WHERE type = 'custom_field.deleted' AND entity_id = ?").get(f.id));

  assert.equal((await mkField(api, nh.id, { key: 'xe', label: 'Dòng xe mới', type: 'text' })).status, 201, 'khoá được giải phóng');
});

test('Ngày sinh/năm sinh là thông tin chung của khách; mệnh hiệu lực: ghi đè > tự tính từ ngày > ước tính theo năm', async () => {
  const { api, pt, nh } = await setup();
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' });
  await api.patch(`/shops/${nh.id}`, { industry: 'nuoc_hoa_o_to' });
  const mk = async (name, phone, extra) => (await api.post('/customers', { name, phone, shop_id: pt.id, ...extra })).body.data;
  const a = await mk('Chỉ ngày', '0911000011', { birth_date: '1990-01-20' });
  assert.equal(a.birth_date, '1990-01-20');
  assert.equal(a.age, ageOn('1990-01-20', businessDate()));
  const b = await mk('Có ghi đè', '0911000012', { birth_date: '1990-01-20' });
  await putVals(api, b.id, pt.id, { menh: 'Kim' });
  const c = await mk('Chỉ năm', '0911000013', { birth_year: 1994 });
  assert.equal((await api.post('/customers', { name: 'X', phone: '0911000014', birth_date: '2999-01-01' })).status, 400, 'ngày sinh ở tương lai');
  assert.equal((await api.post('/customers', { name: 'X', phone: '0911000014', birth_date: '2026-02-30' })).status, 400, 'ngày không có thật');
  assert.equal((await api.patch(`/customers/${c.id}`, { birth_year: 1800 })).status, 400);

  const detail = async (id) => (await api.get(`/customers/${id}?shop_id=${pt.id}`)).body.data;
  const da = await detail(a.id), db = await detail(b.id), dc = await detail(c.id);
  assert.equal(da.feng_shui.element, 'Mộc');
  assert.equal(da.shop_profile.element.source, 'computed');
  assert.equal(da.shop_profile.element.value, 'Mộc');
  assert.equal(da.shop_profile.values.menh, undefined, 'giá trị lưu vẫn là ô ghi đè trống');
  assert.equal(db.shop_profile.element.source, 'override');
  assert.equal(db.shop_profile.element.value, 'Kim');
  assert.equal(dc.shop_profile.element.source, 'approximate');
  assert.equal(dc.feng_shui.approximate, true);

  // Danh sách (cột), bộ lọc, file xuất cùng một giá trị hiệu lực
  const menhField = (await api.get(`/custom/fields?entity_type=customer&shop_id=${pt.id}`)).body.data.find((f) => f.key === 'menh');
  await api.patch(`/custom/fields/${menhField.id}`, { show_in_list: true });
  const list = (await api.get(`/customers?shop_id=${pt.id}`)).body.data;
  const byName = Object.fromEntries(list.map((r) => [r.name, r]));
  assert.equal(byName['Chỉ ngày'].shop_values.menh, 'Mộc');
  assert.equal(byName['Chỉ ngày'].shop_derived.menh, 'computed');
  assert.equal(byName['Có ghi đè'].shop_values.menh, 'Kim');
  assert.deepEqual(byName['Có ghi đè'].shop_derived, {});
  assert.equal(byName['Chỉ năm'].shop_derived.menh, 'approximate');
  assert.deepEqual((await api.get(`/customers?shop_id=${pt.id}&element=Mộc`)).body.data.map((r) => r.name), ['Chỉ ngày']);
  assert.deepEqual((await api.get(`/customers?shop_id=${pt.id}&element=Kim`)).body.data.map((r) => r.name), ['Có ghi đè']);
  const exp = (await api.get(`/customers/export?shop_id=${pt.id}&format=json`)).body.data;
  const iM = exp.headers.indexOf('Mệnh'), iN = exp.headers.indexOf('Họ tên'), iB = exp.headers.indexOf('Ngày sinh');
  const row = (n) => exp.rows.find((r) => r[iN] === n);
  assert.equal(row('Chỉ ngày')[iM], 'Mộc');
  assert.equal(row('Có ghi đè')[iM], 'Kim');
  assert.equal(row('Chỉ ngày')[iB], '20/01/1990');
  // Xuất không chọn shop vẫn có ngày sinh (thông tin chung)
  const expAll = (await api.get('/customers/export?format=json')).body.data;
  assert.ok(expAll.headers.includes('Ngày sinh') && expAll.headers.includes('Tuổi'));

  // Biến công thức: menh hiệu lực chỉ ở shop có feng_shui
  const vars = (shop) => api.get(`/custom/variables?entity_type=customer&shop_id=${shop}`).then((r) => r.body.data.map((v) => v.key));
  assert.ok((await vars(pt.id)).includes('menh'));
  assert.ok(!(await vars(nh.id)).includes('menh'));
  await mkField(api, pt.id, { key: 'menh_hl', label: 'Mệnh hiệu lực', type: 'formula', formula: '{menh}' });
  assert.equal((await valsOf(api, a.id, pt.id)).menh_hl, 'Mộc');
  assert.equal((await valsOf(api, b.id, pt.id)).menh_hl, 'Kim');
  assert.equal((await mkField(api, nh.id, { key: 'menh_x', label: 'x', type: 'formula', formula: '{menh}' })).status, 400);

  // Gộp khách: ngày sinh của hồ sơ bị gộp được giữ nếu hồ sơ giữ lại chưa có
  const t = await mk('Giữ', '0911000015');
  const s = await mk('Gộp', '0911000016', { birth_date: '1980-02-02' });
  const merged = (await api.post(`/customers/${t.id}/merge`, { source_id: s.id })).body.data;
  assert.equal(merged.birth_date, '1980-02-02');
});

test('Công thức ngày tháng: ngày − ngày, ngày ± số, AGE/DAY/DATE/MONTHS_BETWEEN', () => {
  const today = businessDate();
  assert.equal(calc('{b} - {a}', { a: '2026-01-01', b: '2026-01-31' }), 30);
  assert.equal(calc('TODAY() - {d}', { d: addDays(today, -10) }), 10);
  assert.equal(calc('{d} + 30', { d: '2026-01-20' }), '2026-02-19');
  assert.equal(calc('30 + {d}', { d: '2026-01-20' }), '2026-02-19');
  assert.equal(calc('{d} - 1', { d: '2026-03-01' }), '2026-02-28');
  assert.equal(calc('{d} - 1', { d: '2026-01-20T20:00:00.000Z' }), '2026-01-20', 'ISO đổi sang ngày giờ VN (21/01 03:00) rồi trừ 1');
  assert.equal(calc('DAYS_BETWEEN({a}, {b})', { a: '2026-01-01', b: '2026-01-11' }), 10);
  assert.equal(calc('AGE({d})', { d: '2000-11-05' }), ageOn('2000-11-05', today));
  assert.equal(ageOn('2000-11-05', '2026-11-04'), 25, 'chưa đến sinh nhật');
  assert.equal(ageOn('2000-11-05', '2026-11-05'), 26, 'đúng sinh nhật');
  assert.equal(calc('DAY({d})', { d: '1990-05-10' }), 10);
  assert.equal(calc('DATE(2026, 2, 28)'), '2026-02-28');
  assert.equal(calc('DATE(2026, 2, 30)'), null, 'ngày không có thật');
  assert.equal(calc('MONTHS_BETWEEN({a}, {b})', { a: '2026-01-31', b: '2026-03-30' }), 1);
  assert.equal(calc('MONTHS_BETWEEN({a}, {b})', { a: '2026-03-30', b: '2026-01-31' }), -1);
  assert.equal(calc('YEAR(TODAY()) - YEAR({d})', { d: '1990-01-01' }), Number(today.slice(0, 4)) - 1990, 'cách cũ vẫn chạy');
  assert.equal(calc('{a} + {b}', { a: '2026-01-01', b: '2026-01-02' }), null, 'cộng hai ngày: không hợp lệ');
});

test('Công thức: lý do khi trống, và kiểm kiểu chặn phép sai lúc lưu', async () => {
  const why = (src, ctx = {}) => evaluateExplain(parse(src), ctx, { subject: 'Khách', labelOf: (n) => (n === 'birth_date' ? 'Ngày sinh' : n) });
  assert.deepEqual(why('AGE({birth_date})'), { value: null, reason: 'Khách chưa có Ngày sinh' });
  assert.equal(why('1 / 0').reason, 'Chia cho 0');
  assert.match(why('{x} * 2', { x: 'abc' }).reason, /không phải số/);
  assert.equal(why('AGE({birth_date})', { birth_date: '1990-05-10' }).reason, null);

  const t = (src, types) => inferType(parse(src), (n) => types[n]);
  assert.equal(t('TODAY() - {d}', { d: 'date' }), 'number');
  assert.equal(t('{d} + 7', { d: 'date' }), 'date');
  assert.throws(() => t('{d} * 2', { d: 'date' }), /AGE/);
  assert.throws(() => t('{s} - 1', { s: 'text' }), /CONCAT/);
  assert.throws(() => t('5 - {d}', { d: 'date' }), /trừ đi một ngày/);
  assert.throws(() => t('{a} + {b}', { a: 'date', b: 'date' }), /cộng hai ngày/);
  assert.throws(() => t('AGE({n})', { n: 'number' }), /ngày/);
  assert.equal(t('{unknown} + 1', {}), null, 'biến chưa biết kiểu thì không chặn');

  const { api, nh } = await setup();
  const bad = await mkField(api, nh.id, { key: 'sai', label: 'Sai', type: 'formula', formula: '{birth_date} * 2' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_FORMULA');
  assert.match(bad.body.error.message, /AGE/);
  assert.equal(bad.body.error.details.position, 13, 'chỉ đúng chỗ toán tử');
  assert.equal((await mkField(api, nh.id, { key: 'sai2', label: 'Sai 2', type: 'formula', formula: '{name} - 1' })).status, 400, 'chữ − số');

  // Tạo công thức TRƯỚC khi có ngày sinh: vẫn ra giá trị sau khi nhập ngày sinh (công thức luôn tính lúc đọc)
  const tuoi = await mkField(api, nh.id, { key: 'tuoi', label: 'Tuổi', type: 'formula', formula: 'AGE({birth_date})' });
  assert.equal(tuoi.status, 201);
  const sinh = await mkField(api, nh.id, { key: 'sinh_ngay', label: 'Hơn kém', type: 'formula', formula: 'TODAY() - {birth_date}' });
  assert.equal(sinh.status, 201, 'ngày − ngày hợp lệ (ra số ngày)');
  const c = (await api.post('/customers', { name: 'Z', phone: '0911000021', shop_id: nh.id })).body.data;
  const meta = (await api.get(`/custom/values/customer/${c.id}?shop_id=${nh.id}&meta=1`)).body.data;
  assert.equal(meta.values.tuoi, null);
  assert.equal(meta.reasons.tuoi, 'Khách chưa có Ngày sinh');
  await api.patch(`/customers/${c.id}`, { birth_date: '1990-05-10' });
  const after = (await api.get(`/custom/values/customer/${c.id}?shop_id=${nh.id}&meta=1`)).body.data;
  assert.equal(after.values.tuoi, ageOn('1990-05-10', businessDate()));
  assert.equal(after.reasons.tuoi, undefined);
  assert.ok(after.values.sinh_ngay > 9000);
  // Hồ sơ khách mang lý do; xem trước công thức mang lý do
  const prof = (await api.get(`/customers/${c.id}?shop_id=${nh.id}`)).body.data.shop_profile;
  assert.equal(prof.values.tuoi, after.values.tuoi);
  const none = (await api.post('/customers', { name: 'Y', phone: '0911000022', shop_id: nh.id })).body.data;
  const prev = await api.post('/custom/formula/preview', { entity_type: 'customer', shop_id: nh.id, formula: 'AGE({birth_date})', entity_id: none.id });
  assert.equal(prev.body.data.value, null);
  assert.equal(prev.body.data.reason, 'Khách chưa có Ngày sinh');
  const fns = (await api.get('/custom/functions')).body.data.map((f) => f.name);
  for (const n of ['AGE', 'DAY', 'DATE', 'MONTHS_BETWEEN']) assert.ok(fns.includes(n));
  // Tuổi khi chỉ biết năm sinh
  const yr = (await api.post('/customers', { name: 'W', phone: '0911000023', shop_id: nh.id, birth_year: 1990 })).body.data;
  assert.equal(yr.age, Number(businessDate().slice(0, 4)) - 1990);
});

test('Giá trị mặc định: lưu theo kiểu, điền cho khách mới, không ghi vào khách cũ; công thức không có mặc định', async () => {
  const { api, nh } = await setup();
  const old = (await api.post('/customers', { name: 'Cũ', phone: '0911000031', shop_id: nh.id })).body.data;
  const sel = await mkField(api, nh.id, { key: 'dip', label: 'Dịp', type: 'select', options: ['A', 'B'], default_value: 'A' });
  assert.equal(sel.status, 201);
  assert.equal(sel.body.data.default_value, 'A');
  const multi = (await mkField(api, nh.id, { key: 'huong', label: 'Hương', type: 'multiselect', options: ['Gỗ', 'Biển'], default_value: ['Gỗ'] })).body.data;
  assert.deepEqual(multi.default_value, ['Gỗ']);
  const num = (await mkField(api, nh.id, { key: 'ngan_sach', label: 'Ngân sách', type: 'money', default_value: 500000 })).body.data;
  assert.equal(num.default_value, 500000);
  assert.equal((await mkField(api, nh.id, { key: 'x1', label: 'X', type: 'select', options: ['A'], default_value: 'Z' })).status, 400, 'mặc định phải nằm trong lựa chọn');
  assert.equal((await mkField(api, nh.id, { key: 'x2', label: 'X', type: 'formula', formula: '{order_count}', default_value: 1 })).body.error.code, 'DEFAULT_FORMULA');

  const fresh = (await api.post('/customers', { name: 'Mới', phone: '0911000032', shop_id: nh.id })).body.data;
  assert.deepEqual(await valsOf(api, fresh.id, nh.id), { dip: 'A', huong: ['Gỗ'], ngan_sach: 500000 });
  assert.deepEqual(await valsOf(api, old.id, nh.id), {}, 'khách cũ không bị ghi');

  // Sửa/gỡ mặc định; đổi lựa chọn làm mất mặc định thì bỏ mặc định
  assert.equal((await api.patch(`/custom/fields/${num.id}`, { default_value: 700000 })).body.data.default_value, 700000);
  assert.equal((await api.patch(`/custom/fields/${num.id}`, { default_value: null })).body.data.default_value, null);
  assert.equal((await api.patch(`/custom/fields/${sel.body.data.id}`, { options: ['B', 'C'] })).body.data.default_value, null);
});

test('Đổi ngành không tạo lại trường mẫu đã xoá có chủ đích', async () => {
  const { api, pt } = await setup();
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' });
  const keys = async () => (await api.get(`/custom/fields?entity_type=customer&shop_id=${pt.id}`)).body.data;
  const gt = (await keys()).find((f) => f.key === 'gioi_tinh');
  assert.equal((await api.delete(`/custom/fields/${gt.id}`)).status, 200);
  await api.patch(`/shops/${pt.id}`, { industry: 'nuoc_hoa_o_to' });
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy', name: 'PT mới' });
  const after = (await keys()).map((f) => f.key);
  assert.ok(!after.includes('gioi_tinh'), 'trường đã xoá không bị tạo lại');
  assert.ok(after.includes('menh') && after.includes('nhom_huong'));
  // Nhãn preset mới
  assert.equal((await keys()).find((f) => f.key === 'menh').label, 'Mệnh (ghi đè)');
});
