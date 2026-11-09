import { flowOf } from '../lib/orderFlow.js';
import { fmtDate } from '../lib.js';

/** Thanh tiến trình của đơn: bước đã qua được chốt (✓ kèm giờ), bước đang chờ làm nổi bật, bước chưa tới mờ đi. */
export default function OrderFlow({ order }) {
  const { steps, end } = flowOf(order);
  const all = end ? [...steps.filter((s) => s.state === 'done' || s.state === 'skipped'), end] : steps;
  return (
    <ol className="flow" aria-label="Tiến trình đơn hàng">
      {all.map((s, i) => {
        const state = s.tone ? `end ${s.tone}` : s.state;
        return (
          <li key={s.key} className={`flow-step ${state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
            <span className="flow-dot" aria-hidden="true">{s.tone ? '✕' : s.state === 'done' ? '✓' : s.state === 'skipped' ? '–' : i + 1}</span>
            <span className="flow-label">{s.label}</span>
            <span className="flow-sub small muted">{s.state === 'skipped' ? 'Bỏ qua' : s.at && (s.state === 'done' || s.tone) ? fmtDate(s.at) : s.state === 'current' ? 'Đang chờ' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}
