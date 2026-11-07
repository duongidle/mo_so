import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { STATUS, vnd } from '../lib.js';
import Icon, { OpenBook } from './Icon.jsx';
import { Dongson, Ripple, Gauge } from './Motif.jsx';
import { useSession } from '../session.jsx';
import MetricInfo, { ScopeBadge } from './MetricInfo.jsx';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.jsx';

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(fn)
      .then((data) => id === seq.current && setState({ loading: false, data, error: null }))
      .catch((error) => id === seq.current && setState({ loading: false, data: null, error }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const Loading = () => <div className="empty">Đang tải…</div>;
export const ErrorBox = ({ error }) => (error ? <div className="alert err" role="alert">{error.message || String(error)}</div> : null);
/** Hình minh hoạ cho trạng thái trống theo giao diện của shop: trống đồng (phong thuỷ), vòng lan toả (nước hoa), cuốn sổ (chung) */
function EmptyArt() {
  const theme = useSession()?.theme;
  if (theme === 'phongthuy') return <Dongson className="empty-art" size={84} />;
  if (theme === 'nuochoa') return <Ripple className="empty-art" size={84} />;
  if (theme === 'oto') return <Gauge className="empty-art" size={84} />;
  return <OpenBook />;
}
export const Empty = ({ children, action }) => (
  <div className="empty"><EmptyArt /><div style={{ maxWidth: 420 }}>{children}</div>{action}</div>
);

/** Hiện trạng thái tải/lỗi, rồi mới render nội dung */
export function Async({ state, children }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorBox error={state.error} />;
  return children(state.data);
}

export const Card = ({ title, actions, children, flat, className = '' }) => (
  <section className={`card ${flat ? 'flat' : ''} ${className}`}>
    {(title || actions) && (
      <div className="card-head">
        {title && <h3>{title}</h3>}
        <div className="row">{actions}</div>
      </div>
    )}
    {children}
  </section>
);

export const Field = ({ label, children, hint }) => (
  <label className="field">
    <span>{label}</span>
    {children}
    {hint && <span className="small">{hint}</span>}
  </label>
);

export const StatusBadge = ({ status }) => <span className={`badge st-${status}`}>{STATUS[status] || status}</span>;

/** Tab dạng segmented gọn cho các mục của một trang. Mỗi mục: [giá trị, nhãn, số đếm (tuỳ chọn)] */
/** Nền trượt dưới tab/chip đang chọn: đo vị trí nút được chọn rồi đặt biến CSS cho khung. */
export function useSlider(dep) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const place = () => {
      const on = el.querySelector('[aria-selected=true], [aria-pressed=true]');
      if (!on) { el.style.setProperty('--ind-w', '0px'); return; }
      el.style.setProperty('--ind-x', `${on.offsetLeft}px`);
      el.style.setProperty('--ind-y', `${on.offsetTop}px`);
      el.style.setProperty('--ind-w', `${on.offsetWidth}px`);
      el.style.setProperty('--ind-h', `${on.offsetHeight}px`);
      if (!el.dataset.ready) requestAnimationFrame(() => { el.dataset.ready = '1'; });
    };
    place();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dep]);
  return ref;
}

export function Tabs({ options, value, onChange, wrap }) {
  const ref = useSlider(`${value}|${options.map((o) => `${o[1]}${o[2] ?? ''}`).join()}`);
  return (
    <div ref={ref} className={`tabs${wrap === 'lg' ? ' wrap-lg' : wrap ? ' wrap' : ''}`} role="tablist">
      {options.map(([v, label, count]) => (
        <button key={v} className="tab" role="tab" aria-selected={value === v} onClick={() => onChange(v)}>{label}{count !== undefined && count !== null && <span className="count">{count}</span>}</button>
      ))}
    </div>
  );
}

/** Đầu trang: tiêu đề, mô tả ngắn (tuỳ chọn), nút hành động bên phải. `deco` chỉ dùng ở Tổng quan (đường diềm theo ngành). */
export function PageHeader({ title, sub, actions, deco }) {
  return (
    <div className={`page-head${deco ? ' deco' : ''}`}>
      <div><h1>{title}</h1>{sub && <p className="sub muted small">{sub}</p>}</div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

/** Thanh công cụ một hàng: tab/segmented, ô tìm, bộ lọc, nút phụ. Tự xuống dòng gọn trên điện thoại. */
export const Toolbar = ({ children, className = '' }) => <div className={`toolbar ${className}`}>{children}</div>;

/** Một dòng chữ nhỏ muted dưới thanh công cụ: mỗi vùng chỉ một ghi chú */
export const Note = ({ children }) => (children ? <p className="note">{children}</p> : null);

/** Khối nội dung có tiêu đề nhỏ, đệm thống nhất. `flush` bỏ đệm (cho bảng). */
export function Section({ title, actions, children, flush, className = '', id }) {
  return (
    <section className={`section${flush ? ' flush' : ''} ${className}`} id={id}>
      {(title || actions) && <div className="section-head">{title && <h3>{title}</h3>}{actions && <div className="row">{actions}</div>}</div>}
      <div className="section-body">{children}</div>
    </section>
  );
}

/** Phần thu gọn cho tuỳ chọn ít dùng */
export function Fold({ title, children, open }) {
  return <details className="fold" open={open}><summary>{title}</summary><div className="stack">{children}</div></details>;
}

/** Thanh lưu dính đáy của form dạng trang */
export function SaveBar({ children, note }) {
  return <div className="save-bar no-print"><div className="save-bar-in">{note && <span className="small muted grow">{note}</span>}{children}</div></div>;
}

export const SearchBox = ({ value, onChange, placeholder, ...rest }) => (
  <div className="searchbox grow">
    <Icon name="search" />
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} {...rest} />
  </div>
);

export function Kpi({ label, value, delta, hint, tone, metric }) {
  return (
    <div className="card kpi">
      <span className="l">{label}{metric && <MetricInfo metric={metric} />}</span>
      {metric && <ScopeBadge metric={metric} />}
      <span className={`v ${tone ? `h-${tone}` : ''}`}>{value}</span>
      {delta !== undefined && delta !== null && (
        <span className={`d ${delta >= 0 ? 'h-green' : 'h-red'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toString().replace('.', ',')}% so với kỳ trước
        </span>
      )}
      {hint && <span className="d muted">{hint}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  // Dựng trên shadcn/ui Dialog (Radix): khoá focus, khoá cuộn nền, Esc/bấm ra ngoài để đóng.
  // Radix chỉ tự trả focus về DialogTrigger; app mở hộp thoại bằng nút thường nên tự nhớ nút đang focus lúc mở và trả lại khi đóng.
  const opener = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  const restoreFocus = (e) => { e.preventDefault(); const el = opener.current; if (el && el.isConnected && el !== document.body) el.focus(); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent wide={wide} aria-describedby={undefined} onCloseAutoFocus={restoreFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose asChild><button type="button" className="btn sm" aria-label="Đóng">✕</button></DialogClose>
        </DialogHeader>
        <div className="stack">{children}</div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

export function Chips({ options, value, onChange }) {
  const ref = useSlider(`${value}|${options.map((o) => `${o[1]}${o[2] ?? ''}`).join()}`);
  return (
    <div ref={ref} className="chips" role="tablist">
      {options.map(([v, label, count]) => (
        <button key={v} className={`chip ${value === v ? 'on' : ''}`} onClick={() => onChange(v)} role="tab" aria-selected={value === v}>
          {label}{count !== undefined && count !== null && <span className="count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

export const Money = ({ v, strong }) => <span className="num" style={strong ? { fontWeight: 600 } : undefined}>{vnd(v)}</span>;
export const Badge = ({ children, tone }) => <span className={`badge ${tone || 'plain'}`}>{children}</span>;

/** Nút chạy hành động bất đồng bộ, tự khoá khi đang chạy và hiện lỗi */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError(null) };
}

export function DateRange({ from, to, onChange }) {
  return (
    <div className="row wrap">
      <input type="date" value={from} onChange={(e) => onChange({ from: e.target.value, to })} style={{ width: 150 }} aria-label="Từ ngày" />
      <span className="muted">→</span>
      <input type="date" value={to} onChange={(e) => onChange({ from, to: e.target.value })} style={{ width: 150 }} aria-label="Đến ngày" />
    </div>
  );
}

export function LoadMore({ next, onMore }) {
  return next ? <div className="row" style={{ justifyContent: 'center', padding: 12 }}><button className="btn" onClick={onMore}>Xem thêm</button></div> : null;
}

/** Biểu đồ vùng nhỏ cho thẻ hero (nền tối). data: [{ value }] */
export function AreaChart({ data, color = 'var(--champagne)' }) {
  if (!data?.length) return null;
  const W = 600, H = 110, pad = 4;
  const max = Math.max(1, ...data.map((d) => d.value));
  const x = (i) => (data.length === 1 ? W / 2 : (i / (data.length - 1)) * W);
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  // đường gấp khúc thẳng: đường cong sẽ "phình" giữa các ngày doanh thu bằng 0 và làm người xem hiểu nhầm
  const pts = data.map((d, i) => [x(i), y(d.value)]);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Biểu đồ doanh thu theo ngày">
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={color} fillOpacity=".16" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="4" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Cột doanh thu theo ngày, có trục ngày đầu/cuối và gợi ý khi rê chuột */
export function Bars({ data, value = 'net_revenue' }) {
  const max = Math.max(1, ...data.map((d) => d[value]));
  return (
    <div>
      <div className="chart-bars" role="img" aria-label="Biểu đồ cột theo ngày">
        {data.map((d) => <i key={d.date} className={d[value] ? '' : 'zero'} title={`${d.date.split('-').reverse().join('/')}: ${vnd(d[value])}`} style={{ height: `${Math.max(3, (d[value] / max) * 100)}%` }} />)}
      </div>
      <div className="chart-axis"><span>{data[0]?.date.split('-').reverse().slice(0, 2).join('/')}</span><span>Cao nhất {vnd(max)}</span><span>{data[data.length - 1]?.date.split('-').reverse().slice(0, 2).join('/')}</span></div>
    </div>
  );
}

/** Thanh ngang so sánh các mục (kênh, shop…) */
export function HBars({ items, format = vnd }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return items.map((i) => (
    <div className="hbar" key={i.label}>
      <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.label}</span>
      <div className="track"><i style={{ width: `${(i.value / max) * 100}%` }} /></div>
      <b className="small num">{format(i.value)}</b>
    </div>
  ));
}
