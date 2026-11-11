import { describe, it, expect } from 'vitest';
import { rowsToOrders } from '../pages/Import.jsx';
import { toMoney, toQty, missingColumns } from '../lib/importRows.js';

const SHOPEE = {
  external_id: 'Mã đơn hàng', ordered_at: 'Ngày đặt hàng', status: 'Trạng Thái Đơn Hàng', customer_name: 'Tên Người nhận', customer_phone: 'Số điện thoại',
  sku: 'SKU phân loại hàng', sku_fallback: 'SKU sản phẩm', qty: 'Số lượng', unit_price: 'Giá ưu đãi', platform_fee: ['Phí cố định', 'Phí Dịch Vụ', 'Phí thanh toán'], shipping_fee: 'Phí vận chuyển mà người mua trả',
};

describe('rowsToOrders: gom dòng file thành đơn', () => {
  it('nhiều dòng cùng mã đơn thành một đơn nhiều sản phẩm; đơn-cấp lấy ở dòng đầu', () => {
    const rows = [
      { 'Mã đơn hàng': 'A1', 'Ngày đặt hàng': '2026-11-02 10:15:00', 'Trạng Thái Đơn Hàng': 'Hoàn thành', 'Tên Người nhận': 'Chị Hoa', 'Số điện thoại': '0977000111', 'SKU phân loại hàng': 'nh-go-10', 'Số lượng': '2', 'Giá ưu đãi': '135.000' },
      { 'Mã đơn hàng': 'A1', 'SKU phân loại hàng': 'NH-CAM-10', 'Số lượng': '1', 'Giá ưu đãi': '125.000' },
      { 'Mã đơn hàng': 'A2', 'SKU phân loại hàng': 'PT-1', 'Số lượng': '1' },
    ];
    const { orders, errors } = rowsToOrders(rows, SHOPEE);
    expect(errors).toEqual([]);
    expect(orders).toHaveLength(2);
    expect(orders[0].lines).toEqual([
      { sku: 'nh-go-10', qty: 2, unit_price: 135000 },
      { sku: 'NH-CAM-10', qty: 1, unit_price: 125000 },
    ]);
    expect(orders[0].customer.name).toBe('Chị Hoa');
    expect(orders[1].lines[0]).not.toHaveProperty('unit_price'); // không có giá → để server lấy giá niêm yết
  });

  it('tiền hiểu cả "135.000", "1,250,000 ₫"; phí sàn cộng nhiều cột', () => {
    const rows = [{ 'Mã đơn hàng': 'B1', 'SKU phân loại hàng': 'X', 'Số lượng': 1, 'Giá ưu đãi': '1,250,000 ₫', 'Phí cố định': '9.000', 'Phí Dịch Vụ': 3000, 'Phí thanh toán': '' }];
    const [o] = rowsToOrders(rows, SHOPEE).orders;
    expect(o.lines[0].unit_price).toBe(1250000);
    expect(o.platform_fee_amount).toBe(12000);
  });

  it('giờ Shopee (giờ VN) đổi sang ISO có múi giờ +07:00; ngày dd/mm/yyyy cũng hiểu', () => {
    const base = { 'Mã đơn hàng': 'C1', 'SKU phân loại hàng': 'X', 'Số lượng': 1 };
    expect(rowsToOrders([{ ...base, 'Ngày đặt hàng': '2026-11-02 10:15:00' }], SHOPEE).orders[0].ordered_at).toBe('2026-11-02T10:15:00+07:00');
    expect(rowsToOrders([{ ...base, 'Ngày đặt hàng': '02/11/2026' }], SHOPEE).orders[0].ordered_at).toBe('2026-11-02T12:00:00+07:00');
    expect(rowsToOrders([{ ...base }], SHOPEE).orders[0].ordered_at).toBeNull();
  });

  it('dòng thiếu mã đơn hoặc thiếu SKU bị báo lỗi, không bị bỏ qua im lặng', () => {
    const rows = [{ 'SKU phân loại hàng': 'X' }, { 'Mã đơn hàng': 'D1' }, { 'Mã đơn hàng': 'D2', 'SKU phân loại hàng': 'OK', 'Số lượng': 1 }];
    const { orders, errors } = rowsToOrders(rows, SHOPEE);
    expect(orders.map((o) => o.external_id)).toEqual(['D2']);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/Dòng 2.*thiếu mã đơn/);
    expect(errors[1]).toMatch(/Dòng 3.*D1.*thiếu SKU/);
  });

  it('dùng SKU dự phòng khi cột SKU phân loại trống', () => {
    const rows = [{ 'Mã đơn hàng': 'E1', 'SKU phân loại hàng': '', 'SKU sản phẩm': 'FALLBACK-1', 'Số lượng': 1 }];
    expect(rowsToOrders(rows, SHOPEE).orders[0].lines[0].sku).toBe('FALLBACK-1');
  });

  it('mã đơn dạng số vẫn thành chuỗi', () => {
    const rows = [{ 'Mã đơn hàng': 2611030001, 'SKU phân loại hàng': 'X', 'Số lượng': 1 }];
    expect(rowsToOrders(rows, SHOPEE).orders[0].external_id).toBe('2611030001');
  });
});

describe('toMoney / toQty: đọc số chịu được nhiều kiểu ghi', () => {
  it('tiền ra số nguyên đồng', () => {
    const cases = [['18000.00', 18000], ['18,000.00', 18000], ['18.000', 18000], ['1.250.000', 1250000], ['1.250.000,50', 1250001], ['18000', 18000],
      ['-6000.00', -6000], ['', 0], [undefined, 0], ['1,250,000 ₫', 1250000], ['1.250', 1250], ['99.5', 100], [12345.6, 12346]];
    for (const [input, out] of cases) expect(toMoney(input), String(input)).toBe(out);
  });
  it('số lượng giữ số lẻ tối đa 3 chữ số', () => {
    expect(toQty('0.5')).toBe(0.5);
    expect(toQty('1,5')).toBe(1.5);
    expect(toQty('2')).toBe(2);
    expect(toQty('0.1234')).toBe(0.123);
    expect(toQty('')).toBe(0);
  });
});

describe('tên cột Unicode NFD, giảm giá âm, trả hàng', () => {
  const nfd = (s) => s.normalize('NFD');
  const MAP = { external_id: 'Mã đơn hàng', sku: 'SKU phân loại hàng', qty: 'Số lượng', unit_price: 'Giá ưu đãi', order_discount: ['Mã giảm giá của Shop', 'Giảm giá từ Combo của Shop'],
    return_status: 'Trạng thái Trả hàng/Hoàn tiền', returned_qty: 'Số lượng sản phẩm được hoàn trả' };

  it('tên cột NFD trong file khớp với tên NFC trong mẫu (và ngược lại)', () => {
    const rows = [{ [nfd('Mã đơn hàng')]: 'A', [nfd('SKU phân loại hàng')]: 'X', [nfd('Số lượng')]: '2', [nfd('Giá ưu đãi')]: '18000.00' }];
    const { orders, errors } = rowsToOrders(rows, MAP);
    expect(errors).toEqual([]);
    expect(orders[0].lines[0]).toMatchObject({ qty: 2, unit_price: 18000 });
    expect(rowsToOrders(rows, Object.fromEntries(Object.entries(MAP).map(([k, v]) => [k, Array.isArray(v) ? v.map(nfd) : nfd(v)]))).orders[0].lines[0].unit_price).toBe(18000);
  });

  it('giảm giá đơn cộng các cột và không bao giờ âm', () => {
    const base = { 'Mã đơn hàng': 'A', 'SKU phân loại hàng': 'X', 'Số lượng': 1 };
    expect(rowsToOrders([{ ...base, 'Mã giảm giá của Shop': '10000.00', 'Giảm giá từ Combo của Shop': '2000.00' }], MAP).orders[0].discount_amount).toBe(12000);
    expect(rowsToOrders([{ ...base, 'Mã giảm giá của Shop': '0.00', 'Giảm giá từ Combo của Shop': '-6000.00' }], MAP).orders[0].discount_amount).toBe(0);
    expect(rowsToOrders([{ ...base, 'Mã giảm giá của Shop': '10000.00', 'Giảm giá từ Combo của Shop': '-6000.00' }], MAP).orders[0].discount_amount).toBe(4000);
  });

  it('số lượng lẻ bị báo lỗi dòng thay vì làm sai đơn', () => {
    const { orders, errors } = rowsToOrders([{ 'Mã đơn hàng': 'A', 'SKU phân loại hàng': 'X', 'Số lượng': '0.5' }], MAP);
    expect(orders).toEqual([]);
    expect(errors[0]).toMatch(/số lượng/);
  });

  it('đọc trạng thái và số lượng trả hàng theo dòng', () => {
    const rows = [{ 'Mã đơn hàng': 'A', 'SKU phân loại hàng': 'X', 'Số lượng': 2, 'Trạng thái Trả hàng/Hoàn tiền': 'Đã Chấp Thuận Yêu Cầu', 'Số lượng sản phẩm được hoàn trả': '1' }, { 'Mã đơn hàng': 'A', 'SKU phân loại hàng': 'Y', 'Số lượng': 1 }];
    const [o] = rowsToOrders(rows, MAP).orders;
    expect(o.lines[0]).toMatchObject({ return_status: 'Đã Chấp Thuận Yêu Cầu', returned_qty: 1 });
    expect(o.lines[1]).not.toHaveProperty('returned_qty');
  });
});

describe('missingColumns: chỉ báo cột thật sự thiếu', () => {
  const map = { platform_fee: ['Phí cố định', 'Phí xử lý giao dịch', 'Phí thanh toán'], unit_price: 'Giá ưu đãi', sku_fallback: 'SKU sản phẩm' };
  const options = { column_aliases: [['Phí xử lý giao dịch', 'Phí thanh toán']] };
  it('NFD không bị báo thiếu; tên cũ thay thế tên mới thì im', () => {
    const cols = ['Phí cố định', 'Phí xử lý giao dịch', 'Giá ưu đãi'].map((c) => c.normalize('NFD'));
    expect(missingColumns(cols, map, options)).toEqual([]);
    expect(missingColumns(['Phí cố định', 'Phí thanh toán', 'Giá ưu đãi'], map, options)).toEqual([]);
  });
  it('thiếu cả hai tên trong nhóm hoặc cột khác thì báo', () => {
    expect(missingColumns(['Phí cố định'], map, options).map(([, c]) => c).sort()).toEqual(['Giá ưu đãi', 'Phí thanh toán', 'Phí xử lý giao dịch']);
    expect(missingColumns(['Phí cố định', 'Phí thanh toán'], map, {}).map(([, c]) => c)).toContain('Phí xử lý giao dịch');
  });
});
