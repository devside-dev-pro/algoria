'use client';
// ACCÈS EN VÉRIFICATION — après le wizard, TOUT est verrouillé tant qu'un admin n'a pas approuvé :
// compte créé via NOTRE lien broker + dépôt ≥ 500$ + branchement au copieur. Anti-passager clandestin
// (quelqu'un qui connecterait un compte existant hors lien). Poll toutes les 20 s → débloque tout seul.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const CHECKS = [
  'Broker account opened through the Algoria link',
  'Minimum deposit confirmed ($200–$1,000 depending on your strategy)',
  'Account linked to the Algoria copier',
];

export default function Pending() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () =>
      void fetch('/api/member/me').then(async (r) => {
        if (r.status === 401) { router.replace('/member/login'); return; }
        const d = (await r.json()) as { member?: { status: string; tg_name: string | null } };
        if (!alive || !d.member) return;
        setName(d.member.tg_name);
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
