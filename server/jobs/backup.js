import fs from 'node:fs';
import path from 'node:path';
import { getDb, tenantStore } from '../db/index.js';
import { forEachAccount, getMaster } from '../db/tenancy.js';
import { config } from '../lib/config.js';
import { businessDate, addDays } from '../lib/time.js';
import { getSetting } from '../modules/settings/service.js';
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
  const own = dir !== masterBackupDir(); // sổ tài khoản chung luôn theo mặc định; cài đặt sao lưu thuộc từng tài khoản
  const pruned = pruneBackups(date, own ? { dir, days: getSetting('backup_keep_days'), weeks: getSetting('backup_keep_weeks') } : { dir });
  const uploads = !own || getSetting('backup_include_images') !== false ? mirrorUploads(dir) : 0;
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

// ---------- Lịch sao lưu (giờ Việt Nam, UTC+7 không đổi mùa) ----------
const slotAt = (date, time) => new Date(`${date}T${time}:00+07:00`);
const weekdayOf = (date) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; // 1 = thứ Hai … 7 = Chủ nhật
export const scheduleConfig = () => ({
  enabled: getSetting('backup_enabled') !== false,
  time: getSetting('backup_time') || '02:00',
  frequency: getSetting('backup_frequency') === 'weekly' ? 'weekly' : 'daily',
  weekday: getSetting('backup_weekday') || 1,
  keep_days: getSetting('backup_keep_days') || 14,
  keep_weeks: getSetting('backup_keep_weeks') ?? 8,
  include_images: getSetting('backup_include_images') !== false,
});

/** Mốc theo lịch gần nhất đã qua (hoặc sắp tới nếu `dir` = 1) tính từ `now`. */
function slot(now, cfg, dir) {
  const today = businessDate(now.toISOString());
  for (let i = 0; i < 9; i++) {
    const date = addDays(today, dir * i);
    if (cfg.frequency === 'weekly' && weekdayOf(date) !== cfg.weekday) continue;
    const s = slotAt(date, cfg.time);
    if (dir < 0 ? s <= now : s > now) return s;
  }
  return null;
}
export const lastSlot = (now, cfg) => slot(now, cfg, -1);
export const nextSlot = (now, cfg) => slot(now, cfg, 1);

/** Đến lúc sao lưu khi đã qua một mốc theo lịch mà chưa có bản nào được tạo sau mốc đó (máy tắt lúc đến giờ thì chạy bù khi bật lại). */
export function backupDue(now = new Date(), cfg = scheduleConfig(), backups = listBackups()) {
  if (!cfg.enabled) return false;
  const s = lastSlot(now, cfg);
  if (!s) return false;
  return !backups.some((b) => new Date(b.created_at) >= s);
}

export function backupStatus(now = new Date()) {
  const cfg = scheduleConfig();
  const list = listBackups();
  return { config: cfg, last_backup_at: list[0]?.created_at ?? null, next_at: cfg.enabled ? nextSlot(now, cfg)?.toISOString() ?? null : null, count: list.length, total_size: list.reduce((a, b) => a + b.size, 0) };
}

/**
 * Chạy khi server khởi động rồi kiểm tra lại mỗi 5 phút: tài khoản nào đã tới mốc sao lưu theo cài đặt mà chưa có bản mới thì tạo.
 * Mỗi tài khoản một thư mục riêng; sổ tài khoản (master) sao lưu riêng ở backups/_master.
 */
export function startBackupScheduler({ intervalMs = 300_000 } = {}) {
  const today = () => businessDate().replaceAll('-', '');
  const lastClean = new Map();
  const tick = async () => {
    try {
      await forEachAccount(async (a) => {
        if (Date.now() - (lastClean.get(a.username) ?? 0) > 3600_000) {
          lastClean.set(a.username, Date.now());
          try {
            const c = cleanupUnusedImages();
            if (c.archived) console.log(`Đã dọn ${c.archived} ảnh tải lên không dùng (${a.username})`);
          } catch (e) { console.error('Dọn ảnh lỗi:', e); }
        }
        if (!backupDue()) return;
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
