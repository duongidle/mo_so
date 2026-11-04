import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
vi.mock('../session.jsx', () => ({
  useSession: () => ({ shops: [{ id: 'nh', name: 'Nước hoa ô tô' }], allChannels: [{ id: 'shopee', name: 'Shopee' }] }),
}));
const xlsx = vi.hoisted(() => ({ written: null, aoa: null }));
vi.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: (a) => { xlsx.aoa = a; return {}; },
    book_new: () => ({ sheets: [] }),
    book_append_sheet: (wb, ws, name) => wb.sheets.push(name),
  },
  writeFile: (wb, name) => { xlsx.written = { wb, name }; },
}));
import { api } from '../api.js';
import ExportOrders from '../components/ExportOrders.jsx';
import { exportQuery } from '../lib.js';

describe('exportQuery', () => {
  it('dùng cùng tên tham số với danh sách đơn và bỏ giá trị rỗng', () => {
    const q = new URLSearchParams(exportQuery({ shop_id: 'nh', status: 'completed,cancelled', channel: '', q: undefined, from: '2026-11-01' }, { layout: 'lines', format: 'json' }));
    expect(Object.fromEntries(q)).toEqual({ shop_id: 'nh', status: 'completed,cancelled', from: '2026-11-01', layout: 'lines', format: 'json' });
  });
  it('mặc định mỗi đơn một dòng, CSV', () => {
    expect(Object.fromEntries(new URLSearchParams(exportQuery({})))).toEqual({ layout: 'orders', format: 'csv' });
  });
});

describe('ExportOrders', () => {
  const filters = { shop_id: 'nh', status: 'completed', channel: 'shopee', from: '2026-11-01', to: '2026-11-03', q: 'Lan' };
  beforeEach(() => {
    xlsx.written = null; xlsx.aoa = null;
    api.get.mockImplementation(async (path, params) => {
      if (params.format === 'count') return { data: { orders: 12, lines: 30, max_rows: 50000 } };
      if (params.format === 'json') return { data: { headers: ['Mã đơn', 'Tiền hàng'], rows: [['DH-1', 300000], ['DH-2', 150000]], count: 2, orders: 2 } };
      throw new Error('không mong đợi ' + JSON.stringify(params));
    });
  });

  it('mô tả đúng bộ lọc đang áp dụng và báo trước số đơn, số dòng', async () => {
    render(<ExportOrders filters={filters} onClose={() => {}} />);
    expect(await screen.findByText(/Khớp 12 đơn, 30 dòng hàng/)).toBeTruthy();
    for (const t of ['Shop: Nước hoa ô tô', 'Trạng thái: Hoàn thành', 'Kênh: Shopee', 'Ngày: 01/11/2026 → 03/11/2026', 'Tìm: “Lan”']) expect(screen.getByText(t)).toBeTruthy();
    // đếm theo đúng bộ lọc
    expect(api.get).toHaveBeenCalledWith('/orders/export', { ...filters, format: 'count' });
  });

  it('đổi kiểu file thì số dòng sẽ xuất đổi theo (đơn → dòng hàng)', async () => {
    render(<ExportOrders filters={filters} onClose={() => {}} />);
    await screen.findByRole('button', { name: /Xuất 12 dòng/ });
    fireEvent.click(screen.getByLabelText(/Mỗi sản phẩm một dòng/));
    expect(screen.getByRole('button', { name: /Xuất 30 dòng/ })).toBeTruthy();
  });

  it('Excel: dựng sheet từ dữ liệu server, tên file theo kiểu và khoảng ngày', async () => {
    const onClose = vi.fn();
    render(<ExportOrders filters={filters} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: /Xuất 12 dòng/ }));
    await waitFor(() => expect(xlsx.written).not.toBeNull());
    expect(api.get).toHaveBeenCalledWith('/orders/export', { ...filters, layout: 'orders', format: 'json' });
    expect(xlsx.aoa).toEqual([['Mã đơn', 'Tiền hàng'], ['DH-1', 300000], ['DH-2', 150000]]);
    expect(typeof xlsx.aoa[1][1]).toBe('number'); // số giữ là số để Excel cộng được
    expect(xlsx.written.name).toBe('don-hang-20261101-20261103.xlsx');
    expect(xlsx.written.wb.sheets).toEqual(['Đơn hàng']);
    expect(onClose).toHaveBeenCalled();
  });

  it('Excel kiểu chi tiết: tên file và sheet riêng', async () => {
    render(<ExportOrders filters={{}} onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText(/Mỗi sản phẩm một dòng/));
    fireEvent.click(screen.getByRole('button', { name: /Xuất 30 dòng/ }));
    await waitFor(() => expect(xlsx.written).not.toBeNull());
    expect(xlsx.written.name).toBe('don-hang-chi-tiet-tat-ca.xlsx');
    expect(xlsx.written.wb.sheets).toEqual(['Chi tiết hàng']);
  });

  it('CSV: tải thẳng từ server theo đúng tham số, không dựng ở trình duyệt', async () => {
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicked.push({ href: this.getAttribute('href'), download: this.download }); });
    render(<ExportOrders filters={filters} onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText(/CSV/));
    fireEvent.click(screen.getByRole('button', { name: /Xuất 12 dòng/ }));
    await waitFor(() => expect(clicked).toHaveLength(1));
    const url = new URL(clicked[0].href, 'http://x');
    expect(url.pathname).toBe('/api/v1/orders/export');
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...filters, layout: 'orders', format: 'csv' });
    expect(clicked[0].download).toBe('don-hang-20261101-20261103.csv');
    expect(xlsx.written).toBeNull();
  });

  it('không có đơn khớp: báo và khoá nút; quá giới hạn: báo thu hẹp bộ lọc', async () => {
    api.get.mockImplementation(async () => ({ data: { orders: 0, lines: 0, max_rows: 50000 } }));
    const { unmount } = render(<ExportOrders filters={{}} onClose={() => {}} />);
    expect(await screen.findByText(/Không có đơn nào khớp/)).toBeTruthy();
    unmount();
    api.get.mockImplementation(async () => ({ data: { orders: 60000, lines: 90000, max_rows: 50000 } }));
    render(<ExportOrders filters={{}} onClose={() => {}} />);
    expect(await screen.findByText(/Quá 50\.000 dòng/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Xuất/ }).disabled).toBe(true);
  });
});
