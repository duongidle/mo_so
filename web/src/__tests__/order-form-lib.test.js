import { describe, it, expect } from 'vitest';
import {
  addVariant, computeTotals, startEdit, editFromPlanned, setCell, editMismatches, editToAllocations, activeEdit, allocationProblems,
  serverLines, paymentsFor, validateForm, buildPayload, previewNotes, lineTotal,
} from '../lib/orderForm.js';

const V = (o = {}) => ({ id: 'var_1', sku: 'TD-1', product_name: 'Tinh dầu', variant_name: null, price: 100000, avg_cost: 40000, on_hand_total: 20, ...o });
const line = (o = {}) => ({ uid: 'u1', variant_id: 'var_1', sku: 'TD-1', qty: 3, price: 100000, discount: 0, avg_cost: 40000, ...o });

describe('computeTotals', () => {
  it('đơn thường: khách trả = hàng − giảm + ship; cần thu = total; lãi = net − giá vốn', () => {
    const t = computeTotals({ lines: [line({ discount: 10000 })], discount: 20000, shipping: 15000, platformFee: 99999, sellerShipping: 0, marketplace: false });
    expect(t.subtotal).toBe(300000);
    expect(t.goods).toBe(300000 - 10000 - 20000);
    expect(t.total).toBe(270000 + 15000);
    expect(t.net).toBe(t.total); // phí sàn không tính khi kênh không phải sàn
    expect(t.amountDue).toBe(t.total);
    expect(t.profit).toBe(t.total - 3 * 40000);
  });
  it('đơn thường có ship shop chịu: trừ vào lãi, không đổi số cần thu', () => {
    const t = computeTotals({ lines: [line()], shipping: 20000, sellerShipping: 25000, platformFee: 9999, marketplace: false });
    expect(t.net).toBe(t.total - 25000);
    expect(t.amountDue).toBe(t.total);
    expect(t.profit).toBe(t.total - 25000 - 120000);
  });
  it('kênh sàn: shop thực nhận trừ phí sàn và ship shop chịu, cần thu = net', () => {
    const t = computeTotals({ lines: [line()], shipping: 20000, platformFee: 30000, sellerShipping: 10000, marketplace: true });
    expect(t.total).toBe(320000);
    expect(t.net).toBe(280000);
    expect(t.amountDue).toBe(280000);
    expect(t.profit).toBe(280000 - 120000);
  });
  it('thiếu giá vốn thì không bịa lãi; giảm giá đơn không vượt tiền hàng', () => {
    const t = computeTotals({ lines: [line({ avg_cost: null })], discount: 9999999 });
    expect(t.profit).toBeNull();
    expect(t.orderDiscount).toBe(300000);
    expect(t.total).toBe(0);
  });
});

describe('dòng đơn', () => {
  it('thêm cùng sản phẩm thì tăng SL; thành tiền = SL × giá − giảm', () => {
    const a = addVariant([], V());
    const b = addVariant(a, V());
    expect(b).toHaveLength(1);
    expect(b[0].qty).toBe(2);
    expect(lineTotal({ ...b[0], discount: 5000 })).toBe(195000);
  });
});

describe('phân bổ kho', () => {
  const pl = { items: [{ variant_id: 'var_1', warehouse_id: 'w1', qty: 2 }, { variant_id: 'var_1', warehouse_id: 'w2', qty: 1 }] };
  it('bản sửa tay khởi tạo từ đề xuất; sửa ô làm lệch tổng thì báo mismatch', () => {
    const e = startEdit(line(), pl);
    expect(e.required).toEqual({ var_1: 3 });
    expect(editMismatches(e)).toEqual([]);
    const bad = setCell(e, 'var_1', 'w1', 1);
    expect(editMismatches(bad)).toEqual([{ variant_id: 'var_1', required: 3, sum: 2 }]);
    const ok = setCell(bad, 'var_1', 'w2', 2);
    expect(editToAllocations(ok)).toEqual([{ variant_id: 'var_1', warehouse_id: 'w1', qty: 1 }, { variant_id: 'var_1', warehouse_id: 'w2', qty: 2 }]);
  });
  it('đổi SL dòng thì bản sửa tay hết hiệu lực và không bị gửi', () => {
    const e = startEdit(line(), pl);
    expect(activeEdit(line({ qty: 4 }), e)).toBeNull();
    const l = line({ qty: 4 });
    expect(serverLines([l], { u1: e })[0].allocations).toBeUndefined();
  });
  it('bản sửa lệch bị chặn khi validate và không gửi allocations; bản khớp được gửi', () => {
    const l = line();
    const bad = setCell(startEdit(l, pl), 'var_1', 'w1', 0);
    expect(allocationProblems([l], { u1: bad })).toHaveLength(1);
    expect(serverLines([l], { u1: bad })[0].allocations).toBeUndefined();
    const totals = computeTotals({ lines: [l] });
    expect(validateForm({ lines: [l], discount: 0, edits: { u1: bad }, totals }).join(' ')).toMatch(/chia 1, cần 3/);
    const good = startEdit(l, pl);
    expect(validateForm({ lines: [l], discount: 0, edits: { u1: good }, totals })).toEqual([]);
    expect(serverLines([l], { u1: good })[0].allocations).toHaveLength(2);
  });
  it('khôi phục phân bổ tay từ planned_allocations của đơn nháp (combo có variant_id từng thành phần)', () => {
    const e = editFromPlanned(line({ qty: 2 }), [{ warehouse_id: 'w2', qty: 2 }], 'var_1');
    expect(e.cells).toEqual({ var_1: { w2: 2 } });
    expect(editFromPlanned(line(), null, 'var_1')).toBeNull();
  });
  it('previewNotes: chỉ báo phần lấy ngoài kho chính và phần thiếu', () => {
    const n = previewNotes({ primary_warehouse_id: 'w1', lines: [{ items: [{ sku: 'A', qty: 1, warehouse_id: 'w1' }, { sku: 'A', qty: 2, warehouse_id: 'w2', warehouse_name: 'Kho 2' }] }], shortages: [{ sku: 'A' }] });
    expect(n.elsewhere).toEqual([{ sku: 'A', qty: 2, warehouse_name: 'Kho 2' }]);
    expect(n.short).toHaveLength(1);
  });
});

describe('thanh toán và payload', () => {
  it('Bán xong mặc định thu đủ; Xác nhận chỉ thu khi nhập; Nháp không thu', () => {
    expect(paymentsFor('completed', '', 270000, 'cash')).toEqual([{ amount: 270000, method: 'cash' }]);
    expect(paymentsFor('completed', '100000', 270000, 'bank')).toEqual([{ amount: 100000, method: 'bank' }]);
    expect(paymentsFor('confirmed', '', 270000, 'cash')).toEqual([]);
    expect(paymentsFor('confirmed', '50000', 270000, 'cash')).toEqual([{ amount: 50000, method: 'cash' }]);
    expect(paymentsFor('draft', '50000', 270000, 'cash')).toEqual([]);
  });
  it('payload tạo đơn luôn có customer_id (không gửi customer inline) và bỏ phí sàn khi không phải kênh sàn', () => {
    const body = buildPayload({ shopId: 's1', channelId: 'direct', externalId: ' ', customerId: 'cus_1', address: ' 12 Lê Lợi ', lines: [line()], edits: {}, discount: 1000, shipping: 2000, platformFee: 500, sellerShipping: 700, marketplace: false, note: '', status: 'completed', payments: [{ amount: 1, method: 'cash' }] });
    expect(body).toMatchObject({ shop_id: 's1', channel_id: 'direct', external_id: null, customer_id: 'cus_1', shipping_address: '12 Lê Lợi', discount_amount: 1000, shipping_fee: 2000, platform_fee_amount: 0, seller_shipping_amount: 700, status: 'completed' });
    expect(body.customer).toBeUndefined();
    expect(body.lines[0]).toEqual({ variant_id: 'var_1', qty: 3, unit_price: 100000, discount_amount: 0 });
  });
  it('payload sửa đơn nháp không có shop/kênh/trạng thái', () => {
    const body = buildPayload({ customerId: null, lines: [line()], edits: {}, discount: 0, shipping: 0, marketplace: true, platformFee: 5000, sellerShipping: 0 });
    expect(body.status).toBeUndefined();
    expect(body.shop_id).toBeUndefined();
    expect(body.platform_fee_amount).toBe(5000);
    expect(body.customer_id).toBeNull();
  });
});
