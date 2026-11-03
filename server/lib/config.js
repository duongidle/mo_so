import path from 'node:path';
import fs from 'node:fs';

// Đọc .env đơn giản (không cần thư viện dotenv)
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  businessTz: process.env.TZ_BUSINESS || 'Asia/Ho_Chi_Minh',
  secureCookie: process.env.SECURE_COOKIE === '1',
  sessionDays: 30,
  // Đăng ký tài khoản mới: 'open' (mặc định) hoặc 'closed'. Tài khoản đầu tiên luôn được tạo.
  registration: process.env.REGISTRATION === 'closed' ? 'closed' : 'open',
  registerLimitPerHour: Number(process.env.REGISTER_LIMIT || 20),
};
