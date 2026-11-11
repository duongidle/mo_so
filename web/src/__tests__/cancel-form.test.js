import { describe, it, expect } from 'vitest';
import { needsPaidChoice, emptyCancelForm, cancelError, cancelBody } from '../lib/cancelForm.js';
import { computeTotals, buildPayload } from '../lib/orderForm.js';

const order = { status: 'confirmed', is_marketplace: false, paid_amount: 100000 };

describe('huỷ đơn còn tiền đã thu', () => {
  it('chỉ hỏi khi đơn ngoài sàn còn tiền đã thu', () => {
    expect(needsPaidChoice(order)).toBe(true);
    expect(needsPaidChoice({ ...order, paid_amount: 0 })).toBe(false);
    expect(needsPaidChoice({ ...order, is_marketplace: true })).toBe(false);
  });
  it('bắt chọn trước khi huỷ và kiểm số giữ cọc', () => {
    const f = emptyCancelForm(order);
    expect(cancelError(order, f)).toMatch(/Chọn/);
    expect(cancelError(order, { ...f, paid_action: 'forfeit', forfeit: 100001 })).toMatch(/lớn hơn/);
    expect(cancelError(order, { ...f, paid_action: 'forfeit', forfeit: 0 })).toBeTruthy();
    expect(cancelError(order, { ...f, paid_action: 'refund' })).toBeNull();
  });
  it('dựng thân yêu cầu: hoàn sau, hoàn ngay, giữ một phần', () => {
    const f = emptyCancelForm(order);
    expect(cancelBody(order, { ...f, paid_action: 'refund' })).toEqual({ status: 'cancelled', paid_action: 'refund' });
    expect(cancelBody(order, { ...f, paid_action: 'refund', refund_now: true, method: 'bank' }).refund).toEqual({ method: 'bank' });
    const part = cancelBody(order, { ...f, paid_action: 'forfeit', forfeit: 30000, refund_now: true, method: 'customer_credit' });
    expect(part).toMatchObject({ paid_action: 'forfeit', forfeit_amount: 30000, refund: { method: 'cash', to_credit: true } });
    expect(cancelBody(order, { ...f, paid_action: 'forfeit', forfeit: 100000, refund_now: true }).refund).toBeUndefined();
    expect(cancelBody({ ...order, paid_amount: 0 }, f)).toEqual({ status: 'cancelled' });
  });
});

describe('đơn sàn không cộng phí ship khách trả', () => {
  const lines = [{ uid: 1, qty: 2, price: 100000, discount: 0, avg_cost: 40000 }];
  it('tổng và payload bỏ ship khi là kênh sàn', () => {
    expect(computeTotals({ lines, shipping: 30000, platformFee: 24000, marketplace: true }).net).toBe(176000);
    expect(computeTotals({ lines, shipping: 30000, marketplace: false }).total).toBe(230000);
    expect(buildPayload({ lines: [{ uid: 1, variant_id: 'v', qty: 2, price: 100000, discount: 0 }], edits: {}, shipping: 30000, marketplace: true, discount: 0 }).shipping_fee).toBe(0);
  });
});
