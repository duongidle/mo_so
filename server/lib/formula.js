// Bộ tính công thức an toàn: tự phân tích cú pháp, KHÔNG dùng eval/Function.
// Cú pháp: số, "chuỗi", {tên_trường}, + - * / , so sánh (< > <= >= = !=), ngoặc, hàm (xem FUNCTION_DOCS).
// Giá trị thiếu (null) lan truyền: phép tính có null cho ra null. Chia cho 0 cho ra null (không văng lỗi, không ra Infinity).
// Ngoại lệ có chủ đích: CONCAT coi null là chuỗi rỗng, COALESCE lấy giá trị đầu tiên không thiếu. YEAR/MONTH/DAY của ngày không hợp lệ ra null.
// Ngày: chuỗi YYYY-MM-DD (hoặc ISO, đổi sang ngày giờ VN). ngày − ngày = số ngày; ngày ± số = ngày. Kiểu sai (chữ − số, ngày × số) bị chặn lúc lưu
// (inferType) và, nếu lọt vào dữ liệu cũ, ra null kèm lý do (evaluateExplain) thay vì lặng lẽ "không có dữ liệu".
// Lỗi cú pháp mang `position` (vị trí ký tự, tính từ 0) để giao diện tô đúng chỗ sai.
import { addDays, businessDate, daysBetween } from './time.js';

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
  AGE: { min: 1, max: 1 }, DAY: { min: 1, max: 1 }, DATE: { min: 3, max: 3 }, MONTHS_BETWEEN: { min: 2, max: 2 },
};

/** Danh sách hàm cho giao diện gợi ý (một nguồn duy nhất với FUNCS ở trên) */
export const FUNCTION_DOCS = [
  { name: 'IF', signature: 'IF(điều_kiện, nếu_đúng, nếu_sai)', description: 'Chọn một trong hai giá trị. Điều kiện thiếu dữ liệu thì cả hàm ra trống.', example: 'IF({total_amount} > 500000, "Đơn lớn", "Đơn thường")' },
  { name: 'ROUND', signature: 'ROUND(số, số_lẻ)', description: 'Làm tròn. Bỏ số_lẻ thì tròn về số nguyên.', example: 'ROUND({net_amount} / {subtotal} * 100, 1)' },
  { name: 'MIN', signature: 'MIN(a, b, …)', description: 'Số nhỏ nhất. Có giá trị thiếu thì ra trống.', example: 'MIN({paid_amount}, {total_amount})' },
  { name: 'MAX', signature: 'MAX(a, b, …)', description: 'Số lớn nhất. Có giá trị thiếu thì ra trống.', example: 'MAX({total_amount} - {paid_amount}, 0)' },
  { name: 'ABS', signature: 'ABS(số)', description: 'Giá trị tuyệt đối.', example: 'ABS({net_amount} - {cogs_amount})' },
  { name: 'DAYS_BETWEEN', signature: 'DAYS_BETWEEN(ngày_đầu, ngày_cuối)', description: 'Số ngày từ ngày đầu đến ngày cuối. Cũng viết được là {ngày_cuối} - {ngày_đầu}.', example: 'DAYS_BETWEEN({business_date}, TODAY())' },
  { name: 'TODAY', signature: 'TODAY()', description: 'Ngày hôm nay theo giờ Việt Nam.', example: 'TODAY() - {custom.ngay_giao}' },
  { name: 'CONCAT', signature: 'CONCAT(a, b, …)', description: 'Nối chữ. Giá trị thiếu coi như chuỗi rỗng.', example: 'CONCAT({name}, " - ", {custom.dong_xe})' },
  { name: 'YEAR', signature: 'YEAR(ngày)', description: 'Lấy năm của một ngày. Không phải ngày hợp lệ thì ra trống.', example: 'YEAR(TODAY()) - YEAR({birth_date})' },
  { name: 'MONTH', signature: 'MONTH(ngày)', description: 'Lấy tháng (1–12) của một ngày.', example: 'MONTH({birth_date})' },
  { name: 'DAY', signature: 'DAY(ngày)', description: 'Lấy ngày trong tháng (1–31) của một ngày.', example: 'DAY({birth_date})' },
  { name: 'DATE', signature: 'DATE(năm, tháng, ngày)', description: 'Dựng một ngày từ năm, tháng, ngày. Ngày không có thật thì ra trống.', example: 'DATE(YEAR(TODAY()), MONTH({birth_date}), DAY({birth_date}))' },
  { name: 'AGE', signature: 'AGE(ngày)', description: 'Tuổi tròn tính đến hôm nay (giờ Việt Nam) của một ngày sinh.', example: 'AGE({birth_date})' },
  { name: 'MONTHS_BETWEEN', signature: 'MONTHS_BETWEEN(ngày_đầu, ngày_cuối)', description: 'Số tháng tròn từ ngày đầu đến ngày cuối.', example: 'MONTHS_BETWEEN({first_order_at}, TODAY())' },
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
      const { v: op, pos } = toks[p++];
      l = { k: 'bin', op, pos, l, r: add() };
    }
    return l;
  }
  function add() {
    let l = mul();
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) { const { v: op, pos } = toks[p++]; l = { k: 'bin', op, pos, l, r: mul() }; }
    return l;
  }
  function mul() {
    let l = unary();
    while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/')) { const { v: op, pos } = toks[p++]; l = { k: 'bin', op, pos, l, r: unary() }; }
    return l;
  }
  function unary() {
    const at = here();
    if (eat('-')) return { k: 'neg', pos: at, e: unary() };
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
      return { k: 'call', name: t.v, args, pos: t.pos };
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


const num = (v) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d*\.?\d+\s*$/.test(v) ? Number(v) : typeof v === 'boolean' ? Number(v) : null);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Ngày hợp lệ theo lịch (không phải 2026-02-30) */
function realDay(s) {
  if (!DAY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
/** Chuỗi ngày YYYY-MM-DD, hoặc ISO có giờ (đổi sang ngày giờ VN). Không phải ngày thì null. */
export function asDay(v) {
  if (typeof v !== 'string') return null;
  if (DAY_RE.test(v)) return realDay(v) ? v : null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const t = new Date(v);
    return Number.isNaN(t.getTime()) ? null : businessDate(v);
  }
  return null;
}
const ymd = (d) => d.split('-').map(Number);

/** Tuổi tròn của người sinh `birth` tính đến `today` (đều YYYY-MM-DD) */
export function ageOn(birth, today = businessDate()) {
  const [by, bm, bd] = ymd(birth);
  const [ty, tm, td] = ymd(today);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
function monthsBetween(a, b) {
  const [ay, am, ad] = ymd(a);
  const [by, bm, bd] = ymd(b);
  if (b < a) return -monthsBetween(b, a);
  return (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0);
}

const CMP = ['<', '>', '<=', '>=', '=', '!='];

/**
 * Tính giá trị. `ctx` là hàm hoặc object tra tên trường → giá trị.
 * `note(reason)` (tuỳ chọn) được gọi khi một phép cho ra trống, theo thứ tự tính: dùng để giải thích vì sao trống.
 */
export function evaluate(tree, ctx, note = null) {
  const get = typeof ctx === 'function' ? ctx : (n) => ctx[n];
  const why = (kind, text, extra = {}) => note?.({ kind, text, ...extra });
  const ev = (n) => {
    switch (n.k) {
      case 'num': case 'str': return n.v;
      case 'ref': {
        const v = get(n.name);
        if (v === undefined || v === null || v === '') { why('missing', null, { ref: n.name }); return null; }
        return v;
      }
      case 'neg': {
        const a = ev(n.e);
        if (a === null) return null;
        const v = num(a);
        if (v === null) { why('invalid', 'Dấu trừ chỉ dùng với số'); return null; }
        return -v;
      }
      case 'bin': {
        const a = ev(n.l), b = ev(n.r);
        if (CMP.includes(n.op)) {
          if (a === null || b === null) return null;
          const [x, y] = typeof a === 'string' || typeof b === 'string' ? [String(a), String(b)] : [a, b];
          return { '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y, '=': x === y, '!=': x !== y }[n.op] ? 1 : 0;
        }
        if (a === null || b === null) return null;
        const da = asDay(a), db = asDay(b);
        if (da !== null || db !== null) {
          // Phép tính ngày: ngày − ngày = số ngày; ngày ± số = ngày
          if (n.op === '-' && da && db) return daysBetween(db, da);
          const k = da ? num(b) : num(a);
          if (k !== null && (n.op === '+' || (n.op === '-' && da))) {
            return addDays(da || db, (n.op === '-' ? -1 : 1) * Math.trunc(k));
          }
          why('invalid', n.op === '+' && da && db ? 'Không cộng hai ngày với nhau được' : 'Ngày chỉ trừ với ngày (ra số ngày) hoặc cộng/trừ với một số ngày');
          return null;
        }
        const x = num(a), y = num(b);
        if (x === null || y === null) { why('invalid', 'Phép tính cần số, nhưng có giá trị không phải số'); return null; }
        if (n.op === '+') return x + y;
        if (n.op === '-') return x - y;
        if (n.op === '*') return x * y;
        if (y === 0) { why('div0', 'Chia cho 0'); return null; }
        return x / y;
      }
      case 'call': {
        if (n.name === 'IF') {
          const c = ev(n.args[0]);
          return c === null ? null : c && c !== '0' ? ev(n.args[1]) : ev(n.args[2]); // chỉ tính nhánh được chọn
        }
        const a = n.args.map(ev);
        const dayArg = (i, fnName) => {
          if (a[i] == null) return null;
          const d = asDay(a[i]);
          if (d === null) why('invalid', `${fnName} cần một ngày hợp lệ (YYYY-MM-DD)`);
          return d;
        };
        switch (n.name) {
          case 'TODAY': return businessDate();
          case 'DAYS_BETWEEN': {
            const x = dayArg(0, 'DAYS_BETWEEN'), y = dayArg(1, 'DAYS_BETWEEN');
            return x === null || y === null ? null : daysBetween(x, y);
          }
          case 'MONTHS_BETWEEN': {
            const x = dayArg(0, 'MONTHS_BETWEEN'), y = dayArg(1, 'MONTHS_BETWEEN');
            return x === null || y === null ? null : monthsBetween(x, y);
          }
          case 'AGE': {
            const d = dayArg(0, 'AGE');
            if (d === null) return null;
            if (d > businessDate()) { why('invalid', 'Ngày nằm ở tương lai nên không tính được tuổi'); return null; }
            return ageOn(d);
          }
          case 'DATE': {
            const [y, m, d] = a.map(num);
            if (a.some((v) => v == null)) return null;
            if ([y, m, d].some((v) => v === null || !Number.isInteger(v))) { why('invalid', 'DATE cần năm, tháng, ngày là số nguyên'); return null; }
            const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (!realDay(s)) { why('invalid', `Ngày ${d}/${m}/${y} không có thật`); return null; }
            return s;
          }
          case 'ABS': { if (a[0] === null) return null; const x = num(a[0]); if (x === null) { why('invalid', 'ABS cần một số'); return null; } return Math.abs(x); }
          case 'ROUND': {
            if (a[0] === null) return null;
            const x = num(a[0]); if (x === null) { why('invalid', 'ROUND cần một số'); return null; }
            const d = a[1] == null ? 0 : num(a[1]) ?? 0;
            const f = 10 ** d;
            return Math.round(x * f) / f;
          }
          case 'CONCAT': return a.map((v) => (v === null || v === undefined ? '' : String(v))).join('');
          case 'COALESCE': return a.find((v) => v !== null && v !== undefined && v !== '') ?? null;
          case 'YEAR': case 'MONTH': case 'DAY': {
            const d = dayArg(0, n.name);
            if (d === null) return null;
            return ymd(d)[n.name === 'YEAR' ? 0 : n.name === 'MONTH' ? 1 : 2];
          }
          case 'MIN': case 'MAX': {
            if (a.some((x) => x === null)) return null;
            const xs = a.map(num);
            if (xs.some((x) => x === null)) { why('invalid', `${n.name} cần các giá trị là số`); return null; }
            return n.name === 'MIN' ? Math.min(...xs) : Math.max(...xs);
          }
        }
      }
    }
    throw new FormulaError('Nút không hợp lệ');
  };
  return ev(tree);
}

/**
 * Như evaluate nhưng khi kết quả trống thì trả kèm lý do ngắn, dễ đọc:
 *  - thiếu dữ liệu: "<subject> chưa có <nhãn>" (labelOf tra nhãn của biến);
 *  - chia cho 0, phép không hợp lệ: nói rõ.
 * Trả { value, reason } (reason = null khi có giá trị).
 */
export function evaluateExplain(tree, ctx, { subject = 'Bản ghi', labelOf = (n) => n } = {}) {
  const reasons = [];
  const value = evaluate(tree, ctx, (r) => reasons.push(r));
  if (value !== null && value !== undefined) return { value, reason: null };
  const r = reasons[0];
  if (!r) return { value: null, reason: 'Thiếu dữ liệu' };
  if (r.kind === 'missing') return { value: null, reason: `${subject} chưa có ${labelOf(r.ref)}` };
  return { value: null, reason: r.text };
}

// ---------- Suy kiểu (chặn phép sai lúc lưu công thức) ----------
const TYPE_NAME = { number: 'số', date: 'ngày', text: 'chữ' };

/**
 * Suy kiểu của biểu thức: 'number' | 'date' | 'text' | null (chưa biết, không chặn).
 * `typeOf(tênBiến)` trả kiểu của biến hoặc undefined. Ném FormulaError (kèm vị trí) khi phép không hợp lệ, vd chữ − số, ngày × số.
 */
export function inferType(tree, typeOf) {
  const bad = (msg, pos) => { throw new FormulaError(msg, pos ?? null); };
  const walk = (n) => {
    switch (n.k) {
      case 'num': return 'number';
      case 'str': return DAY_RE.test(n.v) && realDay(n.v) ? 'date' : 'text';
      case 'ref': return typeOf(n.name) ?? null;
      case 'neg': {
        const t = walk(n.e);
        if (t === 'date' || t === 'text') bad(`Dấu trừ chỉ dùng với số, không dùng với ${TYPE_NAME[t]}`, n.pos);
        return 'number';
      }
      case 'bin': {
        const l = walk(n.l), r = walk(n.r);
        if (CMP.includes(n.op)) return 'number';
        if (l === 'text' || r === 'text') bad(`Phép "${n.op}" không dùng với chữ. Muốn nối chữ, dùng CONCAT(a, b)`, n.pos);
        if (n.op === '*' || n.op === '/') {
          if (l === 'date' || r === 'date') bad(`Phép "${n.op}" không dùng với ngày. Muốn tính tuổi, dùng AGE({ngày sinh}); muốn đếm ngày, lấy ngày này trừ ngày kia`, n.pos);
          return 'number';
        }
        if (l === 'date' && r === 'date') return n.op === '-' ? 'number' : bad('Không cộng hai ngày với nhau được. Muốn đếm số ngày giữa hai ngày, lấy ngày này trừ ngày kia', n.pos);
        if (l === 'date') return 'date';
        if (r === 'date') return n.op === '+' ? 'date' : bad('Không lấy số trừ đi một ngày được. Muốn lùi ngày, viết {ngày} - số', n.pos);
        return l === null || r === null ? null : 'number';
      }
      case 'call': {
        const ts = n.args.map(walk);
        const want = (i, kind, hint) => {
          if (ts[i] === null || ts[i] === kind) return;
          bad(`${n.name} cần ${TYPE_NAME[kind] === 'số' ? 'một số' : 'một ngày'}, nhưng đang là ${TYPE_NAME[ts[i]]}.${hint ? ` ${hint}` : ''}`, n.args[i].pos ?? n.pos);
        };
        switch (n.name) {
          case 'TODAY': return 'date';
          case 'DATE': ts.forEach((_, i) => want(i, 'number')); return 'date';
          case 'AGE': case 'DAY': case 'YEAR': case 'MONTH': want(0, 'date', n.name === 'YEAR' ? 'Nếu đã có sẵn năm sinh dạng số thì dùng thẳng, không cần YEAR.' : ''); return 'number';
          case 'DAYS_BETWEEN': case 'MONTHS_BETWEEN': want(0, 'date'); want(1, 'date'); return 'number';
          case 'ROUND': ts.forEach((_, i) => want(i, 'number')); return 'number';
          case 'ABS': case 'MIN': case 'MAX': ts.forEach((_, i) => want(i, 'number')); return 'number';
          case 'CONCAT': return 'text';
          case 'IF': { const [, a, b] = ts; return a === b ? a : null; }
          case 'COALESCE': { const known = ts.filter(Boolean); return known.length && known.every((t) => t === known[0]) ? known[0] : null; }
          default: return null;
        }
      }
    }
    return null;
  };
  return walk(tree);
}

export function calc(src, ctx) {
  return evaluate(parse(src), ctx);
}
