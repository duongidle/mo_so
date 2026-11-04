-- Nền tảng bán hàng dạng plugin (xem server/lib/platforms.js).
-- Thêm kênh TikTok Shop và Zalo ở trạng thái lưu trữ sẵn (tắt), mẫu import TikTok, phương thức tiền về của TikTok,
-- và cài đặt enabled_platforms: tài khoản cũ giữ hành vi cũ (Shopee + Facebook bật).

INSERT OR IGNORE INTO channels (id, name, is_marketplace, sort_order, archived_at) VALUES
  ('tiktok', 'TikTok Shop', 1, 4, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('zalo', 'Zalo', 0, 5, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Mẫu khởi đầu theo file xuất đơn TikTok Seller Center, chưa kiểm với file thật (ghi rõ trong options.note)
INSERT OR IGNORE INTO import_profiles (id, name, channel_id, column_map, status_map, options, created_at, updated_at) VALUES
('imp_tiktok', 'TikTok Shop — file xuất đơn hàng', 'tiktok',
 '{"external_id":"Order ID","ordered_at":"Created Time","status":"Order Status","customer_name":"Recipient","customer_phone":"Phone #","shipping_address":"Detail Address","sku":"Seller SKU","qty":"Quantity","unit_price":"SKU Unit Original Price","line_discount":"SKU Seller Discount","shipping_fee":"Shipping Fee After Discount","tracking_code":"Tracking ID","carrier":"Shipping Provider Name","note":"Buyer Message"}',
 '{"Completed":"completed","Delivered":"completed","In transit":"shipping","Shipped":"shipping","To ship":"confirmed","Awaiting shipment":"confirmed","Awaiting collection":"confirmed","Unpaid":"draft","Canceled":"cancelled","Cancelled":"cancelled","Hoàn tất":"completed","Đã giao hàng":"completed","Đang vận chuyển":"shipping","Chờ vận chuyển":"confirmed","Chưa thanh toán":"draft","Đã hủy":"cancelled"}',
 '{"note":"Mẫu khởi đầu theo tên cột file xuất đơn của TikTok Seller Center (bản tiếng Anh). Chưa kiểm với file thật và tên cột có thể đổi: kiểm tra lại khi import lần đầu, sửa được ở nút \"Sửa\". File xuất đơn không có phí sàn nên đơn TikTok nhập vào chưa trừ phí; ghi phí khi đối soát payout."}',
 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- tiktok_payout thuộc quỹ ngân hàng (như shopee_payout), trừ khi đã thuộc quỹ khác
UPDATE cash_accounts SET methods = json_insert(methods, '$[#]', 'tiktok_payout')
 WHERE id = 'cac_bank' AND methods NOT LIKE '%tiktok_payout%'
   AND NOT EXISTS (SELECT 1 FROM cash_accounts WHERE archived_at IS NULL AND methods LIKE '%tiktok_payout%');

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('enabled_platforms', '["shopee","facebook"]', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
