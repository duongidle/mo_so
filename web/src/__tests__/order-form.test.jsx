import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
const session = vi.hoisted(() => ({ value: null }));
vi.mock('../session.jsx', () => ({ useSession: () => session.value }));
import { api } from '../api.js';
import { methodOptions } from '../lib.js';
import OrderForm from '../pages/OrderForm.jsx';

const SHOP = { id: 'shp_1', name: 'Nước hoa', code: 'NH' };
const CHANNELS = [{ id: 'direct', name: 'Trực tiếp', is_marketplace: 0 }, { id: 'shopee', name: 'Shopee', is_marketplace: 1 }];
const TD = { id: 'var_1', sku: 'TD-1', kind: 'single', product_name: 'Tinh dầu', variant_name: null, price: 100000, avg_cost: 40000, on_hand: 10, on_hand_total: 10, stock_by_warehouse: [{ warehouse_id: 'w1', warehouse_name: 'Kho chính', on_hand: 6 }, { warehouse_id: 'w2', warehouse_name: 'Kho phụ', on_hand: 4 }] };
const LAN = { id: 'cus_1', name: 'Chị Lan', phone: '0922000222', code: 'KH-00001', order_count: 1, total_spent: 1, last_order_at: null, address: '12 Lê Lợi' };

const previewFor = (lines) => ({
  primary_warehouse_id: 'w1',
  warehouses: [{ id: 'w1', name: 'Kho chính' }, { id: 'w2', name: 'Kho phụ' }],
  lines: lines.map((l, i) => {
    const want = l.qty;
    if (l.allocations) return { index: i, variant_id: l.variant_id, sku: 'TD-1', qty: want, items: l.allocations.map((a) => ({ ...a, sku: 'TD-1', warehouse_name: a.warehouse_id === 'w1' ? 'Kho chính' : 'Kho phụ', short_qty: 0 })) };
    const a = Math.min(want, 6);
    const items = [{ variant_id: l.variant_id, sku: 'TD-1', warehouse_id: 'w1', warehouse_name: 'Kho chính', qty: a, short_qty: 0 }];
    if (want > a) items.push({ variant_id: l.variant_id, sku: 'TD-1', warehouse_id: 'w2', warehouse_name: 'Kho phụ', qty: want - a, short_qty: 0 });
    return { index: i, variant_id: l.variant_id, sku: 'TD-1', qty: want, items };
  }),
  stock: [{ variant_id: 'var_1', sku: 'TD-1', warehouses: [{ warehouse_id: 'w1', warehouse_name: 'Kho chính', on_hand: 6 }, { warehouse_id: 'w2', warehouse_name: 'Kho phụ', on_hand: 4 }] }],
  shortages: [], warnings: [], ok: true,
});

function setup() {
  session.value = { shop: SHOP, shops: [SHOP], channels: CHANNELS, allChannels: CHANNELS, methodList: (c) => methodOptions([], c) };
  api.get.mockImplementation(async (path, params = {}) => {
    if (path === '/variants') return { data: [TD] };
    if (path === '/customers') return { data: [LAN] };
    if (path.startsWith('/loyalty/customers/')) return { data: { tier: { name: 'Thành viên', discount_pct: 0 } } };
    return { data: [] };
  });
  api.post.mockImplementation(async (path, body) => {
    if (path === '/orders/allocation-preview') return { data: previewFor(body.lines) };
    if (path === '/orders') return { data: { id: 'ord_1' } };
    return { data: {} };
  });
  return render(
    <MemoryRouter initialEntries={['/orders/new']}>
      <Routes><Route path="/orders/new" element={<OrderForm />} /><Route path="/orders/:id" element={<div>CHI TIẾT ĐƠN</div>} /></Routes>
    </MemoryRouter>,
  );
}
const addProduct = async () => {
  const input = screen.getByLabelText('Tìm sản phẩm');
  fireEvent.focus(input);
  fireEvent.mouseDown(await screen.findByRole('option', { name: /Tinh dầu/ }));
  await screen.findByLabelText('Đơn giá TD-1');
};

describe('OrderForm (/orders/new)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('thêm sản phẩm, tính tổng, chọn khách có sẵn và gửi customer_id khi Bán xong', async () => {
    setup();
    await addProduct();
    fireEvent.click(screen.getByLabelText('Tăng TD-1'));
    expect(screen.getByTestId('total').textContent).toBe('200.000 ₫');
    fireEvent.change(screen.getByLabelText('Phí ship khách trả'), { target: { value: '15000' } });
    expect(screen.getByTestId('total').textContent).toBe('215.000 ₫');
    expect(screen.queryByLabelText('Phí sàn')).toBeNull(); // kênh trực tiếp không có phí sàn

    const search = screen.getByLabelText('Tìm khách hàng');
    fireEvent.focus(search);
    fireEvent.mouseDown(await screen.findByText('Chị Lan'));
    await screen.findByText('KH-00001', { exact: false });
    expect(screen.getByLabelText('Địa chỉ giao hàng').value).toBe('12 Lê Lợi'); // địa chỉ mặc định được điền sẵn

    fireEvent.click(screen.getByRole('button', { name: 'Bán xong' }));
    await screen.findByText('CHI TIẾT ĐƠN');
    const call = api.post.mock.calls.find(([p]) => p === '/orders');
    expect(call[1]).toMatchObject({ shop_id: 'shp_1', channel_id: 'direct', customer_id: 'cus_1', status: 'completed', shipping_fee: 15000, shipping_address: '12 Lê Lợi', payments: [{ amount: 215000, method: 'cash' }] });
    expect(call[1].customer).toBeUndefined();
    expect(call[2]['Idempotency-Key']).toBeTruthy();
  });

  it('kênh sàn hiện phí sàn/ship shop chịu; shop thực nhận và cần thu theo net', async () => {
    setup();
    await addProduct();
    fireEvent.change(screen.getByLabelText('Kênh'), { target: { value: 'shopee' } });
    fireEvent.change(await screen.findByLabelText('Phí sàn'), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('Ship shop chịu'), { target: { value: '8000' } });
    expect(screen.getByTestId('total').textContent).toBe('100.000 ₫');
    expect(screen.getByTestId('net').textContent).toBe('80.000 ₫');
    expect(screen.getByTestId('profit').textContent).toBe('40.000 ₫'); // 80.000 − giá vốn 40.000
    fireEvent.click(screen.getByRole('button', { name: 'Bán xong' }));
    await screen.findByText('CHI TIẾT ĐƠN');
    const body = api.post.mock.calls.find(([p]) => p === '/orders')[1];
    expect(body).toMatchObject({ channel_id: 'shopee', platform_fee_amount: 12000, seller_shipping_amount: 8000, payments: [{ amount: 80000, method: 'cash' }] });
  });

  it('chia kho tay: lệch tổng thì chặn nút, khớp thì gửi allocations', async () => {
    setup();
    await addProduct();
    fireEvent.click(screen.getByLabelText('Tăng TD-1')); // SL 2
    const chia = await screen.findByRole('button', { name: 'Chia kho' });
    await waitFor(() => expect(chia.disabled).toBe(false));
    await screen.findByText(/Kho chính × 2/);
    fireEvent.click(chia);
    fireEvent.change(await screen.findByLabelText('TD-1 lấy từ Kho chính'), { target: { value: '1' } });
    await screen.findByText('Chia kho đang lệch: tổng phải bằng số lượng cần.');
    expect(screen.getByRole('button', { name: 'Bán xong' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('TD-1 lấy từ Kho phụ'), { target: { value: '1' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bán xong' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await screen.findByText('CHI TIẾT ĐƠN');
    const body = api.post.mock.calls.find(([p]) => p === '/orders')[1];
    expect(body.status).toBe('draft');
    expect(body.payments).toEqual([]);
    expect(body.lines[0].allocations).toEqual([{ variant_id: 'var_1', warehouse_id: 'w1', qty: 1 }, { variant_id: 'var_1', warehouse_id: 'w2', qty: 1 }]);
  });

  it('thiếu sản phẩm thì báo lỗi, không gọi API tạo đơn', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/ít nhất 1 sản phẩm/);
    expect(api.post.mock.calls.some(([p]) => p === '/orders')).toBe(false);
  });
});
