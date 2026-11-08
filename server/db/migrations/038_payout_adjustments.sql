-- Chênh lệch khi đối soát tiền sàn: sàn trả khác số kỳ vọng (phí/phạt/điều chỉnh sau khi chốt đơn).
-- Phần lệch được cộng vào phí sàn của chính đơn đó nên lãi từng đơn đúng; bảng này giữ dấu vết để tra.
CREATE TABLE payout_adjustments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  shop_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  expected_amount INTEGER NOT NULL,   -- số còn treo trước khi sàn trả
  received_amount INTEGER NOT NULL,   -- số sàn thực trả
  fee_delta INTEGER NOT NULL,         -- phí sàn của đơn tăng (+) hoặc giảm (−) bấy nhiêu
  note TEXT,
  business_date TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_payout_adj_date ON payout_adjustments(business_date);
