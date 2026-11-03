import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
import { api } from '../api.js';
import ProfileEditor, { guessStatus } from '../components/ProfileEditor.jsx';

const channels = [{ id: 'shopee', name: 'Shopee' }, { id: 'facebook', name: 'Facebook' }];
const profile = {
  id: 'imp_x', name: 'Shopee', channel_id: 'shopee',
  column_map: { external_id: 'Mã đơn hàng', sku: 'SKU', platform_fee: ['Phí A', 'Phí B'], status: 'Trạng thái' },
  status_map: { 'Hoàn thành': 'completed' }, options: { note: 'ghi chú cũ' },
};

describe('guessStatus', () => {
  it.each([
    ['Đã hủy', 'cancelled'], ['Đã huỷ', 'cancelled'], ['Hoàn thành', 'completed'], ['Đã giao', 'completed'],
    ['Đang giao', 'shipping'], ['Trả hàng/Hoàn tiền', 'returned'], ['Chờ xác nhận', 'confirmed'],
  ])('%s → %s', (text, st) => expect(guessStatus(text)).toBe(st));
});

describe('ProfileEditor', () => {
  beforeEach(() => api.put.mockResolvedValue({ data: { id: 'imp_x' } }));

  it('lưu giữ đúng cấu trúc: một cột là chuỗi, nhiều cột là mảng; cột bỏ trống không gửi', async () => {
    const onSaved = vi.fn();
    render(<ProfileEditor profile={profile} channels={channels} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu mẫu' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe('/imports/profiles/imp_x');
    expect(body.column_map).toEqual({ external_id: 'Mã đơn hàng', sku: 'SKU', platform_fee: ['Phí A', 'Phí B'], status: 'Trạng thái' });
    expect(body.status_map).toEqual({ 'Hoàn thành': 'completed' });
    expect(body.options).toEqual({ note: 'ghi chú cũ' });
    expect(onSaved).toHaveBeenCalled();
  });

  it('mẫu mới thiếu cột bắt buộc (mã đơn, SKU) thì không lưu được', () => {
    render(<ProfileEditor profile={null} channels={channels} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText('Tên mẫu') || screen.getAllByRole('textbox')[0], { target: { value: 'Mẫu Facebook' } });
    expect(screen.getByRole('button', { name: 'Lưu mẫu' }).disabled).toBe(true);
    expect(screen.getByText(/Cần chọn cột cho/)).toBeTruthy();
  });

  it('gợi ý từ file: lấy các giá trị trạng thái và đoán sẵn trạng thái của app', async () => {
    const rows = [{ 'Trạng thái': 'Đã hủy' }, { 'Trạng thái': 'Hoàn thành' }, { 'Trạng thái': 'Đang giao' }, { 'Trạng thái': 'Đã hủy' }];
    render(<ProfileEditor profile={profile} channels={channels} columns={['Mã đơn hàng', 'SKU', 'Phí A', 'Phí B', 'Trạng thái']} rows={rows} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Lấy 3 giá trị trạng thái từ file/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu mẫu' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1].status_map).toEqual({ 'Hoàn thành': 'completed', 'Đã hủy': 'cancelled', 'Đang giao': 'shipping' });
  });

  it('cột mẫu mong đợi mà file không có thì cảnh báo', () => {
    render(<ProfileEditor profile={profile} channels={channels} columns={['Mã đơn hàng', 'SKU']} rows={[]} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getAllByTitle('Không thấy cột này trong file đang mở').length).toBe(3); // Phí A, Phí B, Trạng thái
  });

  it('bỏ một cột đã chọn', async () => {
    render(<ProfileEditor profile={profile} channels={channels} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ cột Phí B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu mẫu' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1].column_map.platform_fee).toBe('Phí A');
  });
});
