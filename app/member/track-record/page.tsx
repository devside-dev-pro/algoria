'use client';
// TRACK RECORD (natif, in-app) — le backtest combiné 16 mois d'Algoria, rendu dans le langage visuel de l'app
// (panels · mono · KPIs · courbe canvas · tableau des mois). Données depuis la SOURCE UNIQUE lib/backtest/record.ts
// (partagée avec la page publique /backtest). CLAIREMENT étiqueté SIMULATION, séparé des vrais trades (History).
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { RECORD, greenMonths } from '@/lib/backtest/record';

const usd = (n: number) => n.toLocaleString('en-US');
const UP = '#26e0a6', DOWN = '#ff6f8e';

function EquityCurve() {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const EQ = RECORD.eq;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const padL = 4, padR = 4, padT = 10, padB = 8;
      const lo = Math.min(Math.min(...EQ), RECORD.start), hi = Math.max(...EQ), rng = hi - lo || 1;
      const X = (i: number) => padL + (w - padL - padR) * (i / (EQ.length - 1));
      const Y = (v: number) => padT + (h - padT - padB) * (1 - (v - lo) / rng);
      // grille
      ctx.strokeStyle = 'rgba(130,152,190,.09)'; ctx.lineWidth = 1;
      for (let g = 0; g <= 3; g++) { const yy = padT + (h - padT - padB) * g / 3; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke(); }
      // ligne de départ (1 000 $)
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(150,167,198,.35)';
      ctx.beginPath(); ctx.moveTo(padL, Y(RECORD.start)); ctx.lineTo(w - padR, Y(RECORD.start)); ctx.stroke(); ctx.setLineDash([]);
      // aire + ligne
      const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
      grad.addColorStop(0, 'rgba(38,224,166,.32)'); grad.addColorStop(1, 'rgba(38,224,166,0)');
      ctx.beginPath(); ctx.moveTo(X(0), Y(EQ[0]));
      for (let i = 1; i < EQ.length; i++) ctx.lineTo(X(i), Y(EQ[i]));
      ctx.lineTo(X(EQ.length - 1), h - padB); ctx.lineTo(X(0), h - padB); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath(); ctx.moveTo(X(0), Y(EQ[0]));
      for (let j = 1; j < EQ.length; j++) ctx.lineTo(X(j), Y(EQ[j]));
      ctx.strokeStyle = UP; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(38,224,166,.5)'; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
      const ex = X(EQ.length - 1), ey = Y(EQ[EQ.length - 1]);
      ctx.beginPath(); ctx.arc(ex, ey, 3.2, 0, 7); ctx.fillStyle = UP; ctx.fill();
    };
    draw();
    let t: ReturnType<typeof setTimeout>;
    const onR = () => { clearTimeout(t); t = setTimeout(draw, 120); };
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  return <canvas ref={cv} style={{ width: '100%', height: 150, display: 'block' }} aria-label="Courbe d'équité simulée 16 mois" />;
}

function Kpi({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 92, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: 1, color: 'var(--dim)', textTransform: 'uppercase' }}>{label}</span>
      <span className="mono" style={{ fontSize: 19, fontWeight: 800, color: color ?? 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontSize: 9.5, color: 'var(--dim)' }}>{sub}</span>}
    </div>
  );
}

export default function TrackRecord() {
  const router = useRouter();
  const maxAbs = Math.max(...RECORD.months.map((m) => Math.abs(m.net)));
  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      <button onClick={() => router.push('/member/history')} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12.5, padding: '2px 0' }}>
        ‹ History
      </button>

      {/* étiquette SIMULATION — jamais présenté comme du live */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', borderRadius: 11, border: '1px solid rgba(245,194,74,.34)', background: 'rgba(245,194,74,.06)' }}>
        <span style={{ fontSize: 15 }}>🧪</span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.4 }}>
          <b className="mono" style={{ color: 'var(--gold)', letterSpacing: 0.5, fontSize: 10.5 }}>HISTORICAL SIMULATION</b> — how Algoria&rsquo;s strategies would have performed on past prices. Not live results. Your real trades are in <b style={{ color: 'var(--text)' }}>History</b>.
        </span>
      </div>

      {/* HERO — le rendement + la fenêtre */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4, borderColor: 'rgba(43,227,245,.3)' }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.6, color: 'var(--cyan)', fontWeight: 800 }}>◆ ALGORIA — FULL TRACK RECORD</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 34, fontWeight: 800, color: 'var(--up)', letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>+{RECORD.returnPct}%</span>
          <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>${usd(RECORD.start)} → ${usd(RECORD.end)}</span>
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>{RECORD.window.from} → {RECORD.window.to} · {RECORD.window.months} full months · every trade on one account, 1% risk/trade, compounding</span>
      </section>

      {/* KPIs */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <Kpi label="Trades" value={usd(RECORD.trades)} sub={RECORD.split} />
        <Kpi label="Win rate" value={`${RECORD.winRate}%`} color="var(--up)" />
        <Kpi label="Profit factor" value={RECORD.profitFactor.toFixed(2)} />
        <Kpi label="Max drawdown" value={`${RECORD.maxDrawdownPct}%`} color="var(--down)" sub="worst peak-to-trough" />
        <Kpi label="Months green" value={`${greenMonths}/${RECORD.months.length}`} color="var(--gold)" />
      </section>

      {/* COURBE */}
      <section className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: 1, color: 'var(--muted)' }}>SIMULATED EQUITY · ${usd(RECORD.start)} START</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>→ ${usd(RECORD.end)}</span>
        </div>
        <EquityCurve />
      </section>

      {/* MOIS PAR MOIS — les rouges montrés honnêtement */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--dim)', fontWeight: 700 }}>MONTH BY MONTH</span>
        {RECORD.months.map((m) => {
          const pos = m.net >= 0;
          return (
            <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0', borderBottom: '1px solid rgba(130,152,190,.09)' }}>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)', minWidth: 52 }}>{m.label}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', minWidth: 58 }}>{m.n} trades</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{m.win}%</span>
              <span style={{ flex: 1 }} />
              <span style={{ width: Math.round(Math.abs(m.net) / maxAbs * 46), height: 5, borderRadius: 3, background: pos ? 'rgba(38,224,166,.45)' : 'rgba(255,111,142,.5)' }} />
              <span className="mono" style={{ fontSize: 12.5, fontWeight: pos ? 800 : 600, color: pos ? 'var(--up)' : 'rgba(210,150,165,.85)', minWidth: 58, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {pos ? '+' : '−'}${usd(Math.abs(m.net))}
              </span>
            </div>
          );
        })}
      </section>

      {/* honnêteté */}
      <p style={{ margin: '0 2px', fontSize: 11, color: 'var(--dim)', lineHeight: 1.55 }}>
        Full calendar months only. Along the way the account sat through a <b style={{ color: 'var(--muted)' }}>~30% drawdown</b> before recovering, and <b style={{ color: 'var(--muted)' }}>{RECORD.months.length - greenMonths} months closed red</b> — shown as they happened. Past simulated performance is <b style={{ color: 'var(--muted)' }}>not a promise</b> of future results; live conditions and the risk you choose change everything.
      </p>

      <button onClick={() => router.push('/member/history')} style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid rgba(43,227,245,.35)', background: 'rgba(43,227,245,.06)', color: 'var(--cyan)', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
        ← Back to Algoria&rsquo;s live trades
      </button>
    </main>
  );
}
