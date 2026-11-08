-- Giá bán riêng theo kênh (Shopee thường cao hơn để bù phí sàn). Không có dòng = dùng giá niêm yết của shop.
CREATE TABLE channel_prices (
  variant_id TEXT NOT NULL REFERENCES variants(id),
  shop_id TEXT NOT NULL REFERENCES shops(id),
  channel_id TEXT NOT NULL REFERENCES channels(id),
  price INTEGER NOT NULL CHECK (price >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, channel_id, variant_id)
);
CREATE INDEX idx_channel_prices_variant ON channel_prices(variant_id);
