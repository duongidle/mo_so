-- M9: hạng khách, nhắc mua lại, mẫu tin nhắn

CREATE TABLE loyalty_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  min_spent INTEGER NOT NULL,          -- tổng chi tiêu thuần 12 tháng gần nhất, mọi shop
  discount_pct INTEGER NOT NULL DEFAULT 0, -- % giảm giá gợi ý khi bán
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO loyalty_tiers (id, name, min_spent, discount_pct, sort_order) VALUES
  ('tier_member', 'Thành viên', 0, 0, 1),
  ('tier_silver', 'Bạc', 2000000, 3, 2),
  ('tier_gold', 'Vàng', 5000000, 5, 3),
  ('tier_diamond', 'Kim cương', 10000000, 8, 4);

CREATE TABLE message_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'reorder' CHECK (kind IN ('reorder','birthday','general')),
  body TEXT NOT NULL,                  -- biến: {ten} {san_pham} {shop}
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO message_templates (id, name, kind, body, created_at, updated_at) VALUES
  ('tpl_reorder', 'Nhắc mua lại', 'reorder', 'Chào {ten}, {san_pham} bên {shop} chắc cũng sắp hết rồi ạ. Mình có cần em gửi thêm không ạ?', '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z'),
  ('tpl_birthday', 'Chúc sinh nhật', 'birthday', 'Chúc mừng sinh nhật {ten}! {shop} chúc anh/chị một tuổi mới nhiều bình an và thuận lợi ạ.', '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z');

-- Trạng thái xử lý nhắc nhở. Khoá gồm cả ngày mua gần nhất: khách mua lại thì nhắc nhở cũ tự hết hiệu lực.
CREATE TABLE reminder_state (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  base_date TEXT NOT NULL,             -- ngày mua gần nhất của sản phẩm này
  status TEXT NOT NULL CHECK (status IN ('done','snoozed','dismissed')),
  snooze_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (customer_id, product_id, base_date)
);
