import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('../session.jsx', () => ({ useSession: () => ({ shopId: 'all', isAll: true, shop: null, shops: [{ id: 's1', name: 'Shop A' }], marketplaces: [], methodLabels: {}, methodList: () => [['cash', 'Tiền mặt']], has: () => false }) }));
import { api } from '../api.js';
import Expenses from '../pages/Expenses.jsx';

const kinds = { supplier: 'Nhà cung cấp', purchase_ship: 'Ship nhập (hãng vận chuyển)', order_ship: 'Ship đơn (hãng vận chuyển)', refund: 'Hoàn tiền khách', recurring: 'Chi phí định kỳ sắp tới' };
const payables = {
  total: 1500000, overdue: { count: 1, amount: 1000000 }, due_soon: { count: 0, amount: 0 }, lookahead: 7, kinds,
  data: [
    { kind: 'supplier', ref_id: 'p1', code: 'PN-1', party: 'Xưởng A', shop_id: 's1', due_date: '2026-11-01', bucket: 'overdue', days_overdue: 7, amount: 1000000, total: 1500000, link: '/purchases/p1' },
    { kind: 'refund', ref_id: 'o1', code: 'DH-9', party: 'Chị Lan', shop_id: 's1', due_date: null, bucket: 'no_due', days_overdue: null, amount: 500000, total: 500000, link: '/orders/o1' },
  ],
};
beforeEach(() => { api.get.mockReset(); api.get.mockImplementation(async (path) => (path === '/payables' ? payables : { data: [] })); });
const renderAt = (url) => render(<MemoryRouter initialEntries={[url]}><Expenses /></MemoryRouter>);

describe('Chi phí & quỹ: công nợ phải trả và chi phí định kỳ', () => {
  it('có tab Công nợ phải trả và Chi phí định kỳ', async () => {
    renderAt('/expenses');
    expect(await screen.findByRole('tab', { name: 'Công nợ phải trả' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Chi phí định kỳ' })).toBeTruthy();
  });
  it('công nợ: tổng, quá hạn, từng khoản dẫn tới chứng từ, lọc theo loại', async () => {
    renderAt('/expenses?tab=payables');
    expect(await screen.findByText('1.500.000 ₫')).toBeTruthy();
    expect(screen.getByText('Quá hạn 7 ngày')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'PN-1' }).getAttribute('href')).toBe('/purchases/p1');
    expect(screen.getByRole('link', { name: 'Trả tiền' }).getAttribute('href')).toBe('/purchases/p1');
    fireEvent.click(screen.getByRole('tab', { name: 'Hoàn tiền khách' }));
    expect(screen.queryByText('PN-1')).toBeNull();
    expect(screen.getByText('DH-9')).toBeTruthy();
  });
  it('form chi phí định kỳ mở thành trang nhập liệu, không nằm trong popup', async () => {
    api.get.mockImplementation(async (path) => (path === '/expense-categories' ? { data: [{ id: 'ecat_rent', name: 'Thuê' }] } : { data: [] }));
    renderAt('/expenses?tab=recurring');
    fireEvent.click(await screen.findByRole('button', { name: '+ Chi phí định kỳ' }));
    expect(await screen.findByText('Thiết lập khoản chi và lịch tạo tự động.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
