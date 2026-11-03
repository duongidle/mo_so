-- Bảng tổng hợp theo (ngày, shop, kênh) cho báo cáo. Chỉ là bộ nhớ đệm của bảng `orders`: tính lại được bất cứ lúc nào.
-- Chống lệch số bằng trigger: MỌI thay đổi trên `orders` (tạo, sửa, đổi trạng thái, trả hàng, import…) đều đánh dấu ô tương ứng
-- là "bẩn"; báo cáo tính lại các ô bẩn trước khi đọc. Không phụ thuộc việc code nghiệp vụ có nhớ cập nhật hay không.
CREATE TABLE daily_stats (
  business_date TEXT NOT NULL,
  shop_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  order_count INTEGER NOT NULL DEFAULT 0,
  cancelled_count INTEGER NOT NULL DEFAULT 0,
  returned_count INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  goods_revenue INTEGER NOT NULL DEFAULT 0,
  returned_amount INTEGER NOT NULL DEFAULT 0,
  net_revenue INTEGER NOT NULL DEFAULT 0,
  shipping_fee INTEGER NOT NULL DEFAULT 0,
  platform_fee INTEGER NOT NULL DEFAULT 0,
  seller_shipping INTEGER NOT NULL DEFAULT 0,
  cogs INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (business_date, shop_id, channel_id)
);
CREATE INDEX idx_daily_stats_shop ON daily_stats(shop_id, business_date);

CREATE TABLE daily_stats_dirty (
  business_date TEXT NOT NULL,
  shop_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (business_date, shop_id, channel_id)
);

CREATE TRIGGER orders_stats_ai AFTER INSERT ON orders BEGIN
  INSERT OR IGNORE INTO daily_stats_dirty VALUES (NEW.business_date, NEW.shop_id, NEW.channel_id);
END;
CREATE TRIGGER orders_stats_au AFTER UPDATE ON orders BEGIN
  INSERT OR IGNORE INTO daily_stats_dirty VALUES (NEW.business_date, NEW.shop_id, NEW.channel_id);
  INSERT OR IGNORE INTO daily_stats_dirty VALUES (OLD.business_date, OLD.shop_id, OLD.channel_id);
END;
CREATE TRIGGER orders_stats_ad AFTER DELETE ON orders BEGIN
  INSERT OR IGNORE INTO daily_stats_dirty VALUES (OLD.business_date, OLD.shop_id, OLD.channel_id);
END;

-- Đơn đã có: đánh dấu tất cả để lần đọc báo cáo đầu tiên dựng bảng
INSERT OR IGNORE INTO daily_stats_dirty SELECT DISTINCT business_date, shop_id, channel_id FROM orders;
