// Danh mục biến cho công thức trường tuỳ chỉnh: MỘT nguồn duy nhất cho cả việc kiểm tra (parseFormula)
// lẫn gợi ý trên giao diện (GET /custom/variables). Chỉ những cột người dùng hiểu được; cột kỹ thuật
// (id, thời điểm nội bộ, JSON, cột khách cũ không dùng) cố ý không có ở đây.
// Công thức đã lưu từ trước mà dùng cột ngoài danh mục vẫn ĐỌC được (getValues tra thẳng cột); chỉ chặn khi tạo/sửa.
import { getDb } from '../../db/index.js';

const T = (key, label, type, group) => ({ key, label, type, group });

export const ENTITY_VARIABLES = {
  order: [
    T('subtotal', 'Tổng tiền hàng (trước giảm giá)', 'money', 'Tiền'),
    T('line_discount_amount', 'Giảm giá từng dòng', 'money', 'Tiền'),
    T('discount_amount', 'Giảm giá cả đơn', 'money', 'Tiền'),
    T('goods_revenue', 'Tiền hàng sau giảm giá', 'money', 'Tiền'),
    T('shipping_fee', 'Phí ship khách trả', 'money', 'Tiền'),
    T('total_amount', 'Khách phải trả', 'money', 'Tiền'),
    T('platform_fee_amount', 'Phí sàn', 'money', 'Tiền'),
    T('seller_shipping_amount', 'Phí ship shop chịu', 'money', 'Tiền'),
    T('net_amount', 'Shop thực nhận', 'money', 'Tiền'),
    T('returned_amount', 'Giảm số phải thu do trả hàng (hàng + ship hoàn − phí trả hàng)', 'money', 'Tiền'),
    T('returned_goods_amount', 'Tiền hàng đã trả', 'money', 'Tiền'),
    T('returned_shipping_amount', 'Phí ship đã hoàn khách', 'money', 'Tiền'),
    T('return_fee_amount', 'Phí trả hàng shop giữ lại', 'money', 'Tiền'),
    T('return_shipping_cost', 'Phí ship chiều về shop chịu', 'money', 'Tiền'),
    T('refund_owed_amount', 'Shop còn nợ khách', 'money', 'Tiền'),
    T('net_revenue', 'Doanh thu thuần của đơn', 'money', 'Tiền'),
    T('cogs_amount', 'Giá vốn', 'money', 'Tiền'),
    T('paid_amount', 'Đã thu', 'money', 'Tiền'),
    T('code', 'Mã đơn', 'text', 'Thông tin'),
    T('status', 'Trạng thái đơn', 'text', 'Thông tin'),
    T('payment_status', 'Trạng thái thanh toán', 'text', 'Thông tin'),
    T('customer_name', 'Tên khách trên đơn', 'text', 'Thông tin'),
    T('tracking_code', 'Mã vận đơn', 'text', 'Thông tin'),
    T('business_date', 'Ngày bán (giờ VN)', 'date', 'Thời gian'),
    T('ordered_at', 'Thời điểm đặt', 'date', 'Thời gian'),
    T('completed_at', 'Thời điểm hoàn thành', 'date', 'Thời gian'),
  ],
  purchase: [
    T('subtotal', 'Tổng tiền hàng', 'money', 'Tiền'),
    T('discount_amount', 'Chiết khấu', 'money', 'Tiền'),
    T('shipping_fee', 'Phí ship nhập', 'money', 'Tiền'),
    T('other_fee', 'Phí khác', 'money', 'Tiền'),
    T('total_amount', 'Tổng phiếu nhập', 'money', 'Tiền'),
    T('paid_amount', 'Đã trả nhà cung cấp', 'money', 'Tiền'),
    T('code', 'Mã phiếu nhập', 'text', 'Thông tin'),
    T('status', 'Trạng thái phiếu', 'text', 'Thông tin'),
    T('supplier_ref', 'Số chứng từ nhà cung cấp', 'text', 'Thông tin'),
    T('ordered_at', 'Ngày đặt', 'date', 'Thời gian'),
    T('received_at', 'Ngày nhận hàng', 'date', 'Thời gian'),
  ],
  product: [
    T('name', 'Tên sản phẩm', 'text', 'Thông tin'),
    T('brand', 'Thương hiệu', 'text', 'Thông tin'),
    T('unit', 'Đơn vị', 'text', 'Thông tin'),
    T('consumption_days', 'Chu kỳ dùng hết (ngày)', 'number', 'Thông tin'),
  ],
  customer: [
    T('name', 'Tên khách', 'text', 'Thông tin chung'),
    T('phone', 'Số điện thoại', 'text', 'Thông tin chung'),
    T('phone2', 'Số điện thoại phụ', 'text', 'Thông tin chung'),
    T('email', 'Email', 'text', 'Thông tin chung'),
    T('facebook_url', 'Link Facebook', 'text', 'Thông tin chung'),
    T('address', 'Địa chỉ', 'text', 'Thông tin chung'),
    T('note', 'Ghi chú chung', 'text', 'Thông tin chung'),
    T('source_channel', 'Kênh đầu tiên mua hàng', 'text', 'Thông tin chung'),
    T('order_count', 'Số đơn (mọi shop)', 'number', 'Toàn hệ thống'),
    T('total_spent', 'Tổng chi tiêu (mọi shop)', 'money', 'Toàn hệ thống'),
    T('first_order_at', 'Ngày mua đầu tiên (mọi shop)', 'date', 'Toàn hệ thống'),
    T('last_order_at', 'Ngày mua gần nhất (mọi shop)', 'date', 'Toàn hệ thống'),
  ],
};

/** Biến dẫn xuất của khách, tính riêng cho shop của trường (không có ở các đối tượng khác) */
export const CUSTOMER_SHOP_VARIABLES = [
  T('shop_order_count', 'Số đơn tại shop này', 'number', 'Tại shop này'),
  T('shop_total_spent', 'Tổng chi tiêu tại shop này', 'money', 'Tại shop này'),
  T('shop_last_order_at', 'Ngày mua gần nhất tại shop này', 'date', 'Tại shop này'),
];

const SHOP_VAR_KEYS = new Set(CUSTOMER_SHOP_VARIABLES.map((v) => v.key));
export const isShopDerived = (name) => SHOP_VAR_KEYS.has(name);

/** Giá trị biến dẫn xuất của khách trong một shop. Cùng cách tính với hồ sơ khách (`by_shop`). */
export function shopDerivedValues(customerId, shopId) {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(net_revenue), 0) AS spent, MAX(ordered_at) AS last_at FROM orders
       WHERE customer_id = ? AND shop_id = ? AND status IN ('confirmed','shipping','completed','returned')`,
    )
    .get(customerId, shopId);
  return { shop_order_count: r.n, shop_total_spent: r.spent, shop_last_order_at: r.last_at };
}

/** Biến cột (không gồm trường tuỳ chỉnh) của một đối tượng */
export function columnVariables(entityType) {
  return [...ENTITY_VARIABLES[entityType], ...(entityType === 'customer' ? CUSTOMER_SHOP_VARIABLES : [])];
}
