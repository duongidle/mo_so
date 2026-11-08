// Hàm thuần cho form tạo/sửa đơn: tính tiền, kiểm phân bổ kho, dựng payload. Không đụng React hay API để test được.

export const toMoney = (v) => Math.max(0, Math.round(Number(v) || 0));
export const toQty = (v) => Math.max(0, Math.floor(Number(v) || 0));

let seq = 0;
export const newUid = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Dòng đơn từ một biến thể trả về bởi GET /variants */
export function lineFromVariant(v) {
  return {
    uid: newUid(),
    variant_id: v.id,
    sku: v.sku,
    kind: v.kind || 'single',
    name: v.variant_name ? `${v.product_name} — ${v.variant_name}` : v.product_name,
    image_url: v.image_url || null,
    qty: 1,
    price: toMoney(v.price),
    discount: 0,
    avg_cost: v.avg_cost ?? null,
    on_hand_total: v.on_hand_total ?? v.on_hand ?? null,
    stock_by_warehouse: v.stock_by_warehouse || [],
  };
}

/** Thêm sản phẩm vào danh sách dòng: đã có thì tăng SL (dòng có phân bổ tay thì bị bỏ phân bổ vì SL đổi) */
export function addVariant(lines, v) {
  const i = lines.findIndex((l) => l.variant_id === v.id);
  if (i < 0) return [...lines, lineFromVariant(v)];
  return lines.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
}

const grossOf = (l) => l.qty * l.price;
export const lineTotal = (l) => Math.max(0, grossOf(l) - l.discount);

/**
 * Tính tiền theo đúng công thức của server (computeHeader).
 * - subtotal = Σ đơn giá × SL; goods = subtotal − giảm giá dòng − giảm giá đơn
 * - total (khách phải trả) = goods + phí ship khách trả
 * - net (shop thực nhận) = total − phí sàn − ship shop chịu. Phí sàn chỉ tính khi kênh là sàn; ship shop chịu tính ở mọi kênh.
 * - amountDue: kênh sàn thu `net` (sàn trừ phí rồi mới trả shop), kênh khác thu `total`
 * - profit: net − giá vốn ước tính (giá vốn bình quân hiện tại, chưa phải giá vốn chụp lúc xác nhận); null nếu thiếu giá vốn
 */
export function computeTotals({ lines, discount = 0, shipping = 0, platformFee = 0, sellerShipping = 0, marketplace = false }) {
  const subtotal = lines.reduce((a, l) => a + grossOf(l), 0);
  const lineDiscount = lines.reduce((a, l) => a + Math.min(l.discount, grossOf(l)), 0);
  const afterLines = subtotal - lineDiscount;
  const orderDiscount = Math.min(toMoney(discount), afterLines);
  const goods = afterLines - orderDiscount;
  const total = goods + toMoney(shipping);
  const fee = marketplace ? toMoney(platformFee) : 0;
  const ship = toMoney(sellerShipping); // ship shop chịu: mọi kênh (sàn trừ vào tiền sàn trả, kênh khác shop trả hãng vận chuyển)
  const net = total - fee - ship;
  const known = lines.length > 0 && lines.every((l) => l.avg_cost !== null && l.avg_cost !== undefined);
  const cogs = known ? lines.reduce((a, l) => a + l.qty * l.avg_cost, 0) : null;
  return { subtotal, lineDiscount, afterLines, orderDiscount, goods, total, fee, ship, net, cogs, profit: known ? net - cogs : null, amountDue: marketplace ? net : total };
}

// ---------- Phân bổ kho ----------
/*
 * Một "bản sửa tay" của một dòng: { qty, required: { [variant_id]: SL cần }, cells: { [variant_id]: { [warehouse_id]: SL } } }.
 * `qty` là SL của dòng lúc sửa; dòng đổi SL thì bản sửa không còn đúng và bị bỏ (về tự động).
 */
export const activeEdit = (line, edit) => (edit && edit.qty === line.qty ? edit : null);

/** Bản sửa tay khởi tạo từ phân bổ đề xuất của server (một dòng trong kết quả allocation-preview) */
export function startEdit(line, previewLine) {
  const required = {};
  const cells = {};
  for (const it of previewLine?.items || []) {
    required[it.variant_id] = (required[it.variant_id] || 0) + it.qty;
    cells[it.variant_id] = { ...(cells[it.variant_id] || {}), [it.warehouse_id]: (cells[it.variant_id]?.[it.warehouse_id] || 0) + it.qty };
  }
  return { qty: line.qty, required, cells };
}

/** Bản sửa tay từ phân bổ đã lưu của đơn nháp (planned_allocations) */
export function editFromPlanned(line, planned, singleVariantId) {
  if (!planned?.length) return null;
  const required = {};
  const cells = {};
  for (const a of planned) {
    const vid = a.variant_id || singleVariantId;
    required[vid] = (required[vid] || 0) + a.qty;
    cells[vid] = { ...(cells[vid] || {}), [a.warehouse_id]: (cells[vid]?.[a.warehouse_id] || 0) + a.qty };
  }
  return { qty: line.qty, required, cells };
}

export function setCell(edit, variantId, warehouseId, qty) {
  return { ...edit, cells: { ...edit.cells, [variantId]: { ...(edit.cells[variantId] || {}), [warehouseId]: toQty(qty) } } };
}

/** Các biến thể mà tổng phân bổ không bằng SL cần: [{ variant_id, sum, required }] */
export function editMismatches(edit) {
  if (!edit) return [];
  return Object.entries(edit.required)
    .map(([variant_id, required]) => ({ variant_id, required, sum: Object.values(edit.cells[variant_id] || {}).reduce((a, n) => a + n, 0) }))
    .filter((m) => m.sum !== m.required);
}

/** Phân bổ gửi lên server: [{ variant_id, warehouse_id, qty }], bỏ ô 0 */
export function editToAllocations(edit) {
  return Object.entries(edit.cells).flatMap(([variant_id, byWh]) =>
    Object.entries(byWh).filter(([, qty]) => qty > 0).map(([warehouse_id, qty]) => ({ variant_id, warehouse_id, qty })),
  );
}

/** Các dòng có bản sửa tay đang còn hiệu lực; trả về cả những dòng lệch SL (để chặn lưu) */
export function allocationProblems(lines, edits) {
  const out = [];
  lines.forEach((l, index) => {
    const e = activeEdit(l, edits[l.uid]);
    if (e && editMismatches(e).length) out.push({ index, uid: l.uid, mismatches: editMismatches(e) });
  });
  return out;
}

/** Dòng gửi lên server (preview và đơn): chỉ kèm allocations khi bản sửa tay còn hiệu lực và khớp SL */
export function serverLines(lines, edits, { withPrice = true } = {}) {
  return lines.map((l) => {
    const e = activeEdit(l, edits[l.uid]);
    const out = { variant_id: l.variant_id, qty: l.qty };
    if (l.is_gift) out.is_gift = true; // dòng quà tặng kèm giữ cờ khi sửa đơn nháp
    if (withPrice) { out.unit_price = l.price; out.discount_amount = Math.min(l.discount, grossOf(l)); }
    if (e && !editMismatches(e).length) out.allocations = editToAllocations(e);
    return out;
  });
}

/** Số tiền thu theo hành động: Bán xong → mặc định thu đủ; Xác nhận → chỉ thu khi người dùng chủ động nhập; Lưu nháp → không thu */
export function paymentsFor(status, paidInput, due, method) {
  const typed = paidInput !== '' && paidInput !== null && paidInput !== undefined;
  let amount = 0;
  if (status === 'completed') amount = typed ? toMoney(paidInput) : due;
  else if (status === 'confirmed' || status === 'shipping') amount = typed ? toMoney(paidInput) : 0;
  return amount > 0 ? [{ amount, method }] : [];
}

/** Kiểm trước khi gửi: trả về danh sách lỗi tiếng Việt (rỗng = hợp lệ) */
export function validateForm({ lines, discount, edits, totals }) {
  const errors = [];
  if (!lines.length) errors.push('Đơn cần ít nhất 1 sản phẩm.');
  lines.forEach((l) => {
    if (l.qty < 1) errors.push(`${l.sku}: số lượng phải từ 1.`);
    if (l.discount > grossOf(l)) errors.push(`${l.sku}: giảm giá dòng lớn hơn thành tiền.`);
  });
  if (toMoney(discount) > totals.afterLines) errors.push('Giảm giá đơn lớn hơn tiền hàng.');
  for (const p of allocationProblems(lines, edits)) {
    const l = lines[p.index];
    const m = p.mismatches[0];
    errors.push(`Lấy hàng từ kho của ${l.sku}: đang chia ${m.sum}, cần ${m.required}.`);
  }
  return errors;
}

/** Payload tạo/sửa đơn */
export function buildPayload({ shopId, channelId, externalId, customerId, address, lines, edits, discount, shipping, platformFee, sellerShipping, marketplace, note, dueDate, status, payments }) {
  const body = {
    customer_id: customerId || null,
    shipping_address: address?.trim() || null,
    lines: serverLines(lines, edits),
    discount_amount: toMoney(discount),
    shipping_fee: toMoney(shipping),
    platform_fee_amount: marketplace ? toMoney(platformFee) : 0,
    seller_shipping_amount: toMoney(sellerShipping),
    note: note?.trim() || null,
    due_date: dueDate || null,
  };
  if (status === undefined) return body; // sửa đơn nháp: không đổi shop/kênh/trạng thái
  return { shop_id: shopId, channel_id: channelId, external_id: externalId?.trim() || null, ...body, status, payments: payments || [] };
}

/** Tóm tắt kho đề xuất cho một dòng (kết quả allocation-preview): có phần nào phải lấy ngoài kho chính, có thiếu không */
export function previewNotes(preview) {
  if (!preview) return { elsewhere: [], short: [] };
  const primary = preview.primary_warehouse_id;
  const elsewhere = preview.lines.flatMap((l) => l.items.filter((it) => it.warehouse_id !== primary && it.qty > 0).map((it) => ({ sku: it.sku, qty: it.qty, warehouse_name: it.warehouse_name })));
  return { elsewhere, short: preview.shortages || [] };
}
