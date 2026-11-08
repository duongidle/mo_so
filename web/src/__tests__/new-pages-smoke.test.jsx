import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
import { api } from '../api.js';
vi.mock('../session.jsx', () => ({ useSession: () => ({ shopId: 'shp_1', isAll: false, shops: [{ id: 'shp_1', name: 'NH' }], channels: [{ id: 'direct', name: 'Bán trực tiếp' }, { id: 'shopee', name: 'Shopee' }], marketplaces: [], methodLabels: {}, methodList: () => [] }) }));
import Shipping from '../pages/Shipping.jsx';
import StockLots from '../pages/StockLots.jsx';
import Promotions from '../pages/Promotions.jsx';
import { ShipModal, SplitModal, ReserveModal, ShipmentsSection } from '../components/OrderActions.jsx';
import ChannelPrices from '../components/ChannelPrices.jsx';

const order = { id: 'ord_1', amount_due: 630000, reserve_stock: 0, reserved_until: null, lines: [{ id: 'l1', name: 'Cam Gỗ', sku: 'CG', qty: 3 }], shipments: [{ id: 'shp_9', carrier_name: 'GHN', tracking_code: 'GHN1', tracking_link: 'https://x/GHN1', cod_amount: 630000, status: 'in_transit', shipped_at: '2026-11-08T03:00:00Z' }] };

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (path) => {
    if (path === '/carriers') return { data: [{ id: 'car_1', name: 'GHN' }] };
    if (path === '/shipments/summary') return { data: { in_transit: { n: 2, cod: 1000 }, unreconciled: { n: 1, cod: 500 }, returned: { n: 0, cod: 0 } } };
    if (path === '/shipments') return { data: [{ id: 's1', tracking_code: 'GHN1', carrier_name: 'GHN', order_id: 'o1', order_code: 'DH-1', cod_amount: 630000, status: 'in_transit', shipped_at: '2026-11-08T03:00:00Z' }] };
    if (path === '/carrier-statements') return { data: [] };
    if (path === '/stock-lots/summary') return { data: { expired: { lots: 1, qty: 5, value: 100 }, expiring: { lots: 1, qty: 3, value: 60 }, warn_days: 30 } };
    if (path === '/stock-lots') return { data: [{ id: 'lot1', product_name: 'A', variant_name: '', sku: 'A1', lot_no: 'L1', warehouse_name: 'Kho', qty: 5, expiry_date: '2026-10-01', days_left: -38, status: 'expired' }] };
    if (path === '/loyalty/promotions') return { data: [{ id: 'p1', name: 'Mua 2 tặng 1', kind: 'buy_x_get_y', code: null, uses: 3, usage_limit: null, discount_given: 600000, revenue: 2000000, active: true, stackable: false }], kinds: { buy_x_get_y: 'Mua X tặng Y' } };
    if (path === '/channel-prices') return { data: [{ shop_id: 'shp_1', channel_id: 'shopee', variant_id: 'v1', price: 230000 }] };
    return { data: [] };
  });
});

describe('trang mới không sập khi dựng', () => {
  it('Vận chuyển: thẻ tổng quan, danh sách vận đơn, nút nhập đối soát', async () => {
    render(<MemoryRouter><Shipping /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('GHN1')).toBeTruthy());
    expect(screen.getByText('Nhập bảng đối soát của hãng')).toBeTruthy();
    fireEvent.click(screen.getByText('Nhập bảng đối soát của hãng'));
    await waitFor(() => expect(screen.getByLabelText('Hãng đối soát')).toBeTruthy());
  });
  it('Huỷ phiếu đối soát: xem trước tác động, bắt ghi lý do rồi mới gửi; phiếu bị cản thì khoá nút', async () => {
    const stmt = { id: 'stm_1', code: 'DS-1', carrier_name: 'GHN', statement_date: '2026-11-08', line_count: 2, total_cod: 630000, total_fees: 51000, net_amount: 579000, voided_at: null };
    const preview = { can_void: true, voided: false, blockers: [], undo: { payments: 2, payments_amount: 655000, expenses: 1, expenses_amount: 41000, returns: 1, orders_reopened: 1, shipments: 2 } };
    api.get.mockImplementation(async (path) => {
      if (path === '/shipments/summary') return { data: { in_transit: { n: 0, cod: 0 }, unreconciled: { n: 0, cod: 0 }, returned: { n: 0, cod: 0 } } };
      if (path === '/carrier-statements') return { data: [stmt, { ...stmt, id: 'stm_0', code: 'DS-0', voided_at: '2026-11-08T05:00:00Z', void_reason: 'nhầm' }] };
      if (path === '/carrier-statements/stm_1/void-preview') return { data: preview };
      return { data: [] };
    });
    api.post.mockResolvedValue({ data: {} });
    render(<MemoryRouter><Shipping /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('DS-1')).toBeTruthy());
    expect(screen.getByText('Đã huỷ')).toBeTruthy();
    fireEvent.click(screen.getByText('Huỷ phiếu'));
    await waitFor(() => expect(screen.getByLabelText('Lý do huỷ phiếu đối soát')).toBeTruthy());
    const submit = screen.getByRole('button', { name: 'Huỷ phiếu đối soát' });
    expect(submit.disabled).toBe(true); // chưa có lý do
    fireEvent.change(screen.getByLabelText('Lý do huỷ phiếu đối soát'), { target: { value: 'Chọn nhầm cột' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/carrier-statements/stm_1/void', { reason: 'Chọn nhầm cột' }));
  });
  it('Huỷ phiếu đối soát: có điều đang cản thì hiện lý do và không cho gửi', async () => {
    const stmt = { id: 'stm_2', code: 'DS-2', carrier_name: 'GHN', statement_date: '2026-11-08', line_count: 1, total_cod: 1, total_fees: 0, net_amount: 1, voided_at: null };
    api.get.mockImplementation(async (path) => {
      if (path === '/shipments/summary') return { data: { in_transit: { n: 0, cod: 0 }, unreconciled: { n: 0, cod: 0 }, returned: { n: 0, cod: 0 } } };
      if (path === '/carrier-statements') return { data: [stmt] };
      if (path === '/carrier-statements/stm_2/void-preview') return { data: { can_void: false, voided: false, undo: {}, blockers: [{ code: 'HAS_RETURNS', order_code: 'DH-9', message: 'Đơn đã có phiếu trả hàng sau đối soát.' }] } };
      return { data: [] };
    });
    render(<MemoryRouter><Shipping /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('DS-2')).toBeTruthy());
    fireEvent.click(screen.getByText('Huỷ phiếu'));
    await waitFor(() => expect(screen.getByText(/Đơn đã có phiếu trả hàng sau đối soát/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Huỷ phiếu đối soát' }).disabled).toBe(true);
  });
  it('Lô & hạn dùng: hiện lô quá hạn', async () => {
    render(<MemoryRouter><StockLots /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('L1')).toBeTruthy());
    expect(screen.getByText('Hết hạn')).toBeTruthy();
    expect(screen.getByText('quá 38 ngày')).toBeTruthy();
  });
  it('Khuyến mãi: danh sách và form tạo', async () => {
    render(<MemoryRouter><Promotions /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Mua 2 tặng 1')).toBeTruthy());
    fireEvent.click(screen.getByText('+ Khuyến mãi'));
    await waitFor(() => expect(screen.getByLabelText('Tên khuyến mãi')).toBeTruthy());
  });
  it('Giao hàng, tách đơn, giữ hàng, vận đơn của đơn', async () => {
    const { unmount } = render(<ShipModal order={order} onClose={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Mã vận đơn')).toBeTruthy());
    unmount();
    render(<SplitModal order={order} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByLabelText('Số lượng tách CG')).toBeTruthy();
    render(<ReserveModal order={order} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByLabelText('Giữ hàng đến ngày')).toBeTruthy();
    render(<ShipmentsSection order={order} reload={() => {}} />);
    expect(screen.getByText('GHN1')).toBeTruthy();
  });
  it('Giá theo kênh dựng bảng theo shop × kênh', async () => {
    render(<ChannelPrices productId="p1" variants={[{ id: 'v1', sku: 'A1', default_price: 200000 }]} />);
    await waitFor(() => expect(screen.getByLabelText('Giá A1 Shopee')).toBeTruthy());
    await waitFor(() => expect(screen.getByLabelText('Giá A1 Shopee').value).toMatch(/230/));
  });
});
