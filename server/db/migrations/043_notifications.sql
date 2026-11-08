-- Thông báo cho chủ shop: hộp thông báo trong app, Telegram, và sự kiện notification.created cho webhook (nối Zalo/email qua dịch vụ ngoài).
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- low_stock | expiring_lots | pending_orders | debts_due | payables_due | payout_overdue | daily_summary | test
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,                          -- đường dẫn trong app để mở
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  dedupe_key TEXT UNIQUE,             -- cùng khoá thì chỉ tạo một lần (vd low_stock:2026-11-08)
  deliveries TEXT,                    -- JSON { telegram: 'sent'|'error: …', webhook: 'queued' }
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX idx_notifications_created ON notifications(created_at);

-- Cấu hình một dòng; token bot nằm riêng khỏi bảng settings để không lộ qua GET /settings hay nhật ký
CREATE TABLE notification_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
