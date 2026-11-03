import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb, runInTenant, MASTER_MIGRATIONS_DIR, setDb } from './index.js';
import { config } from '../lib/config.js';
import { newId } from '../lib/id.js';
import { nowIso } from '../lib/time.js';
import { conflict } from '../lib/errors.js';

/**
 * Nhiều tài khoản, mỗi tài khoản một cơ sở dữ liệu riêng.
 *  - master.db: sổ tài khoản + phiên đăng nhập + chỉ mục API key.
 *  - accounts/<id>.db: toàn bộ dữ liệu của một tài khoản (shop, kho, sản phẩm, khách, đơn, cài đặt…).
 * Cách ly hoàn toàn: không có truy vấn nghiệp vụ nào chạm được dữ liệu của tài khoản khác.
 */
let master = null;
let memory = false; // test: mọi cơ sở dữ liệu nằm trong bộ nhớ
const cache = new Map(); // accountId → kết nối

export const LEGACY_DB_FILE = 'moso.db';

export function getMaster() {
  if (!master) master = openDb(memory ? ':memory:' : path.join(config.dataDir, 'master.db'), MASTER_MIGRATIONS_DIR);
  return master;
}

/** Test: bắt đầu lại với sổ tài khoản trống và mọi dữ liệu trong bộ nhớ */
export function resetTenancy({ inMemory = true } = {}) {
  for (const c of cache.values()) c.close?.();
  cache.clear();
  master?.close?.();
  master = null;
  memory = inMemory;
  setDb(null);
  return getMaster();
}

export function getAccount(id) {
  return getMaster().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function getAccountDb(accountId) {
  if (cache.has(accountId)) return cache.get(accountId);
  const acc = getAccount(accountId);
  if (!acc) throw new Error(`Không có tài khoản ${accountId}`);
  const conn = openDb(memory ? ':memory:' : path.join(config.dataDir, acc.db_file));
  cache.set(accountId, conn);
  return conn;
}

/** Ngữ cảnh làm việc của một tài khoản. Tài khoản cũ (moso.db) giữ thư mục sao lưu cũ. */
export function storeFor(account) {
  return { db: getAccountDb(account.id), accountId: account.id, backupSub: account.db_file === LEGACY_DB_FILE ? null : account.id };
}

export const listAccounts = () => getMaster().prepare('SELECT * FROM accounts WHERE disabled_at IS NULL ORDER BY created_at').all();

export async function forEachAccount(fn) {
  for (const a of listAccounts()) await runInTenant(storeFor(a), () => fn(a));
}

export const accountCount = () => getMaster().prepare('SELECT COUNT(*) AS n FROM accounts').get().n;

/** Tạo tài khoản + file dữ liệu riêng (chạy mọi migration). Tên đăng nhập duy nhất, không phân biệt hoa thường. */
export function createAccount({ username, displayName, passwordHash, dbFile }) {
  const m = getMaster();
  const name = username.trim().toLowerCase();
  if (m.prepare('SELECT 1 FROM accounts WHERE username = ?').get(name)) throw conflict('USERNAME_TAKEN', 'Tên đăng nhập đã có người dùng');
  const id = newId('acc');
  const file = dbFile || `accounts/${id}.db`;
  const at = nowIso();
  m.prepare('INSERT INTO accounts (id, username, display_name, password_hash, db_file, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(id, name, displayName, passwordHash, file, at, at);
  try {
    getAccountDb(id); // tạo file + migrate; lỗi thì không để lại tài khoản "mồ côi"
  } catch (e) {
    cache.delete(id);
    m.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    if (!memory && !dbFile) fs.rmSync(path.join(config.dataDir, file), { force: true });
    throw e;
  }
  return getAccount(id);
}

/** Ghi nhớ API key thuộc tài khoản nào (key đã băm). Gọi khi tạo key. */
export const indexApiKey = (keyHash, accountId) => getMaster().prepare('INSERT OR REPLACE INTO api_key_index (key_hash, account_id) VALUES (?, ?)').run(keyHash, accountId);
export const unindexApiKey = (keyHash) => getMaster().prepare('DELETE FROM api_key_index WHERE key_hash = ?').run(keyHash);

/**
 * Chạy khi khởi động. Cài đặt cũ chỉ có một file `moso.db` với một chủ shop: biến nó thành tài khoản đầu tiên
 * (giữ nguyên tên đăng nhập, mật khẩu, dữ liệu, API key). Không đụng gì nếu đã có tài khoản.
 */
export function bootstrapTenancy() {
  if (accountCount() > 0) return { migrated: false };
  const legacy = path.join(config.dataDir, LEGACY_DB_FILE);
  if (!fs.existsSync(legacy)) return { migrated: false };
  const raw = new Database(legacy, { readonly: true });
  let owner = null;
  let keys = [];
  try {
    owner = raw.prepare("SELECT * FROM users ORDER BY created_at LIMIT 1").get();
    keys = raw.prepare('SELECT key_hash FROM api_keys WHERE revoked_at IS NULL').all();
  } catch { /* file cũ chưa có bảng users: bỏ qua */ }
  raw.close();
  if (!owner) return { migrated: false };
  const at = nowIso();
  const id = newId('acc');
  getMaster().prepare('INSERT INTO accounts (id, username, display_name, password_hash, db_file, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(id, owner.username, owner.display_name, owner.password_hash, LEGACY_DB_FILE, at, at);
  for (const k of keys) indexApiKey(k.key_hash, id);
  getAccountDb(id); // chạy các migration mới nếu có
  return { migrated: true, accountId: id, username: owner.username };
}
