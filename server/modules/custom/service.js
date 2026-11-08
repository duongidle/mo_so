import { getDb } from '../../db/index.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { parse, refsOf, refList, evaluate, evaluateExplain, inferType, ageOn, FormulaError } from '../../lib/formula.js';
import { ROLES, hasFeature } from '../../lib/industries.js';
import { elementOfBirth } from '../../lib/lunar.js';
import { businessDate } from '../../lib/time.js';
import { audit, emit } from '../../lib/events.js';
import { REPORT_VARIABLES, overview } from '../reports/service.js';
import { columnVariables, isShopDerived, shopDerivedValues } from './variables.js';

const db = () => getDb();
const TABLES = { product: 'products', customer: 'customers', order: 'orders', purchase: 'purchases' };
export const ENTITY_TYPES = Object.keys(TABLES);
export const FIELD_TYPES = ['text', 'number', 'money', 'date', 'select', 'multiselect', 'boolean', 'formula'];

const ENTITY_LABEL = { product: 'sản phẩm', customer: 'khách hàng', order: 'đơn hàng', purchase: 'phiếu nhập' };
const columnsOf = (entityType) => db().prepare(`PRAGMA table_info(${TABLES[entityType]})`).all().map((c) => c.name);
const shape = (f) => f && { ...f, options: f.options ? JSON.parse(f.options) : null, default_value: f.default_value == null ? null : JSON.parse(f.default_value), show_in_list: !!f.show_in_list, required: !!f.required };

/** Vai trò nào dùng được ở đối tượng nào (mệnh ghi đè của khách, ngũ hành của sản phẩm). Ngày/năm sinh nay là thông tin chung của khách, không còn vai trò. */
export const ROLE_ENTITIES = { element: ['customer', 'product'] };
const RETIRED_ROLES = ['birth_date', 'birth_year'];
const ROLE_TYPES = {};

const shopHasFengShui = (shopId) => {
  if (!shopId) return false;
  const s = db().prepare('SELECT industry FROM shops WHERE id = ?').get(shopId);
  return !!s && hasFeature(s.industry, 'feng_shui');
};
export const MAX_LIST_COLUMNS = 4;

/** Mỗi shop hiện tối đa vài cột trường khách ở danh sách khách: nhiều hơn thì bảng vỡ trên máy tính và vô dụng trên điện thoại */
function assertColumnRoom(shopId, exceptId) {
  const n = db().prepare("SELECT COUNT(*) AS n FROM custom_fields WHERE entity_type = 'customer' AND shop_id = ? AND show_in_list = 1 AND archived_at IS NULL AND id IS NOT ?").get(shopId, exceptId ?? null).n;
  if (n >= MAX_LIST_COLUMNS) throw badRequest('TOO_MANY_COLUMNS', `Mỗi shop hiện tối đa ${MAX_LIST_COLUMNS} cột thông tin khách ở danh sách. Bỏ bớt một cột trước.`);
}

export function listFields(entityType, { shopId, archived = false } = {}) {
  const live = archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL';
  // Trường của khách chỉ tồn tại trong phạm vi một shop: không có shop thì không có trường nào
  if (entityType === 'customer') {
    if (!shopId) return [];
    return db()
      .prepare(`SELECT * FROM custom_fields WHERE ${live} AND entity_type = 'customer' AND shop_id = ? ORDER BY sort_order, created_at`)
      .all(shopId)
      .map(shape);
  }
  const rows = db()
    .prepare(`SELECT * FROM custom_fields WHERE ${live} ${entityType ? 'AND entity_type = ?' : "AND entity_type != 'customer'"} ORDER BY entity_type, sort_order, created_at`)
    .all(...(entityType ? [entityType] : []));
  // Trường riêng của shop khác không hiện khi đang làm việc ở shop này
  return rows.filter((f) => !shopId || !f.shop_id || f.shop_id === shopId).map(shape);
}

/** Lỗi công thức kèm vị trí ký tự sai (để giao diện tô đúng chỗ) */
function formulaError(message, position = null) {
  const e = badRequest('INVALID_FORMULA', message);
  e.details = { ...(e.details || {}), position };
  return e;
}

export function parseOrThrow(formula) {
  try {
    return parse(formula);
  } catch (e) {
    if (e instanceof FormulaError) throw formulaError(`Công thức sai: ${e.message}`, e.position);
    throw e;
  }
}

/**
 * Kiểm tra công thức cho trường: chỉ nhận biến trong danh mục (variables.js) và trường tuỳ chỉnh của cùng đối tượng/shop.
 * Chỉ chạy khi tạo/sửa; công thức đã lưu trước đây dùng cột ngoài danh mục vẫn đọc được.
 */
const KIND = { money: 'number', number: 'number', percent: 'number', boolean: 'number', date: 'date', text: 'text', select: 'text', multiselect: 'text' };

function parseFormula(entityType, key, formula, shopId = null) {
  const tree = parseOrThrow(formula);
  const colVars = columnVariables(entityType, { menh: entityType === 'customer' && shopHasFengShui(shopId) });
  const cols = new Set(colVars.map((v) => v.key));
  const customs = new Map(listFields(entityType, { shopId }).map((f) => [f.key, f]));
  for (const { name: ref, pos } of refList(tree)) {
    if (ref.startsWith('custom.')) {
      if (!customs.has(ref.slice(7)) && ref.slice(7) !== key) throw formulaError(`Không có trường tuỳ chỉnh {${ref}}${entityType === 'customer' ? ' trong shop này' : ''}`, pos);
    } else if (!cols.has(ref)) throw formulaError(`Biến {${ref}} không dùng được trong công thức của ${ENTITY_LABEL[entityType]}`, pos);
  }
  // Kiểu: chặn phép sai (chữ − số, ngày × số...) ngay lúc lưu, kèm gợi ý cách đúng
  const colType = new Map(colVars.map((v) => [v.key, KIND[v.type]]));
  try {
    inferType(tree, (name) => (name.startsWith('custom.') ? (customs.get(name.slice(7))?.type === 'formula' ? undefined : KIND[customs.get(name.slice(7))?.type]) : colType.get(name)));
  } catch (e) {
    if (e instanceof FormulaError) throw formulaError(`Công thức sai: ${e.message}`, e.position);
    throw e;
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

/** Vai trò: đúng đối tượng, đúng kiểu, mỗi vai trò chỉ một trường trong cùng phạm vi (shop) */
function assertRole(role, { entity_type, type, shop_id }, exceptId = null) {
  if (!role) return;
  if (RETIRED_ROLES.includes(role)) throw badRequest('ROLE_RETIRED', 'Ngày sinh và năm sinh nay là thông tin chung của khách (nhập ở hồ sơ khách), không cần trường riêng của shop');
  if (!ROLES.includes(role)) throw badRequest('INVALID_ROLE', `Vai trò không hợp lệ: ${role}`);
  if (!ROLE_ENTITIES[role].includes(entity_type)) throw badRequest('ROLE_NOT_ALLOWED', `Vai trò "${role}" không dùng cho ${ENTITY_LABEL[entity_type]}`);
  if (ROLE_TYPES[role] && !ROLE_TYPES[role].includes(type)) throw badRequest('ROLE_TYPE', `Vai trò "${role}" cần trường kiểu ${ROLE_TYPES[role].join('/')}`);
  const clash = db().prepare('SELECT label FROM custom_fields WHERE entity_type = ? AND role = ? AND shop_id IS ? AND archived_at IS NULL AND id IS NOT ?').get(entity_type, role, shop_id ?? null, exceptId);
  if (clash) throw conflict('DUPLICATE_ROLE', `Vai trò "${role}" đã gán cho trường "${clash.label}"`);
}

/** Giá trị mặc định: kiểm theo kiểu trường (cùng luật với nhập tay), lưu dạng JSON. Trường công thức không có mặc định. */
function encodeDefault(f, value = f.default_value) {
  if (value === undefined || value === null || value === '') return null;
  if (f.type === 'formula') throw badRequest('DEFAULT_FORMULA', 'Trường công thức tự tính nên không có giá trị mặc định');
  const v = coerce({ ...f, options: f.options ?? [] }, value);
  const out = f.type === 'multiselect' ? JSON.parse(v.text) : f.type === 'boolean' ? v.num === 1 : v.num ?? v.text;
  return JSON.stringify(out);
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
  if (input.entity_type !== 'customer') {
    // Khoá trường sản phẩm/đơn/phiếu: duy nhất trong phạm vi shop, và trường riêng của shop không được trùng khoá với trường toàn hệ thống
    const clash = db().prepare(`SELECT 1 FROM custom_fields WHERE entity_type = ? AND key = ? AND archived_at IS NULL AND (shop_id IS ? OR shop_id IS NULL OR ? IS NULL)`).get(input.entity_type, input.key, input.shop_id ?? null, input.shop_id ?? null);
    if (clash) throw conflict('DUPLICATE_KEY', `Khoá "${input.key}" đã được dùng`);
  }
  assertRole(input.role, input);
  if (input.required && input.type === 'formula') throw badRequest('REQUIRED_FORMULA', 'Trường công thức tự tính nên không đặt bắt buộc được');
  if (input.type === 'formula') {
    if (!input.formula) throw badRequest('FORMULA_REQUIRED', 'Trường công thức cần có công thức');
    parseFormula(input.entity_type, input.key, input.formula, input.shop_id ?? null);
  }
  if (['select', 'multiselect'].includes(input.type) && !input.options?.length) throw badRequest('OPTIONS_REQUIRED', 'Trường chọn cần có danh sách lựa chọn');
  if (columnsOf(input.entity_type).includes(input.key)) throw badRequest('KEY_RESERVED', `"${input.key}" trùng tên cột có sẵn`);
  const defaultJson = encodeDefault(input);
  const id = newId('cf');
  const at = nowIso();
  db()
    .prepare(
      `INSERT INTO custom_fields (id, entity_type, key, label, type, options, formula, shop_id, sort_order, role, show_in_list, required, default_value, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, input.entity_type, input.key, input.label, input.type, input.options ? JSON.stringify(input.options) : null, input.type === 'formula' ? input.formula : null, input.shop_id ?? null, input.sort_order ?? nextSortOrder(input.entity_type, input.shop_id ?? null), input.role ?? null, input.show_in_list ? 1 : 0, input.required ? 1 : 0, defaultJson, at, at);
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
  const role = patch.role === undefined ? f.role : patch.role;
  const unhiding = patch.archived === false && !!f.archived_at;
  if (patch.role !== undefined || unhiding) assertRole(role, f, f.id);
  if (unhiding) {
    // Trong lúc bị ẩn, khoá/vai trò có thể đã được trường khác dùng: kiểm lại trước khi hiện
    const sameKey = f.entity_type === 'customer'
      ? db().prepare('SELECT label FROM custom_fields WHERE entity_type = ? AND key = ? AND shop_id IS ? AND archived_at IS NULL AND id != ?').get(f.entity_type, f.key, f.shop_id, f.id)
      : db().prepare('SELECT label FROM custom_fields WHERE entity_type = ? AND key = ? AND archived_at IS NULL AND id != ? AND (shop_id IS ? OR shop_id IS NULL OR ? IS NULL)').get(f.entity_type, f.key, f.id, f.shop_id, f.shop_id);
    if (sameKey) throw conflict('DUPLICATE_KEY', `Không hiện lại được: khoá "${f.key}" đang được trường "${sameKey.label}" dùng. Đổi tên hoặc ẩn trường kia trước`);
    if (f.show_in_list && patch.show_in_list !== false) assertColumnRoom(f.shop_id, f.id);
  }
  const required = patch.required === undefined ? f.required : patch.required ? 1 : 0;
  if (required && f.type === 'formula') throw badRequest('REQUIRED_FORMULA', 'Trường công thức tự tính nên không đặt bắt buộc được');
  if (patch.options && !['select', 'multiselect'].includes(f.type)) throw badRequest('NOT_SELECT', 'Chỉ trường chọn mới có danh sách lựa chọn');
  if (patch.options && !patch.options.length) throw badRequest('OPTIONS_REQUIRED', 'Trường chọn cần có danh sách lựa chọn');
  const opts = patch.options ?? (f.options ? JSON.parse(f.options) : null);
  let defaultJson = patch.default_value === undefined ? f.default_value : encodeDefault({ ...f, options: opts }, patch.default_value);
  // Sửa danh sách lựa chọn làm mặc định cũ không còn nằm trong đó: bỏ mặc định thay vì để form điền một giá trị sai
  if (patch.default_value === undefined && patch.options && defaultJson) {
    const cur = JSON.parse(defaultJson);
    if ([].concat(cur).some((x) => !patch.options.includes(x))) defaultJson = null;
  }
  db()
    .prepare('UPDATE custom_fields SET label=?, options=?, formula=?, sort_order=?, archived_at=?, show_in_list=?, role=?, required=?, default_value=?, updated_at=? WHERE id=?')
    .run(
      patch.label ?? f.label,
      patch.options ? JSON.stringify(patch.options) : f.options,
      formula,
      patch.sort_order ?? f.sort_order,
      patch.archived === undefined ? f.archived_at : patch.archived ? nowIso() : null,
      patch.show_in_list === undefined ? f.show_in_list : patch.show_in_list ? 1 : 0,
      role,
      required,
      defaultJson,
      nowIso(),
      id,
    );
  return shape(db().prepare('SELECT * FROM custom_fields WHERE id = ?').get(id));
}

/** Trường này đang có dữ liệu ở bao nhiêu bản ghi, và công thức nào (chưa ẩn) đang dùng nó. Giao diện dùng để nói rõ trước khi xoá. */
export function fieldUsage(id) {
  const f = db().prepare('SELECT * FROM custom_fields WHERE id = ?').get(id);
  if (!f) throw notFound('Trường tuỳ chỉnh');
  const referencedBy = db()
    .prepare("SELECT id, key, label, formula FROM custom_fields WHERE entity_type = ? AND type = 'formula' AND archived_at IS NULL AND id != ? AND (shop_id IS ? OR shop_id IS NULL OR ? IS NULL)")
    .all(f.entity_type, f.id, f.shop_id, f.shop_id)
    .filter((x) => {
      try { return refsOf(parse(x.formula)).has(`custom.${f.key}`); } catch { return false; }
    })
    .map(({ id: fid, key, label }) => ({ id: fid, key, label }));
  const valuesCount = db().prepare('SELECT COUNT(*) AS n FROM custom_values WHERE field_id = ?').get(f.id).n;
  return { field: f, values_count: valuesCount, referenced_by: referencedBy };
}

/**
 * Xoá hẳn một trường tuỳ chỉnh. Khác "Ẩn" (giữ dữ liệu, hiện lại được), xoá bỏ cả định nghĩa lẫn giá trị:
 *  - đang bị công thức khác dùng → 409 FIELD_REFERENCED;
 *  - chưa có giá trị nào → xoá luôn (dữ liệu nháp chưa phát sinh gì);
 *  - đã có giá trị → cần confirm; toàn bộ định nghĩa + giá trị được chép vào audit_log trước khi xoá để khôi phục tay.
 * Khoá được giải phóng. Bản ghi audit cũng là cách applyIndustry biết trường mẫu đã bị xoá có chủ đích.
 */
export function deleteField(id, { confirm = false } = {}, actor = null) {
  const { field: f, referenced_by: users } = fieldUsage(id);
  if (users.length) {
    throw conflict('FIELD_REFERENCED', `Không xoá được: trường này đang được công thức của ${users.map((x) => `“${x.label}”`).join(', ')} dùng. Sửa hoặc xoá các công thức đó trước (hoặc chọn Ẩn).`, { fields: users });
  }
  const values = db().prepare('SELECT entity_id, value_text, value_num FROM custom_values WHERE field_id = ?').all(f.id);
  if (values.length && !confirm) {
    throw conflict('CONFIRM_REQUIRED', `Trường “${f.label}” đang có dữ liệu ở ${values.length} bản ghi. Xoá sẽ bỏ hết. Gửi confirm: true để xác nhận, hoặc dùng Ẩn để giữ dữ liệu.`, { values_count: values.length });
  }
  audit(actor, 'custom_field.deleted', 'custom_field', f.id, { field: f, values }, null);
  db().prepare('DELETE FROM custom_values WHERE field_id = ?').run(f.id);
  db().prepare('DELETE FROM custom_fields WHERE id = ?').run(f.id);
  emit('custom_field.deleted', { entityType: 'custom_field', entityId: f.id, shopId: f.shop_id, data: { id: f.id, entity_type: f.entity_type, key: f.key, label: f.label, values_removed: values.length } });
  return { deleted: true, values_removed: values.length };
}

/**
 * Điền giá trị mặc định của các trường (không phải công thức) vào MỘT bản ghi MỚI, chỉ cho ô chưa có giá trị.
 * Không bao giờ chạy trên bản ghi cũ; form của bản bản ghi cũ chỉ điền sẵn trên màn hình, người dùng bấm Lưu mới ghi.
 */
export function applyFieldDefaults(entityType, entityId, { shopId = null } = {}) {
  const fields = listFields(entityType, { shopId }).filter((f) => f.default_value !== null && f.type !== 'formula');
  const ins = db().prepare('INSERT OR IGNORE INTO custom_values (entity_type, entity_id, field_id, value_text, value_num) VALUES (?,?,?,?,?)');
  for (const f of fields) {
    const v = coerce(f, f.default_value);
    if (v.text !== null || v.num !== null) ins.run(entityType, entityId, f.id, v.text, v.num);
  }
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
    // Trường bắt buộc chỉ chặn khi yêu cầu này xoá/để trống nó. Bản ghi cũ thiếu giá trị vẫn sửa các ô khác được.
    if (v.text === null && v.num === null && f.required && f.type !== 'formula') {
      throw badRequest('REQUIRED_FIELD', `Cần nhập: ${f.label}`, { fields: [f.key] });
    }
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
  // Sản phẩm/đơn/phiếu: khi biết shop thì chỉ lấy trường toàn hệ thống + trường của shop đó (trường riêng của shop khác có thể trùng khoá)
  const soft = !scoped && !!shopId;
  const rows = db()
    .prepare(`SELECT f.key, f.type, v.value_text, v.value_num FROM custom_values v JOIN custom_fields f ON f.id = v.field_id
              WHERE v.entity_type = ? AND v.entity_id = ? AND f.archived_at IS NULL ${scoped ? 'AND f.shop_id = ?' : soft ? 'AND (f.shop_id IS NULL OR f.shop_id = ?)' : ''}`)
    .all(...(scoped || soft ? [entityType, entityId, shopId] : [entityType, entityId]));
  for (const r of rows) {
    out[r.key] = r.type === 'boolean' ? r.value_num === 1 : r.value_num !== null ? r.value_num : r.type === 'multiselect' ? JSON.parse(r.value_text) : r.value_text;
  }
  return out;
}

/**
 * Giá trị suy ra theo vai trò (chỗ chung để sau này thêm vai trò khác). Hiện có 'element' (mệnh):
 * ghi đè tay nếu có, không thì tự tính từ ngày sinh (chính xác theo âm lịch), không có ngày thì ước tính theo năm sinh.
 * Trả { value, source: 'override' | 'computed' | 'approximate', can_chi, nap_am } hoặc null.
 */
export function derivedValue(role, { birth_date = null, birth_year = null, override = null } = {}) {
  if (role !== 'element') return null;
  if (override) return { value: override, source: 'override', can_chi: null, nap_am: null };
  const el = elementOfBirth({ birthDate: birth_date, birthYear: birth_year });
  if (!el) return null;
  return { value: el.element, source: el.approximate ? 'approximate' : 'computed', can_chi: el.can_chi, nap_am: el.nap_am };
}

/** Năm sinh hiệu lực: cột năm sinh, hoặc năm của ngày sinh */
export const birthYearOf = (row) => row.birth_year ?? (row.birth_date ? Number(row.birth_date.slice(0, 4)) : null);

/** Tuổi tròn theo giờ VN từ ngày sinh; chưa biết ngày thì lấy năm hiện tại trừ năm sinh. null nếu không có hoặc ngày ở tương lai. */
export function ageOfCustomer(row, today = businessDate()) {
  if (row.birth_date) return row.birth_date > today ? null : ageOn(row.birth_date, today);
  return row.birth_year ? Number(today.slice(0, 4)) - row.birth_year : null;
}

/** Hàm tra giá trị biến cho một bản ghi: cột, biến dẫn xuất (khách), trường tuỳ chỉnh và công thức lồng nhau */
function makeLookup(entityType, row, shopId, fields, stored) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const cache = new Map();
  let derived = null;
  const elementKey = fields.find((f) => f.role === 'element' && f.type !== 'formula')?.key;
  const lookup = (name) => {
    if (entityType === 'customer') {
      if (isShopDerived(name)) return (derived ??= shopDerivedValues(row.id, shopId))[name];
      if (name === 'birth_year') return birthYearOf(row);
      if (name === 'age') return ageOfCustomer(row);
      if (name === 'menh') return shopHasFengShui(shopId) ? derivedValue('element', { ...row, override: elementKey ? stored[elementKey] : null })?.value ?? null : null;
    }
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
  return lookup;
}

const SUBJECT = { customer: 'Khách', order: 'Đơn', purchase: 'Phiếu nhập', product: 'Sản phẩm' };
// Tuổi/Mệnh tính từ ngày sinh: khi trống thì thiếu "Ngày sinh", không phải thiếu chính biến đó
const LABEL_OVERRIDE = { age: 'Ngày sinh', menh: 'Ngày sinh' };

/** Tên dễ đọc của biến trong câu giải thích "chưa có …" */
function labelResolver(entityType, fields) {
  const cols = new Map(columnVariables(entityType, { menh: true }).map((v) => [v.key, v.label]));
  const customs = new Map(fields.map((f) => [`custom.${f.key}`, f.label]));
  return (name) => LABEL_OVERRIDE[name] ?? customs.get(name) ?? cols.get(name) ?? name;
}

/**
 * Giá trị nhập tay + công thức đã tính, kèm `reasons` (vì sao công thức ra trống) và, với khách ở shop có tính năng feng_shui,
 * `element` = mệnh hiệu lực { key, value, source, … } (key = khoá trường mệnh ghi đè nếu shop có).
 */
export function getValuesWithMeta(entityType, entityId, { shopId = null } = {}) {
  needShop(entityType, shopId);
  const row = entityRow(entityType, entityId);
  const stored = rawValues(entityType, entityId, shopId);
  const fields = listFields(entityType, { shopId });
  const lookup = makeLookup(entityType, row, shopId, fields, stored);
  const labelOf = labelResolver(entityType, fields);
  const values = { ...stored };
  const reasons = {};
  for (const f of fields) {
    if (f.type !== 'formula') continue;
    const r = evaluateExplain(parse(f.formula), lookup, { subject: SUBJECT[entityType], labelOf });
    values[f.key] = r.value;
    if (r.reason) reasons[f.key] = r.reason;
  }
  let element = null;
  if (entityType === 'customer' && shopHasFengShui(shopId)) {
    const ef = fields.find((f) => f.role === 'element' && f.type !== 'formula');
    const d = derivedValue('element', { ...row, override: ef ? stored[ef.key] : null });
    element = d && { key: ef?.key ?? null, ...d };
  }
  return { values, reasons, element };
}

/** Giá trị nhập tay + giá trị công thức đã tính cho bản ghi. Với khách: chỉ của shop `shopId`. */
export function getValues(entityType, entityId, { shopId = null } = {}) {
  return getValuesWithMeta(entityType, entityId, { shopId }).values;
}

/**
 * Dữ liệu theo vai trò của khách trong MỘT shop: ngày sinh, năm sinh (thông tin chung trên hồ sơ khách)
 * và mệnh ghi đè (trường vai trò element của shop). Trả Map(customerId → { birth_date, birth_year, element }) cho mọi id trong `ids`.
 */
export function roleValues(shopId, ids) {
  const out = new Map();
  if (!ids?.length) return out;
  const marks = ids.map(() => '?').join(',');
  for (const r of db().prepare(`SELECT id, birth_date, birth_year FROM customers WHERE id IN (${marks})`).all(...ids)) out.set(r.id, { birth_date: r.birth_date, birth_year: r.birth_year, element: null });
  const rows = db()
    .prepare(`SELECT v.entity_id AS id, v.value_text FROM custom_values v JOIN custom_fields f ON f.id = v.field_id
              WHERE v.entity_type = 'customer' AND f.shop_id = ? AND f.role = 'element' AND f.archived_at IS NULL AND v.entity_id IN (${marks})`)
    .all(shopId, ...ids);
  for (const r of rows) if (out.has(r.id)) out.get(r.id).element = r.value_text;
  return out;
}

// ---------- Biến & xem trước công thức ----------
const customVar = (f) => ({ ref: `{custom.${f.key}}`, key: `custom.${f.key}`, label: f.label, type: f.type === 'formula' ? 'number' : f.type === 'select' || f.type === 'multiselect' ? 'text' : f.type, group: 'Trường tuỳ chỉnh' });
const withRef = (v) => ({ ...v, ref: `{${v.key}}` });

/** Biến dùng được trong công thức của một đối tượng (cột có nhãn + trường tuỳ chỉnh đang dùng, của shop nếu có) */
export function listVariables(entityType, { shopId = null } = {}) {
  needShop(entityType, shopId);
  return [...columnVariables(entityType, { menh: entityType === 'customer' && shopHasFengShui(shopId) }).map(withRef), ...listFields(entityType, { shopId }).map(customVar)];
}

export const listMetricVariables = () => REPORT_VARIABLES.map(withRef);

function previewResult(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof FormulaError) return { error: { message: e.message, position: e.position } };
    if (e?.code === 'INVALID_FORMULA' || e?.code === 'FORMULA_CYCLE') return { error: { message: e.message, position: e.details?.position ?? null } };
    throw e;
  }
}

const SAMPLE_LABEL = { order: 'code', purchase: 'code', customer: 'name', product: 'name' };

/**
 * Xem trước công thức trên một bản ghi mẫu (entity_id, hoặc bản ghi gần nhất trong phạm vi shop) hoặc, với 'metric',
 * trên số liệu tháng này của shop/các shop. Không ghi gì. Lỗi trả trong `error` (không ném) để giao diện hiện tại chỗ.
 * `field_key` = khoá trường đang sửa (cho phép tự tham chiếu được báo là vòng lặp thay vì "không có trường").
 */
export function previewFormula({ entityType, shopId = null, formula, entityId = null, fieldKey = null }) {
  if (entityType === 'metric') {
    return previewResult(() => {
      const tree = parseMetric(formula);
      const ov = overview({ shopIds: shopId ? shopId.split(',') : null }).current;
      const labels = new Map(REPORT_VARIABLES.map((v) => [v.key, v.label]));
      const r = evaluateExplain(tree, (n) => ov[n], { subject: 'Số liệu', labelOf: (n) => labels.get(n) ?? n });
      return { value: r.value, reason: r.reason, sample: { id: null, label: 'Số liệu tháng này' } };
    });
  }
  needShop(entityType, shopId);
  return previewResult(() => {
    const tree = parseFormula(entityType, fieldKey, formula, shopId);
    let row;
    if (entityId) row = entityRow(entityType, entityId);
    else {
      const T = TABLES[entityType];
      const where = !shopId ? '' : ['order', 'purchase'].includes(entityType) ? ' WHERE shop_id = ?'
        : entityType === 'customer' ? ' WHERE id IN (SELECT customer_id FROM customer_shops WHERE shop_id = ? AND removed_at IS NULL)'
        : ' WHERE id IN (SELECT v.product_id FROM shop_listings l JOIN variants v ON v.id = l.variant_id WHERE l.shop_id = ?)';
      row = db().prepare(`SELECT * FROM ${T}${where} ORDER BY id DESC LIMIT 1`).get(...(where ? [shopId] : []));
    }
    if (!row) return { value: null, reason: null, sample: null, note: 'Chưa có bản ghi nào để xem trước' };
    const fields = listFields(entityType, { shopId });
    const lookup = makeLookup(entityType, row, shopId, fields, rawValues(entityType, row.id, shopId));
    const r = evaluateExplain(tree, lookup, { subject: SUBJECT[entityType], labelOf: labelResolver(entityType, fields) });
    return { value: r.value, reason: r.reason, sample: { id: row.id, label: row[SAMPLE_LABEL[entityType]] || row.id } };
  });
}

// ---------- Chỉ số báo cáo tuỳ chỉnh ----------
export function listMetrics() {
  return db().prepare('SELECT * FROM report_metrics WHERE archived_at IS NULL ORDER BY created_at').all();
}

/** Kiểm tra công thức chỉ số báo cáo: chỉ nhận biến trong REPORT_VARIABLES */
function parseMetric(formula) {
  const tree = parseOrThrow(formula);
  const known = new Set(REPORT_VARIABLES.map((v) => v.key));
  for (const { name, pos } of refList(tree)) if (!known.has(name)) throw formulaError(`Biến {${name}} không có trong số liệu báo cáo`, pos);
  return tree;
}

export function createMetric(input) {
  parseMetric(input.formula);
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
