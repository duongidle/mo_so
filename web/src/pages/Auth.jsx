import { useState } from 'react';
import { api } from '../api.js';
import { Field, ErrorBox, useAction } from '../components/ui.jsx';
import { Seal } from '../components/Motif.jsx';

/**
 * Đăng nhập và đăng ký. Mỗi tài khoản có shop, kho, sản phẩm, khách, đơn riêng hoàn toàn.
 * Tài khoản mới chưa có shop nào: sau khi đăng ký, giao diện dẫn sang tạo shop đầu tiên.
 */
export default function Auth({ hasAccounts, registrationOpen, onDone }) {
  const [mode, setMode] = useState(hasAccounts ? 'login' : 'register');
  const [f, setF] = useState({ username: '', display_name: '', password: '', confirm: '' });
  const [localError, setLocalError] = useState(null);
  const { busy, error, run } = useAction();
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setLocalError(null); };
  const register = mode === 'register';

  const submit = (e) => {
    e.preventDefault();
    if (register) {
      if (f.password.length < 8) return setLocalError('Mật khẩu tối thiểu 8 ký tự');
      if (f.password !== f.confirm) return setLocalError('Hai lần nhập mật khẩu chưa giống nhau');
    }
    run(async () => {
      if (register) await api.post('/auth/register', { username: f.username, display_name: f.display_name, password: f.password });
      else await api.post('/auth/login', { username: f.username, password: f.password });
      onDone();
    });
  };

  return (
    <div className="login-shell">
      <aside className="login-art">
        <div className="row" style={{ gap: 14, position: 'relative' }}><img src="/logo-mark.svg" alt="" width="44" height="44" style={{ borderRadius: 11 }} /><div><b style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--linen)' }}>Mở Sổ</b><div className="eyebrow" style={{ color: 'var(--champagne)' }}>Dấu vết của thời gian</div></div></div>
        <div><h2>Mỗi đơn hàng là một nét ghi vào sổ.</h2><p>Một cuốn sổ cái cho mọi shop, mọi kênh. Mở ra là thấy.</p></div>
        <div style={{ position: 'relative' }}><Seal size={120}>MỞ<br />SỔ</Seal></div>
      </aside>
      <div className="login-form">
        <form className="stack" onSubmit={submit}>
          <div className="row between"><div><div className="eyebrow">{register ? 'Tài khoản mới' : 'Chào mừng trở lại'}</div><h1>{register ? 'Đăng ký' : 'Đăng nhập'}</h1></div><Seal>MỞ<br />SỔ</Seal></div>
          {register && <p className="muted small" style={{ margin: 0 }}>Mỗi tài khoản có dữ liệu riêng hoàn toàn: shop, kho, sản phẩm, khách hàng, đơn hàng. Đăng ký xong bạn sẽ tạo shop đầu tiên.</p>}
          <Field label="Tên đăng nhập" hint={register ? 'Chữ không dấu, số, dấu . _ @ -' : undefined}><input value={f.username} onChange={set('username')} autoComplete="username" required autoFocus /></Field>
          {register && <Field label="Tên hiển thị"><input value={f.display_name} onChange={set('display_name')} autoComplete="name" required /></Field>}
          <Field label={register ? 'Mật khẩu (tối thiểu 8 ký tự)' : 'Mật khẩu'}>
            <input type="password" value={f.password} onChange={set('password')} autoComplete={register ? 'new-password' : 'current-password'} required />
          </Field>
          {register && <Field label="Nhập lại mật khẩu"><input type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" required /></Field>}
          {localError && <div className="alert err" role="alert">{localError}</div>}
          <ErrorBox error={error} />
          <button className="btn primary" disabled={busy}>{busy ? 'Đang xử lý…' : register ? 'Tạo tài khoản' : 'Đăng nhập'}</button>
          {hasAccounts && (register || registrationOpen) && (
            <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
              {register ? 'Đã có tài khoản? ' : 'Chưa có tài khoản? '}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode(register ? 'login' : 'register'); setLocalError(null); }}>{register ? 'Đăng nhập' : 'Đăng ký'}</a>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
