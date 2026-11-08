/**
 * Danh mục nền tảng bán hàng (plugin). Mỗi nền tảng quyết định:
 *  - channel: kênh bán tương ứng (id cố định, `is_marketplace` = sàn: sàn trừ phí rồi mới trả tiền cho shop)
 *  - payout_method: phương thức thanh toán ghi nhận "sàn trả tiền về" (chỉ sàn mới có)
 *  - import_profile: mẫu import dựng sẵn (id + dữ liệu để dựng lại nếu bị mất)
 *  - features: chức năng được bật khi kết nối (`reconciliation` đối soát tiền sàn, `import` nhập đơn từ file)
 * Thêm nền tảng = thêm một mục ở đây + một migration seed kênh (lưu trữ sẵn) và mẫu import.
 * Bật/tắt từng nền tảng ở Cài đặt → Nền tảng bán hàng; tắt chỉ ẩn kênh, không mất dữ liệu.
 */
export const BASE_PAYMENT_METHODS = ['cash', 'bank', 'cod', 'carrier_payout', 'card', 'ewallet', 'other'];

export const PLATFORMS = {
  shopee: {
    id: 'shopee',
    name: 'Shopee',
    description: 'Sàn thương mại điện tử. Nhập đơn từ file xuất của Shopee, theo dõi tiền Shopee đang treo và đối soát khi payout về.',
    channel: { id: 'shopee', name: 'Shopee', is_marketplace: 1, sort_order: 3 },
    payout_method: 'shopee_payout',
    payout_label: 'Shopee payout',
    import_profile: { id: 'imp_shopee' },
    features: ['import', 'reconciliation'],
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok Shop',
    description: 'Sàn TikTok Shop. Nhập đơn từ file xuất của TikTok Seller Center, theo dõi và đối soát tiền TikTok đang treo riêng với Shopee.',
    channel: { id: 'tiktok', name: 'TikTok Shop', is_marketplace: 1, sort_order: 4 },
    payout_method: 'tiktok_payout',
    payout_label: 'TikTok payout',
    import_profile: {
      id: 'imp_tiktok',
      name: 'TikTok Shop — file xuất đơn hàng',
      channel_id: 'tiktok',
      column_map: {
        external_id: 'Order ID', ordered_at: 'Created Time', status: 'Order Status', customer_name: 'Recipient', customer_phone: 'Phone #',
        shipping_address: 'Detail Address', sku: 'Seller SKU', qty: 'Quantity', unit_price: 'SKU Unit Original Price', line_discount: 'SKU Seller Discount',
        shipping_fee: 'Shipping Fee After Discount', tracking_code: 'Tracking ID', carrier: 'Shipping Provider Name', note: 'Buyer Message',
      },
      status_map: {
        Completed: 'completed', Delivered: 'completed', 'In transit': 'shipping', Shipped: 'shipping', 'To ship': 'confirmed', 'Awaiting shipment': 'confirmed',
        'Awaiting collection': 'confirmed', Unpaid: 'draft', Canceled: 'cancelled', Cancelled: 'cancelled',
        'Hoàn tất': 'completed', 'Đã giao hàng': 'completed', 'Đang vận chuyển': 'shipping', 'Chờ vận chuyển': 'confirmed', 'Chưa thanh toán': 'draft', 'Đã hủy': 'cancelled',
      },
      options: { note: 'Mẫu khởi đầu theo tên cột file xuất đơn của TikTok Seller Center (bản tiếng Anh). Chưa kiểm với file thật và tên cột có thể đổi: kiểm tra lại khi import lần đầu, sửa được ở nút "Sửa". File xuất đơn không có phí sàn nên đơn TikTok nhập vào chưa trừ phí; ghi phí khi đối soát payout.' },
    },
    features: ['import', 'reconciliation'],
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    description: 'Bán qua Facebook (trang, nhóm, Messenger). Tạo đơn tay hoặc nhập hàng loạt theo mẫu chuẩn của Mở Sổ.',
    channel: { id: 'facebook', name: 'Facebook', is_marketplace: 0, sort_order: 2 },
    payout_method: null,
    import_profile: { id: 'imp_standard' },
    features: ['import'],
  },
  zalo: {
    id: 'zalo',
    name: 'Zalo',
    description: 'Bán qua Zalo cá nhân hoặc Zalo OA. Tạo đơn tay hoặc nhập hàng loạt theo mẫu chuẩn của Mở Sổ.',
    channel: { id: 'zalo', name: 'Zalo', is_marketplace: 0, sort_order: 5 },
    payout_method: null,
    import_profile: { id: 'imp_standard' },
    features: ['import'],
  },
};

/** Nền tảng bật sẵn cho tài khoản mới và tài khoản cũ (giữ hành vi trước đây) */
export const DEFAULT_ENABLED_PLATFORMS = ['shopee', 'facebook'];

export const platformList = () => Object.values(PLATFORMS);

export const platformByChannel = (channelId) => platformList().find((p) => p.channel.id === channelId) || null;

/** Mọi phương thức thanh toán hợp lệ: phương thức gốc + phương thức payout của các nền tảng */
export function paymentMethods() {
  return [...BASE_PAYMENT_METHODS.slice(0, 2), ...platformList().filter((p) => p.payout_method).map((p) => p.payout_method), ...BASE_PAYMENT_METHODS.slice(2)];
}

/** Nhãn hiển thị của các phương thức payout */
export function payoutLabels() {
  return Object.fromEntries(platformList().filter((p) => p.payout_method).map((p) => [p.payout_method, p.payout_label]));
}

/** Phương thức ghi nhận "tiền về" cho một kênh: payout của nền tảng, kênh khác dùng chuyển khoản */
export const payoutMethodOf = (channelId) => platformByChannel(channelId)?.payout_method ?? 'bank';
