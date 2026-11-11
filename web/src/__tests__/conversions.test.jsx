import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), del: vi.fn() } }));
const session = vi.hoisted(() => ({ value: null }));
vi.mock('../session.jsx', () => ({ useSession: () => session.value }));
import { api } from '../api.js';
import { payBadges, moveLabel, STOCK_REASONS } from '../lib.js';
import { methodOptions } from '../lib.js';
import { ConversionForm } from '../pages/Conversions.jsx';
import OrderForm from '../pages/OrderForm.jsx';
import ProductForm, { initialForm } from '../pages/products/ProductForm.jsx';
import { reportTables, explainTable } from '../reportTables.js';
import { METRICS } from '../metrics.js';

describe('nhãn thanh toán đơn đã huỷ', () => {
  it('đơn huỷ còn tiền: nói "Còn phải hoàn khách" và/hoặc "Giữ cọc", không nói "Đã thu"', () => {
    expect(payBadges({ status: 'cancelled', payment_status: 'paid', paid_amount: 500000, refund_owed_amount: 500000, forfeited_amount: 0 }).map((b) => b.label)).toEqual(['Còn phải hoàn khách']);
    expect(payBadges({ status: 'cancelled', payment_status: 'paid', paid_amount: 500000, refund_owed_amount: 0, forfeited_amount: 500000 }).map((b) => b.label)).toEqual(['Giữ cọc']);
    expect(payBadges({ status: 'cancelled', payment_status: 'paid', paid_amount: 500000, refund_owed_amount: 200000, forfeited_amount: 300000 }).map((b) => b.label)).toEqual(['Còn phải hoàn khách', 'Giữ cọc']);
  });
  it('đã hoàn hết hoặc đơn thường: giữ nhãn theo trạng thái', () => {
    expect(payBadges({ status: 'cancelled', payment_status: 'refunded', paid_amount: 0, refund_owed_amount: 0, forfeited_amount: 0 }).map((b) => b.label)).toEqual(['Đã hoàn']);
    expect(payBadges({ status: 'completed', payment_status: 'paid', paid_amount: 100, refund_owed_amount: 0, forfeited_amount: 0 }).map((b) => b.label)).toEqual(['Đã thu']);
  });
  it('sổ kho gọi biến động của phiếu đóng gói là Đóng gói; lý do giảm kho đủ 5 mã', () => {
    expect(moveLabel({ type: 'transfer_out', ref_type: 'conversion', qty: -20 })).toBe('Đóng gói: xuất nguồn');
    expect(moveLabel({ type: 'transfer_in', ref_type: 'conversion', qty: 39 })).toBe('Đóng gói: nhập thành phẩm');
    expect(moveLabel({ type: 'transfer_out', ref_type: 'transfer', qty: -1 })).toBe('Chuyển đi');
    expect(STOCK_REASONS.map(([c]) => c)).toEqual(['damaged', 'expired', 'weight_loss', 'lost', 'other']);
  });
});

describe('báo cáo hao hụt', () => {
  const reasons = [{ code: 'damaged', label: 'Hỏng, vỡ' }, { code: 'return_damaged', label: 'Hàng trả về bị hỏng' }];
  const by = (q, v) => ({ damaged: { qty: q, value: v }, return_damaged: { qty: 0, value: 0 } });
  const data = { data: { reasons, totals: { damaged: { label: 'Hỏng, vỡ', qty_lines: 1, value: 200000 }, return_damaged: { label: '', qty_lines: 0, value: 0 } }, total_value: 200000, items: [{ sku: 'DIEU', product_name: 'Điều', unit: 'kg', by_reason: by(2, 200000), qty: 2, value: 200000, received_qty: 100, shrink_rate: 0.02 }] } };
  it('xuất Excel: tiền và tỷ lệ là số; có sheet giải thích', () => {
    const t = reportTables('shrinkage', data, { range: { from: '2026-11-01', to: '2026-11-30' } });
    const prod = t.find((x) => x.name === 'Theo sản phẩm');
    expect(prod.rows[0]).toEqual(['DIEU', 'Điều', 'kg', 2, 200000, 0, 0, 2, 200000, 100, 2]);
    expect(prod.headers.length).toBe(prod.rows[0].length);
    expect(explainTable('shrinkage').rows.length).toBe(3);
    for (const k of ['shrink_value', 'shrink_rate', 'shrink_by_reason']) expect(METRICS[k]).toBeTruthy();
  });
});

describe('form sản phẩm dịch vụ ở chế độ ma trận', () => {
  it('ẩn cột và ô áp dụng giá vốn, tồn đầu kỳ; vẫn có giá bán', () => {
    session.value = { shops: [{ id: 'shp_1', name: 'NH' }], shopId: 'shp_1', isAll: false, warehouses: [{ id: 'w1', name: 'Kho' }] };
    api.get.mockImplementation(async () => ({ data: [] }));
    const base = initialForm(null, 'shp_1', false);
    const init = { ...base, item_type: 'service', mode: 'matrix', options: [{ name: 'Gói', values: ['A', 'B'] }], rows: [{ sku: 'GOI-A', default_price: 100000, opening_cost: '', opening_qty: '', barcode: '', min_stock: 0, active: true, option_values: { Gói: 'A' }, image_id: null }, { sku: 'GOI-B', default_price: 200000, opening_cost: '', opening_qty: '', barcode: '', min_stock: 0, active: true, option_values: { Gói: 'B' }, image_id: null }] };
    render(<ProductForm init={init} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText('Giá bán', { selector: 'th' })).toBeTruthy();
    expect(screen.queryByText('Giá vốn', { selector: 'th' })).toBeNull();
    expect(screen.queryByText('Tồn đầu kỳ', { selector: 'th' })).toBeNull();
    expect(screen.queryByText('Giá vốn cho tất cả')).toBeNull();
    expect(screen.queryByText('Tồn đầu kỳ cho tất cả')).toBeNull();
    expect(screen.getByText('Giá bán cho tất cả')).toBeTruthy();
  });
});

describe('sửa đơn đã xác nhận: lô hết hạn', () => {
  it('máy chủ trả LOT_EXPIRED thì hỏi lại rồi gửi lại với allow_expired', async () => {
    const SHOP = { id: 'shp_1', name: 'NH', code: 'NH' };
    const CH = [{ id: 'direct', name: 'Trực tiếp', is_marketplace: 0 }];
    session.value = { shop: SHOP, shops: [SHOP], channels: CH, allChannels: CH, methodList: (c) => methodOptions([], c) };
    const order = { id: 'ord_1', code: 'DH-1', shop_id: 'shp_1', status: 'confirmed', channel_id: 'direct', external_id: null, customer_id: null, lines: [{ id: 'orl_1', variant_id: 'var_1', sku: 'TD-1', name: 'Tinh dầu', qty: 1, unit_price: 100000, discount_amount: 0, planned_allocations: null }] };
    api.get.mockImplementation(async (path) => (path === '/orders/ord_1' ? { data: order } : { data: [] }));
    api.post.mockImplementation(async (path) => (path === '/orders/allocation-preview' ? { data: { primary_warehouse_id: 'w1', warehouses: [], lines: [], stock: [], shortages: [], warnings: [], ok: true } } : { data: {} }));
    const err = Object.assign(new Error('TD-1: lô L1 đã hết hạn'), { code: 'LOT_EXPIRED' });
    api.patch.mockRejectedValueOnce(err).mockResolvedValueOnce({ data: {} });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter initialEntries={['/orders/ord_1/edit']}><Routes><Route path="/orders/:id/edit" element={<OrderForm />} /><Route path="/orders/:id" element={<div>CHI TIẾT ĐƠN</div>} /></Routes></MemoryRouter>);
    const save = await screen.findByLabelText('Lưu thay đổi');
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await screen.findByText('CHI TIẾT ĐƠN');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(api.patch.mock.calls[0][1].allow_expired).toBeUndefined();
    expect(api.patch.mock.calls[1][1].allow_expired).toBe(true);
    confirm.mockRestore();
  });
  it('không đồng ý thì không gửi lại', async () => {
    const SHOP = { id: 'shp_1', name: 'NH', code: 'NH' };
    const CH = [{ id: 'direct', name: 'Trực tiếp', is_marketplace: 0 }];
    session.value = { shop: SHOP, shops: [SHOP], channels: CH, allChannels: CH, methodList: (c) => methodOptions([], c) };
    const order = { id: 'ord_1', code: 'DH-1', shop_id: 'shp_1', status: 'confirmed', channel_id: 'direct', customer_id: null, lines: [{ id: 'orl_1', variant_id: 'var_1', sku: 'TD-1', name: 'Tinh dầu', qty: 1, unit_price: 100000, discount_amount: 0, planned_allocations: null }] };
    api.get.mockImplementation(async (path) => (path === '/orders/ord_1' ? { data: order } : { data: [] }));
    api.post.mockImplementation(async (path) => (path === '/orders/allocation-preview' ? { data: { primary_warehouse_id: 'w1', warehouses: [], lines: [], stock: [], shortages: [], warnings: [], ok: true } } : { data: {} }));
    api.patch.mockReset();
    api.patch.mockRejectedValue(Object.assign(new Error('lô hết hạn'), { code: 'LOT_EXPIRED' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MemoryRouter initialEntries={['/orders/ord_1/edit']}><Routes><Route path="/orders/:id/edit" element={<OrderForm />} /></Routes></MemoryRouter>);
    const save = await screen.findByLabelText('Lưu thay đổi');
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await screen.findByText('lô hết hạn');
    expect(api.patch).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});

describe('ConversionForm', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('thêm thành phẩm, gợi ý nguồn, sửa số thực tế, xem trước giá vốn và ghi phiếu', async () => {
    session.value = { warehouses: [{ id: 'w1', name: 'Kho chính' }], shopId: 'shp_1', isAll: false };
    const HOP = { variant_id: 'var_hop', sku: 'DIEU-500', product_name: 'Điều hộp 500g', variant_name: null, unit: 'hộp', item_type: 'product', on_hand: 0, is_bundle: false };
    api.get.mockImplementation(async (path, params = {}) => {
      if (path === '/stock') return { data: params.q === 'hop' ? [HOP] : [] };
      return { data: [] };
    });
    api.post.mockImplementation(async (path, body) => {
      if (path === '/conversions/suggest') return { data: { sources: [{ variant_id: 'var_kg', sku: 'DIEU-KG', product_name: 'Hạt điều', unit: 'kg', qty: 20, on_hand: 25, kind: 'recipe', enough: true }, { variant_id: 'var_box', sku: 'HOP-RONG', product_name: 'Hộp rỗng', unit: 'cái', qty: 40, on_hand: 100, kind: 'packaging', enough: true }] } };
      if (path === '/conversions/preview') return { data: { source_value: 4200000, sources: [{ variant_id: 'var_kg', qty: 20, amount: 4000000 }, { variant_id: 'var_box', qty: 39, amount: 200000 }], outputs: [{ variant_id: 'var_hop', qty: 39, weight: 1, amount: 4200000, unit_cost: 107692 }] } };
      if (path === '/conversions') return { data: { id: 'cnv_1' } };
      return { data: {} };
    });
    const onSaved = vi.fn();
    render(<ConversionForm onClose={() => {}} onSaved={onSaved} onDirty={() => {}} />);
    fireEvent.change(screen.getByLabelText('Tìm thành phẩm (hộp, túi…) để thêm'), { target: { value: 'hop' } });
    fireEvent.click(await screen.findByText('Điều hộp 500g', { exact: false }));
    fireEvent.change(await screen.findByLabelText('Số lượng thành phẩm DIEU-500'), { target: { value: '39' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý hàng nguồn' }));
    const kg = await screen.findByLabelText('Số lượng nguồn DIEU-KG');
    expect(kg.value).toBe('20');
    expect(screen.getByLabelText('Số lượng nguồn HOP-RONG').value).toBe('40');
    fireEvent.change(screen.getByLabelText('Số lượng nguồn HOP-RONG'), { target: { value: '39' } });
    expect(await screen.findByText('107.692 ₫ / hộp')).toBeTruthy(); // giá vốn xem trước
    expect(await screen.findByText(/Định mức 40, thực tế 39/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ghi phiếu đóng gói' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 'cnv_1' }));
    const call = api.post.mock.calls.find(([p]) => p === '/conversions');
    expect(call[1]).toMatchObject({ warehouse_id: 'w1', sources: [{ variant_id: 'var_kg', qty: 20, lot_id: null }, { variant_id: 'var_box', qty: 39, lot_id: null }], outputs: [{ variant_id: 'var_hop', qty: 39 }] });
  });

  it('thiếu tồn nguồn hoặc số thành phẩm lẻ thì không cho ghi', async () => {
    session.value = { warehouses: [{ id: 'w1', name: 'Kho chính' }], shopId: 'shp_1', isAll: false };
    api.get.mockImplementation(async (path, params = {}) => (path === '/stock' ? { data: params.q === 'hop' ? [{ variant_id: 'var_hop', sku: 'HOP', product_name: 'Hộp', unit: 'hộp', item_type: 'product', on_hand: 0, is_bundle: false }] : [{ variant_id: 'var_kg', sku: 'KG', product_name: 'Kg', unit: 'kg', item_type: 'product', on_hand: 5, is_bundle: false }] } : { data: [] }));
    api.post.mockResolvedValue({ data: { source_value: 0, sources: [], outputs: [] } });
    render(<ConversionForm onClose={() => {}} onSaved={() => {}} onDirty={() => {}} />);
    fireEvent.change(screen.getByLabelText('Tìm thành phẩm (hộp, túi…) để thêm'), { target: { value: 'hop' } });
    fireEvent.click(await screen.findByText('HOP'));
    fireEvent.change(await screen.findByLabelText('Số lượng thành phẩm HOP'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Tìm hàng nguồn (kg, hộp rỗng, tem…) để thêm'), { target: { value: 'kg' } });
    fireEvent.click(await screen.findByText('KG'));
    fireEvent.change(await screen.findByLabelText('Số lượng nguồn KG'), { target: { value: '9' } });
    expect(await screen.findByText(/Không đủ tồn: cần 9, kho chỉ còn 5/)).toBeTruthy();
    expect(screen.getByText('Số lượng thành phẩm phải là số nguyên.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ghi phiếu đóng gói' }).disabled).toBe(true);
  });
});
