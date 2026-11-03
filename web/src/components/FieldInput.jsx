import { vnd } from '../lib.js';

/** Ô nhập cho một trường tuỳ chỉnh theo kiểu của nó. value/onChange theo kiểu thô (chuỗi, số, mảng, boolean). */
export default function FieldInput({ field, value, onChange }) {
  const v = value ?? '';
  switch (field.type) {
    case 'number':
    case 'money':
      return <input type="number" inputMode="numeric" value={v} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'date':
      return <input type="date" value={v} onChange={(e) => onChange(e.target.value || null)} />;
    case 'boolean':
      return <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />{field.label}</label>;
    case 'select':
      return (
        <select value={v} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'multiselect': {
      const arr = Array.isArray(value) ? value : [];
      const toggle = (o) => { const n = arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]; onChange(n.length ? n : null); };
      return <div className="row wrap">{field.options.map((o) => <button type="button" key={o} className={`chip ${arr.includes(o) ? 'on' : ''}`} onClick={() => toggle(o)} aria-pressed={arr.includes(o)}>{o}</button>)}</div>;
    }
    case 'formula':
      return <span className="muted">{value === null || value === undefined ? '—' : typeof value === 'number' ? new Intl.NumberFormat('vi-VN').format(value) : String(value)}</span>;
    default:
      return <input value={v} onChange={(e) => onChange(e.target.value || null)} />;
  }
}

/** Hiển thị giá trị chỉ đọc */
export function fieldText(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'money') return vnd(value);
  if (field.type === 'boolean') return value ? 'Có' : 'Không';
  if (Array.isArray(value)) return value.join(', ');
  if (field.type === 'date') return value.split('-').reverse().join('/');
  if (typeof value === 'number') return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
  return String(value);
}

export const slugify = (t) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);
