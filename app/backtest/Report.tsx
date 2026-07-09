'use client';
// Rapport de backtest PUBLIC (algoria.tech/backtest) — à partager aux prospects qui demandent un historique.
// HONNÊTETÉ : clairement étiqueté SIMULATION, jamais présenté comme du live, et surtout COMBINÉ — toutes les
// stratégies (scalp gold + swing gold + swing BTC) sur UN SEUL compte, comme un membre les reçoit vraiment.
// Fenêtre du combiné = le mois de M5 dispo (le seul où on a scalp ET swing). Le swing seul, backtesté plus loin
// (12 mois / plusieurs années), sert de CONTEXTE (l'edge n'est pas neuf). Chiffres issus du backtester causal du
// repo (backtest/combined.ts + lab.ts) — régénérer et remplacer les tableaux quand les données s'allongent.
import { useEffect, useRef } from 'react';

// équité SIMULÉE du LIVRE COMPLET (scalp+swings, un compte, 1% de risque/trade, composé) sur le mois — ~140 pts
const EQ = [10000, 9982, 9823, 9771, 9851, 9788, 9734, 9577, 9408, 9227, 9181, 9153, 9271, 9384, 9364, 9411, 9460, 9509, 9558, 9640, 9709, 9774, 9855, 9916, 9847, 9860, 9945, 10030, 10118, 10206, 10044, 10022, 10074, 10194, 10140, 10159, 10213, 10269, 10141, 10119, 10050, 10171, 10045, 10149, 10147, 10153, 10110, 9932, 10075, 11239, 11297, 11342, 11399, 11325, 11419, 11491, 11413, 11346, 11150, 11187, 11308, 11450, 11385, 11343, 11418, 11473, 11305, 11381, 11559, 11708, 11825, 11930, 12070, 12189, 12252, 12315, 12415, 12529, 12461, 12524, 12482, 12560, 12508, 12310, 12778, 12706, 12634, 12725, 12559, 12486, 12590, 12656, 12764, 12704, 12751, 13045, 13123, 13146, 12896, 13007, 13164, 13135, 13246, 13922, 13996, 13905, 13857, 13829, 13873, 13898, 13667, 13715, 13485, 13227, 13185, 13340, 13312, 13241, 13384, 13540, 13501, 13403, 13569, 13668, 13775, 13654, 13593, 13560, 13677, 13792, 13773, 13740, 13822, 13971, 14036, 14193, 14306, 14397, 14515, 14595, 14764, 14841, 14629, 14701, 14418, 14387, 14387];
const WEEKS = [
  { label: 'Jun 02–08', n: 56, win: 73, net: -636 }, { label: 'Jun 08–15', n: 133, win: 87, net: 595 },
  { label: 'Jun 15–22', n: 139, win: 91, net: 2548 }, { label: 'Jun 22–29', n: 144, win: 83, net: 876 },
  { label: 'Jun 29–Jul 02', n: 108, win: 89, net: 1003 },
];
const START = 10_000;
const maxAbs = Math.max(...WEEKS.map((w) => Math.abs(w.net)));
const usd = (n: number) => n.toLocaleString('en-US');

const CSS = `
.bt{--bg:#070b12;--panel:rgba(17,29,52,.55);--panel2:rgba(12,21,38,.7);--line:rgba(130,152,190,.16);
  --ink:#e9f1ff;--muted:#96a7c6;--dim:#61738f;--cyan:#2be3f5;--blue:#2e8bf0;--gold:#f5c24a;--up:#26e0a6;--down:#ff6f8e;--amber:#f5a623;
  --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;--disp:var(--font-display),system-ui,-apple-system,"Segoe UI",sans-serif;
  min-height:100dvh;background:radial-gradient(120% 60% at 50% -8%,#10223e 0%,transparent 55%),var(--bg);color:var(--ink);
  font-family:var(--disp);line-height:1.55;-webkit-font-smoothing:antialiased;letter-spacing:.1px}
.bt *{box-sizing:border-box}
.bt .wrap{max-width:900px;margin:0 auto;padding:34px 22px 60px}
.bt .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:2.4px;color:var(--dim);text-transform:uppercase}
.bt .mast{display:flex;align-items:center;gap:13px;margin-bottom:20px}
.bt .mark{width:40px;height:40px;flex:none;filter:drop-shadow(0 0 12px rgba(43,227,245,.45))}
.bt .brand{font-size:23px;font-weight:800;letter-spacing:.4px;background:linear-gradient(90deg,var(--cyan),var(--blue));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.bt .mast .sub{margin-left:auto;text-align:right}
.bt .mast .sub .t{font-family:var(--mono);font-size:11px;letter-spacing:1.6px;color:var(--gold);font-weight:700}
.bt .mast .sub .d{font-family:var(--mono);font-size:10.5px;color:var(--dim);margin-top:2px}
.bt .sim{display:flex;gap:13px;align-items:flex-start;border:1px solid rgba(245,166,35,.45);border-left:3px solid var(--amber);
  background:linear-gradient(90deg,rgba(245,166,35,.12),rgba(245,166,35,.03));border-radius:12px;padding:14px 16px;margin-bottom:26px}
.bt .sim .ic{font-size:17px;line-height:1.2}
.bt .sim h2{margin:0 0 3px;font-size:13.5px;letter-spacing:1.4px;text-transform:uppercase;color:#ffd98a}
.bt .sim p{margin:0;font-size:12.5px;color:var(--muted);line-height:1.5;max-width:66ch}
.bt .lede{font-size:15px;color:var(--muted);max-width:68ch;margin:0 0 34px;line-height:1.65}
.bt .lede b{color:var(--ink);font-weight:600}
.bt section{margin:0 0 36px}
.bt .sechead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:0 0 6px;padding-bottom:10px;border-bottom:1px solid var(--line)}
.bt .sechead h3{margin:0;font-size:18px;font-weight:750;letter-spacing:.2px;text-wrap:balance}
.bt .sechead .per{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:.6px}
.bt .sechead .tag{font-family:var(--mono);font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:var(--up);border:1px solid rgba(38,224,166,.35);border-radius:5px;padding:2px 7px}
.bt .subhead{font-size:12.5px;color:var(--muted);margin:0 0 15px;max-width:66ch;line-height:1.6}
.bt .chartcard{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:16px 16px 8px;margin-bottom:14px}
.bt .chartcard .cap{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:10px;flex-wrap:wrap}
.bt .chartcard .cap .l{font-family:var(--mono);font-size:10.5px;letter-spacing:1.1px;color:var(--dim);text-transform:uppercase}
.bt canvas{display:block;width:100%;height:220px}
.bt .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.bt .tile{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:13px 14px;border-top:2px solid var(--tc,var(--cyan))}
.bt .tile .k{font-family:var(--mono);font-size:9.5px;letter-spacing:1.3px;color:var(--dim);text-transform:uppercase}
.bt .tile .v{font-family:var(--mono);font-size:25px;font-weight:800;margin-top:5px;line-height:1;color:var(--ink)}
.bt .tile .s{font-family:var(--mono);font-size:10px;color:var(--muted);margin-top:5px}
.bt .tblwrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;margin-top:14px;background:var(--panel2)}
.bt table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12.5px;min-width:460px}
.bt th{text-align:right;padding:9px 14px;font-size:9.5px;letter-spacing:1.2px;color:var(--dim);text-transform:uppercase;border-bottom:1px solid var(--line);font-weight:600}
.bt th:first-child,.bt td:first-child{text-align:left}
.bt td{padding:8px 14px;border-bottom:1px solid rgba(130,152,190,.08);color:var(--muted);font-family:var(--mono);font-variant-numeric:tabular-nums}
.bt tr:last-child td{border-bottom:none}
.bt .pos{color:var(--up)}.bt .neg{color:var(--down)}
.bt .bar{display:inline-block;height:7px;border-radius:2px;vertical-align:middle;margin-right:8px}
.bt .cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.bt .card{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:16px 17px}
.bt .card .h{display:flex;align-items:center;gap:9px;margin-bottom:3px}
.bt .card .h .dot{width:8px;height:8px;border-radius:50%}
.bt .card .h .name{font-size:14.5px;font-weight:750}
.bt .card .h .yrs{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--dim);letter-spacing:.6px}
.bt .card .desc{font-size:12px;color:var(--dim);margin:0 0 14px;line-height:1.5}
.bt .card .g{display:grid;grid-template-columns:1fr 1fr;gap:11px 14px}
.bt .card .m .k{font-family:var(--mono);font-size:9px;letter-spacing:1.1px;color:var(--dim);text-transform:uppercase}
.bt .card .m .v{font-family:var(--mono);font-size:19px;font-weight:800;margin-top:2px;line-height:1}
.bt .card .recent{margin-top:13px;padding-top:12px;border-top:1px solid var(--line);font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.3px}
.bt .card .recent b{color:var(--up);font-weight:700}
.bt .note{font-size:11.5px;color:var(--dim);margin:10px 2px 0;line-height:1.55}
.bt .note b{color:var(--muted);font-weight:600}
.bt .method{border:1px solid var(--line);border-radius:12px;background:var(--panel2);padding:15px 17px}
.bt .method h4{margin:0 0 9px;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted)}
.bt .method ul{margin:0;padding-left:17px;display:flex;flex-direction:column;gap:6px}
.bt .method li{font-size:12.5px;color:var(--muted);line-height:1.5}
.bt .method li b{color:var(--ink);font-weight:600}
.bt .disc{margin-top:30px;padding-top:18px;border-top:1px solid var(--line)}
.bt .disc h4{margin:0 0 8px;font-family:var(--mono);font-size:10px;letter-spacing:1.8px;text-transform:uppercase;color:var(--amber)}
.bt .disc p{margin:0 0 9px;font-size:11.5px;color:var(--dim);line-height:1.6;max-width:78ch}
.bt .disc p b{color:var(--muted)}
.bt .foot{margin-top:22px;display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-family:var(--mono);font-size:10.5px;letter-spacing:.6px;color:var(--dim)}
.bt .foot .badge{color:var(--cyan);border:1px solid rgba(43,227,245,.3);border-radius:20px;padding:3px 11px;text-decoration:none}
@media (max-width:560px){.bt .cards{grid-template-columns:1fr}.bt .tile .v{font-size:21px}.bt .sechead .per{margin-left:0;width:100%}}
`;

export default function Report() {
  const cv = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const padL = 6, padR = 6, padT = 12, padB = 10;
      const lo = Math.min(Math.min(...EQ), START), hi = Math.max(...EQ), rng = hi - lo || 1;
      const X = (i: number) => padL + (w - padL - padR) * (i / (EQ.length - 1));
      const Y = (v: number) => padT + (h - padT - padB) * (1 - (v - lo) / rng);
      ctx.strokeStyle = 'rgba(130,152,190,.10)'; ctx.lineWidth = 1;
      for (let g = 0; g <= 3; g++) { const yy = padT + (h - padT - padB) * g / 3; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke(); }
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(150,167,198,.35)';
      ctx.beginPath(); ctx.moveTo(padL, Y(START)); ctx.lineTo(w - padR, Y(START)); ctx.stroke(); ctx.setLineDash([]);
      const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
      grad.addColorStop(0, 'rgba(38,224,166,.34)'); grad.addColorStop(1, 'rgba(38,224,166,0)');
      ctx.beginPath(); ctx.moveTo(X(0), Y(EQ[0]));
      for (let i = 1; i < EQ.length; i++) ctx.lineTo(X(i), Y(EQ[i]));
      ctx.lineTo(X(EQ.length - 1), h - padB); ctx.lineTo(X(0), h - padB); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath(); ctx.moveTo(X(0), Y(EQ[0]));
      for (let j = 1; j < EQ.length; j++) ctx.lineTo(X(j), Y(EQ[j]));
      ctx.strokeStyle = '#26e0a6'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(38,224,166,.5)'; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
      const ex = X(EQ.length - 1), ey = Y(EQ[EQ.length - 1]);
      ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, 7); ctx.fillStyle = '#26e0a6'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex, ey, 7, 0, 7); ctx.strokeStyle = 'rgba(38,224,166,.4)'; ctx.lineWidth = 1.5; ctx.stroke();
    };
    draw();
    let to: ReturnType<typeof setTimeout>;
    const onR = () => { clearTimeout(to); to = setTimeout(draw, 120); };
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  const tile = (tc: string): React.CSSProperties => ({ ['--tc']: tc } as React.CSSProperties);

  return (
    <main className="bt">
      <style>{CSS}</style>
      <div className="wrap">

        <div className="mast">
          <img className="mark" src="/brand/algoria-mark.png" alt="Algoria" />
          <div>
            <div className="brand">ALGORIA&nbsp;AI</div>
            <div className="eyebrow" style={{ marginTop: 2 }}>Strategy Backtest Report</div>
          </div>
          <div className="sub">
            <div className="t">GOLD · BITCOIN</div>
            <div className="d">Generated July 2026</div>
          </div>
        </div>

        <div className="sim">
          <span className="ic">⚠️</span>
          <div>
            <h2>Historical simulation · not live trading results</h2>
            <p>Every figure below is a <b style={{ color: '#ffd98a' }}>backtest</b> — the strategy replayed on historical market data, not money traded on a live account. It shows how the edge behaved in the past. It is <b style={{ color: '#ffd98a' }}>not</b> a live track record and does not predict future results.</p>
          </div>
        </div>

        <p className="lede">Algoria runs several strategies at once — fast intraday scalps plus slower swing positions held for days. This is a <b>full month of all of them together, on one account</b> — every trade a member&rsquo;s account would have taken, not a hand-picked strategy. Real gold &amp; Bitcoin prices, with spreads, commissions and slippage modelled in. Live trading began July 2026; this is the history behind it.</p>

        <section>
          <div className="sechead">
            <h3>The complete book — every strategy, one account</h3>
            <span className="tag">all trades</span>
            <span className="per">2 Jun → 2 Jul 2026 · 31 days</span>
          </div>
          <p className="subhead">Scalping and swing running side by side, exactly as a member receives them — 580 trades in one month on a single simulated account.</p>

          <div className="chartcard">
            <div className="cap">
              <span className="l">Simulated equity · $10,000 start · 1% risk / trade · compounding</span>
              <span className="l">$10,000 → ${usd(EQ[EQ.length - 1])} (sim)</span>
            </div>
            <canvas ref={cv} aria-label="Simulated one-month equity curve of all Algoria strategies combined" />
          </div>

          <div className="tiles">
            <div className="tile" style={tile('var(--blue)')}><div className="k">Total trades</div><div className="v">580</div><div className="s">562 scalp · 18 swing</div></div>
            <div className="tile" style={tile('var(--up)')}><div className="k">Win rate</div><div className="v" style={{ color: 'var(--up)' }}>86%</div><div className="s">498 winners</div></div>
            <div className="tile" style={tile('var(--cyan)')}><div className="k">Profit factor</div><div className="v">1.47</div><div className="s">gross win ÷ gross loss</div></div>
            <div className="tile" style={tile('var(--down)')}><div className="k">Max drawdown</div><div className="v">8.7%</div><div className="s">worst peak-to-trough</div></div>
            <div className="tile" style={tile('var(--gold)')}><div className="k">Weeks green</div><div className="v">4<span style={{ fontSize: 15, color: 'var(--dim)' }}> / 5</span></div><div className="s">one week closed red</div></div>
          </div>

          <div className="tblwrap">
            <table>
              <thead><tr><th>Week</th><th>Trades</th><th>Win rate</th><th>Result (sim)</th></tr></thead>
              <tbody>
                {WEEKS.map((wk) => {
                  const pos = wk.net >= 0;
                  return (
                    <tr key={wk.label}>
                      <td>{wk.label}</td>
                      <td style={{ textAlign: 'right' }}>{wk.n}</td>
                      <td style={{ textAlign: 'right' }}>{wk.win}%</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="bar" style={{ width: Math.round(Math.abs(wk.net) / maxAbs * 80), background: pos ? 'rgba(38,224,166,.5)' : 'rgba(255,111,142,.5)' }} />
                        <span className={pos ? 'pos' : 'neg'}>{pos ? '+' : '−'}${usd(Math.abs(wk.net))}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">The first week closed red — shown as it happened. Result is the net on a simulated $10,000 account risking <b>1% per trade, compounding</b>, so dollar amounts grow with the (simulated) balance. This is a history of what the strategies did, <b>not a promised return</b> — the risk you choose and live conditions change everything.</p>
        </section>

        <section>
          <div className="sechead"><h3>The edge isn&rsquo;t new — the swing layer, further back</h3></div>
          <p className="subhead">Only one month of minute-level data is available for the intraday layer, so the full book above spans one month. The slower swing layer, which runs on hourly candles, can be replayed over years — here&rsquo;s that layer on its own, as evidence the strategy predates the live account.</p>
          <div className="cards">
            <div className="card">
              <div className="h"><span className="dot" style={{ background: 'var(--gold)' }} /><span className="name">Gold swing</span><span className="yrs">12 months</span></div>
              <p className="desc">Trend continuation on the 1-hour chart, held for days. 10 of 13 months green.</p>
              <div className="g">
                <div className="m"><div className="k">Profit factor</div><div className="v" style={{ color: 'var(--up)' }}>1.93</div></div>
                <div className="m"><div className="k">Win rate</div><div className="v">52%</div></div>
                <div className="m"><div className="k">Max drawdown</div><div className="v">13.1%</div></div>
                <div className="m"><div className="k">Trades</div><div className="v">223</div></div>
              </div>
              <div className="recent">Jul 2025 → Jul 2026 · <b>10/13 months profitable</b></div>
            </div>

            <div className="card">
              <div className="h"><span className="dot" style={{ background: '#f7931a' }} /><span className="name">Bitcoin swing</span><span className="yrs">2.6 years</span></div>
              <p className="desc">24-hour range breakout on the 1-hour chart — trades weekends too.</p>
              <div className="g">
                <div className="m"><div className="k">Profit factor</div><div className="v" style={{ color: 'var(--up)' }}>2.02</div></div>
                <div className="m"><div className="k">Win rate</div><div className="v">56%</div></div>
                <div className="m"><div className="k">Max drawdown</div><div className="v">9.2%</div></div>
                <div className="m"><div className="k">Trades</div><div className="v">75</div></div>
              </div>
              <div className="recent">Nov 2023 → Jul 2026 · <b>robust across every sub-period</b></div>
            </div>
          </div>
        </section>

        <section>
          <div className="method">
            <h4>How these numbers were produced</h4>
            <ul>
              <li><b>Real historical prices</b> — gold and Bitcoin candles from the live data feed, not synthetic.</li>
              <li><b>All strategies on one account</b> — scalp and swing share a single simulated balance, as a member receives them.</li>
              <li><b>Real costs modelled</b> — broker spread, commission ($7/lot on gold) and slippage on every fill.</li>
              <li><b>Causal, no look-ahead</b> — each decision uses only the candles closed at that moment, exactly like live.</li>
              <li><b>Pessimistic execution</b> — the stop is always assumed hit before the target on the same bar; 1% account risk per trade.</li>
            </ul>
          </div>
        </section>

        <div className="disc">
          <h4>Important — please read</h4>
          <p><b>Hypothetical / simulated performance.</b> The results above are hypothetical, generated by applying the strategy to historical data. They were not achieved with real money, and no representation is made that any account will or is likely to achieve profits or losses similar to those shown. Returns depend heavily on the risk taken per trade.</p>
          <p>Simulated results have inherent limitations — because the trades were not actually executed, they may under- or over-compensate for factors such as liquidity and real-time execution. Past and simulated performance is <b>not indicative of future results</b>.</p>
          <p>Trading leveraged products carries a high level of risk and can result in the loss of your entire deposit. Only trade with money you can afford to lose. This document is informational, is not investment advice or a solicitation, and guarantees no outcome.</p>
          <div className="foot">
            <a className="badge" href="https://algoria.tech">algoria.tech</a>
            <span>Live trading since July 2026 — real trades shown daily on stream.</span>
          </div>
        </div>

      </div>
    </main>
  );
}
