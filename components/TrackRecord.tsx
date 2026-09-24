'use client';
// TRACK RECORD RÉEL (24/09/2026) — l'historique du compte qu'Algoria 2.0 copie, façon Myfxbook.
// Remplace la simulation (ex-lib/backtest/record.ts, retirée) sur l'écran in-app ET sur la page publique /track-record (ex-/backtest).
//
// DEUX LECTURES, UN SEUL JEU DE DONNÉES (/api/public/track) :
//   · % (défaut) — le rendement RÉEL du compte, chaîné jour par jour (méthode « time-weighted », celle de
//     Myfxbook) : un dépôt ou un retrait bouge le solde, jamais le rendement. Il ne dépend d'aucun lot.
//   · $ — ce que les mêmes trades ont rapporté À LA TAILLE CHOISIE. Chaque trade est ramené de son vrai lot
//     à 1 lot côté serveur (`u`), puis multiplié ici par le lot choisi : juste même quand le compte a tradé
//     de 0.01 à 11 lots.
//
// HONNÊTETÉ, PAR CONSTRUCTION : les mois rouges et le pire creux s'affichent comme les autres ; la date de
// départ est écrite en clair, avec la raison ; aucune taille de compte n'est suggérée (décision Mathieu :
// chacun gère son money management) — le % dit seulement que le SIEN dépendra du lot qu'il choisit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SOURCE_TRACK_START_LABEL } from '@/lib/track/source';

type Day = { d: string; u: number; net: number; cash: number; n: number; w: number };
type Track = { since: string; updatedAt: string; currency: string; startBalance: number; balance: number; maxDdPct?: number; maxDdU?: number; days: Day[] };

const LOTS = [0.01, 0.02, 0.05, 0.1, 0.5, 1];
const UP = '#26e0a6', DOWN = '#ff6f8e';
const MONTH = (ym: string) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const fmtUsd = (n: number, sign = true) => {
  const a = Math.abs(n);
  const s = a >= 1000 ? Math.round(a).toLocaleString('en-US') : a >= 100 ? a.toFixed(0) : a.toFixed(2);
  return `${sign ? (n >= 0 ? '+' : '−') : n < 0 ? '−' : ''}$${s}`;
};
const fmtPct = (n: number, sign = true) => `${sign ? (n >= 0 ? '+' : '−') : n < 0 ? '−' : ''}${Math.abs(n).toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;

function Curve({ points, unit }: { points: number[]; unit: 'pct' | 'usd' }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current; if (!c || points.length < 2) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const padL = 4, padR = 4, padT = 10, padB = 8;
      const lo = Math.min(0, ...points), hi = Math.max(0, ...points), rng = hi - lo || 1;
      const X = (i: number) => padL + (w - padL - padR) * (i / (points.length - 1));
      const Y = (v: number) => padT + (h - padT - padB) * (1 - (v - lo) / rng);
      ctx.strokeStyle = 'rgba(130,152,190,.09)'; ctx.lineWidth = 1;
      for (let g = 0; g <= 3; g++) { const yy = padT + (h - padT - padB) * g / 3; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke(); }
      // ligne du zéro : le point de départ, pour que le creux se lise par rapport à lui
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(150,167,198,.35)';
      ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(w - padR, Y(0)); ctx.stroke(); ctx.setLineDash([]);
      const last = points[points.length - 1];
      const col = last >= 0 ? UP : DOWN;
      const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
      grad.addColorStop(0, last >= 0 ? 'rgba(38,224,166,.30)' : 'rgba(255,111,142,.28)'); grad.addColorStop(1, 'rgba(38,224,166,0)');
      ctx.beginPath(); ctx.moveTo(X(0), Y(points[0]));
      for (let i = 1; i < points.length; i++) ctx.lineTo(X(i), Y(points[i]));
      ctx.lineTo(X(points.length - 1), Y(0)); ctx.lineTo(X(0), Y(0)); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath(); ctx.moveTo(X(0), Y(points[0]));
      for (let j = 1; j < points.length; j++) ctx.lineTo(X(j), Y(points[j]));
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(38,224,166,.45)'; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(X(points.length - 1), Y(last), 3.2, 0, 7); ctx.fillStyle = col; ctx.fill();
    };
    draw();
    let t: ReturnType<typeof setTimeout>;
    const onR = () => { clearTimeout(t); t = setTimeout(draw, 120); };
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, [points]);
  return <canvas ref={cv} style={{ width: '100%', height: 170, display: 'block' }} aria-label={unit === 'pct' ? 'Account return over time' : 'Result over time at the selected lot size'} />;
}

function Kpi({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ flex: '1 1 92px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: 1, color: 'var(--dim)', textTransform: 'uppercase' }}>{label}</span>
      <span className="mono" style={{ fontSize: 19, fontWeight: 800, color: color ?? 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontSize: 9.5, color: 'var(--dim)' }}>{sub}</span>}
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<{ v: T; t: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 2, padding: 2, borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.6)' }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button key={String(o.v)} type="button" onClick={() => onChange(o.v)} aria-pressed={on} className="mono"
            style={{ padding: '7px 11px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 800,
              background: on ? 'rgba(43,227,245,.16)' : 'transparent', color: on ? 'var(--cyan)' : 'var(--dim)' }}>
            {o.t}
          </button>
        );
      })}
    </div>
  );
}

export function TrackRecord() {
  const [data, setData] = useState<Track | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<'pct' | 'usd'>('pct');
  const [lot, setLot] = useState(0.1);

  useEffect(() => {
    void fetch('/api/public/track').then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as Track);
    }).catch(() => setFailed(true));
  }, []);

  const view = useMemo(() => {
    if (!data || !data.days.length) return null;
    // % : indice chaîné jour par jour sur le solde de la VEILLE — les espèces changent le solde, pas l'indice
    let bal = data.startBalance, idx = 1;
    const pctSeries: number[] = [], usdSeries: number[] = [];
    let cumU = 0;
    const months = new Map<string, { idx0: number; idx1: number; u: number; n: number; w: number }>();
    for (const day of data.days) {
      const r = bal > 0 ? day.net / bal : 0;
      const ym = day.d.slice(0, 7);
      const m = months.get(ym) ?? { idx0: idx, idx1: idx, u: 0, n: 0, w: 0 };
      idx *= 1 + r;
      bal += day.net + day.cash;
      cumU += day.u;
      m.idx1 = idx; m.u += day.u; m.n += day.n; m.w += day.w;
      months.set(ym, m);
      pctSeries.push((idx - 1) * 100);
      usdSeries.push(cumU * lot);
    }
    const series = mode === 'pct' ? pctSeries : usdSeries;
    // PIRE CREUX : celui du serveur, calculé TRADE PAR TRADE. La courbe ci-dessous est journalière et lisse
    // les creux intra-journée ; elle ne sert qu'à dessiner. Repli sur la journée si l'API ne le fournit pas.
    let peakIdx = 1, ddPct = 0, peakUsd = 0, ddUsd = 0;
    pctSeries.forEach((p, i) => {
      const ix = 1 + p / 100;
      peakIdx = Math.max(peakIdx, ix); ddPct = Math.min(ddPct, (ix / peakIdx - 1) * 100);
      const c = usdSeries[i]; peakUsd = Math.max(peakUsd, c); ddUsd = Math.min(ddUsd, c - peakUsd);
    });
    if (data.maxDdPct != null) ddPct = Math.min(ddPct, data.maxDdPct);
    if (data.maxDdU != null) ddUsd = Math.min(ddUsd, data.maxDdU * lot);
    const trades = data.days.reduce((a, d) => a + d.n, 0);
    const wins = data.days.reduce((a, d) => a + d.w, 0);
    const monthRows = [...months.entries()].map(([ym, m]) => ({ ym, pct: (m.idx1 / m.idx0 - 1) * 100, usd: m.u * lot, n: m.n, win: m.n ? Math.round((m.w / m.n) * 100) : 0 }));
    const val = (row: { pct: number; usd: number }) => (mode === 'pct' ? row.pct : row.usd);
    const green = monthRows.filter((m) => val(m) >= 0).length;
    const best = monthRows.reduce((b, m) => (val(m) > val(b) ? m : b), monthRows[0]);
    return { series, total: series[series.length - 1], dd: mode === 'pct' ? ddPct : ddUsd, trades, winRate: trades ? Math.round((wins / trades) * 100) : 0, monthRows, green, best, val };
  }, [data, mode, lot]);

  const fmt = (n: number, sign = true) => (mode === 'pct' ? fmtPct(n, sign) : fmtUsd(n, sign));
  const updated = data ? new Date(data.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '';

  if (failed) return <p style={{ fontSize: 12.5, color: 'var(--dim)' }}>The track record could not be loaded right now — try again in a minute.</p>;
  if (!data || !view) return <p style={{ fontSize: 12.5, color: 'var(--dim)' }}>loading…</p>;
  const maxAbs = Math.max(...view.monthRows.map((m) => Math.abs(view.val(m)))) || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* étiquette RÉEL — l'inverse exact de l'ancien bandeau « simulation » */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', borderRadius: 11, border: '1px solid rgba(38,224,166,.34)', background: 'rgba(38,224,166,.06)' }}>
        <span style={{ fontSize: 15 }}>✅</span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.4 }}>
          <b className="mono" style={{ color: 'var(--up)', letterSpacing: 0.5, fontSize: 10.5 }}>REAL ACCOUNT</b> — every trade of the MetaTrader 5 account Algoria copies, read directly from the broker. Updated every 6 hours.
        </span>
      </div>

      {/* sélecteurs : % par défaut ; le lot n'a de sens qu'en dollars */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Seg label="Show results in" value={mode} onChange={setMode} options={[{ v: 'pct', t: '%' }, { v: 'usd', t: '$' }]} />
        {mode === 'usd' && <Seg label="Lot size" value={lot} onChange={setLot} options={LOTS.map((l) => ({ v: l, t: l.toFixed(2) }))} />}
      </div>

      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4, borderColor: 'rgba(43,227,245,.3)' }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.6, color: 'var(--cyan)', fontWeight: 800 }}>◆ ALGORIA — TRACK RECORD</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 34, fontWeight: 800, color: view.total >= 0 ? 'var(--up)' : 'var(--down)', letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>{fmt(view.total)}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{mode === 'pct' ? 'account return' : `at ${lot.toFixed(2)} lot`}</span>
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>Since Algoria&rsquo;s launch, {SOURCE_TRACK_START_LABEL} · {view.monthRows.length} months · last update {updated}</span>
      </section>

      <section className="panel" style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <Kpi label="Trades" value={view.trades.toLocaleString('en-US')} />
        <Kpi label="Win rate" value={`${view.winRate}%`} color="var(--up)" />
        <Kpi label="Max drawdown" value={fmt(view.dd, false)} color="var(--down)" sub="worst peak-to-trough" />
        <Kpi label="Months green" value={`${view.green}/${view.monthRows.length}`} color="var(--gold)" />
        <Kpi label="Best month" value={fmt(view.val(view.best))} color="var(--up)" sub={MONTH(view.best.ym)} />
      </section>

      <section className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: 1, color: 'var(--muted)' }}>{mode === 'pct' ? 'ACCOUNT RETURN' : `RESULT AT ${lot.toFixed(2)} LOT`}</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>→ {fmt(view.total)}</span>
        </div>
        <Curve points={[0, ...view.series]} unit={mode} />
      </section>

      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--dim)', fontWeight: 700 }}>MONTH BY MONTH</span>
        {view.monthRows.map((m) => {
          const v = view.val(m), pos = v >= 0;
          return (
            <div key={m.ym} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0', borderBottom: '1px solid rgba(130,152,190,.09)' }}>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)', minWidth: 62 }}>{MONTH(m.ym)}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', minWidth: 58 }}>{m.n} trades</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{m.win}%</span>
              <span style={{ flex: 1 }} />
              <span style={{ width: Math.round((Math.abs(v) / maxAbs) * 46), height: 5, borderRadius: 3, background: pos ? 'rgba(38,224,166,.45)' : 'rgba(255,111,142,.5)' }} />
              <span className="mono" style={{ fontSize: 12.5, fontWeight: pos ? 800 : 600, color: pos ? 'var(--up)' : 'rgba(210,150,165,.85)', minWidth: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(v)}</span>
            </div>
          );
        })}
      </section>

      <p style={{ margin: '0 2px', fontSize: 11, color: 'var(--dim)', lineHeight: 1.55 }}>
        {mode === 'pct'
          ? <>The <b style={{ color: 'var(--muted)' }}>%</b> is the real account&rsquo;s return, day by day. Your own % depends on the lot you copy at compared to your balance.</>
          : <>The <b style={{ color: 'var(--muted)' }}>$</b> figures show what the same trades made at <b style={{ color: 'var(--muted)' }}>{lot.toFixed(2)} lot</b> — each trade scaled from its real size.</>}
        {' '}Shown since Algoria&rsquo;s launch in {SOURCE_TRACK_START_LABEL}: the account traded before that date, and those months are not part of Algoria&rsquo;s record. Red months and drawdowns are shown as they happened. Past performance is <b style={{ color: 'var(--muted)' }}>not a promise</b> of future results.
      </p>
    </div>
  );
}
