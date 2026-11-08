import { forEachAccount } from '../db/tenancy.js';
import { runNotifications } from '../modules/notifications/service.js';

/** Thông báo cho chủ shop: kiểm tra mỗi 30 phút, từng tài khoản. Mỗi loại tối đa một lần mỗi ngày nên không gửi trùng. */
export async function tickNotifications() {
  await forEachAccount(async (a) => {
    try {
      const made = await runNotifications();
      if (made.length) console.log(`Đã tạo ${made.length} thông báo (${a.username})`);
    } catch (e) {
      console.error(`Thông báo lỗi (${a.username}):`, e.message);
    }
  });
}

export function startNotificationScheduler({ intervalMs = 1800_000 } = {}) {
  const tick = () => tickNotifications().catch((e) => console.error('Thông báo lỗi:', e));
  const first = setTimeout(tick, 15_000); // chờ server khởi động xong
  first.unref();
  const t = setInterval(tick, intervalMs);
  t.unref();
  return t;
}
