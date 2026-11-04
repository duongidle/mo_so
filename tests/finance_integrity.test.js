import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { addDays, businessDate } from '../server/lib/time.js';

/**
 * Đối chiếu số liệu: mọi cách cắt báo cáo (theo shop, kênh, ngày, sản phẩm, từng đơn, dòng tiền) phải khớp nhau.
 * Dữ liệu cố ý khó: giảm giá đơn, phí ship cả hai phía, phí sàn, combo, trả hàng (nhập lại/không nhập lại, một phần/toàn phần),
 * huỷ sau khi hoàn thành, sửa phí sàn sau khi chốt, chi phí chung/riêng, trả NCC từng phần.
 */
async function world() {
  const ctx = await setup();
  const { api, nh, pt, wh } = ctx;
  // pt là shop phong thuỷ: ngũ hành của sản phẩm là trường riêng của shop; đơn ở nh (ngành chung) rơi vào "chưa gán"
  assert.equal((await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' })).status, 200);
  const mkP = async (name, sku, price, shops, el) => (await api.post('/products', { name, variants: [{ sku, default_price: price }], shop_ids: shops, ...(el ? { custom: { ngu_hanh: el }, custom_shop_id: pt.id } : {}) })).body.data.variants[0];
  const a = await mkP('A', 'A1', 100000, [nh.id, pt.id], ['Kim', 'Thuỷ']);
  const b = await mkP('B', 'B1', 80000, [nh.id, pt.id], ['Mộc']);
  const combo = (await api.post('/products', { name: 'Combo', variants: [{ sku: 'CB1', kind: 'bundle', default_price: 250000, components: [{ variant_id: a.id, qty: 2 }, { variant_id: b.id, qty: 1 }] }], shop_ids: [pt.id] })).body.data.variants[0];
  const pur = (await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 40, unit_cost: 40000 }, { variant_id: b.id, qty: 40, unit_cost: 30000 }] })).body.data;
  const ord = async (o) => {
    const r = await api.post('/orders', { status: 'completed', ...o });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data;
  };
  const day = (n) => `${addDays(businessDate(), -n)}T04:00:00.000Z`;
  const o1 = await ord({ shop_id: nh.id, customer: { name: 'K1', phone: '0911000001' }, lines: [{ sku: 'A1', qty: 3 }, { sku: 'B1', qty: 2 }], discount_amount: 30000, shipping_fee: 20000, seller_shipping_amount: 15000, payments: [{ amount: 470000 }], ordered_at: day(3) });
  const o2 = await ord({ shop_id: nh.id, channel_id: 'shopee', external_id: 'SP1', lines: [{ sku: 'A1', qty: 2 }], platform_fee_amount: 25000, ordered_at: day(2) });
  const o3 = await ord({ shop_id: pt.id, channel_id: 'facebook', customer: { name: 'K2', phone: '0922000002' }, lines: [{ sku: 'B1', qty: 4 }], discount_amount: 20000, payments: [{ amount: 300000 }], ordered_at: day(2) });
  const o4 = await ord({ shop_id: pt.id, channel_id: 'direct', customer: { name: 'K1', phone: '0911000001' }, lines: [{ sku: 'CB1', qty: 2 }], shipping_fee: 10000, payments: [{ amount: 510000 }], ordered_at: day(1) });
  const o5 = await ord({ shop_id: nh.id, lines: [{ sku: 'A1', qty: 1 }], payments: [{ amount: 100000 }], ordered_at: day(1) });
  const o6 = await ord({ shop_id: pt.id, channel_id: 'shopee', external_id: 'SP2', lines: [{ sku: 'A1', qty: 2 }], platform_fee_amount: 18000, ordered_at: day(1) });
  const o7 = await ord({ shop_id: nh.id, lines: [{ sku: 'B1', qty: 1 }], payments: [{ amount: 50000 }], ordered_at: day(0) }); // còn nợ 30.000
  const draft = await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'A1', qty: 1 }] });

  // Trả một phần, nhập lại kho + hoàn tiền
  await api.post(`/orders/${o3.id}/returns`, { lines: [{ order_line_id: o3.lines[0].id, qty: 1, restock: true }], refund: { amount: 70000, method: 'bank' } });
  // Trả một phần combo, KHÔNG nhập lại kho (hàng hỏng)
  await api.post(`/orders/${o4.id}/returns`, { lines: [{ order_line_id: o4.lines[0].id, qty: 1, restock: false }], refund: { amount: 250000 } });
  // Trả toàn phần đơn sàn
  await api.post(`/orders/${o6.id}/returns`, { lines: [{ order_line_id: o6.lines[0].id, qty: 2, restock: true }] });
  // Huỷ đơn đã hoàn thành
  await api.post(`/orders/${o5.id}/status`, { status: 'cancelled' });
  // Sửa phí sàn sau khi chốt
  await api.patch(`/orders/${o2.id}`, { platform_fee_amount: 30000 });
  // Chi phí
  await api.patch('/settings', { expense_allocation: 'revenue' });
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 100001, method: 'bank', expense_date: businessDate() });
  await api.post('/expenses', { category_id: 'ecat_ads', shop_id: nh.id, channel_id: 'shopee', amount: 12345, expense_date: addDays(businessDate(), -2) });
  const voided = (await api.post('/expenses', { category_id: 'ecat_ads', amount: 999 })).body.data;
  await api.delete(`/expenses/${voided.id}`);
  // Trả NCC từng phần
  await api.post(`/purchases/${pur.id}/payments`, { amount: 500000, method: 'bank' });
  return { ...ctx, o: { o1, o2, o3, o4, o5, o6, o7 }, draft: draft.body.data, pur };
}

const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const WIDE = `from=${addDays(businessDate(), -10)}&to=${businessDate()}`;

test('Mọi cách cắt báo cáo cộng lại đều khớp tổng quan', async () => {
  const { api } = await world();
  const get = async (p) => (await api.get(`${p}${p.includes('?') ? '&' : '?'}${WIDE}`)).body;
  const ov = (await get('/reports/overview')).data.current;
  assert.ok(ov.net_revenue > 0 && ov.cogs > 0);

  const shops = (await get('/reports/shops')).data;
  for (const k of ['order_count', 'net_revenue', 'goods_revenue', 'returned_amount', 'cogs', 'gross_profit', 'platform_fee', 'seller_shipping', 'shipping_fee', 'expenses_amount', 'net_profit_estimate']) {
    assert.equal(sum(shops, k), ov[k], `theo shop: ${k}`);
  }
  const channels = (await get('/reports/channels')).data;
  for (const k of ['order_count', 'net_revenue', 'cogs', 'gross_profit', 'platform_fee', 'shipping_fee']) assert.equal(sum(channels, k), ov[k], `theo kênh: ${k}`);

  const series = (await get('/reports/revenue')).data;
  for (const k of ['order_count', 'net_revenue', 'gross_profit']) assert.equal(sum(series, k), ov[k], `theo ngày: ${k}`);

  const prods = (await get('/reports/products?limit=500'));
  assert.equal(sum(prods.data, 'revenue'), ov.net_revenue, 'doanh thu theo sản phẩm (gồm combo) = doanh thu thuần');
  assert.equal(sum(prods.data, 'cogs'), ov.cogs, 'giá vốn theo sản phẩm = giá vốn tổng');
  const el = (await get('/reports/elements')).data;
  assert.equal(sum(el, 'revenue'), ov.net_revenue, 'doanh thu theo ngũ hành = doanh thu thuần');
});

test('Từng đơn: cộng lợi nhuận/doanh thu/giá vốn các đơn tính doanh thu = số liệu báo cáo', async () => {
  const { api } = await world();
  const ov = (await api.get(`/reports/overview?${WIDE}`)).body.data.current;
  const orders = (await api.get(`/orders?limit=200&from=${addDays(businessDate(), -10)}&to=${businessDate()}`)).body.data;
  const counted = [];
  for (const o of orders.filter((x) => ['confirmed', 'shipping', 'completed', 'returned'].includes(x.status))) counted.push((await api.get(`/orders/${o.id}`)).body.data);
  assert.equal(counted.length, ov.order_count);
  assert.equal(sum(counted, 'net_revenue'), ov.net_revenue);
  assert.equal(sum(counted, 'cogs_amount'), ov.cogs);
  assert.equal(sum(counted, 'gross_profit'), ov.gross_profit, 'lợi nhuận gộp từng đơn cộng lại = báo cáo');
  // Lợi nhuận trong file xuất đơn cũng phải khớp
  const exp = (await api.get(`/orders/export?format=json&from=${addDays(businessDate(), -10)}&to=${businessDate()}&status=confirmed,shipping,completed,returned`)).body.data;
  const col = exp.headers.indexOf('Lợi nhuận gộp');
  assert.equal(exp.rows.reduce((a, r) => a + r[col], 0), ov.gross_profit);
});

test('Giá vốn khớp sổ kho: bán − nhập lại = số đã xuất; trả hàng không nhập lại vẫn tính giá vốn', async () => {
  const { api, o } = await world();
  const ov = (await api.get(`/reports/overview?${WIDE}`)).body.data.current;
  // Giá vốn thủ công: o1 3×40k+2×30k=180k, o2 2×40k=80k, o3 (4−1 nhập lại)×30k=90k, o4 combo (2×40k+30k)×(2−0 không nhập lại)=220k, o6 trả hết nhập lại=0, o7 30k, o5 huỷ=0
  assert.equal(ov.cogs, 180000 + 80000 + 90000 + 220000 + 30000);
  // Tồn kho thật khớp: A 40 − 3 (o1) − 2 (o2) − 4 (combo o4) − 1+1 (o5 huỷ) − 2+2 (o6 trả nhập lại) = 31; B 40 − 2 − 4+1 − 2 − 1 = 32
  const stock = async (sku) => (await api.get(`/stock?q=${sku}`)).body.data.find((r) => r.sku === sku).on_hand;
  assert.equal(await stock('A1'), 31);
  assert.equal(await stock('B1'), 32);
  const o4 = (await api.get(`/orders/${o.o4.id}`)).body.data;
  assert.equal(o4.returned_amount, 250000, 'trả 1 trong 2 combo 250k = 250k');
});

test('Trả hàng: doanh thu thuần giảm đúng phần hàng trả; phí ship/phí sàn không đổi; đơn trả toàn phần vẫn là một đơn đã bán', async () => {
  const { api, o } = await world();
  const o3 = (await api.get(`/orders/${o.o3.id}`)).body.data;
  // 4×80k=320k − giảm 20k = 300k; trả 1/4 → 75k
  assert.equal(o3.goods_revenue, 300000);
  assert.equal(o3.returned_amount, 75000);
  assert.equal(o3.net_revenue, 225000);
  const o6 = (await api.get(`/orders/${o.o6.id}`)).body.data;
  assert.equal(o6.status, 'returned');
  assert.equal(o6.net_revenue, 0);
  assert.equal(o6.cogs_amount, 0);
  assert.equal(o6.gross_profit, -18000, 'đơn sàn trả toàn phần: còn lỗ phí sàn (giả định phí sàn không được sàn hoàn lại)');
});

test('Dòng tiền khớp từng đơn và từng phiếu nhập', async () => {
  const { api, o, pur } = await world();
  const cf = (await api.get(`/reports/cashflow?${WIDE}`)).body.data;
  const pays = (await api.get('/payments?limit=500')).body.data;
  assert.equal(cf.cash_in, sum(pays.filter((p) => p.direction === 'in'), 'amount'));
  assert.equal(cf.cash_out_other, sum(pays.filter((p) => p.direction === 'out'), 'amount'));
  assert.equal(cf.cash_out_expenses, 100001 + 12345, 'chi phí đã huỷ không tính');
  assert.equal(cf.net_cash, cf.cash_in - cf.cash_out_other - cf.cash_out_expenses);

  // Công nợ khách = Σ (phải thu − đã trả hàng − đã thu) của đơn ngoài sàn còn thiếu; o7 còn nợ 30.000
  const orders = (await api.get('/orders?limit=200')).body.data;
  const mp = new Set(['shopee']);
  const owed = orders.filter((x) => !mp.has(x.channel_id) && ['confirmed', 'shipping', 'completed'].includes(x.status));
  const recv = owed.reduce((a, x) => a + Math.max(0, x.total_amount - x.returned_amount - x.paid_amount), 0);
  assert.equal(cf.customer_receivable, recv);
  assert.ok(cf.customer_receivable >= 30000);
  // Tiền Shopee treo khớp màn đối soát
  const pending = (await api.get('/reconciliation/pending')).body;
  assert.equal(cf.marketplace_pending, pending.total_pending);
  assert.equal(cf.marketplace_pending_orders, pending.count);
  // Công nợ NCC
  const p = (await api.get(`/purchases/${pur.id}`)).body.data;
  assert.equal(cf.supplier_payable, p.total_amount - p.paid_amount);
  assert.equal(p.paid_amount, 500000);
  assert.equal((await api.post(`/purchases/${pur.id}/payments`, { amount: p.total_amount, method: 'cash' })).status, 400, 'trả vượt phiếu nhập bị chặn');
});

test('Kỳ trước liền kề, không chồng lấn; chỉ số kỳ trước tính đúng từ dữ liệu kỳ đó', async () => {
  const { api } = await world();
  const today = businessDate();
  const r = (await api.get(`/reports/overview?from=${addDays(today, -3)}&to=${today}`)).body.data;
  assert.equal(r.previous_filter.to, addDays(today, -4));
  assert.equal(r.previous_filter.from, addDays(today, -7), 'kỳ 4 ngày → kỳ trước cũng 4 ngày liền kề');
  const direct = (await api.get(`/reports/overview?from=${r.previous_filter.from}&to=${r.previous_filter.to}`)).body.data.current;
  assert.equal(r.previous.net_revenue, direct.net_revenue);
  assert.equal(r.previous.expenses_amount, direct.expenses_amount);
});

test('Sức khoẻ: giá trị hiển thị đúng bằng chỉ số tổng quan', async () => {
  const { api } = await world();
  const ov = (await api.get(`/reports/overview?${WIDE}`)).body.data.current;
  const h = (await api.get(`/reports/health?${WIDE}`)).body;
  const byKey = Object.fromEntries(h.data.map((d) => [d.key, d]));
  assert.equal(byKey.gross_margin_pct.value, ov.gross_margin_pct);
  assert.equal(byKey.cancel_rate_pct.value, ov.cancel_rate_pct);
  assert.equal(byKey.return_rate_pct.value, ov.return_rate_pct);
});

test('Huỷ phiếu nhập đã trả tiền NCC: bắt buộc ghi nhận NCC hoàn tiền, dòng tiền ròng về đúng', async () => {
  const { api, wh } = await setup();
  const a = (await api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 100000 }] })).body.data.variants[0];
  const pur = (await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 10, unit_cost: 40000 }] })).body.data;
  await api.post(`/purchases/${pur.id}/payments`, { amount: 150000, method: 'bank' });
  const blocked = await api.post(`/purchases/${pur.id}/cancel`, {});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'PURCHASE_PAID');
  assert.equal((await api.get(`/purchases/${pur.id}`)).body.data.status, 'received', 'chưa huỷ');
  const ok = await api.post(`/purchases/${pur.id}/cancel`, { refund_method: 'bank' });
  assert.equal(ok.status, 200);
  const cf = (await api.get('/reports/cashflow')).body.data;
  assert.equal(cf.cash_in, 150000, 'NCC hoàn tiền là tiền vào');
  assert.equal(cf.cash_out_other, 150000);
  assert.equal(cf.net_cash, 0);
  assert.equal(cf.supplier_payable, 0);
  assert.equal((await api.get(`/purchases/${pur.id}`)).body.data.paid_amount, 0);
});

test('PATCH chỉ đổi đúng trường được gửi, không đặt các trường khác về mặc định (đơn, chi phí, phiếu nhập, sản phẩm, webhook)', async () => {
  const { api, nh, wh } = await setup();
  await api.patch(`/shops/${nh.id}`, { industry: 'phong_thuy' });
  const a = (await api.post('/products', { name: 'A', unit: 'chai', custom: { ngu_hanh: ['Kim'] }, custom_shop_id: nh.id, tags: ['x'], variants: [{ sku: 'A1', default_price: 100000, min_stock: 5 }], shop_ids: [nh.id] })).body.data;
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.variants[0].id, qty: 50, unit_cost: 40000 }] });

  // Đơn nháp: sửa ghi chú không được xoá phí ship/phí sàn/giảm giá
  const d = (await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'A1', qty: 3 }], discount_amount: 30000, shipping_fee: 20000, platform_fee_amount: 5000, seller_shipping_amount: 7000, tags: ['gấp'] })).body.data;
  const r = await api.patch(`/orders/${d.id}`, { note: 'chỉ sửa ghi chú' });
  assert.equal(r.status, 200);
  const after = (await api.get(`/orders/${d.id}`)).body.data;
  assert.deepEqual([after.discount_amount, after.shipping_fee, after.platform_fee_amount, after.seller_shipping_amount, after.note, after.tags], [30000, 20000, 5000, 7000, 'chỉ sửa ghi chú', ['gấp']]);
  assert.equal(after.total_amount, d.total_amount);

  // Đơn đã chốt: sửa phí sàn (việc thường làm khi sàn trả tiền) phải được, tiền tính lại đúng
  const c = (await api.post('/orders', { shop_id: nh.id, channel_id: 'shopee', external_id: 'SP9', lines: [{ sku: 'A1', qty: 1 }], platform_fee_amount: 5000, status: 'completed' })).body.data;
  const fix = await api.patch(`/orders/${c.id}`, { platform_fee_amount: 9000 });
  assert.equal(fix.status, 200, JSON.stringify(fix.body));
  const c2 = (await api.get(`/orders/${c.id}`)).body.data;
  assert.equal(c2.platform_fee_amount, 9000);
  assert.equal(c2.net_amount, 100000 - 9000);
  // Sửa giảm giá/sản phẩm của đơn đã chốt vẫn bị chặn (đúng nghiệp vụ)
  assert.equal((await api.patch(`/orders/${c.id}`, { discount_amount: 1 })).status, 409);

  // Chi phí: sửa số tiền không đổi phương thức
  const e = (await api.post('/expenses', { category_id: 'ecat_ads', amount: 1000, method: 'bank', payee: 'FB' })).body.data;
  const e2 = (await api.patch(`/expenses/${e.id}`, { amount: 2000 })).body.data;
  assert.deepEqual([e2.amount, e2.method, e2.payee], [2000, 'bank', 'FB']);

  // Phiếu nhập nháp: sửa ghi chú không xoá phí
  const p = (await api.post('/purchases', { warehouse_id: wh.id, lines: [{ variant_id: a.variants[0].id, qty: 2, unit_cost: 10000 }], shipping_fee: 4000, other_fee: 1000, discount_amount: 500 })).body.data;
  const p2 = (await api.patch(`/purchases/${p.id}`, { note: 'ghi chú' })).body.data;
  assert.deepEqual([p2.shipping_fee, p2.other_fee, p2.discount_amount], [4000, 1000, 500]);

  // Sản phẩm: đổi tên không đặt lại đơn vị, ngũ hành, nhãn; đổi SKU không đặt lại giá/tồn tối thiểu
  const pr = (await api.patch(`/products/${a.id}`, { name: 'A mới', variants: [{ id: a.variants[0].id, name: 'Bản 1' }] })).body.data;
  assert.deepEqual([pr.name, pr.unit, pr.tags], ['A mới', 'chai', ['x']]);
  assert.deepEqual((await api.get(`/custom/values/product/${a.id}?shop_id=${nh.id}`)).body.data.ngu_hanh, ['Kim'], 'ngũ hành (trường sản phẩm của shop) không bị xoá khi sửa tên'); 
  assert.deepEqual([pr.variants[0].default_price, pr.variants[0].min_stock], [100000, 5]);

  // Webhook: đổi URL không bật lại hook đã tắt và không đặt lại danh sách sự kiện
  const h = (await api.post('/system/webhooks', { name: 'h', url: 'https://example.com/a', event_types: ['order.created'], active: false })).body.data;
  const h2 = (await api.patch(`/system/webhooks/${h.id}`, { url: 'https://example.com/b' })).body.data;
  assert.deepEqual([h2.active, h2.event_types, h2.url], [false, ['order.created'], 'https://example.com/b']);
  assert.equal((await api.patch(`/system/webhooks/${h.id}`, { event_types: ['khong.co'] })).status, 400, 'ràng buộc vẫn còn');
});
