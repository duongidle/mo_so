-- Kế toán 8b (1/2): chứng từ tay và chi phí định kỳ.
-- Chứng từ tay = một dòng ở `vouchers` + một bút toán `source_type = 'manual'` (is_auto = 0) trong sổ nhật ký.
-- Bút toán tay không bao giờ bị sinh lại; dòng tiền của nó (tài khoản 111x/112x) được cash/balanceOf cộng vào để số dư quỹ khớp sổ cái.

CREATE TABLE vouchers (
  id TEXT PRIMARY KEY,                    -- vch_…
  code TEXT NOT NULL UNIQUE,              -- PT-000001 (thu) | PC-000001 (chi) | BT-… (bút toán tổng hợp); trùng mã bút toán
  type TEXT NOT NULL CHECK (type IN ('receipt','payment','journal')),
  voucher_date TEXT NOT NULL,
  description TEXT NOT NULL,
  shop_id TEXT REFERENCES shops(id),
  partner_type TEXT,                      -- customer | supplier
  partner_id TEXT,
  cash_account_id TEXT REFERENCES cash_accounts(id),   -- phiếu thu/chi: quỹ nào
  counter_account TEXT REFERENCES accounts(code),      -- phiếu thu/chi: tài khoản đối ứng
  total_amount INTEGER NOT NULL,
  entry_id TEXT,
  actor_id TEXT,
  voided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_vouchers_date ON vouchers(voucher_date);

-- Chi phí định kỳ
CREATE TABLE recurring_expenses (
  id TEXT PRIMARY KEY,                    -- rex_…
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  shop_id TEXT REFERENCES shops(id),
  channel_id TEXT REFERENCES channels(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'cash',
  payee TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly','weekly','yearly')),
  day_of_period INTEGER NOT NULL,         -- monthly/yearly: ngày 1–31 (tháng ngắn lấy ngày cuối); weekly: 1 = thứ Hai … 7 = Chủ nhật
  start_date TEXT NOT NULL,
  end_date TEXT,
  next_run_date TEXT,                     -- kỳ chưa tạo gần nhất (tính lại sau mỗi lần chạy)
  skip_before TEXT,                       -- sau khi tiếp tục: bỏ qua các kỳ trước ngày này (không tạo bù thời gian tạm dừng)
  paused_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE expenses ADD COLUMN recurring_id TEXT REFERENCES recurring_expenses(id);
ALTER TABLE expenses ADD COLUMN period_key TEXT;
CREATE UNIQUE INDEX idx_expenses_recurring_period ON expenses(recurring_id, period_key) WHERE recurring_id IS NOT NULL;
