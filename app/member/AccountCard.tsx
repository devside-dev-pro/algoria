'use client';
// MON COMPTE (ESTIMATION) — la question n°1 des nouveaux (28/09/2026) : « je peux suivre mon compte où ? » /
// « à combien est mon compte ? ». Beaucoup n'ont jamais ouvert MetaTrader. On connaît leur lot de copie ; avec
// leur balance de départ, on additionne chaque trade clôturé d'Algoria ramené à LEUR lot (voir
// /api/member/account). Le mot ESTIMATE est partout, et le guide MT5 juste en dessous donne le vrai chiffre.
import { useEffect, useState } from 'react';
import type { Member } from './ui';

interface Estimate { balance: number; pnl: number; pct: number; trades: number; wins: number; maxDdPct: number; curve: { d: string; b: number }[] }
interface Baseline { balance: number; since: string; lot: number; set_at: string }
interface AccountResp { baseline: Baseline | null; lot: number; lotChanged?: boolean; suggestion?: { balance: number | null; since: string | null }; estimate?: Estimate }

const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;
// « 28 Sept · 19:35 » quand le départ est une heure précise (GO LIVE), « 28 Sept » pour une date saisie
const dayLabel = (iso: string) => {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return iso.length > 10 && d.toISOString().slice(11, 16) !== '00:00' ? `${day} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : day;
};
const today = () => new Date().toISOString().slice(0, 10);

export function AccountCard({ member }: { member: Member }) {
  const [data, setData] = useState<AccountResp | null>(null);
  const [editing, setEditing] = useState(false);
  const [bal, setBal] = useState('');
  const [since, setSince] = useState(today());
  // heure EXACTE derrière la date affichée (GO LIVE, ou « maintenant » pour une mise à jour) : envoyée telle
  // quelle tant que le membre ne change pas la date — sinon minuit du jour choisi
  const [exact, setExact] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);

  const load = () =>
    fetch('/api/member/account').then(async (r) => {
      if (!r.ok) return;
      const d = (await r.json()) as AccountResp;
      setData(d);
      if (!d.baseline) {
        setEditing(true);
        if (d.suggestion?.balance) setBal(String(d.suggestion.balance));
        if (d.suggestion?.since) { setSince(d.suggestion.since.slice(0, 10)); setExact(d.suggestion.since); }
      }
    });
  useEffect(() => { void load(); }, []);

  const save = async () => {
    setErr(null);
    setSaving(true);
    try {
      const r = await fetch('/api/member/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ balance: Number(bal.replace(/[^0-9.]/g, '')), since: exact && exact.slice(0, 10) === since ? exact : since }) });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) { setErr(d.error ?? 'could not save — try again'); return; }
      setEditing(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (!data) return null;
  const e = data.estimate;
  const up = (e?.pnl ?? 0) >= 0;

  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 11, borderColor: 'rgba(43,227,245,.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ fontSize: 13, margin: 0, letterSpacing: 1.2, color: 'var(--muted)' }}>MY ACCOUNT</h2>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.2, color: 'var(--dim)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px' }}>ESTIMATE · {data.lot} LOT</span>
      </div>

      {data.baseline && e && !editing && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="mono" style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1 }}>≈ {money(e.balance)}</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: up ? 'var(--up)' : 'var(--muted)' }}>
              {signed(e.pnl)} ({e.pct >= 0 ? '+' : ''}{e.pct.toFixed(1)}%) <span style={{ color: 'var(--dim)', fontWeight: 500 }}>since {dayLabel(data.baseline.since)}</span>
            </span>
          </div>
          {e.curve.length >= 2 && <Spark points={[data.baseline.balance, ...e.curve.map((c) => c.b)]} up={up} />}
          <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span>started {money(data.baseline.balance)}</span>
            <span>{e.trades} trades{e.trades ? ` · ${Math.round((e.wins / e.trades) * 100)}% wins` : ''}</span>
            {e.maxDdPct < 0 && <span>deepest dip {e.maxDdPct.toFixed(1)}%</span>}
          </div>
          {data.lotChanged && (
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--gold)', lineHeight: 1.5 }}>
              Your lot changed to {data.lot} since this starting point — update it with your current balance so the estimate follows your new size.
            </p>
          )}
          <button onClick={() => { setBal(String(Math.round(e.balance))); setSince(today()); setExact(new Date().toISOString()); setEditing(true); }} style={ghost}>
            ✎ UPDATE STARTING POINT <span style={{ fontWeight: 500, color: 'var(--dim)' }}>· after a deposit or withdrawal</span>
          </button>
        </>
      )}

      {editing && (
        <>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>
            {data.baseline
              ? 'New starting point: your balance today (or on the day of your deposit / withdrawal).'
              : <>Follow your account right here — <b style={{ color: 'var(--text)' }}>no MetaTrader needed</b>. Tell us what you started with: we add every trade Algoria closes, at your lot ({data.lot}).</>}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={field}>
              <span style={fieldLabel}>STARTING BALANCE ($)</span>
              <input inputMode="decimal" value={bal} onChange={(ev) => setBal(ev.target.value)} placeholder="500" style={input} />
            </label>
            <label style={field}>
              <span style={fieldLabel}>{exact && exact.slice(0, 10) === since && !data.baseline && dayLabel(exact).includes(' · ') ? `COPY STARTED · ${dayLabel(exact).split(' · ')[1]}` : 'COPY STARTED ON'}</span>
              <input type="date" className="acct-date" value={since} max={today()} min="2026-06-01" onChange={(ev) => setSince(ev.target.value)} style={input} />
            </label>
          </div>
          {!data.baseline && data.suggestion?.balance && (
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>Prefilled from your activation and the deposit the team recorded — change it if it&rsquo;s not right.</span>
          )}
          {err && <span style={{ fontSize: 12, color: 'var(--gold)' }}>{err}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={saving || !bal} onClick={() => void save()} style={{ ...cta, flex: 1, opacity: saving || !bal ? 0.6 : 1 }}>{saving ? '…' : data.baseline ? 'SAVE' : 'START TRACKING'}</button>
            {data.baseline && <button onClick={() => setEditing(false)} style={{ ...ghost, flex: 0 }}>CANCEL</button>}
          </div>
        </>
      )}

      {/* LE VRAI CHIFFRE — l'estimation ne remplace pas le broker : on apprend à le lire en 4 étapes */}
      <button onClick={() => setGuide((g) => !g)} style={{ ...ghost, border: 'none', background: 'transparent', padding: '2px 0', textAlign: 'left', color: 'var(--cyan)' }}>
        {guide ? '▾' : '▸'} See your exact balance on MetaTrader 5
      </button>
      {guide && (
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--muted)', lineHeight: 1.65, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <li>Install <b style={{ color: 'var(--text)' }}>MetaTrader 5</b> (App Store / Google Play) — free.</li>
          <li>Settings → <b style={{ color: 'var(--text)' }}>New account</b> → search your broker&rsquo;s server{member.mt5_server ? <>: <span className="mono" style={{ color: 'var(--text)' }}>{member.mt5_server}</span></> : ''}.</li>
          <li>Log in with your MT5 login{member.mt5_login ? <> <span className="mono" style={{ color: 'var(--text)' }}>{member.mt5_login}</span></> : ''} and your trading password.</li>
          <li>Open the <b style={{ color: 'var(--text)' }}>Trade</b> tab: <b style={{ color: 'var(--text)' }}>Balance</b> = closed trades, <b style={{ color: 'var(--text)' }}>Equity</b> = including the trade open right now.</li>
        </ol>
      )}
      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.5 }}>
        Estimate from Algoria&rsquo;s closed trades at your lot. Your broker&rsquo;s figure is the real one — spread, commissions and trades missed while paused can move it a little.
      </p>
    </section>
  );
}

// mini-courbe SVG de la balance estimée (fin de journée) — pas de lib, pas d'axe : une tendance, pas un graphe
function Spark({ points, up }: { points: number[]; up: boolean }) {
  const w = 300, h = 46;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - 3 - ((p - min) / span) * (h - 6)).toFixed(1)}`);
  const color = up ? 'var(--up)' : 'var(--muted)';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: h, display: 'block' }} aria-hidden>
      <polyline points={xy.join(' ')} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

const ghost = {
  padding: '10px 14px', borderRadius: 11, cursor: 'pointer', textAlign: 'center',
  fontWeight: 700, letterSpacing: 0.4, fontSize: 12, color: 'var(--muted)',
  border: '1px solid var(--border)', background: 'rgba(130,152,190,.05)',
} as const;
const cta = {
  padding: '12px 14px', borderRadius: 11, border: 'none', cursor: 'pointer', textAlign: 'center',
  fontWeight: 800, letterSpacing: 0.6, fontSize: 13, color: '#0b0e14',
  background: 'linear-gradient(90deg,#2be3f5,#1fd8b0)',
} as const;
const field = { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 130px', minWidth: 0 } as const;
const fieldLabel = { fontSize: 9.5, letterSpacing: 1.2, color: 'var(--dim)', fontWeight: 700 } as const;
const input = {
  padding: '10px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.6)',
  color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
  height: 42, display: 'block', minWidth: 0, // même hauteur que le champ date iOS, jamais plus large que sa colonne
} as const;
