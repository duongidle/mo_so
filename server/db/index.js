import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let db = null;

export function openDb(file = path.join(config.dataDir, 'moso.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  conn.pragma('synchronous = NORMAL');
  migrate(conn);
  return conn;
}

export function migrate(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(conn.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    conn.transaction(() => {
      conn.exec(sql);
      conn.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
    })();
  }
}

export function setDb(conn) {
  db = conn;
}

export function getDb() {
  if (!db) db = openDb();
  return db;
}

/** Chạy hàm trong transaction. Lồng nhau được (better-sqlite3 dùng savepoint). */
export function tx(fn) {
  return getDb().transaction(fn)();
}
