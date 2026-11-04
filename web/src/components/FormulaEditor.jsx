import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAsync, useDebounced } from './ui.jsx';

const TYPE_LABEL = { text: 'chữ', number: 'số', money: 'tiền', date: 'ngày', boolean: 'có/không', percent: '%' };

/** Mẫu công thức hay dùng. Chỉ hiện mẫu mà mọi biến của nó đang tồn tại. */
export const TEMPLATES = {
  order: [
    ['Lãi của đơn', '{net_amount} - {cogs_amount}'],
    ['Tỷ lệ lãi (%)', 'ROUND(({net_amount} - {cogs_amount}) / {net_amount} * 100, 1)'],
    ['Còn phải thu', '{total_amount} - {paid_amount}'],
  ],
  purchase: [
    ['Còn nợ nhà cung cấp', '{total_amount} - {paid_amount}'],
    ['Phí nhập thêm', '{shipping_fee} + {other_fee}'],
  ],
  product: [['Chu kỳ dùng hết (tháng)', 'ROUND({consumption_days} / 30, 1)']],
  customer: [
    ['Tuổi', 'AGE({birth_date})'],
    ['Khách thân thiết', 'IF({shop_order_count} >= 3, "Thân thiết", "Mới")'],
    ['Số ngày từ đơn gần nhất', 'DAYS_BETWEEN({shop_last_order_at}, TODAY())'],
    ['Chi tiêu trung bình mỗi đơn', 'ROUND({shop_total_spent} / {shop_order_count})'],
  ],
  metric: [
    ['Lợi nhuận mỗi đơn', '{gross_profit} / {order_count}'],
    ['Chi phí trên doanh thu (%)', '{expenses_amount} / {net_revenue} * 100'],
    ['Tỷ lệ giá vốn (%)', '{cogs} / {net_revenue} * 100'],
  ],
};

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/**
 * Chỗ con trỏ đang ở: đang gõ tên biến (sau dấu `{`) hay tên hàm (chữ cái)?
 * Trả { kind: 'var' | 'fn', query, start } với start là vị trí bắt đầu phần cần thay, hoặc null.
 */
export function findTrigger(text, cursor) {
  const before = text.slice(0, cursor);
  const v = before.match(/\{([\w.]*)$/);
  if (v) return { kind: 'var', query: v[1], start: cursor - v[0].length };
  const f = before.match(/(?:^|[^\w.{"])([A-Za-z_]\w*)$/);
  if (f) {
    // Đang nằm trong chuỗi "..." thì không gợi ý
    if ((before.match(/"/g) || []).length % 2 === 1) return null;
    return { kind: 'fn', query: f[1], start: cursor - f[1].length };
  }
  return null;
}

export function filterVariables(vars, query) {
  const q = fold(query);
  if (!q) return vars;
  return vars.filter((v) => fold(v.key).includes(q) || fold(v.label).includes(q));
}

export function filterFunctions(fns, query) {
  const q = query.toUpperCase();
  return fns.filter((f) => f.name.startsWith(q));
}

const fmt = (v) => (v === null || v === undefined ? null : typeof v === 'number' ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 }).format(v) : String(v));

/** Dòng công thức với ký tự sai được tô và có mũi tên chỉ vào */
function ErrorSpot({ text, position }) {
  if (position === null || position === undefined) return null;
  const p = Math.min(position, text.length);
  const at = text[p];
  return (
    <pre className="formula-spot" aria-hidden="true">
      {text.slice(0, p)}<mark>{at === undefined || at === '\n' ? '␣' : at}</mark>{text.slice(p + 1)}
    </pre>
  );
}

/**
 * Ô soạn công thức có gợi ý: gõ `{` để chọn biến, gõ chữ để chọn hàm, bảng Biến/Hàm để bấm chèn,
 * xem trước kết quả trên bản ghi mẫu và báo lỗi đúng chỗ.
 * entity: 'order' | 'purchase' | 'product' | 'customer' | 'metric'. Khách bắt buộc có shopId.
 */
export default function FormulaEditor({ value, onChange, entity, shopId = null, fieldKey = null, label = 'Công thức' }) {
  const uid = useId();
  const taRef = useRef(null);
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [panel, setPanel] = useState(null); // null | 'vars' | 'fns'
  const needShop = entity === 'customer' && !shopId;

  const vars = useAsync(
    () => (needShop ? Promise.resolve({ data: [] }) : entity === 'metric' ? api.get('/custom/metric-variables') : api.get('/custom/variables', { entity_type: entity, shop_id: shopId || undefined })),
    [entity, shopId],
  );
  const fns = useAsync(() => api.get('/custom/functions'), []);
  const varList = vars.data?.data || [];
  const fnList = fns.data?.data || [];

  const trigger = useMemo(() => (dismissed ? null : findTrigger(value, cursor)), [value, cursor, dismissed]);
  const options = useMemo(() => {
    if (!trigger) return [];
    return trigger.kind === 'var' ? filterVariables(varList, trigger.query).slice(0, 30) : trigger.query ? filterFunctions(fnList, trigger.query) : [];
  }, [trigger, varList, fnList]);
  const open = options.length > 0;
  useEffect(() => setActive(0), [trigger?.kind, trigger?.query]);

  const setText = (text, caret) => {
    onChange(text);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      setCursor(caret);
    });
    setCursor(caret);
    setDismissed(false);
  };

  /** Chèn tại con trỏ, hoặc thay phần đang gõ dở (từ `from` đến con trỏ) */
  const insert = (text, { from = null, caretBack = 0 } = {}) => {
    const el = taRef.current;
    const end = el ? el.selectionEnd : cursor;
    const start = from ?? (el ? el.selectionStart : cursor);
    // Có sẵn dấu } ngay sau con trỏ (do trình duyệt/người dùng gõ trước) thì nuốt luôn để khỏi thừa
    const tail = text.endsWith('}') && value[end] === '}' ? end + 1 : end;
    const next = value.slice(0, start) + text + value.slice(tail);
    setText(next, start + text.length - caretBack);
  };

  const pick = (o) => {
    if (!trigger) return;
    if (trigger.kind === 'var') insert(o.ref, { from: trigger.start });
    else insert(`${o.name}()`, { from: trigger.start, caretBack: o.signature.includes('()') && o.name === 'TODAY' ? 0 : 1 });
  };

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(options[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(true); }
  };

  // Xem trước
  const debounced = useDebounced(value, 400);
  const [preview, setPreview] = useState(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!debounced.trim() || needShop) { setPreview(null); return undefined; }
    const id = ++seq.current;
    api.post('/custom/formula/preview', { entity_type: entity, shop_id: shopId || null, formula: debounced, field_key: fieldKey || null })
      .then((r) => id === seq.current && setPreview(r.data))
      .catch((err) => id === seq.current && setPreview({ error: { message: err.message, position: err.details?.position ?? null } }));
    return () => { seq.current++; };
  }, [debounced, entity, shopId, fieldKey, needShop]);
  const stale = debounced !== value;

  const templates = useMemo(() => {
    const keys = new Set(varList.map((v) => v.key));
    return (TEMPLATES[entity] || []).filter(([, f]) => [...f.matchAll(/\{([^}]+)\}/g)].every((m) => keys.has(m[1])));
  }, [entity, varList]);

  const groups = useMemo(() => {
    const g = new Map();
    for (const v of varList) { if (!g.has(v.group)) g.set(v.group, []); g.get(v.group).push(v); }
    return [...g.entries()];
  }, [varList]);

  const listId = `${uid}-list`;
  const err = preview?.error;
  return (
    <div className="formula-editor stack" style={{ gap: 8 }}>
      <label htmlFor={`${uid}-ta`} className="small" style={{ fontWeight: 600 }}>{label}</label>
      {needShop && <div className="alert warn small">Chọn một shop trước: biến của khách (số đơn, chi tiêu, trường riêng) tính theo từng shop.</div>}
      <textarea
        id={`${uid}-ta`} ref={taRef} rows={3} value={value} spellCheck={false}
        placeholder="Gõ { để chọn biến, gõ chữ để chọn hàm. Ví dụ: {net_amount} - {cogs_amount}"
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open ? `${uid}-o${active}` : undefined}
        aria-invalid={!!err}
        onChange={(e) => { onChange(e.target.value); setCursor(e.target.selectionStart); setDismissed(false); }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) setCursor(e.target.selectionStart); }}
        onClick={(e) => { setCursor(e.target.selectionStart); setDismissed(false); }}
        onBlur={() => setTimeout(() => setDismissed(true), 150)}
        onFocus={(e) => { setCursor(e.target.selectionStart); setDismissed(false); }}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 14, resize: 'vertical' }}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label={trigger.kind === 'var' ? 'Biến gợi ý' : 'Hàm gợi ý'} className="formula-list">
          {options.map((o, i) => (
            <li key={o.key || o.name} id={`${uid}-o${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)} onMouseEnter={() => setActive(i)}>
              {trigger.kind === 'var' ? (
                <><span><b>{o.label}</b> <code className="small">{o.ref}</code></span><span className="small muted">{TYPE_LABEL[o.type] || o.type} · {o.group}</span></>
              ) : (
                <><span><code>{o.signature}</code><div className="small muted">{o.description}</div></span><span className="small muted">VD: {o.example}</span></>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="row wrap" style={{ gap: 6 }}>
        <button type="button" className={`chip ${panel === 'vars' ? 'on' : ''}`} aria-pressed={panel === 'vars'} onClick={() => setPanel(panel === 'vars' ? null : 'vars')}>Biến</button>
        <button type="button" className={`chip ${panel === 'fns' ? 'on' : ''}`} aria-pressed={panel === 'fns'} onClick={() => setPanel(panel === 'fns' ? null : 'fns')}>Hàm</button>
        {templates.length > 0 && <span className="small muted">Mẫu:</span>}
        {templates.map(([name, f]) => <button type="button" key={name} className="chip" title={f} onClick={() => setText(f, f.length)}>{name}</button>)}
      </div>

      {panel === 'vars' && (
        <div className="formula-panel" role="region" aria-label="Biến có thể dùng">
          {vars.loading && <span className="muted small">Đang tải…</span>}
          {!vars.loading && !varList.length && <span className="muted small">Không có biến nào.</span>}
          {groups.map(([g, list]) => (
            <div key={g}>
              <div className="eyebrow">{g}</div>
              <div className="row wrap" style={{ gap: 6, margin: '4px 0 10px' }}>
                {list.map((v) => <button type="button" key={v.key} className="chip" title={`${v.ref} · ${TYPE_LABEL[v.type] || v.type}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(v.ref)}>{v.label}</button>)}
              </div>
            </div>
          ))}
        </div>
      )}
      {panel === 'fns' && (
        <div className="formula-panel" role="region" aria-label="Hàm có thể dùng">
          {fnList.map((f) => (
            <button type="button" key={f.name} className="formula-fn" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`${f.name}()`, { caretBack: f.name === 'TODAY' ? 0 : 1 })}>
              <code>{f.signature}</code><span className="small muted">{f.description} VD: <code>{f.example}</code></span>
            </button>
          ))}
        </div>
      )}

      <div aria-live="polite" className="small">
        {err && <div className="alert err" role="alert"><div>{err.message}{err.position !== null && err.position !== undefined ? ` (ký tự thứ ${err.position + 1})` : ''}</div><ErrorSpot text={debounced} position={err.position} /></div>}
        {!err && preview && !stale && value.trim() && (
          preview.sample === null
            ? <span className="muted">{preview.note || 'Công thức hợp lệ.'}</span>
            : <span>Kết quả thử: <b data-testid="formula-result">{fmt(preview.value) ?? 'trống'}</b>{preview.value === null || preview.value === undefined ? <span className="muted" data-testid="formula-reason"> ({preview.reason || 'thiếu dữ liệu'})</span> : null} <span className="muted">· trên {preview.sample.label}</span></span>
        )}
      </div>
    </div>
  );
}
