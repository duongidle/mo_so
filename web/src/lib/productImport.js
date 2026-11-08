// Nhập sản phẩm hàng loạt từ Excel/CSV. Tên cột tự đoán theo từ khoá, người dùng chỉnh lại được.
import { plain } from './carrierStatement.js';

export const FIELDS = [
  ['name', 'Tên sản phẩm', true, ['ten san pham', 'ten hang', 'san pham', 'ten']],
  ['sku', 'Mã SKU', true, ['ma sku', 'sku', 'ma hang', 'ma san pham']],
  ['variant_name', 'Tên biến thể (mùi, size…)', false, ['ten bien the', 'bien the', 'phan loai', 'thuoc tinh']],
  ['price', 'Giá bán', false, ['gia ban', 'don gia', 'gia']],
  ['cost', 'Giá vốn / giá nhập', false, ['gia von', 'gia nhap']],
  ['qty', 'Tồn đầu kỳ', false, ['ton dau', 'ton kho', 'so luong', 'ton']],
  ['warehouse', 'Kho', false, ['kho']],
  ['category', 'Danh mục', false, ['danh muc', 'nhom hang', 'nhom']],
  ['brand', 'Thương hiệu', false, ['thuong hieu', 'nhan hieu', 'hang san xuat']],
  ['unit', 'Đơn vị', false, ['don vi', 'dvt']],
  ['barcode', 'Mã vạch', false, ['ma vach', 'barcode']],
  ['min_stock', 'Tồn tối thiểu', false, ['ton toi thieu', 'dinh muc']],
  ['warranty_days', 'Bảo hành (ngày)', false, ['bao hanh']],
  ['item_type', 'Loại (Hàng bán / Đóng gói / Vận hành)', false, ['loai hang', 'loai']],
  ['description', 'Mô tả', false, ['mo ta', 'ghi chu']],
];

/** Mỗi cột file chỉ gán cho một trường; từ khoá đứng trước (cụ thể hơn) được ưu tiên */
export function guessMapping(columns) {
  const used = new Set();
  const map = {};
  const order = ['variant_name', 'cost', 'min_stock', 'warranty_days', 'barcode', 'sku', 'qty', 'price', 'warehouse', 'category', 'brand', 'unit', 'item_type', 'description', 'name'];
  for (const key of order) {
    const kws = FIELDS.find((f) => f[0] === key)[3];
    for (const kw of kws) {
      const col = columns.find((c) => !used.has(c) && plain(c).includes(kw));
      if (col) { map[key] = col; used.add(col); break; }
    }
  }
  return map;
}

const num = (v) => {
  if (typeof v === 'number') return v;
  const digits = String(v ?? '').replace(/[^\d-]/g, '');
  return digits === '' ? null : parseInt(digits, 10);
};

/** Dòng file → dòng gửi lên máy chủ (bỏ dòng trống hoàn toàn) */
export function rowsFromSheet(rows, map) {
  const text = (r, k) => (map[k] ? String(r[map[k]] ?? '').trim() : '');
  return rows
    .map((r) => ({
      name: text(r, 'name'), sku: text(r, 'sku'), variant_name: text(r, 'variant_name'), warehouse: text(r, 'warehouse'), category: text(r, 'category'), brand: text(r, 'brand'),
      unit: text(r, 'unit'), barcode: text(r, 'barcode'), description: text(r, 'description'), item_type: text(r, 'item_type'),
      price: map.price ? num(r[map.price]) : null, cost: map.cost ? num(r[map.cost]) : null, qty: map.qty ? num(r[map.qty]) : null,
      min_stock: map.min_stock ? num(r[map.min_stock]) : null, warranty_days: map.warranty_days ? num(r[map.warranty_days]) : null,
    }))
    .filter((r) => r.name || r.sku);
}

/** Dòng mẫu cho file tải về */
export const TEMPLATE_HEADERS = ['Tên sản phẩm', 'Mã SKU', 'Tên biến thể', 'Giá bán', 'Giá vốn', 'Tồn đầu kỳ', 'Kho', 'Danh mục', 'Thương hiệu', 'Đơn vị', 'Mã vạch', 'Tồn tối thiểu', 'Bảo hành (ngày)', 'Loại', 'Mô tả'];
export const TEMPLATE_ROWS = [
  ['Nước hoa xe 10ml', 'NH-CAM', 'Cam Gỗ', 129000, 85000, 60, 'Kho nhà', 'Nước hoa ô tô', 'Hương Xe', 'chai', '', 5, '', 'Hàng bán', 'Mùi cam gỗ, lưu hương 30 ngày'],
  ['Nước hoa xe 10ml', 'NH-TRA', 'Trà Xanh', 129000, 85000, 40, 'Kho nhà', 'Nước hoa ô tô', 'Hương Xe', 'chai', '', 5, '', 'Hàng bán', ''],
  ['Hộp quà nhỏ', 'HQ-S', '', 0, 4000, 200, 'Kho nhà', 'Bao bì', '', 'cái', '', 50, '', 'Đóng gói', ''],
];
