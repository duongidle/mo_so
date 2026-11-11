import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GUIDES, GROUPS, byId, searchText } from '../guides/content.js';
import Guide from '../pages/Guide.jsx';

vi.mock('../api.js', () => ({ api: { get: vi.fn(() => new Promise(() => {})) } }));
vi.mock('../session.jsx', () => ({ useSession: () => ({ shopId: 's1', isAll: false, shop: { name: 'Shop' }, theme: 'general' }) }));

const ROUTES = ['/', '/orders', '/orders/new', '/orders?import=1', '/products', '/products/new', '/products/combo/new', '/stock', '/stock?tab=conversions', '/stock?tab=lots', '/stock/conversions/new', '/purchases', '/purchases/new', '/customers', '/loyalty', '/expenses', '/expenses?tab=payables', '/reports', '/accounting', '/settings'];

describe('nội dung hướng dẫn', () => {
  it('id duy nhất, nhóm hợp lệ, có nội dung', () => {
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
    for (const g of GUIDES) {
      expect(GROUPS).toContain(g.group);
      expect(g.title && g.summary).toBeTruthy();
      if (!g.special) expect(g.blocks.length).toBeGreaterThan(0);
    }
    for (const grp of GROUPS) expect(GUIDES.some((g) => g.group === grp), grp).toBe(true);
  });
  it('mọi liên kết trong hướng dẫn trỏ tới trang có thật', () => {
    for (const g of GUIDES) {
      for (const b of g.blocks || []) for (const s of b.items || []) if (s?.to) expect(ROUTES, `${g.id}: ${s.to}`).toContain(s.to);
      for (const [to] of g.links || []) expect(ROUTES, `${g.id}: ${to}`).toContain(to);
    }
  });
  it('có hướng dẫn chốt kho và sức khoẻ kinh doanh; tìm kiếm theo nội dung', () => {
    expect(byId('chot-kho')).toBeTruthy();
    expect(byId('suc-khoe-kinh-doanh').special).toBe('health');
    expect(searchText(byId('chot-kho'))).toContain('mở lại kỳ');
  });
});

describe('trang Hướng dẫn', () => {
  const at = (path) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/guide" element={<Guide />} /><Route path="/guide/:id" element={<Guide />} /></Routes></MemoryRouter>);
  it('mục lục liệt kê mọi hướng dẫn, tìm kiếm lọc được', () => {
    at('/guide');
    expect(screen.getAllByRole('link', { name: /Chốt kho cuối kỳ/ }).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Tìm hướng dẫn'), { target: { value: 'chốt kho' } });
    expect(screen.queryByRole('link', { name: /Tạo đơn và theo dõi đơn/ })).toBeNull();
    expect(screen.getAllByRole('link', { name: /Chốt kho cuối kỳ/ }).length).toBeGreaterThan(0);
  });
  it('mở một hướng dẫn: có các bước, mục tiếp theo', () => {
    at('/guide/tao-don');
    expect(screen.getByRole('heading', { name: 'Tạo đơn và theo dõi đơn' })).toBeTruthy();
    expect(screen.getByText('Bán trực tiếp')).toBeTruthy();
    expect(screen.getByText(/Trả hàng và đổi hàng/, { selector: '.guide-pn' })).toBeTruthy();
  });
});
