import { useEffect, useRef } from 'react';

// Sự kiện của NGƯỜI DÙNG đụng vào form. Nghe ở pha capture trên document: chạy TRƯỚC trình xử lý onChange của React,
// nên lúc đó `value` vẫn là giá trị trước khi sửa.
const USER_EVENTS = ['input', 'change', 'click', 'keydown', 'paste', 'drop'];

/**
 * Báo form có thay đổi chưa lưu, KHÔNG dùng đồng hồ.
 * Mốc "chưa sửa" được chốt đúng lúc người dùng chạm vào form lần đầu (nhập, bấm chọn, dán…), tức là sau khi mọi bước
 * nạp dữ liệu và tự điền (SKU sinh từ tên, giá trị mặc định…) đã xong, vì các bước đó không phải sự kiện của người dùng.
 * Trước lần chạm đầu tiên form luôn "sạch": mở rồi rời đi không bao giờ bị hỏi. Từ đó trở đi, dirty = giá trị khác mốc.
 * Lưu xong thì form gọi `onDirty(false)` trước khi chuyển trang.
 */
export function useDirty(value, onDirty) {
  const base = useRef(null);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const grab = () => { if (base.current === null) base.current = JSON.stringify(latest.current); };
    for (const e of USER_EVENTS) document.addEventListener(e, grab, true);
    return () => { for (const e of USER_EVENTS) document.removeEventListener(e, grab, true); };
  }, []);
  useEffect(() => {
    if (base.current !== null) onDirty?.(JSON.stringify(value) !== base.current);
  }, [value, onDirty]);
}
