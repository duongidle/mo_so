import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { formatMoneyInput, moneyToInt, parseMoneyInput } from '../lib/money.js';
import MoneyInput from '../components/MoneyInput.jsx';

describe('money lib', () => {
  it('định dạng có dấu chấm ngăn nghìn', () => {
    expect(formatMoneyInput(140000)).toBe('140.000');
    expect(formatMoneyInput('1250000')).toBe('1.250.000');
    expect(formatMoneyInput(0)).toBe('0');
    expect(formatMoneyInput('')).toBe('');
    expect(formatMoneyInput(null)).toBe('');
  });
  it('đọc chuỗi gõ vào thành chuỗi chữ số', () => {
    expect(parseMoneyInput('1.250.000 ₫')).toBe('1250000');
    expect(parseMoneyInput('abc')).toBe('');
    expect(parseMoneyInput('007')).toBe('7');
    expect(parseMoneyInput('-5.000')).toBe('5000');
    expect(parseMoneyInput('-5.000', { allowNegative: true })).toBe('-5000');
    expect(parseMoneyInput('-', { allowNegative: true })).toBe('-');
  });
  it('moneyToInt', () => {
    expect(moneyToInt('140000')).toBe(140000);
    expect(moneyToInt('')).toBeNull();
    expect(moneyToInt('-')).toBeNull();
    expect(moneyToInt('-300')).toBe(-300);
  });
});

describe('MoneyInput', () => {
  function Wrap({ init = '' }) {
    const [v, setV] = useState(init);
    return <><MoneyInput aria-label="tien" value={v} onChange={(e) => setV(e.target.value)} /><span data-testid="raw">{v}</span></>;
  }
  it('hiện dấu chấm khi gõ và giữ số nguyên', () => {
    render(<Wrap />);
    const input = screen.getByLabelText('tien');
    fireEvent.change(input, { target: { value: '1250000' } });
    expect(input.value).toBe('1.250.000');
    expect(screen.getByTestId('raw').textContent).toBe('1250000');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.style.textAlign).toBe('right');
  });
  it('bỏ ký tự không phải số', () => {
    render(<Wrap init={140000} />);
    const input = screen.getByLabelText('tien');
    expect(input.value).toBe('140.000');
    fireEvent.change(input, { target: { value: '140.000x' } });
    expect(input.value).toBe('140.000');
  });
});
