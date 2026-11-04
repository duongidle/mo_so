import fs from 'node:fs';
import path from 'node:path';
import { getDb, tenantStore } from '../db/index.js';
import { forEachAccount, getMaster } from '../db/tenancy.js';
import { config } from '../lib/config.js';
import { businessDate, addDays } from '../lib/time.js';
import { cleanupUnusedImages } from './uploads.js';

const NAME_RE = /^moso-(\d{8})-(\d{4})\.db$/;

/** Thư mục sao lưu của tài khoản đang làm việc (mỗi tài khoản một thư mục riêng; tài khoản cũ giữ thư mục gốc) */
export const backupDir = () => {
  const sub = tenantStore()?.backupSub;
  return sub ? path.join(config.dataDir, 'backups', sub) : path.join(config.dataDir, 'backups');
};
const masterBackupDir = () => path.join(config.dataDir, 'backups', '_master');

function stamp(date = new Date()) {
  const d = businessDate(date.toISOString()).replaceAll('-', '');
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: config.businessTz, hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace(':', '');
  return `${d}-${t}`;
}

export function listBackups(dir = backupDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => NAME_RE.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, created_at: st.mtime.toISOString() };
    });
}

/**
 * Chép ảnh sản phẩm của tài khoản sang <thư mục sao lưu>/uploads/ (chỉ chép file chưa có; ảnh không bao giờ bị sửa nên đủ).
 * Chỉ chạy khi sao lưu theo ngữ cảnh một tài khoản, không chạy cho sổ tài khoản (master).
 */
export function mirrorUploads(dir) {
  const accountId = tenantStore()?.accountId;
  if (!accountId || dir === masterBackupDir()) return 0;
  const src = path.join(config.dataDir, 'uploads', accountId);
  if (!fs.existsSync(src)) return 0;
  const dest = path.join(dir, 'uploads');
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const f of fs.readdirSync(src)) {
    const to = path.join(dest, f);
    if (fs.existsSync(to)) continue;
    fs.copyFileSync(path.join(src, f), `${to}.tmp`);
    fs.renameSync(`${to}.tmp`, to);
    copied++;
  }
  return copied;
}

/** Sao lưu bằng SQLite online backup (an toàn khi đang có người ghi). */
export async function runBackup(date = new Date(), { conn = getDb(), dir = backupDir() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const name = `moso-${stamp(date)}.db`;
  const file = path.join(dir, name);
  const tmp = `${file}.tmp`;
  await conn.backup(tmp);
  fs.renameSync(tmp, file); // chỉ lộ ra khi đã ghi xong
  const pruned = pruneBackups(date, { dir });
  const uploads = mirrorUploads(dir);
  return { name, file, size: fs.statSync(file).size, pruned, uploads };
}

/**
 * Giữ bản mới nhất của mỗi ngày trong 14 ngày gần đây,
 * và bản mới nhất của mỗi tuần (theo thứ Hai) trong 8 tuần gần đây. Còn lại xoá.
 */
export function pruneBackups(now = new Date(), { days = 14, weeks = 8, dir = backupDir() } = {}) {
  const today = businessDate(now.toISOString());
  const files = listBackups(dir).map((b) => ({ ...b, date: b.name.slice(5, 13).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') }));
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
      fs.unlinkSync(path.join(dir, f.name));
      removed.push(f.name);
    }
  }
  return removed;
}

/**
 * Chạy khi server khởi động rồi kiểm tra lại mỗi giờ: tài khoản nào hôm nay chưa có bản sao lưu thì tạo.
 * Mỗi tài khoản một thư mục riêng; sổ tài khoản (master) sao lưu riêng ở backups/_master.
 */
export function startBackupScheduler({ intervalMs = 3600_000 } = {}) {
  const today = () => businessDate().replaceAll('-', '');
  const tick = async () => {
    try {
      await forEachAccount(async (a) => {
        try {
          const c = cleanupUnusedImages();
          if (c.archived) console.log(`Đã dọn ${c.archived} ảnh tải lên không dùng (${a.username})`);
        } catch (e) { console.error('Dọn ảnh lỗi:', e); }
        if (listBackups().some((b) => b.name.startsWith(`moso-${today()}`))) return;
        const r = await runBackup();
        console.log(`Đã sao lưu tự động (${a.username}): ${r.name}`);
      });
      if (!listBackups(masterBackupDir()).some((b) => b.name.startsWith(`moso-${today()}`))) await runBackup(new Date(), { conn: getMaster(), dir: masterBackupDir() });
    } catch (e) {
      console.error('Sao lưu tự động lỗi:', e);
    }
  };
  tick();
  const t = setInterval(tick, intervalMs);
  t.unref();
  return t;
}
