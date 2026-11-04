-- Kế toán kép (Phase 8a): sổ cái DẪN XUẤT từ chứng từ gốc, cùng mẫu với daily_stats (migration 017).
-- Trigger trên các bảng chứng từ đánh dấu (source_type, source_id) vào journal_dirty; trước mỗi lần đọc sổ kế toán,
-- flushJournal() xoá bút toán TỰ ĐỘNG cũ của chứng từ bẩn rồi sinh lại từ trạng thái hiện tại (server/modules/accounting).
-- Bút toán tay (is_auto = 0, source_type = 'manual', làm ở 8b) không bao giờ bị sinh lại.

CREATE TABLE accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','contra_revenue','expense')),
  parent_code TEXT REFERENCES accounts(code),
  normal_side TEXT NOT NULL CHECK (normal_side IN ('debit','credit')),
  is_system INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO accounts (code, name, type, parent_code, normal_side, is_system) VALUES
  ('111', 'Tiền mặt', 'asset', NULL, 'debit', 1),
  ('112', 'Tiền gửi ngân hàng, ví', 'asset', NULL, 'debit', 1),
  ('1131', 'Tiền đang chuyển (phương thức chưa gán quỹ)', 'asset', NULL, 'debit', 1),
  ('131', 'Phải thu khách hàng', 'asset', NULL, 'debit', 1),
  ('1388', 'Phải thu sàn thương mại điện tử', 'asset', NULL, 'debit', 1),
  ('156', 'Hàng hoá', 'asset', NULL, 'debit', 1),
  ('211', 'Tài sản cố định', 'asset', NULL, 'debit', 1),
  ('214', 'Hao mòn tài sản cố định', 'asset', NULL, 'credit', 1),
  ('242', 'Chi phí trả trước', 'asset', NULL, 'debit', 1),
  ('331', 'Phải trả người bán', 'liability', NULL, 'credit', 1),
  ('3388', 'Phải trả khác', 'liability', NULL, 'credit', 1),
  ('411', 'Vốn chủ sở hữu', 'equity', NULL, 'credit', 1),
  ('421', 'Lợi nhuận chưa phân phối', 'equity', NULL, 'credit', 1),
  ('5111', 'Doanh thu bán hàng', 'revenue', NULL, 'credit', 1),
  ('5113', 'Doanh thu phí vận chuyển', 'revenue', NULL, 'credit', 1),
  ('5212', 'Hàng bán bị trả lại', 'contra_revenue', NULL, 'debit', 1),
  ('632', 'Giá vốn hàng bán', 'expense', NULL, 'debit', 1),
  ('6411', 'Phí sàn', 'expense', NULL, 'debit', 1),
  ('6412', 'Vận chuyển', 'expense', NULL, 'debit', 1),
  ('6413', 'Quảng cáo', 'expense', NULL, 'debit', 1),
  ('6414', 'Bao bì', 'expense', NULL, 'debit', 1),
  ('6418', 'Chi phí bán hàng khác', 'expense', NULL, 'debit', 1),
  ('6422', 'Mặt bằng, điện nước', 'expense', NULL, 'debit', 1),
  ('6428', 'Chi phí quản lý khác', 'expense', NULL, 'debit', 1),
  ('711', 'Thu nhập khác', 'revenue', NULL, 'credit', 1),
  ('811', 'Chi phí khác (tiền phạt, hao hụt)', 'expense', NULL, 'debit', 1);

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,                  -- je_…
  code TEXT NOT NULL UNIQUE,            -- BT-000001, giữ nguyên khi sinh lại cùng chứng từ
  entry_date TEXT NOT NULL,             -- ngày hạch toán (giờ VN)
  business_date TEXT NOT NULL,
  description TEXT NOT NULL,
  source_type TEXT NOT NULL,            -- order | return | payment | purchase | expense | stock | cash_open | cash_entry | manual
  source_id TEXT,
  shop_id TEXT,
  is_auto INTEGER NOT NULL DEFAULT 1,
  voided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_je_source ON journal_entries(source_type, source_id);
CREATE INDEX idx_je_date ON journal_entries(entry_date);

CREATE TABLE journal_lines (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL REFERENCES accounts(code),
  debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  shop_id TEXT,
  channel_id TEXT,
  partner_type TEXT,                    -- customer | supplier
  partner_id TEXT,
  memo TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX idx_jl_entry ON journal_lines(entry_id);
CREATE INDEX idx_jl_account ON journal_lines(account_code);
CREATE INDEX idx_jl_shop ON journal_lines(shop_id);

CREATE TABLE journal_dirty (
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (source_type, source_id)
);

-- Danh mục chi phí → tài khoản chi phí
ALTER TABLE expense_categories ADD COLUMN account_code TEXT REFERENCES accounts(code);
UPDATE expense_categories SET account_code = CASE id
  WHEN 'ecat_ads' THEN '6413' WHEN 'ecat_platform' THEN '6411' WHEN 'ecat_shipping' THEN '6412'
  WHEN 'ecat_packaging' THEN '6414' WHEN 'ecat_rent' THEN '6422' ELSE '6428' END;
INSERT OR IGNORE INTO expense_categories (id, name, sort_order, account_code) VALUES
  ('ecat_fine', 'Tiền phạt', 7, '811'),
  ('ecat_ops', 'Vận hành', 8, '6428');

-- Quỹ tiền → tài khoản con 111x (tiền mặt) / 112x (ngân hàng, ví)
ALTER TABLE cash_accounts ADD COLUMN account_code TEXT REFERENCES accounts(code);
INSERT INTO accounts (code, name, type, parent_code, normal_side, is_system)
  SELECT (CASE WHEN kind = 'cash' THEN '111' ELSE '112' END) || ROW_NUMBER() OVER (PARTITION BY (kind = 'cash') ORDER BY created_at, id),
         'Quỹ: ' || name, 'asset', CASE WHEN kind = 'cash' THEN '111' ELSE '112' END, 'debit', 1
  FROM cash_accounts;
UPDATE cash_accounts SET account_code = (
  SELECT x.code FROM (
    SELECT id, (CASE WHEN kind = 'cash' THEN '111' ELSE '112' END) || ROW_NUMBER() OVER (PARTITION BY (kind = 'cash') ORDER BY created_at, id) AS code
    FROM cash_accounts) x WHERE x.id = cash_accounts.id);

-- Quỹ mới (từ bất kỳ đường nào) tự có tài khoản con; đổi tên quỹ thì tên tài khoản đi theo
CREATE TRIGGER cash_accounts_gl_ai AFTER INSERT ON cash_accounts WHEN NEW.account_code IS NULL BEGIN
  UPDATE cash_accounts SET account_code = (CASE WHEN NEW.kind = 'cash' THEN '111' ELSE '112' END)
    || ((SELECT COUNT(*) FROM accounts WHERE parent_code = (CASE WHEN NEW.kind = 'cash' THEN '111' ELSE '112' END)) + 1)
    WHERE id = NEW.id;
  INSERT INTO accounts (code, name, type, parent_code, normal_side, is_system)
    SELECT account_code, 'Quỹ: ' || name, 'asset', CASE WHEN kind = 'cash' THEN '111' ELSE '112' END, 'debit', 1 FROM cash_accounts WHERE id = NEW.id;
  INSERT OR IGNORE INTO journal_dirty VALUES ('cash_open', NEW.id);
END;
CREATE TRIGGER cash_accounts_gl_name AFTER UPDATE OF name ON cash_accounts BEGIN
  UPDATE accounts SET name = 'Quỹ: ' || NEW.name WHERE code = NEW.account_code;
END;
CREATE TRIGGER cash_accounts_gl_au AFTER UPDATE ON cash_accounts BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('cash_open', NEW.id);
END;
-- Đổi phương thức/ngày mở sổ của quỹ làm đổi tài khoản tiền của mọi thu chi: sinh lại hết
CREATE TRIGGER cash_accounts_gl_map AFTER UPDATE ON cash_accounts
  WHEN OLD.methods IS NOT NEW.methods OR OLD.opening_date IS NOT NEW.opening_date OR (OLD.account_code IS NOT NULL AND OLD.account_code IS NOT NEW.account_code) OR OLD.archived_at IS NOT NEW.archived_at BEGIN
  INSERT OR IGNORE INTO journal_dirty SELECT 'payment', id FROM payments;
  INSERT OR IGNORE INTO journal_dirty SELECT 'expense', id FROM expenses;
  INSERT OR IGNORE INTO journal_dirty SELECT 'cash_entry', COALESCE(pair_id, id) FROM cash_entries;
END;

CREATE TRIGGER expense_categories_gl_au AFTER UPDATE OF account_code ON expense_categories BEGIN
  INSERT OR IGNORE INTO journal_dirty SELECT 'expense', id FROM expenses WHERE category_id = NEW.id;
END;

-- Trigger đánh dấu chứng từ bẩn
CREATE TRIGGER orders_gl_ai AFTER INSERT ON orders BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('order', NEW.id);
END;
CREATE TRIGGER orders_gl_au AFTER UPDATE ON orders BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('order', NEW.id);
  INSERT OR IGNORE INTO journal_dirty SELECT 'return', id FROM order_returns WHERE order_id = NEW.id;
END;
CREATE TRIGGER orders_gl_ad AFTER DELETE ON orders BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('order', OLD.id);
END;
CREATE TRIGGER order_lines_gl_ai AFTER INSERT ON order_lines BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('order', NEW.order_id);
END;
CREATE TRIGGER order_lines_gl_au AFTER UPDATE ON order_lines BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('order', NEW.order_id);
END;
CREATE TRIGGER order_lines_gl_ad AFTER DELETE ON order_lines BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('order', OLD.order_id);
END;
CREATE TRIGGER order_allocs_gl_ai AFTER INSERT ON order_line_allocations BEGIN
  INSERT OR IGNORE INTO journal_dirty SELECT 'order', order_id FROM order_lines WHERE id = NEW.order_line_id;
END;
CREATE TRIGGER order_allocs_gl_au AFTER UPDATE ON order_line_allocations BEGIN
  INSERT OR IGNORE INTO journal_dirty SELECT 'order', order_id FROM order_lines WHERE id = NEW.order_line_id;
END;
CREATE TRIGGER returns_gl_ai AFTER INSERT ON order_returns BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('return', NEW.id);
END;
CREATE TRIGGER returns_gl_au AFTER UPDATE ON order_returns BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('return', NEW.id);
END;
CREATE TRIGGER returns_gl_ad AFTER DELETE ON order_returns BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('return', OLD.id);
END;
CREATE TRIGGER purchases_gl_ai AFTER INSERT ON purchases BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('purchase', NEW.id);
END;
CREATE TRIGGER purchases_gl_au AFTER UPDATE ON purchases BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('purchase', NEW.id);
END;
CREATE TRIGGER purchases_gl_ad AFTER DELETE ON purchases BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('purchase', OLD.id);
END;
CREATE TRIGGER payments_gl_ai AFTER INSERT ON payments BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('payment', NEW.id);
END;
CREATE TRIGGER payments_gl_au AFTER UPDATE ON payments BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('payment', NEW.id);
END;
CREATE TRIGGER payments_gl_ad AFTER DELETE ON payments BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('payment', OLD.id);
END;
CREATE TRIGGER expenses_gl_ai AFTER INSERT ON expenses BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('expense', NEW.id);
END;
CREATE TRIGGER expenses_gl_au AFTER UPDATE ON expenses BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('expense', NEW.id);
END;
CREATE TRIGGER expenses_gl_ad AFTER DELETE ON expenses BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('expense', OLD.id);
END;
CREATE TRIGGER cash_entries_gl_ai AFTER INSERT ON cash_entries BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('cash_entry', COALESCE(NEW.pair_id, NEW.id));
END;
CREATE TRIGGER cash_entries_gl_au AFTER UPDATE ON cash_entries BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('cash_entry', COALESCE(NEW.pair_id, NEW.id));
END;
CREATE TRIGGER cash_entries_gl_ad AFTER DELETE ON cash_entries BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('cash_entry', COALESCE(OLD.pair_id, OLD.id));
END;
-- Kho: chỉ các loại không đi kèm chứng từ khác (điều chỉnh, hỏng, tồn đầu kỳ). Bán/nhập/trả đã nằm trong đơn và phiếu nhập; chuyển kho không bút toán.
CREATE TRIGGER stock_movements_gl_ai AFTER INSERT ON stock_movements WHEN NEW.type IN ('adjust_in','adjust_out','damage_out','opening') BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('stock', COALESCE(NEW.ref_id, NEW.id));
END;
CREATE TRIGGER stock_movements_gl_ad AFTER DELETE ON stock_movements WHEN OLD.type IN ('adjust_in','adjust_out','damage_out','opening') BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('stock', COALESCE(OLD.ref_id, OLD.id));
END;

-- Dữ liệu đã có: đánh dấu hết để lần đọc sổ kế toán đầu tiên dựng toàn bộ sổ cái
INSERT OR IGNORE INTO journal_dirty SELECT 'order', id FROM orders;
INSERT OR IGNORE INTO journal_dirty SELECT 'return', id FROM order_returns;
INSERT OR IGNORE INTO journal_dirty SELECT 'purchase', id FROM purchases;
INSERT OR IGNORE INTO journal_dirty SELECT 'payment', id FROM payments;
INSERT OR IGNORE INTO journal_dirty SELECT 'expense', id FROM expenses;
INSERT OR IGNORE INTO journal_dirty SELECT 'cash_open', id FROM cash_accounts;
INSERT OR IGNORE INTO journal_dirty SELECT 'cash_entry', COALESCE(pair_id, id) FROM cash_entries;
INSERT OR IGNORE INTO journal_dirty SELECT 'stock', COALESCE(ref_id, id) FROM stock_movements WHERE type IN ('adjust_in','adjust_out','damage_out','opening');
