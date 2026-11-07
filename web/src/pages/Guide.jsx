import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/ui.jsx';
import { GUIDES, GROUPS, byId, searchText } from '../guides/content.js';
import HealthGuide from './guide/HealthGuide.jsx';

const slugOf = (g) => g.id;
const INDEX = GUIDES.map((g) => ({ g, text: searchText(g) }));

function Blocks({ guide }) {
  return (
    <>
      {guide.blocks.map((b, i) => {
        if (b.t === 'p') return <p key={i} className="guide-p">{b.text}</p>;
        if (b.t === 'steps') return (
          <ol key={i} className="guide-steps">
            {b.items.map((s) => (
              <li key={s.title}>
                <div className="guide-step-title">{s.title}</div>
                <div className="guide-step-text">{s.text}</div>
                {s.to && <Link className="btn sm" to={s.to}>{s.cta || 'Mở trang'}</Link>}
              </li>
            ))}
          </ol>
        );
        if (b.t === 'tips') return (
          <div key={i} className="guide-box tip"><div className="guide-box-title">Mẹo</div><ul>{b.items.map((t) => <li key={t}>{t}</li>)}</ul></div>
        );
        if (b.t === 'warn') return <div key={i} className="guide-box warn"><div className="guide-box-title">Lưu ý</div><p>{b.text}</p></div>;
        if (b.t === 'faq') return (
          <div key={i} className="guide-faq">
            <div className="guide-box-title">Hay gặp</div>
            {b.items.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        );
        return null;
      })}
      {guide.links?.length > 0 && <div className="row wrap">{guide.links.map(([to, label]) => <Link key={to} className="btn" to={to}>{label}</Link>)}</div>}
    </>
  );
}

/**
 * Trang Hướng dẫn hệ thống: mục lục theo nhóm, mỗi hướng dẫn một trang. “Cách đọc sức khoẻ kinh doanh” là một hướng dẫn trong đó (có số liệu thật).
 * Điện thoại: /guide là mục lục, bấm vào mới mở bài. Máy tính: mục lục luôn ở bên trái.
 */
export default function Guide() {
  const { id } = useParams();
  const [q, setQ] = useState('');
  const guide = id ? byId(id) : null;
  const term = q.trim().toLowerCase();
  const hits = useMemo(() => (term ? INDEX.filter((x) => x.text.includes(term)).map((x) => x.g) : GUIDES), [term]);
  const idx = guide ? GUIDES.indexOf(guide) : -1;
  const prev = idx > 0 ? GUIDES[idx - 1] : null;
  const next = idx >= 0 && idx < GUIDES.length - 1 ? GUIDES[idx + 1] : null;

  const list = (
    <nav className="guide-nav" aria-label="Mục lục hướng dẫn">
      <input className="guide-search" type="search" placeholder="Tìm hướng dẫn…" aria-label="Tìm hướng dẫn" value={q} onChange={(e) => setQ(e.target.value)} />
      {!hits.length && <p className="note">Không có hướng dẫn nào khớp “{q}”.</p>}
      {GROUPS.map((grp) => {
        const items = hits.filter((g) => g.group === grp);
        if (!items.length) return null;
        return (
          <div key={grp} className="guide-group">
            <div className="guide-group-name">{grp}</div>
            {items.map((g) => (
              <Link key={g.id} to={`/guide/${slugOf(g)}`} className={`guide-link${guide?.id === g.id ? ' on' : ''}`} aria-current={guide?.id === g.id ? 'page' : undefined}>
                <span className="guide-link-title">{g.title}</span>
                <span className="guide-link-sum">{g.summary}</span>
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );

  if (id && !guide) return <Navigate to="/guide" replace />;

  return (
    <div className="page stack">
      <PageHeader title="Hướng dẫn" sub={guide ? undefined : 'Cách dùng từng phần của Mở Sổ, viết theo đúng tên nút và tab bạn đang thấy. Chọn một bài để bắt đầu.'} />
      <div className={`guide-layout${guide ? ' reading' : ''}`}>
        <aside className="guide-side">{list}</aside>
        <article className="guide-main">
          {!guide ? (
            <div className="guide-start">
              <div className="guide-box tip">
                <div className="guide-box-title">Mới dùng lần đầu?</div>
                <p>Đọc theo thứ tự: <Link to="/guide/bat-dau">Bắt đầu nhanh</Link> → <Link to="/guide/tao-don">Tạo đơn</Link> → <Link to="/guide/nhap-hang">Nhập hàng</Link> → <Link to="/guide/suc-khoe-kinh-doanh">Cách đọc sức khoẻ kinh doanh</Link>.</p>
              </div>
            </div>
          ) : (
            <>
              <Link to="/guide" className="guide-back">← Tất cả hướng dẫn</Link>
              <header className="guide-head">
                <div className="guide-kicker">{guide.group}{guide.time ? ` · ${guide.time}` : ''}</div>
                <h2>{guide.title}</h2>
                <p className="guide-summary">{guide.summary}</p>
              </header>
              {guide.special === 'health' ? <HealthGuide /> : <Blocks guide={guide} />}
              <footer className="guide-foot">
                {prev ? <Link to={`/guide/${prev.id}`} className="guide-pn"><small>Trước</small>{prev.title}</Link> : <span />}
                {next ? <Link to={`/guide/${next.id}`} className="guide-pn next"><small>Tiếp</small>{next.title}</Link> : <span />}
              </footer>
            </>
          )}
        </article>
      </div>
    </div>
  );
}
