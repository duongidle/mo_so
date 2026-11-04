import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
const session = vi.hoisted(() => ({ value: null }));
vi.mock('../session.jsx', () => ({ useSession: () => session.value }));
vi.mock('../components/ExportCustomers.jsx', () => ({ default: () => null }));
import { api } from '../api.js';
import { CustomerDetail } from '../pages/Customers.jsx';

const pt = { id: 'pt', name: 'Phong thuỷ', code: 'PT' };
const fields = [
  { id: 'f1', key: 'menh', label: 'Mệnh (ghi đè)', type: 'select', options: ['Kim', 'Mộc'], role: 'element' },
  { id: 'f2', key: 'tuoi', label: 'Tuổi', type: 'formula', formula: 'AGE({birth_date})' },
];
const detail = (profile = {}, c = {}) => ({
  data: { id: 'c1', code: 'KH-1', name: 'Anh Tài', phone: '0911', birth_date: '1990-01-20', birth_year: null, age: 36, order_count: 0, total_spent: 0, notes: [], by_shop: [], is_member: true,
    feng_shui: { element: 'Mộc', source: 'birth_date', effective_source: 'computed', approximate: false, nap_am: 'Đại Lâm Mộc', can_chi: 'Kỷ Tỵ', compatible_elements: ['Mộc', 'Thuỷ'] },
    shop_profile: { shop_id: 'pt', fields, values: { menh: undefined, tuoi: 36 }, reasons: {}, element: { key: 'menh', value: 'Mộc', source: 'computed' }, tags: [], ...profile }, ...c },
});

describe('Hồ sơ khách: thông tin chung trước, mệnh hiệu lực, lý do công thức trống', () => {
  let current;
  beforeEach(() => {
    session.value = { shop: pt, isAll: false, has: () => true };
    for (const f of Object.values(api)) f.mockReset();
    current = detail();
    api.get.mockImplementation(async (path) => {
      if (path === '/customers/c1') return current;
      if (path === '/customers/tags') return { data: [] };
      if (path === '/orders') return { data: [] };
      if (path === '/loyalty/customers/c1') return { data: { tier: { name: 'Thành viên' }, spent_12m: 0, next_tier: null } };
      return { data: [] };
    });
    api.put.mockResolvedValue({ data: {} });
  });
  const open = () => render(<MemoryRouter initialEntries={['/customers/c1']}><Routes><Route path="/customers/:id" element={<CustomerDetail />} /></Routes></MemoryRouter>);

  it('thông tin chung (ngày sinh, tuổi) nằm trước thẻ Mệnh/Hạng/Tổng, rồi mới tới nhãn và thông tin riêng', async () => {
    open();
    await screen.findByText('Thông tin chung');
    const order = ['Thông tin chung', 'Mệnh', 'Hạng', 'Tổng', 'Nhãn · Phong thuỷ', 'Thông tin riêng · Phong thuỷ'];
    const heads = [...document.querySelectorAll('.section-head h3')].map((h) => h.textContent);
    const idx = order.map((t) => heads.indexOf(t));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(screen.getByText('20/01/1990')).toBeTruthy();
    expect(document.querySelector('.page-head')).toBeTruthy(); // dùng PageHeader chung
  });

  it('mệnh tự tính hiện kèm “(tự tính)”; ô ghi đè khi sửa có gợi ý và để trống không ghi gì', async () => {
    open();
    const row = (await screen.findByText('Mệnh (ghi đè)')).closest('.ledger-line');
    expect(row.textContent).toContain('Mộc');
    expect(row.textContent).toContain('(tự tính)');
    // Nút “Sửa” của thông tin riêng là nút chính (primary); nút kia sửa thông tin chung
    fireEvent.click(screen.getAllByRole('button', { name: 'Sửa' }).find((b) => b.className.includes('primary')));
    const select = await screen.findByDisplayValue('Mộc (tự tính)');
    expect(select.value).toBe('');
    expect(screen.getByText(/Để trống thì dùng mệnh tự tính: Mộc/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Lưu' }).find((b) => b.className.includes('primary')));
    await waitFor(() => expect(screen.queryByDisplayValue('Mộc (tự tính)')).toBeNull());
    expect(api.put).not.toHaveBeenCalled();
  });

  it('công thức trống thì hiện lý do thay vì chỉ “—”', async () => {
    current = detail({ values: { tuoi: null }, reasons: { tuoi: 'Khách chưa có Ngày sinh' }, element: null });
    open();
    expect(await screen.findByText(/Khách chưa có Ngày sinh/)).toBeTruthy();
  });
});
