import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, tenantStore } from '../../db/index.js';
import { config } from '../../lib/config.js';
import { newId } from '../../lib/id.js';
import { nowIso } from '../../lib/time.js';
import { badRequest, notFound, AppError } from '../../lib/errors.js';

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };

/** Thư mục ảnh của tài khoản đang làm việc: data/uploads/<accountId>/ (mỗi tài khoản một thư mục riêng) */
export const uploadsDir = (accountId = tenantStore()?.accountId) => {
  if (!accountId) throw new Error('Không có tài khoản đang làm việc');
  return path.join(config.dataDir, 'uploads', accountId);
};

/** Nhận dạng định dạng ảnh bằng magic bytes, không tin Content-Type do client gửi */
export function sniffImage(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const dim = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 20000 ? n : null;
};

export const uploadRoutes = new Hono();
uploadRoutes.post('/images', async (c) => {
  const declared = Number(c.req.header('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', 'Ảnh tối đa 3 MB');
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (!buf.length) throw badRequest('IMAGE_EMPTY', 'Không có dữ liệu ảnh');
  if (buf.length > MAX_IMAGE_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', 'Ảnh tối đa 3 MB');
  const ext = sniffImage(buf);
  if (!ext) throw badRequest('IMAGE_TYPE', 'Chỉ nhận ảnh WebP, JPEG hoặc PNG');
  const id = newId('img');
  const dir = uploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${id}.${ext}`;
  fs.writeFileSync(path.join(dir, fileName), buf);
  getDb()
    .prepare('INSERT INTO product_images (id, file_name, width, height, size_bytes, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, fileName, dim(c.req.query('width')), dim(c.req.query('height')), buf.length, nowIso());
  return c.json({ data: { id, url: `/api/v1/files/images/${id}`, size_bytes: buf.length } }, 201);
});

export const fileRoutes = new Hono();
fileRoutes.get('/images/:id', (c) => {
  // Tra trong DB của tài khoản đang đăng nhập: ảnh của tài khoản khác không có ở đây nên là 404
  const img = getDb().prepare('SELECT file_name FROM product_images WHERE id = ?').get(c.req.param('id'));
  if (!img) throw notFound('Ảnh');
  const file = path.join(uploadsDir(), path.basename(img.file_name));
  if (!fs.existsSync(file)) throw notFound('Ảnh');
  const ext = path.extname(file).slice(1);
  return new Response(fs.readFileSync(file), {
    headers: { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
  });
});
