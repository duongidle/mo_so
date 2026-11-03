// Bộ tính công thức an toàn: tự phân tích cú pháp, KHÔNG dùng eval/Function.
// Cú pháp: số, "chuỗi", {tên_trường}, + - * / , so sánh (< > <= >= = !=), ngoặc, hàm IF ROUND MIN MAX ABS DAYS_BETWEEN TODAY.
// Giá trị thiếu (null) lan truyền: phép tính có null cho ra null. Chia cho 0 cho ra null (không văng lỗi, không ra Infinity).
import { businessDate, daysBetween } from './time.js';

export class FormulaError extends Error {}

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new FormulaError('Thiếu dấu } đóng');
      const name = src.slice(i + 1, end).trim();
      if (!/^[A-Za-z_][\w.]*$/.test(name)) throw new FormulaError(`Tên trường không hợp lệ: {${name}}`);
      toks.push({ t: 'ref', v: name });
      i = end + 1;
    } else if (/[0-9.]/.test(ch)) {
      const m = src.slice(i).match(/^\d*\.?\d+/);
      if (!m) throw new FormulaError(`Số không hợp lệ gần "${src.slice(i, i + 5)}"`);
      toks.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError('Chuỗi thiếu dấu " đóng');
      toks.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = src.slice(i).match(/^[A-Za-z_]\w*/);
      toks.push({ t: 'id', v: m[0].toUpperCase() });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '!=', '<>'].includes(two)) { toks.push({ t: 'op', v: two === '<>' ? '!=' : two }); i += 2; }
      else if ('+-*/(),<>='.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; }
      else throw new FormulaError(`Ký tự không được phép: "${ch}"`);
    }
  }
  return toks;
}

const FUNCS = {
  IF: { min: 3, max: 3 }, ROUND: { min: 1, max: 2 }, MIN: { min: 1, max: 99 }, MAX: { min: 1, max: 99 },
  ABS: { min: 1, max: 1 }, DAYS_BETWEEN: { min: 2, max: 2 }, TODAY: { min: 0, max: 0 },
};

/** Phân tích thành cây. Ném FormulaError nếu sai cú pháp. */
export function parse(src) {
  const toks = tokenize(String(src));
  if (!toks.length) throw new FormulaError('Công thức trống');
  let p = 0;
  const peek = () => toks[p];
  const eat = (v) => { if (peek()?.t === 'op' && peek().v === v) { p++; return true; } return false; };
  const need = (v) => { if (!eat(v)) throw new FormulaError(`Thiếu "${v}"`); };

  function cmp() {
    let l = add();
    while (peek()?.t === 'op' && ['<', '>', '<=', '>=', '=', '!='].includes(peek().v)) {
      const op = toks[p++].v;
      l = { k: 'bin', op, l, r: add() };
    }
    return l;
  }
  function add() {
    let l = mul();
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) l = { k: 'bin', op: toks[p++].v, l, r: mul() };
    return l;
  }
  function mul() {
    let l = unary();
    while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/')) l = { k: 'bin', op: toks[p++].v, l, r: unary() };
    return l;
  }
  function unary() {
    if (eat('-')) return { k: 'neg', e: unary() };
    return atom();
  }
  function atom() {
    const t = toks[p++];
    if (!t) throw new FormulaError('Công thức chưa hoàn chỉnh');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'ref') return { k: 'ref', name: t.v };
    if (t.t === 'op' && t.v === '(') { const e = cmp(); need(')'); return e; }
    if (t.t === 'id') {
      const spec = FUNCS[t.v];
      if (!spec) throw new FormulaError(`Hàm không có: ${t.v}`);
      need('(');
      const args = [];
      if (!eat(')')) {
        do args.push(cmp()); while (eat(','));
        need(')');
      }
      if (args.length < spec.min || args.length > spec.max) throw new FormulaError(`${t.v} cần ${spec.min === spec.max ? spec.min : `${spec.min}–${spec.max}`} tham số`);
      return { k: 'call', name: t.v, args };
    }
    throw new FormulaError(`Không hiểu "${t.v}"`);
  }
  const tree = cmp();
  if (p < toks.length) throw new FormulaError(`Thừa "${toks[p].v}" ở cuối công thức`);
  return tree;
}

/** Danh sách tên trường mà công thức tham chiếu */
export function refsOf(tree, out = new Set()) {
  if (tree.k === 'ref') out.add(tree.name);
  else if (tree.k === 'bin') (refsOf(tree.l, out), refsOf(tree.r, out));
  else if (tree.k === 'neg') refsOf(tree.e, out);
  else if (tree.k === 'call') tree.args.forEach((a) => refsOf(a, out));
  return out;
}

const num = (v) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' ? v : Number.isFinite(Number(v)) ? Number(v) : null);

/** Tính giá trị. `ctx` là hàm hoặc object tra tên trường → giá trị. */
export function evaluate(tree, ctx) {
  const get = typeof ctx === 'function' ? ctx : (n) => ctx[n];
  const ev = (n) => {
    switch (n.k) {
      case 'num': case 'str': return n.v;
      case 'ref': { const v = get(n.name); return v === undefined ? null : v; }
      case 'neg': { const v = num(ev(n.e)); return v === null ? null : -v; }
      case 'bin': {
        const a = ev(n.l), b = ev(n.r);
        if (['<', '>', '<=', '>=', '=', '!='].includes(n.op)) {
          if (a === null || b === null) return null;
          const [x, y] = typeof a === 'string' || typeof b === 'string' ? [String(a), String(b)] : [a, b];
          return { '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y, '=': x === y, '!=': x !== y }[n.op] ? 1 : 0;
        }
        const x = num(a), y = num(b);
        if (x === null || y === null) return null;
        if (n.op === '+') return x + y;
        if (n.op === '-') return x - y;
        if (n.op === '*') return x * y;
        return y === 0 ? null : x / y;
      }
      case 'call': {
        if (n.name === 'IF') {
          const c = ev(n.args[0]);
          return c === null ? null : c && c !== '0' ? ev(n.args[1]) : ev(n.args[2]); // chỉ tính nhánh được chọn
        }
        const a = n.args.map(ev);
        switch (n.name) {
          case 'TODAY': return businessDate();
          case 'DAYS_BETWEEN': {
            if (a[0] == null || a[1] == null) return null;
            const d = (v) => String(v).slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d(a[0])) || !/^\d{4}-\d{2}-\d{2}$/.test(d(a[1]))) return null;
            return daysBetween(d(a[0]), d(a[1]));
          }
          case 'ABS': { const x = num(a[0]); return x === null ? null : Math.abs(x); }
          case 'ROUND': {
            const x = num(a[0]); if (x === null) return null;
            const d = a[1] == null ? 0 : num(a[1]) ?? 0;
            const f = 10 ** d;
            return Math.round(x * f) / f;
          }
          case 'MIN': case 'MAX': {
            const xs = a.map(num);
            if (xs.some((x) => x === null)) return null;
            return n.name === 'MIN' ? Math.min(...xs) : Math.max(...xs);
          }
        }
      }
    }
    throw new FormulaError('Nút không hợp lệ');
  };
  return ev(tree);
}

export function calc(src, ctx) {
  return evaluate(parse(src), ctx);
}
