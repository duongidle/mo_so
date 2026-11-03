import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

// Tách CSV đơn giản (đủ cho dữ liệu test: có ô trong ngoặc kép, có dấu phẩy và ngoặc kép lồng)
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cur += '"', i++);
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') (row.push(cur), cur = '');
    else if (ch === '\r') continue;
    else if (ch === '\n') (row.push(cur), rows.push(row), row = [], cur = '');
    else cur += ch;
  }
  return rows;
}

async function scenario() {
  const ctx = await setup();
  const { api, nh, pt, wh } = ctx;
  const a = (await api.post('/products', { name: 'Nước hoa', variants: [{ sku: 'NH-1', default_price: 150000 }], shop_ids: [nh.id] })).body.data.variants[0];
  const b = (await api.post('/products', { name: 'Tỳ hưu', variants: [{ sku: 'PT-1', default_price: 500000 }], shop_ids: [pt.id] })).body.data.variants[0];
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 20, unit_cost: 50000 }, { variant_id: b.id, qty: 5, unit_cost: 200000 }] });
  const o1 = (await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', customer: { name: 'Anh "Tài", Q1', phone: '0911000111' }, shipping_address: '12 Lê Lợi', lines: [{ sku: 'NH-1', qty: 2 }], discount_amount: 10000, shipping_fee: 20000, status: 'completed', payments: [{ amount: 310000 }], ordered_at: '2026-10-20T03:00:00.000Z', note: '=HYPERLINK("http://x")' })).body.data;
  const o2 = (await api.post('/orders', { shop_id: nh.id, channel_id: 'shopee', external_id: 'SP-9', lines: [{ sku: 'NH-1', qty: 1 }], platform_fee_amount: 15000, status: 'completed', ordered_at: '2026-11-02T03:00:00.000Z' })).body.data;
  const o3 = (await api.post('/orders', { shop_id: pt.id, channel_id: 'facebook', customer: { name: 'Chị Lan', phone: '0922000222' }, lines: [{ sku: 'PT-1', qty: 1 }], status: 'confirmed', ordered_at: '2026-11-03T03:00:00.000Z' })).body.data;
  const x = (await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'NH-1', qty: 1 }], status: 'confirmed', ordered_at: '2026-11-03T04:00:00.000Z' })).body.data;
  await api.post(`/orders/${x.id}/status`, { status: 'cancelled' });
  return { ...ctx, o1, o2, o3, x };
}

const get = async (api, qs) => { const r = await api.get(`/orders/export${qs}`); return typeof r.body === 'string' ? parseCsv(r.body) : r.body; };

test('Xuất đơn: mỗi đơn một dòng, tiếng Việt, tiền là số nguyên, chống công thức độc, BOM cho Excel', async () => {
  const { api, app, o1 } = await scenario();
  const res = await api.get('/orders/export');
  assert.equal(res.status, 200);
  // Đọc byte thô: res.text() của fetch tự bỏ BOM khi giải mã nên không thấy được ở đó
  const login = await app.fetch(new Request('http://test/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'duong', password: 'matkhau123' }) }));
  const raw = await app.fetch(new Request('http://test/api/v1/orders/export', { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } }));
  assert.deepEqual([...new Uint8Array(await raw.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM để Excel mở đúng tiếng Việt');
  assert.match(raw.headers.get('content-disposition'), /^attachment; filename="don-hang-tat-ca\.csv"$/);
  const rows = parseCsv(res.body);
  const [head, ...data] = rows;
  assert.equal(head[0], 'Mã đơn');
  assert.equal(data.length, 4, 'gồm cả đơn đã huỷ khi không lọc');
  const col = (name) => head.indexOf(name);

  const r1 = data.find((r) => r[col('Mã đơn')] === o1.code);
  assert.equal(r1[col('Khách')], 'Anh "Tài", Q1', 'dấu phẩy và ngoặc kép trong ô được thoát đúng');
  assert.equal(r1[col('Ngày đặt')], '20/10/2026 10:00', 'giờ Việt Nam (UTC+7)');
  assert.equal(r1[col('Trạng thái')], 'Hoàn thành');
  assert.equal(r1[col('Thanh toán')], 'Đã thu');
  assert.equal(r1[col('Tiền hàng')], '300000');
  assert.equal(r1[col('Giảm giá')], '10000');
  assert.equal(r1[col('Khách phải trả')], '310000');
  assert.equal(r1[col('Giá vốn')], '100000');
  assert.equal(r1[col('Lợi nhuận gộp')], String(310000 - 100000));
  assert.match(r1[col('Ghi chú')], /^'=HYPERLINK/, 'ô bắt đầu bằng = bị vô hiệu hoá để Excel không chạy công thức');

  const shopee = data.find((r) => r[col('Mã đơn trên kênh')] === 'SP-9');
  assert.equal(shopee[col('Kênh')], 'Shopee');
  assert.equal(shopee[col('Phí sàn')], '15000');
  assert.equal(shopee[col('Shop thực nhận')], '135000');
  assert.equal(shopee[col('Thanh toán')], 'Chưa thu');

  const cancelled = data.find((r) => r[col('Trạng thái')] === 'Đã huỷ');
  assert.equal(cancelled[col('Lợi nhuận gộp')], '0', 'đơn huỷ không có lợi nhuận');
  assert.equal(cancelled[col('Giá vốn')], '0');
});

test('Xuất đơn: dùng đúng bộ lọc của danh sách đơn (shop, trạng thái, kênh, ngày, tìm kiếm)', async () => {
  const { api, nh, pt } = await scenario();
  const count = async (qs) => (await get(api, qs)).length - 1;
  const listCount = async (qs) => (await api.get(`/orders${qs}&limit=100`)).body.data.length;
  for (const qs of [`?shop_id=${nh.id}`, `?shop_id=${pt.id}`, '?status=completed', '?status=confirmed,completed', '?channel=shopee', '?from=2026-11-01&to=2026-11-02', '?q=Lan', '?q=SP-9', '?payment_status=paid']) {
    assert.equal(await count(qs), await listCount(qs), `file xuất và danh sách phải khớp với ${qs}`);
  }
  assert.equal(await count(`?shop_id=${nh.id}`), 3);
  assert.equal(await count('?status=completed'), 2);
  assert.equal(await count('?from=2026-11-03'), 2);
  assert.equal(await count('?q=khong-co-don-nao'), 0, 'không có đơn: chỉ còn dòng tiêu đề');
});

test('Xuất đơn: kiểu mỗi sản phẩm một dòng, JSON cho Excel, kiểm tra tham số và quyền', async () => {
  const { api, app, o1 } = await scenario();
  const lines = await get(api, '?layout=lines');
  assert.deepEqual(lines[0].slice(0, 3), ['Mã đơn', 'Mã đơn trên kênh', 'Shop']);
  assert.equal(lines.length - 1, 4, 'mỗi đơn có đúng 1 dòng hàng');
  const row = lines.find((r) => r[0] === o1.code);
  assert.deepEqual([row[lines[0].indexOf('SKU')], row[lines[0].indexOf('Số lượng')], row[lines[0].indexOf('Đơn giá')], row[lines[0].indexOf('Thành tiền')], row[lines[0].indexOf('Giá vốn / cái')]], ['NH-1', '2', '150000', '300000', '50000']);

  const json = (await api.get('/orders/export?format=json&status=completed')).body.data;
  assert.equal(json.count, 2);
  assert.equal(json.headers[0], 'Mã đơn');
  assert.equal(typeof json.rows[0][json.headers.indexOf('Tiền hàng')], 'number', 'JSON giữ số là số để Excel cộng được');

  assert.equal((await api.get('/orders/export?layout=sai')).status, 400);
  assert.equal((await api.get('/orders/export?from=hom-qua')).status, 400);
  // Không bị /:id nuốt mất
  assert.equal((await api.get('/orders/export')).status, 200);
  // API key chỉ đọc xuất được; không đăng nhập thì không
  const anon = await app.fetch(new Request('http://test/api/v1/orders/export'));
  assert.equal(anon.status, 401);
});

test('Xuất đơn: format=count đếm trước số đơn và số dòng theo cùng bộ lọc', async () => {
  const { api, nh } = await scenario();
  const all = (await api.get('/orders/export?format=count')).body.data;
  assert.deepEqual([all.orders, all.lines], [4, 4]);
  const nhOnly = (await api.get(`/orders/export?format=count&shop_id=${nh.id}&status=completed`)).body.data;
  assert.deepEqual([nhOnly.orders, nhOnly.lines], [2, 2]);
  assert.equal(all.max_rows, 50000);
});
