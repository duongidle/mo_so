import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('../session.jsx', () => ({ useSession: () => ({ shopId: 'all', isAll: true, shop: null, shops: [], methodLabels: {}, methodList: () => [['cash', 'Tiền mặt']], has: () => false }) }));
vi.mock('xlsx', () => ({ utils: {}, writeFile: () => {} }));
import { api } from '../api.js';
import Accounting, { GROUPS } from '../pages/Accounting.jsx';

const overview = (cash) => ({ data: { cash, receivable_customers: 0, receivable_marketplace: 0, payable_suppliers: 0, inventory: 0, month_net_revenue: 0, month_profit: 0, month_from: '2026-11-01', warnings: [], lock_date: null } });
const renderAt = (url) => render(<MemoryRouter initialEntries={[url]}><Accounting /></MemoryRouter>);

const serve = (cash) => api.get.mockImplementation(async (path) => (path === '/accounting/overview' ? overview(cash) : { data: [], next_cursor: null }));
beforeEach(() => { api.get.mockReset(); serve(1000); });

describe('Sổ kế toán: tab chia nhóm', () => {
  it('đủ 11 tab trong 3 nhóm, mỗi tab đúng một nhóm', () => {
    const all = GROUPS.flatMap(([, , t]) => t);
    expect(all).toHaveLength(11);
    expect(new Set(all).size).toBe(11);
  });
  it('?tab= mở đúng nhóm và tab; đổi nhóm nhảy tới tab đầu của nhóm', async () => {
    renderAt('/accounting?tab=journal');
    expect(await screen.findByRole('tab', { name: 'Sổ' })).toHaveProperty('ariaSelected', 'true');
    expect(screen.getByRole('tab', { name: 'Sổ nhật ký' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: 'Chứng từ' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Báo cáo' }));
    expect(screen.getByRole('tab', { name: 'Cân đối phát sinh' }).getAttribute('aria-selected')).toBe('true');
  });
  it('quỹ âm: màu đỏ, nhắc kiểm tra và dẫn tới Quỹ tiền', async () => {
    serve(-500000);
    renderAt('/accounting');
    expect(await screen.findByText(/Số dư quỹ âm: kiểm tra thu chi chưa ghi hoặc số dư đầu kỳ/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mở Quỹ tiền' }).getAttribute('href')).toBe('/expenses?tab=cash');
    expect(screen.getByText('− 500.000 ₫').className).toMatch(/h-red/);
  });
  it('form tài sản mở thành trang nhập liệu, không nằm trong popup', async () => {
    api.get.mockImplementation(async (path) => path === '/accounting/assets'
      ? { data: [] }
      : path === '/accounting/accounts' ? { data: [{ code: '6428', name: 'Chi phí quản lý khác' }] }
        : { data: [] });
    renderAt('/accounting?tab=assets');
    fireEvent.click(await screen.findByRole('button', { name: '+ Tài sản / chi phí trả trước' }));
    expect(await screen.findByRole('heading', { name: 'Thêm tài sản / chi phí trả trước' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeTruthy();
  });
});
