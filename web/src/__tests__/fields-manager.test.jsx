import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
import { api } from '../api.js';
import FieldsManager, { OptionsEditor } from '../components/FieldsManager.jsx';

const SHOP = { id: 'shp_1', name: 'Shop Nước hoa' };
const FIELDS = [
  { id: 'f1', entity_type: 'customer', key: 'dip', label: 'Dịp mua', type: 'select', options: ['A', 'B'], sort_order: 0, show_in_list: false, required: false },
  { id: 'f2', entity_type: 'customer', key: 'ns', label: 'Ngày sinh', type: 'date', role: 'birth_date', sort_order: 1, show_in_list: true, required: false },
];

beforeEach(() => {
  api.get.mockImplementation(async (p) => (p === '/custom/fields' ? { data: FIELDS } : { data: [] }));
  api.patch.mockResolvedValue({ data: {} });
  api.post.mockResolvedValue({ data: {} });
});

describe('FieldsManager', () => {
  it('khách hàng bắt buộc có shop: Tất cả shop thì chỉ nhắc, không gọi API trường', async () => {
    render(<FieldsManager entities={['order', 'product', 'purchase', 'customer']} shop={null} initialEntity="customer" />);
    expect(screen.getByText(/Chọn một shop/)).toBeTruthy();
    expect(api.get).not.toHaveBeenCalledWith('/custom/fields', expect.anything());
    fireEvent.click(screen.getByRole('tab', { name: 'Đơn hàng' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/custom/fields', { entity_type: 'order', shop_id: undefined, archived: undefined }));
  });

  it('khách có shop: lấy trường của shop đó; sửa nhãn, lựa chọn, bắt buộc, vai trò gửi đúng PATCH', async () => {
    render(<FieldsManager entities={['customer']} shop={SHOP} />);
    expect(await screen.findByText('Dịp mua')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/custom/fields', { entity_type: 'customer', shop_id: 'shp_1', archived: undefined });
    fireEvent.click(screen.getAllByRole('button', { name: 'Sửa' })[0]);
    const label = screen.getByLabelText('Nhãn hiển thị');
    fireEvent.change(label, { target: { value: 'Dịp mua hàng' } });
    const add = screen.getByLabelText('Thêm lựa chọn');
    fireEvent.change(add, { target: { value: 'C' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    fireEvent.click(screen.getByLabelText('Bỏ A'));
    fireEvent.click(screen.getByLabelText(/Bắt buộc nhập/));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledWith('/custom/fields/f1', expect.objectContaining({ label: 'Dịp mua hàng', options: ['B', 'C'], required: true, role: null, show_in_list: false }));
  });

  it('thêm trường công thức cho khách: gửi shop_id của shop, khoá lấy từ nhãn', async () => {
    render(<FieldsManager entities={['customer']} shop={SHOP} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Thêm trường' }));
    fireEvent.change(screen.getByLabelText('Nhãn hiển thị'), { target: { value: 'Số đơn tại shop' } });
    fireEvent.change(screen.getByLabelText('Kiểu'), { target: { value: 'formula' } });
    const ta = await screen.findByLabelText('Công thức');
    fireEvent.change(ta, { target: { value: '{shop_order_count}', selectionStart: 18, selectionEnd: 18 } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/custom/fields', expect.objectContaining({ entity_type: 'customer', shop_id: 'shp_1', key: 'so_don_tai_shop', type: 'formula', formula: '{shop_order_count}' })));
  });

  it('ẩn, hiện lại và đổi thứ tự', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<FieldsManager entities={['customer']} shop={SHOP} />);
    await screen.findByText('Dịp mua');
    fireEvent.click(screen.getByRole('button', { name: 'Đưa Dịp mua xuống' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/custom/fields/f1', { sort_order: 1 }));
    expect(api.patch).toHaveBeenCalledWith('/custom/fields/f2', { sort_order: 0 });
    fireEvent.click(screen.getAllByRole('button', { name: 'Ẩn' })[0]);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/custom/fields/f1', { archived: true }));
    fireEvent.click(screen.getByLabelText('Xem trường đã ẩn'));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/custom/fields', { entity_type: 'customer', shop_id: 'shp_1', archived: 1 }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Hiện lại' }))[0]);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/custom/fields/f1', { archived: false }));
  });
});

describe('FieldsManager: xoá trường', () => {
  it('trường có dữ liệu: hộp xác nhận nói số bản ghi và gợi ý Ẩn; xác nhận mới gọi DELETE kèm confirm', async () => {
    api.get.mockImplementation(async (p) => (p === '/custom/fields' ? { data: FIELDS } : p === '/custom/fields/f1/usage' ? { data: { id: 'f1', label: 'Dịp mua', values_count: 7, referenced_by: [] } } : { data: [] }));
    api.del.mockResolvedValue({ data: { deleted: true } });
    render(<FieldsManager entities={['customer']} shop={SHOP} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá Dịp mua' }));
    expect(await screen.findByText(/7/)).toBeTruthy();
    expect(screen.getByText(/bấm “Ẩn”/)).toBeTruthy();
    expect(api.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá hẳn' }));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/custom/fields/f1', { confirm: true }));
  });

  it('trường đang được công thức khác dùng: nút Xoá tắt kèm lý do', async () => {
    const list = [FIELDS[0], { id: 'f3', entity_type: 'customer', key: 'ct', label: 'Gộp', type: 'formula', formula: 'CONCAT({custom.dip}, "!")', sort_order: 2, show_in_list: false, required: false }];
    api.get.mockImplementation(async (p) => (p === '/custom/fields' ? { data: list } : { data: [] }));
    render(<FieldsManager entities={['customer']} shop={SHOP} />);
    const btn = await screen.findByRole('button', { name: 'Xoá Dịp mua' });
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Gộp');
    expect(screen.getByRole('button', { name: 'Xoá Gộp' }).disabled).toBe(false);
  });
});

describe('OptionsEditor', () => {
  it('dấu phẩy thêm nhiều lựa chọn, bỏ trùng', () => {
    const onChange = vi.fn();
    render(<OptionsEditor value={['A']} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Thêm lựa chọn'), { target: { value: 'B, A,' } });
    expect(onChange).toHaveBeenCalledWith(['A', 'B']);
  });
});
