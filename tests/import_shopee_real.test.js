// Chạy trên FILE SHOPEE THẬT (example/…xlsx, chỉ đọc). Bỏ qua nếu file không có. Không in thông tin khách.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setup } from './helpers.js';
import { normalizeStatus } from '../server/modules/imports/service.js';
import { rowsToOrders, missingColumns } from '../web/src/lib/importRows.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'example', 'Order.all.order_creation_date.20261110_20261110.xlsx');
const XLSX = createRequire(path.join(path.dirname(FILE), '..', 'web', 'package.json'))('xlsx');

test('File Shopee thật: mẫu imp_shopee mới đọc đúng giá, trạng thái, phí, trả hàng, không nhận ship người mua trả', { skip: !fs.existsSync(FILE) && 'không có file mẫu' }, async () => {
  const { api } = await setup();
  const profile = (await api.get('/imports/profiles')).body.data.find((p) => p.id === 'imp_shopee');
  const wb = XLSX.read(fs.readFileSync(FILE));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '', dateNF: 'yyyy-mm-dd hh:mm:ss' }); // đúng tuỳ chọn Import.jsx
  const columns = Object.keys(rows[0]);

  assert.deepEqual(missingColumns(columns, profile.column_map, profile.options), [], 'không cột nào bị báo thiếu sai');

  const { orders, errors } = rowsToOrders(rows, profile.column_map);
  assert.deepEqual(errors, []);
  assert.equal(orders.length, 1285);
  assert.equal(orders[0].lines[0].unit_price, 18000);

  const status = (o) => normalizeStatus(o.status, profile.status_map);
  assert.ok(orders.every((o) => status(o)), 'mọi trạng thái trong file đều được nhận ra');
  const received = orders.filter((o) => o.status.startsWith('Người mua xác nhận'));
  assert.equal(received.length, 44);
  assert.ok(received.every((o) => status(o) === 'completed'));

  const fee = orders.filter((o) => status(o) !== 'cancelled').reduce((a, o) => a + o.platform_fee_amount, 0);
  assert.equal(fee, 33643613);

  const withReturn = orders.filter((o) => o.lines.some((l) => l.return_status === 'Đã Chấp Thuận Yêu Cầu' && l.returned_qty > 0));
  assert.equal(withReturn.length, 2);

  assert.ok(orders.every((o) => o.shipping_fee === 0), 'ship người mua trả không vào đơn');
  assert.ok(orders.every((o) => o.discount_amount >= 0));
});
