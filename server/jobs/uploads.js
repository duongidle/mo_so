import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { uploadsDir } from '../modules/uploads/routes.js';

/**
 * Dọn ảnh tải lên mà không bao giờ gắn vào sản phẩm: chưa có product_id, chưa lưu trữ, không biến thể nào dùng,
 * và tải lên đã quá `days` ngày. Đánh dấu archived_at trong DB và chỉ xoá đúng file đó trong data/uploads.
 * Ảnh đang được dùng (gắn sản phẩm hoặc biến thể) không bao giờ bị đụng. Thao tác trong ngữ cảnh một tài khoản.
 */
export function cleanupUnusedImages(now = new Date(), { days = 7 } = {}) {
  const cutoff = new Date(now.getTime() - days * 86400_000).toISOString();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT i.id, i.file_name FROM product_images i
       WHERE i.product_id IS NULL AND i.archived_at IS NULL AND i.created_at < ?
         AND NOT EXISTS (SELECT 1 FROM variants v WHERE v.image_id = i.id)`,
    )
    .all(cutoff);
  const dir = uploadsDir();
  const mark = db.prepare('UPDATE product_images SET archived_at = ? WHERE id = ? AND product_id IS NULL');
  let removed = 0;
  for (const r of rows) {
    mark.run(now.toISOString(), r.id);
    const file = path.join(dir, path.basename(r.file_name));
    try { fs.unlinkSync(file); removed++; } catch { /* file đã mất: bỏ qua */ }
  }
  return { archived: rows.length, files_removed: removed };
}
