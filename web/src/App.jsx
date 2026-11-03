import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, Link, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { SessionProvider, useSession } from './session.jsx';
import { Loading } from './components/ui.jsx';
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
import ImportPage from './pages/Import.jsx';
import Settings from './pages/Settings.jsx';

const I = (d) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const icons = {
  home: I('M3 11l9-8 9 8M5 10v10h14V10'),
  bag: I('M6 7h12l1 13H5L6 7zM9 7a3 3 0 016 0'),
  list: I('M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01'),
  box: I('M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8'),
  more: I('M5 12h.01M12 12h.01M19 12h.01'),
};

const NAV = [
  ['/', 'Tổng quan', true],
  ['/pos', 'Bán nhanh'],
  ['/orders', 'Đơn hàng'],
  ['/products', 'Sản phẩm'],
  ['/stock', 'Kho'],
  ['/purchases', 'Nhập hàng'],
  ['/customers', 'Khách hàng'],
  ['/care', 'Chăm sóc'],
  ['/expenses', 'Chi phí & đối soát'],
  ['/reports', 'Báo cáo'],
  ['/import', 'Import đơn'],
  ['/settings', 'Cài đặt'],
];

function ShopPicker() {
  const { shops, shopId, setShopId } = useSession();
  const { pathname } = useLocation();
  // "Tất cả shop" chỉ có ở Báo cáo, Khách hàng, Kho, Tổng quan (CLAUDE.md mục 7)
  const allowAll = ['/', '/reports', '/customers', '/stock', '/orders', '/care'].some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)));
  const value = shopId === 'all' && !allowAll ? shops[0]?.id : shopId;
  return (
    <select value={value} onChange={(e) => setShopId(e.target.value)} aria-label="Chọn shop" style={{ maxWidth: 240 }}>
      {allowAll && <option value="all">Tất cả shop</option>}
      {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

function Shell() {
  const { onLogout, user } = useSession();
  const { pathname } = useLocation();
  const tab = (to, label, icon) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{icon}{label}</NavLink>
  );
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Điều hướng chính">
        <div className="brand"><img src="/logo-mark.svg" alt="" />Mở Sổ</div>
        {NAV.map(([to, label, end]) => (
          <span key={to}>
            {(to === '/customers' || to === '/reports') && <div className="sep" />}
            <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
          </span>
        ))}
        <div className="grow" />
        <div className="small" style={{ padding: '8px 12px', opacity: .7 }}>{user.displayName}</div>
        <a href="#" onClick={(e) => { e.preventDefault(); onLogout(); }}>Đăng xuất</a>
      </nav>
      <div className="main">
        <header className="topbar">
          <span className="mark-wrap"><img className="mark" src="/logo-mark.svg" alt="Mở Sổ" /></span>
          <ShopPicker />
        </header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/pos" element={<Pos />} />
          <Route path="/orders" element={<OrderList />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/products" element={<Products />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/customers" element={<CustomerList />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/care" element={<Care />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/more" element={<More />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {pathname !== '/pos' && <Link to="/pos" className="fab">+ Đơn</Link>}
      <nav className="tabbar" aria-label="Thanh tab">
        {tab('/', 'Tổng quan', icons.home)}
        {tab('/pos', 'Bán hàng', icons.bag)}
        {tab('/orders', 'Đơn', icons.list)}
        {tab('/stock', 'Kho', icons.box)}
        {tab('/more', 'Thêm', icons.more)}
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
      <div className="card flat">
        {NAV.filter(([to]) => !['/', '/pos', '/orders', '/stock'].includes(to)).map(([to, label]) => (
          <Link key={to} to={to} className="pick">{label}<span>›</span></Link>
        ))}
        <a href="#" className="pick" onClick={(e) => { e.preventDefault(); onLogout(); }}>Đăng xuất</a>
      </div>
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
