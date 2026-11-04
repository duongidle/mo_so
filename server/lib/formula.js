// Bộ tính công thức an toàn: tự phân tích cú pháp, KHÔNG dùng eval/Function.
// Cú pháp: số, "chuỗi", {tên_trường}, + - * / , so sánh (< > <= >= = !=), ngoặc, hàm (xem FUNCTION_DOCS).
// Giá trị thiếu (null) lan truyền: phép tính có null cho ra null. Chia cho 0 cho ra null (không văng lỗi, không ra Infinity).
// Ngoại lệ có chủ đích: CONCAT coi null là chuỗi rỗng, COALESCE lấy giá trị đầu tiên không thiếu. YEAR/MONTH của ngày không hợp lệ ra null.
// Lỗi cú pháp mang `position` (vị trí ký tự, tính từ 0) để giao diện tô đúng chỗ sai.
import { businessDate, daysBetween } from './time.js';

export class FormulaError extends Error {
  constructor(message, position = null) {
    super(message);
    this.position = position;
  }
}

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new FormulaError('Thiếu dấu } đóng', i);
      const name = src.slice(i + 1, end).trim();
      if (!/^[A-Za-z_][\w.]*$/.test(name)) throw new FormulaError(`Tên trường không hợp lệ: {${name}}`, i);
      toks.push({ t: 'ref', v: name, pos: i });
      i = end + 1;
    } else if (/[0-9.]/.test(ch)) {
      const m = src.slice(i).match(/^\d*\.?\d+/);
      if (!m) throw new FormulaError(`Số không hợp lệ gần "${src.slice(i, i + 5)}"`, i);
      toks.push({ t: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
    } else if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError('Chuỗi thiếu dấu " đóng', i);
      toks.push({ t: 'str', v: src.slice(i + 1, end), pos: i });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = src.slice(i).match(/^[A-Za-z_]\w*/);
      toks.push({ t: 'id', v: m[0].toUpperCase(), pos: i });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '!=', '<>'].includes(two)) { toks.push({ t: 'op', v: two === '<>' ? '!=' : two, pos: i }); i += 2; }
      else if ('+-*/(),<>='.includes(ch)) { toks.push({ t: 'op', v: ch, pos: i }); i++; }
      else throw new FormulaError(`Ký tự không được phép: "${ch}"`, i);
    }
  }
  return toks;
}

const FUNCS = {
  IF: { min: 3, max: 3 }, ROUND: { min: 1, max: 2 }, MIN: { min: 1, max: 99 }, MAX: { min: 1, max: 99 },
  ABS: { min: 1, max: 1 }, DAYS_BETWEEN: { min: 2, max: 2 }, TODAY: { min: 0, max: 0 },
  CONCAT: { min: 1, max: 99 }, YEAR: { min: 1, max: 1 }, MONTH: { min: 1, max: 1 }, COALESCE: { min: 1, max: 99 },
};

/** Danh sách hàm cho giao diện gợi ý (một nguồn duy nhất với FUNCS ở trên) */
export const FUNCTION_DOCS = [
  { name: 'IF', signature: 'IF(điều_kiện, nếu_đúng, nếu_sai)', description: 'Chọn một trong hai giá trị. Điều kiện thiếu dữ liệu thì cả hàm ra trống.', example: 'IF({total_amount} > 500000, "Đơn lớn", "Đơn thường")' },
  { name: 'ROUND', signature: 'ROUND(số, số_lẻ)', description: 'Làm tròn. Bỏ số_lẻ thì tròn về số nguyên.', example: 'ROUND({net_amount} / {subtotal} * 100, 1)' },
  { name: 'MIN', signature: 'MIN(a, b, …)', description: 'Số nhỏ nhất. Có giá trị thiếu thì ra trống.', example: 'MIN({paid_amount}, {total_amount})' },
  { name: 'MAX', signature: 'MAX(a, b, …)', description: 'Số lớn nhất. Có giá trị thiếu thì ra trống.', example: 'MAX({total_amount} - {paid_amount}, 0)' },
  { name: 'ABS', signature: 'ABS(số)', description: 'Giá trị tuyệt đối.', example: 'ABS({net_amount} - {cogs_amount})' },
  { name: 'DAYS_BETWEEN', signature: 'DAYS_BETWEEN(ngày_đầu, ngày_cuối)', description: 'Số ngày giữa hai ngày (YYYY-MM-DD).', example: 'DAYS_BETWEEN({business_date}, TODAY())' },
  { name: 'TODAY', signature: 'TODAY()', description: 'Ngày hôm nay theo giờ Việt Nam.', example: 'DAYS_BETWEEN({custom.ngay_giao}, TODAY())' },
  { name: 'CONCAT', signature: 'CONCAT(a, b, …)', description: 'Nối chữ. Giá trị thiếu coi như chuỗi rỗng.', example: 'CONCAT({name}, " - ", {custom.dong_xe})' },
  { name: 'YEAR', signature: 'YEAR(ngày)', description: 'Lấy năm của một ngày. Không phải ngày hợp lệ thì ra trống.', example: 'YEAR(TODAY()) - {custom.nam_sinh}' },
  { name: 'MONTH', signature: 'MONTH(ngày)', description: 'Lấy tháng (1–12) của một ngày.', example: 'MONTH({custom.sinh_nhat})' },
  { name: 'COALESCE', signature: 'COALESCE(a, b, …)', description: 'Lấy giá trị đầu tiên có dữ liệu. Dùng để thay giá trị thiếu bằng mặc định.', example: 'COALESCE({custom.phi_dong_goi}, 0)' },
];

/** Phân tích thành cây. Ném FormulaError nếu sai cú pháp. */
export function parse(src) {
  const toks = tokenize(String(src));
  if (!toks.length) throw new FormulaError('Công thức trống', 0);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v) => { if (peek()?.t === 'op' && peek().v === v) { p++; return true; } return false; };
  const endPos = String(src).length;
  const here = () => (toks[p] ? toks[p].pos : endPos);
  const need = (v) => { if (!eat(v)) throw new FormulaError(`Thiếu "${v}"`, here()); };

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
    if (!t) throw new FormulaError('Công thức chưa hoàn chỉnh', endPos);
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'ref') return { k: 'ref', name: t.v, pos: t.pos };
    if (t.t === 'op' && t.v === '(') { const e = cmp(); need(')'); return e; }
    if (t.t === 'id') {
      const spec = FUNCS[t.v];
      if (!spec) throw new FormulaError(`Hàm không có: ${t.v}`, t.pos);
      need('(');
      const args = [];
      if (!eat(')')) {
        do args.push(cmp()); while (eat(','));
        need(')');
      }
      if (args.length < spec.min || args.length > spec.max) throw new FormulaError(`${t.v} cần ${spec.min === spec.max ? spec.min : `${spec.min}–${spec.max}`} tham số`, t.pos);
      return { k: 'call', name: t.v, args };
    }
    throw new FormulaError(`Không hiểu "${t.v}"`, t.pos ?? endPos);
  }
  const tree = cmp();
  if (p < toks.length) throw new FormulaError(`Thừa "${toks[p].v}" ở cuối công thức`, toks[p].pos);
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

/** Như refsOf nhưng kèm vị trí trong công thức: [{ name, pos }], theo thứ tự xuất hiện */
export function refList(tree, out = []) {
  if (tree.k === 'ref') out.push({ name: tree.name, pos: tree.pos });
  else if (tree.k === 'bin') (refList(tree.l, out), refList(tree.r, out));
  else if (tree.k === 'neg') refList(tree.e, out);
  else if (tree.k === 'call') tree.args.forEach((a) => refList(a, out));
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
          case 'CONCAT': return a.map((v) => (v === null || v === undefined ? '' : String(v))).join('');
          case 'COALESCE': return a.find((v) => v !== null && v !== undefined && v !== '') ?? null;
          case 'YEAR': case 'MONTH': {
            if (a[0] == null) return null;
            const m = String(a[0]).match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!m) return null;
            return n.name === 'YEAR' ? Number(m[1]) : Number(m[2]);
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
