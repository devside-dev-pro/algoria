'use client';
// 🔎 OÙ LES INSCRITS S'ARRÊTENT (01/10/2026) — 74 % des inscrits ne choisissent jamais de broker ; ce panneau dit
// à quel écran exactement, combien de temps ils y restent, quels brokers ils cliquent sans revenir, et ce que le
// serveur leur refuse. Données : /api/member/admin/funnel (table funnel_events, écrite par l'app membre).
// Chargé à la demande, pas dans le rafraîchissement des 30 s.
import { useState } from 'react';
import { dimP, miniBtn, secH } from '../_shared';

type Data = {
  days: number; signups: number; since: string | null; events: number;
  stages: { key: string; label: string; people: number }[];
  leaveSecs: { step: number; n: number; medianSecs: number | null }[];
  brokers: { broker: string; clicked: number; thenConfirmed: number }[];
  errors: { msg: string; n: number }[];
  budgets: { bracket: string; n: number }[];
  bonus: { shown: number; clicked: number }; backs: number;
  help?: { opened: number; topics: { topic: string; people: number }[] };
  shares?: { openedBy: number; sharers: number; byChannel: { channel: string; n: number }[] };
};
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
const dur = (s: number | null) => (s == null ? '—' : s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);

export function FunnelPanel() {
  const [days, setDays] = useState(14);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (n = days) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/member/admin/funnel?days=${n}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      setD(j);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const top = d?.stages[0]?.people ?? 0;
  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={secH}>🔎 WHERE SIGNUPS STOP</h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {[7, 14, 30].map((n) => (
            <button key={n} onClick={() => { setDays(n); void load(n); }} style={{ ...miniBtn, color: days === n && d ? 'var(--cyan)' : 'var(--muted)' }}>{n} d</button>
          ))}
          <button disabled={busy} onClick={() => void load()} style={miniBtn}>{busy ? 'loading…' : d ? '↻' : 'Load'}</button>
        </div>
      </div>
      {err && <p style={{ ...dimP, color: 'var(--down)' }}>⚠ {err}</p>}
      {!d && !err && <p style={dimP}>Every screen of the signup flow is now measured. Load to see where people stop.</p>}
      {d && (
        <>
          <p style={{ ...dimP, fontSize: 11 }}>
            Last {d.days} days · {d.signups} new signups · {d.events} events{d.since ? ` · measured since ${new Date(d.since).toLocaleDateString('en-GB')}` : ' · nothing measured yet'}.
            People are counted once per stage, whatever day they signed up.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {d.stages.map((s, i) => {
              const prev = i > 0 ? d.stages[i - 1].people : s.people;
              const drop = i > 0 && prev > 0 ? 1 - s.people / prev : 0;
              return (
                <div key={s.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 70px 54px', gap: 10, alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 12, color: 'var(--text)' }}>{s.label}</span>
                    <span style={{ height: 7, borderRadius: 4, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', width: `${top ? Math.max(2, (s.people / top) * 100) : 2}%`, opacity: 0.85 }} />
                  </div>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 800, textAlign: 'right', color: 'var(--text)' }}>{s.people}</span>
                  <span className="mono" style={{ fontSize: 11, textAlign: 'right', color: drop >= 0.5 ? 'var(--down)' : drop >= 0.25 ? 'var(--gold)' : 'var(--dim)' }}>
                    {i === 0 ? '' : `${pct(s.people, prev)}`}
                  </span>
                </div>
              );
            })}
          </div>
          <p style={{ ...dimP, fontSize: 10.5 }}>Right column: share of the previous stage that made it (red = more than half lost).</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ ...secH, fontSize: 10 }}>TIME ON SCREEN BEFORE LEAVING (median)</span>
              {d.leaveSecs.map((l) => <span key={l.step} style={{ fontSize: 12, color: 'var(--text)' }}>Step {l.step + 1}/3 : <b>{dur(l.medianSecs)}</b> <span style={{ color: 'var(--dim)' }}>({l.n} exits)</span></span>)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ ...secH, fontSize: 10 }}>BROKER LINKS · clicked → came back</span>
              {d.brokers.length === 0 && <span style={{ fontSize: 12, color: 'var(--dim)' }}>No click yet.</span>}
              {d.brokers.map((b) => <span key={b.broker} style={{ fontSize: 12, color: 'var(--text)' }}>{b.broker} : {b.clicked} → <b>{b.thenConfirmed}</b> <span style={{ color: 'var(--dim)' }}>({pct(b.thenConfirmed, b.clicked)})</span></span>)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ ...secH, fontSize: 10 }}>OTHER SIGNALS</span>
              <span style={{ fontSize: 12, color: 'var(--text)' }}>Bonus popup : {d.bonus.shown} shown → {d.bonus.clicked} clicked</span>
              <span style={{ fontSize: 12, color: 'var(--text)' }}>Went back a step : {d.backs} people</span>
              {d.shares && <span style={{ fontSize: 12, color: 'var(--text)' }}>📤 Win shares : {d.shares.openedBy} opened · {d.shares.sharers} shared{d.shares.byChannel.length ? ` (${d.shares.byChannel.map((c) => `${c.channel} ×${c.n}`).join(', ')})` : ''}</span>}
              {d.help && <span style={{ fontSize: 12, color: 'var(--text)' }}>🆘 “I’m stuck” : opened by {d.help.opened}{d.help.topics.length ? ` · sent: ${d.help.topics.map((x) => `${x.topic} ×${x.people}`).join(', ')}` : ''}</span>}
              {d.budgets.length > 0 && <span style={{ fontSize: 12, color: 'var(--text)' }}>Budget picked : {d.budgets.map((b) => `${b.bracket} ×${b.n}`).join(' · ')}</span>}
            </div>
          </div>
          {d.errors.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ ...secH, fontSize: 10, color: '#ff8a5c' }}>WHAT THE SERVER REFUSED (most frequent)</span>
              {d.errors.map((e) => <span key={e.msg} style={{ fontSize: 12, color: 'var(--text)' }}>×{e.n} · {e.msg}</span>)}
            </div>
          )}
        </>
      )}
    </section>
  );
}
