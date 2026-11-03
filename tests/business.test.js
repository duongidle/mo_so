import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

async function seedCatalog(api, nh, pt, wh) {
  const perfume = await api.post('/products', {
    name: 'Nước hoa ô tô',
    consumption_days: 45,
    variants: [
      { sku: 'nh-go-10', name: 'Gỗ đàn hương', default_price: 150000, min_stock: 5 },
      { sku: 'NH-CAM-10', name: 'Cam bergamot', default_price: 140000 },
    ],
    shop_ids: [nh.id],
  });
  assert.equal(perfume.status, 201, JSON.stringify(perfume.body));
  const ty = await api.post('/products', {
    name: 'Tỳ hưu thạch anh',
    elements: ['Thổ', 'Kim'],
    variants: [{ sku: 'PT-TYHUU', default_price: 500000 }],
    shop_ids: [pt.id],
  });
  assert.equal(ty.status, 201);
  return { perfume: perfume.body.data, ty: ty.body.data };
}

test('M2: sản phẩm gốc, niêm yết theo shop, đồng bộ', async () => {
  const { api, nh, pt, wh } = await setup();
  const { perfume } = await seedCatalog(api, nh, pt, wh);
  assert.equal(perfume.variants[0].sku, 'NH-GO-10', 'SKU viết hoa');

  const dupSku = await api.post('/products', { name: 'x', variants: [{ sku: 'NH-GO-10' }] });
  assert.equal(dupSku.status, 409);

  const listNh = await api.get(`/products?shop_id=${nh.id}`);
  assert.equal(listNh.body.data.length, 1);
  const listPt = await api.get(`/products?shop_id=${pt.id}`);
  assert.equal(listPt.body.data.length, 1);

  // Đồng bộ 1 sản phẩm từ NH sang PT
  const sync = await api.post('/listings/sync', { from_shop_id: nh.id, to_shop_id: pt.id, product_ids: [perfume.id] });
  assert.deepEqual(sync.body.data, { created: 2, updated: 0, skipped: 0 });
  // Chạy lại: bỏ qua vì đã có
  const sync2 = await api.post('/listings/sync', { from_shop_id: nh.id, to_shop_id: pt.id });
  assert.equal(sync2.body.data.skipped, 2);
  // Đổi giá ở PT, rồi đồng bộ ghi đè → về giá NH
  await api.put('/listings', [{ shop_id: pt.id, variant_id: perfume.variants[0].id, price: 199000 }]);
  const v1 = await api.get(`/variants?shop_id=${pt.id}&q=NH-GO`);
  assert.equal(v1.body.data[0].price, 199000);
  await api.post('/listings/sync', { from_shop_id: nh.id, to_shop_id: pt.id, overwrite_price: true });
  const v2 = await api.get(`/variants?shop_id=${pt.id}&q=NH-GO`);
  assert.equal(v2.body.data[0].price, 150000);

  // Sửa thông tin sản phẩm gốc → cả 2 shop thấy cùng tên
  await api.patch(`/products/${perfume.id}`, { name: 'Nước hoa ô tô cao cấp' });
  const both = await api.get(`/variants?shop_id=${pt.id}&q=cao cấp`);
  assert.equal(both.body.data.length, 2);
});

test('M3: nhập hàng phân bổ phí, giá vốn bình quân, kiểm kê, huỷ phiếu', async () => {
  const { api, nh, pt, wh } = await setup();
  const { perfume } = await seedCatalog(api, nh, pt, wh);
  const [go, cam] = perfume.variants;
  const sup = (await api.post('/suppliers', { name: 'Xưởng Bình Dương', phone: '0909000111' })).body.data;

  // Phiếu 1: 10 GO × 50k + 10 CAM × 30k, ship 40k → phân bổ theo giá trị (500k:300k) = 25k:15k
  const p1 = await api.post('/purchases', {
    supplier_id: sup.id,
    warehouse_id: wh.id,
    shipping_fee: 40000,
    lines: [
      { variant_id: go.id, qty: 10, unit_cost: 50000 },
      { variant_id: cam.id, qty: 10, unit_cost: 30000 },
    ],
    receive: true,
    paid_amount: 300000,
  });
  assert.equal(p1.status, 201, JSON.stringify(p1.body));
  assert.equal(p1.body.data.total_amount, 840000);
  assert.equal(p1.body.data.lines[0].landed_unit_cost, 52500);
  assert.equal(p1.body.data.lines[1].landed_unit_cost, 31500);
  assert.equal(p1.body.data.debt, 540000);

  // Phiếu 2: 10 GO × 60k → bình quân (10×52.5k + 10×60k)/20 = 56.25k ≈ 56250
  await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, lines: [{ variant_id: go.id, qty: 10, unit_cost: 60000 }], receive: true });
  let stock = (await api.get(`/stock?warehouse_id=${wh.id}&q=NH-GO`)).body.data[0];
  assert.equal(stock.on_hand, 20);
  assert.equal(stock.avg_cost, 56250);

  // Kiểm kê: đếm được 18 → điều chỉnh -2, giá vốn giữ nguyên
  const cnt = await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'count', reason: 'Kiểm kho tháng 11', lines: [{ variant_id: go.id, counted: 18 }] });
  assert.equal(cnt.body.data.lines[0].change, -2);
  stock = (await api.get(`/stock?warehouse_id=${wh.id}&q=NH-GO`)).body.data[0];
  assert.equal(stock.on_hand, 18);
  assert.equal(stock.avg_cost, 56250);

  // Nhà cung cấp còn nợ
  const sups = (await api.get('/suppliers')).body.data;
  assert.equal(sups[0].debt, 540000 + 600000);

  // Huỷ phiếu nháp không ảnh hưởng kho
  const draft = await api.post('/purchases', { warehouse_id: wh.id, lines: [{ variant_id: cam.id, qty: 5, unit_cost: 30000 }] });
  await api.post(`/purchases/${draft.body.data.id}/cancel`, { reason: 'đặt nhầm' });
  stock = (await api.get(`/stock?warehouse_id=${wh.id}&q=NH-CAM`)).body.data[0];
  assert.equal(stock.on_hand, 10);

  const integrity = await api.get('/stock-integrity');
  assert.equal(integrity.body.ok, true, JSON.stringify(integrity.body));
});

test('M4: khách hàng chung, chuẩn hoá SĐT, mệnh, gộp trùng', async () => {
  const { api } = await setup();
  const a = await api.post('/customers', { name: 'Trần Thị B', phone: '+84 901 234 567', birth_date: '1990-01-20' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.data.phone, '0901234567');
  assert.equal(a.body.data.feng_shui.element, 'Mộc', 'Sinh trước Tết 1990 → năm Kỷ Tỵ, Đại Lâm Mộc');
  assert.deepEqual(a.body.data.feng_shui.compatible_elements, ['Mộc', 'Thuỷ']);

  const dup = await api.post('/customers', { name: 'B', phone: '0901234567' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'CUSTOMER_EXISTS');

  const b = await api.post('/customers', { name: 'Trần Thị B', facebook_url: 'fb.com/ttb' });
  const cands = (await api.get('/customers/duplicates')).body.data;
  assert.equal(cands.length, 1);
  const merged = await api.post(`/customers/${a.body.data.id}/merge`, { source_id: b.body.data.id });
  assert.equal(merged.body.data.facebook_url, 'fb.com/ttb');
  const list = (await api.get('/customers')).body.data;
  assert.equal(list.length, 1);
  const lookup = await api.get('/customers/lookup?phone=0901.234.567');
  assert.equal(lookup.body.data.id, a.body.data.id);
});

test('M5: bán hàng, trừ kho, giá vốn chụp, huỷ, trả hàng, thanh toán', async () => {
  const { api, nh, pt, wh } = await setup();
  const { perfume, ty } = await seedCatalog(api, nh, pt, wh);
  const [go, cam] = perfume.variants;
  await api.post('/purchases', {
    warehouse_id: wh.id,
    lines: [
      { variant_id: go.id, qty: 10, unit_cost: 50000 },
      { variant_id: cam.id, qty: 5, unit_cost: 40000 },
      { variant_id: ty.variants[0].id, qty: 3, unit_cost: 200000 },
    ],
    receive: true,
  });

  // Bán trực tiếp (POS): hoàn thành + thu đủ một bước, khách mới theo SĐT
  const pos = await api.post('/orders', {
    shop_id: nh.id,
    channel_id: 'direct',
    customer: { name: 'Anh Tài', phone: '0912 345 678' },
    lines: [
      { sku: 'NH-GO-10', qty: 2 },
      { variant_id: cam.id, qty: 1, discount_amount: 10000 },
    ],
    discount_amount: 20000,
    status: 'completed',
    payments: [{ amount: 400000, method: 'cash' }],
  });
  assert.equal(pos.status, 201, JSON.stringify(pos.body));
  const o = pos.body.data;
  assert.equal(o.subtotal, 440000);
  assert.equal(o.goods_revenue, 410000);
  assert.equal(o.total_amount, 410000);
  assert.equal(o.status, 'completed');
  assert.equal(o.payment_status, 'partial');
  assert.equal(o.amount_due, 10000);
  assert.equal(o.cogs_amount, 2 * 50000 + 40000);
  assert.equal(o.gross_profit, 410000 - 140000);
  assert.match(o.code, /^DH-NH-\d{6}-001$/);
  assert.equal(o.lines.reduce((a, l) => a + l.allocated_order_discount, 0), 20000);

  // Thu nốt
  const paid = await api.post(`/orders/${o.id}/payments`, { amount: 10000, method: 'bank' });
  assert.equal(paid.body.data.payment_status, 'paid');

  // Khách được tạo và thống kê đúng
  const cus = (await api.get('/customers/lookup?phone=0912345678')).body.data;
  assert.equal(cus.order_count, 1);
  assert.equal(cus.total_spent, 410000);

  // Không đủ tồn → từ chối
  const over = await api.post('/orders', { shop_id: pt.id, lines: [{ sku: 'PT-TYHUU', qty: 5 }], status: 'confirmed' });
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'STOCK_NOT_ENOUGH');
  // …và không để lại đơn nửa vời
  const ptOrders = (await api.get(`/orders?shop_id=${pt.id}`)).body.data;
  assert.equal(ptOrders.length, 0);

  // Đơn Facebook ở shop phong thuỷ, cùng khách → khách dùng chung
  const fb = await api.post('/orders', { shop_id: pt.id, channel_id: 'facebook', customer: { phone: '0912345678' }, lines: [{ sku: 'PT-TYHUU', qty: 1 }], shipping_fee: 30000, seller_shipping_amount: 25000, status: 'confirmed' });
  assert.equal(fb.body.data.customer_id, cus.id);
  const detail = (await api.get(`/customers/${cus.id}`)).body.data;
  assert.equal(detail.order_count, 2);
  assert.equal(detail.by_shop.length, 2);

  // Huỷ đơn đã xác nhận → hoàn kho
  let tyStock = (await api.get(`/stock?q=PT-TYHUU`)).body.data[0].on_hand;
  assert.equal(tyStock, 2);
  await api.post(`/orders/${fb.body.data.id}/status`, { status: 'cancelled', note: 'Khách đổi ý' });
  tyStock = (await api.get(`/stock?q=PT-TYHUU`)).body.data[0].on_hand;
  assert.equal(tyStock, 3);
  const cancelled = (await api.get(`/orders/${fb.body.data.id}`)).body.data;
  assert.equal(cancelled.net_revenue, 0);
  assert.equal(cancelled.cogs_amount, 0);

  // Trả 1 chai GO (nhập lại kho) và hoàn 100k
  const goLine = o.lines.find((l) => l.sku === 'NH-GO-10');
  const ret = await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: goLine.id, qty: 1, restock: true }], reason: 'Khách không hợp mùi', refund: { amount: 100000, method: 'cash' } });
  assert.equal(ret.status, 200, JSON.stringify(ret.body));
  const r = ret.body.data;
  // Giá trị 1 chai sau phân bổ giảm giá đơn: (300000 - phần giảm giá phân bổ) / 2
  const expected = Math.round((goLine.line_total - goLine.allocated_order_discount) / 2);
  assert.equal(r.returned_amount, expected);
  assert.equal(r.net_revenue, 410000 - expected);
  assert.equal(r.cogs_amount, 140000 - 50000);
  assert.equal(r.paid_amount, 310000);
  assert.equal(r.status, 'completed');

  const goStock = (await api.get(`/stock?q=NH-GO`)).body.data[0];
  assert.equal(goStock.on_hand, 9);

  // Đơn nháp sửa được dòng; đơn đã xác nhận thì không
  const d = await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'NH-CAM-10', qty: 1 }] });
  const edited = await api.patch(`/orders/${d.body.data.id}`, { lines: [{ sku: 'NH-CAM-10', qty: 3 }] });
  assert.equal(edited.body.data.subtotal, 420000);
  await api.post(`/orders/${d.body.data.id}/status`, { status: 'confirmed' });
  const locked = await api.patch(`/orders/${d.body.data.id}`, { lines: [{ sku: 'NH-CAM-10', qty: 1 }] });
  assert.equal(locked.status, 409);

  // Phiếu bán hàng in được
  const receipt = await api.get(`/orders/${o.id}/receipt`);
  assert.match(receipt.body, /PHIẾU BÁN HÀNG/);

  const integrity = await api.get('/stock-integrity');
  assert.equal(integrity.body.ok, true);
});

test('M6: import đơn — xem thử, tạo, chống trùng, cập nhật trạng thái', async () => {
  const { api, nh, pt, wh } = await setup();
  const { perfume } = await seedCatalog(api, nh, pt, wh);
  await api.post('/purchases', { warehouse_id: wh.id, lines: [{ variant_id: perfume.variants[0].id, qty: 5, unit_cost: 50000 }], receive: true });

  const orders = [
    {
      external_id: '2611030001ABC',
      status: 'Chờ lấy hàng',
      ordered_at: '2026-11-02',
      customer: { name: 'Lê C', phone: '0987654321', shopee_username: 'lec99' },
      lines: [{ sku: 'NH-GO-10', qty: 2, unit_price: 145000 }],
      shipping_fee: 15000,
      platform_fee_amount: 29000,
    },
    { external_id: '2611030002XYZ', status: 'Hoàn thành', lines: [{ sku: 'NH-CAM-10', qty: 1, unit_price: 140000 }], paid_amount: 120000 },
    { external_id: '2611030003ERR', status: 'Hoàn thành', lines: [{ sku: 'KHONG-CO', qty: 1 }] },
  ];
  const base = { shop_id: nh.id, channel_id: 'shopee', profile_id: 'imp_shopee', file_name: 'shopee.xlsx' };

  const preview = await api.post('/imports/orders/preview', { ...base, orders });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.data.summary, { total: 3, created: 2, updated: 0, unchanged: 0, error: 1 });
  // Xem thử không ghi gì
  assert.equal((await api.get(`/orders?shop_id=${nh.id}`)).body.data.length, 0);
  assert.equal((await api.get(`/stock?q=NH-GO`)).body.data[0].on_hand, 5);

  const commit = await api.post('/imports/orders/commit', { ...base, orders });
  assert.deepEqual(commit.body.data.summary, { total: 3, created: 2, updated: 0, unchanged: 0, error: 1 });
  const errRow = commit.body.data.results.find((r) => r.action === 'error');
  assert.match(errRow.error, /KHONG-CO/);
  // CAM chưa có tồn nhưng đơn sàn vẫn được ghi, gắn cờ cảnh báo
  const camOrder = commit.body.data.results.find((r) => r.external_id === '2611030002XYZ');
  assert.equal(camOrder.warning, 'Xuất kho làm âm tồn');
  // Đơn sàn: cần thu = tiền sau phí sàn
  const shopeeOrder = (await api.get(`/orders/${commit.body.data.results[0].order_id}`)).body.data;
  assert.equal(shopeeOrder.net_amount, 2 * 145000 + 15000 - 29000);
  assert.equal(shopeeOrder.amount_due, shopeeOrder.net_amount);
  const paidOrder = await api.post(`/orders/${shopeeOrder.id}/payments`, { amount: shopeeOrder.net_amount, method: 'shopee_payout' });
  assert.equal(paidOrder.body.data.payment_status, 'paid');
  assert.equal((await api.get(`/stock?q=NH-GO`)).body.data[0].on_hand, 3);

  // Import lại cùng file → không trùng
  const again = await api.post('/imports/orders/commit', { ...base, orders: orders.slice(0, 2) });
  assert.deepEqual(again.body.data.summary, { total: 2, created: 0, updated: 0, unchanged: 2, error: 0 });

  // Đơn 1 sau đó bị huỷ trên Shopee → cập nhật + hoàn kho
  const later = await api.post('/imports/orders/commit', { ...base, orders: [{ ...orders[0], status: 'Đã hủy' }] });
  assert.equal(later.body.data.summary.updated, 1);
  assert.deepEqual(later.body.data.results[0].changes.status, { from: 'confirmed', to: 'cancelled' });
  assert.equal((await api.get(`/stock?q=NH-GO`)).body.data[0].on_hand, 5);

  // Đơn 2 bị trả hàng → tạo phiếu trả, nhập lại kho
  const ret = await api.post('/imports/orders/commit', { ...base, orders: [{ ...orders[1], status: 'Trả hàng/Hoàn tiền' }] });
  assert.equal(ret.body.data.results[0].status, 'returned');

  // Trạng thái lạ → báo lỗi rõ ràng
  const weird = await api.post('/imports/orders/preview', { ...base, orders: [{ ...orders[0], external_id: 'NEW1', status: 'Trạng thái lạ' }] });
  assert.match(weird.body.data.results[0].error, /Không hiểu trạng thái/);

  const batches = (await api.get('/imports/batches')).body.data;
  assert.equal(batches.length, 4);
  const integrity = await api.get('/stock-integrity');
  assert.equal(integrity.body.ok, true);
});
