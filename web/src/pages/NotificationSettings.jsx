import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Async, Card, ErrorBox, Field, useAction, useAsync } from '../components/ui.jsx';

const CH_LABEL = { inapp: 'Trong hệ thống', telegram: 'Telegram', webhook: 'Webhook' };

/** Cài đặt → Thông báo: chọn loại thông báo, kênh nhận, và cấu hình Telegram. Token bot được che sau khi lưu. */
export default function NotificationSettings() {
  const state = useAsync(() => api.get('/notifications/config'), []);
  const { busy, error, run } = useAction();
  const [rules, setRules] = useState(null);
  const [chatId, setChatId] = useState('');
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState('');
  const [testResult, setTestResult] = useState(null);
  useEffect(() => {
    if (!state.data) return;
    setRules(structuredClone(state.data.data.rules));
    setChatId(state.data.data.telegram.chat_id || '');
  }, [state.data]);
  const setRule = (k, patch) => { setSaved(''); setRules((r) => ({ ...r, [k]: { ...r[k], ...patch } })); };
  const toggleCh = (k, ch) => setRule(k, { channels: rules[k].channels.includes(ch) ? rules[k].channels.filter((x) => x !== ch) : [...rules[k].channels, ch] });
  const payload = () => ({
    telegram: { chat_id: chatId, ...(token ? { bot_token: token } : {}) },
    rules: Object.fromEntries(Object.entries(rules).map(([k, r]) => [k, { enabled: r.enabled, channels: r.channels, ...(r.days !== undefined ? { days: Number(r.days) } : {}), ...(r.hour !== undefined ? { hour: Number(r.hour) } : {}) }])),
  });
  const save = () => run(async () => { await api.put('/notifications/config', payload()); setToken(''); setSaved('Đã lưu cài đặt thông báo.'); state.reload(); });
  return (
    <Async state={state}>
      {({ data }) => rules && (
        <div className="stack">
          <Card title="Thông báo cho chủ shop">
            <div className="stack">
              <p className="muted small" style={{ margin: 0 }}>Hệ thống kiểm tra định kỳ và báo cho bạn. Mỗi loại tối đa một lần mỗi ngày. Thông báo trong hệ thống xem ở biểu tượng chuông trên thanh trên cùng.</p>
              {Object.entries(data.rule_info).map(([k, info]) => (
                <div key={k} className="stack" style={{ gap: 6, paddingBottom: 12, borderBottom: '1px solid var(--hair)' }}>
                  <label className="check"><input type="checkbox" checked={rules[k].enabled} onChange={(e) => setRule(k, { enabled: e.target.checked })} /><b>{info.label}</b></label>
                  <div className="small muted" style={{ paddingLeft: 28 }}>{info.help}</div>
                  {rules[k].enabled && (
                    <div className="row wrap" style={{ paddingLeft: 28 }}>
                      {data.channels.map((ch) => <label key={ch} className="check small"><input type="checkbox" checked={rules[k].channels.includes(ch)} onChange={() => toggleCh(k, ch)} />{CH_LABEL[ch]}</label>)}
                      {info.param && <label className="small row" style={{ gap: 6 }}>{info.param.label}<input type="number" min={info.param.min} max={info.param.max} value={rules[k][info.param.key] ?? info.param.def} onChange={(e) => setRule(k, { [info.param.key]: e.target.value })} style={{ width: 80 }} aria-label={`${info.label}: ${info.param.label}`} /></label>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
          <Card title="Kênh Telegram">
            <div className="stack">
              <p className="muted small" style={{ margin: 0 }}>Tạo bot với @BotFather để lấy token, nhắn cho bot một tin rồi lấy chat id. Token được lưu riêng và không hiện lại sau khi lưu.</p>
              <Field label="Token bot" hint={data.telegram.has_token ? `Đã lưu (${data.telegram.token_hint}). Để trống nếu giữ nguyên.` : 'Chưa có token'}><input type="password" autoComplete="off" value={token} onChange={(e) => { setToken(e.target.value); setSaved(''); }} aria-label="Token bot Telegram" placeholder={data.telegram.has_token ? '••••••••' : ''} /></Field>
              <Field label="Mã trò chuyện (chat id)"><input value={chatId} onChange={(e) => { setChatId(e.target.value); setSaved(''); }} aria-label="Chat id Telegram" /></Field>
              {data.telegram.has_token && <div><button type="button" className="btn sm" disabled={busy} onClick={() => run(async () => { await api.put('/notifications/config', { telegram: { clear_token: true }, rules: Object.fromEntries(Object.entries(rules).map(([k, r]) => [k, { channels: r.channels.filter((c) => c !== 'telegram') }])) }); setSaved('Đã xoá token và tắt gửi qua Telegram.'); state.reload(); })}>Xoá token</button></div>}
            </div>
          </Card>
          <Card title="Kênh Webhook (Zalo, email qua dịch vụ ngoài)">
            <p className="muted small" style={{ margin: 0 }}>Chọn kênh “Webhook” ở từng loại thông báo để hệ thống phát sự kiện <code>notification.created</code>. Đăng ký địa chỉ nhận ở tab API &amp; webhook, rồi nối sang Zalo hoặc email bằng Zapier, Make hoặc n8n.</p>
          </Card>
          <ErrorBox error={error} />
          {saved && <div className="alert ok" role="status">{saved}</div>}
          {testResult && <div className={`alert ${Object.values(testResult.deliveries).some((v) => String(v).startsWith('error')) ? 'warn' : 'ok'}`} role="status">Đã gửi thử. {Object.entries(testResult.deliveries).map(([k, v]) => `${CH_LABEL[k]}: ${v === 'sent' ? 'thành công' : v === 'queued' ? 'đã xếp hàng' : v.replace('error: ', 'lỗi, ')}`).join(' · ') || 'Xem ở biểu tượng chuông.'}</div>}
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={save}>Lưu</button>
            <button type="button" className="btn" disabled={busy} onClick={() => run(async () => { await api.put('/notifications/config', payload()); setToken(''); const chans = ['inapp', ...(chatId ? ['telegram'] : []), ...(Object.values(rules).some((r) => r.channels.includes('webhook')) ? ['webhook'] : [])]; setTestResult((await api.post('/notifications/test', { channels: chans })).data); state.reload(); })}>Lưu và gửi thử</button>
          </div>
        </div>
      )}
    </Async>
  );
}
