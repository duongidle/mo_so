// Đọc bảng đối soát do hãng vận chuyển gửi (Excel/CSV). Tên cột mỗi hãng một khác nên đoán theo từ khoá, người dùng chỉnh lại được.

export const FIELDS = [
  ['tracking_code', 'Mã vận đơn', true],
  ['outcome', 'Trạng thái (giao / hoàn)', false],
  ['cod_amount', 'Tiền COD thu hộ', false],
  ['ship_fee', 'Phí vận chuyển', false],
  ['cod_fee', 'Phí thu hộ (COD)', false],
  ['return_fee', 'Phí hoàn', false],
  ['other_fee', 'Phí khác (bảo hiểm, lưu kho…)', false],
];

const KEYWORDS = {
  tracking_code: ['ma van don', 'van don', 'tracking', 'ma don hang', 'order code', 'ma don'],
  outcome: ['trang thai', 'status'],
  cod_amount: ['tien thu ho', 'tien cod', 'cod thu', 'thu ho', 'cod'],
  cod_fee: ['phi cod', 'phi thu ho'],
  return_fee: ['phi hoan', 'phi chuyen hoan', 'cuoc hoan'],
  ship_fee: ['phi van chuyen', 'phi giao', 'cuoc phi', 'cuoc van chuyen', 'phi ship', 'cuoc'],
  other_fee: ['phi khac', 'bao hiem', 'luu kho', 'dong kiem', 'phi phat sinh'],
};

export const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

/** Chọn cột cho từng trường: ưu tiên cụm từ cụ thể trước (phí COD trước COD), mỗi cột chỉ dùng một lần */
export function guessMapping(columns) {
  const used = new Set();
  const map = {};
  const order = ['cod_fee', 'return_fee', 'other_fee', 'ship_fee', 'cod_amount', 'tracking_code', 'outcome'];
  for (const f of order) {
    let found = null;
    for (const kw of KEYWORDS[f]) {
      found = columns.find((c) => !used.has(c) && plain(c).includes(kw));
      if (found) break;
    }
    if (found) { map[f] = found; used.add(found); }
  }
  return map;
}

/** "1.250.000", "1,250,000 đ", "1250000" → số nguyên đồng */
export function toMoney(v) {
  if (typeof v === 'number') return Math.max(0, Math.round(v));
  const digits = String(v ?? '').replace(/[^\d-]/g, '');
  return digits ? Math.max(0, parseInt(digits, 10)) : 0;
}

const RETURNED = ['hoan', 'return', 'tra lai', 'chuyen hoan'];
export const outcomeOf = (v) => (RETURNED.some((k) => plain(v).includes(k)) ? 'returned' : 'delivered');

/** Chuyển các dòng của file thành dòng gửi lên máy chủ; bỏ dòng không có mã vận đơn */
export function rowsFromSheet(rows, map) {
  return rows
    .map((r) => ({
      tracking_code: String(r[map.tracking_code] ?? '').trim(),
      outcome: map.outcome ? outcomeOf(r[map.outcome]) : 'delivered',
      cod_amount: map.cod_amount ? toMoney(r[map.cod_amount]) : 0,
      ship_fee: map.ship_fee ? toMoney(r[map.ship_fee]) : 0,
      cod_fee: map.cod_fee ? toMoney(r[map.cod_fee]) : 0,
      return_fee: map.return_fee ? toMoney(r[map.return_fee]) : 0,
      other_fee: map.other_fee ? toMoney(r[map.other_fee]) : 0,
    }))
    .filter((r) => r.tracking_code);
}
