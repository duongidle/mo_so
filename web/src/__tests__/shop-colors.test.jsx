import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PRIMARY_PRESETS, BACKGROUND_PRESETS, BUTTON_TEXT, DEFAULT_PAPER, colorProblem, contrast, colorVars, applyColors } from '../lib/colors.js';
import ShopColors from '../components/ShopColors.jsx';

describe('màu giao diện của shop', () => {
  it('mọi màu có sẵn đều đủ tương phản (chữ trên nút và trên nền ≥ 4,5:1)', () => {
    for (const [hex] of PRIMARY_PRESETS) {
      expect(contrast(hex, BUTTON_TEXT), hex).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex, DEFAULT_PAPER), hex).toBeGreaterThanOrEqual(4.5);
      for (const [bg] of BACKGROUND_PRESETS) expect(colorProblem({ primary: hex, background: bg }), `${hex} trên ${bg}`).toBeNull();
    }
  });
  it('chặn màu chủ đạo nhạt và nền tối', () => {
    expect(colorProblem({ primary: '#f0c040' })).toMatch(/tương phản/);
    expect(colorProblem({ background: '#202020' })).toMatch(/quá tối/);
    expect(colorProblem({})).toBeNull();
  });
  it('colorVars/applyColors đặt và gỡ biến CSS; rỗng thì về màu chủ đề', () => {
    expect(colorVars(null)).toEqual({});
    applyColors({ primary: '#7a2e4a', background: '#f8f2f0' });
    expect(document.documentElement.style.getPropertyValue('--seal')).toBe('#7a2e4a');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#f8f2f0');
    applyColors(null);
    expect(document.documentElement.style.getPropertyValue('--seal')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
  });
  it('ShopColors: chọn màu, hiện cảnh báo, nút "Về màu mặc định" trả null', () => {
    let v = null;
    const { rerender } = render(<ShopColors value={v} onChange={(x) => { v = x; }} themeName="Bán lẻ chung" />);
    expect(screen.getByText(/màu mặc định của chủ đề/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Về màu mặc định' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Đỏ tía' }));
    expect(v).toEqual({ primary: '#7a2e4a' });
    rerender(<ShopColors value={v} onChange={(x) => { v = x; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Về màu mặc định' }));
    expect(v).toBeNull();
    rerender(<ShopColors value={{ primary: '#f0c040' }} onChange={() => {}} />);
    expect(screen.getByRole('alert').textContent).toMatch(/tương phản/);
  });
});
