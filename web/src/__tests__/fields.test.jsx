import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FieldInput, { fieldText, slugify } from '../components/FieldInput.jsx';

describe('slugify: khoá trường từ tên tiếng Việt', () => {
  it.each([
    ['Ngân sách mỗi lần', 'ngan_sach_moi_lan'],
    ['Đơn vị / Địa chỉ', 'don_vi_dia_chi'],
    ['  Mệnh (tự tính)  ', 'menh_tu_tinh'],
    ['2 loại hương', 'f_2_loai_huong'],
  ])('%s → %s', (input, out) => expect(slugify(input)).toBe(out));
});

describe('fieldText', () => {
  it('hiển thị theo kiểu', () => {
    expect(fieldText({ type: 'money' }, 500000)).toBe('500.000 ₫');
    expect(fieldText({ type: 'date' }, '1988-03-12')).toBe('12/03/1988');
    expect(fieldText({ type: 'multiselect' }, ['Gỗ', 'Biển'])).toBe('Gỗ, Biển');
    expect(fieldText({ type: 'boolean' }, false)).toBe('Không');
    expect(fieldText({ type: 'text' }, null)).toBe('—');
    expect(fieldText({ type: 'formula' }, 1234567.456)).toBe('1.234.567,46');
    expect(fieldText({ type: 'number' }, 42)).toBe('42');
  });
});

describe('FieldInput', () => {
  it('số: trả về số, ô trống trả null', () => {
    const onChange = vi.fn();
    const field = { type: 'money', label: 'Ngân sách' };
    const { rerender } = render(<FieldInput field={field} value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '15000' } });
    expect(onChange).toHaveBeenLastCalledWith(15000);
    // ô được điều khiển từ ngoài: cha cập nhật giá trị rồi người dùng xoá trắng
    rerender(<FieldInput field={field} value={15000} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('chọn một: chỉ hiện các lựa chọn của trường', () => {
    const onChange = vi.fn();
    render(<FieldInput field={{ type: 'select', label: 'Mua cho', options: ['Xe cá nhân', 'Quà tặng'] }} value="Quà tặng" onChange={onChange} />);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['—', 'Xe cá nhân', 'Quà tặng']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Xe cá nhân' } });
    expect(onChange).toHaveBeenCalledWith('Xe cá nhân');
  });

  it('chọn nhiều: bật/tắt từng lựa chọn, bỏ hết trả null', () => {
    const onChange = vi.fn();
    const field = { type: 'multiselect', label: 'Hương', options: ['Gỗ', 'Biển', 'Ngọt'] };
    const { rerender } = render(<FieldInput field={field} value={['Gỗ']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Biển' }));
    expect(onChange).toHaveBeenLastCalledWith(['Gỗ', 'Biển']);
    fireEvent.click(screen.getByRole('button', { name: 'Gỗ' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    rerender(<FieldInput field={field} value={['Gỗ']} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Gỗ' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('công thức chỉ đọc: không có ô nhập', () => {
    render(<FieldInput field={{ type: 'formula', label: 'LN' }} value={288000} onChange={() => {}} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.getByText('288.000')).toBeTruthy();
  });
});
