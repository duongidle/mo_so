import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';

vi.mock('../api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
import { api } from '../api.js';
import FormulaEditor, { findTrigger, filterVariables, filterFunctions } from '../components/FormulaEditor.jsx';

const VARS = [
  { ref: '{net_amount}', key: 'net_amount', label: 'Shop thực nhận', type: 'money', group: 'Tiền' },
  { ref: '{cogs_amount}', key: 'cogs_amount', label: 'Giá vốn', type: 'money', group: 'Tiền' },
  { ref: '{code}', key: 'code', label: 'Mã đơn', type: 'text', group: 'Thông tin' },
];
const FNS = [
  { name: 'IF', signature: 'IF(điều_kiện, đúng, sai)', description: 'Chọn một', example: 'IF(1,2,3)' },
  { name: 'ROUND', signature: 'ROUND(số, số_lẻ)', description: 'Làm tròn', example: 'ROUND(1.5)' },
];

describe('findTrigger / lọc', () => {
  it('nhận ra đang gõ biến hoặc hàm', () => {
    expect(findTrigger('{net - 1', 4)).toEqual({ kind: 'var', query: 'net', start: 0 });
    expect(findTrigger('1 + RO', 6)).toEqual({ kind: 'fn', query: 'RO', start: 4 });
    expect(findTrigger('{a} + ', 6)).toBeNull();
    expect(findTrigger('"abc RO', 7)).toBeNull();
    expect(findTrigger('{custom.na', 10).query).toBe('custom.na');
  });
  it('lọc biến theo khoá và nhãn không phân biệt dấu', () => {
    expect(filterVariables(VARS, 'gia von').map((v) => v.key)).toEqual(['cogs_amount']);
    expect(filterVariables(VARS, 'NET').map((v) => v.key)).toEqual(['net_amount']);
    expect(filterVariables(VARS, '')).toHaveLength(3);
    expect(filterFunctions(FNS, 'ro').map((f) => f.name)).toEqual(['ROUND']);
  });
});

function Host({ initial = '' }) {
  const [v, setV] = useState(initial);
  return <FormulaEditor entity="order" shopId="shp_1" value={v} onChange={setV} />;
}

describe('FormulaEditor', () => {
  beforeEach(() => {
    api.get.mockImplementation(async (p) => ({ data: p === '/custom/functions' ? FNS : VARS }));
    api.post.mockResolvedValue({ data: { value: 120000, sample: { id: 'o1', label: 'DH-001' } } });
  });

  const type = (el, value) => { el.focus(); fireEvent.change(el, { target: { value, selectionStart: value.length, selectionEnd: value.length } }); };

  it('gõ { mở danh sách, lọc khi gõ, Enter chèn biến', async () => {
    render(<Host />);
    const ta = screen.getByRole('combobox');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/custom/variables', { entity_type: 'order', shop_id: 'shp_1' }));
    type(ta, '{');
    expect((await screen.findAllByRole('option')).length).toBe(3);
    type(ta, '{gia');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option').textContent).toContain('Giá vốn');
    fireEvent.keyDown(ta, { key: 'Enter' });
    await waitFor(() => expect(ta.value).toBe('{cogs_amount}'));
  });

  it('mũi tên chọn mục khác, Esc đóng danh sách', async () => {
    render(<Host />);
    const ta = screen.getByRole('combobox');
    type(ta, '{');
    await screen.findAllByRole('option');
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(ta, { key: 'Tab' });
    await waitFor(() => expect(ta.value).toBe('{cogs_amount}'));
    type(ta, '{');
    await screen.findAllByRole('option');
    fireEvent.keyDown(ta, { key: 'Escape' });
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
  });

  it('gõ chữ cái gợi ý hàm kèm cú pháp, chèn kèm ngoặc', async () => {
    render(<Host initial="1 + " />);
    const ta = screen.getByRole('combobox');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/custom/functions'));
    await screen.findByRole('combobox');
    type(ta, '1 + RO');
    const opt = await screen.findByRole('option');
    expect(opt.textContent).toContain('ROUND(số, số_lẻ)');
    fireEvent.click(opt);
    await waitFor(() => expect(ta.value).toBe('1 + ROUND()'));
  });

  it('bấm biến ở bảng Biến thì chèn vào công thức', async () => {
    render(<Host initial="1 + " />);
    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: 'Biến' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Giá vốn' }));
    await waitFor(() => expect(screen.getByRole('combobox').value).toContain('{cogs_amount}'));
  });

  it('xem trước sau 400ms và báo lỗi kèm vị trí', async () => {
    render(<Host />);
    const ta = screen.getByRole('combobox');
    type(ta, '{net_amount} - {cogs_amount}');
    expect(await screen.findByTestId('formula-result', {}, { timeout: 2000 })).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/custom/formula/preview', expect.objectContaining({ entity_type: 'order', shop_id: 'shp_1', formula: '{net_amount} - {cogs_amount}' }));
    expect(screen.getByTestId('formula-result').textContent).toBe('120.000');
    api.post.mockResolvedValue({ data: { error: { message: 'Biến {abc} không dùng được', position: 6 } } });
    type(ta, '{net_amount} + {abc}');
    const alert = await screen.findByRole('alert', {}, { timeout: 2000 });
    expect(alert.textContent).toContain('Biến {abc} không dùng được');
    expect(alert.textContent).toContain('ký tự thứ 7');
  });

  it('kết quả trống thì nói rõ lý do ngay cạnh', async () => {
    api.post.mockResolvedValue({ data: { value: null, reason: 'Khách chưa có Ngày sinh', sample: { id: 'c1', label: 'Anh Tài' } } });
    render(<Host />);
    type(screen.getByRole('combobox'), 'AGE({birth_date})');
    expect((await screen.findByTestId('formula-reason', {}, { timeout: 2000 })).textContent).toContain('Khách chưa có Ngày sinh');
    expect(screen.getByTestId('formula-result').textContent).toBe('trống');
  });

  it('khách chưa chọn shop: nhắc chọn shop, không gọi API biến', async () => {
    api.get.mockClear();
    render(<FormulaEditor entity="customer" value="" onChange={() => {}} />);
    expect(screen.getByText(/Chọn một shop trước/)).toBeTruthy();
    expect(api.get).not.toHaveBeenCalledWith('/custom/variables', expect.anything());
  });

  it('mẫu chỉ hiện khi mọi biến của mẫu tồn tại', async () => {
    render(<Host />);
    expect(await screen.findByRole('button', { name: 'Lãi của đơn' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Còn phải thu' })).toBeNull(); // thiếu total_amount/paid_amount
  });
});
