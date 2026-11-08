import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDate } from '../lib.js';

const SEV = { critical: 'h-red', warning: 'h-yellow', info: '' };

/** Chuông thông báo ở thanh trên: số chưa đọc, danh sách gần đây, đánh dấu đã đọc. Hỏi lại máy chủ mỗi phút. */
export default function NotificationBell() {
  const [data, setData] = useState({ data: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const load = useCallback(() => api.get('/notifications', { limit: 15 }).then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const markAll = async () => { await api.post('/notifications/read', { all: true }); load(); };
  const markOne = async (id) => { await api.post('/notifications/read', { ids: [id] }); load(); };
  return (
    <div className="bell" ref={box}>
      <button type="button" className="btn sm bell-btn" aria-label={`Thông báo${data.unread ? `, ${data.unread} chưa đọc` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0" /></svg>
        {data.unread > 0 && <span className="bell-dot">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label="Thông báo">
          <div className="row between bell-head"><b>Thông báo</b>{data.unread > 0 && <button type="button" className="btn sm" onClick={markAll}>Đánh dấu đã đọc</button>}</div>
          {!data.data.length ? <div className="muted small bell-empty">Chưa có thông báo. Cài đặt loại thông báo ở Cài đặt → Thông báo.</div> : data.data.map((n) => (
            <div key={n.id} className={`bell-item${n.read_at ? '' : ' unread'}`}>
              <div className={`small ${SEV[n.severity]}`}><b>{n.title}</b></div>
              {n.body && <div className="small muted">{n.body}</div>}
              <div className="row between small muted"><span>{fmtDate(n.created_at)}</span>
                <span className="row">{n.link && <Link to={n.link} onClick={() => { setOpen(false); if (!n.read_at) markOne(n.id); }}>Mở</Link>}{!n.read_at && <button type="button" className="btn sm" onClick={() => markOne(n.id)}>Đã đọc</button>}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
