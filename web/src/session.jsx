import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
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
    const [shops, warehouses, channels, settings, industries] = await Promise.all([
      api.get('/shops'), api.get('/warehouses'), api.get('/channels'), api.get('/settings'), api.get('/industries'),
    ]);
    setMeta({ shops: shops.data, warehouses: warehouses.data, channels: channels.data, settings: settings.data, industries: industries.data });
  }, []);
  useEffect(() => { load(); }, [load]);

  const setShopId = (id) => {
    setShopIdState(id);
    try { localStorage.setItem('moso.shop', id); } catch { /* chế độ riêng tư: bỏ qua */ }
  };
  // Shop đã chọn không còn tồn tại (bị ẩn) → quay về shop đầu tiên
  const valid = !!meta && (shopId === 'all' || meta.shops.some((s) => s.id === shopId));
  const effective = meta && valid && shopId ? shopId : meta?.shops[0]?.id;
  const shop = meta && effective !== 'all' ? meta.shops.find((s) => s.id === effective) || null : null;
  // Ngành của shop đang làm việc quyết định giao diện và tính năng. "Tất cả shop" dùng giao diện chung.
  const industry = useMemo(() => (meta && shop ? meta.industries.find((i) => i.id === shop.industry) || meta.industries[0] : null), [meta, shop]);
  const theme = industry?.theme || 'general';
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  if (!meta) return <div className="empty">Đang tải…</div>;
  const features = industry?.features || [];
  return (
    <Ctx.Provider value={{ user, onLogout, ...meta, reload: load, shopId: effective, setShopId, shop, isAll: effective === 'all', industry, theme, features, has: (f) => features.includes(f) }}>
      {children}
    </Ctx.Provider>
  );
}
