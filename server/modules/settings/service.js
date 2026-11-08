import { getDb } from '../../db/index.js';
import { nowIso } from '../../lib/time.js';
import { badRequest } from '../../lib/errors.js';
import { DEFAULT_ENABLED_PLATFORMS } from '../../lib/platforms.js';

/** Giá trị mặc định cho mọi cài đặt. Cài đặt lưu trong DB ghi đè lên đây. */
export const DEFAULT_SETTINGS = {
  allow_negative_stock: false,
  low_stock_days: 14, // cảnh báo khi tồn còn ít hơn số ngày bán này
  slow_moving_days: 60, // hàng không bán trong N ngày = bán chậm
  currency: 'VND',
  business_name: 'Mở Sổ',
  enabled_platforms: DEFAULT_ENABLED_PLATFORMS, // nền tảng bán hàng đang kết nối; chỉ đổi qua /platforms/:id/enable|disable
  expense_allocation: 'revenue', // revenue | equal | fixed
  tax_enabled: false, // ước tính thuế: mặc định tắt. Hệ thống không tự đặt mức thuế nào, người dùng tự nhập theo quy định hiện hành
  tax_rules: [], // [{ name, rate_pct, base: net_revenue | revenue_with_shipping | net_profit, exempt_threshold_year }]
  payment_terms_days: 0, // số ngày khách được nợ kể từ ngày đơn khi đơn không đặt hạn; 0 = không đặt hạn mặc định
  expiry_warn_days: 30, // cảnh báo lô hàng còn dưới số ngày này tới hạn dùng
  payout_overdue_days: 10, // đơn sàn giao xong quá số ngày này mà chưa nhận tiền thì báo nên khiếu nại với sàn (0 = tắt)
  return_window_days: 0, // thời hạn nhận trả hàng kể từ ngày hoàn thành đơn (ngày); 0 = không giới hạn
  backup_enabled: true, // sao lưu tự động theo lịch
  backup_time: '02:00', // giờ sao lưu (giờ Việt Nam, HH:MM)
  backup_frequency: 'daily', // daily | weekly
  backup_weekday: 1, // khi weekly: 1 = thứ Hai … 7 = Chủ nhật
  backup_keep_days: 14, // giữ bản mới nhất của mỗi ngày trong N ngày gần đây
  backup_keep_weeks: 8, // giữ bản mới nhất của mỗi tuần trong N tuần gần đây
  backup_include_images: true, // sao lưu cả ảnh sản phẩm (cơ sở dữ liệu luôn được sao lưu)
  costing_method: 'average', // average | fifo; chỉ đổi qua PUT /costing-method để lớp giá được dựng lại cùng lúc
  stock_lock_date: null, // chốt kho: chỉ đặt qua POST /stock-close (có chụp tồn), không qua PATCH /settings
  accounting_lock_date: null, // khoá sổ: chứng từ tay, chi phí, thanh toán, chuyển quỹ, tài sản có ngày ≤ ngày này không tạo/sửa/huỷ được (PERIOD_LOCKED). Đặt qua POST /accounting/lock để có ảnh chụp số liệu
  expense_allocation_fixed: {}, // khi expense_allocation = fixed: { shop_id: tỷ lệ % } (không cần cộng đúng 100, hệ thống chia theo tỷ lệ)
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
  if ('enabled_platforms' in patch) throw badRequest('INVALID_SETTING', 'Nền tảng bán hàng không đổi ở đây. Bật hoặc tắt ở Cài đặt → Nền tảng để kênh, mẫu nhập đơn và quỹ được cập nhật cùng lúc.');
  if ('tax_enabled' in patch && typeof patch.tax_enabled !== 'boolean') throw badRequest('INVALID_SETTING', 'Bật hoặc tắt ước tính thuế chỉ nhận giá trị bật hoặc tắt.');
  if ('tax_rules' in patch) {
    const t = patch.tax_rules;
    const ok = Array.isArray(t) && t.length <= 10 && t.every((r) => r && typeof r.name === 'string' && r.name.trim() && r.name.length <= 60 && typeof r.rate_pct === 'number' && r.rate_pct >= 0 && r.rate_pct <= 100 && TAX_BASES.includes(r.base) && Number.isInteger(r.exempt_threshold_year ?? 0) && (r.exempt_threshold_year ?? 0) >= 0);
    if (!ok) throw badRequest('INVALID_SETTING', 'Quy tắc thuế: tối đa 10 dòng; mỗi dòng có tên, tỷ lệ 0–100 %, cơ sở tính (net_revenue | revenue_with_shipping | net_profit) và ngưỡng miễn thuế cả năm (số nguyên ≥ 0)');
  }
  if ('costing_method' in patch) throw badRequest('INVALID_SETTING', 'Phương pháp giá vốn đổi ở Cài đặt → Ngưỡng & kho để hệ thống dựng lại lớp giá và ghi nhật ký.');
  if ('stock_lock_date' in patch) throw badRequest('INVALID_SETTING', 'Chốt kho và mở lại kỳ kho thực hiện ở Kho → Chốt kho để có ảnh chụp tồn và nhật ký.');
  if ('accounting_lock_date' in patch) {
    const v = patch.accounting_lock_date;
    if (v !== null && !(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()))) throw badRequest('INVALID_SETTING', 'Ngày khoá sổ phải có dạng năm-tháng-ngày (ví dụ 2026-10-31), hoặc để trống nếu không khoá.');
  }
  if ('payment_terms_days' in patch && !(Number.isInteger(patch.payment_terms_days) && patch.payment_terms_days >= 0 && patch.payment_terms_days <= 365)) throw badRequest('INVALID_SETTING', 'Số ngày công nợ mặc định là số từ 0 tới 365 (0 = không đặt hạn)');
  if ('expiry_warn_days' in patch && !(Number.isInteger(patch.expiry_warn_days) && patch.expiry_warn_days >= 1 && patch.expiry_warn_days <= 730)) throw badRequest('INVALID_SETTING', 'Số ngày cảnh báo hết hạn là số từ 1 tới 730');
  if ('payout_overdue_days' in patch && !(Number.isInteger(patch.payout_overdue_days) && patch.payout_overdue_days >= 0 && patch.payout_overdue_days <= 365)) throw badRequest('INVALID_SETTING', 'Số ngày báo đơn sàn chưa trả tiền là số từ 0 tới 365 (0 = tắt)');
  if ('return_window_days' in patch && !(Number.isInteger(patch.return_window_days) && patch.return_window_days >= 0 && patch.return_window_days <= 3650)) throw badRequest('INVALID_SETTING', 'Thời hạn trả hàng là số ngày từ 0 tới 3650 (0 = không giới hạn)');
  if ('backup_enabled' in patch && typeof patch.backup_enabled !== 'boolean') throw badRequest('INVALID_SETTING', 'Bật/tắt sao lưu tự động phải là true hoặc false');
  if ('backup_include_images' in patch && typeof patch.backup_include_images !== 'boolean') throw badRequest('INVALID_SETTING', 'Sao lưu ảnh sản phẩm phải là true hoặc false');
  if ('backup_time' in patch && !(typeof patch.backup_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.backup_time))) throw badRequest('INVALID_SETTING', 'Giờ sao lưu có dạng HH:MM, ví dụ 02:00');
  if ('backup_frequency' in patch && !['daily', 'weekly'].includes(patch.backup_frequency)) throw badRequest('INVALID_SETTING', 'Tần suất sao lưu là daily (mỗi ngày) hoặc weekly (mỗi tuần)');
  if ('backup_weekday' in patch && !(Number.isInteger(patch.backup_weekday) && patch.backup_weekday >= 1 && patch.backup_weekday <= 7)) throw badRequest('INVALID_SETTING', 'Ngày sao lưu trong tuần là số từ 1 (thứ Hai) đến 7 (Chủ nhật)');
  if ('backup_keep_days' in patch && !(Number.isInteger(patch.backup_keep_days) && patch.backup_keep_days >= 1 && patch.backup_keep_days <= 365)) throw badRequest('INVALID_SETTING', 'Số ngày giữ bản sao lưu là số từ 1 đến 365');
  if ('backup_keep_weeks' in patch && !(Number.isInteger(patch.backup_keep_weeks) && patch.backup_keep_weeks >= 0 && patch.backup_keep_weeks <= 104)) throw badRequest('INVALID_SETTING', 'Số tuần giữ bản sao lưu là số từ 0 đến 104');
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

/** Ghi một cài đặt từ code nghiệp vụ (bỏ qua kiểm tra của PATCH /settings) */
export function writeSetting(key, value) {
  getDb()
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
    .run(key, JSON.stringify(value), nowIso());
}
