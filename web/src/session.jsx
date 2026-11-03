import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useSession = () => useContext(Ctx);

/** Tải một lần các danh mục dùng khắp nơi (shop, kho, kênh) và nhớ shop đang làm việc */
export function SessionProvider({ user, onLogout, children }) {
  const [meta, setMeta] = useState(null);
  const [shopId, setShopIdState] = useState(() => {
    try { return localStorage.getItem('moso.shop') || ''; } catch { return ''; }
  });
  const load = useCallback(async () => {
    const [shops, warehouses, channels, settings] = await Promise.all([
      api.get('/shops'), api.get('/warehouses'), api.get('/channels'), api.get('/settings'),
    ]);
    setMeta({ shops: shops.data, warehouses: warehouses.data, channels: channels.data, settings: settings.data });
  }, []);
  useEffect(() => { load(); }, [load]);

  const setShopId = (id) => {
    setShopIdState(id);
    try { localStorage.setItem('moso.shop', id); } catch { /* chế độ riêng tư: bỏ qua */ }
  };
  if (!meta) return <div className="empty">Đang tải…</div>;
  // Shop đã chọn không còn tồn tại (bị ẩn) → quay về shop đầu tiên
  const valid = shopId === 'all' || meta.shops.some((s) => s.id === shopId);
  const shop = valid && shopId !== 'all' ? meta.shops.find((s) => s.id === shopId) : null;
  const effective = valid && shopId ? shopId : meta.shops[0]?.id;
  return (
    <Ctx.Provider value={{ user, onLogout, ...meta, reload: load, shopId: effective, setShopId, shop: shop || meta.shops.find((s) => s.id === effective) || null, isAll: effective === 'all' }}>
      {children}
    </Ctx.Provider>
  );
}
