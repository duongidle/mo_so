import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, migrate, MIGRATIONS_DIR, setDb } from '../server/db/index.js';
import { getValues } from '../server/modules/custom/service.js';
import { ageOn } from '../server/lib/formula.js';
import { businessDate } from '../server/lib/time.js';

/** DB dựng đến migration 027 (như bản cài hiện tại), chưa chạy 028 */
function dbThrough027() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moso-mig-'));
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) if (f < '028') fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  const conn = openDb(':memory:', dir);
  return { conn, dir };
}

test('Migration 028: gom ngày/năm sinh từ trường các shop về hồ sơ khách, ẩn trường cũ, viết lại công thức, không mất giá trị', () => {
  const { conn, dir } = dbThrough027();
  const q = (sql, ...a) => conn.prepare(sql).run(...a);
  q("INSERT INTO warehouses (id, code, name, created_at, updated_at) VALUES ('w','K','K','x','x')");
  q("INSERT INTO shops (id, code, name, industry, default_warehouse_id, created_at, updated_at) VALUES ('pt','PT','Phong thuỷ','phong_thuy','w','2026-02-01','x'), ('nh','NH','Nước hoa ô tô','nuoc_hoa_o_to','w','2026-01-01','x')");
  const field = (id, shop, key, label, type, extra = {}) =>
    q('INSERT INTO custom_fields (id, entity_type, key, label, type, formula, shop_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', id, 'customer', key, label, type, extra.formula ?? null, shop, extra.role ?? null, 'x', 'x');
  field('pt_ns', 'pt', 'ngay_sinh', 'Ngày sinh', 'date', { role: 'birth_date' });
  field('pt_ny', 'pt', 'nam_sinh', 'Năm sinh', 'number', { role: 'birth_year' });
  field('pt_tuoi', 'pt', 'so_tuoi', 'Số tuổi', 'formula', { formula: 'TODAY() - {custom.ngay_sinh}' });
  field('pt_days', 'pt', 'ngay_song', 'Số ngày đã sống', 'formula', { formula: 'DAYS_BETWEEN({custom.ngay_sinh}, TODAY())' });
  field('pt_tn', 'pt', 'tuoi_nam', 'Tuổi theo năm', 'formula', { formula: 'YEAR(TODAY()) - {custom.nam_sinh}' });
  field('nh_ns', 'nh', 'sinh_nhat', 'Sinh nhật', 'date', { role: 'birth_date' });
  field('nh_tuoi', 'nh', 'tuoi', 'TUỔI', 'formula', { formula: 'TODAY()-{custom.sinh_nhat}' });
  field('nh_khac', 'nh', 'chi_so', 'Chỉ số', 'formula', { formula: 'TODAY() - {custom.sinh_nhat} + 1' });
  field('nh_txt', 'nh', 'dong_xe', 'Dòng xe', 'text');
  const cus = (id, birth_date = null, birth_year = null) =>
    q("INSERT INTO customers (id, code, name, birth_date, birth_year, created_at, updated_at) VALUES (?,?,?,?,?,'x','x')", id, id, id, birth_date, birth_year);
  const val = (cid, fid, text, num = null) => q("INSERT INTO custom_values (entity_type, entity_id, field_id, value_text, value_num) VALUES ('customer',?,?,?,?)", cid, fid, text, num);
  cus('c1'); val('c1', 'pt_ns', '1990-05-10'); val('c1', 'nh_ns', '1990-05-10'); // trùng giá trị
  cus('c2'); val('c2', 'pt_ns', '1985-01-01'); val('c2', 'nh_ns', '1986-02-02'); // lệch: ưu tiên shop phong thuỷ
  cus('c3', '1999-01-01'); val('c3', 'nh_ns', '1999-12-31'); // khác giá trị cũ trên hồ sơ: trường shop thắng
  cus('c4', '1970-07-07'); // chỉ có giá trị cũ trên hồ sơ: giữ nguyên
  cus('c5'); val('c5', 'pt_ns', 'không rõ'); // giá trị không phải ngày: không chép, nhưng không bị xoá
  cus('c6'); val('c6', 'pt_ny', null, 1980); // chỉ có năm sinh
  cus('c7'); val('c7', 'nh_txt', 'Mazda');
  const valuesBefore = conn.prepare('SELECT COUNT(*) AS n FROM custom_values').get().n;

  migrate(conn); // chạy 028

  const bd = (id) => conn.prepare('SELECT birth_date, birth_year FROM customers WHERE id = ?').get(id);
  assert.deepEqual(bd('c1'), { birth_date: '1990-05-10', birth_year: null });
  assert.equal(bd('c2').birth_date, '1985-01-01', 'lệch giá trị: lấy shop phong thuỷ');
  assert.equal(bd('c3').birth_date, '1999-12-31', 'có giá trị từ trường shop thì ghi đè giá trị cũ trên hồ sơ');
  assert.equal(bd('c4').birth_date, '1970-07-07', 'không có giá trị từ shop thì giữ giá trị cũ');
  assert.equal(bd('c5').birth_date, null, 'giá trị không phải ngày không được chép');
  assert.equal(bd('c6').birth_year, 1980);

  // Không xoá giá trị nào
  assert.equal(conn.prepare('SELECT COUNT(*) AS n FROM custom_values').get().n, valuesBefore);
  assert.equal(conn.prepare("SELECT value_text FROM custom_values WHERE entity_id = 'c5'").get().value_text, 'không rõ');

  // Trường cũ bị ẩn, trường khác không
  const archived = conn.prepare("SELECT id FROM custom_fields WHERE archived_at IS NOT NULL ORDER BY id").all().map((r) => r.id);
  assert.deepEqual(archived, ['nh_ns', 'pt_ns', 'pt_ny']);
  assert.ok(conn.prepare("SELECT 1 FROM pragma_table_info('custom_fields') WHERE name = 'default_value'").get(), 'có cột default_value');

  // Công thức viết lại
  const f = Object.fromEntries(conn.prepare("SELECT id, formula FROM custom_fields WHERE type = 'formula'").all().map((r) => [r.id, r.formula]));
  assert.equal(f.pt_tuoi, 'AGE({birth_date})', 'Số tuổi = TODAY() - ngày sinh → AGE');
  assert.equal(f.nh_tuoi, 'AGE({birth_date})', 'khoảng trắng và hoa/thường của nhãn không ảnh hưởng');
  assert.equal(f.pt_days, 'DAYS_BETWEEN({birth_date}, TODAY())');
  assert.equal(f.pt_tn, 'YEAR(TODAY()) - {birth_year}');
  assert.equal(f.nh_khac, 'TODAY() - {birth_date} + 1', 'công thức không phải tuổi chỉ đổi biến, giữ nguyên phần còn lại');

  // Audit: ca lệch + công thức đã viết lại
  const conflicts = conn.prepare("SELECT entity_id, before, after FROM audit_log WHERE action = 'customer.birth_date_conflict' ORDER BY entity_id").all();
  assert.deepEqual(conflicts.map((r) => r.entity_id), ['c2', 'c3']);
  const c2 = JSON.parse(conflicts[0].before);
  assert.deepEqual(c2.shops.map((s) => s.value).sort(), ['1985-01-01', '1986-02-02']);
  assert.equal(JSON.parse(conflicts[0].after).birth_date, '1985-01-01');
  assert.equal(JSON.parse(conflicts[1].before).profile, '1999-01-01', 'giá trị cũ bị ghi đè được lưu lại');
  const rewritten = conn.prepare("SELECT entity_id, before, after FROM audit_log WHERE action = 'custom_field.formula_rewritten' ORDER BY entity_id").all();
  assert.deepEqual(rewritten.map((r) => r.entity_id), ['nh_khac', 'nh_tuoi', 'pt_days', 'pt_tn', 'pt_tuoi']);
  assert.equal(JSON.parse(rewritten.find((r) => r.entity_id === 'pt_tuoi').before).formula, 'TODAY() - {custom.ngay_sinh}');

  // Công thức sau migration chạy đúng trên dữ liệu thật
  setDb(conn);
  const today = businessDate();
  assert.equal(getValues('customer', 'c1', { shopId: 'pt' }).so_tuoi, ageOn('1990-05-10', today));
  assert.equal(getValues('customer', 'c4', { shopId: 'nh' }).tuoi, ageOn('1970-07-07', today), 'ngày sinh chung dùng được ở mọi shop');
  assert.equal(getValues('customer', 'c6', { shopId: 'pt' }).tuoi_nam, Number(today.slice(0, 4)) - 1980);
  assert.equal(getValues('customer', 'c5', { shopId: 'pt' }).so_tuoi, null, 'khách chưa có ngày sinh hợp lệ');
  conn.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
