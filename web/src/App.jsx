import { useEffect, useRef, useState } from 'react';
import { Routes, Route, NavLink, Navigate, Link, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { SessionProvider, useSession } from './session.jsx';
import { Loading } from './components/ui.jsx';
import Icon from './components/Icon.jsx';
import Auth from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Pos from './pages/Pos.jsx';
import { OrderList, OrderDetail } from './pages/Orders.jsx';
import Products from './pages/Products.jsx';
import Stock from './pages/Stock.jsx';
import Purchases from './pages/Purchases.jsx';
import { CustomerList, CustomerDetail } from './pages/Customers.jsx';
import Care from './pages/Care.jsx';
import Expenses from './pages/Expenses.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { group: null, items: [['/', 'Tổng quan', 'home', true], ['/pos', 'Bán nhanh', 'bag'], ['/orders', 'Đơn hàng', 'receipt']] },
  { group: 'Hàng hoá', items: [['/products', 'Sản phẩm', 'tag'], ['/stock', 'Kho', 'box'], ['/purchases', 'Nhập hàng', 'truck']] },
  { group: 'Khách', items: [['/customers', 'Khách hàng', 'users'], ['/care', 'Chăm sóc', 'heart']] },
  { group: 'Sổ sách', items: [['/expenses', 'Chi phí & đối soát', 'wallet'], ['/reports', 'Báo cáo', 'chart'], ['/settings', 'Cài đặt', 'cog']] },
];
const PRIMARY = ['/', '/pos', '/orders', '/stock'];

/** Bộ chọn shop: nút hiện shop đang làm việc, bấm ra danh sách (thay cho thẻ select mặc định) */
function ShopSwitcher() {
  const { shops, shopId, setShopId } = useSession();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  // "Tất cả shop" chỉ có ở Báo cáo, Khách hàng, Kho, Tổng quan, Đơn, Chăm sóc (CLAUDE.md mục 7)
  const allowAll = ['/', '/reports', '/customers', '/stock', '/orders', '/care'].some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)));
  const current = shopId === 'all' && !allowAll ? shops[0]?.id : shopId;
  const shop = shops.find((s) => s.id === current);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const k = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  const pick = (id) => { setShopId(id); setOpen(false); };
  return (
    <div className="shop-switch" ref={ref}>
      <button className="shop-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <span className="dot" style={{ color: shop?.color || 'var(--terracotta)' }} />
        <span>{current === 'all' ? 'Tất cả shop' : shop?.name}</span>
        <Icon name="chevron" />
      </button>
      {open && (
        <div className="shop-menu" role="menu">
          {shops.map((s) => (
            <button key={s.id} role="menuitemradio" aria-checked={s.id === current} onClick={() => pick(s.id)}>
              <span className="dot" style={{ color: s.color || 'var(--terracotta)' }} /><span className="grow">{s.name}</span><span className="small muted">{s.code}</span>
            </button>
          ))}
          {allowAll && <><hr /><button role="menuitemradio" aria-checked={current === 'all'} onClick={() => pick('all')}><span className="dot" style={{ color: 'var(--walnut)' }} />Tất cả shop</button></>}
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { onLogout, user } = useSession();
  const { pathname } = useLocation();
  const [pinned, setPinned] = useState(() => { try { return localStorage.getItem('moso.pin') === '1'; } catch { return false; } });
  const togglePin = () => setPinned((p) => { try { localStorage.setItem('moso.pin', p ? '0' : '1'); } catch { /* bỏ qua */ } return !p; });
  const dateText = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const tab = (to, label, icon) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={icon} />{label}</NavLink>
  );
  return (
    <div className="shell">
      <div className={`rail-space ${pinned ? 'pinned' : ''}`} aria-hidden="true" />
      <nav className={`sidebar ${pinned ? 'pinned' : ''}`} aria-label="Điều hướng chính">
        <div className="brand"><img src="/logo-mark.svg" alt="" /><div className="lbl"><b>Mở Sổ</b><span className="tag">Dấu vết của thời gian</span></div></div>
        {NAV.map((g, i) => (
          <div key={i}>
            {i > 0 && <div className="nav-sep" />}
            {g.items.map(([to, label, icon, end]) => (
              <NavLink key={to} to={to} end={end} title={label} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}><Icon name={icon} /><span className="lbl">{label}</span></NavLink>
            ))}
          </div>
        ))}
        <div className="me">
          <button className="pin" onClick={togglePin} title={pinned ? 'Thu gọn thanh bên' : 'Ghim thanh bên luôn mở'}><Icon name="panel" /><span className="lbl">{pinned ? 'Thu gọn' : 'Ghim thanh bên'}</span></button>
          <button onClick={onLogout} title="Đăng xuất"><Icon name="out" /><span className="lbl">Đăng xuất · {user.displayName}</span></button>
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <div className="row"><span className="mark-wrap"><img className="mark" src="/logo-mark.svg" alt="Mở Sổ" /></span><ShopSwitcher /></div>
          <div className="row"><span className="small muted" style={{ textTransform: 'capitalize' }}>{dateText}</span>{pathname !== '/pos' && <Link to="/pos" className="btn primary sm cta"><Icon name="plus" />Bán nhanh</Link>}</div>
        </header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/pos" element={<Pos />} />
          <Route path="/orders" element={<OrderList />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/import" element={<Navigate to="/orders?import=1" replace />} />
          <Route path="/products" element={<Products />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/customers" element={<CustomerList />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/care" element={<Care />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/more" element={<More />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {!['/pos', '/orders'].includes(pathname) && <Link to="/pos" className="fab"><Icon name="plus" />Đơn</Link>}
      <nav className="tabbar" aria-label="Thanh tab">
        {tab('/', 'Tổng quan', 'home')}
        {tab('/pos', 'Bán hàng', 'bag')}
        {tab('/orders', 'Đơn', 'receipt')}
        {tab('/stock', 'Kho', 'box')}
        {tab('/more', 'Thêm', 'more')}
      </nav>
    </div>
  );
}

/** Trang "Thêm" trên điện thoại: mọi mục còn lại */
function More() {
  const { onLogout } = useSession();
  return (
    <div className="page stack">
      <h1>Thêm</h1>
      {NAV.map((g, i) => {
        const items = g.items.filter(([to]) => !PRIMARY.includes(to));
        return items.length > 0 && (
          <div key={i} className="stack" style={{ gap: 8 }}>
            {g.group && <div className="eyebrow">{g.group}</div>}
            <div className="card flat">
              {items.map(([to, label, icon]) => <Link key={to} to={to} className="pick"><span className="row"><Icon name={icon} size={20} />{label}</span><Icon name="chevron" size={16} style={{ transform: 'rotate(-90deg)' }} /></Link>)}
            </div>
          </div>
        );
      })}
      <button className="btn" onClick={onLogout}><Icon name="out" />Đăng xuất</button>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState({ loading: true, setup: false, user: null });
  const check = async () => {
    try {
      const st = await api.get('/auth/status');
      if (st.setup_required) return setAuth({ loading: false, setup: true, user: null });
      const me = await api.get('/auth/me');
      setAuth({ loading: false, setup: false, user: me.data });
    } catch {
      setAuth({ loading: false, setup: false, user: null });
    }
  };
  useEffect(() => { check(); }, []);
  useEffect(() => {
    const h = () => setAuth((a) => ({ ...a, user: null }));
    window.addEventListener('moso:unauthorized', h);
    return () => window.removeEventListener('moso:unauthorized', h);
  }, []);
  if (auth.loading) return <Loading />;
  if (!auth.user) return <Auth setup={auth.setup} onDone={check} />;
  const logout = async () => { await api.post('/auth/logout').catch(() => {}); setAuth({ loading: false, setup: false, user: null }); };
  return (
    <SessionProvider user={auth.user} onLogout={logout}>
      <Shell />
    </SessionProvider>
  );
}
