'use client';
// COMPTA (30/09/2026) — la gestion financière d'Algoria d'un coup d'œil : aujourd'hui, hier, la semaine, le mois,
// n'importe quelle période ; par pays, par broker, par source ; coûts (parrainage payé + dépenses) et net.
// Demande de Mathieu : « à chaque fois je me demande combien j'ai fait aujourd'hui, ou même hier, du coup je
// dois compter manuellement ». Données : /api/member/admin/compta ; calculs : lib/admin/compta.ts.
import { useEffect, useMemo, useState } from 'react';
import { Kpi, dangerBtn, dimP, inp, miniBtn, okBtn, secH } from '../_shared';
import {
  addDays, breakdown, daysBetween, delta, localDay, monthEnd, monthStart, normalize, series, totals, weekStart,
  type Cost, type Dep, type RawDeposit, type RawExpense, type RawMember, type RawPayout,
} from '@/lib/admin/compta';

type Preset = 'day' | 'week' | 'month' | 'year' | 'custom';
type By = 'country' | 'broker' | 'source';
const CATEGORIES = ['Ads', 'Tools & subscriptions', 'Team', 'Broker fees', 'Other'];

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const fmtDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtMonth = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

function rangeOf(p: Preset, anchor: string, custom: { from: string; to: string }): { from: string; to: string; label: string } {
  if (p === 'day') return { from: anchor, to: anchor, label: fmtDay(anchor) };
  if (p === 'week') { const f = weekStart(anchor); return { from: f, to: addDays(f, 6), label: `Week of ${fmtDay(f)}` }; }
  if (p === 'month') return { from: monthStart(anchor), to: monthEnd(anchor), label: fmtMonth(anchor) };
  if (p === 'year') return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31`, label: anchor.slice(0, 4) };
  return { from: custom.from, to: custom.to, label: `${fmtDay(custom.from)} → ${fmtDay(custom.to)}` };
}
/** La période précédente de même forme, pour les variations. */
function prevRange(p: Preset, from: string, to: string): { from: string; to: string } {
  if (p === 'month') { const f = monthStart(addDays(from, -1)); return { from: f, to: monthEnd(f) }; }
  if (p === 'year') { const y = Number(from.slice(0, 4)) - 1; return { from: `${y}-01-01`, to: `${y}-12-31` }; }
  const n = daysBetween(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  const d = delta(cur, prev);
  if (d == null) return <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>—</span>;
  const good = invert ? d <= 0 : d >= 0;
  return <span className="mono" style={{ fontSize: 10.5, fontWeight: 800, color: good ? 'var(--up)' : 'var(--down)' }}>{d >= 0 ? '▲' : '▼'} {Math.abs(d).toFixed(0)}%</span>;
}

export function ComptaTab() {
  const [raw, setRaw] = useState<{ deposits: RawDeposit[]; members: RawMember[]; payouts: RawPayout[]; expenses: RawExpense[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const today = localDay(new Date());
  const [preset, setPreset] = useState<Preset>('month');
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState({ from: monthStart(today), to: today });
  const [by, setBy] = useState<By>('country');
  const [showList, setShowList] = useState(false);
  const [exp, setExp] = useState({ spent_on: today, amount: '', category: 'Ads', note: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setErr(null);
    const r = await fetch('/api/member/admin/compta');
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) { setErr(d.error ?? `HTTP ${r.status}`); return; }
    setRaw(d);
  };
  useEffect(() => { void load(); }, []);

  const { deps, costs } = useMemo<{ deps: Dep[]; costs: Cost[] }>(
    () => (raw ? normalize(raw.deposits, raw.members, raw.payouts, raw.expenses) : { deps: [], costs: [] }), [raw]);
  const { from, to, label } = rangeOf(preset, anchor, custom);
  const prev = prevRange(preset, from, to);
  const cur = useMemo(() => totals(deps, costs, from, to), [deps, costs, from, to]);
  const before = useMemo(() => totals(deps, costs, prev.from, prev.to), [deps, costs, prev.from, prev.to]);

  // les 4 cartes rapides : la réponse à « combien j'ai fait aujourd'hui / hier »
  const quick = useMemo(() => {
    const y = addDays(today, -1);
    const w = weekStart(today); const m = monthStart(today);
    const mk = (k: string, lbl: string, f: string, t: string, pf: string, pt: string, p: Preset, a: string) =>
      ({ k, lbl, cur: totals(deps, costs, f, t), prev: totals(deps, costs, pf, pt), p, a });
    return [
      mk('today', 'TODAY', today, today, y, y, 'day', today),
      mk('yesterday', 'YESTERDAY', y, y, addDays(y, -1), addDays(y, -1), 'day', y),
      mk('week', 'THIS WEEK', w, today, addDays(w, -7), addDays(today, -7), 'week', today),
      mk('month', 'THIS MONTH', m, today, monthStart(addDays(m, -1)), addDays(monthStart(addDays(m, -1)), daysBetween(m, today) - 1), 'month', today),
    ];
  }, [deps, costs, today]);

  // graphique : par jour jusqu'à ~2 mois, par mois au-delà
  const chart = useMemo(() => {
    const pts = series(deps, costs, from, to);
    if (pts.length <= 62) return pts.map((p) => ({ key: p.day, label: p.day.slice(8), earned: p.earned, costs: p.costs, accounts: p.accounts }));
    const g = new Map<string, { key: string; label: string; earned: number; costs: number; accounts: number }>();
    for (const p of pts) {
      const k = p.day.slice(0, 7);
      const r = g.get(k) ?? { key: k, label: new Date(`${k}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'short' }), earned: 0, costs: 0, accounts: 0 };
      r.earned += p.earned; r.costs += p.costs; r.accounts += p.accounts; g.set(k, r);
    }
    return [...g.values()];
  }, [deps, costs, from, to]);
  const maxBar = Math.max(1, ...chart.map((c) => Math.max(c.earned, c.costs)));

  const groups = useMemo(() => breakdown(deps, from, to, by), [deps, from, to, by]);
  const periodDeps = useMemo(() => deps.filter((d) => d.day >= from && d.day <= to).sort((a, b) => b.day.localeCompare(a.day)), [deps, from, to]);
  const periodCosts = useMemo(() => costs.filter((c) => c.day >= from && c.day <= to).sort((a, b) => b.day.localeCompare(a.day)), [costs, from, to]);

  const shift = (dir: 1 | -1) => {
    if (preset === 'day') setAnchor(addDays(anchor, dir));
    else if (preset === 'week') setAnchor(addDays(anchor, 7 * dir));
    else if (preset === 'month') setAnchor(dir < 0 ? addDays(monthStart(anchor), -1) : addDays(monthEnd(anchor), 1));
    else if (preset === 'year') setAnchor(`${Number(anchor.slice(0, 4)) + dir}-06-15`);
  };

  const addExpense = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/member/admin/compta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addExpense: exp }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) { setErr(d.error ?? `HTTP ${r.status}`); return; }
      setExp({ ...exp, amount: '', note: '' });
      await load();
    } finally { setBusy(false); }
  };
  const delExpense = async (id: string) => {
    if (!window.confirm('Delete this expense?')) return;
    setBusy(true);
    try { await fetch('/api/member/admin/compta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deleteExpense: id }) }); await load(); } finally { setBusy(false); }
  };

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['date', 'type', 'member', 'country', 'source', 'broker', 'deposit_usd', 'amount_usd', 'status'].join(','),
      ...periodDeps.map((d) => [d.day, d.nature === 'direct' ? 'direct access' : d.redeposit ? 're-deposit' : 'broker commission', d.who, d.country, d.source, d.broker, d.nature === 'direct' ? '' : d.amount, d.com, d.status].map(esc).join(',')),
      ...periodCosts.map((c) => [c.day, c.kind === 'referral' ? 'referral payout' : 'expense', '', '', '', '', '', -c.amount, c.label].map(esc).join(',')),
      '',
      ['earned', cur.earned].join(','), ['cashed', cur.cash].join(','), ['pending', cur.pending].join(','), ['lost', cur.lost].join(','),
      ['referral_paid', cur.referral].join(','), ['expenses', cur.expenses].join(','), ['net', cur.net].join(','),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `algoria-compta-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!raw) return <section className="panel" style={{ padding: 16 }}><p style={dimP}>{err ?? 'loading…'}</p></section>;

  const presetBtn = (p: Preset, lbl: string) => (
    <button key={p} onClick={() => { setPreset(p); if (p !== 'custom') setAnchor(today); }} className="mono"
      style={{ padding: '7px 11px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
        background: preset === p ? 'rgba(43,227,245,.14)' : 'transparent', color: preset === p ? 'var(--cyan)' : 'var(--dim)' }}>{lbl}</button>
  );

  return (
    <>
      {/* ===== LA RÉPONSE IMMÉDIATE : aujourd'hui, hier, la semaine, le mois ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {quick.map((q) => (
          <button key={q.k} onClick={() => { setPreset(q.p); setAnchor(q.a); }} className="panel"
            style={{ padding: '13px 15px', textAlign: 'left', cursor: 'pointer', color: 'var(--text)', borderTop: '2px solid var(--up)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9.5, letterSpacing: 1.3, color: 'var(--dim)' }}>{q.lbl}</span>
              <Delta cur={q.cur.earned} prev={q.prev.earned} />
            </div>
            <div className="mono" style={{ fontSize: 25, fontWeight: 800, marginTop: 4, color: 'var(--up)' }}>{usd(q.cur.earned)}</div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>
              {q.cur.accounts} account{q.cur.accounts === 1 ? '' : 's'} · {usd(q.cur.deposited)} deposited
            </div>
          </button>
        ))}
      </div>

      {/* ===== PÉRIODE ===== */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.6)' }}>
            {presetBtn('day', 'DAY')}{presetBtn('week', 'WEEK')}{presetBtn('month', 'MONTH')}{presetBtn('year', 'YEAR')}{presetBtn('custom', 'CUSTOM')}
          </div>
          {preset !== 'custom' ? (
            <>
              <button onClick={() => shift(-1)} style={miniBtn}>‹</button>
              <h2 style={{ ...secH, minWidth: 170, textAlign: 'center', color: 'var(--text)' }}>{label}</h2>
              <button onClick={() => shift(1)} disabled={to >= today} style={{ ...miniBtn, opacity: to >= today ? 0.4 : 1 }}>›</button>
            </>
          ) : (
            <>
              <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} style={{ ...inp, width: 150 }} />
              <span style={{ color: 'var(--dim)' }}>→</span>
              <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} style={{ ...inp, width: 150 }} />
            </>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={exportCsv} style={{ ...okBtn }}>⬇ EXPORT CSV</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Kpi label="EARNED" value={usd(cur.earned)} accent="var(--up)" hot sub={`prev ${usd(before.earned)}`} />
          <Kpi label="CASHED" value={usd(cur.cash)} accent="var(--up)" sub="com received + direct" />
          <Kpi label="COM PENDING" value={usd(cur.pending)} accent="var(--gold)" hot={cur.pending > 0} />
          <Kpi label="COM LOST" value={usd(cur.lost)} accent="#ff6b8a" />
          <Kpi label="NEW ACCOUNTS" value={String(cur.accounts)} accent="var(--cyan)" sub={`prev ${before.accounts}`} />
          <Kpi label="DEPOSITED" value={usd(cur.deposited)} accent="var(--cyan)" sub={cur.accounts ? `avg ${usd(cur.deposited / Math.max(1, cur.accounts))}` : undefined} />
          <Kpi label="DIRECT ACCESS" value={usd(cur.direct)} accent="var(--cyan)" sub={cur.directCount ? `${cur.directCount} sold` : undefined} />
          <Kpi label="REFERRAL PAID" value={usd(cur.referral)} accent="#ff6b8a" />
          <Kpi label="EXPENSES" value={usd(cur.expenses)} accent="#ff6b8a" />
          <Kpi label="NET" value={usd(cur.net)} accent={cur.net >= 0 ? 'var(--up)' : '#ff6b8a'} hot sub={`prev ${usd(before.net)}`} />
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={dimP}>vs previous period:</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>earned <Delta cur={cur.earned} prev={before.earned} /></span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>accounts <Delta cur={cur.accounts} prev={before.accounts} /></span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>deposited <Delta cur={cur.deposited} prev={before.deposited} /></span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>net <Delta cur={cur.net} prev={before.net} /></span>
        </div>

        {/* graphique : barres vertes = gagné, rouges = coûts */}
        {chart.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: chart.length > 40 ? 1 : 3, height: 150, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              {chart.map((c) => (
                <div key={c.key} title={`${c.key} · earned ${usd(c.earned)} · ${c.accounts} account(s)${c.costs ? ` · costs ${usd(c.costs)}` : ''}`}
                  style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 1, height: '100%' }}>
                  <div style={{ flex: 1, height: `${(c.earned / maxBar) * 100}%`, minHeight: c.earned ? 2 : 0, background: 'linear-gradient(180deg,#1fd8b0,#0f8f74)', borderRadius: '3px 3px 0 0' }} />
                  {c.costs > 0 && <div style={{ width: '35%', height: `${(c.costs / maxBar) * 100}%`, background: 'rgba(255,107,138,.7)', borderRadius: '3px 3px 0 0' }} />}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: chart.length > 40 ? 1 : 3 }}>
              {chart.map((c, i) => (
                <span key={c.key} className="mono" style={{ flex: 1, fontSize: 8.5, color: 'var(--dim)', textAlign: 'center', visibility: chart.length <= 16 || i % Math.ceil(chart.length / 16) === 0 ? 'visible' : 'hidden' }}>{c.label}</span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ===== RÉPARTITION ===== */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={secH}>BREAKDOWN · {label.toUpperCase()}</h2>
          <span style={{ flex: 1 }} />
          <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.6)' }}>
            {(['country', 'broker', 'source'] as const).map((k) => (
              <button key={k} onClick={() => setBy(k)} className="mono"
                style={{ padding: '6px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
                  background: by === k ? 'rgba(43,227,245,.14)' : 'transparent', color: by === k ? 'var(--cyan)' : 'var(--dim)' }}>{k.toUpperCase()}</button>
            ))}
          </div>
        </div>
        {groups.length === 0 ? <p style={dimP}>No deposits in this period.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--dim)', fontSize: 9.5, letterSpacing: 1, textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>{by.toUpperCase()}</th>
                  <th style={{ padding: '6px 8px' }}>ACCOUNTS</th><th style={{ padding: '6px 8px' }}>DEPOSITED</th>
                  <th style={{ padding: '6px 8px' }}>AVG DEPOSIT</th><th style={{ padding: '6px 8px' }}>EARNED</th><th style={{ padding: '6px 8px' }}>SHARE</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key} style={{ borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                    <td style={{ textAlign: 'left', padding: '7px 8px', color: 'var(--text)', fontFamily: 'inherit' }}>{g.key}</td>
                    <td style={{ padding: '7px 8px' }}>{g.accounts}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--cyan)' }}>{usd(g.deposited)}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--muted)' }}>{g.avgDeposit ? usd(g.avgDeposit) : '—'}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--up)', fontWeight: 800 }}>{usd(g.earned)}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--muted)', minWidth: 90 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                        <div style={{ width: 50, height: 5, borderRadius: 3, background: 'rgba(130,152,190,.2)' }}>
                          <div style={{ width: `${cur.earned ? (g.earned / cur.earned) * 100 : 0}%`, height: '100%', borderRadius: 3, background: 'var(--up)' }} />
                        </div>
                        {cur.earned ? `${Math.round((g.earned / cur.earned) * 100)}%` : '—'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {by === 'source' && <p style={dimP}>Source = the ad link or page the member came from. &ldquo;Unknown&rdquo; = joined before tracking existed, or came directly.</p>}
      </section>

      {/* ===== COÛTS : dépenses saisies + parrainage payé ===== */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={secH}>COSTS · {label.toUpperCase()} · {usd(cur.referral + cur.expenses)}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="date" value={exp.spent_on} onChange={(e) => setExp({ ...exp, spent_on: e.target.value })} style={{ ...inp, width: 150 }} />
          <input value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} placeholder="amount $" inputMode="decimal" style={{ ...inp, width: 110 }} />
          <select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })} style={{ ...inp, width: 190 }}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={exp.note} onChange={(e) => setExp({ ...exp, note: e.target.value })} placeholder="note (e.g. TikTok ads UK)" style={{ ...inp, flex: 1, minWidth: 160 }} />
          <button disabled={busy || !Number(exp.amount)} onClick={() => void addExpense()} style={{ ...okBtn, opacity: busy || !Number(exp.amount) ? 0.5 : 1 }}>+ ADD EXPENSE</button>
        </div>
        {err && <p style={{ ...dimP, color: '#ff8a5c' }}>{err}</p>}
        {periodCosts.length === 0 ? <p style={dimP}>No costs in this period. Log your ad spend and tools here to see your real net.</p> : periodCosts.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', minWidth: 80 }}>{c.day}</span>
            <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{c.kind === 'referral' ? '🤝 ' : '🧾 '}{c.label}</span>
            <span className="mono" style={{ fontSize: 12.5, fontWeight: 800, color: '#ff8aa2' }}>−{usd(c.amount)}</span>
            {c.kind === 'expense' ? <button disabled={busy} onClick={() => void delExpense(c.id)} style={dangerBtn}>🗑</button> : <span style={{ width: 34 }} />}
          </div>
        ))}
      </section>

      {/* ===== LE DÉTAIL : toutes les lignes de la période ===== */}
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={secH}>DEPOSITS · {label.toUpperCase()} · {periodDeps.length}</h2>
          <span style={{ flex: 1 }} />
          <button onClick={() => setShowList((v) => !v)} style={miniBtn}>{showList ? 'hide' : 'show'}</button>
        </div>
        {showList && periodDeps.map((d) => (
          <div key={d.id} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11.5, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--dim)', minWidth: 80 }}>{d.day}</span>
            <span style={{ color: 'var(--text)', minWidth: 120 }}>{d.who}</span>
            <span style={{ color: 'var(--muted)', minWidth: 90 }}>{d.country}</span>
            <span style={{ color: 'var(--muted)', minWidth: 90 }}>{d.nature === 'direct' ? 'DIRECT' : d.broker.toUpperCase()}</span>
            {d.nature === 'broker' && <span style={{ color: 'var(--cyan)' }}>{usd(d.amount)}</span>}
            <span style={{ color: d.status === 'canceled' ? '#ff8aa2' : 'var(--up)', fontWeight: 800 }}>→ {usd(d.com)}</span>
            <span style={{ fontSize: 9.5, color: d.status === 'received' || d.nature === 'direct' ? 'var(--up)' : d.status === 'canceled' ? '#ff8aa2' : 'var(--gold)' }}>
              {d.nature === 'direct' ? 'PAID' : d.status === 'canceled' ? 'LOST' : d.status.toUpperCase()}{d.redeposit ? ' · RE-DEPOSIT' : ''}
            </span>
          </div>
        ))}
        <p style={dimP}>Dates are the real deposit dates. The DEPOSITS tab books late commissions into the next month; this view never moves them.</p>
      </section>
    </>
  );
}
