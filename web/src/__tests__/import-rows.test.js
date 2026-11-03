import { describe, it, expect } from 'vitest';
import { rowsToOrders } from '../pages/Import.jsx';

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
      { sku: 'nh-go-10', qty: 2, unit_price: 135000, discount_amount: 0 },
      { sku: 'NH-CAM-10', qty: 1, unit_price: 125000, discount_amount: 0 },
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
