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
