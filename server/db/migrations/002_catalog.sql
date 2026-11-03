-- M2: sản phẩm gốc, biến thể, niêm yết theo shop

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES categories(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category_id TEXT REFERENCES categories(id),
  unit TEXT NOT NULL DEFAULT 'cái',
  image_url TEXT,
  brand TEXT,
  consumption_days INTEGER,         -- chu kỳ dùng hết (ngày), dùng để nhắc mua lại
  elements TEXT,                    -- JSON mảng ngũ hành hợp: ["Kim","Thuỷ"]
  tags TEXT,                        -- JSON mảng
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_products_category ON products(category_id);

CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL UNIQUE,
  name TEXT,                        -- vd "Mùi Gỗ đàn hương 10ml"; NULL = biến thể mặc định
  barcode TEXT,
  default_price INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0, -- mức tồn tối thiểu cảnh báo
  weight_gram INTEGER,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_variants_product ON variants(product_id);
CREATE INDEX idx_variants_barcode ON variants(barcode);

CREATE TABLE shop_listings (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  variant_id TEXT NOT NULL REFERENCES variants(id),
  price INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id, variant_id)
);
CREATE INDEX idx_listings_variant ON shop_listings(variant_id);
