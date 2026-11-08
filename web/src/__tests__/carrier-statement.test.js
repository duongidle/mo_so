import { describe, it, expect } from 'vitest';
import { guessMapping, rowsFromSheet, toMoney, outcomeOf } from '../lib/carrierStatement.js';

describe('bảng đối soát hãng vận chuyển', () => {
  const cols = ['Mã vận đơn', 'Trạng thái', 'Tiền thu hộ (COD)', 'Phí vận chuyển', 'Phí COD', 'Phí chuyển hoàn', 'Phí bảo hiểm'];
  it('đoán đúng cột, phí COD không bị nhầm với tiền COD', () => {
    expect(guessMapping(cols)).toEqual({ tracking_code: 'Mã vận đơn', outcome: 'Trạng thái', cod_amount: 'Tiền thu hộ (COD)', ship_fee: 'Phí vận chuyển', cod_fee: 'Phí COD', return_fee: 'Phí chuyển hoàn', other_fee: 'Phí bảo hiểm' });
  });
  it('đọc số tiền kiểu 1.250.000 đ và trạng thái hoàn', () => {
    expect(toMoney('1.250.000 đ')).toBe(1250000);
    expect(toMoney('')).toBe(0);
    expect(outcomeOf('Đã hoàn hàng')).toBe('returned');
    expect(outcomeOf('Giao thành công')).toBe('delivered');
    const rows = rowsFromSheet([{ 'Mã vận đơn': ' ghn1 ', 'Trạng thái': 'Giao thành công', 'Tiền thu hộ (COD)': '630.000', 'Phí vận chuyển': '25.000' }, { 'Mã vận đơn': '' }], guessMapping(cols));
    expect(rows).toEqual([{ tracking_code: 'ghn1', outcome: 'delivered', cod_amount: 630000, ship_fee: 25000, cod_fee: 0, return_fee: 0, other_fee: 0 }]);
  });
});
