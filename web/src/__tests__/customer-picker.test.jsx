import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
vi.mock('../session.jsx', () => ({ useSession: () => ({ theme: 'general' }) }));
import { api } from '../api.js';
import CustomerPicker from '../components/CustomerPicker.jsx';

const LAN = { id: 'cus_1', name: 'Chị Lan', phone: '0922000222', code: 'KH-00001', order_count: 3, total_spent: 500000, last_order_at: '2026-10-01T03:00:00.000Z', address: '12 Lê Lợi' };
const NAM = { id: 'cus_2', name: 'Anh Nam', phone: '0933111222', code: 'KH-00002', order_count: 0, total_spent: 0, last_order_at: null };

function mockApi() {
  api.get.mockImplementation(async (path, params = {}) => {
    if (path === '/customers') return { data: params.shop_id ? [LAN] : [LAN, NAM] };
    if (path.startsWith('/loyalty/customers/')) return { data: { tier: { name: 'Bạc', discount_pct: 5 } } };
    if (path === '/customers/lookup') return { data: params.phone === '0922000222' ? LAN : null };
    return { data: [] };
  });
}
const typeInto = (v) => fireEvent.change(screen.getByLabelText('Tìm khách hàng'), { target: { value: v } });

describe('CustomerPicker', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi(); });

  it('tìm theo shop, rồi liệt kê khách ở shop khác riêng; chọn thì trả về khách có id', async () => {
    const onChange = vi.fn();
    render(<CustomerPicker shopId="shp_1" value={null} onChange={onChange} />);
    fireEvent.focus(screen.getByLabelText('Tìm khách hàng'));
    typeInto('la');
    await screen.findByText('Chị Lan');
    await screen.findByText('Khách ở shop khác');
    expect(screen.getByText('Anh Nam')).toBeTruthy();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/customers', { q: 'la', limit: 8, shop_id: 'shp_1' }));
    expect(api.get).toHaveBeenCalledWith('/customers', { q: 'la', limit: 8 });
    await screen.findAllByText('Bạc'); // hạng hiện ở các dòng kết quả
    fireEvent.mouseDown(screen.getByText('Chị Lan'));
    expect(onChange).toHaveBeenCalledWith(LAN);
    expect(onChange.mock.calls[0][0].id).toBe('cus_1');
  });

  it('khi mở danh sách ở shop, khách đã tạo từ màn Tất cả shop vẫn hiện để chọn', async () => {
    const onChange = vi.fn();
    render(<CustomerPicker shopId="shp_1" value={null} onChange={onChange} />);
    fireEvent.focus(screen.getByLabelText('Tìm khách hàng'));
    expect(await screen.findByText('Khách ở shop khác')).toBeTruthy();
    fireEvent.mouseDown(screen.getByText('Anh Nam'));
    expect(onChange).toHaveBeenCalledWith(NAM);
  });

  it('điều hướng bằng bàn phím: mũi tên xuống rồi Enter chọn dòng thứ hai', async () => {
    const onChange = vi.fn();
    render(<CustomerPicker shopId="shp_1" value={null} onChange={onChange} />);
    const input = screen.getByLabelText('Tìm khách hàng');
    fireEvent.focus(input);
    typeInto('a');
    await screen.findByText('Anh Nam');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(NAM);
  });

  it('đã chọn thì hiện thẻ khách với hạng, gợi ý giảm giá, nút Đổi bỏ chọn', async () => {
    const onChange = vi.fn();
    const onApply = vi.fn();
    render(<CustomerPicker shopId="shp_1" value={LAN} onChange={onChange} subtotal={200000} onApplyDiscount={onApply} />);
    expect(screen.getByText('12 Lê Lợi')).toBeTruthy();
    await screen.findAllByText('Bạc');
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(onApply).toHaveBeenCalledWith(10000);
    fireEvent.click(screen.getByRole('button', { name: 'Đổi' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('khách mới: tạo qua POST /customers kèm shop rồi chọn khách vừa tạo', async () => {
    const created = { id: 'cus_9', name: 'Cô Hoa', phone: '0988777666', code: 'KH-00009' };
    api.post.mockResolvedValue({ data: created });
    const onChange = vi.fn();
    render(<CustomerPicker shopId="shp_1" value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Khách mới' }));
    fireEvent.change(screen.getByLabelText('Tên khách'), { target: { value: 'Cô Hoa' } });
    fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0988777666' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo khách và chọn' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(created));
    expect(api.post).toHaveBeenCalledWith('/customers', expect.objectContaining({ name: 'Cô Hoa', phone: '0988777666', shop_id: 'shp_1' }));
  });

  it('SĐT trùng khách có sẵn: gợi ý chọn khách đó và chặn tạo trùng', async () => {
    const onChange = vi.fn();
    render(<CustomerPicker shopId="shp_1" value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Khách mới' }));
    fireEvent.change(screen.getByLabelText('Tên khách'), { target: { value: 'Lan khác' } });
    fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0922000222' } });
    const pick = await screen.findByRole('button', { name: 'Chọn khách này' });
    expect(screen.getByRole('button', { name: 'Tạo khách và chọn' }).disabled).toBe(true);
    fireEvent.click(pick);
    expect(onChange).toHaveBeenCalledWith(LAN);
    expect(api.post).not.toHaveBeenCalled();
  });
});
