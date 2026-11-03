import { useEffect, useState, useCallback, useRef } from 'react';
import { STATUS, vnd } from '../lib.js';

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
export const Empty = ({ children }) => <div className="empty">{children}</div>;

/** Hiện trạng thái tải/lỗi, rồi mới render nội dung */
export function Async({ state, children }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorBox error={state.error} />;
  return children(state.data);
}

export const Card = ({ title, actions, children, flat, className = '' }) => (
  <section className={`card ${flat ? 'flat' : ''} ${className}`}>
    {(title || actions) && (
      <div className="row between" style={{ marginBottom: 8, padding: flat ? '14px 14px 0' : 0 }}>
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

export function Kpi({ label, value, delta, hint, tone }) {
  return (
    <div className="card kpi">
      <span className="l">{label}</span>
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

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
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
