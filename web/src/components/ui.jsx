import { useEffect, useState, useCallback, useRef } from 'react';
import { STATUS, vnd } from '../lib.js';
import Icon, { OpenBook } from './Icon.jsx';
import { Dongson, Ripple, Gauge } from './Motif.jsx';
import { useSession } from '../session.jsx';
import MetricInfo, { ScopeBadge } from './MetricInfo.jsx';

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

/** Tab gạch chân cho các mục lớn của một trang */
export function Tabs({ options, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} className="tab" role="tab" aria-selected={value === v} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export const SearchBox = ({ value, onChange, placeholder, ...rest }) => (
  <div className="searchbox grow" style={{ minWidth: 220 }}>
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
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2>{title}</h2>
          <button className="btn sm" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="stack">{children}</div>
        {footer && <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="chips" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} className={`chip ${value === v ? 'on' : ''}`} onClick={() => onChange(v)} role="tab" aria-selected={value === v}>
          {label}
        </button>
      ))}
    </div>
  );
}

export const Money = ({ v, strong }) => <span className="num" style={strong ? { fontWeight: 600 } : undefined}>{vnd(v)}</span>;

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
