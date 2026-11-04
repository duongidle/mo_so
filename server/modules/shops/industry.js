import { getDb } from '../../db/index.js';
import { getIndustry } from '../../lib/industries.js';
import { createField } from '../custom/service.js';

const GENDER = { male: 'Nam', female: 'Nữ', other: 'Khác' };

/**
 * Trường mẫu của ngành mà chủ shop đã XOÁ có chủ đích thì không tạo lại khi đổi ngành / áp lại ngành.
 * Nhớ bằng nhật ký (audit_log, hành động custom_field.deleted ghi lúc xoá trường) nên không cần bảng riêng.
 * Muốn có lại thì tự thêm trường cùng khoá ở Cài đặt.
 */
function wasDeleted(entityType, shopId, key) {
  return !!getDb()
    .prepare(
      `SELECT 1 FROM audit_log WHERE action = 'custom_field.deleted' AND json_extract(before, '$.field.entity_type') = ?
         AND json_extract(before, '$.field.shop_id') = ? AND json_extract(before, '$.field.key') = ? LIMIT 1`,
    )
    .get(entityType, shopId, key);
}

/**
 * Tạo sẵn các trường thông tin khách và thông tin sản phẩm của ngành cho shop. Chỉ THÊM, không xoá/đổi gì:
 *  - trường cùng khoá hoặc cùng vai trò đã có (kể cả do chủ shop tự tạo) thì bỏ qua;
 *  - trường của ngành cũ vẫn giữ nguyên cùng dữ liệu đã nhập (không mất dữ liệu khi đổi ngành).
 * Trả về danh sách khoá vừa tạo.
 */
export function applyIndustry(shopId) {
  const db = getDb();
  const shop = db.prepare('SELECT industry FROM shops WHERE id = ?').get(shopId);
  const ind = getIndustry(shop.industry);
  const existing = db.prepare(`SELECT key, role FROM custom_fields WHERE entity_type = 'customer' AND shop_id = ? AND archived_at IS NULL`).all(shopId);
  const keys = new Set(existing.map((f) => f.key));
  const roles = new Set(existing.map((f) => f.role).filter(Boolean));
  const created = [];
  let order = existing.length;
  for (const def of ind.customer_fields) {
    if (keys.has(def.key) || (def.role && roles.has(def.role)) || wasDeleted('customer', shopId, def.key)) continue;
    createField({ entity_type: 'customer', shop_id: shopId, sort_order: order++, ...def });
    created.push(def.key);
  }
  // Trường sản phẩm của ngành: riêng shop này, cũng chỉ thêm
  const pExisting = db.prepare(`SELECT key, role FROM custom_fields WHERE entity_type = 'product' AND shop_id = ? AND archived_at IS NULL`).all(shopId);
  const pKeys = new Set(pExisting.map((f) => f.key));
  const pRoles = new Set(pExisting.map((f) => f.role).filter(Boolean));
  let pOrder = pExisting.length;
  for (const def of ind.product_fields ?? []) {
    if (pKeys.has(def.key) || (def.role && pRoles.has(def.role)) || wasDeleted('product', shopId, def.key)) continue;
    createField({ entity_type: 'product', shop_id: shopId, sort_order: pOrder++, ...def });
    created.push(`product.${def.key}`);
  }
  if (created.length && ind.features.includes('feng_shui')) backfillFromLegacy(shopId);
  return created;
}

/**
 * Trước đây mệnh/giới tính lưu chung trên hồ sơ khách. Khi shop bật ngành phong thuỷ, chép các giá trị cũ
 * sang trường của shop cho những khách đã từng mua ở shop này (không ghi đè giá trị đã có).
 * Ngày/năm sinh không chép: chúng là thông tin chung của khách (cột customers.birth_date, birth_year).
 */
function backfillFromLegacy(shopId) {
  const db = getDb();
  const fields = Object.fromEntries(
    db.prepare(`SELECT role, key, id FROM custom_fields WHERE entity_type = 'customer' AND shop_id = ? AND archived_at IS NULL AND role IS NOT NULL`).all(shopId).map((f) => [f.role, f]),
  );
  const gender = db.prepare(`SELECT id FROM custom_fields WHERE entity_type = 'customer' AND shop_id = ? AND key = 'gioi_tinh' AND archived_at IS NULL`).get(shopId);
  const customers = db
    .prepare(
      `SELECT c.id, c.element_override, c.gender FROM customers c
       WHERE c.merged_into IS NULL AND (c.element_override IS NOT NULL OR c.gender IS NOT NULL)
         AND EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.shop_id = ?)`,
    )
    .all(shopId);
  const ins = db.prepare(`INSERT OR IGNORE INTO custom_values (entity_type, entity_id, field_id, value_text, value_num) VALUES ('customer', ?, ?, ?, ?)`);
  for (const c of customers) {
    if (fields.element && c.element_override) ins.run(c.id, fields.element.id, c.element_override, null);
    if (gender && c.gender) ins.run(c.id, gender.id, GENDER[c.gender], null);
  }
}
