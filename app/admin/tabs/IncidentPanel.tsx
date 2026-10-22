'use client';
// 🚨 INCIDENT DU 21-22/10/2026 — la demande de déclaration aux membres touchés (via le bot) et le tableau de ce
// qu'ils déclarent. Voir lib/member/incident.ts et app/api/member/admin/incident/route.ts.
import { useCallback, useEffect, useState } from 'react';
import { dimP, inp, okBtn, secH } from '../_shared';

type Row = {
  member_no: number | null; name: string | null; username: string | null; lot: number; broker: string | null; status: string;
  estimated: number; asked: 'ok' | 'failed' | null;
  claim: { before: number; now: number; loss: number; note: string; proof: string | null; at: string } | null;
};
type Report = { affected: number; declared: number; totalDeclared: number; asked: number; rows: Row[] };

const TAG = 'incident-22-10';
const DEFAULT_TEXT = `Hey{name}, it's Mathieu.

After what happened on the night of 21 to 22 October, I want to know exactly where each of you stands, so I can look for the best possible solution for everyone.

Can you take 1 minute to tell me your balance before the incident and your balance now, with a screenshot of your account if you can ? Just tap the button below.

To be fully honest with you : I can't promise a full refund. But I'm doing everything I can to find the best solution, and knowing exactly what each of you lost is the first step. I'll come back to you personally.

Thank you for your trust, it means a lot 🙏🏼`;

const usd = (n: number) => `${Math.round(n).toLocaleString('en-US')} $`;

export function IncidentPanel() {
  const [rep, setRep] = useState<Report | null>(null);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    void fetch('/api/member/admin/incident').then(async (r) => { if (r.ok) setRep((await r.json()) as Report); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = () => {
    if (!window.confirm(`Envoyer ce message par le bot aux ${rep?.affected ?? '?'} membres touchés ? (ceux qui l’ont déjà reçu sont sautés)`)) return;
    setBusy(true); setMsg(null);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botBroadcast: { text, tag: TAG, audience: 'incident', cta: true } }) })
      .then(async (r) => {
        const d = (await r.json()) as { error?: string; sent?: number; skipped?: number; failed?: number };
        setMsg(d.error ? `⚠ ${d.error}` : `✅ envoyé à ${d.sent} · déjà reçu ${d.skipped} · échecs ${d.failed} (bot bloqué ou jamais ouvert)`);
        load();
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 980, border: '1px solid rgba(255,107,138,.45)' }}>
      <h2 style={{ ...secH, color: 'var(--down)' }}>🚨 INCIDENT 21-22/10 — DÉCLARATIONS DE PERTE</h2>
      <p style={dimP}>Les membres qui copiaient cette nuit-là. Le message leur part par le bot Algoria, avec un bouton vers la page de déclaration (solde avant, solde actuel, capture). Une déclaration n’est pas une demande de remboursement : la page le dit.</p>
      {rep && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
          <span>👥 touchés : <b>{rep.affected}</b></span>
          <span>📨 demande reçue : <b>{rep.asked}</b></span>
          <span>📝 ont déclaré : <b>{rep.declared}</b></span>
          <span>💸 pertes déclarées : <b>{usd(rep.totalDeclared)}</b></span>
        </div>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} style={{ ...inp, fontSize: 12.5, lineHeight: 1.5 }} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button disabled={busy || !text.trim()} onClick={send} style={{ ...okBtn, padding: '9px 14px', fontSize: 12 }}>📣 ENVOYER LA DEMANDE AUX MEMBRES TOUCHÉS</button>
        <button onClick={load} style={{ ...okBtn, padding: '9px 14px', fontSize: 12 }}>↻ ACTUALISER</button>
        {msg && <span style={{ fontSize: 12 }}>{msg}</span>}
      </div>
      {rep && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: 6 }}>#</th><th>membre</th><th>lot</th><th>broker</th><th>estimé*</th><th>avant</th><th>maintenant</th><th>perte déclarée</th><th>capture</th><th>commentaire</th><th>demande</th>
              </tr>
            </thead>
            <tbody>
              {rep.rows.map((r) => (
                <tr key={`${r.member_no}-${r.username}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: 6 }}>{r.member_no}</td>
                  <td>{r.username ? `@${r.username}` : r.name}</td>
                  <td className="mono">{r.lot}</td>
                  <td>{r.broker}</td>
                  <td className="mono" style={{ color: 'var(--muted)' }}>{usd(r.estimated)}</td>
                  <td className="mono">{r.claim ? usd(r.claim.before) : '—'}</td>
                  <td className="mono">{r.claim ? usd(r.claim.now) : '—'}</td>
                  <td className="mono" style={{ fontWeight: 800 }}>{r.claim ? usd(r.claim.loss) : '—'}</td>
                  <td>{r.claim?.proof ? <a href={r.claim.proof} target="_blank" rel="noreferrer">voir</a> : '—'}</td>
                  <td style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{r.claim?.note || ''}</td>
                  <td>{r.asked === 'ok' ? '✓' : r.asked === 'failed' ? '⚠' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ ...dimP, marginTop: 8 }}>* estimé = les trades de la nuit à son lot s’il les avait tous copiés ; sa vraie perte est plafonnée par son solde (le broker clôture avant). ⚠ = le bot n’a pas pu lui écrire (bloqué ou jamais ouvert) : à contacter toi-même.</p>
        </div>
      )}
    </section>
  );
}
