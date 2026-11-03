import { getDb } from '../../db/index.js';
import { nowIso } from '../../lib/time.js';
import { badRequest } from '../../lib/errors.js';

/** Giá trị mặc định cho mọi cài đặt. Cài đặt lưu trong DB ghi đè lên đây. */
export const DEFAULT_SETTINGS = {
  allow_negative_stock: false,
  low_stock_days: 14, // cảnh báo khi tồn còn ít hơn số ngày bán này
  slow_moving_days: 60, // hàng không bán trong N ngày = bán chậm
  currency: 'VND',
  business_name: 'Mở Sổ',
  expense_allocation: 'revenue', // revenue | equal | fixed
  tax_enabled: false, // ước tính thuế: mặc định tắt. App không tự đặt mức thuế nào, người dùng tự nhập theo quy định hiện hành
  tax_rules: [], // [{ name, rate_pct, base: net_revenue | revenue_with_shipping | net_profit, exempt_threshold_year }]
  expense_allocation_fixed: {}, // khi expense_allocation = fixed: { shop_id: tỷ lệ % } (không cần cộng đúng 100, app chia theo tỷ lệ)
  health_thresholds: {
    gross_margin_pct: { warn: 35, bad: 25, direction: 'higher_better' },
    cancel_rate_pct: { warn: 5, bad: 10, direction: 'lower_better' },
    return_rate_pct: { warn: 3, bad: 6, direction: 'lower_better' },
    days_of_inventory: { warn: 90, bad: 150, direction: 'lower_better' },
    repeat_rate_pct: { warn: 20, bad: 10, direction: 'higher_better' },
  },
};

export function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) out[r.key] = JSON.parse(r.value);
  return out;
}

export function getSetting(key) {
  return getSettings()[key];
}

export const TAX_BASES = ['net_revenue', 'revenue_with_shipping', 'net_profit'];

function validate(patch) {
  if ('tax_enabled' in patch && typeof patch.tax_enabled !== 'boolean') throw badRequest('INVALID_SETTING', 'tax_enabled phải là true/false');
  if ('tax_rules' in patch) {
    const t = patch.tax_rules;
    const ok = Array.isArray(t) && t.length <= 10 && t.every((r) => r && typeof r.name === 'string' && r.name.trim() && r.name.length <= 60 && typeof r.rate_pct === 'number' && r.rate_pct >= 0 && r.rate_pct <= 100 && TAX_BASES.includes(r.base) && Number.isInteger(r.exempt_threshold_year ?? 0) && (r.exempt_threshold_year ?? 0) >= 0);
    if (!ok) throw badRequest('INVALID_SETTING', 'Quy tắc thuế: tối đa 10 dòng; mỗi dòng có tên, tỷ lệ 0–100 %, cơ sở tính (net_revenue | revenue_with_shipping | net_profit) và ngưỡng miễn thuế cả năm (số nguyên ≥ 0)');
  }
  if ('expense_allocation' in patch && !['revenue', 'equal', 'fixed'].includes(patch.expense_allocation)) {
    throw badRequest('INVALID_SETTING', 'Cách phân bổ chi phí chung phải là revenue, equal hoặc fixed');
  }
  if ('expense_allocation_fixed' in patch) {
    const m = patch.expense_allocation_fixed;
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.values(m).some((v) => typeof v !== 'number' || !(v >= 0) || v > 100)) {
      throw badRequest('INVALID_SETTING', 'Tỷ lệ phân bổ cố định: mỗi shop một số từ 0 đến 100 (%)');
    }
  }
}

export function updateSettings(patch) {
  validate(patch);
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
  );
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    stmt.run(k, JSON.stringify(v), nowIso());
  }
  return getSettings();
}
