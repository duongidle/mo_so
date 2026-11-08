-- Hãng vận chuyển, vận đơn của đơn, phiếu đối soát với hãng (COD thu hộ, phí giao, phí COD, phí hoàn).
CREATE TABLE carriers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tracking_url TEXT,              -- mẫu link tra cứu, dùng {code} thay cho mã vận đơn
  remit_note TEXT,                -- lịch hãng chuyển tiền (ghi chú tự do, vd "GHN: hằng ngày")
  archived_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  carrier_id TEXT NOT NULL REFERENCES carriers(id),
  tracking_code TEXT NOT NULL,
  cod_amount INTEGER NOT NULL DEFAULT 0,        -- tiền hãng phải thu hộ khách
  status TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit','delivered','returned','lost')),
  shipped_at TEXT NOT NULL,
  delivered_at TEXT,
  returned_at TEXT,
  statement_id TEXT,                             -- phiếu đối soát đã chốt khoản này
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_shipments_tracking ON shipments(carrier_id, tracking_code);
CREATE INDEX idx_shipments_order ON shipments(order_id);
CREATE INDEX idx_shipments_status ON shipments(status, statement_id);

CREATE TABLE carrier_statements (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  carrier_id TEXT NOT NULL REFERENCES carriers(id),
  statement_date TEXT NOT NULL,
  total_cod INTEGER NOT NULL DEFAULT 0,          -- COD đã ghi nhận thu về
  total_fees INTEGER NOT NULL DEFAULT 0,         -- Σ phí giao, COD, hoàn, khác hãng trừ
  net_amount INTEGER NOT NULL DEFAULT 0,         -- tiền hãng chuyển về = COD − phí
  line_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE carrier_statement_lines (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES carrier_statements(id) ON DELETE CASCADE,
  tracking_code TEXT NOT NULL,
  shipment_id TEXT,
  order_id TEXT,
  outcome TEXT NOT NULL,                         -- delivered | returned
  cod_stated INTEGER NOT NULL DEFAULT 0,
  cod_recorded INTEGER NOT NULL DEFAULT 0,
  ship_fee INTEGER NOT NULL DEFAULT 0,
  cod_fee INTEGER NOT NULL DEFAULT 0,
  return_fee INTEGER NOT NULL DEFAULT 0,
  other_fee INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL,                          -- applied | not_found | already_reconciled | skipped
  warning TEXT
);
CREATE INDEX idx_stmt_lines ON carrier_statement_lines(statement_id);

-- Tiền hãng chuyển về thuộc quỹ ngân hàng như tiền sàn chuyển về
UPDATE cash_accounts SET methods = json_insert(methods, '$[#]', 'carrier_payout')
 WHERE id = 'cac_bank' AND methods NOT LIKE '%carrier_payout%'
   AND NOT EXISTS (SELECT 1 FROM cash_accounts WHERE archived_at IS NULL AND methods LIKE '%carrier_payout%');
