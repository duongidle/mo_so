import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { api } from '../api.js';
import ReturnModal, { emptyReturnForm } from '../pages/ReturnModal.jsx';
import AllowanceModal, { emptyAllowanceForm } from '../pages/AllowanceModal.jsx';
import { computeReturn, defaultPlatformFeeRefund, returnSummary } from '../lib/returnForm.js';
import { computeAllowance, remainingGoods, allowanceSummary } from '../lib/allowanceForm.js';

beforeEach(() => vi.clearAllMocks());

const mp = (o = {}) => ({
  id: 'ord_1', status: 'completed', is_marketplace: true, shipping_fee: 0, returned_shipping_amount: 0, paid_amount: 0, customer_id: null,
  goods_revenue: 300000, platform_fee_amount: 10000, platform_fee_refunded_amount: 0, net_amount: 290000, total_amount: 300000, returned_amount: 0, returns: [],
  lines: [{ id: 'l1', name: 'A', sku: 'A1', qty: 3, returned_qty: 0, returned_value: 0, line_total: 300000, allocated_order_discount: 0 }],
  ...o,
});
const form = (qty, p = {}) => ({ lines: { l1: { qty, restock: true } }, shipOn: false, shipRefund: '', fee: '', shipCost: '', refund: null, feeRefund: null, ...p });

describe('Phí sàn được hoàn (đơn sàn)', () => {
  it('mặc định theo tỷ lệ luỹ kế, giống máy chủ: 3333, 3334, 3333', () => {
    const o = mp();
    const r1 = computeReturn(o, form(1));
    expect(r1).toMatchObject({ goods: 100000, feeRefund: 3333, feeRefundMax: 10000, receivableDrop: 96667 });
    const o2 = mp({ platform_fee_refunded_amount: 3333, returns: [{ kind: 'return', goods_amount: 100000 }], lines: [{ ...o.lines[0], returned_qty: 1, returned_value: 100000 }] });
    expect(computeReturn(o2, form(1)).feeRefund).toBe(3334);
    const o3 = mp({ platform_fee_refunded_amount: 6667, returns: [{ kind: 'return', goods_amount: 100000 }, { kind: 'return', goods_amount: 100000 }], lines: [{ ...o.lines[0], returned_qty: 2, returned_value: 200000 }] });
    expect(computeReturn(o3, form(1)).feeRefund).toBe(3333);
  });
  it('trả hết hoàn đủ phí; sửa tay được kể cả 0, bị chặn ở mức phí còn lại', () => {
    expect(computeReturn(mp(), form(3)).feeRefund).toBe(10000);
    expect(computeReturn(mp(), form(3, { feeRefund: '0' })).feeRefund).toBe(0);
    expect(computeReturn(mp(), form(1, { feeRefund: '999999' })).feeRefund).toBe(10000);
  });
  it('giảm giá sau bán không tính vào tỷ lệ hàng trả; kênh thường không có phí hoàn', () => {
    const o = mp({ returns: [{ kind: 'allowance', goods_amount: 100000 }] });
    expect(defaultPlatformFeeRefund(o, 100000, false)).toBe(3333);
    expect(computeReturn(mp({ is_marketplace: false }), form(1)).feeRefund).toBe(0);
  });
  it('câu giải thích nêu phí sàn được hoàn', () => {
    const r = computeReturn(mp(), form(3));
    expect(returnSummary(r, (n) => `${n}đ`, true)).toContain('phí sàn được hoàn 10000đ');
  });
  it('form hiện ô “Phí sàn được hoàn” điền sẵn và gửi platform_fee_refund_amount', async () => {
    api.post.mockResolvedValue({ data: {} });
    let f = emptyReturnForm(true);
    f = { ...f, lines: { l1: { qty: 3, restock: true } } };
    const act = { busy: false, error: null, run: async (fn) => fn() };
    render(<ReturnModal order={mp()} form={f} setForm={(x) => { f = x; }} act={act} methodList={() => [['cash', 'Tiền mặt']]} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByText(/Phí sàn được hoàn/)).toBeTruthy();
    expect(screen.getByDisplayValue('10.000')).toBeTruthy();
    fireEvent.click(screen.getByText('Ghi nhận trả hàng'));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1]).toMatchObject({ platform_fee_refund_amount: 10000, awaiting_goods: true });
  });
});

describe('Giảm giá sau bán / bồi thường', () => {
  const normal = (o = {}) => ({
    id: 'ord_2', status: 'completed', is_marketplace: false, customer_id: null, total_amount: 290000, net_amount: 290000, paid_amount: 290000, returned_amount: 0,
    lines: [{ id: 'l1', line_total: 270000, allocated_order_discount: 0, returned_value: 0 }, { id: 'l2', line_total: 0, allocated_order_discount: 0, returned_value: 0 }], ...o,
  });
  it('tối đa = tiền hàng thực còn lại; đã trả đủ thì hoàn ngay mặc định đúng số giảm', () => {
    const o = normal();
    expect(remainingGoods(o)).toBe(270000);
    expect(computeAllowance(o, { amount: '999999', refund: null })).toMatchObject({ max: 270000, amount: 270000, owed: 270000, refund: 270000 });
    const r = computeAllowance(o, { amount: '100000', refund: null });
    expect(r).toMatchObject({ amount: 100000, refund: 100000, stillOwed: 0 });
    expect(computeAllowance(o, { amount: '100000', refund: '30000' })).toMatchObject({ refund: 30000, stillOwed: 70000 });
  });
  it('khách chưa trả đủ thì chỉ bớt công nợ, không có gì để hoàn', () => {
    const o = normal({ paid_amount: 40000 });
    const r = computeAllowance(o, { amount: '25000', refund: null });
    expect(r).toMatchObject({ owed: 0, refund: 0, debtAfter: 290000 - 25000 - 40000 });
    expect(allowanceSummary(r, (n) => `${n}đ`)).toContain('chỉ bớt công nợ');
  });
  it('đơn sàn: không có tiền trả khách', () => {
    const r = computeAllowance(normal({ is_marketplace: true, net_amount: 270000, paid_amount: 0 }), { amount: '20000', refund: null });
    expect(r).toMatchObject({ refund: 0, marketplace: true });
    expect(allowanceSummary(r, (n) => `${n}đ`)).toContain('Phí sàn không được hoàn');
  });
  it('hộp thoại gửi đúng yêu cầu', async () => {
    api.post.mockResolvedValue({ data: {} });
    let f = { ...emptyAllowanceForm(), amount: '100000' };
    const act = { busy: false, error: null, run: async (fn) => fn() };
    const onDone = vi.fn();
    render(<AllowanceModal order={normal()} form={f} setForm={(x) => { f = x; }} act={act} methodList={() => [['cash', 'Tiền mặt']]} onClose={() => {}} onDone={onDone} />);
    expect(screen.getByText('Giảm giá sau bán / bồi thường')).toBeTruthy();
    fireEvent.click(screen.getByText('Ghi nhận giảm giá'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.post.mock.calls[0][0]).toBe('/orders/ord_2/allowances');
    expect(api.post.mock.calls[0][1]).toMatchObject({ amount: 100000, reason_code: 'defective', refund: { amount: 100000, method: 'cash', to_credit: false } });
  });
});
