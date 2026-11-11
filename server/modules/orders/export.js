import { getDb } from '../../db/index.js';
import { config } from '../../lib/config.js';
import { badRequest } from '../../lib/errors.js';
import { orderFilter, orderGrossProfit } from './service.js';

const MAX_ROWS = 50000;

const STATUS_VI = { draft: 'Nháp', confirmed: 'Đã xác nhận', shipping: 'Đang giao', completed: 'Hoàn thành', cancelled: 'Đã huỷ', returned: 'Đã trả hàng' };
const PAY_VI = { unpaid: 'Chưa thu', partial: 'Thu một phần', paid: 'Đã thu', refunded: 'Đã hoàn' };

/** Ngày giờ theo giờ Việt Nam: 03/11/2026 14:30 */
function vnDateTime(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: config.businessTz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(iso))
    .replace(', ', ' ');
}
const vnDate = (d) => (d ? d.split('-').reverse().join('/') : '');

// Cột của file "mỗi đơn một dòng". Tiền là số nguyên đồng (không định dạng) để cộng trực tiếp trong Excel.
const ORDER_COLUMNS = [
  ['Mã đơn', (o) => o.code],
  ['Mã đơn trên kênh', (o) => o.external_id ?? ''],
  ['Shop', (o) => o.shop_name],
  ['Kênh', (o) => o.channel_name],
  ['Ngày đặt', (o) => vnDateTime(o.ordered_at)],
  ['Trạng thái', (o) => STATUS_VI[o.status] ?? o.status],
  ['Thanh toán', (o) => PAY_VI[o.payment_status] ?? o.payment_status],
  ['Khách', (o) => o.customer_name ?? ''],
  ['Số điện thoại', (o) => o.customer_phone ?? ''],
  ['Địa chỉ giao', (o) => o.shipping_address ?? ''],
  ['Số sản phẩm', (o) => o.item_count ?? 0],
  ['Tiền hàng', (o) => o.subtotal],
  ['Giảm giá', (o) => o.line_discount_amount + o.discount_amount],
  ['Phí ship khách trả', (o) => o.shipping_fee],
  ['Khách phải trả', (o) => o.total_amount],
  ['Phí sàn', (o) => o.platform_fee_amount],
  ['Ship shop chịu', (o) => o.seller_shipping_amount],
  ['Shop thực nhận', (o) => o.net_amount],
  ['Hàng trả (gồm giảm giá sau bán)', (o) => o.returned_goods_amount],
  ['Hoàn phí ship', (o) => o.returned_shipping_amount],
  ['Phí trả hàng thu được', (o) => o.return_fee_amount],
  ['Phí sàn được hoàn', (o) => o.platform_fee_refunded_amount],
  ['Ship chiều về', (o) => o.return_shipping_cost],
  ['Doanh thu thuần', (o) => o.net_revenue],
  ['Giá vốn', (o) => o.cogs_amount],
  // Giống chi tiết đơn: đơn nháp/huỷ không có lợi nhuận
  ['Lợi nhuận gộp', (o) => (o.status === 'cancelled' || o.status === 'draft' ? 0 : orderGrossProfit(o))],
  ['Đã thu', (o) => o.paid_amount],
  ['Mã vận đơn', (o) => o.tracking_code ?? ''],
  ['Đơn vị vận chuyển', (o) => o.carrier ?? ''],
  ['Ghi chú', (o) => o.note ?? ''],
];

const LINE_COLUMNS = [
  ['Mã đơn', (r) => r.code],
  ['Mã đơn trên kênh', (r) => r.external_id ?? ''],
  ['Shop', (r) => r.shop_name],
  ['Kênh', (r) => r.channel_name],
  ['Ngày đặt', (r) => vnDateTime(r.ordered_at)],
  ['Trạng thái', (r) => STATUS_VI[r.status] ?? r.status],
  ['Khách', (r) => r.customer_name ?? ''],
  ['Số điện thoại', (r) => r.customer_phone ?? ''],
  ['SKU', (r) => r.sku],
  ['Tên sản phẩm', (r) => r.name],
  ['Số lượng', (r) => r.qty],
  ['Đơn giá', (r) => r.unit_price],
  ['Giảm giá dòng', (r) => r.discount_amount],
  ['Thành tiền', (r) => r.line_total],
  ['Giá vốn / cái', (r) => r.unit_cost],
  ['Đã trả (SL)', (r) => r.returned_qty],
];

/**
 * Xuất đơn theo cùng bộ lọc với danh sách đơn.
 * layout: 'orders' = mỗi đơn một dòng; 'lines' = mỗi sản phẩm trong đơn một dòng (hợp để đối chiếu hàng hoá/kế toán).
 * Trả { headers, rows } với rows là mảng giá trị; nơi gọi tự quyết CSV hay Excel.
 */
export function exportOrders(filters, layout = 'orders') {
  const db = getDb();
  const { where, params } = orderFilter(filters);
  const wsql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o ${wsql}`).get(...params).n;
  if (layout === 'lines') {
    const lines = db.prepare(`SELECT COUNT(*) AS n FROM order_lines l JOIN orders o ON o.id = l.order_id ${wsql}`).get(...params).n;
    if (lines > MAX_ROWS) throw badRequest('TOO_MANY_ROWS', `Có ${lines} dòng hàng, vượt giới hạn ${MAX_ROWS}. Vui lòng thu hẹp khoảng ngày hoặc bộ lọc.`);
  } else if (total > MAX_ROWS) {
    throw badRequest('TOO_MANY_ROWS', `Có ${total} đơn, vượt giới hạn ${MAX_ROWS}. Vui lòng thu hẹp khoảng ngày hoặc bộ lọc.`);
  }

  const base = `FROM orders o JOIN shops s ON s.id = o.shop_id JOIN channels ch ON ch.id = o.channel_id`;
  if (layout === 'lines') {
    const rows = db
      .prepare(
        `SELECT o.code, o.external_id, s.name AS shop_name, ch.name AS channel_name, o.ordered_at, o.status, o.customer_name, o.customer_phone,
                l.sku, l.name, l.qty, l.unit_price, l.discount_amount, l.line_total, l.unit_cost, l.returned_qty
         ${base} JOIN order_lines l ON l.order_id = o.id ${wsql} ORDER BY o.ordered_at, o.code, l.sort_order`,
      )
      .all(...params);
    return { headers: LINE_COLUMNS.map((c) => c[0]), rows: rows.map((r) => LINE_COLUMNS.map((c) => c[1](r))), count: rows.length, orders: total };
  }
  const rows = db
    .prepare(
      `SELECT o.*, s.name AS shop_name, ch.name AS channel_name,
              (SELECT SUM(qty) FROM order_lines l WHERE l.order_id = o.id) AS item_count
       ${base} ${wsql} ORDER BY o.ordered_at, o.code`,
    )
    .all(...params);
  return { headers: ORDER_COLUMNS.map((c) => c[0]), rows: rows.map((o) => ORDER_COLUMNS.map((c) => c[1](o))), count: rows.length, orders: total };
}

/** Đếm trước khi xuất: số đơn, số dòng hàng, và số dòng của file theo từng kiểu */
export function countExport(filters) {
  const db = getDb();
  const { where, params } = orderFilter(filters);
  const wsql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orders = db.prepare(`SELECT COUNT(*) AS n FROM orders o ${wsql}`).get(...params).n;
  const lines = db.prepare(`SELECT COUNT(*) AS n FROM order_lines l JOIN orders o ON o.id = l.order_id ${wsql}`).get(...params).n;
  return { orders, lines, max_rows: MAX_ROWS };
}

export const exportFileName = (layout, from, to) => `don-hang-${layout === 'lines' ? 'chi-tiet-' : ''}${from ? from.replaceAll('-', '') : 'tat-ca'}${to ? `-${to.replaceAll('-', '')}` : ''}.csv`;
export { vnDate };
