-- Hạn thanh toán và nhắc nợ: khách nợ đơn bán, shop nợ nhà cung cấp.
ALTER TABLE orders ADD COLUMN due_date TEXT;             -- hạn khách thanh toán (YYYY-MM-DD)
ALTER TABLE orders ADD COLUMN debt_remind_after TEXT;    -- đã nhắc/hoãn: chưa nhắc lại trước ngày này
ALTER TABLE purchases ADD COLUMN due_date TEXT;          -- hạn trả nhà cung cấp

-- Mẫu tin có thêm loại "nhắc nợ" (SQLite không sửa được ràng buộc CHECK nên dựng lại bảng)
CREATE TABLE message_templates_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'reorder' CHECK (kind IN ('reorder','birthday','general','debt')),
  body TEXT NOT NULL,                  -- biến: {ten} {san_pham} {shop} {ma_don} {con_no} {han_tra}
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO message_templates_new SELECT id, name, kind, body, created_at, updated_at FROM message_templates;
DROP TABLE message_templates;
ALTER TABLE message_templates_new RENAME TO message_templates;
INSERT INTO message_templates (id, name, kind, body, created_at, updated_at) VALUES
  ('tpl_debt', 'Nhắc thanh toán', 'debt', 'Chào {ten}, {shop} xin nhắc đơn {ma_don} còn {con_no} chưa thanh toán (hạn {han_tra}). Anh/chị vui lòng thanh toán giúp {shop} ạ. Xin cảm ơn.', '2026-11-08T00:00:00.000Z', '2026-11-08T00:00:00.000Z');
