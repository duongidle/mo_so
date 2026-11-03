import Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
export const MASTER_MIGRATIONS_DIR = path.join(__dirname, 'master');

// Cơ sở dữ liệu của tài khoản đang xử lý yêu cầu (đặt ở middleware xác thực). Nhờ vậy mọi `getDb()` trong nghiệp vụ
// tự trỏ đúng file của tài khoản, không ai phải truyền tham số và không thể quên.
const als = new AsyncLocalStorage();
let db = null; // DB mặc định, chỉ dùng cho test: production không bao giờ có

export function openDb(file, dir = MIGRATIONS_DIR) {
  if (!file) throw new Error('openDb cần đường dẫn file');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  conn.pragma('synchronous = NORMAL');
  migrate(conn, dir);
  return conn;
}

export function migrate(conn, dir = MIGRATIONS_DIR) {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(conn.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    conn.transaction(() => {
      conn.exec(sql);
      conn.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
    })();
  }
}

export function setDb(conn) {
  db = conn;
}

/** Cơ sở dữ liệu của tài khoản đang làm việc. Gọi ngoài yêu cầu của một tài khoản (và chưa `setDb`) là lỗi lập trình. */
export function getDb() {
  const store = als.getStore();
  if (store?.db) return store.db;
  if (!db) throw new Error('Không có tài khoản đang làm việc: getDb() phải chạy trong runInTenant() hoặc sau setDb()');
  return db;
}

/** Chạy `fn` với cơ sở dữ liệu của một tài khoản. store = { db, accountId, backupSub } */
export function runInTenant(store, fn) {
  return als.run(store, fn);
}

export const tenantStore = () => als.getStore() ?? null;

/** Chạy hàm trong transaction. Lồng nhau được (better-sqlite3 dùng savepoint). */
export function tx(fn) {
  return getDb().transaction(fn)();
}
