import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parse, refsOf, evaluate, FormulaError } from '../../lib/formula.js';
import { ROLES } from '../../lib/industries.js';

const db = () => getDb();
const TABLES = { product: 'products', customer: 'customers', order: 'orders', purchase: 'purchases' };
export const ENTITY_TYPES = Object.keys(TABLES);
export const FIELD_TYPES = ['text', 'number', 'money', 'date', 'select', 'multiselect', 'boolean', 'formula'];

const columnsOf = (entityType) => db().prepare(`PRAGMA table_info(${TABLES[entityType]})`).all().map((c) => c.name);
const shape = (f) => f && { ...f, options: f.options ? JSON.parse(f.options) : null, show_in_list: !!f.show_in_list };
export const MAX_LIST_COLUMNS = 4;

/** Mỗi shop hiện tối đa vài cột trường khách ở danh sách khách: nhiều hơn thì bảng vỡ trên máy tính và vô dụng trên điện thoại */
function assertColumnRoom(shopId, exceptId) {
  const n = db().prepare("SELECT COUNT(*) AS n FROM custom_fields WHERE entity_type = 'customer' AND shop_id = ? AND show_in_list = 1 AND archived_at IS NULL AND id IS NOT ?").get(shopId, exceptId ?? null).n;
  if (n >= MAX_LIST_COLUMNS) throw badRequest('TOO_MANY_COLUMNS', `Mỗi shop hiện tối đa ${MAX_LIST_COLUMNS} cột thông tin khách ở danh sách. Bỏ bớt một cột trước.`);
}

export function listFields(entityType, { shopId } = {}) {
  // Trường của khách chỉ tồn tại trong phạm vi một shop: không có shop thì không có trường nào
  if (entityType === 'customer') {
    if (!shopId) return [];
    return db()
      .prepare(`SELECT * FROM custom_fields WHERE archived_at IS NULL AND entity_type = 'customer' AND shop_id = ? ORDER BY sort_order, created_at`)
      .all(shopId)
      .map(shape);
  }
  const rows = db()
    .prepare(`SELECT * FROM custom_fields WHERE archived_at IS NULL ${entityType ? 'AND entity_type = ?' : "AND entity_type != 'customer'"} ORDER BY entity_type, sort_order, created_at`)
    .all(...(entityType ? [entityType] : []));
  // Trường riêng của shop khác không hiện khi đang làm việc ở shop này
  return rows.filter((f) => !shopId || !f.shop_id || f.shop_id === shopId).map(shape);
}

function parseFormula(entityType, key, formula, shopId = null) {
  let tree;
  try {
    tree = parse(formula);
  } catch (e) {
    if (e instanceof FormulaError) throw badRequest('INVALID_FORMULA', `Công thức sai: ${e.message}`);
    throw e;
  }
  const cols = new Set(columnsOf(entityType));
  const customs = new Map(listFields(entityType, { shopId }).map((f) => [f.key, f]));
  for (const ref of refsOf(tree)) {
    if (ref.startsWith('custom.')) {
      if (!customs.has(ref.slice(7)) && ref.slice(7) !== key) throw badRequest('INVALID_FORMULA', `Không có trường tuỳ chỉnh ${ref}`);
    } else if (!cols.has(ref)) throw badRequest('INVALID_FORMULA', `Không có trường {${ref}} trong ${entityType}`);
  }
  // Chống vòng lặp: A dùng B, B dùng A
  const seen = new Set();
  const visit = (k) => {
    if (k === key && seen.size) throw badRequest('FORMULA_CYCLE', 'Công thức tham chiếu vòng tròn');
    if (seen.has(k)) return;
    seen.add(k);
    const f = customs.get(k);
    if (f?.type === 'formula') for (const ref of refsOf(parse(f.formula))) if (ref.startsWith('custom.')) visit(ref.slice(7));
  };
  for (const ref of refsOf(tree)) if (ref.startsWith('custom.')) { seen.clear(); if (ref.slice(7) === key) throw badRequest('FORMULA_CYCLE', 'Công thức tự tham chiếu chính nó'); visit(ref.slice(7)); }
  return tree;
}

/** Trường mới nằm cuối danh sách của cùng đối tượng (và cùng shop) */
function nextSortOrder(entityType, shopId) {
  return db().prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM custom_fields WHERE entity_type = ? AND shop_id IS ? AND archived_at IS NULL').get(entityType, shopId).n;
}

export function createField(input) {
  if (input.entity_type === 'customer') {
    if (!input.shop_id) throw badRequest('SHOP_REQUIRED', 'Trường thông tin khách phải thuộc một shop');
    if (!db().prepare('SELECT 1 FROM shops WHERE id = ?').get(input.shop_id)) throw notFound('Shop');
  }
  if (input.show_in_list) {
    if (input.entity_type !== 'customer') throw badRequest('NOT_CUSTOMER', 'Chỉ trường thông tin khách mới hiện thành cột ở danh sách khách');
    assertColumnRoom(input.shop_id);
  }
  if (input.role && !ROLES.includes(input.role)) throw badRequest('INVALID_ROLE', `Vai trò không hợp lệ: ${input.role}`);
  if (input.type === 'formula') {
    if (!input.formula) throw badRequest('FORMULA_REQUIRED', 'Trường công thức cần có công thức');
    parseFormula(input.entity_type, input.key, input.formula, input.shop_id ?? null);
  }
  if (['select', 'multiselect'].includes(input.type) && !input.options?.length) throw badRequest('OPTIONS_REQUIRED', 'Trường chọn cần có danh sách lựa chọn');
  if (columnsOf(input.entity_type).includes(input.key)) throw badRequest('KEY_RESERVED', `"${input.key}" trùng tên cột có sẵn`);
  const id = newId('cf');
  const at = nowIso();
  db()
    .prepare(
      `INSERT INTO custom_fields (id, entity_type, key, label, type, options, formula, shop_id, sort_order, role, show_in_list, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, input.entity_type, input.key, input.label, input.type, input.options ? JSON.stringify(input.options) : null, input.type === 'formula' ? input.formula : null, input.shop_id ?? null, input.sort_order ?? nextSortOrder(input.entity_type, input.shop_id ?? null), input.role ?? null, input.show_in_list ? 1 : 0, at, at);
  return shape(db().prepare('SELECT * FROM custom_fields WHERE id = ?').get(id));
}

/** Không đổi kiểu và khoá sau khi tạo (giá trị đã lưu sẽ mất nghĩa). Đổi nhãn, lựa chọn, công thức, ẩn thì được. */
export function updateField(id, patch) {
  const f = db().prepare('SELECT * FROM custom_fields WHERE id = ?').get(id);
  if (!f) throw notFound('Trường tuỳ chỉnh');
  const formula = patch.formula ?? f.formula;
  if (f.type === 'formula' && patch.formula) parseFormula(f.entity_type, f.key, formula, f.shop_id);
  if (patch.show_in_list !== undefined && patch.show_in_list && !f.show_in_list) {
    if (f.entity_type !== 'customer') throw badRequest('NOT_CUSTOMER', 'Chỉ trường thông tin khách mới hiện thành cột ở danh sách khách');
    assertColumnRoom(f.shop_id, f.id);
  }
  db()
    .prepare('UPDATE custom_fields SET label=?, options=?, formula=?, sort_order=?, archived_at=?, show_in_list=?, updated_at=? WHERE id=?')
    .run(
      patch.label ?? f.label,
      patch.options ? JSON.stringify(patch.options) : f.options,
      formula,
      patch.sort_order ?? f.sort_order,
      patch.archived === undefined ? f.archived_at : patch.archived ? nowIso() : null,
      patch.show_in_list === undefined ? f.show_in_list : patch.show_in_list ? 1 : 0,
      nowIso(),
      id,
    );
  return shape(db().prepare('SELECT * FROM custom_fields WHERE id = ?').get(id));
}

function coerce(field, raw) {
  if (raw === null || raw === '' || raw === undefined) return { text: null, num: null };
  switch (field.type) {
    case 'number': case 'money': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw badRequest('INVALID_VALUE', `"${field.label}" phải là số`);
      if (field.type === 'money' && !Number.isInteger(n)) throw badRequest('INVALID_VALUE', `"${field.label}" là tiền, phải là số nguyên đồng`);
      return { text: null, num: n };
    }
    case 'boolean': return { text: null, num: raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0 };
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw badRequest('INVALID_VALUE', `"${field.label}" phải có dạng YYYY-MM-DD`);
      return { text: raw, num: null };
    case 'select':
      if (!field.options.includes(raw)) throw badRequest('INVALID_VALUE', `"${field.label}": "${raw}" không nằm trong danh sách lựa chọn`);
      return { text: raw, num: null };
    case 'multiselect': {
      const arr = Array.isArray(raw) ? raw : [raw];
      const opts = field.options;
      const bad = arr.find((v) => !opts.includes(v));
      if (bad) throw badRequest('INVALID_VALUE', `"${field.label}": "${bad}" không nằm trong danh sách lựa chọn`);
      return { text: JSON.stringify(arr), num: null };
    }
    case 'formula': throw badRequest('FORMULA_READONLY', `"${field.label}" là trường công thức, không nhập tay`);
    default: return { text: String(raw), num: null };
  }
}

function entityRow(entityType, id) {
  const row = db().prepare(`SELECT * FROM ${TABLES[entityType]} WHERE id = ?`).get(id);
  if (!row) throw notFound('Bản ghi');
  return row;
}

/** values: { key: giá trị }. Giá trị null xoá giá trị đã lưu. Khoá không tồn tại → báo lỗi, không bỏ qua im lặng. */
function needShop(entityType, shopId) {
  if (entityType === 'customer' && !shopId) throw badRequest('SHOP_REQUIRED', 'Thông tin khách là của từng shop: cần chỉ rõ shop_id');
}

export function setValues(entityType, entityId, values, { shopId = null } = {}) {
  needShop(entityType, shopId);
  entityRow(entityType, entityId);
  const fields = new Map(listFields(entityType, { shopId }).map((f) => [f.key, f]));
  const up = db().prepare('INSERT INTO custom_values (entity_type, entity_id, field_id, value_text, value_num) VALUES (?,?,?,?,?) ON CONFLICT DO UPDATE SET value_text = excluded.value_text, value_num = excluded.value_num');
  const del = db().prepare('DELETE FROM custom_values WHERE entity_type = ? AND entity_id = ? AND field_id = ?');
  for (const [key, raw] of Object.entries(values)) {
    const f = fields.get(key);
    if (!f) throw badRequest('UNKNOWN_FIELD', `Không có trường tuỳ chỉnh "${key}"${entityType === 'customer' ? ' trong shop này' : ''}`);
    const v = coerce(f, raw);
    if (v.text === null && v.num === null) del.run(entityType, entityId, f.id);
    else up.run(entityType, entityId, f.id, v.text, v.num);
  }
  if (entityType === 'customer') {
    // Có thông tin riêng ở shop nào thì là khách của shop đó (nếu từng bị xoá khỏi shop thì quay lại)
    db().prepare('INSERT INTO customer_shops (customer_id, shop_id, added_at) VALUES (?,?,?) ON CONFLICT(customer_id, shop_id) DO UPDATE SET removed_at = NULL')
      .run(entityId, shopId, new Date().toISOString());
    db().prepare('UPDATE customers SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL AND merged_into IS NULL').run(entityId);
  }
  return getValues(entityType, entityId, { shopId });
}

function rawValues(entityType, entityId, shopId) {
  const out = {};
  // Khách: chỉ lấy giá trị của các trường thuộc shop đang xem, để giá trị của shop khác không lọt sang
  const scoped = entityType === 'customer';
  const rows = db()
    .prepare(`SELECT f.key, f.type, v.value_text, v.value_num FROM custom_values v JOIN custom_fields f ON f.id = v.field_id
              WHERE v.entity_type = ? AND v.entity_id = ? AND f.archived_at IS NULL ${scoped ? 'AND f.shop_id = ?' : ''}`)
    .all(...(scoped ? [entityType, entityId, shopId] : [entityType, entityId]));
  for (const r of rows) {
    out[r.key] = r.type === 'boolean' ? r.value_num === 1 : r.value_num !== null ? r.value_num : r.type === 'multiselect' ? JSON.parse(r.value_text) : r.value_text;
  }
  return out;
}

/** Giá trị nhập tay + giá trị công thức đã tính cho bản ghi. Với khách: chỉ của shop `shopId`. */
export function getValues(entityType, entityId, { shopId = null } = {}) {
  needShop(entityType, shopId);
  const row = entityRow(entityType, entityId);
  const stored = rawValues(entityType, entityId, shopId);
  const fields = listFields(entityType, { shopId });
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const cache = new Map();
  const lookup = (name) => {
    if (!name.startsWith('custom.')) return row[name];
    const key = name.slice(7);
    const f = byKey.get(key);
    if (!f) return null;
    if (f.type !== 'formula') {
      const v = stored[key];
      return typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null;
    }
    if (!cache.has(key)) cache.set(key, null), cache.set(key, evaluate(parse(f.formula), lookup));
    return cache.get(key);
  };
  const out = { ...stored };
  for (const f of fields) if (f.type === 'formula') out[f.key] = lookup(`custom.${f.key}`);
  return out;
}

/**
 * Giá trị theo vai trò (ngày sinh, năm sinh, mệnh ghi đè) của khách trong MỘT shop.
 * Trả Map(customerId → { birth_date, birth_year, element }). ids rỗng/undefined = mọi khách có giá trị.
 */
export function roleValues(shopId, ids) {
  const rows = db()
    .prepare(`SELECT v.entity_id AS id, f.role, v.value_text, v.value_num FROM custom_values v JOIN custom_fields f ON f.id = v.field_id
              WHERE v.entity_type = 'customer' AND f.shop_id = ? AND f.role IS NOT NULL AND f.archived_at IS NULL
              ${ids?.length ? `AND v.entity_id IN (${ids.map(() => '?').join(',')})` : ''}`)
    .all(shopId, ...(ids || []));
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.id)) out.set(r.id, {});
    out.get(r.id)[r.role] = r.role === 'birth_year' ? r.value_num : r.value_text;
  }
  return out;
}

// ---------- Chỉ số báo cáo tuỳ chỉnh ----------
export function listMetrics() {
  return db().prepare('SELECT * FROM report_metrics WHERE archived_at IS NULL ORDER BY created_at').all();
}

export function createMetric(input) {
  try {
    parse(input.formula);
  } catch (e) {
    if (e instanceof FormulaError) throw badRequest('INVALID_FORMULA', `Công thức sai: ${e.message}`);
    throw e;
  }
  const id = newId('met');
  const at = nowIso();
  db().prepare('INSERT INTO report_metrics (id, key, name, formula, format, shop_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, input.key, input.name, input.formula, input.format, input.shop_id ?? null, at, at);
  return db().prepare('SELECT * FROM report_metrics WHERE id = ?').get(id);
}

export function archiveMetric(id) {
  if (!db().prepare('SELECT 1 FROM report_metrics WHERE id = ?').get(id)) throw notFound('Chỉ số');
  db().prepare('UPDATE report_metrics SET archived_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
}

/** Tính các chỉ số tuỳ chỉnh trên số liệu tổng hợp (overview.current) của bộ lọc hiện tại */
export function evaluateMetrics(summary, shopIds) {
  return listMetrics()
    .filter((m) => !m.shop_id || !shopIds || shopIds.includes(m.shop_id))
    .map((m) => {
      let value = null;
      let error = null;
      try {
        value = evaluate(parse(m.formula), (n) => summary[n]);
      } catch (e) {
        error = e.message;
      }
      return { id: m.id, key: m.key, name: m.name, format: m.format, value, error };
    });
}

/**
 * Giá trị của các trường "hiện ở danh sách" cho một lô khách trong một shop.
 * Trả { columns: [trường], values: Map(customerId → { key: giá trị }) }.
 */
export function listColumnValues(shopId, customerIds) {
  const columns = db()
    .prepare(`SELECT * FROM custom_fields WHERE entity_type = 'customer' AND shop_id = ? AND show_in_list = 1 AND archived_at IS NULL AND type != 'formula' ORDER BY sort_order, created_at`)
    .all(shopId)
    .map(shape);
  const values = new Map();
  if (!columns.length || !customerIds.length) return { columns, values };
  const byId = new Map(columns.map((c) => [c.id, c]));
  const rows = db()
    .prepare(`SELECT entity_id, field_id, value_text, value_num FROM custom_values WHERE entity_type = 'customer' AND field_id IN (${columns.map(() => '?').join(',')}) AND entity_id IN (${customerIds.map(() => '?').join(',')})`)
    .all(...columns.map((c) => c.id), ...customerIds);
  for (const r of rows) {
    const f = byId.get(r.field_id);
    if (!values.has(r.entity_id)) values.set(r.entity_id, {});
    values.get(r.entity_id)[f.key] = f.type === 'boolean' ? r.value_num === 1 : r.value_num !== null ? r.value_num : f.type === 'multiselect' ? JSON.parse(r.value_text) : r.value_text;
  }
  return { columns, values };
}
