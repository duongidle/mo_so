import { forEachAccount } from '../db/tenancy.js';
import { runDue } from '../modules/expenses/recurring.js';

/**
 * Chi phí định kỳ: chạy khi server khởi động rồi kiểm tra lại mỗi giờ (cùng nhịp với job sao lưu), từng tài khoản.
 * Mỗi lần tạo các kỳ đến hạn còn thiếu nên server tắt nhiều ngày thì lần mở lại sẽ tạo bù; chạy lặp không tạo trùng.
 */
export async function tickRecurring() {
  const total = { created: 0, skipped_locked: 0 };
  await forEachAccount(async (a) => {
    const r = runDue();
    if (r.created) console.log(`Đã tạo ${r.created} chi phí định kỳ (${a.username})`);
    total.created += r.created;
    total.skipped_locked += r.skipped_locked;
  });
  return total;
}

export function startRecurringScheduler({ intervalMs = 3600_000 } = {}) {
  const tick = () => tickRecurring().catch((e) => console.error('Chi phí định kỳ lỗi:', e));
  tick();
  const t = setInterval(tick, intervalMs);
  t.unref();
  return t;
}
