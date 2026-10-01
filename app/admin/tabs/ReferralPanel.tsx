'use client';
// 🤝 REFERRALS (02/10/2026) — le parrainage vu d'en haut, en tête de l'onglet Affiliate. Jusqu'ici l'onglet ne
// montrait que l'argent (commissions à confirmer, retraits) : impossible de voir QUI parraine, si les liens
// sont cliqués, ni quels filleuls sont bloqués en route. Clics + argent : /api/member/admin/referrals ;
// inscrits, activés, bloqués : la liste des membres déjà chargée (referred_by). Lecture seule, rien n'est envoyé.
import { useEffect, useState } from 'react';
import { useAdmin } from '../_state';
import type { Row } from '../_shared';
import { dimP, miniBtn, secH } from '../_shared';

type ByRef = { tg_id: number; clicks: number; clicks30: number; earnedUsd: number; pendingUsd: number };
type Data = { since: string | null; totalClicks: number; clicks30: number; byReferrer: ByRef[] };

const ACTIVATED = new Set(['live', 'paused', 'offboarded']); // offboardé = a été activé un jour
const IN_PROGRESS = new Set(['onboarding', 'pending_copier']);

export function ReferralPanel() {
  const { rows, nameOf, openMember, setTab, STEP_LABEL, daysStuck } = useAdmin();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    void fetch('/api/member/admin/referrals').then(async (r) => {
      const j = (await r.json()) as Data & { error?: string };
      if (!r.ok) setErr(j.error ?? `HTTP ${r.status}`); else setD(j);
    }).catch((e: Error) => setErr(e.message));
  }, []);

  const referred = rows.filter((r) => r.referred_by != null);
  const byTg = new Map(rows.map((r) => [Number(r.tg_id), r]));
  const money = new Map((d?.byReferrer ?? []).map((b) => [b.tg_id, b]));
  const refTgs = new Set<number>([...referred.map((r) => Number(r.referred_by)), ...(d?.byReferrer ?? []).map((b) => b.tg_id)]);
  const table = [...refTgs].map((tg) => {
    const mine = referred.filter((r) => Number(r.referred_by) === tg);
    const m = money.get(tg);
    return {
      tg, clicks: m?.clicks ?? 0, clicks30: m?.clicks30 ?? 0, earned: m?.earnedUsd ?? 0, pending: m?.pendingUsd ?? 0,
      signups: mine.length, inProgress: mine.filter((r) => r.status === 'pending_copier' || (r.status === 'onboarding' && (r.onboarding_step ?? 0) > 0)).length,
      activated: mine.filter((r) => ACTIVATED.has(r.status)).length,
    };
  }).sort((a, b) => b.activated - a.activated || b.signups - a.signups || b.clicks - a.clicks);
  const stuck = referred.filter((r) => IN_PROGRESS.has(r.status)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const activated = referred.filter((r) => ACTIVATED.has(r.status)).length;
  const earned = (d?.byReferrer ?? []).reduce((s, b) => s + b.earnedUsd, 0);
  const pending = (d?.byReferrer ?? []).reduce((s, b) => s + b.pendingUsd, 0);
  const open = (tg: number) => { const m = byTg.get(tg); if (m) { openMember(m); setTab('members'); } };
  const who = (tg: number) => <button onClick={() => open(tg)} style={{ ...linkBtn, color: 'var(--text)' }}>{nameOf(tg)}</button>;
  const th = { textAlign: 'right' as const, fontWeight: 600, padding: '4px 6px', color: 'var(--dim)', fontSize: 10, letterSpacing: 0.8 };
  const td = { textAlign: 'right' as const, padding: '5px 6px', fontSize: 12 };

  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderColor: 'rgba(245,194,74,.35)' }}>
      <h2 style={{ ...secH, color: 'var(--gold)' }}>🤝 REFERRALS</h2>
      {err && <p style={{ ...dimP, color: 'var(--down)' }}>clicks & earnings unavailable: {err}</p>}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Stat label="LINK CLICKS · 30 D" value={d ? String(d.clicks30) : '…'} />
        <Stat label="SIGNED UP VIA A FRIEND" value={String(referred.length)} />
        <Stat label="ACTIVATED" value={String(activated)} color="var(--up)" />
        <Stat label="EARNED BY REFERRERS" value={d ? `$${Math.round(earned)}` : '…'} color="var(--gold)" sub={pending > 0 ? `+$${Math.round(pending)} on the way` : undefined} />
      </div>
      <p style={{ ...dimP, fontSize: 10.5 }}>
        Clicks counted {d?.since ? `since ${new Date(d.since).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : 'from 02 Oct'}, once per browser. Signups before 02 Oct could lose their referrer when the sign-in finished inside Telegram.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--dim)' }}>REFERRERS</span>
        {table.length === 0 ? <p style={dimP}>Nobody has referred anyone yet.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...th, textAlign: 'left' }}>WHO</th><th style={th}>CLICKS</th><th style={th}>SIGNED UP</th><th style={th}>IN PROGRESS</th><th style={th}>ACTIVATED</th><th style={th}>EARNED</th>
              </tr></thead>
              <tbody>
                {(all ? table : table.slice(0, 12)).map((t) => (
                  <tr key={t.tg} style={{ borderTop: '1px solid rgba(130,152,190,.1)' }}>
                    <td style={{ ...td, textAlign: 'left' }}>{who(t.tg)}</td>
                    <td className="mono" style={td} title={`${t.clicks} in total`}>{t.clicks30}{t.clicks !== t.clicks30 ? <span style={{ color: 'var(--dim)' }}> / {t.clicks}</span> : null}</td>
                    <td className="mono" style={td}>{t.signups}</td>
                    <td className="mono" style={{ ...td, color: t.inProgress ? 'var(--cyan)' : 'var(--dim)' }}>{t.inProgress}</td>
                    <td className="mono" style={{ ...td, color: t.activated ? 'var(--up)' : 'var(--dim)', fontWeight: t.activated ? 800 : 400 }}>{t.activated}</td>
                    <td className="mono" style={{ ...td, color: t.earned ? 'var(--gold)' : 'var(--dim)' }}>${Math.round(t.earned)}{t.pending ? <span style={{ color: 'var(--cyan)' }}> +{Math.round(t.pending)}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {table.length > 12 && <button onClick={() => setAll((v) => !v)} style={{ ...miniBtn, alignSelf: 'flex-start' }}>{all ? 'show less' : `show all ${table.length}`}</button>}
        <p style={{ ...dimP, fontSize: 10.5 }}>Clicks: last 30 days / all time. In progress = picked a broker or waiting for review.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--dim)' }}>REFERRED, NOT ACTIVATED YET {stuck.length > 0 && `· ${stuck.length}`}</span>
        {stuck.length === 0 && <p style={dimP}>Nobody stuck on the way.</p>}
        {stuck.slice(0, 20).map((r: Row) => (
          <div key={r.tg_id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
            {who(Number(r.tg_id))}
            <span style={{ color: 'var(--dim)', fontSize: 11 }}>by</span>
            {who(Number(r.referred_by))}
            <span style={{ color: r.status === 'pending_copier' ? 'var(--cyan)' : 'var(--muted)', fontSize: 11 }}>
              · {r.status === 'pending_copier' ? 'waiting for review' : STEP_LABEL[r.onboarding_step ?? 0] ?? `step ${r.onboarding_step}`}
            </span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{daysStuck(r)} d idle</span>
          </div>
        ))}
        {stuck.length > 0 && <p style={{ ...dimP, fontSize: 10.5 }}>The referrer knows them: a word from their friend often unblocks faster than a message from us.</p>}
      </div>
    </section>
  );
}

const linkBtn = { border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 700, textDecoration: 'underline dotted', textUnderlineOffset: 3 } as const;

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9.5, letterSpacing: 1.2, color: 'var(--dim)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 20, fontWeight: 800, color: color ?? 'var(--text)' }}>{value}</span>
      {sub && <span style={{ fontSize: 10.5, color: 'var(--cyan)' }}>{sub}</span>}
    </div>
  );
}
