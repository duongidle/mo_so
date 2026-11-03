import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
const session = vi.hoisted(() => ({ value: null }));
vi.mock('../session.jsx', () => ({ useSession: () => session.value }));
vi.mock('../components/ExportCustomers.jsx', () => ({ default: () => null }));
import { api } from '../api.js';
import Loyalty from '../pages/Loyalty.jsx';
import { CustomerDetail } from '../pages/Customers.jsx';

const ptShop = { id: 'pt', name: 'Phong thuỷ', code: 'PT' };
const nhShop = { id: 'nh', name: 'Nước hoa', code: 'NH' };

describe('Loyalty & Campaign', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.get.mockImplementation(async (path) => {
      if (path === '/loyalty/today') return { data: { reminders: [], birthdays: [] } };
      if (path === '/loyalty/templates') return { data: [] };
      if (path === '/loyalty/tiers') return { data: [{ id: 't1', name: 'Thành viên', min_spent: 0, discount_pct: 0 }] };
      return { data: [] };
    });
  });
  const renderAt = (s) => { session.value = s; return render(<MemoryRouter><Loyalty /></MemoryRouter>); };

  it('shop phong thuỷ có tab Gợi ý theo mệnh; shop khác không có', async () => {
    renderAt({ shop: ptShop, isAll: false, has: (f) => f === 'feng_shui' });
    expect(screen.getByRole('tab', { name: 'Gợi ý theo mệnh' })).toBeTruthy();
    for (const t of ['Hôm nay', 'Hạng khách', 'Mẫu tin nhắn', 'Tự động hoá']) expect(screen.getByRole('tab', { name: t })).toBeTruthy();
  });
  it('shop không theo phong thuỷ: không có tab mệnh', () => {
    renderAt({ shop: nhShop, isAll: false, has: () => false });
    expect(screen.queryByRole('tab', { name: 'Gợi ý theo mệnh' })).toBeNull();
  });
  it('tab mệnh gọi chiến dịch theo đúng shop và liệt kê khách kèm gợi ý', async () => {
    api.get.mockImplementation(async (path) => {
      if (path === '/loyalty/element-campaign') return { total: 1, data: [{ customer: { id: 'c1', name: 'Mộc Một', phone: '0911' }, element: 'Mộc', approximate: false, suggestions: [{ product_id: 'p1', name: 'Vòng thuỷ', price: 400000 }] }] };
      return { data: { reminders: [], birthdays: [] } };
    });
    renderAt({ shop: ptShop, isAll: false, has: () => true });
    fireEvent.click(screen.getByRole('tab', { name: 'Gợi ý theo mệnh' }));
    expect(await screen.findByText('Mộc Một')).toBeTruthy();
    expect(screen.getByText('Vòng thuỷ')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/loyalty/element-campaign', { shop_id: 'pt' });
  });
  it('tab tự động hoá nói thẳng là chưa có gì chạy', () => {
    renderAt({ shop: nhShop, isAll: false, has: () => false });
    fireEvent.click(screen.getByRole('tab', { name: 'Tự động hoá' }));
    expect(screen.getByText(/Chưa có gì chạy tự động/)).toBeTruthy();
  });
  it('xem tất cả shop: tab mệnh bảo chọn shop', () => {
    renderAt({ shop: null, isAll: true, has: () => false });
    fireEvent.click(screen.getByRole('tab', { name: 'Gợi ý theo mệnh' }));
    expect(screen.getByText(/Chọn một shop/)).toBeTruthy();
  });
});

describe('Hồ sơ khách: nhãn và xoá khỏi shop', () => {
  const detail = (extra = {}) => ({
    data: { id: 'c1', code: 'KH-00001', name: 'Anh Tài', phone: '0911', order_count: 2, total_spent: 500000, notes: [], by_shop: [{ shop_id: 'nh', shop_name: 'Nước hoa', order_count: 1, spent: 100 }, { shop_id: 'pt', shop_name: 'Phong thuỷ', order_count: 1, spent: 400 }],
      is_member: true, shop_profile: { shop_id: 'nh', fields: [], values: {}, tags: ['VIP'] }, ...extra },
  });
  beforeEach(() => {
    session.value = { shop: nhShop, isAll: false, has: () => false };
    for (const f of Object.values(api)) f.mockReset();
    api.get.mockImplementation(async (path) => {
      if (path === '/customers/c1') return detail();
      if (path === '/customers/tags') return { data: [{ tag: 'VIP', count: 2 }, { tag: 'Mua sỉ', count: 1 }] };
      if (path === '/orders') return { data: [] };
      if (path === '/loyalty/customers/c1') return { data: { tier: { name: 'Thành viên' }, spent_12m: 0, next_tier: null } };
      return { data: [] };
    });
    api.put.mockResolvedValue({ data: [] });
    api.del.mockResolvedValue({ data: { removed: true } });
  });
  const open = () => render(<MemoryRouter initialEntries={['/customers/c1']}><Routes><Route path="/customers/:id" element={<CustomerDetail />} /><Route path="/customers" element={<div>Danh sách khách</div>} /></Routes></MemoryRouter>);

  it('thêm nhãn gửi đúng shop và danh sách nhãn mới', async () => {
    open();
    const input = await screen.findByLabelText('Thêm nhãn');
    fireEvent.change(input, { target: { value: 'Quen' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/customers/c1/tags', { shop_id: 'nh', tags: ['VIP', 'Quen'] }));
  });
  it('gợi ý nhãn shop đang dùng, bấm là thêm', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Mua sỉ' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/customers/c1/tags', { shop_id: 'nh', tags: ['VIP', 'Mua sỉ'] }));
  });
  it('xoá khỏi shop: nói rõ mất gì, giữ gì; gọi DELETE kèm shop_id rồi về danh sách', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá khỏi Nước hoa' }));
    expect(screen.getByText(/Sẽ mất ở Nước hoa/)).toBeTruthy();
    expect(screen.getByText(/lịch sử đơn hàng/)).toBeTruthy();
    expect(api.del).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: 'Xoá khỏi Nước hoa' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/customers/c1?shop_id=nh'));
    expect(await screen.findByText('Danh sách khách')).toBeTruthy();
  });
  it('khách chưa thuộc shop đang chọn: không có nút xoá, có nút thêm vào shop', async () => {
    const base = api.get.getMockImplementation();
    api.get.mockImplementation(async (path, params) => (path === '/customers/c1' ? detail({ is_member: false, shop_profile: { shop_id: 'nh', fields: [], values: {}, tags: [] } }) : base(path, params)));
    api.post.mockResolvedValue({ data: {} });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào Nước hoa' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/customers/c1/shops', { shop_id: 'nh' }));
    expect(screen.queryByRole('button', { name: 'Xoá khỏi Nước hoa' })).toBeNull();
  });
});
