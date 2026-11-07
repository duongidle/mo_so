import { createContext, useContext } from 'react';
import { Link } from 'react-router-dom';
import { METRICS, SCOPES, TIME_LABEL } from '../metrics.js';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './ui/popover.jsx';

/** Bộ lọc đang xem ({ from, to, channel, today }), để link "Xem dữ liệu gốc" mở đúng khoảng ngày */
export const MetricFilters = createContext({});

const SCOPE_SHORT = { account: 'Toàn tài khoản', shop_plus_shared: 'Shop + chi phí chung', warehouse: 'Theo kho' };

/** Nhãn nhỏ cho chỉ số có phạm vi khác bộ lọc (hoặc tính đến hôm nay) */
export function ScopeBadge({ metric }) {
  const m = METRICS[metric];
  if (!m || (m.scope === 'filter' && m.time !== 'today')) return null;
  const full = [m.scope !== 'filter' ? SCOPES[m.scope] : null, m.time === 'today' ? TIME_LABEL.today : null].filter(Boolean).join(' · ');
  // Nhãn gọn để vừa một dòng trên thẻ chỉ số; bản đầy đủ nằm ở title và ở khung ⓘ. Phần "đến hôm nay" ẩn trên màn hẹp (CSS .scope-time).
  const scope = m.scope !== 'filter' ? SCOPE_SHORT[m.scope] || SCOPES[m.scope] : null;
  const time = m.time === 'today' ? 'đến hôm nay' : null;
  return <span className="scope-badge" title={full}>{scope}{time && (scope ? <span className="scope-time"> · {time}</span> : time)}</span>;
}

/** Nút ⓘ mở khung giải thích: nghĩa, cách tính, lấy từ đâu, phạm vi, nên làm gì, link tới dữ liệu gốc.
 *  Dựng trên shadcn/ui Popover (Radix): bám nút, tự lật khi sát mép, Esc/bấm ra ngoài để đóng, trả focus về nút. */
export default function MetricInfo({ metric }) {
  const m = METRICS[metric];
  const filters = useContext(MetricFilters);
  if (!m) return null;
  const link = m.drill ? m.drill(filters) : null;
  return (
    <span className="metric-info">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="metric-btn" aria-label={`Giải thích: ${m.name}`}>ⓘ</button>
        </PopoverTrigger>
        <PopoverContent role="dialog" aria-label={m.name}>
          <div className="row between"><b>{m.name}</b><PopoverClose asChild><button type="button" className="metric-close" aria-label="Đóng">✕</button></PopoverClose></div>
          <div className="small"><b>Là gì: </b>{m.what}</div>
          <div className="small"><b>Cách tính: </b>{m.formula}</div>
          <div className="small"><b>Lấy từ đâu: </b>{m.source}</div>
          <div className="small"><b>Phạm vi: </b><span className="scope-badge">{SCOPES[m.scope]}</span>{m.time === 'today' && <span className="scope-badge">{TIME_LABEL.today}</span>}</div>
          <div className="small"><b>Nên làm: </b>{m.tip}</div>
          {link && <div className="small"><Link to={link}>Xem dữ liệu gốc</Link>{m.drillNote && <span className="muted"> · {m.drillNote}</span>}</div>}
        </PopoverContent>
      </Popover>
    </span>
  );
}

/** Nhãn kèm ⓘ cho tiêu đề cột bảng và dòng sổ cái */
export const MetricLabel = ({ metric, children }) => <span className="metric-label">{children}{metric && <MetricInfo metric={metric} />}</span>;
