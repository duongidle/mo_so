-- Huỷ cả phiếu đối soát hãng vận chuyển: phiếu ghi lại từng tác động nó gây ra (khoản thanh toán, chi phí, phiếu trả chờ hàng,
-- đơn chuyển sang hoàn thành, trạng thái vận đơn cũ) để đảo ngược đúng từng thứ, không đoán qua ghi chú.
ALTER TABLE carrier_statements ADD COLUMN voided_at TEXT;
ALTER TABLE carrier_statements ADD COLUMN void_reason TEXT;
ALTER TABLE carrier_statements ADD COLUMN voided_by TEXT;
-- 1 = phiếu có ghi tác động (tạo sau migration này); phiếu cũ hơn không huỷ được vì không biết chắc nó đã tạo những gì
ALTER TABLE carrier_statements ADD COLUMN effects_tracked INTEGER NOT NULL DEFAULT 0;

CREATE TABLE carrier_statement_effects (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES carrier_statements(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('payment','expense','return','order_completed','shipment')),
  ref_id TEXT NOT NULL,          -- payment / expense / return / shipment id; order_completed thì là id đơn
  order_id TEXT,
  before TEXT                    -- JSON trạng thái cũ cần khôi phục (vận đơn, trạng thái đơn trước khi lập phiếu trả)
);
CREATE INDEX idx_stmt_effects ON carrier_statement_effects(statement_id);
