'use client';
// ÉCRAN DE RÉCUPÉRATION — la porte de retour d'un membre off-boardé.
//
// Il existe parce qu'off-boarder quelqu'un revenait à le perdre en silence : accès mort, aucune
// explication, aucun chemin de retour. Le pari (Mathieu, 25/08) : sur 10 personnes qui retirent, en
// récupérer 2 ou 3 est déjà un gain net — et ça suppose qu'elles sachent pourquoi, et que revenir tienne
// en un clic. Le bouton du message Telegram pointe directement ici.
//
// LE TON NE REPROCHE RIEN. Retirer son argent est un droit, pas une faute. On explique une mécanique
// (l'accès est adossé à un compte financé) et on ouvre la porte. Un écran qui culpabilise ferme la porte
// qu'il prétend ouvrir.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMe, LoadFailed, SUPPORT_TG } from '../ui';
import { OFFBOARDED } from '@/lib/member/winback';
import { WITHDRAW_LOCK_DAYS } from '@/lib/member/activation';
import { tgHref } from '@/lib/telegram';

export default function Recover() {
  const router = useRouter();
  const { member, loading, failed } = useMe();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (loading) return <Center>loading…</Center>;
  if (failed || !member) return <LoadFailed />;
  // un membre qui n'est PAS off-boardé n'a rien à faire ici — il repart chez lui plutôt que de lire un
  // message de perte d'accès qui ne le concerne pas
  if (member.status !== OFFBOARDED) { router.replace('/member'); return <Center>redirecting…</Center>; }

  const start = () => {
    setBusy(true);
    setErr(null);
    void fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recover' }) })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(d.error ?? 'could not start the recovery');
        router.replace('/member/onboarding');
      })
      .catch((e) => { setErr((e as Error).message); setBusy(false); });
  };

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 10 }}>
      <section className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 13, border: '1px solid rgba(245,194,74,.45)' }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: 1.6, color: 'var(--gold)', fontWeight: 800 }}>ACCESS SWITCHED OFF</span>
        <h1 style={{ fontSize: 20, margin: 0 }}>Let&rsquo;s get your access back</h1>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: 'var(--muted)' }}>
          The trading account linked to your access is no longer funded, so the AI has nothing to trade on.
          That&rsquo;s all this is — <b style={{ color: 'var(--text)' }}>nothing is held against you</b>, and nothing on your side is lost.
        </p>

        {/* CE QUI EST CONSERVÉ — l'argument central du retour, et il doit être VRAI : l'action `recover`
            côté serveur ne touche ni au numéro de membre, ni à l'historique, ni aux commissions. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--border)', borderRadius: 11, padding: '13px 15px' }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: 1.4, color: 'var(--dim)' }}>STILL YOURS</span>
          {[`Member #${member.member_no}`, 'Your full trade history', 'Your referrals and referral earnings'].map((x) => (
            <div key={x} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--text)' }}>
              <span style={{ color: 'var(--up)' }}>✓</span>{x}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: 1.4, color: 'var(--dim)' }}>TWO WAYS BACK</span>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--muted)' }}>
            <b style={{ color: 'var(--text)' }}>1 — Fund the same account again.</b> Same broker, same login: put the capital back and reconnect.
          </p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--muted)' }}>
            <b style={{ color: 'var(--text)' }}>2 — Start fresh with another partner broker.</b> If you&rsquo;d rather change, that works too — you pick the broker on the next screen.
          </p>
        </div>

        <button disabled={busy} onClick={start} style={{ border: 'none', borderRadius: 11, padding: '13px 16px', fontSize: 14.5, fontWeight: 800, cursor: 'pointer', color: '#04121e', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)' }}>
          {busy ? 'opening…' : '🔓 RECOVER MY ACCESS'}
        </button>
        {err && <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(210,150,165,.9)' }}>⚠ {err}</p>}

        {/* DIT AVANT, PAS APRÈS. Un membre qui revient doit connaître la règle qui a coûté son accès la
            première fois — la répéter ici est ce qui évite un deuxième off-board. */}
        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6, color: 'var(--muted)', borderTop: '1px solid var(--border)', paddingTop: 11 }}>
          One thing for the way back: leave your capital in place for <b style={{ color: 'var(--text)' }}>{WITHDRAW_LOCK_DAYS} days</b> after funding.
          Withdrawing before that is what switches the access off again.
        </p>

        <a {...tgHref(SUPPORT_TG)} rel="noreferrer" style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--gold)', textDecoration: 'none', fontWeight: 700 }}>
          💬 Something else going on? Message @mathieu_algoria
        </a>
      </section>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>{children}</main>;
}
