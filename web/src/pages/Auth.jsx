import { useState } from 'react';
import { api } from '../api.js';
import { Field, ErrorBox, useAction } from '../components/ui.jsx';
import { Compass, Seal } from '../components/Motif.jsx';

export default function Auth({ setup, onDone }) {
  const [f, setF] = useState({ username: '', password: '', display_name: '', warehouse_name: 'Kho chính', shops: [{ name: '', code: '' }] });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const shopSet = (i, k, v) => setF({ ...f, shops: f.shops.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (setup) {
        await api.post('/auth/setup', { ...f, shops: f.shops.filter((s) => s.name && s.code) });
      }
      await api.post('/auth/login', { username: f.username, password: f.password });
      onDone();
    });
  };

  return (
    <div className="login-shell">
      <aside className="login-art">
        <div className="row" style={{ gap: 14, position: 'relative' }}><img src="/logo-mark.svg" alt="" width="44" height="44" style={{ borderRadius: 11 }} /><div><b style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--linen)' }}>Mở Sổ</b><div className="eyebrow" style={{ color: 'var(--champagne)' }}>Dấu vết của thời gian</div></div></div>
        <div><h2>Mỗi đơn hàng là một nét ghi vào sổ.</h2><p>Một cuốn sổ cái cho mọi shop, mọi kênh. Mở ra là thấy.</p></div>
        <Compass className="compass" size={420} style={{}} />
      </aside>
      <div className="login-form">
        <form className="stack" onSubmit={submit}>
          <div className="row between"><div><div className="eyebrow">{setup ? 'Lần đầu' : 'Chào mừng trở lại'}</div><h1>{setup ? 'Thiết lập' : 'Đăng nhập'}</h1></div><Seal>MỞ<br />SỔ</Seal></div>
          {setup && <p className="muted small" style={{ margin: 0 }}>Tạo tài khoản chủ shop, kho đầu tiên và các shop. Thêm hoặc sửa sau trong Cài đặt.</p>}
      <Field label="Tên đăng nhập"><input value={f.username} onChange={set('username')} autoComplete="username" required autoFocus /></Field>
      {setup && <Field label="Tên hiển thị"><input value={f.display_name} onChange={set('display_name')} required /></Field>}
      <Field label={setup ? 'Mật khẩu (tối thiểu 8 ký tự)' : 'Mật khẩu'}>
        <input type="password" value={f.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 8 : undefined} required />
      </Field>
      {setup && (
        <>
          <Field label="Tên kho đầu tiên"><input value={f.warehouse_name} onChange={set('warehouse_name')} /></Field>
          <h3>Shop</h3>
          {f.shops.map((s, i) => (
            <div className="row" key={i}>
              <input placeholder="Tên shop, vd Nước hoa ô tô" value={s.name} onChange={(e) => shopSet(i, 'name', e.target.value)} className="grow" aria-label="Tên shop" />
              <input placeholder="Mã" value={s.code} onChange={(e) => shopSet(i, 'code', e.target.value.toUpperCase())} style={{ width: 80 }} maxLength={6} aria-label="Mã shop" />
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => setF({ ...f, shops: [...f.shops, { name: '', code: '' }] })}>+ Thêm shop</button>
        </>
      )}
      <ErrorBox error={error} />
      <button className="btn primary" disabled={busy}>{busy ? 'Đang xử lý…' : setup ? 'Bắt đầu' : 'Đăng nhập'}</button>
        </form>
      </div>
    </div>
  );
}
