import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
import { api } from '../api.js';
import CustomFieldsPanel from '../components/CustomFieldsPanel.jsx';

const FIELDS = [
  { id: 'f1', key: 'phi_dong_goi', label: 'Phí đóng gói', type: 'money' },
  { id: 'f2', key: 'loai', label: 'Loại gói', type: 'select', options: ['Thường', 'Quà'] },
  { id: 'f3', key: 'ln', label: 'LN sau đóng gói', type: 'formula', formula: '{total_amount} - {custom.phi_dong_goi}' },
];
let values;
let reasons = {};
const setup = (fields = FIELDS) => {
  api.get.mockImplementation(async (path) => (path === '/custom/fields' ? { data: fields } : { data: { values, reasons } }));
  return render(<MemoryRouter><CustomFieldsPanel entity="order" id="ord_1" shopId="shp_1" /></MemoryRouter>);
};

describe('CustomFieldsPanel', () => {
  beforeEach(() => { values = { phi_dong_goi: 12000, ln: 288000 }; reasons = {}; api.put.mockResolvedValue({ data: {} }); });

  it('hiện giá trị theo kiểu, công thức ghi rõ là tự tính; gọi API với đúng shop', async () => {
    setup();
    expect(await screen.findByText('12.000 ₫')).toBeTruthy();
    expect(screen.getByText('288.000')).toBeTruthy(); // công thức hiện số có dấu phân cách nghìn
    expect(screen.getByText(/LN sau đóng gói/).textContent).toContain('tự tính');
    expect(api.get).toHaveBeenCalledWith('/custom/fields', { entity_type: 'order', shop_id: 'shp_1' });
    expect(api.get).toHaveBeenCalledWith('/custom/values/order/ord_1', { meta: 1 });
  });

  it('công thức trống thì nói rõ vì sao; mặc định chỉ điền sẵn trên form, không tự ghi', async () => {
    values = { ln: null };
    reasons = { ln: 'Đơn chưa có Phí đóng gói' };
    setup([{ ...FIELDS[0], default_value: 5000 }, FIELDS[1], FIELDS[2]]);
    expect(await screen.findByText(/Đơn chưa có Phí đóng gói/)).toBeTruthy();
    expect(api.put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    expect(screen.getByRole('spinbutton').value).toBe('5000'); // điền sẵn trên form
    expect(api.put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/custom/values/order/ord_1', { phi_dong_goi: 5000 }));
  });

  it('sửa: chỉ gửi những trường đã đổi, không gửi trường công thức', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    expect(screen.queryByText('LN sau đóng gói')).toBeNull(); // công thức không nhập tay
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '15000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/custom/values/order/ord_1', { phi_dong_goi: 15000 });
  });

  it('không đổi gì thì không gọi API khi lưu', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull());
    expect(api.put).not.toHaveBeenCalled();
  });

  it('không có trường nào: ẩn hẳn khi hideWhenEmpty, hoặc chỉ đường tới Cài đặt', async () => {
    const { container, unmount } = setup([]);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
    unmount();
    api.get.mockImplementation(async (path) => (path === '/custom/fields' ? { data: [] } : { data: {} }));
    render(<MemoryRouter><CustomFieldsPanel entity="order" id="o" hideWhenEmpty={false} /></MemoryRouter>);
    expect(await screen.findByText(/Chưa có trường nào/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Cài đặt/ })).toBeTruthy();
  });
});
