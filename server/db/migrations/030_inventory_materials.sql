ALTER TABLE products ADD COLUMN item_type TEXT NOT NULL DEFAULT 'product' CHECK (item_type IN ('product','packaging','supply'));
ALTER TABLE products ADD COLUMN default_supplier_id TEXT REFERENCES suppliers(id);
ALTER TABLE stock_movements ADD COLUMN expense_account_code TEXT;

CREATE TABLE packaging_specs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  material_variant_id TEXT NOT NULL REFERENCES variants(id),
  qty REAL NOT NULL CHECK (qty > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(product_id, material_variant_id)
);
CREATE INDEX idx_packaging_specs_product ON packaging_specs(product_id);

CREATE TABLE packaging_runs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  shop_id TEXT REFERENCES shops(id),
  note TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE material_issues (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  purpose TEXT NOT NULL,
  expense_account_code TEXT NOT NULL DEFAULT '6428',
  shop_id TEXT REFERENCES shops(id),
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_material_issues_created ON material_issues(created_at);
