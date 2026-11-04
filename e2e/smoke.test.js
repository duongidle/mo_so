// Smoke test giao diện bằng trình duyệt thật. Chạy: npm run build && npm run test:e2e
// Cần Playwright + Chromium (npm i -D playwright && npx playwright install chromium). Thiếu thì bỏ qua, không làm hỏng `npm test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve } from '@hono/node-server';
import { resetTenancy } from '../server/db/tenancy.js';
import { resetRateLimits } from '../server/lib/ratelimit.js';
import { createApp } from '../server/app.js';

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* không có playwright */ }
const hasDist = fs.existsSync(path.resolve('web/dist/index.html'));
const skip = !chromium ? 'chưa cài playwright' : !hasDist ? 'chưa build giao diện (npm run build)' : false;

let server, base, browser, cookie = '';
const api = async (method, p, body) => {
  const res = await fetch(`${base}/api/v1${p}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return res.json();
};
const stock = async (sku) => (await api('GET', `/stock?q=${sku}`)).data.find((r) => r.sku === sku).on_hand;

let ids = {};
before(async () => {
  if (skip) return;
  resetTenancy(); resetRateLimits();
  server = serve({ fetch: createApp().fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await api('POST', '/auth/register', { username: 'admin', display_name: 'Chủ shop', password: 'matkhau123' });
  const wh0 = (await api('POST', '/warehouses', { code: 'K1', name: 'Kho chính' })).data;
  await api('POST', '/shops', { name: 'Nước hoa', code: 'NH', industry: 'nuoc_hoa_o_to', default_warehouse_id: wh0.id });
  await api('POST', '/shops', { name: 'Phong thuỷ', code: 'PT', industry: 'phong_thuy', default_warehouse_id: wh0.id });
  const shops = (await api('GET', '/shops')).data;
  ids.nh = shops.find((s) => s.code === 'NH').id;
  ids.pt = shops.find((s) => s.code === 'PT').id;
  const wh = (await api('GET', '/warehouses')).data[0].id;
  const a = (await api('POST', '/products', { name: 'Tinh dầu', variants: [{ sku: 'TD-1', default_price: 100000 }], shop_ids: [ids.nh] })).data.variants[0];
  const b = (await api('POST', '/products', { name: 'Móc treo', variants: [{ sku: 'MT-1', default_price: 50000 }], shop_ids: [ids.nh] })).data.variants[0];
  await api('POST', '/products', { name: 'Combo', variants: [{ sku: 'CB-1', kind: 'bundle', default_price: 180000, components: [{ variant_id: a.id, qty: 2 }, { variant_id: b.id, qty: 1 }] }], shop_ids: [ids.nh] });
  await api('POST', '/purchases', { warehouse_id: wh, receive: true, lines: [{ variant_id: a.id, qty: 20, unit_cost: 40000 }, { variant_id: b.id, qty: 10, unit_cost: 10000 }] });
  // Khách thuộc danh sách của từng shop: chị Lan là khách của cả hai shop
  ids.cust = (await api('POST', '/customers', { name: 'Chị Lan', phone: '0922000222', shop_id: ids.nh })).data.id;
  await api('POST', `/customers/${ids.cust}/shops`, { shop_id: ids.pt });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

async function login(viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, locale: 'vi-VN' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(base);
  await page.fill('input[autocomplete=username]', 'admin');
  await page.fill('input[type=password]', 'matkhau123');
  await page.click('button.primary');
  await page.waitForSelector('.topbar');
  return { page, errors, ctx };
}
const pickShop = async (page, name) => {
  await page.click('.shop-btn');
  await page.click(`.shop-menu >> text=${name}`);
  await page.locator('.shop-btn', { hasText: name }).waitFor(); // chờ đến khi bộ chọn shop thật sự đổi, không chờ cố định
};
const themeIs = (page, want) => page.waitForFunction((w) => document.documentElement.dataset.theme === w, want, { timeout: 5000 });

test('đăng nhập sai mật khẩu báo lỗi, đúng thì vào được', { skip }, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base);
  await page.fill('input[autocomplete=username]', 'admin');
  await page.fill('input[type=password]', 'sai-mat-khau');
  await page.click('button.primary');
  await page.waitForSelector('[role=alert]');
  assert.equal(await page.locator('.topbar').count(), 0);
  await ctx.close();
  const ok = await login();
  assert.ok(await ok.page.locator('.sidebar').count());
  await ok.ctx.close();
});

test('thanh bên tự thu gọn sau khi click menu bằng chuột', { skip }, async () => {
  const { page, errors, ctx } = await login();
  const width = () => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width);
  await page.mouse.move(10, 300);
  await page.locator('.sidebar a.nav[title="Đơn hàng"]').click();
  await page.mouse.move(700, 400);
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().width < 100, null, { timeout: 5000 });
  assert.ok(await width() < 100);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('chuyển shop đổi giao diện, tính năng và trường khách đúng theo ngành', { skip }, async () => {
  const { page, errors, ctx } = await login();
  await pickShop(page, 'Nước hoa');
  await themeIs(page, 'oto'); // shop ngành Nước hoa ô tô có giao diện riêng
  assert.equal(await page.locator('.lunar').count(), 0, 'shop nước hoa ô tô không có âm lịch');
  await page.goto(`${base}/customers`);
  await page.waitForSelector('tr.click');
  assert.equal(await page.locator('th:has-text("Mệnh")').count(), 0);

  await page.click('tr.click >> nth=0');
  await page.waitForSelector('text=Chỉ shop này thấy');
  assert.ok(await page.locator('text=Nhóm hương yêu thích').count(), 'trường của ngành nước hoa');
  await page.click('section:has-text("Thông tin riêng") >> button:has-text("Sửa")');
  await page.fill('label:has-text("Dòng xe") input', 'Mazda CX-5');
  await page.click('section:has-text("Thông tin riêng") >> button:has-text("Lưu")');
  await page.waitForSelector('text=Mazda CX-5');
  const url = page.url();

  await pickShop(page, 'Phong thuỷ');
  await themeIs(page, 'phongthuy');
  assert.ok(await page.locator('.lunar').count(), 'shop phong thuỷ có âm lịch');
  await page.goto(url);
  await page.waitForSelector('text=Chỉ shop này thấy');
  assert.equal(await page.locator('text=Mazda CX-5').count(), 0, 'dữ liệu của shop kia không lọt sang');
  assert.ok(await page.locator('text=Ngày sinh (dương lịch)').count());
  assert.equal(await page.locator('text=Dòng xe').count(), 0);

  await pickShop(page, 'Tất cả shop');
  await themeIs(page, 'general');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('POS: bán combo trừ kho từng thành phần và chốt đơn', { skip }, async () => {
  const { page, errors, ctx } = await login({ width: 390, height: 800 });
  await pickShop(page, 'Nước hoa');
  await page.goto(`${base}/pos`);
  await page.waitForSelector('.pick');
  await page.fill('input[aria-label="Tìm sản phẩm"]', 'CB-1');
  await page.click('.pick >> nth=0');
  await page.click('text=Bán ngay');
  await page.waitForSelector('text=ĐÃ CHỐT');
  assert.equal(await stock('TD-1'), 18, 'combo gồm 2 tinh dầu');
  assert.equal(await stock('MT-1'), 9);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('kiểm kê nhiều bước: đếm, hoàn tất, tồn kho điều chỉnh đúng', { skip }, async () => {
  const { page, errors, ctx } = await login();
  await page.goto(`${base}/stock`);
  await page.click('button.tab:has-text("Kiểm kê")');
  await page.click('button:has-text("Phiếu kiểm kê")');
  await page.click('.modal button:has-text("Tạo phiếu")');
  await page.waitForSelector('text=Hoàn tất kiểm kê');
  await page.fill('input[aria-label="Số đếm MT-1"]', '7');
  await page.locator('input[aria-label="Số đếm MT-1"]').blur();
  await page.waitForTimeout(400);
  await page.click('button:has-text("Hoàn tất kiểm kê")');
  await page.waitForSelector('text=Tồn kho sẽ được điều chỉnh');
  await page.click('button:has-text("Áp dụng điều chỉnh")');
  await page.waitForSelector('text=Đã hoàn tất');
  assert.equal(await stock('MT-1'), 7);
  assert.equal(await stock('TD-1'), 18, 'dòng chưa đếm giữ nguyên');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('import đơn từ trang Đơn hàng: xem thử rồi ghi, dòng lỗi được báo', { skip }, async () => {
  const { page, errors, ctx } = await login();
  await pickShop(page, 'Nước hoa');
  const file = path.join(os.tmpdir(), `moso-e2e-${Date.now()}.csv`);
  fs.writeFileSync(file, ['ma_don,ngay,trang_thai,ten_khach,sdt,dia_chi,sku,so_luong,don_gia', 'FB-1,2026-11-02,completed,Anh Nam,0933111222,HCM,TD-1,1,100000', 'FB-2,2026-11-02,completed,Anh Bình,0933111333,HCM,KHONG-CO,1,100000'].join('\n'));
  await page.goto(`${base}/orders`);
  await page.click('button:has-text("Nhập từ file")');
  await page.waitForSelector('input[type=file]');
  await page.selectOption('.modal select >> nth=1', 'imp_standard');
  await page.setInputFiles('input[type=file]', file);
  await page.waitForSelector('text=Đọc được');
  await page.click('button:has-text("Xem thử")');
  await page.waitForSelector('text=2. Xem thử');
  const text = await page.locator('.modal').innerText();
  assert.match(text, /FB-1\s+Tạo mới/);
  assert.match(text, /FB-2\s+Lỗi/);
  await page.click('button:has-text("Ghi vào hệ thống")');
  await page.waitForSelector('text=3. Kết quả');
  const orders = (await api('GET', '/orders?q=FB-')).data;
  assert.equal(orders.length, 1, 'đơn lỗi không được ghi');
  assert.deepEqual(errors, []);
  fs.rmSync(file, { force: true });
  await ctx.close();
});

test('trường thông tin khách hiện thành cột ở danh sách khách; trạng thái trống có hình theo theme', { skip }, async () => {
  const { page, errors, ctx } = await login();
  await pickShop(page, 'Nước hoa');
  await page.goto(`${base}/customers`);
  await page.waitForSelector('tr.click');
  assert.equal(await page.locator('th:has-text("Dòng xe")').count(), 0, 'chưa bật cột nào');
  await page.click('button:has-text("Thông tin khách của shop")');
  await page.waitForSelector('.modal >> text=Dòng xe');
  // ô "Cột" nằm cùng hàng với tên trường "Dòng xe"
  await page.locator('.modal .row.between', { hasText: 'Dòng xe' }).locator('input[type=checkbox]').click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForSelector('th:has-text("Dòng xe")');
  assert.ok(await page.locator('td:has-text("Mazda CX-5")').count(), 'giá trị đã nhập hiện trong cột');

  // Shop phong thuỷ chưa có đơn: trạng thái trống dùng trống đồng
  await pickShop(page, 'Phong thuỷ');
  await page.goto(`${base}/orders`);
  await page.waitForSelector('.empty svg.empty-art'); // chờ đến khi hình trống đồng vẽ xong, không đoán thời gian
  assert.ok(await page.locator('.empty svg.empty-art').count(), 'trống đồng ở shop phong thuỷ');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('xuất đơn hàng: tải CSV và Excel thật theo bộ lọc đang xem', { skip }, async () => {
  const { page, errors, ctx } = await login();
  await pickShop(page, 'Nước hoa');
  await page.goto(`${base}/orders`);
  await page.waitForSelector('tr.click');
  const shown = await page.locator('tbody tr.click').count();

  const readDownload = async (dl) => {
    const file = path.join(os.tmpdir(), `moso-dl-${Date.now()}-${dl.suggestedFilename()}`);
    await dl.saveAs(file);
    return file;
  };

  // CSV
  await page.click('button:has-text("Xuất file")');
  await page.waitForSelector('text=Khớp');
  await page.getByLabel(/CSV/).check();
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.click('.modal button.primary')]);
  assert.match(csvDl.suggestedFilename(), /^don-hang-tat-ca\.csv$/);
  const csvFile = await readDownload(csvDl);
  const buf = fs.readFileSync(csvFile);
  assert.deepEqual([...buf.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM');
  const lines = buf.toString('utf8').replace('﻿', '').trim().split('\r\n');
  assert.ok(lines[0].startsWith('Mã đơn,Mã đơn trên kênh,Shop,Kênh'));
  assert.equal(lines.length - 1, shown, 'số dòng trong file = số đơn đang thấy trong danh sách');
  assert.ok(lines.some((l) => l.includes('Hoàn thành')));

  // Excel, kiểu mỗi sản phẩm một dòng
  await page.click('button:has-text("Xuất file")');
  await page.waitForSelector('text=Khớp');
  await page.getByLabel(/Mỗi sản phẩm một dòng/).check();
  await page.getByLabel(/Excel/).check();
  const [xlDl] = await Promise.all([page.waitForEvent('download'), page.click('.modal button.primary')]);
  assert.match(xlDl.suggestedFilename(), /^don-hang-chi-tiet-tat-ca\.xlsx$/);
  const xlFile = await readDownload(xlDl);
  const XLSX = require(path.resolve('web/node_modules/xlsx'));
  const wb = XLSX.read(fs.readFileSync(xlFile));
  assert.deepEqual(wb.SheetNames, ['Chi tiết hàng']);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Chi tiết hàng'], { header: 1 });
  assert.equal(rows[0][8], 'SKU');
  assert.ok(rows.length > 1);
  const qtyCol = rows[0].indexOf('Số lượng');
  assert.equal(typeof rows[1][qtyCol], 'number', 'số trong Excel là số, không phải chữ');

  // Lọc theo trạng thái rồi xuất: file chỉ gồm đơn khớp
  await page.click('button.chip:has-text("Đã huỷ")');
  await page.waitForTimeout(600);
  await page.click('button:has-text("Xuất file")');
  await page.waitForSelector('text=Trạng thái: Đã huỷ');
  await page.keyboard.press('Escape');

  assert.deepEqual(errors, []);
  for (const f of [csvFile, xlFile]) fs.rmSync(f, { force: true });
  await ctx.close();
});

test('đăng ký tài khoản mới: tạo shop, kho, sản phẩm đầu tiên theo hướng dẫn; dữ liệu tách biệt với tài khoản khác', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'vi-VN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(base);
  await page.click('a:has-text("Đăng ký")');
  await page.fill('input[autocomplete=username]', 'khach_moi');
  await page.fill('input[autocomplete=name]', 'Khách Mới');
  await page.locator('input[autocomplete=new-password]').first().fill('matkhau-moi-1');
  await page.locator('input[autocomplete=new-password]').nth(1).fill('khac-nhau-hoan-toan');
  await page.click('button.primary');
  await page.waitForSelector('text=chưa giống nhau');
  await page.locator('input[autocomplete=new-password]').nth(1).fill('matkhau-moi-1');
  await page.click('button.primary');

  // Bước 1: chưa có shop nào → tạo shop đầu tiên
  await page.waitForSelector('text=Tạo shop đầu tiên');
  assert.equal(await page.locator('.sidebar').count(), 0, 'chưa có shop thì chưa có thanh điều hướng của ứng dụng');
  await page.fill('input[placeholder^="vd:"]', 'Cửa hàng Mới');
  assert.equal(await page.locator('label:has-text("Mã shop") input').inputValue(), 'CHM', 'mã shop gợi ý từ tên');
  await page.locator('input[name=industry][value=nuoc_hoa]').check();
  await page.click('button:has-text("Tạo shop và tiếp tục")');

  // Bước 2: kho đầu tiên
  await page.waitForSelector('text=Bước 2/3 · Tạo kho đầu tiên');
  await page.click('.modal button:has-text("Tạo kho")');

  // Bước 3: sản phẩm đầu tiên (có tồn đầu → bắt buộc giá nhập)
  await page.waitForSelector('text=Bước 3/3 · Tạo sản phẩm đầu tiên');
  await page.locator('.modal label:has-text("Tên sản phẩm") input').fill('Nước hoa Mẫu');
  await page.locator('.modal label:has-text("Giá bán") input').fill('500000');
  await page.locator('.modal label:has-text("Số lượng đang có") input').fill('5');
  assert.ok(await page.locator('.modal button:has-text("Tạo sản phẩm")').isDisabled(), 'có tồn mà thiếu giá nhập thì chưa cho tạo');
  await page.locator('.modal label:has-text("Giá nhập") input').fill('300000');
  await page.click('.modal button:has-text("Tạo sản phẩm")');
  await page.waitForSelector('text=Sẵn sàng bán hàng');
  await page.keyboard.press('Escape');

  await page.waitForSelector('.sidebar');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'nuochoa', 'giao diện theo ngành đã chọn');
  assert.equal(await page.locator('text=Hoàn tất thiết lập').count(), 0, 'đã xong thì không còn thẻ nhắc thiết lập');
  const mine = await page.evaluate(async () => ({
    shops: (await (await fetch('/api/v1/shops')).json()).data.map((s) => s.name),
    products: (await (await fetch('/api/v1/products')).json()).data.map((p) => p.name),
    stock: (await (await fetch('/api/v1/stock')).json()).data.map((r) => [r.sku, r.on_hand]),
  }));
  assert.deepEqual(mine.shops, ['Cửa hàng Mới'], 'không thấy shop của tài khoản khác');
  assert.deepEqual(mine.products, ['Nước hoa Mẫu']);
  assert.equal(mine.stock[0][1], 5, 'tồn đầu đã ghi');

  // Đăng xuất rồi vào tài khoản admin: chỉ thấy dữ liệu của admin
  await page.click('.sidebar button[title="Đăng xuất"]');
  await page.waitForSelector('input[autocomplete=username]');
  await page.fill('input[autocomplete=username]', 'admin');
  await page.fill('input[type=password]', 'matkhau123');
  await page.click('button.primary');
  await page.waitForSelector('.topbar');
  const admin = await page.evaluate(async () => (await (await fetch('/api/v1/shops')).json()).data.map((s) => s.name));
  assert.deepEqual(admin.sort(), ['Nước hoa', 'Phong thuỷ']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('khách theo shop: gắn nhãn, lọc theo nhãn, xuất file, xoá khỏi shop này không mất ở shop kia; trang Loyalty & Campaign', { skip }, async () => {
  const hung = (await api('POST', '/customers', { name: 'Anh Hùng', phone: '0933000333', shop_id: ids.nh })).data.id;
  await api('POST', `/customers/${hung}/shops`, { shop_id: ids.pt });
  const { page, errors, ctx } = await login();
  await pickShop(page, 'Nước hoa');
  await page.goto(`${base}/customers/${hung}`);
  await page.waitForSelector('text=Nhãn · Nước hoa');
  await page.fill('input[aria-label="Thêm nhãn"]', 'VIP');
  await page.keyboard.press('Enter');
  await page.waitForSelector('section:has-text("Nhãn · Nước hoa") .badge:has-text("VIP")');

  // Danh sách: nhãn hiện thành bộ lọc, lọc đúng
  await page.goto(`${base}/customers`);
  await page.waitForSelector('button.chip:has-text("VIP")');
  await page.click('button.chip:has-text("VIP")');
  await page.waitForFunction(() => document.querySelectorAll('tr.click').length === 1);
  assert.ok(await page.locator('tr.click:has-text("Anh Hùng")').count());

  // Xuất file: hộp thoại báo đúng số khách và cột
  await page.click('button:has-text("Xuất file")');
  await page.waitForSelector('.modal >> text=Xuất 1 khách');
  assert.ok(await page.locator('.modal >> text=Nhãn: VIP').count());
  await page.keyboard.press('Escape');

  // Xoá khỏi shop Nước hoa
  await page.goto(`${base}/customers/${hung}`);
  await page.click('button:has-text("Xoá khỏi Nước hoa")');
  await page.waitForSelector('.modal >> text=Sẽ mất ở Nước hoa');
  await page.locator('.modal button:has-text("Xoá khỏi Nước hoa")').click();
  await page.waitForURL(`${base}/customers`);
  await page.waitForSelector('text=Chị Lan');
  assert.equal(await page.locator('tr.click:has-text("Anh Hùng")').count(), 0, 'đã ra khỏi danh sách shop Nước hoa');

  // Shop Phong thuỷ vẫn còn anh Hùng; nhãn của Nước hoa không lọt sang
  await pickShop(page, 'Phong thuỷ');
  await page.goto(`${base}/customers`);
  await page.waitForSelector('tr.click:has-text("Anh Hùng")');
  assert.equal(await page.locator('button.chip:has-text("VIP")').count(), 0);

  // Loyalty & Campaign: tab mệnh chỉ có ở shop phong thuỷ; /care chuyển hướng
  await page.goto(`${base}/care`);
  await page.waitForURL(`${base}/loyalty`);
  await page.waitForSelector('h1:has-text("Loyalty & Campaign")');
  assert.ok(await page.locator('[role=tab]:has-text("Gợi ý theo mệnh")').count());
  await pickShop(page, 'Nước hoa');
  await page.waitForFunction(() => ![...document.querySelectorAll('[role=tab]')].some((t) => t.textContent.includes('Gợi ý theo mệnh')));
  await page.click('[role=tab]:has-text("Tự động hoá")');
  await page.waitForSelector('text=Chưa có gì chạy tự động');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('tài chính: chi phí trả bằng ngân hàng, quỹ tiền (chuyển quỹ, kiểm đếm), báo cáo chi phí và công nợ, xuất Excel, trang hướng dẫn đọc số liệu', { skip }, async () => {
  await api('POST', '/orders', { shop_id: ids.nh, lines: [{ sku: 'TD-1', qty: 2 }], status: 'completed', payments: [{ amount: 200000, method: 'cash' }] });
  const { page, errors, ctx } = await login();
  await pickShop(page, 'Nước hoa');

  // Thêm chi phí trả bằng chuyển khoản
  await page.goto(`${base}/expenses`);
  await page.click('button:has-text("+ Chi phí")');
  await page.fill('.modal input[type=number]', '70000');
  await page.selectOption('.modal select >> nth=2', 'bank');
  await page.click('.modal button.primary');
  await page.waitForSelector('td:has-text("Chuyển khoản")');

  // Quỹ tiền: số dư trên màn hình khớp số dư API; chuyển quỹ giữ nguyên tổng; kiểm đếm ghi đúng phần chênh
  const fmt = (n) => `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;
  const balances = async () => Object.fromEntries((await api('GET', '/cash/accounts')).data.map((a) => [a.id, a.balance]));
  await page.click('[role=tab]:has-text("Quỹ tiền")');
  await page.waitForSelector('text=Tổng tiền trong các quỹ');
  const b0 = await balances();
  assert.ok(await page.locator('.card:has-text("Tiền mặt")').getByText(fmt(b0.cac_cash), { exact: true }).count(), 'số dư tiền mặt trên màn hình = API');
  await page.click('button:has-text("Chuyển quỹ")');
  await page.locator('.modal input[type=number]').fill('50000');
  await page.click('.modal button.primary');
  await page.waitForSelector('.modal', { state: 'detached' });
  const b1 = await balances();
  assert.equal(b1.cac_cash, b0.cac_cash - 50000, 'chuyển từ quỹ đầu (tiền mặt) sang quỹ thứ hai');
  assert.equal(b1.cac_bank, b0.cac_bank + 50000);
  await page.locator('.card:has-text("Tiền mặt")').getByRole('button', { name: 'Kiểm đếm' }).click();
  const counted = b1.cac_cash - 10000;
  await page.locator('.modal input[type=number]').fill(String(counted));
  await page.waitForSelector('.modal >> text=Chênh thiếu');
  await page.click('.modal button.primary');
  await page.waitForSelector('.modal >> text=Đã ghi điều chỉnh');
  await page.click('.modal button.primary');
  assert.equal((await balances()).cac_cash, counted);

  // Báo cáo chi phí và tiền & công nợ
  await page.goto(`${base}/reports?tab=expenses`);
  await page.waitForSelector('text=Chi phí / doanh thu thuần');
  assert.ok(await page.locator('text=Quảng cáo').count());
  await page.click('[role=tab]:has-text("Tiền & công nợ")');
  await page.waitForSelector('text=Số dư các quỹ');
  assert.ok(await page.locator('text=Khách còn nợ').count());

  // Xuất Excel đúng tab đang xem
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Xuất Excel")')]);
  assert.match(dl.suggestedFilename(), /^bao-cao-cash-\d{8}-\d{8}\.xlsx$/);
  const file = path.join(os.tmpdir(), `moso-rp-${Date.now()}.xlsx`);
  await dl.saveAs(file);
  const XLSX = require(path.resolve('web/node_modules/xlsx'));
  const wb = XLSX.read(fs.readFileSync(file));
  assert.deepEqual(wb.SheetNames, ['Thông tin', 'Dòng tiền', 'Số dư quỹ', 'Tuổi nợ']);
  const quy = XLSX.utils.sheet_to_json(wb.Sheets['Số dư quỹ'], { header: 1 });
  assert.equal(quy[1][0], 'Tiền mặt');
  assert.equal(quy[1][2], counted, 'số dư tiền mặt sau kiểm đếm, là số chứ không phải chữ');
  fs.rmSync(file, { force: true });

  // Cài đặt: thuế mặc định tắt, phân bổ cố định có ô tỷ lệ cho từng shop
  await page.goto(`${base}/settings`);
  await page.click('[role=tab]:has-text("Thuế")');
  await page.waitForSelector('text=không tự điền');
  await page.click('[role=tab]:has-text("Ngưỡng")');
  await page.selectOption('select:has(option[value=fixed])', 'fixed');
  await page.waitForSelector('input[aria-label^="Tỷ lệ"]');

  // Trang hướng dẫn: có trong menu, 5 câu hỏi, từ điển mở được
  await page.goto(base);
  await page.locator('nav a[href="/guide"]').click();
  await page.waitForSelector('h1:has-text("Cách đọc sức khoẻ kinh doanh")');
  for (const q of ['Tiền có đủ không?', 'Bán có lời không?', 'Hàng có bị kẹt hoặc sắp hết không?', 'Khách có quay lại không?', 'Chi phí có đang phình ra không?']) assert.ok(await page.locator(`text=${q}`).count(), q);
  await page.click('summary:has-text("Biên lợi nhuận gộp")');
  await page.waitForSelector('text=/giá bán chưa đủ cao/i');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Đơn mới: tìm và chọn khách có sẵn, đơn gắn đúng customer_id, không sinh hồ sơ trùng', { skip }, async () => {
  const { page, errors, ctx } = await login({ width: 1280, height: 860 });
  await pickShop(page, 'Nước hoa');
  const before = (await api('GET', '/customers?q=Lan')).data.length;
  await page.goto(`${base}/orders/new`);
  await page.fill('input[aria-label="Tìm sản phẩm"]', 'MT-1');
  await page.click('[role=option]:has-text("Móc treo")');
  await page.fill('input[aria-label="Tìm khách hàng"]', 'Lan');
  await page.click('[role=option]:has-text("Chị Lan")');
  await page.waitForSelector('.cust-card:has-text("Chị Lan")');
  await page.click('button:has-text("Bán xong")');
  await page.waitForURL(/\/orders\/ord_/);
  const order = (await api('GET', '/orders?customer_id=' + ids.cust)).data.find((o) => o.status === 'completed');
  assert.ok(order, 'đơn gắn đúng khách đã chọn');
  assert.equal((await api('GET', '/customers?q=Lan')).data.length, before, 'không tạo khách trùng');
  assert.deepEqual(errors, []);
  await ctx.close();
});
