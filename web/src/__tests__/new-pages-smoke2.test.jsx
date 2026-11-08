import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
import { api } from '../api.js';
vi.mock('../session.jsx', () => ({ useSession: () => ({ shopId: 'shp_1', isAll: false, shops: [{ id: 'shp_1', name: 'NH' }], channels: [], warehouses: [{ id: 'whs_1', name: 'Kho nhà' }], has: () => false }) }));
import AuditLog from '../pages/AuditLog.jsx';
import NotificationSettings from '../pages/NotificationSettings.jsx';
import NotificationBell from '../components/NotificationBell.jsx';
import ProductImport from '../components/ProductImport.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (path) => {
    if (path === '/system/audit') return { data: [{ id: 'a1', at: '2026-11-08T03:00:00Z', action: 'order.updated', action_label: 'Sửa đơn', entity_type: 'order', entity_label: 'DH-1', actor: 'Chủ shop', changes: [{ field: 'note', from: 'cũ', to: 'mới' }] }], next_cursor: null, facets: { entity_types: [{ v: 'order', n: 1 }], actions: [{ v: 'order.updated', label: 'Sửa đơn', n: 1 }] } };
    if (path === '/notifications/config') return { data: { rules: { low_stock: { enabled: true, channels: ['inapp'] }, pending_orders: { enabled: false, channels: ['inapp'], days: 2 } }, rule_info: { low_stock: { label: 'Hàng sắp hết', help: 'Báo mỗi ngày.' }, pending_orders: { label: 'Đơn chờ giao quá lâu', help: 'Báo khi…', param: { key: 'days', label: 'Sau (ngày)', min: 1, max: 30, def: 2 } } }, channels: ['inapp', 'telegram', 'webhook'], telegram: { chat_id: '', has_token: false, token_hint: '' } } };
    if (path === '/notifications') return { data: [{ id: 'n1', title: '3 mặt hàng sắp hết', body: 'A1: còn 2', link: '/stock', severity: 'warning', created_at: '2026-11-08T03:00:00Z', read_at: null }], unread: 1 };
    return { data: [] };
  });
});

describe('trang mới (đợt 2) không sập khi dựng', () => {
  it('Nhật ký: hành động, đối tượng, mở xem thay đổi', async () => {
    render(<MemoryRouter><AuditLog /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Sửa đơn', { selector: 'b' })).toBeTruthy());
    fireEvent.click(screen.getByText('1 thay đổi'));
    expect(screen.getByText('Ghi chú')).toBeTruthy();
    expect(screen.getByText(/mới/)).toBeTruthy();
  });
  it('Cài đặt thông báo: loại thông báo, kênh, Telegram', async () => {
    render(<NotificationSettings />);
    await waitFor(() => expect(screen.getByText('Hàng sắp hết')).toBeTruthy());
    expect(screen.getByLabelText('Token bot Telegram')).toBeTruthy();
    expect(screen.getByText('Lưu và gửi thử')).toBeTruthy();
  });
  it('Chuông thông báo: số chưa đọc và danh sách', async () => {
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    const btn = await screen.findByRole('button', { name: /1 chưa đọc/ });
    fireEvent.click(btn);
    expect(await screen.findByText('3 mặt hàng sắp hết')).toBeTruthy();
  });
  it('Nhập sản phẩm từ Excel: hướng dẫn và nút tải file mẫu', () => {
    render(<ProductImport onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByText('Tải file mẫu')).toBeTruthy();
    expect(screen.getByText('Xem trước')).toBeTruthy();
  });
});
