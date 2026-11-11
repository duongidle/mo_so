import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { PurchaseReturnModal, previewCredit, owesAfter } from '../pages/PurchaseReturnModal.jsx';

const line = { id: 'pul1', sku: 'A1', product_name: 'Hạt A', returnable_qty: 10, remaining_value: 900000 };
const purchase = { id: 'p1', total_amount: 1100000, returned_amount: 0, allowance_amount: 0, paid_amount: 1100000, supplier_owes: 0, lines: [line] };

describe('Trả hàng nhập', () => {
  it('tính phần NCC trả lại theo tỷ lệ số lượng, trả hết thì đúng giá trị còn lại', () => {
    expect(previewCredit(line, 4)).toBe(360000);
    expect(previewCredit(line, 10)).toBe(900000);
    expect(previewCredit(line, 0)).toBe(0);
  });
  it('phần vượt số còn phải trả là NCC nợ shop', () => {
    expect(owesAfter(purchase, 360000)).toBe(360000);
    expect(owesAfter({ ...purchase, paid_amount: 0 }, 360000)).toBe(0);
  });
  it('hộp thoại liệt kê dòng và số còn trả được', () => {
    render(<PurchaseReturnModal purchase={purchase} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByLabelText('Số lượng trả A1')).toBeTruthy();
    expect(screen.getByText(/còn trả được 10/)).toBeTruthy();
  });
});
