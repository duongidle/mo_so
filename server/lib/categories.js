import { getDb } from '../db/index.js';

/** Danh mục và mọi danh mục con cháu của nó (gồm chính nó). Trả mảng id. */
export function categoryWithDescendants(categoryId) {
  return getDb()
    .prepare(`WITH RECURSIVE t(id) AS (SELECT id FROM categories WHERE id = ? UNION SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id) SELECT id FROM t`)
    .all(categoryId)
    .map((r) => r.id);
}

/**
 * Mệnh đề SQL lọc theo danh mục (gồm con cháu) trên cột `column`. Danh mục không tồn tại → không khớp gì.
 * Trả { sql: ' AND col IN (…)', params } hoặc rỗng nếu không lọc.
 */
export function categoryClause(categoryId, column = 'p.category_id') {
  if (!categoryId) return { sql: '', params: [] };
  const ids = categoryWithDescendants(categoryId);
  if (!ids.length) return { sql: ' AND 0', params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}
