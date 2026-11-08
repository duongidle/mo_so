import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useSession } from '../../session.jsx';
import { Async, Card, useAsync } from '../../components/ui.jsx';
import { monthStart, today, fmtDate, pct } from '../../lib.js';
import { buildChecks, summarize, GLOSSARY, COLOR_MEANING } from '../../guide.js';
import { SCOPES } from '../../metrics.js';

const DOT = { green: 'Xanh', yellow: 'Vàng', red: 'Đỏ' };
const Dot = ({ status }) => <b className={status ? `h-${status}` : 'muted'}>● {status ? DOT[status] : 'Chưa có dữ liệu'}</b>;

/**
 * Hướng dẫn đọc sức khoẻ kinh doanh cho người không rành số liệu: thay vì nhìn hàng chục chỉ số,
 * trả lời 5 câu hỏi theo thứ tự, mỗi câu có màu, số liệu chính và việc nên làm.
 */
export default function HealthGuide() {
  const { shopId, isAll, shop } = useSession();
  const from = monthStart();
  const to = today();
  const p = { from, to, shop_id: isAll ? undefined : shopId };
  const state = useAsync(async () => {
    const [health, overview, cash, aging, accounts, inventory, expense] = await Promise.all([
      api.get('/reports/health', p), api.get('/reports/overview', p), api.get('/reports/cashflow', p), api.get('/reports/aging', { shop_id: p.shop_id }),
      api.get('/cash/accounts'), api.get('/reports/inventory', { shop_id: p.shop_id }), api.get('/reports/expenses', p),
    ]);
    return { health, overview: overview.data, cash: cash.data, aging: aging.data, accounts, inventory: inventory.data, expense: expense.data };
  }, [shopId]);

  return (
    <div className="stack">
      <p className="guide-lede">Đừng nhìn hết các con số. Mỗi sáng dành 5 phút, đi theo 5 câu hỏi dưới đây theo thứ tự.</p>

      <Async state={state}>{(d) => {
        const checks = buildChecks(d);
        const sum = summarize(checks);
        return (
          <>
            <Card title="Hôm nay thế nào?">
              <p style={{ marginTop: 0 }}>
                {sum.red + sum.yellow === 0
                  ? <>Cả 5 câu hỏi đều <b className="h-green">ổn</b>{sum.none ? ` (còn ${sum.none} câu chưa có dữ liệu)` : ''}. Không có gì cần xử lý gấp.</>
                  : <>Có {sum.red > 0 && <b className="h-red">{sum.red} việc đỏ</b>}{sum.red > 0 && sum.yellow > 0 && ' và '}{sum.yellow > 0 && <b className="h-yellow">{sum.yellow} việc vàng</b>}. Xử lý trước: <b>{sum.first.question}</b></>}
              </p>
              <div className="small muted">Số liệu {isAll ? 'của tất cả shop' : `của ${shop?.name}`}, từ {fmtDate(from)} đến {fmtDate(to)} (tháng này). Tiền trong quỹ và công nợ là số tính đến hôm nay.</div>
            </Card>

            {checks.map((c, i) => (
              <Card key={c.id} title={`${i + 1}. ${c.question}`} actions={<Dot status={c.status} />}>
                <p style={{ marginTop: 0 }}>{c.headline}</p>
                <div className="grid cols-4" style={{ marginBottom: 12 }}>
                  {c.facts.map((f) => <div key={f.label}><div className="small muted">{f.label}</div><b className="num">{f.value}</b></div>)}
                </div>
                {c.todo.length > 0 && (
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="eyebrow">{c.status === 'green' ? 'Ghi chú' : 'Việc nên làm'}</div>
                    <ul className="small" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>{c.todo.map((t) => <li key={t}>{t}</li>)}</ul>
                  </div>
                )}
                <div style={{ marginTop: 12 }}><Link className="btn sm" to={c.link}>{c.linkLabel}</Link></div>
              </Card>
            ))}

            <Card title="Màu xanh, vàng, đỏ nghĩa là gì?">
              <div className="stack" style={{ gap: 8 }}>
                {COLOR_MEANING.map((m) => <div key={m.status} className="row"><b className={`h-${m.status}`} style={{ minWidth: 60 }}>● {m.label}</b><span>{m.text}</span></div>)}
              </div>
              <p className="small muted" style={{ marginBottom: 0 }}>Các mức vàng/đỏ của tỷ lệ (biên lợi nhuận, huỷ đơn, hoàn trả, số ngày tồn, khách mua lại) do bạn đặt ở <Link to="/settings">Cài đặt → Ngưỡng & kho</Link>. Hệ thống chỉ gợi ý mức mặc định, mỗi ngành hợp mức khác nhau nên bạn cần chỉnh cho đúng với shop của mình.</p>
              <div className="stack" style={{ gap: 4, marginTop: 12 }}>
                {d.health.data.map((h) => <div key={h.key} className="row between small"><span>{h.label}</span><span><b className="num">{h.value === null ? '—' : String(h.value).replace('.', ',')}</b> <Dot status={h.status} /> <span className="muted">(vàng khi {h.threshold.direction === 'higher_better' ? 'dưới' : 'trên'} {h.threshold.warn}, đỏ khi {h.threshold.direction === 'higher_better' ? 'dưới' : 'trên'} {h.threshold.bad})</span></span></div>)}
              </div>
            </Card>

            <div className="stack">
              <h2 style={{ margin: '8px 0 0' }}>Từ điển các con số</h2>
              <p className="small muted" style={{ margin: 0 }}>Nhấn vào từng mục để xem nghĩa, cách tính và việc nên làm.</p>
              {GLOSSARY.map((g) => (
                <Card key={g.group} title={g.group}>
                  {g.items.map((it) => (
                    <details key={it.name} style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{it.name}{it.key && d.health.data.find((h) => h.key === it.key) && <span className="muted small"> · hiện {pct(d.health.data.find((h) => h.key === it.key).value)}</span>}</summary>
                      <div className="stack small" style={{ gap: 8, marginTop: 8 }}>
                        <div><b>Là gì: </b>{it.what}</div>
                        <div><b>Cách tính: </b>{it.how}</div>
                        {it.source && <div><b>Lấy từ đâu: </b>{it.source}</div>}
                        {it.scope && <div><b>Phạm vi: </b>{SCOPES[it.scope]}</div>}
                        <div><b>Nên làm: </b>{it.tip}</div>
                      </div>
                    </details>
                  ))}
                </Card>
              ))}
            </div>

            <Card title="Những điều số liệu không nói được">
              <ul className="small" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                <li><b>Số đúng khi ghi đủ.</b> Quên nhập một đơn hay một khoản chi là báo cáo lệch. Đếm két và kiểm kê kho định kỳ để bắt chỗ thiếu.</li>
                <li><b>“Ước tính”</b> nghĩa là chưa tính thuế và các khoản ngoài sổ. Đây không phải sổ kế toán hay tờ khai thuế.</li>
                <li><b>Phí sàn khi khách trả hàng</b> được giả định sàn không hoàn lại. Nếu sàn có hoàn thì lãi thật cao hơn một chút.</li>
                <li><b>Một tháng chưa đủ để kết luận.</b> Nhìn xu hướng vài tháng, đặc biệt với hàng theo mùa hoặc dịp lễ.</li>
              </ul>
            </Card>
          </>
        );
      }}</Async>
    </div>
  );
}
