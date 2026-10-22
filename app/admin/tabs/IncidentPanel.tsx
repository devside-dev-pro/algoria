'use client';
// 🚨 INCIDENT DU 21-22/10/2026 — la demande de déclaration aux membres touchés (via le bot) et le tableau de ce
// qu'ils déclarent. Voir lib/member/incident.ts et app/api/member/admin/incident/route.ts.
import { useCallback, useEffect, useState } from 'react';
import { dimP, inp, okBtn, secH } from '../_shared';

type Row = {
  tg_id: number; member_no: number | null; name: string | null; username: string | null; lot: number; broker: string | null; status: string;
  sth: 'copying' | 'not-copying' | 'unknown' | null; sth_detail: string | null; excluded: boolean; inAudience: boolean;
  estimated: number; asked: 'ok' | 'failed' | null;
  claim: { before: number; now: number; loss: number; note: string; proof: string | null; at: string } | null;
};
type Report = { affected: number; audience: number; sthChecked: boolean; declared: number; totalDeclared: number; asked: number; rows: Row[] };

const TAG = 'incident-22-10';
// LE RENVOI DU BON LIEN (22/10, soir) : le 1er envoi pointait sur algoria.tech, suspendu par le registre dans l'après-midi.
// Étiquette à part (l'anti-doublon de la 1re l'aurait bloqué) ; le serveur saute ceux qui ont déjà déclaré.
const RELINK_TAG = 'incident-22-10-relink';
const RELINK_TEXT = `Hey{name}, quick one : the link in my last message stopped working, sorry about that 🙏🏼

Here is the right one, it takes 1 minute to tell me your balance before and now. Thank you`;
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

  // « que les gens qui étaient connectés… moins cela fera de bruit, mieux c'est » : STH dit qui copiait vraiment
  const sthCheck = () => {
    setBusy(true); setMsg(null);
    void fetch('/api/member/admin/incident', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sthCheck: true }) })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({ error: `réponse illisible (HTTP ${r.status})` }))) as { error?: string; saved?: number; saveErrors?: string[]; massPause?: boolean; copying?: number; notCopying?: number; unknown?: number; notConnected?: number; noMaster?: number };
        setMsg(d.error ? `⚠ ${d.error}`
          : `${d.saveErrors?.length ? `⚠ enregistrement : ${d.saveErrors.join(' / ')} · ` : '✅ '}STH : ${d.copying} copiaient · ${d.notCopying} ne copiaient pas (retirés : ${d.notConnected} compte MT5 non branché, ${d.noMaster} sans master) · ${d.unknown} sans réponse (gardés)${d.massPause ? ' · la copie semble déjà en pause pour tout le monde : les « sans master » sont gardés' : ''} · ${d.saved} enregistrés`);
        load();
      })
      .finally(() => setBusy(false));
  };
  const toggle = (r: Row) => {
    void fetch('/api/member/admin/incident', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exclude: { tg_id: r.tg_id, excluded: !r.excluded } }) })
      .then(() => load());
  };

  const relink = () => {
    if (!window.confirm(`Renvoyer le bon lien de déclaration aux membres cochés qui n’ont PAS encore déclaré ?\n\n« ${RELINK_TEXT.replace('{name}', '')} »`)) return;
    setBusy(true); setMsg(null);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botBroadcast: { text: RELINK_TEXT, tag: RELINK_TAG, audience: 'incident', cta: true } }) })
      .then(async (r) => {
        const d = (await r.json()) as { error?: string; sent?: number; skipped?: number; failed?: number };
        setMsg(d.error ? `⚠ ${d.error}` : `✅ bon lien renvoyé à ${d.sent} · déjà reçu ${d.skipped} · échecs ${d.failed}`);
        load();
      })
      .finally(() => setBusy(false));
  };

  const send = () => {
    const unchecked = rep && !rep.sthChecked ? '\n\n⚠ STH n’a pas encore été vérifié : ceux qui ne copiaient pas le recevront aussi. Clique d’abord sur « VÉRIFIER SUR STH » si tu veux les retirer.' : '';
    if (!window.confirm(`Envoyer ce message par le bot aux ${rep?.audience ?? '?'} membres cochés ? (ceux qui l’ont déjà reçu sont sautés)${unchecked}`)) return;
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
      <p style={dimP}>Les membres connectés (live) cette nuit-là — ni les membres en pause, ni ceux en attente. « Vérifier sur STH » retire en plus ceux que STH montre abonnés à aucun master : ils ne copiaient pas. Tu peux aussi décocher quelqu’un à la main. Le message ne part qu’aux cochés, par le bot Algoria, avec un bouton vers la page de déclaration. Une déclaration n’est pas une demande de remboursement : la page le dit.</p>
      {rep && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
          <span>👥 connectés cette nuit : <b>{rep.affected}</b></span>
          <span>🎯 recevront le message : <b>{rep.audience}</b>{!rep.sthChecked && <span style={{ color: 'var(--muted)' }}> (STH pas encore vérifié)</span>}</span>
          <span>📨 demande reçue : <b>{rep.asked}</b></span>
          <span>📝 ont déclaré : <b>{rep.declared}</b></span>
          <span>💸 pertes déclarées : <b>{usd(rep.totalDeclared)}</b></span>
        </div>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} style={{ ...inp, fontSize: 12.5, lineHeight: 1.5 }} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={sthCheck} style={{ ...okBtn, padding: '9px 14px', fontSize: 12 }}>🔎 VÉRIFIER SUR STH QUI COPIAIT</button>
        <button disabled={busy || !text.trim()} onClick={send} style={{ ...okBtn, padding: '9px 14px', fontSize: 12 }}>📣 ENVOYER LA DEMANDE AUX MEMBRES TOUCHÉS</button>
        <button disabled={busy} onClick={relink} style={{ ...okBtn, padding: '9px 14px', fontSize: 12 }}>🔗 RENVOYER LE BON LIEN (NON DÉCLARÉS)</button>
        <button onClick={load} style={{ ...okBtn, padding: '9px 14px', fontSize: 12 }}>↻ ACTUALISER</button>
        {msg && <span style={{ fontSize: 12 }}>{msg}</span>}
      </div>
      {rep && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: 6 }}>envoyer</th><th>#</th><th>membre</th><th>STH</th><th>lot</th><th>broker</th><th>estimé*</th><th>avant</th><th>maintenant</th><th>perte déclarée</th><th>capture</th><th>commentaire</th><th>demande</th>
              </tr>
            </thead>
            <tbody>
              {rep.rows.map((r) => (
                <tr key={r.tg_id} style={{ borderTop: '1px solid var(--border)', opacity: r.inAudience ? 1 : 0.45 }}>
                  <td style={{ padding: 6 }}><input type="checkbox" checked={!r.excluded} onChange={() => toggle(r)} title={r.excluded ? 'retiré à la main' : 'décocher pour ne pas lui envoyer'} /></td>
                  <td>{r.member_no}</td>
                  <td>{r.username ? `@${r.username}` : r.name}</td>
                  <td title={r.sth_detail ?? ''} style={{ maxWidth: 170 }}>{r.sth === 'copying' ? '✓ copiait' : r.sth === 'not-copying' ? '✗ ne copiait pas' : r.sth === 'unknown' ? '?' : ''}{r.sth && r.sth !== 'copying' && r.sth_detail ? <div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.sth_detail}</div> : null}</td>
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
          <p style={{ ...dimP, marginTop: 8 }}>* estimé = les trades de la nuit à son lot s’il les avait tous copiés ; sa vraie perte est plafonnée par son solde (le broker clôture avant). ⚠ = le bot n’a pas pu lui écrire (bloqué ou jamais ouvert) : à contacter toi-même. Ligne grisée = ne recevra pas le message (décoché, ou STH montre qu’il ne copiait pas) ; il peut quand même déclarer s’il a le lien.</p>
        </div>
      )}
    </section>
  );
}
