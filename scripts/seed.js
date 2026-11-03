// Tạo dữ liệu mẫu để thử app. Chỉ chạy trên DB trống: node scripts/seed.js
import { getDb, tx } from '../server/db/index.js';
import { hashPassword } from '../server/lib/auth.js';
import { newId } from '../server/lib/id.js';
import { nowIso } from '../server/lib/time.js';
import { createWarehouse } from '../server/modules/warehouses/service.js';
import { createShop } from '../server/modules/shops/service.js';
import { createProduct } from '../server/modules/catalog/service.js';
import { createPurchase, createSupplier } from '../server/modules/purchases/service.js';
import { createOrder } from '../server/modules/orders/service.js';
import { setValues } from '../server/modules/custom/service.js';
import { findByPhone } from '../server/modules/customers/service.js';

const db = getDb();
if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) {
  console.log('DB đã có dữ liệu, bỏ qua seed. Xoá thư mục data/ nếu muốn làm lại từ đầu.');
  process.exit(0);
}

tx(() => {
  const at = nowIso();
  const userId = newId('usr');
  db.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at) VALUES (?,?,?,?, 'owner', ?, ?)`).run(
    userId, 'admin', 'Chủ shop', hashPassword('matkhau123'), at, at,
  );
  const actor = { type: 'user', id: userId };
  const wh = createWarehouse({ code: 'K1', name: 'Kho nhà' }, actor);
  const nh = createShop({ code: 'NH', name: 'Nước hoa ô tô', industry: 'nuoc_hoa', default_warehouse_id: wh.id }, actor);
  const pt = createShop({ code: 'PT', name: 'Vật phẩm phong thuỷ', industry: 'phong_thuy', default_warehouse_id: wh.id }, actor);

  const perfume = createProduct({
    name: 'Nước hoa ô tô 10ml', consumption_days: 45, unit: 'chai',
    variants: [
      { sku: 'NH-GO-10', name: 'Gỗ đàn hương', default_price: 150000, min_stock: 5 },
      { sku: 'NH-CAM-10', name: 'Cam bergamot', default_price: 140000, min_stock: 5 },
      { sku: 'NH-OCEAN-10', name: 'Biển xanh', default_price: 140000, min_stock: 5 },
    ],
    shop_ids: [nh.id],
  }, actor);
  const tyHuu = createProduct({ name: 'Tỳ hưu thạch anh vàng', elements: ['Thổ', 'Kim'], unit: 'con', variants: [{ sku: 'PT-TYHUU-VANG', default_price: 520000, min_stock: 2 }], shop_ids: [pt.id] }, actor);
  const vong = createProduct({ name: 'Vòng tay gỗ trầm', elements: ['Mộc'], unit: 'chiếc', variants: [{ sku: 'PT-VONG-TRAM', default_price: 350000, min_stock: 3 }], shop_ids: [pt.id] }, actor);

  const sup = createSupplier({ name: 'Xưởng tinh dầu Bình Dương', phone: '0909000111' }, actor);
  createPurchase({
    supplier_id: sup.id, warehouse_id: wh.id, shop_id: nh.id, shipping_fee: 60000, receive: true, paid_amount: 1000000,
    lines: perfume.variants.map((v) => ({ variant_id: v.id, qty: 20, unit_cost: 45000 })),
  }, actor);
  createPurchase({
    warehouse_id: wh.id, shop_id: pt.id, receive: true,
    lines: [{ variant_id: tyHuu.variants[0].id, qty: 5, unit_cost: 260000 }, { variant_id: vong.variants[0].id, qty: 10, unit_cost: 150000 }],
  }, actor);

  createOrder({ shop_id: nh.id, channel_id: 'direct', customer: { name: 'Anh Tài', phone: '0912345678' }, lines: [{ sku: 'NH-GO-10', qty: 2 }], status: 'completed', payments: [{ amount: 300000, method: 'cash' }] }, actor, { source: 'pos' });
  createOrder({ shop_id: pt.id, channel_id: 'facebook', customer: { name: 'Anh Tài', phone: '0912345678' }, lines: [{ sku: 'PT-TYHUU-VANG', qty: 1 }], shipping_fee: 30000, seller_shipping_amount: 25000, status: 'confirmed' }, actor);
  createOrder({ shop_id: nh.id, channel_id: 'shopee', external_id: '2611030001SPX', customer: { name: 'Chị Lan', phone: '0987654321' }, lines: [{ sku: 'NH-CAM-10', qty: 1, unit_price: 135000 }], platform_fee_amount: 18000, status: 'completed', payments: [{ amount: 117000, method: 'shopee_payout' }] }, actor);
  // Thông tin riêng của khách theo từng shop: cùng một khách, hai shop ghi hai bộ thông tin khác nhau
  const tai = findByPhone('0912345678');
  setValues('customer', tai.id, { ngay_sinh: '1988-03-12', gioi_tinh: 'Nam' }, { shopId: pt.id });
  setValues('customer', tai.id, { nhom_huong: ['Gỗ', 'Biển'], dong_xe: 'Toyota Camry', dip_dung: 'Xe cá nhân' }, { shopId: nh.id });
});
console.log('Đã tạo dữ liệu mẫu. Đăng nhập: admin / matkhau123');
