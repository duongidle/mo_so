import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

vi.mock('../api.js', () => ({
  api: { get: vi.fn(async (p) => (p === '/auth/status' ? { has_accounts: true, registration_open: true } : { data: { id: 'u', displayName: 'Dương' } })), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));
vi.mock('../session.jsx', () => ({
  SessionProvider: ({ children }) => children,
  useSession: () => ({ shops: [{ id: 's1', name: 'NH', code: 'NH' }], shopId: 's1', shop: { id: 's1' }, user: { displayName: 'Dương' }, has: () => false, onLogout: () => {} }),
}));
const { stub } = vi.hoisted(() => ({ stub: (name) => ({ default: () => name }) }));
vi.mock('../pages/Auth.jsx', () => stub('Auth'));
vi.mock('../pages/Dashboard.jsx', () => stub('Dashboard'));
vi.mock('../pages/OrderForm.jsx', () => stub('TRANG TẠO ĐƠN'));
vi.mock('../pages/Orders.jsx', () => ({ OrderList: () => <div>Orders</div>, OrderDetail: () => <div>OrderDetail</div> }));
vi.mock('../pages/Products.jsx', () => stub('Products'));
vi.mock('../pages/products/ProductPage.jsx', () => stub('ProductPage'));
vi.mock('../pages/Stock.jsx', () => stub('Stock'));
vi.mock('../pages/Purchases.jsx', () => ({ default: () => <div>Purchases</div>, NewPurchasePage: () => <div>NewPurchase</div>, PurchasePage: () => <div>PurchasePage</div>, EditPurchasePage: () => <div>EditPurchase</div> }));
vi.mock('../pages/Customers.jsx', () => ({ CustomerList: () => <div>CL</div>, CustomerDetail: () => <div>CD</div> }));
vi.mock('../pages/Loyalty.jsx', () => stub('Loyalty'));
vi.mock('../pages/Expenses.jsx', () => stub('Expenses'));
vi.mock('../pages/Reports.jsx', () => stub('Reports'));
vi.mock('../pages/Accounting.jsx', () => stub('Accounting'));
vi.mock('../pages/Guide.jsx', () => stub('Guide'));
vi.mock('../pages/Settings.jsx', () => stub('Settings'));
vi.mock('../pages/Onboarding.jsx', () => ({ default: () => <div>Onboarding</div>, GettingStarted: () => null, useSetupProgress: () => ({}), readDismissed: () => true, DISMISS_KEY: 'k' }));
import App from '../App.jsx';

describe('điều hướng tạo đơn', () => {
  const open = (path) => render(<RouterProvider router={createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: [path] })} />);

  it('/pos chuyển sang /orders/new', async () => {
    open('/pos');
    expect(await screen.findByText('TRANG TẠO ĐƠN')).toBeTruthy();
  });

  it('không còn mục "Bán nhanh" trong thanh bên; nút trên cùng trỏ /orders/new', async () => {
    open('/orders');
    await screen.findByText('Orders');
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(nav.querySelector('a[href="/pos"]')).toBeNull();
    const cta = screen.getAllByText('Bán nhanh').find((el) => el.closest('a'));
    expect(cta.closest('a').getAttribute('href')).toBe('/orders/new');
  });

  it('ẩn nút Bán nhanh khi đang ở trang tạo đơn', async () => {
    open('/orders/new');
    await screen.findByText('TRANG TẠO ĐƠN');
    expect(screen.queryByText('Bán nhanh')).toBeNull();
  });
});
