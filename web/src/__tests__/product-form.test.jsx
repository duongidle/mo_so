import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
import { api } from '../api.js';
let session;
vi.mock('../session.jsx', () => ({ useSession: () => session }));
import ProductForm, { initialForm, buildPayload } from '../pages/products/ProductForm.jsx';
import ComboForm, { comboStats, initialCombo } from '../pages/products/ComboForm.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  session = { shops: [{ id: 'shp_1', name: 'NH' }], shopId: 'shp_1', isAll: false, warehouses: [{ id: 'whs_1', name: 'Kho' }] };
  api.get.mockImplementation(async (path) => {
    if (path === '/categories') return { data: [{ id: 'cat_1', name: 'Hương', parent_id: null }, { id: 'cat_2', name: 'Hương xe', parent_id: 'cat_1' }] };
    if (path === '/custom/fields') return { data: [{ id: 'cf_1', key: 'ngu_hanh', label: 'Ngũ hành hợp', type: 'multiselect', options: ['Kim', 'Mộc'], role: 'element' }] };
    return { data: {} };
  });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
});

describe('ProductForm', () => {
  it('không biến thể: một khối SKU/giá/tồn đầu kỳ; gửi đủ trường kèm danh mục, thương hiệu, ngũ hành của shop', async () => {
    const onSaved = vi.fn();
    render(<ProductForm init={initialForm(null, 'shp_1', false)} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/Tên sản phẩm/), { target: { value: 'Tinh dầu' } });
    expect(await screen.findByRole('option', { name: '— Hương xe' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Danh mục'), { target: { value: 'cat_2' } });
    fireEvent.change(screen.getByLabelText('Thương hiệu'), { target: { value: 'Mộc Lan' } });
    fireEvent.change(screen.getByLabelText('Giá bán'), { target: { value: '150000' } });
    fireEvent.change(screen.getByLabelText('Giá vốn'), { target: { value: '40000' } });
    fireEvent.change(screen.getByLabelText('Tồn đầu kỳ'), { target: { value: '12' } });
    fireEvent.click(await screen.findByText('Kim', { selector: 'button' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [path, body] = api.post.mock.calls[0];
    expect(path).toBe('/products');
    expect(body).toMatchObject({ name: 'Tinh dầu', category_id: 'cat_2', brand: 'Mộc Lan', shop_ids: ['shp_1'], custom: { ngu_hanh: ['Kim'] }, custom_shop_id: 'shp_1' });
    expect(body.variants).toEqual([{ sku: 'TINHDAU', barcode: null, default_price: 150000, min_stock: 0, opening_qty: 12, opening_cost: 40000 }]);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('có biến thể: thuộc tính dạng thẻ sinh bảng tổ hợp, SKU tự sinh, áp dụng cho tất cả', async () => {
    render(<ProductForm init={initialForm(null, 'shp_1', false)} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Tên sản phẩm/), { target: { value: 'Tinh dầu' } });
    fireEvent.click(screen.getByLabelText(/Có biến thể/));
    fireEvent.change(screen.getByPlaceholderText(/Mùi, Size/), { target: { value: 'Mùi' } });
    const vals = screen.getByLabelText('Giá trị của Mùi');
    for (const v of ['Cam', 'Chanh']) { fireEvent.change(vals, { target: { value: v } }); fireEvent.keyDown(vals, { key: 'Enter' }); }
    expect(await screen.findByLabelText('SKU Cam')).toHaveProperty('value', 'TINHDAU-CAM');
    expect(screen.getByLabelText('SKU Chanh')).toHaveProperty('value', 'TINHDAU-CHANH');
    fireEvent.change(screen.getByLabelText('Giá bán cho tất cả'), { target: { value: '99000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(screen.getByLabelText('Giá bán TINHDAU-CAM')).toHaveProperty('value', '99000');
    fireEvent.change(screen.getByLabelText('SKU Cam'), { target: { value: 'my-cam' } });
    fireEvent.click(screen.getByLabelText('Đang bán TINHDAU-CHANH'));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = api.post.mock.calls[0][1];
    expect(body.options).toEqual([{ name: 'Mùi', values: ['Cam', 'Chanh'] }]);
    expect(body.variants.map((v) => [v.sku, v.option_values, v.active, v.default_price])).toEqual([
      ['MY-CAM', { Mùi: 'Cam' }, true, 99000],
      ['TINHDAU-CHANH', { Mùi: 'Chanh' }, false, 99000],
    ]);
  });

  it('báo lỗi từ server (SKU trùng) ngay trong form và không đóng form', async () => {
    api.post.mockRejectedValue(new Error('SKU A1 đã có ở một sản phẩm khác'));
    const onSaved = vi.fn();
    render(<ProductForm init={initialForm(null, 'shp_1', false)} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/Tên sản phẩm/), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect((await screen.findByRole('alert')).textContent).toContain('SKU A1');
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('buildPayload khi sửa', () => {
  const product = {
    id: 'prd_1', name: 'Tinh dầu', unit: 'chai', options: [{ name: 'Mùi', values: ['Cam', 'Chanh'] }], images: [{ id: 'img_1', url: '/u' }],
    variants: [
      { id: 'var_1', sku: 'A-CAM', default_price: 1000, min_stock: 0, option_values: { Mùi: 'Cam' }, listings: [{ shop_id: 'shp_1' }] },
      { id: 'var_2', sku: 'A-CHANH', default_price: 1000, min_stock: 0, option_values: { Mùi: 'Chanh' }, listings: [] },
    ],
  };
  it('biến thể đã có không gửi tồn đầu kỳ; biến thể bị bỏ gửi remove; không gửi shop_ids', () => {
    const f = initialForm(product, 'shp_1', false);
    expect(f.mode).toBe('matrix');
    const rows = f.rows.filter((r) => r.id === 'var_1');
    const p = buildPayload({ ...f, rows: [{ ...rows[0], opening_qty: '5' }], removed: [f.rows.find((r) => r.id === 'var_2')] });
    expect(p.shop_ids).toBeUndefined();
    expect(p.variants).toEqual([
      expect.objectContaining({ id: 'var_1', sku: 'A-CAM', option_values: { Mùi: 'Cam' }, active: true }),
      { id: 'var_2', remove: true },
    ]);
    expect(p.variants[0].opening_qty).toBeUndefined();
    expect(p.images).toEqual([{ id: 'img_1' }]);
  });
});

describe('ComboForm', () => {
  it('giá vốn ước tính = Σ SL × giá vốn, bán được = min theo thành phần', () => {
    const s = comboStats([{ qty: 2, avg_cost: 1000, on_hand: 9 }, { qty: '1', avg_cost: 500, on_hand: 3 }]);
    expect(s).toEqual({ cost: 2500, sellable: 3, complete: true });
    expect(comboStats([{ qty: 1 }]).sellable).toBeNull();
  });
  it('hiện giá vốn và số bán được khi thêm thành phần, gửi kind=bundle khi lưu', async () => {
    api.get.mockImplementation(async (path, params) => {
      if (path === '/categories') return { data: [] };
      if (path === '/variants') return { data: [{ id: 'var_a', sku: 'A1', kind: 'single', product_name: 'Nước hoa', variant_name: null, avg_cost: 40000, on_hand: 10 }] };
      return { data: {} };
    });
    render(<ComboForm init={initialCombo(null, 'shp_1', false)} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Tên combo/), { target: { value: 'Combo 2 chai' } });
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 'cb2' } });
    fireEvent.change(screen.getByLabelText('Tìm thành phần'), { target: { value: 'A1' } });
    fireEvent.click(await screen.findByText(/Nước hoa/, { selector: '.pick' }));
    fireEvent.change(screen.getByLabelText('Số lượng A1'), { target: { value: '2' } });
    expect(screen.getByText('80.000 ₫')).toBeTruthy();
    expect(screen.getByText('5 combo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1].variants).toEqual([{ sku: 'CB2', kind: 'bundle', default_price: 0, components: [{ variant_id: 'var_a', qty: 2 }] }]);
  });
});
