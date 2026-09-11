'use client';
// DESK — ce que le desk d'analystes a produit, jour par jour (11/09/2026, phase 6).
//
// Pourquoi cet onglet : pendant trois jours, savoir si le desk avait bien tourné demandait de lire les
// journaux Railway et Vercel à la main, et un brief manquant est resté invisible une journée entière.
// Tout ce qui a servi à ce diagnostic est ici, en une ligne par analyse.
//
// L'onglet se charge tout seul (il ne passe pas par useAdminState) : le desk n'a rien à voir avec le CRM,
// et brancher quatre états de plus dans un fichier de neuf cents lignes pour une lecture seule ne se justifie
// pas. Une seule action : publier / dépublier.
import { useCallback, useEffect, useState } from 'react';
import { ask, toast } from '@/components/admin/Dialog';
import { dimP, miniBtn, secH } from '../_shared';

interface Run {
  id: string; market: string; runDate: string; rating: string;
  price: number | null; price1d: number | null; price3d: number | null; price7d: number | null;
  headline: string | null; call: string | null; storyCount: number; agents: number;
  durationS: number | null; modelDeep: string | null; modelQuick: string | null;
  dryRun: boolean; published: boolean; announced: boolean; createdAt: string; missing: string[];
}

const LABEL: Record<string, string> = { XAUUSD: 'GOLD', BTCUSD: 'BTC' };
const RATING_COLOR: Record<string, string> = {
  Buy: 'var(--up)', Overweight: 'var(--up)', Hold: 'var(--gold)', Underweight: 'var(--down)', Sell: 'var(--down)',
};
const pct = (from: number | null, to: number | null) =>
  from && to ? `${to >= from ? '+' : ''}${(((to - from) / from) * 100).toFixed(2)}%` : '—';
const mins = (s: number | null) => (s == null ? '—' : `${Math.round(s / 60)} min`);
const day = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });

export function DeskTab() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [vipOn, setVipOn] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void fetch('/api/member/admin/desk')
      .then(async (r) => {
        if (!r.ok) { setFailed(true); return; }
        const d = (await r.json()) as { runs: Run[]; vipOn: boolean };
        setRuns(d.runs); setVipOn(d.vipOn); setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const togglePublish = async (r: Run) => {
    if (r.published) {
      const ok = await ask.confirm(
        `Retirer de l'app la lecture ${LABEL[r.market] ?? r.market} du ${day(r.runDate)} ?\n\nElle disparaît de l'écran Desk et de la carte. Rien n'est effacé : la remettre est un clic.`,
        { danger: true, ok: 'DÉPUBLIER' },
      );
      if (!ok) return;
    }
    setBusy(true);
    void fetch('/api/member/admin/desk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish: { id: r.id, value: !r.published } }),
    })
      .then(async (res) => {
        const d = (await res.json()) as { error?: string };
        if (d.error) toast(`⚠ ${d.error}`, 'error');
        else { toast(r.published ? '✓ retirée de l\'app' : '✓ remise en ligne'); load(); }
      })
      .finally(() => setBusy(false));
  };

  const live = (runs ?? []).filter((r) => !r.dryRun);
  const today = live.filter((r) => r.runDate === (runs?.[0]?.runDate ?? ''));
  const broken = live.filter((r) => r.missing.length);

  return (
    <>
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={secH}>🧠 ALGORIA DESK — L&apos;ANALYSE DU JOUR</h2>
        <p style={dimP}>
          Le desk tourne chaque matin à 06:00 UTC et les membres sont prévenus à 06:40. Cet écran dit, pour chaque
          jour, ce qui est sorti et ce qui manque. Le post VIP est {vipOn
            ? <b style={{ color: 'var(--up)' }}>ouvert</b>
            : <b style={{ color: 'var(--gold)' }}>fermé</b>} (variable <code className="mono">DESK_VIP_POST</code> sur Vercel).
        </p>
        {broken.length > 0 && (
          <p style={{ ...dimP, color: 'var(--gold)' }}>
            {broken.length} analyse{broken.length > 1 ? 's' : ''} incomplète{broken.length > 1 ? 's' : ''} :
            {' '}{broken.map((r) => `${LABEL[r.market] ?? r.market} ${day(r.runDate)} (${r.missing.join(', ')})`).join(' · ')}.
            {' '}Un brief manquant est retenté tout seul au passage suivant, pendant trois jours.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {today.map((r) => (
            <a key={r.id} href={`/api/card/desk?market=${r.market}`} target="_blank" rel="noreferrer" style={{ ...miniBtn, padding: '5px 10px', fontSize: 10.5, textDecoration: 'none' }}>
              CARTE {LABEL[r.market] ?? r.market} ↗
            </a>
          ))}
          <button onClick={load} style={{ ...miniBtn, padding: '5px 10px', fontSize: 10.5 }}>RECHARGER</button>
        </div>
      </section>

      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        <h2 style={secH}>LES ANALYSES</h2>
        {failed && <p style={dimP}>Impossible de charger les analyses.</p>}
        {!failed && !runs && <p style={dimP}>chargement…</p>}
        {runs && !live.length && <p style={dimP}>Aucune analyse en base pour l&apos;instant.</p>}
        {!!live.length && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 860 }}>
              <thead>
                <tr className="mono" style={{ fontSize: 9.5, letterSpacing: 1, color: 'var(--dim)', textAlign: 'left' }}>
                  <th style={th}>JOUR</th><th style={th}>MARCHÉ</th><th style={th}>NOTE</th><th style={th}>TITRE</th>
                  <th style={th}>PRIX</th><th style={th}>+1J</th><th style={th}>+3J</th><th style={th}>+7J</th>
                  <th style={th}>VOIX</th><th style={th}>DURÉE</th><th style={th}>ÉTAT</th><th style={th} />
                </tr>
              </thead>
              <tbody>
                {live.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid rgba(130,152,190,.12)', opacity: r.published ? 1 : 0.5 }}>
                    <td style={cell}>{day(r.runDate)}</td>
                    <td style={{ ...cell, fontWeight: 800 }}>{LABEL[r.market] ?? r.market}</td>
                    <td style={{ ...cell, fontWeight: 800, color: RATING_COLOR[r.rating] ?? 'var(--dim)' }}>{r.rating || 'NO CALL'}</td>
                    <td style={{ ...cell, maxWidth: 340, whiteSpace: 'normal', color: r.headline ? 'var(--text)' : 'var(--gold)' }}>
                      {r.headline ?? 'brief manquant'}
                    </td>
                    <td style={cell}>{r.price?.toLocaleString('en-US', { maximumFractionDigits: 0 }) ?? '—'}</td>
                    <td style={cell}>{pct(r.price, r.price1d)}</td>
                    <td style={cell}>{pct(r.price, r.price3d)}</td>
                    <td style={cell}>{pct(r.price, r.price7d)}</td>
                    <td style={cell}>{r.agents || '—'}</td>
                    <td style={cell}>{mins(r.durationS)}</td>
                    <td style={cell}>
                      {!r.published ? <span style={{ color: 'var(--down)' }}>retirée</span>
                        : r.announced ? <span style={{ color: 'var(--up)' }}>annoncée</span>
                          : <span style={{ color: 'var(--dim)' }}>en ligne</span>}
                    </td>
                    <td style={cell}>
                      <button disabled={busy} onClick={() => void togglePublish(r)} style={{ ...miniBtn, color: r.published ? 'rgba(210,150,165,.85)' : 'var(--up)' }}>
                        {r.published ? 'RETIRER' : 'REMETTRE'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ ...dimP, fontSize: 11 }}>
          Les pourcentages comparent le prix de référence de l&apos;appel à celui relevé 1, 3 et 7 jours plus tard,
          sur nos propres bougies. Ils se remplissent au fil des jours et s&apos;affichent tels quels, bons ou mauvais.
          Modèles : {live[0]?.modelDeep ?? '—'} pour le raisonnement, {live[0]?.modelQuick ?? '—'} pour la lecture des données.
        </p>
      </section>
    </>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 800, whiteSpace: 'nowrap' };
const cell: React.CSSProperties = { padding: '8px', fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', verticalAlign: 'top' };
