import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { METRICS, SCOPES, TIME_LABEL } from '../metrics.js';

/** Bộ lọc đang xem ({ from, to, channel, today }), để link "Xem dữ liệu gốc" mở đúng khoảng ngày */
export const MetricFilters = createContext({});

/** Nhãn nhỏ cho chỉ số có phạm vi khác bộ lọc (hoặc tính đến hôm nay) */
export function ScopeBadge({ metric }) {
  const m = METRICS[metric];
  if (!m || (m.scope === 'filter' && m.time !== 'today')) return null;
  const parts = [m.scope !== 'filter' ? SCOPES[m.scope] : null, m.time === 'today' ? TIME_LABEL.today : null].filter(Boolean);
  return <span className="scope-badge" title={parts.join(' · ')}>{parts.join(' · ')}</span>;
}

/** Nút ⓘ mở khung giải thích: nghĩa, cách tính, lấy từ đâu, phạm vi, nên làm gì, link tới dữ liệu gốc */
export default function MetricInfo({ metric }) {
  const m = METRICS[metric];
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const id = useId();
  const filters = useContext(MetricFilters);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => root.current && !root.current.contains(e.target) && setOpen(false);
    const esc = (e) => { if (e.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!m) return null;
  const link = m.drill ? m.drill(filters) : null;
  return (
    <span className="metric-info" ref={root}>
      <button type="button" className="metric-btn" aria-label={`Giải thích: ${m.name}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>ⓘ</button>
      {open && (
        <div className="metric-pop" id={id} role="dialog" aria-label={m.name}>
          <div className="row between"><b>{m.name}</b><button type="button" className="metric-close" aria-label="Đóng" onClick={() => setOpen(false)}>✕</button></div>
          <div className="small"><b>Là gì: </b>{m.what}</div>
          <div className="small"><b>Cách tính: </b>{m.formula}</div>
          <div className="small"><b>Lấy từ đâu: </b>{m.source}</div>
          <div className="small"><b>Phạm vi: </b><span className="scope-badge">{SCOPES[m.scope]}</span>{m.time === 'today' && <span className="scope-badge">{TIME_LABEL.today}</span>}</div>
          <div className="small"><b>Nên làm: </b>{m.tip}</div>
          {link && <div className="small"><Link to={link}>Xem dữ liệu gốc</Link>{m.drillNote && <span className="muted"> · {m.drillNote}</span>}</div>}
        </div>
      )}
    </span>
  );
}

/** Nhãn kèm ⓘ cho tiêu đề cột bảng và dòng sổ cái */
export const MetricLabel = ({ metric, children }) => <span className="metric-label">{children}{metric && <MetricInfo metric={metric} />}</span>;
