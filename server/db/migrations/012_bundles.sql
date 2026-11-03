-- Combo: biến thể loại 'bundle' gồm nhiều biến thể thành phần. Bán combo trừ kho thành phần, combo không có tồn riêng.

ALTER TABLE variants ADD COLUMN kind TEXT NOT NULL DEFAULT 'single' CHECK (kind IN ('single','bundle'));

CREATE TABLE bundle_components (
  bundle_variant_id TEXT NOT NULL REFERENCES variants(id),
  component_variant_id TEXT NOT NULL REFERENCES variants(id),
  qty INTEGER NOT NULL CHECK (qty > 0),     -- số thành phần trong MỘT combo
  PRIMARY KEY (bundle_variant_id, component_variant_id)
);
CREATE INDEX idx_bundle_components_component ON bundle_components(component_variant_id);

-- Ảnh chụp thành phần và giá vốn tại lúc bán. Dùng để hoàn kho/trả hàng đúng, kể cả khi công thức combo đổi sau này.
CREATE TABLE order_line_components (
  id TEXT PRIMARY KEY,
  order_line_id TEXT NOT NULL REFERENCES order_lines(id),
  variant_id TEXT NOT NULL REFERENCES variants(id),
  per_bundle_qty INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL
);
CREATE INDEX idx_olc_line ON order_line_components(order_line_id);
