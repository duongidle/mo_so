import { describe, it, expect } from 'vitest';
import { guessMapping, rowsFromSheet } from '../lib/productImport.js';

describe('nhập sản phẩm hàng loạt: đọc file', () => {
  const cols = ['Tên sản phẩm', 'Mã SKU', 'Tên biến thể', 'Giá bán', 'Giá vốn', 'Tồn đầu kỳ', 'Kho', 'Danh mục', 'Tồn tối thiểu', 'Bảo hành (ngày)', 'Loại'];
  it('đoán đúng cột, giá vốn không bị nhầm với giá bán, tồn tối thiểu không nhầm tồn đầu kỳ', () => {
    expect(guessMapping(cols)).toMatchObject({ name: 'Tên sản phẩm', sku: 'Mã SKU', variant_name: 'Tên biến thể', price: 'Giá bán', cost: 'Giá vốn', qty: 'Tồn đầu kỳ', warehouse: 'Kho', category: 'Danh mục', min_stock: 'Tồn tối thiểu', warranty_days: 'Bảo hành (ngày)', item_type: 'Loại' });
  });
  it('đọc số kiểu 129.000, bỏ dòng trống', () => {
    const out = rowsFromSheet([{ 'Tên sản phẩm': 'A', 'Mã SKU': 'a1', 'Giá bán': '129.000', 'Tồn đầu kỳ': 5 }, { 'Tên sản phẩm': '', 'Mã SKU': '' }], guessMapping(cols));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'A', sku: 'a1', price: 129000, qty: 5, cost: null });
  });
});
