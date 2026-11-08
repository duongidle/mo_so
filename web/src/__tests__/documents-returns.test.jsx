import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { api } from '../api.js';
vi.mock('../session.jsx', () => ({ useSession: () => ({ shopId: 'shp_1', isAll: false }) }));
import Documents, { documentPath } from '../pages/Documents.jsx';
import ReturnModal, { emptyReturnForm } from '../pages/ReturnModal.jsx';
import { codRefusedForm } from '../lib/returnForm.js';

beforeEach(() => vi.clearAllMocks());

describe('Chứng từ', () => {
  it('liệt kê phiếu gộp và mở đúng nơi', async () => {
    api.get.mockResolvedValue({ data: [
      { type: 'order', id: 'ord_1', code: 'DH-1', at: '2026-11-08T03:00:00Z', shop_name: 'NH', amount: 300000, status: 'completed' },
      { type: 'write_off', id: 'wof_1', code: 'HH-1', at: '2026-11-08T04:00:00Z', shop_name: 'NH', amount: 100000, status: 'done', order_id: 'ord_1' },
    ], total: 2, has_more: false });
    render(<MemoryRouter><Documents /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('HH-1')).toBeTruthy());
    expect(screen.getByText('DH-1')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ shop_id: 'shp_1', limit: 50, offset: 0 }));
    expect(documentPath({ type: 'write_off', order_id: 'ord_9' })).toBe('/orders/ord_9');
    expect(documentPath({ type: 'purchase', id: 'pur_1' })).toBe('/purchases/pur_1');
  });
});

describe('Form trả hàng', () => {
  const order = { id: 'ord_1', status: 'shipping', is_marketplace: false, shipping_fee: 30000, returned_shipping_amount: 0, paid_amount: 0, customer_id: null, lines: [{ id: 'l1', name: 'A', qty: 2, returned_qty: 0, line_total: 400000, allocated_order_discount: 0 }] };
  it('có chọn lý do trả hàng và gửi reason_code + hàng chờ về khi giao không thành', async () => {
    api.post.mockResolvedValue({ data: {} });
    let form = codRefusedForm(order, emptyReturnForm(false));
    const act = { busy: false, error: null, run: async (fn) => fn() };
    const onDone = vi.fn();
    const { rerender } = render(<ReturnModal order={order} form={form} setForm={(f) => { form = f; }} act={act} methodList={() => [['cash', 'Tiền mặt']]} onClose={() => {}} onDone={onDone} />);
    expect(screen.getByLabelText('Lý do trả hàng').value).toBe('customer_refused');
    expect(screen.getByText('Giao không thành / trả hàng chờ về')).toBeTruthy();
    fireEvent.click(screen.getByText('Ghi nhận trả hàng'));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][0]).toBe('/orders/ord_1/returns');
    expect(api.post.mock.calls[0][1]).toMatchObject({ reason_code: 'customer_refused', awaiting_goods: true, shipping_refund_amount: 30000 });
    void rerender;
  });
});
