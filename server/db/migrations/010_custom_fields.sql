-- M10: trường tuỳ chỉnh, công thức, chỉ số báo cáo tuỳ chỉnh

CREATE TABLE custom_fields (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product','customer','order','purchase')),
  key TEXT NOT NULL,                       -- dùng trong công thức: {custom.key}
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','number','money','date','select','multiselect','boolean','formula')),
  options TEXT,                            -- JSON mảng lựa chọn (select / multiselect)
  formula TEXT,                            -- khi type = formula
  shop_id TEXT REFERENCES shops(id),       -- NULL = toàn hệ thống (cộng gộp được giữa shop)
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_custom_fields_key ON custom_fields(entity_type, key) WHERE archived_at IS NULL;

CREATE TABLE custom_values (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_id TEXT NOT NULL REFERENCES custom_fields(id),
  value_text TEXT,
  value_num REAL,
  PRIMARY KEY (entity_type, entity_id, field_id)
);
CREATE INDEX idx_custom_values_field ON custom_values(field_id);

CREATE TABLE report_metrics (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  formula TEXT NOT NULL,                   -- trên chỉ số tổng hợp: {net_revenue} / {order_count}
  format TEXT NOT NULL DEFAULT 'number' CHECK (format IN ('number','money','percent')),
  shop_id TEXT REFERENCES shops(id),       -- NULL = áp dụng mọi shop
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
