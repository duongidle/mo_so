import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { flushJournal, verifyJournal } from '../server/modules/accounting/journal.js';

const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };
const bal = () => { flushJournal(); return Object.fromEntries(getDb().prepare('SELECT account_code a, SUM(debit)-SUM(credit) b FROM journal_lines GROUP BY account_code').all().map((x) => [x.a, x.b])); };

async function world() {
  const ctx = await setup();
  const v = ok(await ctx.api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 300000 }], shop_ids: [ctx.nh.id] })).variants[0];
  const sup = ok(await ctx.api.post('/suppliers', { name: 'NCC' }));
  return { ...ctx, v, sup };
}

test('ship trả bên vận chuyển: vào giá vốn, không vào nợ NCC, ghi 3388', async () => {
  const { api, wh, v, sup } = await world();
  const pu = ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, shipping_fee: 1000000, shipping_payee: 'carrier', lines: [{ variant_id: v.id, qty: 100, unit_cost: 200000 }] }));
  assert.equal(pu.total_amount, 20000000);
  assert.equal(pu.carrier_amount, 1000000);
  assert.equal(pu.debt, 20000000);
  assert.equal(pu.carrier_debt, 1000000);
  assert.equal(pu.lines[0].landed_unit_cost, 210000); // ship vẫn chia vào giá vốn
  let b = bal();
  assert.equal(b['156'], 21000000); assert.equal(b['331'], -20000000); assert.equal(b['3388'], -1000000);
  assert.equal(b['6412'] ?? 0, 0); // không phải chi phí kỳ này
  // NCC không được trả quá 20tr
  assert.equal((await api.post(`/purchases/${pu.id}/payments`, { amount: 21000000, method: 'bank' })).status, 400);
  ok(await api.post(`/purchases/${pu.id}/payments`, { amount: 20000000, method: 'bank' }));
  const sd = ok(await api.get('/suppliers')).find((s) => s.id === sup.id);
  assert.equal(sd.debt, 0);
  b = bal(); assert.equal(b['331'], 0); assert.equal(b['3388'], -1000000);
  // trả bên vận chuyển
  assert.equal((await api.post(`/purchases/${pu.id}/carrier-payments`, { amount: 1500000, method: 'cash' })).status, 400);
  const after = ok(await api.post(`/purchases/${pu.id}/carrier-payments`, { amount: 1000000, method: 'cash' }));
  assert.equal(after.carrier_debt, 0);
  b = bal(); assert.equal(b['3388'], 0); assert.equal(b['156'], 21000000);
  assert.deepEqual(verifyJournal(), []);
});

test('phiếu ship trả NCC giữ nguyên hành vi cũ; phiếu không có ship không nhận trả ship', async () => {
  const { api, wh, v, sup } = await world();
  const a = ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, shipping_fee: 1000000, lines: [{ variant_id: v.id, qty: 100, unit_cost: 200000 }] }));
  assert.equal(a.total_amount, 21000000); assert.equal(a.carrier_amount, 0);
  assert.equal((await api.post(`/purchases/${a.id}/carrier-payments`, { amount: 1, method: 'cash' })).status, 400);
  const b = bal(); assert.equal(b['331'], -21000000); assert.equal(b['3388'] ?? 0, 0);
});

test('huỷ phiếu đã trả ship cần hoàn tiền ship, sổ về 0', async () => {
  const { api, wh, v, sup } = await world();
  const pu = ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, shipping_fee: 1000000, shipping_payee: 'carrier', lines: [{ variant_id: v.id, qty: 10, unit_cost: 200000 }] }));
  ok(await api.post(`/purchases/${pu.id}/carrier-payments`, { amount: 1000000, method: 'cash' }));
  const r1 = await api.post(`/purchases/${pu.id}/cancel`, {});
  assert.equal(r1.status, 409); assert.equal(r1.body.error.code, 'CARRIER_PAID');
  ok(await api.post(`/purchases/${pu.id}/cancel`, { refund_method: 'cash' }));
  const b = bal();
  assert.equal(b['156'] ?? 0, 0); assert.equal(b['331'] ?? 0, 0); assert.equal(b['3388'] ?? 0, 0);
  assert.deepEqual(verifyJournal(), []);
});

test('sửa phiếu nháp đổi người nhận ship', async () => {
  const { api, wh, v, sup } = await world();
  const d = ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, shipping_fee: 500000, lines: [{ variant_id: v.id, qty: 10, unit_cost: 100000 }] }));
  assert.equal(d.total_amount, 1500000);
  const e = ok(await api.patch(`/purchases/${d.id}`, { shipping_payee: 'carrier' }));
  assert.equal(e.total_amount, 1000000); assert.equal(e.carrier_amount, 500000);
  const f = ok(await api.patch(`/purchases/${d.id}`, { shipping_fee: 700000 })); // giữ nguyên người nhận
  assert.equal(f.carrier_amount, 700000); assert.equal(f.total_amount, 1000000);
});
