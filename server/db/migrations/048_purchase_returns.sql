-- Trả hàng nhập (trả hàng cho nhà cung cấp) và giảm giá sau nhận.
-- Chỉ THÊM cột/bảng. total_amount của phiếu nhập giữ nguyên (số NCC đòi lúc nhận); phần được giảm nằm ở returned_amount và allowance_amount.
-- Nợ NCC còn lại = total_amount - returned_amount - allowance_amount - paid_amount (paid_amount là số đã trả ròng: trả ra trừ NCC hoàn lại).
-- Âm = NCC còn nợ shop.
ALTER TABLE purchases ADD COLUMN returned_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN allowance_amount INTEGER NOT NULL DEFAULT 0;

CREATE TABLE purchase_returns (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                     -- TN-YYMMDD-001
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  supplier_id TEXT,
  warehouse_id TEXT NOT NULL,
  shop_id TEXT,
  returned_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  goods_amount INTEGER NOT NULL DEFAULT 0,       -- NCC trả lại theo giá mua (đã trừ chiết khấu); giảm nợ NCC
  stock_value INTEGER NOT NULL DEFAULT 0,        -- giá trị xuất kho (theo giá nhập đã phân bổ); chênh với goods_amount là phí nhập không hoàn
  refund_amount INTEGER NOT NULL DEFAULT 0,      -- NCC hoàn tiền ngay
  refund_payment_id TEXT,
  reason TEXT,
  note TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX idx_purchase_returns_purchase ON purchase_returns(purchase_id);

CREATE TABLE purchase_return_lines (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES purchase_returns(id),
  purchase_line_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  qty REAL NOT NULL,
  goods_amount INTEGER NOT NULL DEFAULT 0,
  stock_value INTEGER NOT NULL DEFAULT 0,
  lots TEXT                                      -- JSON: lô đã rút, để huỷ phiếu trả đưa lại đúng lô
);
CREATE INDEX idx_purchase_return_lines_ret ON purchase_return_lines(return_id);
CREATE INDEX idx_purchase_return_lines_pl ON purchase_return_lines(purchase_line_id);

CREATE TABLE purchase_allowances (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                     -- GG-YYMMDD-001
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  supplier_id TEXT,
  warehouse_id TEXT NOT NULL,
  shop_id TEXT,
  amount INTEGER NOT NULL,                       -- NCC bớt
  stock_amount INTEGER NOT NULL DEFAULT 0,       -- phần ứng với hàng còn tồn: giảm giá trị tồn kho (Có 156)
  sold_amount INTEGER NOT NULL DEFAULT 0,        -- phần ứng với hàng đã bán: thu nhập khác (Có 711), không sửa giá vốn đã chụp
  refund_amount INTEGER NOT NULL DEFAULT 0,
  refund_payment_id TEXT,
  reason TEXT,
  allowed_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX idx_purchase_allowances_purchase ON purchase_allowances(purchase_id);

CREATE TABLE purchase_allowance_lines (
  id TEXT PRIMARY KEY,
  allowance_id TEXT NOT NULL REFERENCES purchase_allowances(id),
  purchase_line_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  stock_amount INTEGER NOT NULL DEFAULT 0,
  sold_amount INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_purchase_allowance_lines_al ON purchase_allowance_lines(allowance_id);
CREATE INDEX idx_purchase_allowance_lines_pl ON purchase_allowance_lines(purchase_line_id);

-- Sổ kế toán dẫn xuất: đánh dấu bẩn khi phiếu trả / phiếu giảm giá đổi
CREATE TRIGGER purchase_returns_gl_ai AFTER INSERT ON purchase_returns BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('purchase_return', NEW.id);
END;
CREATE TRIGGER purchase_returns_gl_au AFTER UPDATE ON purchase_returns BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('purchase_return', NEW.id);
END;
CREATE TRIGGER purchase_returns_gl_ad AFTER DELETE ON purchase_returns BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('purchase_return', OLD.id);
END;
CREATE TRIGGER purchase_allowances_gl_ai AFTER INSERT ON purchase_allowances BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('purchase_allowance', NEW.id);
END;
CREATE TRIGGER purchase_allowances_gl_au AFTER UPDATE ON purchase_allowances BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('purchase_allowance', NEW.id);
END;
CREATE TRIGGER purchase_allowances_gl_ad AFTER DELETE ON purchase_allowances BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('purchase_allowance', OLD.id);
END;
-- Dòng phiếu trả đổi sau khi phiếu đã có (không xảy ra hôm nay, nhưng sổ phải đúng nếu có): đánh dấu phiếu cha
CREATE TRIGGER purchase_return_lines_gl_ai AFTER INSERT ON purchase_return_lines BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('purchase_return', NEW.return_id);
END;
CREATE TRIGGER purchase_allowance_lines_gl_ai AFTER INSERT ON purchase_allowance_lines BEGIN
  INSERT OR IGNORE INTO journal_dirty VALUES ('purchase_allowance', NEW.allowance_id);
END;
