// Thêm dữ liệu mẫu đầy đủ mọi module vào MỘT tài khoản có sẵn (không xoá gì cũ):
//   node scripts/seed-demo.js [tên_đăng_nhập]     (mặc định admin_test)
// Đi qua đúng API (có kiểm dữ liệu) bằng một phiên tạm trong master.db, xong là xoá phiên.
// Chạy lại lần hai sẽ bị chặn (đã có SKU mẫu). Nên tắt server khi chạy để tránh tranh DB.
import { bootstrapTenancy, getMaster, listAccounts } from '../server/db/tenancy.js';
import { createApp } from '../server/app.js';
import { sha256, SESSION_COOKIE } from '../server/lib/auth.js';
import { randomToken } from '../server/lib/id.js';

bootstrapTenancy();
const username = process.argv[2] || 'admin_test';
const acc = listAccounts().find((a) => a.username === username);
if (!acc) { console.error(`Không có tài khoản ${username}`); process.exit(1); }

const token = randomToken(32);
const sid = sha256(token);
getMaster().prepare('INSERT INTO sessions (id, account_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)')
  .run(sid, acc.id, new Date().toISOString(), new Date(Date.now() + 3600e3).toISOString(), 'seed-demo');
const app = createApp();

async function call(method, path, body, headers = {}) {
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error?.code || ''} ${json.error?.message || ''}`);
  return json.data ?? json;
}
const post = (p, b, h) => call('POST', p, b, h);
const get = (p) => call('GET', p);
const put = (p, b) => call('PUT', p, b);
const fails = [];
let n = 0;
async function step(name, fn) {
  try { const r = await fn(); n++; console.log(`✓ ${name}`); return r; } catch (e) { fails.push(`${name}: ${e.message}`); console.log(`✗ ${name}: ${e.message}`); return null; }
}

const DAY = 86400000;
const ago = (d, h = 10) => { const t = new Date(Date.now() - d * DAY); t.setUTCHours(h - 7, 15, 0, 0); return t.toISOString(); }; // h = giờ VN
const dateOf = (d) => new Date(Date.now() - d * DAY + 7 * 3600e3).toISOString().slice(0, 10);

try {
  if ((await get('/variants?q=DM-NH-GO&limit=5').catch(() => [])).length) throw new Error('Đã có dữ liệu mẫu (SKU DM-NH-GO). Dừng để khỏi nhân đôi.');

  const S = {};
  const shops = await get('/shops'); const whs = await get('/warehouses');
  S.ptShop = shops.find((s) => s.industry === 'phong_thuy') || shops[0];
  S.k1 = whs[0];

  // ---------- Shop, kho, nền tảng, kênh ----------
  S.k2 = await step('Kho cửa hàng K2', () => post('/warehouses', { code: 'K2', name: 'Kho cửa hàng' }));
  S.nh = await step('Shop nước hoa ô tô', () => post('/shops', { code: 'NHOT', name: 'Nước hoa ô tô', industry: 'nuoc_hoa_o_to', default_warehouse_id: S.k1.id, phone: '0909111222', address: '12 Lê Lợi, Q.1, TP.HCM' }));
  S.nc = await step('Shop nước hoa', () => post('/shops', { code: 'NHC', name: 'Nước hoa Niche', industry: 'nuoc_hoa', default_warehouse_id: S.k2?.id || S.k1.id, phone: '0909333444', address: '45 Nguyễn Huệ, Q.1, TP.HCM' }));
  if (S.k2) {
    await step('Kho ưu tiên shop ô tô (K1→K2)', () => put(`/shops/${S.nh.id}/warehouses`, { warehouse_ids: [S.k1.id, S.k2.id] }));
    await step('Kho ưu tiên shop phong thuỷ (K1→K2)', () => put(`/shops/${S.ptShop.id}/warehouses`, { warehouse_ids: [S.k1.id, S.k2.id] }));
  }
  await step('Bật TikTok Shop', () => post('/platforms/tiktok/enable'));
  S.zalo = await step('Kênh tuỳ chỉnh: Zalo cá nhân', () => post('/channels', { name: 'Zalo cá nhân', is_marketplace: false }));

  // ---------- Danh mục, NCC ----------
  S.catXe = await step('Danh mục Nước hoa xe', () => post('/categories', { name: 'Nước hoa xe' }));
  S.catXeSub = await step('Danh mục con Sáp thơm', () => post('/categories', { name: 'Sáp thơm', parent_id: S.catXe?.id }));
  S.catNguoi = await step('Danh mục Nước hoa mặc', () => post('/categories', { name: 'Nước hoa mặc' }));
  S.catPk = await step('Danh mục Phụ kiện', () => post('/categories', { name: 'Phụ kiện' }));
  S.catPt = await step('Danh mục Vật phẩm phong thuỷ', () => post('/categories', { name: 'Vật phẩm phong thuỷ' }));
  S.catVt = await step('Danh mục Vật tư đóng gói', () => post('/categories', { name: 'Vật tư đóng gói' }));
  S.sup1 = await step('NCC Xưởng tinh dầu Bình Dương', () => post('/suppliers', { name: 'Xưởng tinh dầu Bình Dương', phone: '0909000111', address: 'KCN Sóng Thần, Bình Dương' }));
  S.sup2 = await step('NCC Đá quý Hưng Phát', () => post('/suppliers', { name: 'Đá quý Hưng Phát', phone: '0908555666', address: 'Chợ Bến Thành, TP.HCM' }));
  S.sup3 = await step('NCC Bao bì Minh Anh', () => post('/suppliers', { name: 'Bao bì Minh Anh', phone: '0907222333' }));

  // ---------- Sản phẩm ----------
  const smells = ['Gỗ đàn hương', 'Cam bergamot', 'Biển xanh'];
  const sizes = ['10ml', '30ml'];
  const matrix = [];
  smells.forEach((m, i) => sizes.forEach((s, j) => matrix.push({ sku: `DM-NH-${['GO', 'CAM', 'BIEN'][i]}-${s.toUpperCase()}`, option_values: { Mùi: m, 'Dung tích': s }, default_price: j ? 320000 : 140000 + i * 5000, min_stock: 5, opening_qty: 12 + i * 3, opening_cost: j ? 120000 : 45000, opening_warehouse_id: S.k1.id })));
  S.pNH = await step('SP Nước hoa ô tô (ma trận 6 biến thể)', () => post('/products', { name: 'Nước hoa ô tô cao cấp', category_id: S.catXe?.id, unit: 'chai', brand: 'MoSo Scent', consumption_days: 45, options: [{ name: 'Mùi', values: smells }, { name: 'Dung tích', values: sizes }], variants: matrix, shop_ids: [S.nh.id], default_supplier_id: S.sup1?.id }));
  S.pSap = await step('SP Sáp thơm để xe', () => post('/products', { name: 'Sáp thơm để xe', category_id: S.catXeSub?.id, unit: 'hộp', consumption_days: 60, variants: [{ sku: 'DM-SAP-LAV', name: 'Lavender', default_price: 90000, min_stock: 6, opening_qty: 30, opening_cost: 28000, opening_warehouse_id: S.k1.id }, { sku: 'DM-SAP-BIEN', name: 'Ocean', default_price: 90000, min_stock: 6, opening_qty: 4, opening_cost: 28000, opening_warehouse_id: S.k1.id }], shop_ids: [S.nh.id] }));
  S.pKep = await step('SP Kẹp thơm cửa gió', () => post('/products', { name: 'Kẹp thơm cửa gió', category_id: S.catPk?.id, unit: 'cái', variants: [{ sku: 'DM-KEP-01', default_price: 60000, min_stock: 10, opening_qty: 40, opening_cost: 15000, opening_warehouse_id: S.k1.id }], shop_ids: [S.nh.id] }));
  const nguoi = [['EDP-50', '50ml', 850000, 380000], ['EDP-100', '100ml', 1450000, 650000]];
  S.pNg = await step('SP Nước hoa Niche (ma trận)', () => post('/products', { name: 'Nước hoa Niche Noir', category_id: S.catNguoi?.id, unit: 'chai', brand: 'Maison Noir', options: [{ name: 'Dung tích', values: ['50ml', '100ml'] }], variants: nguoi.map(([k, s, price, cost]) => ({ sku: `DM-NG-${k}`, option_values: { 'Dung tích': s }, default_price: price, min_stock: 2, opening_qty: 8, opening_cost: cost, opening_warehouse_id: (S.k2 || S.k1).id })), shop_ids: [S.nc.id], default_supplier_id: S.sup1?.id }));
  S.pNg2 = await step('SP Nước hoa Fresh (tồn thấp)', () => post('/products', { name: 'Nước hoa Fresh Citrus', category_id: S.catNguoi?.id, unit: 'chai', variants: [{ sku: 'DM-NG-FRESH', default_price: 690000, min_stock: 2, opening_qty: 1, opening_cost: 300000, opening_warehouse_id: (S.k2 || S.k1).id }], shop_ids: [S.nc.id] }));
  S.pTy = await step('SP Tỳ hưu thạch anh', () => post('/products', { name: 'Tỳ hưu thạch anh vàng', category_id: S.catPt?.id, unit: 'con', custom: { ngu_hanh: ['Thổ', 'Kim'] }, custom_shop_id: S.ptShop.id, variants: [{ sku: 'DM-PT-TYHUU', default_price: 520000, min_stock: 2, opening_qty: 6, opening_cost: 260000, opening_warehouse_id: S.k1.id }], shop_ids: [S.ptShop.id] }));
  S.pVong = await step('SP Vòng tay gỗ trầm (ma trận size)', () => post('/products', { name: 'Vòng tay gỗ trầm', category_id: S.catPt?.id, unit: 'chiếc', custom: { ngu_hanh: ['Mộc'] }, custom_shop_id: S.ptShop.id, options: [{ name: 'Size', values: ['S', 'M', 'L'] }], variants: ['S', 'M', 'L'].map((s, i) => ({ sku: `DM-PT-VONG-${s}`, option_values: { Size: s }, default_price: 350000 + i * 20000, min_stock: 3, opening_qty: 10, opening_cost: 150000, opening_warehouse_id: S.k1.id })), shop_ids: [S.ptShop.id] }));
  S.pCay = await step('SP Cây tiền xu', () => post('/products', { name: 'Cây tiền xu pha lê', category_id: S.catPt?.id, unit: 'cây', custom: { ngu_hanh: ['Kim', 'Thuỷ'] }, custom_shop_id: S.ptShop.id, variants: [{ sku: 'DM-PT-CAY', default_price: 780000, min_stock: 2, opening_qty: 3, opening_cost: 390000, opening_warehouse_id: S.k1.id }], shop_ids: [S.ptShop.id] }));
  // Vật tư
  S.vHop = await step('Vật tư: hộp carton nhỏ', () => post('/products', { name: 'Hộp carton nhỏ', item_type: 'packaging', category_id: S.catVt?.id, unit: 'cái', default_supplier_id: S.sup3?.id, variants: [{ sku: 'DM-VT-HOP', default_price: 0, min_stock: 30, opening_qty: 200, opening_cost: 2500, opening_warehouse_id: S.k1.id }] }));
  S.vTui = await step('Vật tư: túi zip', () => post('/products', { name: 'Túi zip bảo vệ', item_type: 'packaging', category_id: S.catVt?.id, unit: 'cái', variants: [{ sku: 'DM-VT-TUI', default_price: 0, min_stock: 50, opening_qty: 300, opening_cost: 600, opening_warehouse_id: S.k1.id }] }));
  S.vBang = await step('Vật tư: băng keo (cuộn)', () => post('/products', { name: 'Băng keo trong', item_type: 'supply', category_id: S.catVt?.id, unit: 'cuộn', variants: [{ sku: 'DM-VT-BANG', default_price: 0, min_stock: 5, opening_qty: 24, opening_cost: 12000, opening_warehouse_id: S.k1.id }] }));
  S.vTem = await step('Vật tư: tem cảm ơn', () => post('/products', { name: 'Tem cảm ơn khách', item_type: 'supply', category_id: S.catVt?.id, unit: 'tờ', variants: [{ sku: 'DM-VT-TEM', default_price: 0, min_stock: 20, opening_qty: 8, opening_cost: 400, opening_warehouse_id: S.k1.id }] }));
  const V = (p, i = 0) => p?.variants?.[i];
  if (S.pNH && S.vHop && S.vTui) await step('Định mức đóng gói nước hoa ô tô', () => put(`/packaging-specs/${S.pNH.id}`, { lines: [{ material_variant_id: V(S.vHop).id, qty: 1 }, { material_variant_id: V(S.vTui).id, qty: 1 }] }));
  if (S.pTy && S.vHop) await step('Định mức đóng gói tỳ hưu', () => put(`/packaging-specs/${S.pTy.id}`, { lines: [{ material_variant_id: V(S.vHop).id, qty: 1 }] }));
  if (S.pNH && S.pKep) S.combo = await step('Combo Nước hoa + Kẹp thơm', () => post('/products', { name: 'Combo thơm xe', category_id: S.catXe?.id, unit: 'bộ', variants: [{ sku: 'DM-COMBO-01', kind: 'bundle', default_price: 190000, components: [{ variant_id: V(S.pNH, 0).id, qty: 1 }, { variant_id: V(S.pKep).id, qty: 1 }] }], shop_ids: [S.nh.id] }));
  if (S.pKep) await step('Đồng bộ kẹp thơm sang shop Niche', () => post('/listings/sync', { from_shop_id: S.nh.id, to_shop_id: S.nc.id, product_ids: [S.pKep.id] }));

  // ---------- Nhập hàng ----------
  const lines = (p, qty, cost) => p.variants.map((v) => ({ variant_id: v.id, qty, unit_cost: cost }));
  if (S.pNH) await step('Phiếu nhập #1 nước hoa (đã nhận, trả đủ)', () => post('/purchases', { supplier_id: S.sup1?.id, warehouse_id: S.k1.id, shop_id: S.nh.id, shipping_fee: 80000, other_fee: 20000, receive: true, ordered_at: ago(40), lines: S.pNH.variants.map((v, i) => ({ variant_id: v.id, qty: 20, unit_cost: i % 2 ? 122000 : 46000 })), paid_amount: 4500000, payment_method: 'bank' }));
  if (S.pTy && S.pVong) await step('Phiếu nhập #2 phong thuỷ (đã nhận, trả một phần)', () => post('/purchases', { supplier_id: S.sup2?.id, warehouse_id: S.k1.id, shop_id: S.ptShop.id, shipping_fee: 50000, receive: true, ordered_at: ago(30), lines: [...lines(S.pTy, 5, 262000), ...lines(S.pVong, 8, 152000)], paid_amount: 1500000, payment_method: 'cash' }));
  if (S.pNg) S.purNg = await step('Phiếu nhập #3 nước hoa Niche (đã nhận, chưa trả)', () => post('/purchases', { supplier_id: S.sup1?.id, warehouse_id: (S.k2 || S.k1).id, shop_id: S.nc.id, receive: true, ordered_at: ago(20), lines: [{ variant_id: V(S.pNg, 0).id, qty: 6, unit_cost: 385000 }, { variant_id: V(S.pNg, 1).id, qty: 4, unit_cost: 655000 }] }));
  if (S.vHop && S.vTui) await step('Phiếu nhập #4 vật tư bao bì (đã nhận)', () => post('/purchases', { supplier_id: S.sup3?.id, warehouse_id: S.k1.id, receive: true, ordered_at: ago(12), lines: [{ variant_id: V(S.vHop).id, qty: 100, unit_cost: 2400 }, { variant_id: V(S.vTui).id, qty: 200, unit_cost: 580 }], paid_amount: 300000, payment_method: 'bank' }));
  if (S.pSap) await step('Phiếu nhập #5 nháp (sáp thơm)', () => post('/purchases', { supplier_id: S.sup1?.id, warehouse_id: S.k1.id, shop_id: S.nh.id, note: 'Chờ xưởng báo giá', lines: lines(S.pSap, 30, 27000) }));
  if (S.pCay) {
    const p = await step('Phiếu nhập #6 (sẽ huỷ)', () => post('/purchases', { supplier_id: S.sup2?.id, warehouse_id: S.k1.id, receive: true, ordered_at: ago(9), lines: lines(S.pCay, 2, 400000) }));
    if (p) await step('Huỷ phiếu nhập #6', () => post(`/purchases/${p.id}/cancel`, { reason: 'Nhà cung cấp giao sai mẫu' }));
  }
  if (S.purNg) await step('Trả NCC một phần phiếu #3', () => post(`/purchases/${S.purNg.id}/payments`, { amount: 1000000, method: 'bank' }));

  // ---------- Kho: điều chỉnh, chuyển, kiểm kê ----------
  if (S.pSap) await step('Hàng hỏng sáp thơm', () => post('/stock-adjustments', { warehouse_id: S.k1.id, kind: 'damage', reason: 'Vỡ khi vận chuyển', lines: [{ variant_id: V(S.pSap, 1).id, change: -1 }] }));
  if (S.pKep) await step('Điều chỉnh kẹp thơm (+5)', () => post('/stock-adjustments', { warehouse_id: S.k1.id, kind: 'adjust', reason: 'Tìm thấy thêm trong thùng', lines: [{ variant_id: V(S.pKep).id, change: 5, unit_cost: 15000 }] }));
  if (S.k2 && S.pKep) await step('Chuyển kho K1 → K2 (kẹp thơm)', () => post('/transfers', { from_warehouse_id: S.k1.id, to_warehouse_id: S.k2.id, note: 'Bổ sung cho quầy', lines: [{ variant_id: V(S.pKep).id, qty: 15 }] }));
  if (S.pTy && S.pVong) await step('Phiếu kiểm kê K1 (hoàn tất)', async () => {
    const c = await post('/stock-counts', { warehouse_id: S.k1.id, note: 'Kiểm kê cuối tuần', mode: 'variants', variant_ids: [V(S.pTy).id, V(S.pVong, 0).id] });
    await call('PATCH', `/stock-counts/${c.id}`, { lines: [{ variant_id: V(S.pTy).id, counted_qty: 10 }, { variant_id: V(S.pVong, 0).id, counted_qty: 17 }] });
    return post(`/stock-counts/${c.id}/complete`, { uncounted: 'skip' });
  });
  if (S.pSap) await step('Phiếu kiểm kê đang đếm dở', async () => { const c = await post('/stock-counts', { warehouse_id: S.k1.id, note: 'Đếm sáp thơm (chưa xong)', mode: 'variants', variant_ids: S.pSap.variants.map((v) => v.id) }); return call('PATCH', `/stock-counts/${c.id}`, { lines: [{ variant_id: V(S.pSap, 0).id, counted_qty: 29 }] }); });

  // ---------- Khách hàng ----------
  const mk = (name, phone, extra = {}, shop) => post('/customers', { name, phone, shop_id: shop?.id, ...extra });
  S.c = {};
  S.c.tai = await step('Khách Anh Tài', () => mk('Anh Tài', '0912345678', { birth_date: '1988-03-12', address: '25 Trần Hưng Đạo, Q.5', facebook_url: 'https://facebook.com/anhtai' }, S.nh));
  S.c.lan = await step('Khách Chị Lan', () => mk('Chị Lan', '0987654321', { birth_date: '1992-11-09', shopee_username: 'lan.shop92' }, S.nc));
  S.c.minh = await step('Khách Minh Đức', () => mk('Minh Đức', '0933111222', { birth_year: 1985, address: '8 Võ Văn Tần, Q.3' }, S.ptShop));
  S.c.hoa = await step('Khách Cô Hoa', () => mk('Cô Hoa', '0944555666', { birth_date: '1975-11-12' }, S.ptShop));
  S.c.nam = await step('Khách Hoàng Nam', () => mk('Hoàng Nam', '0966777888', { birth_date: '1999-07-20' }, S.nh));
  S.c.thu = await step('Khách Thu Trang', () => mk('Thu Trang', '0977000111', { birth_date: '1995-11-10' }, S.nc));
  S.c.khanh = await step('Khách Khánh Linh', () => mk('Khánh Linh', '0905888999', {}, S.nh));
  S.c.dup = await step('Khách trùng: Tài Nguyễn', () => mk('Tài Nguyễn', '0912345679', {}, S.nh));
  if (S.c.tai) {
    await step('Anh Tài vào shop phong thuỷ + nhãn VIP', async () => { await post(`/customers/${S.c.tai.id}/shops`, { shop_id: S.ptShop.id }).catch(() => {}); return put(`/customers/${S.c.tai.id}/tags`, { shop_id: S.nh.id, tags: ['VIP', 'Hay mua'] }); });
    await step('Ghi chú khách Anh Tài', () => post(`/customers/${S.c.tai.id}/notes`, { content: 'Thích mùi gỗ, đi Toyota Camry. Hay hỏi quà tặng sếp.', shop_id: S.nh.id }));
  }
  if (S.c.minh) await step('Nhãn khách Minh Đức', () => put(`/customers/${S.c.minh.id}/tags`, { shop_id: S.ptShop.id, tags: ['Kinh doanh', 'Mệnh Hoả'] }));

  // Trường tuỳ chỉnh riêng từng shop + giá trị
  const fieldsOf = async (shop) => ((await get(`/custom/fields?entity_type=customer&shop_id=${shop.id}`).catch(() => [])) || []);
  const nhFields = S.nh ? await fieldsOf(S.nh) : []; const ncFields = S.nc ? await fieldsOf(S.nc) : [];
  console.log(`  (trường khách shop ô tô: ${nhFields.map((f) => f.key).join(', ')} | Niche: ${ncFields.map((f) => f.key).join(', ')})`);
  const only = (fields, obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => fields.some((f) => f.key === k)));
  if (S.c.tai) await step('Thông tin riêng Anh Tài (shop ô tô)', () => put(`/custom/values/customer/${S.c.tai.id}?shop_id=${S.nh.id}`, only(nhFields, { dong_xe: 'Toyota Camry', nhom_huong: ['Gỗ', 'Biển'], dip_dung: 'Xe cá nhân' })));
  if (S.c.lan) await step('Thông tin riêng Chị Lan (shop Niche)', () => put(`/custom/values/customer/${S.c.lan.id}?shop_id=${S.nc.id}`, only(ncFields, { nhom_huong: ['Hoa cỏ', 'Gỗ'], phong_cach: ['Thanh lịch'] })));
  if (S.c.minh) await step('Mệnh ghi đè Minh Đức (shop phong thuỷ)', () => put(`/custom/values/customer/${S.c.minh.id}?shop_id=${S.ptShop.id}`, { menh: 'Hoả', gioi_tinh: 'Nam' }));
  await step('Trường đơn: Người đóng gói', () => post('/custom/fields', { entity_type: 'order', key: 'nguoi_dong_goi', label: 'Người đóng gói', type: 'select', options: ['Mai', 'Tuấn', 'Chủ shop'] }));
  await step('Trường công thức đơn: lãi / tổng tiền', () => post('/custom/fields', { entity_type: 'order', key: 'lai_tren_tong', label: 'Lãi / tổng tiền (%)', type: 'formula', formula: 'IF({total_amount} > 0, ROUND(({total_amount} - {cogs_amount}) * 100 / {total_amount}, 1), 0)' }));
  await step('Trường sản phẩm: Xuất xứ', () => post('/custom/fields', { entity_type: 'product', key: 'xuat_xu', label: 'Xuất xứ', type: 'select', options: ['Việt Nam', 'Pháp', 'Trung Quốc', 'Thái Lan'] }));
  await step('Chỉ số báo cáo tuỳ chỉnh: doanh thu / đơn', () => post('/custom/metrics', { key: 'dt_tren_don', name: 'Doanh thu thuần / đơn', format: 'money', formula: '{net_revenue} / {order_count}' }));

  // ---------- Quỹ tiền ----------
  S.momo = await step('Quỹ Ví MoMo', () => post('/cash/accounts', { name: 'Ví MoMo', kind: 'ewallet', methods: [], opening_balance: 500000, opening_date: dateOf(60) }));
  await step('Chuyển quỹ Tiền mặt → Ngân hàng', () => post('/cash/transfers', { from_account_id: 'cac_cash', to_account_id: 'cac_bank', amount: 2000000, date: dateOf(6), note: 'Nộp tiền mặt vào ngân hàng' }));

  // ---------- Đơn hàng ----------
  const O = {};
  const ord = (label, body) => step(`Đơn ${label}`, async () => { O[label.split(' ')[0]] = await post('/orders', body); return O[label.split(' ')[0]]; });
  if (S.nh && S.pNH) {
    await ord('NH1 trực tiếp hoàn thành', { shop_id: S.nh.id, channel_id: 'direct', customer_id: S.c.tai?.id, ordered_at: ago(28, 11), lines: [{ sku: 'DM-NH-GO-10ML', qty: 2 }, { sku: 'DM-KEP-01', qty: 1 }], status: 'completed', payments: [{ amount: 340000, method: 'cash' }] });
    await ord('NH2 Facebook chuyển khoản', { shop_id: S.nh.id, channel_id: 'facebook', customer_id: S.c.nam?.id, ordered_at: ago(24, 15), lines: [{ sku: 'DM-NH-CAM-30ML', qty: 1 }], shipping_fee: 25000, seller_shipping_amount: 22000, status: 'completed', payments: [{ amount: 345000, method: 'bank' }] });
    await ord('NH3 Shopee', { shop_id: S.nh.id, channel_id: 'shopee', external_id: 'DM2610240001', customer: { name: 'Trần Văn Bình', phone: '0911222333' }, ordered_at: ago(21, 9), lines: [{ sku: 'DM-NH-BIEN-10ML', qty: 3, unit_price: 140000 }], platform_fee_amount: 38000, status: 'completed' });
    await ord('NH4 Shopee (đã về tiền)', { shop_id: S.nh.id, channel_id: 'shopee', external_id: 'DM2610260002', customer: { name: 'Lê Thị Cúc', phone: '0922333444' }, ordered_at: ago(19, 20), lines: [{ sku: 'DM-SAP-LAV', qty: 2, unit_price: 85000 }], platform_fee_amount: 16000, status: 'completed', payments: [{ amount: 154000, method: 'shopee_payout' }] });
    await ord('NH5 TikTok', { shop_id: S.nh.id, channel_id: 'tiktok', external_id: 'DM-TT-5501', customer: { name: 'Phạm Hồng', phone: '0933444555' }, ordered_at: ago(14, 21), lines: [{ sku: 'DM-NH-GO-30ML', qty: 1 }, { sku: 'DM-SAP-BIEN', qty: 1 }], platform_fee_amount: 29000, status: 'completed' });
    if (S.combo) await ord('NH6 Combo giảm giá', { shop_id: S.nh.id, channel_id: 'direct', customer_id: S.c.khanh?.id, ordered_at: ago(10, 16), lines: [{ sku: 'DM-COMBO-01', qty: 2 }], discount_amount: 20000, status: 'completed', payments: [{ amount: 360000, method: 'ewallet' }] });
    await ord('NH7 Zalo đang giao', { shop_id: S.nh.id, channel_id: S.zalo?.id || 'other', customer_id: S.c.khanh?.id, ordered_at: ago(2, 14), lines: [{ sku: 'DM-NH-CAM-10ML', qty: 2 }], shipping_fee: 30000, tracking_code: 'GHN123456', carrier: 'GHN', status: 'shipping' });
    await ord('NH8 đã xác nhận, thu một phần', { shop_id: S.nh.id, channel_id: 'facebook', customer_id: S.c.tai?.id, ordered_at: ago(1, 18), lines: [{ sku: 'DM-NH-BIEN-30ML', qty: 2 }], status: 'confirmed', payments: [{ amount: 300000, method: 'bank' }] });
    await ord('NH9 nháp', { shop_id: S.nh.id, channel_id: 'direct', customer_id: S.c.nam?.id, lines: [{ sku: 'DM-KEP-01', qty: 3 }], status: 'draft' });
    await ord('NH10 sẽ huỷ', { shop_id: S.nh.id, channel_id: 'facebook', customer_id: S.c.khanh?.id, ordered_at: ago(5, 13), lines: [{ sku: 'DM-NH-GO-10ML', qty: 1 }], status: 'confirmed' });
  }
  if (S.nc) {
    await ord('NC1 Niche trực tiếp', { shop_id: S.nc.id, channel_id: 'direct', customer_id: S.c.lan?.id, ordered_at: ago(26, 17), lines: [{ sku: 'DM-NG-EDP-100', qty: 1 }], status: 'completed', payments: [{ amount: 1450000, method: 'bank' }] });
    await ord('NC2 Niche Shopee', { shop_id: S.nc.id, channel_id: 'shopee', external_id: 'DM2610280009', customer_id: S.c.thu?.id, ordered_at: ago(16, 12), lines: [{ sku: 'DM-NG-EDP-50', qty: 2, unit_price: 830000 }], platform_fee_amount: 99000, status: 'completed' });
    await ord('NC3 Niche giảm giá COD', { shop_id: S.nc.id, channel_id: 'facebook', customer_id: S.c.thu?.id, ordered_at: ago(7, 19), lines: [{ sku: 'DM-NG-FRESH', qty: 1 }, { sku: 'DM-KEP-01', qty: 1 }], discount_amount: 50000, shipping_fee: 30000, status: 'completed', payments: [{ amount: 730000, method: 'cod' }] });
  }
  if (S.ptShop) {
    await ord('PT1 Tỳ hưu', { shop_id: S.ptShop.id, channel_id: 'facebook', customer_id: S.c.minh?.id, ordered_at: ago(27, 10), lines: [{ sku: 'DM-PT-TYHUU', qty: 1 }], shipping_fee: 30000, seller_shipping_amount: 25000, status: 'completed', payments: [{ amount: 550000, method: 'bank' }] });
    await ord('PT2 Vòng tay', { shop_id: S.ptShop.id, channel_id: 'direct', customer_id: S.c.hoa?.id, ordered_at: ago(18, 11), lines: [{ sku: 'DM-PT-VONG-M', qty: 2 }, { sku: 'DM-PT-VONG-L', qty: 1 }], discount_amount: 40000, status: 'completed', payments: [{ amount: 1100000, method: 'cash' }] });
    await ord('PT3 Cây tiền xu Shopee', { shop_id: S.ptShop.id, channel_id: 'shopee', external_id: 'DM2610310003', customer_id: S.c.minh?.id, ordered_at: ago(11, 14), lines: [{ sku: 'DM-PT-CAY', qty: 1 }], platform_fee_amount: 62000, status: 'completed' });
    await ord('PT4 Tỳ hưu (trả hàng)', { shop_id: S.ptShop.id, channel_id: 'direct', customer_id: S.c.hoa?.id, ordered_at: ago(8, 15), lines: [{ sku: 'DM-PT-TYHUU', qty: 2 }], status: 'completed', payments: [{ amount: 1040000, method: 'cash' }] });
    await ord('PT5 Vòng tay (đổi hàng)', { shop_id: S.ptShop.id, channel_id: 'facebook', customer_id: S.c.tai?.id, ordered_at: ago(6, 16), lines: [{ sku: 'DM-PT-VONG-S', qty: 1 }], status: 'completed', payments: [{ amount: 350000, method: 'bank' }] });
    await ord('PT6 hôm nay', { shop_id: S.ptShop.id, channel_id: 'direct', customer_id: S.c.minh?.id, lines: [{ sku: 'DM-PT-VONG-M', qty: 1 }], status: 'completed', payments: [{ amount: 370000, method: 'cash' }] });
  }

  // Trạng thái, thanh toán, trả hàng, đổi hàng
  if (O.NH10) await step('Huỷ đơn NH10', () => post(`/orders/${O.NH10.id}/status`, { status: 'cancelled', note: 'Khách đổi ý' }));
  if (O.NH7) await step('Thu thêm đơn NH7', () => post(`/orders/${O.NH7.id}/payments`, { amount: 100000, method: 'cod' }));
  const lineOf = async (o, i = 0) => (await get(`/orders/${o.id}`)).lines[i];
  if (O.PT4) await step('Trả 1/2 hàng đơn PT4, hoàn tiền mặt', async () => { const l = await lineOf(O.PT4); return post(`/orders/${O.PT4.id}/returns`, { lines: [{ order_line_id: l.id, qty: 1, restock: true }], reason: 'Khách không hợp mệnh', refund: { amount: 480000, method: 'cash' }, return_fee_amount: 40000 }); });
  if (O.NH2) await step('Trả toàn phần NH2, hoàn ship', async () => { const l = await lineOf(O.NH2); return post(`/orders/${O.NH2.id}/returns`, { lines: [{ order_line_id: l.id, qty: 1, restock: true }], reason: 'Lỗi vỏ chai', shipping_refund_amount: 25000, refund: { amount: 370000, method: 'bank' } }); });
  if (O.NC2) await step('Trả hàng sàn NC2 (chờ nhận hàng)', async () => { const l = await lineOf(O.NC2); return post(`/orders/${O.NC2.id}/returns`, { lines: [{ order_line_id: l.id, qty: 1, restock: true }], reason: 'Người mua đổi ý', awaiting_goods: true }); });
  if (O.PT5) await step('Đổi hàng PT5 (S → L)', async () => { const l = await lineOf(O.PT5); return post(`/orders/${O.PT5.id}/exchange`, { return_lines: [{ order_line_id: l.id, qty: 1, restock: true }], new_lines: [{ sku: 'DM-PT-VONG-L', qty: 1 }], reason: 'Khách đeo không vừa size' }); });

  // Đối soát sàn
  if (O.NH3) await step('Ghi nhận tiền Shopee về (NH3)', () => post('/reconciliation/payouts', { items: [{ order_id: O.NH3.id }], channel_id: 'shopee', shop_id: S.nh.id, note: 'Payout kỳ 1' }));
  if (O.PT3) await step('Ghi nhận tiền Shopee về (PT3)', () => post('/reconciliation/payouts', { items: [{ order_id: O.PT3.id }], channel_id: 'shopee', shop_id: S.ptShop.id }));

  // Đóng gói vật tư theo đơn + xuất vật tư nội bộ
  if (O.NH1 && S.vHop) await step('Xác nhận đóng gói đơn NH1', async () => {
    const plan = await get(`/orders/${O.NH1.id}/packaging-plan`);
    const src = Array.isArray(plan) ? plan : (plan.lines || plan.items || plan.materials || []);
    const ls = src.map((x) => ({ variant_id: x.variant_id || x.material_variant_id, qty: x.qty || x.suggested_qty || x.planned_qty || 1 })).filter((x) => x.variant_id);
    if (!ls.length) throw new Error('kế hoạch trống: ' + JSON.stringify(plan).slice(0, 120));
    return post(`/orders/${O.NH1.id}/packaging-confirm`, { warehouse_id: S.k1.id, shop_id: S.nh.id, lines: ls });
  });
  if (S.vBang && S.vTem) await step('Xuất vật tư nội bộ (băng keo, tem)', () => post('/material-issues', { warehouse_id: S.k1.id, purpose: 'Đóng hàng đợt khuyến mãi cuối tháng', expense_account_code: '6414', shop_id: S.nh.id, lines: [{ variant_id: V(S.vBang).id, qty: 2 }, { variant_id: V(S.vTem).id, qty: 6 }] }));

  // ---------- Chi phí & định kỳ ----------
  const cats = (await get('/expense-categories')) || [];
  console.log('  (danh mục chi phí: ' + cats.map((c) => c.name).join(' | ') + ')');
  const cat = (re) => cats.find((c) => re.test(c.name))?.id || cats[cats.length - 1]?.id;
  const exp = (name, b) => step(`Chi phí: ${name}`, () => post('/expenses', { method: 'bank', ...b }));
  await exp('Quảng cáo Facebook shop ô tô', { category_id: cat(/quảng cáo|ads/i), shop_id: S.nh?.id, amount: 1500000, expense_date: dateOf(25), payee: 'Meta', channel_id: 'facebook' });
  await exp('Quảng cáo Facebook phong thuỷ', { category_id: cat(/quảng cáo|ads/i), shop_id: S.ptShop.id, amount: 900000, expense_date: dateOf(15), payee: 'Meta' });
  await exp('Bao bì', { category_id: cat(/bao bì|đóng gói/i), shop_id: S.nh?.id, amount: 250000, expense_date: dateOf(20), method: 'cash' });
  await exp('Phí ship chung', { category_id: cat(/ship|vận/i), amount: 340000, expense_date: dateOf(13), method: 'cash', payee: 'GHN' });
  await exp('Tiền điện (chung)', { category_id: cat(/khác/i), amount: 780000, expense_date: dateOf(9), payee: 'EVN' });
  await exp('Livestream TikTok', { category_id: cat(/quảng cáo|ads/i), shop_id: S.nc?.id, amount: 600000, expense_date: dateOf(4), method: 'ewallet', payee: 'TikTok Ads' });
  S.rec1 = await step('Định kỳ: Thuê mặt bằng (tháng)', () => post('/recurring-expenses', { name: 'Thuê mặt bằng', category_id: cat(/mặt bằng|thuê/i), amount: 6000000, method: 'bank', frequency: 'monthly', day_of_period: 5, start_date: dateOf(70), payee: 'Chủ nhà' }));
  S.rec2 = await step('Định kỳ: Internet (tháng)', () => post('/recurring-expenses', { name: 'Internet + điện thoại', category_id: cat(/khác/i), amount: 350000, method: 'bank', frequency: 'monthly', day_of_period: 15, start_date: dateOf(40) }));
  S.rec3 = await step('Định kỳ: Dọn kho (tuần)', () => post('/recurring-expenses', { name: 'Dọn kho hằng tuần', category_id: cat(/khác/i), amount: 150000, method: 'cash', frequency: 'weekly', day_of_period: 6, start_date: dateOf(14) }));
  if (S.rec3) await step('Tạm dừng chi phí dọn kho', () => post(`/recurring-expenses/${S.rec3.id}/pause`));

  // ---------- Kế toán ----------
  await step('Phiếu thu: góp vốn', () => post('/accounting/vouchers', { type: 'receipt', voucher_date: dateOf(45), description: 'Chủ shop góp vốn bổ sung', cash_account_id: 'cac_bank', account_code: '411', amount: 20000000 }));
  await step('Phiếu thu: GHN đền bù', () => post('/accounting/vouchers', { type: 'receipt', voucher_date: dateOf(8), description: 'GHN đền bù hàng thất lạc', cash_account_id: 'cac_cash', account_code: '711', amount: 280000, shop_id: S.nh?.id }));
  await step('Phiếu chi: tiền phạt', () => post('/accounting/vouchers', { type: 'payment', voucher_date: dateOf(12), description: 'Phạt giao hàng trễ sàn', cash_account_id: 'cac_bank', account_code: '811', amount: 120000, shop_id: S.nh?.id }));
  await step('Phiếu chi: rút vốn', () => post('/accounting/vouchers', { type: 'payment', voucher_date: dateOf(3), description: 'Chủ shop rút tiền chi tiêu cá nhân', cash_account_id: 'cac_bank', account_code: '411', amount: 3000000 }));
  await step('Bút toán tổng hợp', () => post('/accounting/vouchers', { type: 'journal', voucher_date: dateOf(2), description: 'Điều chỉnh chi phí phân loại nhầm', lines: [{ account_code: '6418', debit: 200000, credit: 0 }, { account_code: '6428', debit: 0, credit: 200000 }] }));
  await step('Tài sản: máy in tem', () => post('/accounting/assets', { name: 'Máy in tem nhãn', kind: 'fixed_asset', cost: 3600000, start_date: dateOf(50), months: 12, paid_via: 'bank', expense_account_code: '6428' }));
  await step('Tài sản: kệ trưng bày', () => post('/accounting/assets', { name: 'Kệ trưng bày gỗ', kind: 'fixed_asset', cost: 4800000, start_date: dateOf(35), months: 24, paid_via: 'cash', expense_account_code: '6418', shop_id: S.ptShop.id }));
  await step('Trả trước: gian hàng hội chợ', () => post('/accounting/assets', { name: 'Thuê gian hàng hội chợ 6 tháng', kind: 'prepaid', cost: 12000000, start_date: dateOf(33), months: 6, paid_via: 'bank', expense_account_code: '6422' }));
  await step('Trả trước: phần mềm (chưa trả)', () => post('/accounting/assets', { name: 'Gói phần mềm năm', kind: 'prepaid', cost: 2400000, start_date: dateOf(10), months: 12, paid_via: 'unpaid', expense_account_code: '6428' }));

  // ---------- Loyalty ----------
  await step('Mẫu tin: nhắc mua lại', () => post('/loyalty/templates', { name: 'Nhắc mua lại nước hoa', kind: 'reorder', body: 'Chào {ten}, {san_pham} bạn mua ngày {ngay_mua} sắp hết rồi. Shop có mùi mới, bạn ghé xem nhé!' }));
  await step('Mẫu tin: chúc sinh nhật', () => post('/loyalty/templates', { name: 'Chúc sinh nhật + ưu đãi', kind: 'birthday', body: 'Chúc mừng sinh nhật {ten}! Shop tặng bạn mã giảm 10% trong tuần này.' }));
  await step('Mẫu tin: cảm ơn', () => post('/loyalty/templates', { name: 'Cảm ơn sau mua hàng', kind: 'general', body: 'Cảm ơn {ten} đã ủng hộ shop. Dùng thấy ổn nhớ nhắn shop nhé!' }));
} catch (e) {
  console.error('DỪNG:', e.message);
} finally {
  getMaster().prepare('DELETE FROM sessions WHERE id = ?').run(sid);
}
console.log(`\nXong: ${n} bước thành công, ${fails.length} lỗi.`);
for (const f of fails) console.log(' - ' + f);
process.exit(0);
