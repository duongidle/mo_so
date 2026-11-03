// Họa tiết nét mảnh, vẽ bằng SVG. Dùng tiết chế: mỗi màn hình tối đa vài điểm nhấn.
// Nguồn cảm hứng: la bàn bát quái (phong thuỷ), trống đồng Đông Sơn (Việt), lôi văn (đường diềm).

const HAN = { Kim: '金', Mộc: '木', Thuỷ: '水', Hoả: '火', Thổ: '土' };
const SLUG = { Kim: 'kim', Mộc: 'moc', Thuỷ: 'thuy', Hoả: 'hoa', Thổ: 'tho' };
export const ELEMENT_ORDER = ['Kim', 'Mộc', 'Thuỷ', 'Hoả', 'Thổ'];

/** Ký hiệu ngũ hành: chữ Hán trong khung tròn, tên Việt bên cạnh. Là dữ liệu thật (mệnh khách, hành sản phẩm). */
export function Element({ name, label = true, size = 'md' }) {
  if (!name) return <span className="muted">—</span>;
  return (
    <span className={`el el-${SLUG[name]} el-${size}`} title={`Hành ${name}`}>
      <span className="han" aria-hidden="true">{HAN[name]}</span>
      {label && <span className="el-name">{name}</span>}
    </span>
  );
}

// Hậu Thiên bát quái theo hướng từ Bắc theo chiều kim đồng hồ; mỗi quẻ liệt kê 3 hào từ dưới (gần tâm) lên trên: 1 = liền, 0 = đứt
const TRIGRAMS = [[0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 1, 1], [1, 0, 1], [0, 0, 0], [1, 1, 0], [1, 1, 1]];

/** La bàn bát quái: các vòng đồng tâm, 24 vạch hướng, 8 quẻ. Chỉ nét mảnh, màu theo currentColor. */
export function Compass({ size = 280, className = '' }) {
  const ticks = Array.from({ length: 24 }, (_, i) => i * 15);
  return (
    <svg className={className} width={size} height={size} viewBox="-100 -100 200 200" fill="none" stroke="currentColor" strokeWidth="0.8" aria-hidden="true">
      <circle r="98" /><circle r="92" /><circle r="62" /><circle r="44" /><circle r="14" />
      {ticks.map((a) => <line key={a} y1="-92" y2={a % 45 === 0 ? -83 : -87} transform={`rotate(${a})`} />)}
      {TRIGRAMS.map((t, i) => (
        <g key={i} transform={`rotate(${i * 45}) translate(0 -77)`} strokeWidth="1.6" strokeLinecap="butt">
          {t.map((solid, j) => {
            const y = 5 - j * 5; // hào dưới ở y dương (gần tâm)
            return solid ? <line key={j} x1="-7" x2="7" y1={y} y2={y} /> : <g key={j}><line x1="-7" x2="-1.6" y1={y} y2={y} /><line x1="1.6" x2="7" y1={y} y2={y} /></g>;
          })}
        </g>
      ))}
      <path d="M0 -44 L5 0 L0 44 L-5 0 Z" strokeWidth="0.8" /><path d="M-44 0 L0 5 L44 0 L0 -5 Z" strokeWidth="0.8" />
    </svg>
  );
}

/** Mặt trống đồng giản lược: ngôi sao nhiều cánh ở tâm, các vòng tròn, vành răng cưa. */
export function Dongson({ size = 120, className = '' }) {
  const rays = Array.from({ length: 14 }, (_, i) => i * (360 / 14));
  const teeth = Array.from({ length: 48 }, (_, i) => i * 7.5);
  return (
    <svg className={className} width={size} height={size} viewBox="-100 -100 200 200" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <circle r="96" /><circle r="70" /><circle r="52" /><circle r="30" />
      {teeth.map((a) => <line key={a} y1="-96" y2="-88" transform={`rotate(${a})`} />)}
      {rays.map((a) => <path key={a} d="M0 -30 L5 -12 L0 -4 L-5 -12 Z" transform={`rotate(${a})`} />)}
      <circle r="4" fill="currentColor" />
    </svg>
  );
}

/** Dấu triện vuông: chữ khắc ngược sáng trên nền oxblood, hơi lệch như đóng tay. */
export function Seal({ children, size = 44 }) {
  return <span className="seal-sq" style={{ '--s': `${size}px` }} aria-hidden="true">{children}</span>;
}
