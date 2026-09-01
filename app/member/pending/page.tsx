'use client';
// ACCÈS EN VÉRIFICATION — après le wizard, TOUT est verrouillé tant qu'un admin n'a pas approuvé :
// compte créé via NOTRE lien broker + dépôt ≥ 500$ + branchement au copieur. Anti-passager clandestin
// (quelqu'un qui connecterait un compte existant hors lien). Poll toutes les 20 s → débloque tout seul.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ACTIVATION_LEGS, ACTIVATION_LOTS, ACTIVATION_SYMBOL, WITHDRAW_LOCK_DAYS } from '@/lib/member/activation';

const CHECKS = [
  'Broker account opened through the Algoria link',
  'Minimum deposit confirmed ($200–$1,000 depending on your strategy)',
  `Activation volume traded (${ACTIVATION_LOTS} lot on ${ACTIVATION_SYMBOL})`,
  'Account linked to the Algoria copier',
];

type Activation = { claimed: boolean; claimedAt: string | null; validated: boolean };

export default function Pending() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [act, setAct] = useState<Activation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // DÉCLARER ≠ ÊTRE VALIDÉ. Le bouton bascule en « déclaré » immédiatement (le membre doit voir que son
  // clic a servi), mais le texte ne lui promet JAMAIS que c'est acquis — c'est le support qui pointe le
  // dashboard partenaire. Mentir ici fabriquerait la réclamation de la semaine suivante : « l'app m'a
  // dit que c'était bon ».
  const claim = () => {
    setBusy(true);
    setErr(null);
    void fetch('/api/member/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'activation' }) })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(d.error ?? 'could not save that');
        setAct((a) => ({ claimed: true, claimedAt: new Date().toISOString(), validated: a?.validated ?? false }));
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    let alive = true;
    const check = () =>
      void fetch('/api/member/me').then(async (r) => {
        if (r.status === 401) { router.replace('/member/login'); return; }
        const d = (await r.json()) as { member?: { status: string; tg_name: string | null }; activation?: Activation };
        if (!alive || !d.member) return;
        setName(d.member.tg_name);
        if (d.activation) setAct(d.activation);
        if (d.member.status === 'onboarding') router.replace('/member/onboarding');
        else if (d.member.status !== 'pending_copier') router.replace('/member'); // approuvé → tout s'ouvre
      });
    check();
    const iv = setInterval(check, 20_000);
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <main style={{ minHeight: '92vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, textAlign: 'center', padding: '0 20px' }}>
      <img src="/brand/algoria-mark.png" alt="Algoria" width={64} height={64} className="pulse" style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(43,227,245,.45))' }} />
      <div>
        <h1 style={{ fontSize: 23, margin: 0 }}>Access under review</h1>
        {name && <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--dim)' }}>hang tight, {name}</p>}
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.65, maxWidth: 400, margin: 0 }}>
        Your setup is in — the team is now verifying it before switching the copy on. This page unlocks automatically the moment you&apos;re approved.
      </p>
      {/* ── LOT D'ACTIVATION ────────────────────────────────────────────────────────────────────────
          Placé ICI et pas dans le wizard, volontairement. Une 4e étape dans un tunnel qui en compte 3
          se paie en abandons, et celui-ci est le tunnel PAYANT — le membre a déjà déposé. Sur l'écran
          d'attente, il ne coûte rien : le membre y est déjà, il attend, et cette tâche est justement ce
          qui raccourcit son attente. La demande se formule comme un déblocage, jamais comme une taxe. */}
      <div className="panel" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left', maxWidth: 400, width: '100%', border: act?.validated ? '1px solid rgba(74,220,160,.45)' : '1px solid rgba(245,194,74,.5)', background: act?.validated ? 'rgba(74,220,160,.06)' : 'rgba(245,194,74,.06)' }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: 1.4, color: act?.validated ? 'rgba(74,220,160,.9)' : 'var(--gold)' }}>
          {act?.validated ? '✓ ACTIVATION CONFIRMED' : 'ONE LAST STEP — 30 SECONDS'}
        </span>
        {!act?.validated && (
          <>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--text)' }}>
              Open your MT5 and place these two trades on <b>{ACTIVATION_SYMBOL}</b>, then close them:
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {ACTIVATION_LEGS.map((l) => (
                <div key={l.side} className="mono" style={{ flex: 1, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 6px', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  {l.lots} {l.side}
                </div>
              ))}
            </div>
            {/* L'ARGUMENT QUI FAIT ACCEPTER LA DEMANDE, et il est vrai : 0.5 acheté + 0.5 vendu = exposition
                nette nulle. Le membre ne peut pas perdre sur le marché en le faisant. Sans cette phrase,
                on demande à quelqu'un qui vient de déposer de « risquer » son argent sur commande. */}
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--muted)' }}>
              One buy and one sell of the same size cancel each other out, so you take no market risk —
              it costs you the spread, a few dollars. That&rsquo;s what registers your account with the broker
              and unlocks your copy and the VIP channel.
            </p>
            <button disabled={busy || act?.claimed} onClick={claim} style={{ border: 'none', borderRadius: 10, padding: '11px 14px', fontSize: 13.5, fontWeight: 700, cursor: act?.claimed ? 'default' : 'pointer', color: act?.claimed ? 'var(--muted)' : '#04121e', background: act?.claimed ? 'rgba(130,152,190,.15)' : 'linear-gradient(90deg,#2be3f5,#2e8bf0)' }}>
              {busy ? 'saving…' : act?.claimed ? '✓ marked as done — being checked' : 'I\u2019ve placed both trades'}
            </button>
            {act?.claimed && (
              <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.55, color: 'var(--dim)' }}>
                Thanks — the team confirms the volume with the broker before switching your copy on. Nothing else to do.
              </p>
            )}
            {err && <p style={{ margin: 0, fontSize: 12, color: 'rgba(210,150,165,.9)' }}>⚠ {err}</p>}
          </>
        )}
        {/* LES 30 JOURS SE DISENT ICI, AVANT L'ACCÈS — pas au moment où quelqu'un veut retirer. Un membre
            qui découvre la règle après coup la vit comme un piège, et il a raison de le penser. */}
        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6, color: 'var(--muted)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <b style={{ color: 'var(--text)' }}>Keep your funds in place for {WITHDRAW_LOCK_DAYS} days.</b> Withdrawing before that cancels
          your broker registration — and with it your Algoria access. After {WITHDRAW_LOCK_DAYS} days your access is yours for good.
        </p>
      </div>

      <div className="panel" style={{ padding: '15px 18px', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', maxWidth: 400, width: '100%' }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: 1.4, color: 'var(--dim)' }}>WHAT WE CHECK</span>
        {CHECKS.map((c) => (
          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', boxShadow: '0 0 8px rgba(245,194,74,.5)', flex: 'none' }} />
            <span style={{ fontSize: 13, color: 'var(--text)' }}>{c}</span>
          </div>
        ))}
      </div>
      <p className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', letterSpacing: 1, margin: 0 }}>USUALLY DONE WITHIN A FEW HOURS</p>
      <form action="/api/member/logout" method="post"><button style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', borderRadius: 8, padding: '6px 12px', fontSize: 11.5, cursor: 'pointer' }}>sign out</button></form>
    </main>
  );
}
