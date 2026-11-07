import { PRIMARY_PRESETS, BACKGROUND_PRESETS, BUTTON_TEXT, DEFAULT_PAPER, colorProblem } from '../lib/colors.js';

const Swatches = ({ presets, value, onPick, label }) => (
  <div className="swatches" role="radiogroup" aria-label={label}>
    {presets.map(([hex, name]) => (
      <button key={hex} type="button" role="radio" aria-checked={value === hex} aria-label={name} title={name} className={`swatch${value === hex ? ' on' : ''}`} style={{ background: hex }} onClick={() => onPick(hex)} />
    ))}
  </div>
);

/**
 * Chỉnh màu giao diện riêng của một shop: màu chủ đạo (nút chính, liên kết, dấu nhấn) và màu nền trang.
 * value = { primary?, background? } hoặc null (dùng màu của chủ đề). Màu không đủ tương phản bị chặn ngay tại đây và ở máy chủ.
 */
export default function ShopColors({ value, onChange, themeName }) {
  const v = value || {};
  const problem = colorProblem(v);
  const set = (patch) => {
    const next = { ...v, ...patch };
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    onChange(Object.keys(next).length ? next : null);
  };
  const bg = v.background || null;
  const paper = bg ? `color-mix(in srgb, ${bg} 35%, #ffffff)` : DEFAULT_PAPER;
  return (
    <div className="shop-colors stack" style={{ gap: 16 }}>
      <div className="shop-colors-head">
        <div>
          <div style={{ fontWeight: 600 }}>Màu giao diện của shop</div>
          <div className="small muted">{value ? 'Đang dùng màu riêng.' : `Đang dùng màu mặc định của chủ đề${themeName ? ` “${themeName}”` : ''}.`} Chỉ áp dụng khi bạn đang làm việc ở shop này.</div>
        </div>
        <button type="button" className="btn sm" disabled={!value} onClick={() => onChange(null)}>Về màu mặc định</button>
      </div>

      <div className="color-row">
        <div className="color-label">Màu chủ đạo<span className="small muted">Nút chính, liên kết, dấu nhấn</span></div>
        <Swatches presets={PRIMARY_PRESETS} value={v.primary} onPick={(hex) => set({ primary: hex })} label="Màu chủ đạo" />
        <label className="color-custom"><input type="color" value={v.primary || '#633d37'} onChange={(e) => set({ primary: e.target.value })} aria-label="Chọn màu chủ đạo khác" /><span className="small muted">Màu khác</span></label>
      </div>
      <div className="color-row">
        <div className="color-label">Màu nền<span className="small muted">Nền trang; thẻ sáng hơn một chút</span></div>
        <Swatches presets={BACKGROUND_PRESETS} value={v.background} onPick={(hex) => set({ background: hex })} label="Màu nền" />
        <label className="color-custom"><input type="color" value={v.background || '#f6f3ee'} onChange={(e) => set({ background: e.target.value })} aria-label="Chọn màu nền khác" /><span className="small muted">Màu khác</span></label>
      </div>

      {problem && <div className="alert warn small" role="alert">{problem}</div>}

      <div className="color-preview" style={{ background: bg || 'var(--bg)' }} aria-label="Xem trước">
        <div className="color-preview-card" style={{ background: paper }}>
          <div className="small muted">Xem trước</div>
          <div style={{ fontWeight: 600 }}>Đơn DH-261108-001</div>
          <div className="row">
            <span className="color-preview-btn" style={{ background: v.primary || 'var(--seal)', color: BUTTON_TEXT }}>Bán xong</span>
            <span style={{ color: v.primary || 'var(--oxblood)', fontWeight: 500 }}>Xem chi tiết</span>
          </div>
        </div>
      </div>
    </div>
  );
}
