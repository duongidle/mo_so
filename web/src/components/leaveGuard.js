import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Cảnh báo khi rời form chưa lưu: chặn chuyển trang trong ứng dụng (cần data router) và đóng/tải lại tab.
 * Dùng: `const { setDirty } = useLeaveGuard();` rồi truyền `onDirty={setDirty}` cho form.
 * Form gọi `onDirty(false)` ngay trước khi chuyển trang sau khi lưu để không bị hỏi.
 */
export function useLeaveGuard(message = 'Chưa lưu thay đổi. Rời trang này sẽ mất những gì vừa nhập. Vẫn rời đi?') {
  const dirty = useRef(false);
  const blocker = useBlocker(() => dirty.current);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(message)) blocker.proceed(); else blocker.reset();
  }, [blocker, message]);
  useEffect(() => {
    const h = (e) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);
  const setDirty = useCallback((v) => { dirty.current = !!v; }, []);
  return { setDirty };
}
