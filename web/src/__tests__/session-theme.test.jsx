import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
import { api } from '../api.js';
import { SessionProvider, useSession } from '../session.jsx';

const INDUSTRIES = [
  { id: 'general', name: 'Bán lẻ chung', theme: 'general', features: [] },
  { id: 'phong_thuy', name: 'Phong thuỷ', theme: 'phongthuy', features: ['feng_shui'] },
  { id: 'nuoc_hoa', name: 'Nước hoa', theme: 'nuochoa', features: [] },
];
const SHOPS = [
  { id: 'nh', name: 'Nước hoa ô tô', industry: 'nuoc_hoa' },
  { id: 'pt1', name: 'Phong thuỷ A', industry: 'phong_thuy' },
  { id: 'pt2', name: 'Phong thuỷ B', industry: 'phong_thuy' },
  { id: 'gen', name: 'Tạp hoá', industry: 'general' },
];

function Probe() {
  const s = useSession();
  return (
    <div>
      <span data-testid="shop">{s.isAll ? 'ALL' : s.shop?.name}</span>
      <span data-testid="theme">{s.theme}</span>
      <span data-testid="menh">{String(s.has('feng_shui'))}</span>
      {['nh', 'pt1', 'pt2', 'gen', 'all'].map((id) => <button key={id} onClick={() => s.setShopId(id)}>{id}</button>)}
    </div>
  );
}

const mountApi = (shops = SHOPS) => api.get.mockImplementation(async (p) => ({
  data: p === '/shops' ? shops : p === '/industries' ? INDUSTRIES : p === '/settings' ? {} : [],
}));
const renderApp = () => render(<SessionProvider user={{ displayName: 'x' }} onLogout={() => {}}><Probe /></SessionProvider>);

describe('Giao diện và tính năng đổi theo shop đang chọn', () => {
  beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.theme; mountApi(); });

  it('mặc định theo shop đầu tiên; chuyển shop thì theme và tính năng đổi theo ngành', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('shop').textContent).toBe('Nước hoa ô tô'));
    // theme được gán ở hiệu ứng chạy sau khi vẽ, nên phải chờ thay vì đọc ngay
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('nuochoa'));
    expect(screen.getByTestId('menh').textContent).toBe('false');

    fireEvent.click(screen.getByText('pt1'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('phongthuy'));
    expect(screen.getByTestId('menh').textContent).toBe('true');

    fireEvent.click(screen.getByText('gen'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('general'));
    expect(screen.getByTestId('menh').textContent).toBe('false');
  });

  it('hai shop phong thuỷ cùng theme và cùng tính năng', async () => {
    renderApp();
    await waitFor(() => screen.getByTestId('shop'));
    fireEvent.click(screen.getByText('pt1'));
    await waitFor(() => expect(screen.getByTestId('shop').textContent).toBe('Phong thuỷ A'));
    fireEvent.click(screen.getByText('pt2'));
    await waitFor(() => expect(screen.getByTestId('shop').textContent).toBe('Phong thuỷ B'));
    expect(document.documentElement.dataset.theme).toBe('phongthuy');
    expect(screen.getByTestId('menh').textContent).toBe('true');
  });

  it('"Tất cả shop" dùng giao diện chung và tắt tính năng theo ngành', async () => {
    renderApp();
    await waitFor(() => screen.getByTestId('shop'));
    fireEvent.click(screen.getByText('pt1'));
    await waitFor(() => expect(screen.getByTestId('menh').textContent).toBe('true'));
    fireEvent.click(screen.getByText('all'));
    await waitFor(() => expect(screen.getByTestId('shop').textContent).toBe('ALL'));
    expect(document.documentElement.dataset.theme).toBe('general');
    expect(screen.getByTestId('menh').textContent).toBe('false');
  });

  it('nhớ shop đã chọn qua lần tải lại; shop không còn tồn tại thì quay về shop đầu', async () => {
    localStorage.setItem('moso.shop', 'pt2');
    const first = renderApp();
    await waitFor(() => expect(screen.getByTestId('shop').textContent).toBe('Phong thuỷ B'));
    first.unmount();
    localStorage.setItem('moso.shop', 'da_xoa');
    renderApp();
    await waitFor(() => expect(screen.getByTestId('shop').textContent).toBe('Nước hoa ô tô'));
  });

  it('shop đổi ngành thì theme đổi theo khi tải lại danh mục', async () => {
    renderApp();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('nuochoa'));
    // (kiểm tra ánh xạ ngành → theme qua dữ liệu, không phụ thuộc tên shop)
    mountApi(SHOPS.map((s) => (s.id === 'nh' ? { ...s, industry: 'phong_thuy' } : s)));
    renderApp();
    await waitFor(() => expect(screen.getAllByTestId('theme').some((e) => e.textContent === 'phongthuy')).toBe(true));
  });
});
