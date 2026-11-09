import { describe, expect, it } from 'vitest';
import { flowOf } from '../lib/orderFlow.js';

const h = (...to) => to.map((t, i) => ({ to_status: t, created_at: `2026-11-0${i + 1}T01:00:00.000Z` }));
const states = (o) => flowOf(o).steps.map((s) => s.state).join(',');

describe('flowOf: các bước của đơn', () => {
  it('đơn nháp: chờ xác nhận', () => {
    expect(states({ status: 'draft', history: h('draft') })).toBe('done,current,todo,todo,todo');
  });
  it('đã xác nhận, chưa đóng gói: chờ đóng gói', () => {
    expect(states({ status: 'confirmed', history: h('draft', 'confirmed') })).toBe('done,done,current,todo,todo');
  });
  it('đã đóng gói: chờ giao hàng', () => {
    expect(states({ status: 'confirmed', packaged_at: '2026-11-02T02:00:00.000Z', history: h('draft', 'confirmed') })).toBe('done,done,done,current,todo');
  });
  it('đang giao mà bỏ qua đóng gói: đóng gói ghi bỏ qua, chờ hoàn thành', () => {
    expect(states({ status: 'shipping', history: h('draft', 'confirmed', 'shipping') })).toBe('done,done,skipped,done,current');
  });
  it('hoàn thành thẳng từ đã xác nhận: bỏ qua đóng gói và giao hàng', () => {
    expect(states({ status: 'completed', history: h('draft', 'confirmed', 'completed') })).toBe('done,done,skipped,skipped,done');
  });
  it('huỷ: giữ các bước đã qua, thêm điểm cuối Đã huỷ, không có bước đang chờ', () => {
    const f = flowOf({ status: 'cancelled', history: h('draft', 'confirmed', 'cancelled') });
    expect(f.steps.map((s) => s.state).join(',')).toBe('done,done,todo,todo,todo');
    expect(f.end.label).toBe('Đã huỷ');
  });
  it('huỷ từ nháp: bước Xác nhận không được chốt', () => {
    expect(states({ status: 'cancelled', history: h('draft', 'cancelled') })).toBe('done,todo,todo,todo,todo');
  });
  it('trả hàng toàn phần: mọi bước đã qua, có điểm cuối Trả hàng', () => {
    const f = flowOf({ status: 'returned', history: h('draft', 'confirmed', 'shipping', 'completed', 'returned') });
    expect(f.steps.every((s) => s.state === 'done' || s.state === 'skipped')).toBe(true);
    expect(f.end.label).toBe('Trả hàng');
  });
});
