import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('../session.jsx', () => ({ useSession: () => ({ shopId: 'all', isAll: true, shop: null, has: () => false }) }));
vi.mock('xlsx', () => ({ utils: {}, writeFile: () => {} }));
import { api } from '../api.js';
import Reports from '../pages/Reports.jsx';

const cur = { gross_revenue: 1000, discount_amount: 0, returned_amount: 0, net_revenue: 1000, order_count: 2, aov: 500, cancel_rate_pct: 0, return_rate_pct: 0, shipping_fee: 0, platform_fee: 0, seller_shipping: 0, cogs: 400, gross_profit: 600, gross_margin_pct: 60, expenses_amount: 100, net_profit_estimate: 500 };
const aging = { total: 0, count: 0, buckets: [], items: [] };
const ROUTES = {
  '/reports/overview': () => ({ data: { current: cur, previous: cur, change_pct: {}, tax: null } }),
  '/reports/revenue': () => ({ data: [] }),
  '/reports/shops': () => ({ data: [] }),
  '/reports/channels': () => ({ data: [{ channel_id: 'direct', channel_name: 'Trực tiếp', order_count: 1, net_revenue: 1, platform_fee: 0, gross_profit: 1, gross_margin_pct: 1, cancel_rate_pct: 0 }] }),
  '/reports/expenses': () => ({ data: { total: 100, direct: 100, shared: 0, previous_total: 0, change_pct: null, net_revenue: 1000, expense_ratio_pct: 10, by_category: [{ category_id: 'c', name: 'Quảng cáo', amount: 100, direct: 100, shared: 0, share_pct: 100, previous_amount: 0, change_pct: null }], by_shop: [], largest: [] } }),
  '/reports/cashflow': () => ({ data: { cash_in: 1, cash_out: 1, cash_out_expenses: 0, net_cash: 0, customer_receivable: 0, marketplace_pending: 0, supplier_payable: 0, shared_expenses_not_included: 0 } }),
  '/reports/aging': () => ({ data: { customer: aging, marketplace: aging, supplier: aging } }),
  '/cash/accounts': () => ({ as_of: '2026-11-03', total_balance: 5, data: [{ id: 'a', name: 'Tiền mặt', balance: 5 }], unassigned: { has_activity: false, methods: [], net: 0 } }),
};

describe('Reports: đổi tab không được sập dù dữ liệu tab cũ còn đó lúc đang tải', () => {
  beforeEach(() => {
    api.get.mockReset();
    // Tab mới trả dữ liệu chậm hơn, để có lúc tab mới đã chọn mà dữ liệu vẫn là của tab cũ
    api.get.mockImplementation((path) => new Promise((resolve) => setTimeout(() => resolve(ROUTES[path]()), path === '/reports/channels' || path === '/cash/accounts' ? 60 : 5)));
  });

  it('Lợi nhuận → Kênh → Chi phí → Tiền & công nợ', async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>);
    await screen.findAllByText('Doanh thu thuần');
    for (const [tab, expected] of [['Lợi nhuận', /Lợi nhuận gộp/], ['Kênh', 'Trực tiếp'], ['Chi phí', 'Chi phí / doanh thu thuần'], ['Tiền & công nợ', /Số dư các quỹ/i]]) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      expect((await screen.findAllByText(expected, {}, { timeout: 2000 })).length).toBeGreaterThan(0);
    }
  });

  it('có nút xuất Excel và liên kết tới trang hướng dẫn', async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: /Xuất Excel/ }).disabled).toBe(false));
    expect(screen.getByRole('link', { name: 'Cách đọc các chỉ số' }).getAttribute('href')).toBe('/guide');
  });
});
