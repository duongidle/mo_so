import { useLayoutEffect, useRef } from 'react';
import { formatMoneyInput, parseMoneyInput } from '../lib/money.js';

/**
 * Ô nhập tiền, thay thế `<input type="number">`: hiện dấu chấm ngăn nghìn khi gõ, giá trị là số nguyên.
 * `onChange` nhận một đối tượng giống sự kiện với `target.value` là chuỗi chữ số ('' khi để trống),
 * nên thay vào chỗ cũ không phải đổi cách xử lý giá trị.
 */
export default function MoneyInput({ value, onChange, allowNegative = false, className = '', style, ...rest }) {
  const ref = useRef(null);
  const caret = useRef(null); // số chữ số đứng trước con trỏ sau lần gõ gần nhất
  const shown = formatMoneyInput(value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || caret.current === null || document.activeElement !== el) return;
    let seen = 0;
    let pos = shown.length;
    if (caret.current === 0) pos = shown.startsWith('-') ? 1 : 0;
    else {
      for (let i = 0; i < shown.length; i += 1) {
        if (/\d/.test(shown[i])) seen += 1;
        if (seen === caret.current) { pos = i + 1; break; }
      }
    }
    el.setSelectionRange(pos, pos);
    caret.current = null;
  }, [shown]);

  const handle = (e) => {
    const raw = e.target.value;
    const before = raw.slice(0, e.target.selectionStart ?? raw.length);
    caret.current = (before.match(/\d/g) || []).length;
    onChange?.({ target: { value: parseMoneyInput(raw, { allowNegative }) } });
  };

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode={allowNegative ? 'text' : 'numeric'}
      autoComplete="off"
      className={`num ${className}`.trim()}
      style={{ textAlign: 'right', ...style }}
      value={shown}
      onChange={handle}
    />
  );
}
