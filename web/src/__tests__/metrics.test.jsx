import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { METRICS, SCOPES, GLOSSARY } from '../metrics.js';
import MetricInfo, { MetricFilters } from '../components/MetricInfo.jsx';
import { Kpi } from '../components/ui.jsx';
import { ScopeStrip } from '../pages/Reports.jsx';
import { explainTable, TAB_METRICS } from '../reportTables.js';

vi.mock('../api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('../session.jsx', () => ({ useSession: () => ({ theme: 'general' }) }));

const used = (file) => [...readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(/(?:metric|m)=\{?["']([a-z_]+)["']/g)].map((m) => m[1]);

describe('từ điển chỉ số', () => {
  it('mọi metric= dùng trong Reports, Dashboard, ui đều có trong từ điển', () => {
    for (const f of ['../pages/Reports.jsx', '../pages/Dashboard.jsx']) {
      const keys = used(f);
      expect(keys.length).toBeGreaterThan(10);
      for (const k of keys) expect(METRICS[k], `${f}: ${k}`).toBeTruthy();
    }
    for (const keys of Object.values(TAB_METRICS)) for (const k of keys) expect(METRICS[k], k).toBeTruthy();
  });
  it('mỗi chỉ số có nghĩa, cách tính, nguồn, phạm vi hợp lệ và gợi ý', () => {
    for (const m of Object.values(METRICS)) {
      for (const f of ['what', 'formula', 'source', 'tip', 'name']) expect(m[f], `${m.key}.${f}`).toBeTruthy();
      expect(Object.keys(SCOPES)).toContain(m.scope);
    }
  });
  it('drill chỉ trả đường dẫn nội bộ', () => {
    for (const m of Object.values(METRICS)) if (m.drill) expect(m.drill({ from: '2026-11-01', to: '2026-11-30', today: '2026-11-04' })).toMatch(/^\//);
  });
  it('glossary giữ dạng cũ và sheet giải thích có dữ liệu', () => {
    expect(GLOSSARY.length).toBe(4);
    for (const g of GLOSSARY) for (const it of g.items) expect(it.what && it.how && it.tip).toBeTruthy();
    expect(explainTable('cash').rows.length).toBeGreaterThan(5);
  });
});

describe('MetricInfo', () => {
  const wrap = (ui) => render(<MemoryRouter><MetricFilters.Provider value={{ from: '2026-11-01', to: '2026-11-30' }}>{ui}</MetricFilters.Provider></MemoryRouter>);
  it('mở bằng nút ⓘ, đóng bằng Esc và bằng bấm ra ngoài', () => {
    wrap(<div><MetricInfo metric="cancel_rate_pct" /><p>ngoài</p></div>);
    const btn = screen.getByRole('button', { name: /Giải thích: Tỷ lệ huỷ/ });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Lấy từ đâu/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Xem dữ liệu gốc' }).getAttribute('href')).toBe('/orders?status=cancelled&from=2026-11-01&to=2026-11-30');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(btn);
    fireEvent.mouseDown(screen.getByText('ngoài'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('Kpi hiện nhãn phạm vi khi khác bộ lọc, không hiện khi theo bộ lọc', () => {
    wrap(<><Kpi metric="supplier_payable" label="Nợ NCC" value="1" /><Kpi metric="net_revenue" label="DT" value="2" /></>);
    expect(screen.getAllByText(/Toàn tài khoản/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Theo shop & kênh đang lọc')).toBeNull();
  });
});

describe('dải phạm vi', () => {
  const range = { from: '2026-11-01', to: '2026-11-30' };
  it('một shop', () => {
    render(<ScopeStrip shopName="Shop A" range={range} tab="revenue" />);
    const t = screen.getByRole('status').textContent;
    expect(t).toContain('Đang xem: Shop A');
    expect(t).toContain('Tất cả kênh');
    expect(t).toContain('so với');
  });
  it('tất cả shop, có danh mục', () => {
    render(<ScopeStrip range={range} category="Nước hoa" tab="products" />);
    const t = screen.getByRole('status').textContent;
    expect(t).toContain('Tất cả shop');
    expect(t).toContain('Danh mục: Nước hoa');
  });
});
