import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { config } from '../lib/config.js';
import { businessDate, addDays } from '../lib/time.js';

const NAME_RE = /^moso-(\d{8})-(\d{4})\.db$/;

export const backupDir = () => path.join(config.dataDir, 'backups');

function stamp(date = new Date()) {
  const d = businessDate(date.toISOString()).replaceAll('-', '');
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: config.businessTz, hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace(':', '');
  return `${d}-${t}`;
}

export function listBackups() {
  if (!fs.existsSync(backupDir())) return [];
  return fs
    .readdirSync(backupDir())
    .filter((f) => NAME_RE.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const st = fs.statSync(path.join(backupDir(), f));
      return { name: f, size: st.size, created_at: st.mtime.toISOString() };
    });
}

/** Sao lưu bằng SQLite online backup (an toàn khi đang có người ghi). */
export async function runBackup(date = new Date()) {
  fs.mkdirSync(backupDir(), { recursive: true });
  const name = `moso-${stamp(date)}.db`;
  const file = path.join(backupDir(), name);
  const tmp = `${file}.tmp`;
  await getDb().backup(tmp);
  fs.renameSync(tmp, file); // chỉ lộ ra khi đã ghi xong
  const pruned = pruneBackups(date);
  return { name, file, size: fs.statSync(file).size, pruned };
}

/**
 * Giữ bản mới nhất của mỗi ngày trong 14 ngày gần đây,
 * và bản mới nhất của mỗi tuần (theo thứ Hai) trong 8 tuần gần đây. Còn lại xoá.
 */
export function pruneBackups(now = new Date(), { days = 14, weeks = 8 } = {}) {
  const today = businessDate(now.toISOString());
  const files = listBackups().map((b) => ({ ...b, date: b.name.slice(5, 13).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') }));
  const keep = new Set();
  const seenDay = new Set();
  const seenWeek = new Set();
  const mondayOf = (d) => {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = CN
    return addDays(d, -((dow + 6) % 7));
  };
  for (const f of files) {
    // files đã sắp mới → cũ nên bản đầu tiên gặp của mỗi ngày/tuần là bản mới nhất
    const ageDays = (new Date(`${today}T00:00:00Z`) - new Date(`${f.date}T00:00:00Z`)) / 86400000;
    if (ageDays < days && !seenDay.has(f.date)) {
      seenDay.add(f.date);
      keep.add(f.name);
    }
    const wk = mondayOf(f.date);
    const ageWeeks = (new Date(`${mondayOf(today)}T00:00:00Z`) - new Date(`${wk}T00:00:00Z`)) / (7 * 86400000);
    if (ageWeeks < weeks && !seenWeek.has(wk)) {
      seenWeek.add(wk);
      keep.add(f.name);
    }
  }
  const removed = [];
  for (const f of files) {
    if (!keep.has(f.name)) {
      fs.unlinkSync(path.join(backupDir(), f.name));
      removed.push(f.name);
    }
  }
  return removed;
}

/** Chạy khi server khởi động: nếu hôm nay chưa có bản sao lưu thì tạo, rồi kiểm tra lại mỗi giờ. */
export function startBackupScheduler({ intervalMs = 3600_000 } = {}) {
  const tick = async () => {
    try {
      const today = businessDate().replaceAll('-', '');
      if (!listBackups().some((b) => b.name.startsWith(`moso-${today}`))) {
        const r = await runBackup();
        console.log(`Đã sao lưu tự động: ${r.name}`);
      }
    } catch (e) {
      console.error('Sao lưu tự động lỗi:', e);
    }
  };
  tick();
  const t = setInterval(tick, intervalMs);
  t.unref();
  return t;
}
