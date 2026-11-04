import { describe, it, expect } from 'vitest';
import { vnd, num } from '../lib.js';

describe('định dạng tiền', () => {
  const plain = (s) => s.replace(/\s/g, ' ');
  it('số 0 hiện 0 ₫, không bao giờ -0', () => {
    expect(plain(vnd(0))).toBe('0 ₫');
    expect(plain(vnd(-0))).toBe('0 ₫');
    expect(plain(vnd(-0.4))).toBe('0 ₫');
    expect(num(-0)).toBe('0');
  });
  it('số âm giữ dấu trừ, rỗng là gạch ngang', () => {
    expect(plain(vnd(-1250000))).toBe('-1.250.000 ₫');
    expect(plain(vnd(1250000))).toBe('1.250.000 ₫');
    expect(vnd(null)).toBe('—');
  });
});
