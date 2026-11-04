import { useEffect, useRef } from 'react';

/**
 * Báo form có thay đổi chưa lưu. Mốc so sánh chốt sau khi form dựng xong (các ô tự điền như SKU sinh từ tên
 * chạy ngay lúc mở không tính là người dùng sửa).
 */
export function useDirty(value, onDirty) {
  const base = useRef(null);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const t = setTimeout(() => { base.current = JSON.stringify(latest.current); onDirty?.(false); }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (base.current !== null) onDirty?.(JSON.stringify(value) !== base.current); }, [value, onDirty]);
}
