// CSS của màn hình mô phỏng. Chạy trong Shadow DOM nên không lẫn với giao diện chính; màu cố định giống màn hình thật ở chế độ sáng.
export const MOCK_CSS = String.raw`:host{display:block;--hb-serif:var(--font-display,Georgia,serif);--hb-sans:var(--font-ui,system-ui,sans-serif);--m-red:#633d37}
*{box-sizing:border-box}
.stage{position:relative;overflow:hidden;border-radius:12px;border:1px solid var(--rule,rgba(48,31,18,.14));background:#f6f3ee;container-type:inline-size;min-height:360px;color:#301f12;font-family:var(--hb-sans)}

.app{display:grid;grid-template-columns:1fr;min-height:360px;font-size:12.5px;line-height:1.45;font-variant-numeric:tabular-nums}
.app aside{display:none;background:#301f12;color:#ede3d2;padding:12px 8px;gap:2px;flex-direction:column}
.app aside .lg{font-family:var(--hb-serif);font-size:15px;padding:0 8px 10px;color:#ede3d2}
.app aside span{padding:6px 8px;border-radius:6px;color:#cdb58d}
.app aside span.on{background:#633d37;color:#fdfcf9}
.app section{padding:14px;min-width:0;position:relative}
.app header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.app h4{font-family:var(--hb-serif);font-size:17px;margin:0}
.act{display:flex;gap:6px;flex-wrap:wrap}
@container (min-width:520px){.app{grid-template-columns:118px 1fr}.app aside{display:flex}}
.fld{margin-bottom:10px;min-width:0}
.fld label,.lb{display:block;font-size:11px;font-weight:500;color:#7a665a;margin-bottom:3px}
.inp{border:1px solid #b8a894;background:#fdfcf9;border-radius:6px;padding:7px 9px;min-height:32px;display:flex;align-items:center;transition:border-color .2s,box-shadow .2s}
.inp.typing{border-color:var(--m-red);box-shadow:0 0 0 2px rgba(99,61,55,.14)}
.inp .caret{display:none;width:1px;height:14px;background:#301f12;margin-left:1px}
.inp.typing .caret{display:block;animation:bl 1s steps(1) infinite}
@keyframes bl{50%{opacity:0}}
.mb{font:500 12.5px var(--hb-sans);border:1px solid #b8a894;background:#fdfcf9;color:#301f12;border-radius:6px;padding:7px 12px;min-height:32px;transition:transform .12s,background .2s}
.mb.pri{background:var(--m-red);color:#fdfcf9;border-color:var(--m-red)}
.mb.press{transform:scale(.95)}
.mb.sm{padding:4px 9px;min-height:26px;font-size:12px}
.opt{display:inline-block;border:1px solid #b8a894;background:#fdfcf9;border-radius:6px;padding:5px 10px;margin:0 4px 4px 0;transition:.2s}
.opt.sel{background:var(--m-red);color:#fdfcf9;border-color:var(--m-red)}
.cards4{display:flex;flex-wrap:wrap}
.pl{font-style:normal;font-size:11px;font-weight:500;border-radius:20px;padding:2px 9px;display:inline-block;background:#e9e3d8;color:#5a4a3e;transition:.3s}
.pl.g{background:#e1eddb;color:#2f5a3a}.pl.b{background:#dde9f4;color:#2b5a86}.pl.p{background:#e8e0f2;color:#5a3d86}.pl.o{background:#f6e3cb;color:#85500f}.pl.r{background:#f6dcdc;color:#8d2b2b}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@container (max-width:460px){.two{grid-template-columns:1fr}}
.app table{width:100%;border-collapse:collapse;background:#fdfcf9;border:1px solid #e6ddcd;border-radius:6px;margin-bottom:10px}
.app th{font-size:11px;text-align:left;color:#7a665a;background:#f1ebe0;padding:6px 8px;font-weight:500}
.app td{padding:6px 8px;border-top:1px solid #eee6d8}
.app td:last-child,.app th:last-child{text-align:right}
.hid{opacity:0;transform:translateY(6px);pointer-events:none;transition:opacity .35s,transform .35s}
.hid.on{opacity:1;transform:none}
tr.hid{transform:none}
.mod{position:absolute;inset:0;background:rgba(48,31,18,.38);display:flex;align-items:center;justify-content:center;padding:12px;z-index:5}
.mod .box{background:#fdfcf9;border-radius:10px;padding:14px;width:min(380px,100%);max-height:100%;overflow:auto}
.mod h5{font-family:var(--hb-serif);font-size:15px;margin:0 0 10px}
.mod .ft{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}
.toast{position:absolute;left:12px;right:12px;bottom:12px;background:#301f12;color:#fdfcf9;border-radius:8px;padding:9px 12px;z-index:8}
.toast.bad{background:#8d2b2b}
.cur{position:absolute;left:0;top:0;width:20px;height:20px;z-index:20;pointer-events:none;transition:transform .7s cubic-bezier(.3,.7,.2,1)}
.cur svg{display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))}
.rip{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:2px solid var(--m-red);z-index:19;pointer-events:none;animation:rp .5s ease-out forwards}
@keyframes rp{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
.kv{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px solid #eee6d8}
.kv:first-child{border-top:0}
.box2{background:#fdfcf9;border:1px solid #e6ddcd;border-radius:8px;padding:10px 12px;margin-bottom:10px}
.flow{display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap}
.flow span{flex:1;min-width:70px;text-align:center;padding:5px 4px;border-radius:6px;background:#ece5d8;color:#7a665a;transition:.3s;font-size:11.5px}
.flow span.done{background:#e1eddb;color:#2f5a3a}
.flow span.cur2{background:var(--m-red);color:#fdfcf9}
.row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;transition:.25s}
.row.sel{background:#efe3d4}
.dot{width:10px;height:10px;border-radius:50%;flex:none;background:#999}
.dot.g{background:#3f8a55}.dot.y{background:#d39a22}.dot.r{background:#c0392b}
.ck{display:inline-grid;place-items:center;width:16px;height:16px;border:1px solid #b8a894;border-radius:4px;flex:none;transition:.25s;color:transparent;font-size:11px}
.on-ck .ck,.ck.ck2{background:#3f8a55;border-color:#3f8a55;color:#fff}
.stamp{position:absolute;right:16px;top:60px;border:2px solid var(--m-red);color:var(--m-red);font-family:var(--hb-serif);padding:2px 10px;border-radius:4px;transform:rotate(-8deg);font-weight:600}
.sw{display:inline-block;width:26px;height:26px;border-radius:50%;margin:0 6px 6px 0;border:2px solid transparent}
.sw.sel{border-color:#301f12}
.ln{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.big{font-family:var(--hb-serif);font-size:20px}
.red{color:#a12b2b}.grn{color:#2f6b3f}
`;
