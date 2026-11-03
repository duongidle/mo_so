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

test('Xuất danh sách khách: cùng bộ lọc với danh sách, cột riêng của shop, không lộ dữ liệu shop khác', async () => {
  const { api, app, nh, pt, o1, o3 } = await scenario();
  await api.patch(`/shops/${nh.id}`, { industry: 'nuoc_hoa_o_to' });
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' });
  const tai = o1.customer_id;
  const lan = o3.customer_id;
  await api.put(`/custom/values/customer/${tai}?shop_id=${nh.id}`, { dong_xe: 'Camry =1+1' });
  await api.put(`/custom/values/customer/${lan}?shop_id=${pt.id}`, { menh: 'Kim' });
  await api.put(`/customers/${tai}/tags`, { shop_id: nh.id, tags: ['VIP', 'Mua sỉ'] });
  await api.post(`/customers/${tai}/shops`, { shop_id: pt.id });
  await api.put(`/customers/${tai}/tags`, { shop_id: pt.id, tags: ['Chỉ ở PT'] });

  // Theo shop NH: có cột trường riêng của NH, nhãn NH; không có mệnh; không thấy chị Lan (khách PT)
  const nhRes = await api.get(`/customers/export?shop_id=${nh.id}&format=json`);
  const d = nhRes.body.data;
  assert.equal(d.count, 1);
  const h = d.headers;
  const row = Object.fromEntries(h.map((k, i) => [k, d.rows[0][i]]));
  assert.equal(row['Họ tên'], 'Anh "Tài", Q1');
  assert.equal(row['Nhãn'], 'Mua sỉ, VIP');
  assert.equal(row['Dòng xe'], 'Camry =1+1');
  assert.ok(!h.includes('Mệnh'), 'shop nước hoa ô tô không có mệnh');
  assert.equal(row['Số đơn tại shop'], 1);
  assert.equal(row['Chi tiêu tại shop'], 290000, '2×150k − giảm 10k; phí ship khách trả không phải doanh thu');
  assert.ok(!h.includes('Chỉ ở PT') && !JSON.stringify(d.rows).includes('Chỉ ở PT'), 'nhãn của shop PT không lộ sang file NH');

  // Theo shop PT: có mệnh (cả khách chỉ nhập tay), nhãn PT; anh Tài cũng ở PT nhưng chưa có đơn ở PT
  const pd = (await api.get(`/customers/export?shop_id=${pt.id}&format=json`)).body.data;
  assert.equal(pd.count, 2);
  assert.ok(pd.headers.includes('Mệnh') && pd.headers.includes('Nạp âm'));
  assert.equal(pd.headers.filter((k) => k === 'Mệnh').length, 1, 'trường mệnh ghi đè gộp vào một cột');
  const prow = (name) => Object.fromEntries(pd.headers.map((k, i) => [k, pd.rows.find((r) => r[1] === name)[i]]));
  assert.equal(prow('Chị Lan')['Mệnh'], 'Kim');
  assert.equal(prow('Chị Lan')['Số đơn tại shop'], 1);
  assert.equal(prow('Anh "Tài", Q1')['Số đơn tại shop'], 0, 'đơn ở NH không tính vào số liệu PT');
  assert.equal(prow('Anh "Tài", Q1')['Nhãn'], 'Chỉ ở PT');
  assert.ok(!pd.headers.includes('Dòng xe'), 'trường riêng của NH không lộ sang PT');

  // Lọc: giống danh sách (mệnh, nhãn, tìm kiếm)
  assert.equal((await api.get(`/customers/export?shop_id=${pt.id}&element=Kim&format=json`)).body.data.count, 1);
  assert.equal((await api.get(`/customers/export?shop_id=${nh.id}&tag=vip&format=json`)).body.data.count, 1);
  assert.equal((await api.get(`/customers/export?shop_id=${nh.id}&tag=khong-co&format=json`)).body.data.count, 0);
  assert.equal((await api.get(`/customers/export?shop_id=${pt.id}&q=0922000222&format=json`)).body.data.count, 1);
  assert.equal((await api.get('/customers/export?tag=VIP&format=json')).status, 400, 'nhãn cần shop');
  assert.equal((await api.get('/customers/export?shop_id=shp_khongco&format=json')).status, 404);
  // Số dòng khớp danh sách
  assert.equal((await api.get(`/customers?shop_id=${pt.id}`)).body.data.length, pd.count);

  // Không chọn shop: chỉ thông tin chung + tổng hợp, liệt kê các shop khách thuộc về
  const all = (await api.get('/customers/export?format=json')).body.data;
  assert.equal(all.count, 2);
  assert.ok(!all.headers.includes('Nhãn') && !all.headers.includes('Mệnh') && !all.headers.includes('Dòng xe'));
  const arow = Object.fromEntries(all.headers.map((k, i) => [k, all.rows.find((r) => r[1] === 'Anh "Tài", Q1')[i]]));
  assert.match(arow['Các shop'], /Nước hoa ô tô/);
  assert.match(arow['Các shop'], /Phong thuỷ/);
  assert.equal(arow['Số đơn'], 1);

  // CSV: BOM, chống công thức độc, tiêu đề tiếng Việt, tên file
  const login = await app.fetch(new Request('http://test/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'duong', password: 'matkhau123' }) }));
  const raw = await app.fetch(new Request(`http://test/api/v1/customers/export?shop_id=${nh.id}`, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } }));
  const bytes = new Uint8Array(await raw.clone().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM để Excel mở đúng tiếng Việt');
  assert.match(raw.headers.get('content-disposition'), /^attachment; filename="khach-hang-nh-\d{8}\.csv"$/);
  const csv = await raw.text();
  assert.ok(csv.includes("'Camry =1+1") === false, 'chỉ ô BẮT ĐẦU bằng = mới bị vô hiệu; "Camry =1+1" an toàn');
  assert.ok(csv.includes('Camry =1+1'));
  // Ô bắt đầu bằng ký tự công thức bị vô hiệu hoá
  await api.put(`/custom/values/customer/${tai}?shop_id=${nh.id}`, { dong_xe: '=HYPERLINK("http://x")' });
  const csv2 = await (await app.fetch(new Request(`http://test/api/v1/customers/export?shop_id=${nh.id}`, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } }))).text();
  assert.ok(csv2.includes(`"'=HYPERLINK(""http://x"")"`), 'chống CSV injection');
});
