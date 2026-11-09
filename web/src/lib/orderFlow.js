/** Các bước của một đơn bán, dựng từ trạng thái + lịch sử + việc đóng gói (hàm thuần, có test).
 *  Mỗi bước: done (đã qua, có mốc thời gian), current (việc cần làm tiếp), skipped (đã bỏ qua), todo (chưa tới). */
export function flowOf(o) {
  const hist = o.history || [];
  const at = (s) => hist.find((h) => h.to_status === s)?.created_at || null;
  const passed = (s) => hist.some((h) => h.to_status === s);
  const st = o.status;
  const finished = st === 'completed' || st === 'returned';
  const done = {
    draft: true,
    confirmed: st !== 'draft' && (st !== 'cancelled' || passed('confirmed')),
    packaging: !!o.packaged_at,
    shipping: passed('shipping'),
    completed: finished,
  };
  const skipped = {
    packaging: !done.packaging && (done.shipping || done.completed),
    shipping: !done.shipping && done.completed,
  };
  const steps = [
    { key: 'draft', label: 'Tạo đơn', at: o.ordered_at || o.created_at },
    { key: 'confirmed', label: 'Xác nhận', at: at('confirmed'), note: 'Đã trừ kho' },
    { key: 'packaging', label: 'Đóng gói', at: o.packaged_at },
    { key: 'shipping', label: 'Giao hàng', at: at('shipping'), note: o.carrier || '' },
    { key: 'completed', label: 'Hoàn thành', at: at('completed') },
  ].map((s) => ({ ...s, state: done[s.key] ? 'done' : skipped[s.key] ? 'skipped' : 'todo' }));
  if (['draft', 'confirmed', 'shipping'].includes(st)) {
    const next = steps.find((s) => s.state === 'todo');
    if (next) next.state = 'current';
  }
  const end = st === 'cancelled' ? { key: 'cancelled', label: 'Đã huỷ', at: at('cancelled'), tone: 'bad' }
    : st === 'returned' ? { key: 'returned', label: 'Trả hàng', at: at('returned'), tone: 'warn' } : null;
  return { steps, end };
}
