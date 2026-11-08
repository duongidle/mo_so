import { useCallback, useEffect, useRef, useState } from 'react';
import { CH, SL, coverHTML, cheatHTML, faqHTML } from '../../guides/handbook/data.js';
import { MOCK_CSS } from '../../guides/handbook/mockCss.js';

const CURSOR = '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 2l12 7-5.2 1.3L7.4 16z" fill="#301f12" stroke="#fdfcf9" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPECIAL = { cover: coverHTML, cheat: cheatHTML, faq: faqHTML };
const chapterName = (k) => CH.find((c) => c[0] === k)?.[1] || '';
const firstOf = (ch) => Math.max(0, SL.findIndex((s) => s.ch === ch));

/**
 * Cẩm nang từng bước: mỗi trang có lời hướng dẫn bên trái và màn hình mô phỏng tự thao tác bên phải, phát lại liên tục.
 * Màn hình mô phỏng chạy trong Shadow DOM để CSS không lẫn với giao diện chính. Có nút tạm dừng và tôn trọng “giảm chuyển động”.
 */
export default function Handbook() {
  const [cur, setCur] = useState(0);
  const [step, setStep] = useState(-1);
  const [cap, setCap] = useState('');
  const [paused, setPaused] = useState(false);
  const [runId, setRunId] = useState(0);
  const hostRef = useRef(null);
  const fullRef = useRef(null);
  const pausedRef = useRef(false);
  const slide = SL[cur];
  const special = !!slide.type;

  const go = useCallback((i) => setCur(Math.max(0, Math.min(SL.length - 1, i))), []);
  const togglePause = () => { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); };
  const replay = () => { pausedRef.current = false; setPaused(false); setRunId((n) => n + 1); };

  // Trang đặc biệt (bìa, lịch việc, tình huống): HTML tĩnh, nút trên bìa chuyển chương
  useEffect(() => {
    if (!special || !fullRef.current) return undefined;
    fullRef.current.innerHTML = SPECIAL[slide.type]();
    const el = fullRef.current;
    const onClick = (e) => { const b = e.target.closest('[data-go]'); if (b) go(Number(b.dataset.go)); };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [cur, special, slide, go]);

  // Trang có màn hình mô phỏng: chạy kịch bản, hết thì nghỉ rồi phát lại từ đầu
  useEffect(() => {
    if (special || !hostRef.current) return undefined;
    const host = hostRef.current;
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    const RM = reducedMotion();
    let alive = true;
    const sleep = async (ms) => {
      if (RM) return;
      await new Promise((r) => setTimeout(r, ms));
      while (pausedRef.current && alive) await new Promise((r) => setTimeout(r, 150));
    };
    (async () => {
      while (alive) {
        root.innerHTML = `<style>${MOCK_CSS}</style><div class="stage" id="stage">${slide.screen}<div class="cur" id="cur">${CURSOR}</div></div>`;
        const stage = root.getElementById('stage');
        const cu = root.getElementById('cur');
        const place = (x, y) => { cu.style.transform = `translate(${x}px,${y}px)`; };
        place(stage.clientWidth - 50, stage.clientHeight - 50);
        setStep(-1);
        const q = (sel) => stage.querySelector(sel);
        const move = async (el) => {
          const r = el.getBoundingClientRect();
          const b = stage.getBoundingClientRect();
          place(r.left - b.left + Math.min(r.width * 0.6, r.width - 4), r.top - b.top + r.height * 0.55);
          await sleep(750);
        };
        await sleep(600);
        for (const st of slide.script) {
          if (!alive) return;
          const [op, a, b2, c] = st;
          if (op === 's') { setStep(a); setCap(slide.steps[a] || ''); await sleep(500); }
          else if (op === 'w') await sleep(a);
          else if (op === 'click') {
            const el = q(a);
            await move(el);
            if (!alive) return;
            const r = el.getBoundingClientRect();
            const bb = stage.getBoundingClientRect();
            const rp = document.createElement('div');
            rp.className = 'rip';
            rp.style.left = `${r.left - bb.left + Math.min(r.width * 0.6, r.width - 4)}px`;
            rp.style.top = `${r.top - bb.top + r.height * 0.55}px`;
            stage.appendChild(rp);
            setTimeout(() => rp.remove(), 600);
            el.classList.add('press');
            setTimeout(() => el.classList.remove('press'), 180);
            if (el.classList.contains('opt')) { [...el.parentNode.children].forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); }
            await sleep(450);
          } else if (op === 'type') {
            const el = q(a);
            await move(el);
            if (!alive) return;
            stage.querySelectorAll('.typing').forEach((x) => x.classList.remove('typing'));
            el.classList.add('typing');
            const v = el.querySelector('.v');
            v.textContent = '';
            for (const ch of b2) { if (!alive) return; v.textContent += ch; await sleep(38); }
            await sleep(300);
            el.classList.remove('typing');
          } else if (op === 'show') { q(a).classList.add('on'); await sleep(550); }
          else if (op === 'hide') { q(a).classList.remove('on'); await sleep(450); }
          else if (op === 'set') { const el = q(a); (el.querySelector('.v') || el).textContent = b2; await sleep(350); }
          else if (op === 'cls') { q(a).classList[b2 === 'add' ? 'add' : 'remove'](c); await sleep(300); }
          else if (op === 'var') { stage.style.setProperty(a, b2); await sleep(300); }
          else if (op === 'ckx') { const row = q(`#x${a}`); await move(row); row.classList.add('on-ck'); await sleep(300); }
        }
        if (!alive) return;
        setStep(slide.steps.length);
        if (RM) { setCap('Đã phát xong. Nhấn “Xem lại” để phát lại.'); return; }
        setCap('Đang phát lại từ đầu…');
        await sleep(3200);
      }
    })();
    return () => { alive = false; };
  }, [cur, runId, special, slide]);

  useEffect(() => { pausedRef.current = false; setPaused(false); setStep(-1); setCap(''); }, [cur]);

  const onKey = (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === 'ArrowRight') go(cur + 1);
    else if (e.key === 'ArrowLeft') go(cur - 1);
  };
  const chap = slide.ch;

  return (
    <div className="hb" tabIndex={-1} onKeyDown={onKey}>
      <div className="hb-chaps" role="tablist" aria-label="Các phần của cẩm nang">
        {CH.map(([k, name]) => <button key={k} type="button" role="tab" aria-selected={chap === k} className={chap === k ? 'on' : ''} onClick={() => go(firstOf(k) === 0 ? 1 : firstOf(k))}>{name}</button>)}
      </div>
      {special ? (
        <div key={`full-${cur}`} className="hb-full" ref={fullRef} />
      ) : (
        <div key={`slide-${cur}`} className="hb-slide">
          <div className="hb-text">
            <p className="hb-kick">{chapterName(chap)}</p>
            <h3 className="hb-title">{slide.title}</h3>
            <p className="hb-lead">{slide.lead}</p>
            <ol className="hb-steps">{slide.steps.map((t, i) => <li key={t} className={i < step ? 'done' : i === step ? 'now' : ''}>{t}</li>)}</ol>
            {slide.warn && <p className="hb-note warn"><b>Lưu ý.</b> {slide.warn}</p>}
            {slide.tip && <p className="hb-note"><b>Nên biết.</b> {slide.tip}</p>}
          </div>
          <div className="hb-stagewrap">
            <div ref={hostRef} className="hb-host" aria-label="Màn hình mô phỏng" role="img" />
            <div className="hb-cap"><span aria-live="off">{cap || ' '}</span>
              <span className="hb-capb"><button type="button" className="btn sm" aria-pressed={paused} onClick={togglePause}>{paused ? '▶ Tiếp tục' : '⏸ Tạm dừng'}</button><button type="button" className="btn sm" onClick={replay}>↻ Xem lại</button></span>
            </div>
            <p className="hb-sample">Màn hình mô phỏng. Số liệu và tên là ví dụ.</p>
          </div>
        </div>
      )}
      <div className="hb-nav">
        <button type="button" className="btn" onClick={() => go(cur - 1)} disabled={cur === 0}>← Trang trước</button>
        <span className="hb-count">{cur + 1} / {SL.length}{slide.title ? ` · ${slide.title}` : ''}</span>
        <button type="button" className="btn primary" onClick={() => go(cur + 1)} disabled={cur === SL.length - 1}>Trang sau →</button>
      </div>
    </div>
  );
}
