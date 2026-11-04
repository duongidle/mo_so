import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';
import { Field, ErrorBox, useAction, useDebounced } from './ui.jsx';
import Icon from './Icon.jsx';
import { vnd, fmtDate } from '../lib.js';

const digits = (s) => String(s || '').replace(/\D/g, '');

/**
 * Chọn khách cho đơn. Luôn trả về khách ĐÃ CÓ id (khách mới được tạo trước rồi mới chọn) nên đơn không bao giờ tự sinh hồ sơ trùng.
 * value: khách đang chọn (đối tượng có id) hoặc null. onChange(khách | null).
 * subtotal + onApplyDiscount: hiện nút áp % giảm giá theo hạng. compact: bản gọn cho POS.
 */
export default function CustomerPicker({ shopId, value, onChange, compact = false, subtotal = 0, onApplyDiscount }) {
  const listId = useId();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState([]);
  const [other, setOther] = useState([]);
  const [tiers, setTiers] = useState({});
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState('search'); // search | new
  const [tier, setTier] = useState(null);
  const wrap = useRef(null);

  // Tìm: khách của shop trước, rồi "khách ở shop khác" (hồ sơ chung, chọn thì tự vào danh sách shop khi lưu đơn)
  useEffect(() => {
    if (value || mode !== 'search' || !open) return undefined;
    let off = false;
    const params = { q: dq || undefined, limit: 8 };
    (async () => {
      try {
        const a = shopId ? await api.get('/customers', { ...params, shop_id: shopId }) : { data: [] };
        const inShop = a.data || [];
        let rest = [];
        if (dq) {
          const b = await api.get('/customers', params);
          const have = new Set(inShop.map((c) => c.id));
          rest = (b.data || []).filter((c) => !have.has(c.id));
        } else if (!shopId) rest = (await api.get('/customers', params)).data || [];
        if (off) return;
        setMine(inShop);
        setOther(rest);
        setActive(0);
        inShop.forEach((c) => {
          api.get(`/loyalty/customers/${c.id}`).then((l) => !off && setTiers((t) => ({ ...t, [c.id]: l.data?.tier }))).catch(() => {});
        });
      } catch {
        if (!off) { setMine([]); setOther([]); }
      }
    })();
    return () => { off = true; };
  }, [dq, shopId, value, mode, open]);

  // Hạng + % giảm gợi ý của khách đã chọn
  useEffect(() => {
    setTier(null);
    if (!value?.id) return undefined;
    let off = false;
    api.get(`/loyalty/customers/${value.id}`).then((l) => !off && setTier(l.data?.tier || null)).catch(() => {});
    return () => { off = true; };
  }, [value?.id]);

  // Bấm ra ngoài thì đóng danh sách
  useEffect(() => {
    const h = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const rows = [...mine.map((c) => ({ c, elsewhere: false })), ...other.map((c) => ({ c, elsewhere: true }))];
  const choose = (c) => { onChange(c); setQ(''); setOpen(false); setMode('search'); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && open && rows[active]) { e.preventDefault(); choose(rows[active].c); }
    else if (e.key === 'Escape') setOpen(false);
  };

  if (value) {
    const suggested = tier && tier.discount_pct > 0 ? Math.round((subtotal * tier.discount_pct) / 100) : 0;
    return (
      <div className={`cust-card ${compact ? 'compact' : ''}`}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="cust-name"><b>{value.name}</b>{tier && <span className="badge plain">{tier.name}</span>}</div>
            <div className="small muted">{[value.phone, value.code].filter(Boolean).join(' · ') || 'Chưa có SĐT'}</div>
            {!compact && value.address && <div className="small" style={{ marginTop: 4 }}>{value.address}</div>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm" onClick={() => onChange(null)}>Đổi</button>
          </div>
        </div>
        {suggested > 0 && onApplyDiscount && (
          <div className="alert warn small cust-tier">
            Hạng <b>{tier.name}</b>: gợi ý giảm {tier.discount_pct}% ({vnd(suggested)}) <button type="button" className="btn sm" onClick={() => onApplyDiscount(suggested)}>Áp dụng</button>
          </div>
        )}
      </div>
    );
  }

  if (mode === 'new') {
    return <NewCustomer shopId={shopId} compact={compact} seed={q} onCancel={() => setMode('search')} onPick={choose} />;
  }

  return (
    <div className="cust-picker" ref={wrap}>
      <div className="row">
      <div className="searchbox grow">
        <Icon name="search" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Tìm khách theo tên, SĐT hoặc mã…"
          aria-label="Tìm khách hàng"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
        />
      </div>
      <button type="button" className="btn" onClick={() => { setOpen(false); setMode('new'); }}>+ Khách mới</button>
      </div>
      {open && (
        <div className="cust-pop" id={listId} role="listbox" aria-label="Kết quả tìm khách">
          {rows.length === 0 && <div className="small muted" style={{ padding: '12px 16px' }}>{dq ? 'Không tìm thấy khách khớp.' : 'Shop chưa có khách nào. Tạo khách mới bên dưới.'}</div>}
          {rows.map(({ c, elsewhere }, i) => (
            <div key={c.id}>
              {elsewhere && (i === 0 || !rows[i - 1].elsewhere) && <div className="cust-sep">Khách ở shop khác</div>}
              <div
                role="option"
                aria-selected={i === active}
                className={`pick cust-row ${i === active ? 'on' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); choose(c); }}
                onMouseEnter={() => setActive(i)}
              >
                <div className="grow">
                  <div><b>{c.name}</b>{tiers[c.id] && <span className="badge plain" style={{ marginLeft: 8 }}>{tiers[c.id].name}</span>}</div>
                  <div className="small muted">{[c.phone, c.code].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div className="small muted right">
                  <div>{c.order_count} đơn{c.total_spent > 0 ? ` · ${vnd(c.total_spent)}` : ''}</div>
                  <div>{c.last_order_at ? `Gần nhất ${fmtDate(c.last_order_at)}` : 'Chưa mua'}</div>
                </div>
              </div>
            </div>
          ))}
          <button type="button" className="cust-new" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); setMode('new'); }}>+ Khách mới{q ? ` “${q}”` : ''}</button>
        </div>
      )}
    </div>
  );
}

/** Form tạo nhanh. Gõ SĐT trùng khách có sẵn thì gợi ý chọn khách đó, không cho tạo trùng. */
function NewCustomer({ shopId, compact, seed, onCancel, onPick }) {
  const seedDigits = digits(seed);
  const [f, setF] = useState({ name: seedDigits.length >= 9 ? '' : seed, phone: seedDigits.length >= 9 ? seed : '', address: '', facebook_url: '' });
  const [dup, setDup] = useState(null);
  const { busy, error, run } = useAction();
  const dphone = useDebounced(f.phone);
  useEffect(() => {
    setDup(null);
    if (digits(dphone).length < 9) return undefined;
    let off = false;
    api.get('/customers/lookup', { phone: dphone }).then((r) => !off && setDup(r.data || null)).catch(() => {});
    return () => { off = true; };
  }, [dphone]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    const r = await api.post('/customers', { name: f.name.trim(), phone: f.phone.trim() || null, address: f.address.trim() || null, facebook_url: f.facebook_url.trim() || null, shop_id: shopId || null });
    onPick(r.data);
  });
  return (
    <div className="cust-card new">
      <div className="row between"><b>Khách mới</b><button type="button" className="btn sm" onClick={onCancel}>Huỷ</button></div>
      <div className="grid cols-2 collapse">
        <Field label="Tên khách"><input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Số điện thoại"><input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
      </div>
      {dup && (
        <div className="alert warn small" role="status">
          Số này đã có khách <b>{dup.name}</b> ({dup.code}). <button type="button" className="btn sm" onClick={() => onPick(dup)}>Chọn khách này</button>
        </div>
      )}
      {!compact && (
        <div className="grid cols-2 collapse">
          <Field label="Địa chỉ"><input value={f.address} onChange={set('address')} /></Field>
          <Field label="Facebook"><input value={f.facebook_url} onChange={set('facebook_url')} placeholder="Link hoặc tên" /></Field>
        </div>
      )}
      <ErrorBox error={error} />
      <button type="button" className="btn primary" disabled={busy || !f.name.trim() || !!dup} onClick={save}>{busy ? 'Đang lưu…' : 'Tạo khách và chọn'}</button>
    </div>
  );
}
