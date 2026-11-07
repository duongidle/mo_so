// Màu giao diện riêng của shop. Cùng quy tắc với server (server/modules/shops/service.js: normalizeColors).
const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

export const BUTTON_TEXT = '#ede3d2';
export const DEFAULT_PAPER = '#fdfcf9';

export const PRIMARY_PRESETS = [
  ['#633d37', 'Nâu đỏ'], ['#7a2e4a', 'Đỏ tía'], ['#a23a30', 'Đỏ'], ['#9c3d1a', 'Cam cháy'], ['#8a4e14', 'Hổ phách'],
  ['#42633f', 'Xanh lá'], ['#2f4f4f', 'Xanh đen'], ['#33566f', 'Xanh dương'], ['#6a4a70', 'Tím'],
];
export const BACKGROUND_PRESETS = [
  ['#f6f3ee', 'Kem nhạt'], ['#faf7f0', 'Kem sáng'], ['#f4f1ea', 'Be'], ['#f8f2f0', 'Hồng phấn'], ['#f7f0f4', 'Hồng nhạt'],
  ['#f0f2f1', 'Xám xanh'], ['#f1f4f8', 'Xanh nhạt'], ['#f2f5f0', 'Xanh lá nhạt'],
];

/** Lỗi (chuỗi) nếu màu không dùng được, null nếu ổn. Nền được tính theo màu nền đang chọn. */
export function colorProblem({ primary, background }) {
  if (background && luminance(background) < 0.75) return 'Màu nền quá tối, chữ sẽ khó đọc. Chọn màu sáng hơn.';
  if (primary) {
    const bg = background || DEFAULT_PAPER;
    const a = contrast(primary, BUTTON_TEXT);
    const b = contrast(primary, bg);
    if (a < 4.5 || b < 4.5) return `Màu chủ đạo chưa đủ tương phản (${Math.min(a, b).toFixed(1).replace('.', ',')}:1, cần ít nhất 4,5:1). Chọn màu đậm hơn.`;
  }
  return null;
}

/** Biến CSS để gắn lên <html>. Không có màu riêng thì trả rỗng và giao diện về màu của chủ đề. */
export function colorVars(c) {
  const v = {};
  if (c?.primary) { v['--oxblood'] = c.primary; v['--seal'] = c.primary; }
  if (c?.background) { v['--bg'] = c.background; v['--paper'] = `color-mix(in srgb, ${c.background} 35%, #ffffff)`; }
  return v;
}
const ALL = ['--oxblood', '--seal', '--bg', '--paper'];
export function applyColors(c, el = document.documentElement) {
  const v = colorVars(c);
  for (const k of ALL) { if (v[k]) el.style.setProperty(k, v[k]); else el.style.removeProperty(k); }
}
