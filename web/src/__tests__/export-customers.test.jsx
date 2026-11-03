import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
vi.mock('../session.jsx', () => ({ useSession: () => ({ shops: [{ id: 'nh', code: 'NH', name: 'Nước hoa ô tô' }] }) }));
const xlsx = vi.hoisted(() => ({ written: null, aoa: null }));
vi.mock('xlsx', () => ({
  utils: { aoa_to_sheet: (a) => { xlsx.aoa = a; return {}; }, book_new: () => ({ sheets: [] }), book_append_sheet: (wb, ws, name) => wb.sheets.push(name) },
  writeFile: (wb, name) => { xlsx.written = { wb, name }; },
}));
import { api } from '../api.js';
import ExportCustomers from '../components/ExportCustomers.jsx';

const data = { headers: ['Mã khách', 'Họ tên', 'Nhãn', 'Dòng xe'], rows: [['KH-00001', 'Anh Tài', 'VIP', 'Camry']], count: 1 };

describe('ExportCustomers', () => {
  beforeEach(() => { xlsx.written = null; xlsx.aoa = null; api.get.mockReset(); api.get.mockResolvedValue({ data }); });

  it('mô tả bộ lọc, liệt kê cột và báo trước số khách', async () => {
    render(<ExportCustomers filters={{ shop_id: 'nh', tag: 'VIP', q: 'tài' }} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: /Xuất 1 khách/ })).toBeTruthy();
    for (const t of ['Shop: Nước hoa ô tô', 'Nhãn: VIP', 'Tìm: “tài”']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText(/Mã khách · Họ tên · Nhãn · Dòng xe/)).toBeTruthy();
    expect(screen.getByText(/Dữ liệu riêng của shop khác không có trong file/)).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/customers/export', { shop_id: 'nh', tag: 'VIP', q: 'tài', format: 'json' });
  });

  it('Excel: dựng sheet từ dữ liệu server, tên file có mã shop', async () => {
    const onClose = vi.fn();
    render(<ExportCustomers filters={{ shop_id: 'nh' }} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: /Xuất 1 khách/ }));
    expect(xlsx.aoa).toEqual([data.headers, ...data.rows]);
    expect(xlsx.written.wb.sheets).toEqual(['Khách hàng']);
    expect(xlsx.written.name).toMatch(/^khach-hang-nh-\d{8}\.xlsx$/);
    expect(onClose).toHaveBeenCalled();
  });

  it('không chọn shop: báo file chỉ có thông tin chung; không có khách thì khoá nút xuất', async () => {
    api.get.mockResolvedValue({ data: { headers: ['Mã khách'], rows: [], count: 0 } });
    render(<ExportCustomers filters={{}} onClose={() => {}} />);
    expect(await screen.findByText(/Không có khách nào khớp bộ lọc/)).toBeTruthy();
    expect(screen.getByText(/chỉ có thông tin chung và số liệu tổng/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Xuất 0 khách/ }).disabled).toBe(true);
  });
});
