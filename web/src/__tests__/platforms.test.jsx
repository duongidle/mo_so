import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
import { api } from '../api.js';

const PLATFORMS = [
  { id: 'shopee', name: 'Shopee', description: 'Sàn Shopee', features: ['import', 'reconciliation'], payout_method: 'shopee_payout', payout_label: 'Shopee payout', enabled: true, order_count: 3 },
  { id: 'tiktok', name: 'TikTok Shop', description: 'Sàn TikTok', features: ['import', 'reconciliation'], payout_method: 'tiktok_payout', payout_label: 'TikTok payout', enabled: false, order_count: 0 },
];
const CHANNELS = [
  { id: 'shopee', name: 'Shopee', is_marketplace: 1 },
  { id: 'tiktok', name: 'TikTok Shop', is_marketplace: 1, archived_at: 'x' },
  { id: 'ch_1', name: 'Đại lý A', is_marketplace: 0 },
];
let session;
vi.mock('../session.jsx', () => ({ useSession: () => session }));
import { methodLabels, methodOptions } from '../lib.js';
import { Platforms } from '../pages/Settings.jsx';
import Expenses from '../pages/Expenses.jsx';

describe('phương thức thanh toán theo nền tảng', () => {
  it('nhãn payout lấy từ nền tảng; payout của nền tảng tắt bị ẩn khỏi bộ chọn trừ giá trị đang dùng', () => {
    expect(methodLabels(PLATFORMS).tiktok_payout).toBe('TikTok payout');
    const keys = (cur) => methodOptions(PLATFORMS, cur).map(([k]) => k);
    expect(keys()).toContain('shopee_payout');
    expect(keys()).not.toContain('tiktok_payout');
    expect(keys('tiktok_payout')).toContain('tiktok_payout');
    expect(keys()).toContain('cash');
  });
});

describe('Cài đặt → Nền tảng bán hàng', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.post.mockResolvedValue({ data: {} });
    session = { platforms: PLATFORMS, allChannels: CHANNELS, reload: vi.fn().mockResolvedValue() };
  });

  it('hiện thẻ từng nền tảng với trạng thái; "Kết nối" gọi enable, "Ngắt kết nối" gọi disable rồi nạp lại', async () => {
    render(<Platforms />);
    expect(screen.getByText('Đang kết nối')).toBeTruthy();
    expect(screen.getByText('Chưa kết nối')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kết nối' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/platforms/tiktok/enable'));
    fireEvent.click(screen.getByRole('button', { name: 'Ngắt kết nối' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/platforms/shopee/disable'));
    await waitFor(() => expect(session.reload).toHaveBeenCalledTimes(2));
  });

  it('chỉ liệt kê kênh tuỳ chỉnh (ch_…) và tạo kênh mới gửi is_marketplace', async () => {
    render(<Platforms />);
    expect(screen.getByText('Đại lý A')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Kênh' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Chợ B' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/channels', { name: 'Chợ B', is_marketplace: true }));
  });
});

describe('Chi phí & đối soát: tab đối soát sàn', () => {
  const mount = () => render(<MemoryRouter><Expenses /></MemoryRouter>);
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: [], total_pending: 0, count: 0 });
  });

  it('ẩn tab khi chưa bật sàn nào', () => {
    session = { shopId: 's', isAll: false, shops: [], marketplaces: [], methodLabels: {}, methodList: () => [] };
    mount();
    expect(screen.queryByText('Đối soát sàn')).toBeNull();
  });

  it('có sàn thì hiện tab; chọn từng sàn thì lọc đúng kênh', async () => {
    session = { shopId: 's', isAll: false, shops: [], marketplaces: [CHANNELS[0], { id: 'tiktok', name: 'TikTok Shop', is_marketplace: 1 }], methodLabels: {}, methodList: () => [] };
    mount();
    fireEvent.click(screen.getByText('Đối soát sàn'));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/reconciliation/pending', { shop_id: 's', channel_id: 'shopee' }));
    fireEvent.click(await screen.findByText('TikTok Shop'));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/reconciliation/pending', { shop_id: 's', channel_id: 'tiktok' }));
  });
});
