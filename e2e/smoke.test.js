// Smoke test giao diện bằng trình duyệt thật. Chạy: npm run build && npm run test:e2e
// Cần Playwright + Chromium (npm i -D playwright && npx playwright install chromium). Thiếu thì bỏ qua, không làm hỏng `npm test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve } from '@hono/node-server';
import { openDb, setDb } from '../server/db/index.js';
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
  setDb(openDb(':memory:'));
  server = serve({ fetch: createApp().fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await api('POST', '/auth/setup', { username: 'admin', display_name: 'Chủ shop', password: 'matkhau123', shops: [{ name: 'Nước hoa', code: 'NH', industry: 'nuoc_hoa' }, { name: 'Phong thuỷ', code: 'PT', industry: 'phong_thuy' }] });
  await api('POST', '/auth/login', { username: 'admin', password: 'matkhau123' });
  const shops = (await api('GET', '/shops')).data;
  ids.nh = shops.find((s) => s.code === 'NH').id;
  ids.pt = shops.find((s) => s.code === 'PT').id;
  const wh = (await api('GET', '/warehouses')).data[0].id;
  const a = (await api('POST', '/products', { name: 'Tinh dầu', variants: [{ sku: 'TD-1', default_price: 100000 }], shop_ids: [ids.nh] })).data.variants[0];
  const b = (await api('POST', '/products', { name: 'Móc treo', variants: [{ sku: 'MT-1', default_price: 50000 }], shop_ids: [ids.nh] })).data.variants[0];
  await api('POST', '/products', { name: 'Combo', variants: [{ sku: 'CB-1', kind: 'bundle', default_price: 180000, components: [{ variant_id: a.id, qty: 2 }, { variant_id: b.id, qty: 1 }] }], shop_ids: [ids.nh] });
  await api('POST', '/purchases', { warehouse_id: wh, receive: true, lines: [{ variant_id: a.id, qty: 20, unit_cost: 40000 }, { variant_id: b.id, qty: 10, unit_cost: 10000 }] });
  ids.cust = (await api('POST', '/customers', { name: 'Chị Lan', phone: '0922000222' })).data.id;
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

test('chuyển shop đổi giao diện, tính năng và trường khách đúng theo ngành', { skip }, async () => {
  const { page, errors, ctx } = await login();
  await pickShop(page, 'Nước hoa');
  await themeIs(page, 'nuochoa');
  assert.equal(await page.locator('.lunar').count(), 0, 'shop nước hoa không có âm lịch');
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
  await page.waitForSelector('.empty');
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
