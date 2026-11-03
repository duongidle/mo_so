import { getDb } from '../../db/index.js';

/** Các bảng cho phép xuất CSV (không gồm bảng bảo mật: users, sessions, api_keys, webhooks) */
export const EXPORTS = {
  orders: 'SELECT * FROM orders ORDER BY business_date, code',
  order_lines: 'SELECT l.*, o.code AS order_code FROM order_lines l JOIN orders o ON o.id = l.order_id ORDER BY o.code, l.sort_order',
  customers: 'SELECT * FROM customers ORDER BY code',
  products: 'SELECT p.name AS product_name, v.* FROM variants v JOIN products p ON p.id = v.product_id ORDER BY v.sku',
  stock: 'SELECT s.*, v.sku FROM stock_levels s JOIN variants v ON v.id = s.variant_id ORDER BY v.sku',
  stock_movements: 'SELECT m.*, v.sku FROM stock_movements m JOIN variants v ON v.id = m.variant_id ORDER BY m.id',
  purchases: 'SELECT * FROM purchases ORDER BY ordered_at',
  expenses: 'SELECT e.*, c.name AS category_name FROM expenses e JOIN expense_categories c ON c.id = e.category_id ORDER BY e.expense_date',
  payments: 'SELECT * FROM payments ORDER BY paid_at',
};

export function cell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Chống "CSV injection": ô bắt đầu bằng = + - @ bị Excel hiểu là công thức
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(table) {
  const sql = EXPORTS[table];
  if (!sql) return null;
  const rows = getDb().prepare(sql).all();
  if (!rows.length) return '﻿';
  const cols = Object.keys(rows[0]);
  // BOM để Excel mở đúng tiếng Việt
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** Ghép CSV từ tên cột + các dòng giá trị (BOM để Excel mở đúng tiếng Việt, CRLF) */
export function rowsToCsv(headers, rows) {
  return '\uFEFF' + [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';
}
