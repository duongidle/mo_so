import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDirty } from '../components/useDirty.js';

describe('useDirty', () => {
  it('thay đổi tự động (nạp dữ liệu, tự điền) không làm form bẩn; chỉ sau khi người dùng chạm vào form mới so với mốc', () => {
    const onDirty = vi.fn();
    const { rerender } = renderHook(({ v }) => useDirty(v, onDirty), { initialProps: { v: { name: '', sku: '' } } });
    // Tự điền SKU sau khi mở: không có sự kiện người dùng → chưa bẩn
    rerender({ v: { name: '', sku: 'AUTO' } });
    rerender({ v: { name: 'Tự nạp', sku: 'AUTO' } });
    expect(onDirty).not.toHaveBeenCalled();
    // Người dùng gõ: mốc chốt ngay trước lần sửa đầu tiên (đã gồm phần tự điền)
    act(() => { document.dispatchEvent(new Event('input', { bubbles: true })); });
    rerender({ v: { name: 'Tự nạp', sku: 'AUTO' } });
    expect(onDirty).toHaveBeenLastCalledWith(false);
    rerender({ v: { name: 'Người dùng sửa', sku: 'AUTO' } });
    expect(onDirty).toHaveBeenLastCalledWith(true);
    rerender({ v: { name: 'Tự nạp', sku: 'AUTO' } });
    expect(onDirty).toHaveBeenLastCalledWith(false);
  });
});
