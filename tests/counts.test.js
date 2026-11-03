import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

test('Kiểm kê nhiều bước: đếm dần, bán trong lúc đếm không làm sai chênh lệch, hoàn tất sinh điều chỉnh đúng', async () => {
  const { api, nh, wh } = await setup();
  const mk = async (sku) => (await api.post('/products', { name: sku, variants: [{ sku, default_price: 100000 }], shop_ids: [nh.id] })).body.data.variants[0];
  const [a, b, c] = [await mk('A1'), await mk('B1'), await mk('C1')];
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 10, unit_cost: 10000 }, { variant_id: b.id, qty: 6, unit_cost: 20000 }] });
  const onHand = async (sku) => (await api.get(`/stock?warehouse_id=${wh.id}&q=${sku}`)).body.data.find((r) => r.sku === sku).on_hand;

  const created = await api.post('/stock-counts', { warehouse_id: wh.id });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const cnt = created.body.data;
  assert.match(cnt.code, /^KK-/);
  assert.deepEqual(cnt.lines.map((l) => [l.sku, l.system_qty]), [['A1', 10], ['B1', 6]], 'chỉ hàng đang có tồn');
  assert.equal(cnt.summary.uncounted, 2);

  // Đang đếm thì có đơn bán 2 A1
  await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'A1', qty: 2 }], status: 'confirmed' });
  const mid = (await api.get(`/stock-counts/${cnt.id}`)).body.data;
  assert.equal(mid.lines[0].moved_since, true, 'cảnh báo có biến động sau khi chụp tồn');

  // Đếm A1: thực tế còn 8 → khớp tồn hiện tại 8 (không tính lại việc bán 2) → không chênh lệch
  // Đếm B1: thực tế còn 5 → thiếu 1
  const saved = (await api.patch(`/stock-counts/${cnt.id}`, { lines: [{ variant_id: a.id, counted_qty: 8 }, { variant_id: b.id, counted_qty: 5 }] })).body.data;
  assert.equal(saved.lines.find((l) => l.sku === 'A1').variance, 0);
  assert.equal(saved.lines.find((l) => l.sku === 'B1').variance, -1);
  assert.equal(saved.summary.with_variance, 1);

  // Thêm hàng chưa có tồn (C1): đếm được 3, chưa có giá vốn → hoàn tất phải bị chặn và không ghi gì
  await api.patch(`/stock-counts/${cnt.id}`, { add_variant_ids: [c.id] });
  await api.patch(`/stock-counts/${cnt.id}`, { lines: [{ variant_id: c.id, counted_qty: 3 }] });
  const fail = await api.post(`/stock-counts/${cnt.id}/complete`, {});
  assert.equal(fail.body.error.code, 'COST_REQUIRED');
  assert.equal(await onHand('B1'), 6, 'hoàn tất lỗi thì không áp dòng nào');
  assert.equal((await api.get(`/stock-counts/${cnt.id}`)).body.data.status, 'draft');

  // Trong lúc chờ, bán thêm 1 A1 sau khi đã đếm: không ảnh hưởng kết quả
  await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'A1', qty: 1 }], status: 'confirmed' });
  await api.patch(`/stock-counts/${cnt.id}`, { lines: [{ variant_id: c.id, unit_cost: 7000 }] });
  const done = await api.post(`/stock-counts/${cnt.id}/complete`, {});
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.data.status, 'completed');
  assert.equal(await onHand('A1'), 7, '8 − 1 bán sau khi đếm, không bị đè về 8');
  assert.equal(await onHand('B1'), 5);
  assert.equal(await onHand('C1'), 3);
  assert.deepEqual((await api.get('/stock-integrity')).body, { ok: true, issues: [] });

  // Phiếu đã chốt không sửa/huỷ/hoàn tất lại được
  assert.equal((await api.patch(`/stock-counts/${cnt.id}`, { note: 'x' })).body.error.code, 'COUNT_CLOSED');
  assert.equal((await api.post(`/stock-counts/${cnt.id}/complete`, {})).status, 409);
  assert.equal((await api.post(`/stock-counts/${cnt.id}/cancel`, {})).status, 409);
  // Lịch sử kho ghi rõ nguồn kiểm kê
  const moves = (await api.get('/stock-movements?ref_type=adjustment')).body.data;
  assert.ok(moves.every((m) => m.note?.includes(cnt.code)));
  assert.equal((await api.get('/stock-counts')).body.data[0].status, 'completed');
});

test('Kiểm kê: dòng chưa đếm bỏ qua hoặc coi là 0; huỷ phiếu không đụng kho; không kiểm kê combo', async () => {
  const { api, nh, wh } = await setup();
  const mk = async (sku) => (await api.post('/products', { name: sku, variants: [{ sku, default_price: 1 }], shop_ids: [nh.id] })).body.data.variants[0];
  const [a, b] = [await mk('A1'), await mk('B1')];
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 4, unit_cost: 100 }, { variant_id: b.id, qty: 4, unit_cost: 100 }] });
  const onHand = async (sku) => (await api.get(`/stock?warehouse_id=${wh.id}&q=${sku}`)).body.data.find((r) => r.sku === sku).on_hand;

  const c1 = (await api.post('/stock-counts', { warehouse_id: wh.id })).body.data;
  await api.patch(`/stock-counts/${c1.id}`, { lines: [{ variant_id: a.id, counted_qty: 3 }] });
  await api.post(`/stock-counts/${c1.id}/complete`, {}); // mặc định: bỏ qua dòng chưa đếm
  assert.equal(await onHand('A1'), 3);
  assert.equal(await onHand('B1'), 4, 'chưa đếm thì không đụng');

  const c2 = (await api.post('/stock-counts', { warehouse_id: wh.id })).body.data;
  await api.post(`/stock-counts/${c2.id}/complete`, { uncounted: 'zero' });
  assert.equal(await onHand('A1'), 0);
  assert.equal(await onHand('B1'), 0, 'chọn coi chưa đếm là 0');

  const c3 = (await api.post('/stock-counts', { warehouse_id: wh.id, mode: 'variants', variant_ids: [a.id] })).body.data;
  await api.patch(`/stock-counts/${c3.id}`, { lines: [{ variant_id: a.id, counted_qty: 9, unit_cost: 100 }] });
  assert.equal((await api.post(`/stock-counts/${c3.id}/cancel`, {})).body.data.status, 'cancelled');
  assert.equal(await onHand('A1'), 0, 'huỷ phiếu không đụng kho');

  const combo = (await api.post('/products', { name: 'cb', variants: [{ sku: 'CB', kind: 'bundle', components: [{ variant_id: a.id, qty: 1 }] }] })).body.data.variants[0];
  const c4 = (await api.post('/stock-counts', { warehouse_id: wh.id, mode: 'variants', variant_ids: [combo.id] }));
  assert.equal(c4.body.error.code, 'BUNDLE_NO_STOCK');
});
