import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { lineAmount } from '../server/lib/money.js';
import { addDays, businessDate } from '../server/lib/time.js';
import { verifyStock } from '../server/modules/inventory/verify.js';
import { verifyJournal } from '../server/modules/accounting/journal.js';

const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };
const today = () => businessDate();

async function world() {
  const ctx = await setup();
  const { api, wh, nh, pt } = ctx;
  const cat = ok(await api.post('/categories', { name: 'Hạt' }));
  const a = ok(await api.post('/products', { name: 'Hạt điều', unit: 'kg', category_id: cat.id, variants: [{ sku: 'DIEU' }], shop_ids: [nh.id] })).variants[0];
  const b = ok(await api.post('/products', { name: 'Đèn', variants: [{ sku: 'DEN', default_price: 1000 }], shop_ids: [pt.id] })).variants[0];
  const sup = ok(await api.post('/suppliers', { name: 'NCC' }));
  const buy = async (v, qty, cost, extra = {}) => ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, lines: [{ variant_id: v.id, qty, unit_cost: cost, ...extra }] }));
  return { ...ctx, a, b, cat, buy };
}

test('lý do có mã: lưu ở phiếu, mã sai bị từ chối, phiếu không mã tính là "khác"', async () => {
  const { api, wh, a, buy } = await world();
  await buy(a, 100, 100000);
  const r = await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'adjust', reason_code: 'bay_mat', lines: [{ variant_id: a.id, change: -1 }] });
  assert.equal(r.status, 400);
  const adj = ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'damage', reason_code: 'damaged', reason: 'Vỡ hộp', lines: [{ variant_id: a.id, change: 2 }] }));
  assert.equal(adj.reason_code, 'damaged');
  assert.equal(ok(await api.get('/stock-adjustments')).find((x) => x.id === adj.id).reason_code, 'damaged');
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'adjust', lines: [{ variant_id: a.id, change: -1.5 }] }));
  const rep = ok(await api.get('/reports/shrinkage'));
  const row = rep.items.find((i) => i.sku === 'DIEU');
  assert.equal(row.by_reason.damaged.qty, 2); assert.equal(row.by_reason.other.qty, 1.5);
});

test('báo cáo hao hụt: theo lý do, giá trị, lượng nhập, tỷ lệ; xuất huỷ lô hết hạn = hết hạn; kiểm kê thiếu = khác', async () => {
  const { api, wh, a, buy } = await world();
  await buy(a, 100, 100000);
  await buy(a, 10, 100000, { lot_no: 'OLD', expiry_date: addDays(today(), -3) });
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'damage', reason_code: 'damaged', lines: [{ variant_id: a.id, change: 2 }] }));
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'adjust', reason_code: 'weight_loss', lines: [{ variant_id: a.id, change: -1.25 }] }));
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'adjust', reason_code: 'lost', lines: [{ variant_id: a.id, change: -1 }] }));
  const lot = ok(await api.get(`/stock-lots?variant_id=${a.id}`)).find((l) => l.lot_no === 'OLD');
  ok(await api.post(`/stock-lots/${lot.id}/write-off`, {}));
  // điều chỉnh tăng và tồn đầu kỳ không phải hao hụt
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'adjust', lines: [{ variant_id: a.id, change: 5 }] }));
  const rep = ok(await api.get('/reports/shrinkage'));
  const row = rep.items.find((i) => i.sku === 'DIEU');
  const v = (q) => lineAmount(q, 100000);
  assert.equal(row.by_reason.damaged.qty, 2); assert.equal(row.by_reason.damaged.value, v(2));
  assert.equal(row.by_reason.weight_loss.qty, 1.25); assert.equal(row.by_reason.weight_loss.value, v(1.25));
  assert.equal(row.by_reason.lost.qty, 1);
  // Các lần giảm trước lấy theo hạn dùng sớm nhất nên đã rút 4,25 kg từ lô OLD; xuất huỷ lô chỉ còn 5,75 kg
  assert.equal(row.by_reason.expired.qty, 5.75); assert.equal(row.by_reason.expired.value, v(5.75));
  assert.equal(row.qty, 10);
  assert.equal(row.value, v(2) + v(1.25) + v(1) + v(5.75));
  assert.equal(row.received_qty, 110);
  assert.equal(row.shrink_rate, Math.round((10 / 110) * 10000) / 10000);
  assert.equal(rep.total_value, row.value);
  assert.equal(rep.totals.expired.value, v(5.75));
  assert.ok(Number.isInteger(rep.total_value));
  // lọc ngày: kỳ không có gì
  const empty = ok(await api.get(`/reports/shrinkage?from=2020-01-01&to=2020-01-31`));
  assert.equal(empty.items.length, 0);
  assert.deepEqual(verifyStock(), []); assert.deepEqual(verifyJournal(), []);
});

test('báo cáo hao hụt: lọc shop (qua kho của shop), lọc danh mục, hàng trả về bị hỏng là nguồn riêng', async () => {
  const w = await world();
  const { api, wh, a, b, buy, nh, pt, cat } = w;
  await buy(a, 50, 100000);
  await buy(b, 20, 500);
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'damage', reason_code: 'damaged', lines: [{ variant_id: a.id, change: 1 }, { variant_id: b.id, change: 2 }] }));
  const all = ok(await api.get('/reports/shrinkage'));
  assert.equal(all.items.length, 2);
  // hai shop cùng dùng một kho nên cả hai thấy cả hai mặt hàng
  assert.equal(ok(await api.get(`/reports/shrinkage?shop_id=${nh.id}`)).items.length, 2);
  const byCat = ok(await api.get(`/reports/shrinkage?category_id=${cat.id}`));
  assert.deepEqual(byCat.items.map((i) => i.sku), ['DIEU']);
  // hàng trả về bị hỏng: đơn bán 3 DIEU rồi trả, hàng về nhưng hỏng
  const o = ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', status: 'completed', lines: [{ variant_id: a.id, qty: 3, unit_price: 200000 }], payments: [{ amount: 600000, method: 'cash' }] }));
  ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: false }], reason_code: 'defective' }));
  const rep = ok(await api.get(`/reports/shrinkage?shop_id=${nh.id}`));
  const row = rep.items.find((i) => i.sku === 'DIEU');
  assert.equal(row.by_reason.return_damaged.qty, 1);
  assert.equal(row.by_reason.return_damaged.value, 100000);
  assert.equal(row.value, 100000 + 100000);
  // tỷ lệ chỉ tính hao hụt trong kho (không tính hàng trả hỏng)
  assert.equal(row.shrink_rate, Math.round((1 / 50) * 10000) / 10000);
  // shop khác không có phiếu hàng huỷ của shop này
  const other = ok(await api.get(`/reports/shrinkage?shop_id=${pt.id}`)).items.find((i) => i.sku === 'DIEU');
  assert.equal(other.by_reason.return_damaged.qty, 0);
});
