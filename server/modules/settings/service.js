import { getDb } from '../../db/index.js';
import { nowIso } from '../../lib/time.js';

/** Giá trị mặc định cho mọi cài đặt. Cài đặt lưu trong DB ghi đè lên đây. */
export const DEFAULT_SETTINGS = {
  allow_negative_stock: false,
  low_stock_days: 14, // cảnh báo khi tồn còn ít hơn số ngày bán này
  slow_moving_days: 60, // hàng không bán trong N ngày = bán chậm
  currency: 'VND',
  business_name: 'Mở Sổ',
  expense_allocation: 'revenue', // revenue | equal
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

export function updateSettings(patch) {
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
