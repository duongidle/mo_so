// Hàm thuần cho nhập đơn từ file: đọc số, chuẩn hoá tên cột, gom dòng thành đơn. Không đụng giao diện để test được.

/** Chuẩn hoá Unicode NFC + bỏ khoảng trắng hai đầu (Shopee ghi tên cột ở dạng NFD) */
export const nfc = (s) => String(s ?? '').normalize('NFC').trim();

// Tách dấu thập phân / dấu nghìn. money: một dấu đứng riêng + đúng 3 chữ số sau + tối đa 3 chữ số trước ("18.000", "1,250") là dấu nghìn.
function parseNumber(v, money) {
  if (v === undefined || v === null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  const neg = /^[^\d]*[-−–]/.test(s) || /^\(.*\)$/.test(s);
  const t = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(t)) return 0;
  const dot = t.lastIndexOf('.');
  const comma = t.lastIndexOf(',');
  let out;
  if (dot >= 0 && comma >= 0) {
    const dec = Math.max(dot, comma);
    out = `${t.slice(0, dec).replace(/[.,]/g, '')}.${t.slice(dec + 1)}`;
  } else if (dot >= 0 || comma >= 0) {
    const sep = dot >= 0 ? '.' : ',';
    const idx = Math.max(dot, comma);
    const count = t.split(sep).length - 1;
    const after = t.length - idx - 1;
    const before = t.slice(0, idx);
    if (count > 1) out = t.split(sep).join('');
    else if (money && after === 3 && before.length >= 1 && before.length <= 3 && !before.startsWith('0')) out = before + t.slice(idx + 1);
    else out = `${before}.${t.slice(idx + 1)}`;
  } else out = t;
  const n = Number(out);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

/** Tiền: số nguyên đồng. "18000.00", "18,000.00", "18.000", "1.250.000", "1.250.000,50", "-6000.00" */
export const toMoney = (v) => {
  const n = Math.round(parseNumber(v, true));
  return n === 0 ? 0 : n; // tránh -0
};
/** Số lượng: giữ tối đa 3 chữ số lẻ ("0.5" → 0.5, "1,5" → 1.5, "2" → 2) */
export const toQty = (v) => Math.round(parseNumber(v, false) * 1000) / 1000;

// "2026-11-03 14:30:00" (giờ VN) → ISO có múi giờ; chuỗi khác để server tự hiểu
export const toDate = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/) || s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return s;
  const iso = s.match(/^\d{4}/) ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  return `${iso.join('-')}T${m[4] || '12'}:${m[5] || '00'}:${m[6] || '00'}+07:00`;
};

const cols = (col) => (col === undefined || col === null || col === '' ? [] : Array.isArray(col) ? col : [col]);

/** Mẫu map cột với tên cột đã chuẩn hoá NFC */
export function normalizeMap(map) {
  return Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(nfc) : nfc(v)]));
}
function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[nfc(k)] = v;
  return out;
}

/**
 * Các cột mẫu mong đợi mà file thật sự thiếu, sau khi chuẩn hoá NFC.
 * `options.column_aliases`: nhóm tên cột thay thế nhau (vd [["Phí xử lý giao dịch","Phí thanh toán"]]): có một tên trong nhóm là đủ.
 * Trả [[khoá, tên cột]].
 */
export function missingColumns(fileColumns, map, options = {}) {
  const have = new Set((fileColumns || []).map(nfc));
  const groups = (options?.column_aliases || []).map((g) => g.map(nfc));
  const out = [];
  for (const [k, v] of Object.entries(normalizeMap(map))) {
    if (k === 'sku_fallback') continue;
    for (const c of cols(v)) {
      if (have.has(c)) continue;
      const g = groups.find((x) => x.includes(c));
      if (g && g.some((x) => have.has(x))) continue;
      out.push([k, c]);
    }
  }
  return out;
}

/** Gom các dòng của cùng 1 mã đơn thành 1 đơn theo mẫu map cột */
export function rowsToOrders(rawRows, rawMap) {
  const map = normalizeMap(rawMap);
  const rows = rawRows.map(normalizeRow);
  const pick = (row, key) => cols(map[key]).map((c) => row[c]).filter((v) => v !== undefined);
  const first = (row, key) => (map[key] ? pick(row, key)[0] : undefined);
  const sum = (row, key) => (map[key] ? pick(row, key).reduce((a, v) => a + toMoney(v), 0) : 0);
  const by = new Map();
  const errors = [];
  rows.forEach((row, i) => {
    const id = first(row, 'external_id');
    if (id === undefined || id === '') return errors.push(`Dòng ${i + 2}: thiếu mã đơn`);
    const sku = first(row, 'sku') || (map.sku_fallback && first(row, 'sku_fallback'));
    if (!sku) return errors.push(`Dòng ${i + 2} (đơn ${id}): thiếu SKU`);
    const rawQty = first(row, 'qty');
    const qty = toQty(rawQty) || 1;
    if (!Number.isInteger(qty) || qty < 0) return errors.push(`Dòng ${i + 2} (đơn ${id}): số lượng "${rawQty}" không phải số nguyên dương`);
    const rawPrice = first(row, 'unit_price');
    const price = map.unit_price && rawPrice !== undefined && rawPrice !== '' ? toMoney(rawPrice) : undefined;
    if (!by.has(String(id))) {
      by.set(String(id), {
        external_id: String(id), status: first(row, 'status') || null, ordered_at: toDate(first(row, 'ordered_at')),
        customer: { name: first(row, 'customer_name') || null, phone: first(row, 'customer_phone') || null, shopee_username: first(row, 'shopee_username') || null },
        shipping_address: first(row, 'shipping_address') || null,
        // Giảm giá cả đơn không âm: Shopee có khoản âm (vd điều chỉnh combo), cộng cùng khoản giảm khác rồi chặn ở 0
        ...(map.order_discount ? { discount_amount: Math.max(0, sum(row, 'order_discount')) } : {}),
        shipping_fee: sum(row, 'shipping_fee'),
        platform_fee_amount: sum(row, 'platform_fee'), seller_shipping_amount: sum(row, 'seller_shipping'), note: first(row, 'note') || null,
        tracking_code: first(row, 'tracking_code') || null, carrier: first(row, 'carrier') || null, paid_amount: sum(row, 'paid_amount'), lines: [],
      });
    }
    const line = { sku: String(sku).trim(), qty, ...(price !== undefined ? { unit_price: price } : {}), ...(map.line_discount ? { discount_amount: Math.max(0, sum(row, 'line_discount')) } : {}) };
    const rs = first(row, 'return_status');
    const rq = toQty(first(row, 'returned_qty'));
    if ((rs !== undefined && rs !== '') || rq > 0) {
      if (rs) line.return_status = String(rs).trim();
      if (rq > 0) line.returned_qty = Math.floor(rq);
    }
    by.get(String(id)).lines.push(line);
  });
  return { orders: [...by.values()], errors };
}
