// Biến thể dạng ma trận: sinh bảng tổ hợp từ các thuộc tính, mã SKU tự sinh. Hàm thuần để dễ test.

/** "Cam bergamot 10ml" → "CAM-BERGAMOT-10ML" (không dấu, viết hoa, chỉ A-Z 0-9 và dấu gạch) */
export const slug = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Mã gốc từ tên sản phẩm: "Tinh dầu thơm" → "TINHDAUT" (tối đa 8 ký tự, bỏ gạch) */
export const skuBase = (name) => slug(name).replace(/-/g, '').slice(0, 8) || 'SP';

export const skuFor = (base, values) => [base, ...values.map(slug)].filter(Boolean).join('-');

/** Chỉ giữ thuộc tính có tên và ít nhất một giá trị; giá trị trùng (không phân biệt hoa thường) bị bỏ */
export function cleanOptions(options) {
  return (options || [])
    .map((o) => {
      const seen = new Set();
      const values = [];
      for (const raw of o.values || []) {
        const v = String(raw).trim();
        if (v && !seen.has(v.toLowerCase())) (seen.add(v.toLowerCase()), values.push(v));
      }
      return { name: String(o.name || '').trim(), values };
    })
    .filter((o) => o.name && o.values.length);
}

/** Mọi tổ hợp giá trị theo thứ tự thuộc tính: [{Mùi:'Cam',Size:'10ml'}, …]. Không có thuộc tính → []. */
export function combinations(options) {
  const opts = cleanOptions(options);
  if (!opts.length) return [];
  return opts.reduce((acc, o) => acc.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v }))), [{}]);
}

export const comboKey = (ov, options) => cleanOptions(options).map((o) => ov?.[o.name] ?? '').join('\u0001');

/** Làm SKU duy nhất trong danh sách bằng cách thêm hậu tố -2, -3… cho dòng sau (không đụng dòng đầu) */
export function dedupeSkus(skus) {
  const seen = new Set();
  return skus.map((s) => {
    let out = s;
    for (let n = 2; seen.has(out.toLowerCase()); n++) out = `${s}-${n}`;
    seen.add(out.toLowerCase());
    return out;
  });
}

/**
 * Ghép bảng tổ hợp mới với các dòng đã nhập: tổ hợp đã có giữ nguyên mọi thứ người dùng đã điền,
 * tổ hợp mới thêm dòng mới (SKU tự sinh), tổ hợp không còn thì vào `removed`.
 * `defaults` là giá trị điền sẵn cho dòng mới (giá bán, giá vốn…).
 */
export function mergeRows(rows, options, { base, defaults = {} } = {}) {
  const combos = combinations(options);
  const byKey = new Map(rows.map((r) => [comboKey(r.option_values, options), r]));
  const used = new Set();
  const names = cleanOptions(options).map((o) => o.name);
  const next = combos.map((ov) => {
    const k = comboKey(ov, options);
    used.add(k);
    const old = byKey.get(k);
    if (old) return { ...old, option_values: ov };
    return { sku: skuFor(base, names.map((n) => ov[n])), autoSku: true, option_values: ov, active: true, default_price: 0, opening_cost: '', opening_qty: '', barcode: '', min_stock: 0, image_id: null, ...defaults };
  });
  const skus = dedupeSkus(next.map((r) => r.sku));
  skus.forEach((s, i) => { if (next[i].autoSku) next[i] = { ...next[i], sku: s }; });
  return { rows: next, removed: rows.filter((r) => !used.has(comboKey(r.option_values, options))) };
}

/** Điền cùng một giá trị cho mọi dòng ở các cột có nhập (chuỗi rỗng = không đổi cột đó) */
export function applyToAll(rows, patch) {
  const keep = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  return rows.map((r) => ({ ...r, ...keep }));
}

/** Đổi mã gốc: các dòng còn dùng SKU tự sinh được sinh lại, dòng người dùng đã sửa tay giữ nguyên */
export function rebaseSkus(rows, options, base) {
  const names = cleanOptions(options).map((o) => o.name);
  const out = rows.map((r) => (r.autoSku && !r.id ? { ...r, sku: skuFor(base, names.map((n) => r.option_values[n])) } : r));
  const skus = dedupeSkus(out.map((r) => r.sku));
  return out.map((r, i) => (r.autoSku && !r.id ? { ...r, sku: skus[i] } : r));
}

// ---------- Chuyển sản phẩm đã có sang ma trận / đổi thuộc tính ----------

const keyOf = (ov, names) => names.map((n) => ov?.[n] ?? '').join('\u0001');

/** Nhãn dễ đọc của một tổ hợp: "Cam / 10ml" */
export const comboLabel = (ov) => Object.values(ov || {}).join(' / ');

/** Các tổ hợp kèm khoá và nhãn, để làm ô chọn "Biến thể hiện có là…" */
export function comboChoices(options) {
  const names = cleanOptions(options).map((o) => o.name);
  return combinations(options).map((ov) => ({ key: keyOf(ov, names), label: comboLabel(ov), ov }));
}

/**
 * Ghép các biến thể ĐÃ CÓ (có id) và dòng mới vào bảng tổ hợp của bộ thuộc tính hiện tại.
 *  - Biến thể đã có đủ giá trị thuộc tính hợp lệ: giữ nguyên tổ hợp của nó (khoá thừa của thuộc tính đã xoá bị bỏ).
 *  - Chưa có giá trị nào (vừa chuyển từ sản phẩm thường) hoặc thiếu một vài thuộc tính mới thêm: gán vào tổ hợp còn trống
 *    khớp phần đã có, mặc định là tổ hợp đầu tiên còn trống.
 *  - Có giá trị không còn trong danh sách (đã bỏ giá trị), hoặc hết tổ hợp trống: vào `removed`.
 *  - Tổ hợp chưa có biến thể nào: dòng mới (giữ dòng mới đã nhập nếu có).
 * Hai biến thể đã có cùng một tổ hợp (người dùng chọn trùng) vẫn được giữ để giao diện báo lỗi, không tự sửa.
 * Chưa có tổ hợp nào (chưa nhập giá trị) thì không đổi gì.
 */
export function reconcile(rows, options, { base, defaults = {} } = {}) {
  const opts = cleanOptions(options);
  const names = opts.map((o) => o.name);
  const combos = combinations(options);
  if (!combos.length) return { rows, removed: [] };
  const valid = (n, v) => opts.find((o) => o.name === n).values.includes(v);
  const existing = rows.filter((r) => r.id);
  const fresh = new Map(rows.filter((r) => !r.id).map((r) => [keyOf(r.option_values, names), r]));
  const mapped = []; // { row, key }
  const pending = [];
  const removed = [];
  for (const r of existing) {
    const ov = Object.fromEntries(names.filter((n) => r.option_values?.[n] !== undefined).map((n) => [n, r.option_values[n]]));
    if (Object.keys(ov).some((n) => !valid(n, ov[n]))) { removed.push(r); continue; }
    if (names.every((n) => n in ov)) mapped.push({ row: { ...r, option_values: ov }, key: keyOf(ov, names) });
    else pending.push({ row: r, ov });
  }
  const taken = new Set(mapped.map((m) => m.key));
  for (const p of pending) {
    const match = combos.find((c) => !taken.has(keyOf(c, names)) && Object.keys(p.ov).every((n) => c[n] === p.ov[n]));
    if (!match) { removed.push(p.row); continue; }
    taken.add(keyOf(match, names));
    mapped.push({ row: { ...p.row, option_values: match }, key: keyOf(match, names) });
  }
  const out = [];
  for (const c of combos) {
    const k = keyOf(c, names);
    const here = mapped.filter((m) => m.key === k);
    if (here.length) out.push(...here.map((m) => m.row));
    else {
      const old = fresh.get(k);
      const row = old ? { ...old, option_values: c } : { sku: skuFor(base, names.map((n) => c[n])), autoSku: true, option_values: c, active: true, default_price: 0, opening_cost: '', opening_qty: '', barcode: '', min_stock: 0, image_id: null, ...defaults };
      out.push(row);
    }
  }
  // SKU tự sinh của dòng mới không được trùng SKU nào đang có
  const all = out.map((r) => r.sku);
  const unique = dedupeSkus(all);
  const final = out.map((r, i) => (r.autoSku && !r.id && r.sku !== unique[i] ? { ...r, sku: unique[i] } : r));
  return { rows: final, removed };
}

/** Chọn tổ hợp cho một biến thể đã có (ô "Biến thể hiện có là"): dòng mới đang chiếm tổ hợp đó bị bỏ, rồi ghép lại */
export function assignCombo(rows, options, index, ov, ctx) {
  const names = cleanOptions(options).map((o) => o.name);
  const k = keyOf(ov, names);
  const next = rows.filter((r, i) => i === index || r.id || keyOf(r.option_values, names) !== k).map((r) => r);
  const target = rows[index];
  const idx = next.indexOf(target);
  next[idx] = { ...target, option_values: ov };
  return reconcile(next, options, ctx);
}

/** Có hai biến thể đang bán cùng một tổ hợp thuộc tính không */
export function hasDuplicateCombos(rows, options) {
  const names = cleanOptions(options).map((o) => o.name);
  const seen = new Set();
  for (const r of rows) {
    if (r.active === false) continue;
    const k = keyOf(r.option_values, names);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

/** Ghi lại việc đổi tên một thuộc tính (nối tiếp nhiều lần đổi thành một bước từ tên gốc → tên cuối) */
export function noteAttrRename(renames, oldName, newName) {
  if (oldName === newName) return renames;
  const i = renames.findIndex((r) => r.to === oldName);
  if (i >= 0) return renames.map((r, j) => (j === i ? { ...r, to: newName } : r));
  return [...renames, { from: oldName, to: newName, values: {} }];
}

/** Ghi lại việc đổi tên một giá trị của thuộc tính `attr` (tên hiện tại) */
export function noteValueRename(renames, attr, oldVal, newVal) {
  if (oldVal === newVal) return renames;
  let i = renames.findIndex((r) => r.to === attr);
  const list = i >= 0 ? renames : [...renames, { from: attr, to: attr, values: {} }];
  if (i < 0) i = list.length - 1;
  const cur = list[i].values;
  const origKey = Object.keys(cur).find((k) => cur[k] === oldVal) ?? oldVal;
  return list.map((r, j) => (j === i ? { ...r, values: { ...cur, [origKey]: newVal } } : r));
}

/** Chỉ gửi những bước đổi nhãn thật sự thay đổi gì đó */
export function effectiveRenames(renames) {
  return renames
    .map((r) => ({ ...r, values: Object.fromEntries(Object.entries(r.values || {}).filter(([k, v]) => k !== v)) }))
    .filter((r) => r.from !== r.to || Object.keys(r.values).length)
    .map((r) => (Object.keys(r.values).length ? r : { from: r.from, to: r.to }));
}
