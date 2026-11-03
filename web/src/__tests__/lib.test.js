import { describe, it, expect } from 'vitest';
import { vnd, pct, addDays, fmtDate, lunarInfo } from '../lib.js';

describe('định dạng', () => {
  it('tiền VND dùng dấu chấm và ký hiệu đồng, làm tròn về đồng', () => {
    expect(vnd(1250000)).toBe('1.250.000 ₫');
    expect(vnd(0)).toBe('0 ₫');
    expect(vnd(1999.6)).toBe('2.000 ₫');
    expect(vnd(null)).toBe('—');
  });
  it('phần trăm dùng dấu phẩy', () => {
    expect(pct(64.1)).toBe('64,1%');
    expect(pct(null)).toBe('—');
  });
  it('cộng ngày qua ranh giới tháng/năm', () => {
    expect(addDays('2026-11-03', -3)).toBe('2026-10-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
  it('ngày hiển thị dd/mm/yyyy', () => {
    expect(fmtDate('2026-11-03')).toBe('03/11/2026');
    expect(fmtDate(null)).toBe('—');
  });
});

describe('âm lịch và can chi', () => {
  it('1/1/2000 là 25/11 năm Kỷ Mão, ngày Mậu Ngọ', () => {
    const l = lunarInfo('2000-01-01');
    expect([l.day, l.month, l.yearCanChi, l.dayCanChi]).toEqual([25, 11, 'Kỷ Mão', 'Mậu Ngọ']);
  });
  it('10/2/2024 là mùng 1 Tết Giáp Thìn, ngày Giáp Thìn, năm mệnh Hoả', () => {
    const l = lunarInfo('2024-02-10');
    expect([l.day, l.month, l.yearCanChi, l.dayCanChi, l.yearElement]).toEqual([1, 1, 'Giáp Thìn', 'Giáp Thìn', 'Hoả']);
  });
  it('người sinh trước Tết thuộc năm âm trước (20/1/1990 → Kỷ Tỵ)', () => {
    expect(lunarInfo('1990-01-20').yearCanChi).toBe('Kỷ Tỵ');
  });
});
