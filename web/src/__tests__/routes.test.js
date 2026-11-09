import { describe, it, expect } from 'vitest';
import { allowsAllShops } from '../lib/routes.js';

describe('"Tất cả shop" chỉ ở các trang cho phép', () => {
  it('cho phép ở Tổng quan, Đơn, Kho, Khách, Báo cáo, Loyalty, Kế toán, Hướng dẫn', () => {
    for (const p of ['/', '/orders', '/orders/new', '/stock', '/customers/cus_1', '/reports', '/loyalty', '/accounting', '/guide/chot-kho']) expect(allowsAllShops(p), p).toBe(true);
  });
  it('không cho phép ở Sản phẩm, Nhập hàng, Chi phí, Cài đặt', () => {
    for (const p of ['/products', '/products/new', '/purchases', '/purchases/pur_1', '/expenses', '/settings', '/more']) expect(allowsAllShops(p), p).toBe(false);
  });
});

describe('hidesShopSwitcher', () => {
  it('ẩn bộ chọn shop ở trang Nhập hàng (không phụ thuộc shop), giữ ở các trang khác', async () => {
    const { hidesShopSwitcher } = await import('../lib/routes.js');
    for (const p of ['/purchases', '/purchases/new', '/purchases/pur_1']) expect(hidesShopSwitcher(p)).toBe(true);
    for (const p of ['/', '/orders', '/stock', '/products', '/settings']) expect(hidesShopSwitcher(p)).toBe(false);
  });
});
