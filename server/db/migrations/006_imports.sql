-- M6: import đơn hàng

CREATE TABLE import_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  column_map TEXT NOT NULL,          -- JSON: { field: "Tên cột trong file" }
  status_map TEXT NOT NULL DEFAULT '{}', -- JSON: { "Hoàn thành": "completed", … }
  options TEXT NOT NULL DEFAULT '{}',    -- JSON: { date_format, header_row, … }
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  channel_id TEXT NOT NULL REFERENCES channels(id),
  profile_id TEXT REFERENCES import_profiles(id),
  file_name TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE import_rows (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id),
  external_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('created','updated','unchanged','error')),
  order_id TEXT REFERENCES orders(id),
  changes TEXT,                      -- JSON mô tả thay đổi
  error TEXT,
  raw TEXT                           -- JSON dữ liệu đã chuẩn hoá gửi lên
);
CREATE INDEX idx_import_rows_batch ON import_rows(batch_id);

-- Mẫu import dựng sẵn cho file theo mẫu chuẩn của app
INSERT INTO import_profiles (id, name, channel_id, column_map, status_map, options, created_at, updated_at) VALUES
('imp_standard', 'Mẫu chuẩn của Tiệm', 'other',
 '{"external_id":"ma_don","ordered_at":"ngay","status":"trang_thai","customer_name":"ten_khach","customer_phone":"sdt","shipping_address":"dia_chi","sku":"sku","qty":"so_luong","unit_price":"don_gia","line_discount":"giam_gia_dong","order_discount":"giam_gia_don","shipping_fee":"phi_ship_khach","platform_fee":"phi_san","seller_shipping":"phi_ship_shop","note":"ghi_chu","tracking_code":"ma_van_don","paid_amount":"da_thanh_toan"}',
 '{}', '{}', datetime('now'), datetime('now')),
('imp_shopee', 'Shopee — file xuất đơn hàng', 'shopee',
 '{"external_id":"Mã đơn hàng","ordered_at":"Ngày đặt hàng","status":"Trạng Thái Đơn Hàng","customer_name":"Tên Người nhận","customer_phone":"Số điện thoại","shipping_address":"Địa chỉ nhận hàng","shopee_username":"Người Mua","sku":"SKU phân loại hàng","sku_fallback":"SKU sản phẩm","qty":"Số lượng","unit_price":"Giá ưu đãi","order_discount":"Mã giảm giá của Shop","shipping_fee":"Phí vận chuyển mà người mua trả","platform_fee":["Phí cố định","Phí Dịch Vụ","Phí thanh toán"],"tracking_code":"Mã vận đơn","carrier":"Đơn Vị Vận Chuyển","note":"Nhận xét từ Người mua"}',
 '{"Hoàn thành":"completed","Đã giao":"completed","Đang giao":"shipping","Chờ lấy hàng":"confirmed","Chờ giao hàng":"confirmed","Chờ xác nhận":"confirmed","Đã hủy":"cancelled","Đã huỷ":"cancelled","Trả hàng/Hoàn tiền":"returned"}',
 '{"note":"Tên cột Shopee có thể thay đổi theo thời gian — kiểm tra lại khi import lần đầu"}', datetime('now'), datetime('now'));
