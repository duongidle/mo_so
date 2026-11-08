import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
import { api } from '../api.js';
let session;
vi.mock('../session.jsx', () => ({ useSession: () => session }));
import ProductPage from '../pages/products/ProductPage.jsx';
import { NewPurchasePage, EditPurchasePage } from '../pages/Purchases.jsx';

const mount = (routes, initial) => render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [initial] })} />);

beforeEach(() => {
  vi.clearAllMocks();
  session = { shops: [{ id: 'shp_1', name: 'NH' }], shopId: 'shp_1', isAll: false, warehouses: [{ id: 'whs_1', name: 'Kho' }] };
  api.get.mockImplementation(async (path) => {
    if (path === '/categories') return { data: [] };
    if (path === '/purchases/pur_1') return { data: { id: 'pur_1', code: 'PN-1', status: 'draft', supplier_id: 'sup_1', warehouse_id: 'whs_1', shipping_fee: 8000, other_fee: 0, discount_amount: 0, shipping_payee: 'supplier', due_date: null, lines: [{ variant_id: 'var_1', sku: 'TD-1', product_name: 'Tinh dầu', qty: 5, unit_cost: 40000 }] } };
    if (path === '/purchases/pur_2') return { data: { id: 'pur_2', code: 'PN-2', status: 'received', lines: [] } };
    if (path === '/suppliers') return { data: [{ id: 'sup_1', name: 'NCC A' }] };
    if (path === '/variants') return { data: [{ id: 'var_1', sku: 'TD-1', product_name: 'Tinh dầu', avg_cost: 40000 }] };
    if (path === '/products/prd_1') return { data: { id: 'prd_1', name: 'Tinh dầu', unit: 'chai', options: [], images: [], variants: [{ id: 'var_1', sku: 'TD-1', default_price: 99000, min_stock: 0, option_values: null, listings: [{ shop_id: 'shp_1' }] }] } };
    return { data: {} };
  });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
});

describe('form sản phẩm dạng trang', () => {
  it('/products/new gửi đúng payload như form cũ rồi quay về danh sách', async () => {
    mount([{ path: '/products/new', element: <ProductPage /> }, { path: '/products', element: <div>DANH SÁCH SP</div> }], '/products/new');
    fireEvent.change(await screen.findByLabelText(/Tên sản phẩm/), { target: { value: 'Tinh dầu' } });
    fireEvent.change(screen.getByLabelText('Giá bán'), { target: { value: '150000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [path, body] = api.post.mock.calls[0];
    expect(path).toBe('/products');
    expect(body.variants).toEqual([{ sku: 'TINHDAU', barcode: null, default_price: 150000, min_stock: 0 }]);
    expect(body.shop_ids).toEqual(['shp_1']);
    await screen.findByText('DANH SÁCH SP');
  });

  it('/products/:id nạp sản phẩm và PATCH khi lưu', async () => {
    mount([{ path: '/products/:id', element: <ProductPage /> }, { path: '/products', element: <div>DANH SÁCH SP</div> }], '/products/prd_1');
    expect(await screen.findByDisplayValue('Tinh dầu')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch.mock.calls[0][0]).toBe('/products/prd_1');
  });

  it('rời form đã sửa mà chưa lưu thì hỏi lại; không đồng ý thì ở lại', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount([{ path: '/products/new', element: <ProductPage /> }, { path: '/products', element: <div>DANH SÁCH SP</div> }], '/products/new');
    const name = await screen.findByLabelText(/Tên sản phẩm/);
    fireEvent.change(name, { target: { value: 'Dở dang' } });
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(screen.queryByText('DANH SÁCH SP')).toBeNull();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await screen.findByText('DANH SÁCH SP');
    confirm.mockRestore();
  });
});

describe('cảnh báo chưa lưu không dựa vào đồng hồ', () => {
  it('mở form rồi rời đi ngay (kể cả khi form tự điền) thì không hỏi', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount([{ path: '/products/:id', element: <ProductPage /> }, { path: '/products', element: <div>DANH SÁCH SP</div> }], '/products/prd_1');
    await screen.findByDisplayValue('Tinh dầu');
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await screen.findByText('DANH SÁCH SP');
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
  it('sửa ngay khi form vừa hiện (không chờ) vẫn tính là đã sửa', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount([{ path: '/products/new', element: <ProductPage /> }, { path: '/products', element: <div>DANH SÁCH SP</div> }], '/products/new');
    fireEvent.change(await screen.findByLabelText(/Tên sản phẩm/), { target: { value: 'Vừa gõ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    confirm.mockRestore();
  });
});

describe('phiếu nhập dạng trang', () => {
  it('thêm dòng, nhận hàng & lưu gửi đúng payload', async () => {
    mount([{ path: '/purchases/new', element: <NewPurchasePage /> }, { path: '/purchases', element: <div>DS PHIẾU</div> }], '/purchases/new');
    fireEvent.change(await screen.findByLabelText('Tìm SKU'), { target: { value: 'TD' } });
    fireEvent.click(await screen.findByText(/Tinh dầu/, { selector: '.pick span' }));
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /Nhận hàng/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [path, body] = api.post.mock.calls[0];
    expect(path).toBe('/purchases');
    expect(body).toMatchObject({ receive: true, warehouse_id: 'whs_1', supplier_id: null, lines: [{ variant_id: 'var_1', qty: 5, unit_cost: 40000 }] });
    await screen.findByText('DS PHIẾU');
  });
  it('Lưu nháp gửi receive=false', async () => {
    mount([{ path: '/purchases/new', element: <NewPurchasePage /> }, { path: '/purchases', element: <div>DS PHIẾU</div> }], '/purchases/new');
    fireEvent.change(await screen.findByLabelText('Tìm SKU'), { target: { value: 'TD' } });
    fireEvent.click(await screen.findByText(/Tinh dầu/, { selector: '.pick span' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1]).toMatchObject({ receive: false, paid_amount: 0 });
  });
});

describe('sửa phiếu nhập nháp', () => {
  const routes = [{ path: '/purchases/:id/edit', element: <EditPurchasePage /> }, { path: '/purchases/:id', element: <div>CHI TIẾT</div> }];
  it('nạp sẵn dòng hàng, Lưu thay đổi gửi PATCH rồi quay về chi tiết', async () => {
    mount(routes, '/purchases/pur_1/edit');
    expect(await screen.findByDisplayValue('5')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [path, body] = api.patch.mock.calls[0];
    expect(path).toBe('/purchases/pur_1');
    expect(body).toMatchObject({ supplier_id: 'sup_1', warehouse_id: 'whs_1', shipping_fee: 8000, lines: [{ variant_id: 'var_1', qty: 9, unit_cost: 40000 }] });
    expect(api.post).not.toHaveBeenCalled();
    await screen.findByText('CHI TIẾT');
  });
  it('Nhận hàng & lưu: PATCH rồi receive', async () => {
    mount(routes, '/purchases/pur_1/edit');
    await screen.findByDisplayValue('5');
    fireEvent.click(screen.getByRole('button', { name: /Nhận hàng/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/purchases/pur_1/receive'));
    expect(api.patch).toHaveBeenCalled();
  });
  it('phiếu đã nhận thì không cho sửa', async () => {
    mount(routes, '/purchases/pur_2/edit');
    expect(await screen.findByText(/Chỉ sửa được phiếu nháp/)).toBeTruthy();
  });
});
