import { describe, it, expect } from 'vitest';
import { lineReturnValue, computeReturn, returnSummary, codRefusedForm } from '../lib/returnForm.js';

const fmt = (n) => `${n}đ`;
const order = (o = {}) => ({
  is_marketplace: false, shipping_fee: 20000, returned_shipping_amount: 0, paid_amount: 290000,
  lines: [{ id: 'l1', qty: 2, returned_qty: 0, returned_value: 0, line_total: 300000, allocated_order_discount: 30000 }],
  ...o,
});

describe('lineReturnValue', () => {
  it('trả 1 trong 2 cái = nửa tiền thực của dòng (đã trừ giảm giá đơn chia)', () => {
    expect(lineReturnValue(order().lines[0], 1)).toBe(135000);
  });
  it('làm tròn luỹ kế: 3 lần trả 1 cái trên dòng 100đ có 3 cái ra 33, 34, 33', () => {
    const l = { qty: 3, returned_qty: 0, returned_value: 0, line_total: 100, allocated_order_discount: 0 };
    const a = lineReturnValue(l, 1);
    const b = lineReturnValue({ ...l, returned_qty: 1, returned_value: a }, 1);
    const c = lineReturnValue({ ...l, returned_qty: 2, returned_value: a + b }, 1);
    expect([a, b, c]).toEqual([33, 34, 33]);
  });
});

describe('computeReturn', () => {
  const form = (p = {}) => ({ lines: { l1: { qty: 1, restock: true } }, shipOn: false, shipRefund: '', fee: '', shipCost: '', refund: null, ...p });
  it('mặc định trả đủ cho đơn đã thu', () => {
    const r = computeReturn(order(), form());
    expect(r).toMatchObject({ goods: 135000, due: 135000, refund: 135000, owedAfter: 0 });
  });
  it('đơn chưa thu (COD): tiền trả ngay mặc định 0', () => {
    const r = computeReturn(order({ paid_amount: 0 }), form());
    expect(r.refund).toBe(0);
    expect(r.owedAfter).toBe(135000);
  });
  it('phí trả hàng giảm cần trả khách; không vượt hàng + ship hoàn', () => {
    expect(computeReturn(order(), form({ fee: '50000' })).due).toBe(85000);
    expect(computeReturn(order(), form({ fee: '999999' })).fee).toBe(135000);
  });
  it('ship hoàn không vượt phần ship còn lại', () => {
    const r = computeReturn(order({ returned_shipping_amount: 5000 }), form({ shipOn: true, shipRefund: '99999' }));
    expect(r.shipRefund).toBe(15000);
  });
  it('tiền trả khách không vượt cần trả khách và số đã thu', () => {
    expect(computeReturn(order(), form({ refund: '999999' })).refund).toBe(135000);
    expect(computeReturn(order({ paid_amount: 100000 }), form({ refund: '999999' })).refund).toBe(100000);
  });
  it('kênh sàn: không hoàn ship, phí, tiền trả khách', () => {
    const r = computeReturn(order({ is_marketplace: true }), form({ shipOn: true, shipRefund: '5000', fee: '1000', refund: '5', shipCost: '7000' }));
    expect(r).toMatchObject({ shipRefund: 0, fee: 0, due: 0, refund: 0, shipCost: 7000 });
  });
});

describe('codRefusedForm', () => {
  it('trả toàn bộ, nhập lại kho, hoàn toàn bộ ship, tiền trả 0', () => {
    const o = order({ paid_amount: 0 });
    const r = computeReturn(o, codRefusedForm(o, { reason: '' }));
    expect(r).toMatchObject({ goods: 270000, shipRefund: 20000, due: 290000, refund: 0, owedAfter: 290000 });
  });
});

describe('returnSummary', () => {
  it('nói rõ khoản còn nợ khách', () => {
    const r = computeReturn(order({ paid_amount: 290000 }), { lines: { l1: { qty: 1 } }, refund: '0' });
    expect(returnSummary(r, fmt, false)).toContain('Shop còn nợ khách 135000đ');
  });
  it('phí = toàn bộ giá trị: shop giữ lại tiền', () => {
    const r = computeReturn(order(), { lines: { l1: { qty: 1 } }, fee: '135000' });
    expect(returnSummary(r, fmt, false)).toContain('giữ lại');
  });
});
