import MoneyInput from './MoneyInput.jsx';
import { vnd } from '../lib.js';

/** Ô nhập tiền kèm nút điền nhanh số đủ (số còn nợ, số còn phải thu…). Nút ẩn khi ô đã bằng đúng số đó. */
export default function MoneyFill({ value, onChange, fill, label = 'Điền đủ', ...rest }) {
  const target = Math.max(0, Math.round(Number(fill) || 0));
  const showBtn = target > 0 && Number(value || 0) !== target;
  return (
    <div className="money-fill">
      <MoneyInput value={value} onChange={onChange} {...rest} />
      {showBtn && <button type="button" className="btn sm" onClick={() => onChange({ target: { value: String(target) } })}>{label} {vnd(target)}</button>}
    </div>
  );
}
