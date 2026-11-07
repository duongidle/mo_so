-- Phí ship nhập trả cho bên vận chuyển (không phải nhà cung cấp).
-- Vẫn chia vào giá vốn như phí ship thường, nhưng KHÔNG nằm trong total_amount (số phải trả NCC):
-- carrier_amount là khoản phải trả bên vận chuyển (tài khoản 3388), carrier_paid_amount là phần đã trả.
ALTER TABLE purchases ADD COLUMN carrier_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN carrier_paid_amount INTEGER NOT NULL DEFAULT 0;
