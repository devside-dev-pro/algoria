'use client';
// Connexion Telegram NATIVE : un clic → Telegram s'ouvre (app mobile/desktop) → START → connecté.
// Sous le capot : code à usage unique + deep-link t.me, confirmé par le webhook du bot, pollé ici (2 s).
// Zéro numéro de téléphone, zéro widget, zéro mot de passe. (Le /setdomain BotFather n'est plus nécessaire.)
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { openTelegram } from '@/lib/telegram';
import { useUILocale } from '../ui';

type Phase = 'idle' | 'waiting' | 'expired' | 'error';

export default function MemberLogin() {
  const [phase, setPhase] = useState<Phase>('idle');
  const { t } = useUILocale();
  // LIEN DE SECOURS (31/07 — un membre sur ORDINATEUR : « ça ne fait rien quand je clique »). Sur desktop
  // sans Telegram installé, tg:// n'ouvre rien et le repli window.open part 1,6 s plus tard, DANS un
  // setTimeout : Chrome le bloque (le geste utilisateur est perdu après l'await du fetch). D'où un bouton
  // qui semble mort. On affiche donc TOUJOURS le lien t.me en clair : un vrai clic n'est jamais bloqué.
  const [link, setLink] = useState<string | null>(null);
  const router = useRouter();
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  // UN SEUL CODE PAR TENTATIVE (02/08) — le défaut le plus coûteux du login, trouvé dans les données :
  // trois connexions bloquées le même jour, dont une où deux codes sont partis à 187 ms d'intervalle.
  // Telegram ouvre le PREMIER lien, la personne tape START, la connexion RÉUSSIT — mais la page
  // interroge le SECOND code, que personne ne confirmera jamais. Écran d'attente infini sur un login
  // qui a fonctionné, et la personne écrit « ça ne marche pas ».
  //  · inFlight : un tap qui déclenche deux événements (fréquent sur mobile) ne crée plus deux codes.
  //  · le bouton « recommencer » ROUVRE le lien existant au lieu d'en forger un nouveau — c'était le
  //    pire des deux : le secours abandonnait le code que Telegram allait confirmer, donc plus la
  //    personne insistait, moins elle avait de chances d'entrer.
  const inFlight = useRef(false);
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);
  // RETOUR DU BOUTON TELEGRAM (/member/login/confirm) quand le code n'était plus utilisable : on affiche le
  // motif au lieu de reposer un écran neutre où la personne ne comprend pas pourquoi elle n'est pas entrée.
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('e');
    if (e === 'expired' || e === 'retry') setPhase('expired');
  }, []);

  const start = async () => {
    if (inFlight.current) return;
    if (link) { openTelegram(link, { fallbackNewTab: true }); return; } // secours : on rouvre, on ne recrée pas
    inFlight.current = true;
    try {
      const r = await fetch('/api/member/tglogin', { method: 'POST' });
      const d = (await r.json()) as { code?: string; link?: string };
      if (!d.code || !d.link) { setPhase('error'); return; }
      setLink(d.link);
      setPhase('waiting');
      openTelegram(d.link, { fallbackNewTab: true }); // tg:// direct sur le bot ; repli t.me en NOUVEL onglet (le polling continue ici)
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const p = (await fetch(`/api/member/tglogin?code=${d.code}`).then((x) => x.json()).catch(() => null)) as { ok?: boolean; denied?: boolean; expired?: boolean } | null;
        // sur le sous-domaine ADMIN, on atterrit directement sur le back-office CRM (pas sur le Home membre)
        const dest = typeof window !== 'undefined' && window.location.hostname.startsWith('admin.') ? '/admin' : '/member';
        if (p?.ok) { if (poll.current) clearInterval(poll.current); router.replace(dest); }
        else if (p?.denied) { if (poll.current) clearInterval(poll.current); router.replace('/member/denied'); }
        else if (p?.expired) { if (poll.current) clearInterval(poll.current); setLink(null); setPhase('expired'); }
      }, 2000);
    } catch {
      setPhase('error');
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <main style={{ minHeight: '92vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, textAlign: 'center', padding: '0 18px' }}>
      <img src="/brand/algoria-mark.png" alt="Algoria" width={72} height={72} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(43,227,245,.45))' }} />
      <div>
        <h1 style={{ fontSize: 30, margin: 0, letterSpacing: 0.5 }}>
          ALGORIA <span className="goldText">MEMBERS</span>
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.6, maxWidth: 380, margin: '10px auto 0' }}>
          {t('login.sub')}
        </p>
      </div>

      {phase !== 'waiting' ? (
        <button
          onClick={() => void start()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '14px 28px', borderRadius: 13, border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: 0.5, fontSize: 15, color: '#fff', background: 'linear-gradient(90deg,#2AABEE,#229ED9)', boxShadow: '0 0 24px rgba(42,171,238,.35)' }}
        >
          {t('login.cta')}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <span className="pulse" style={{ fontSize: 13.5, color: 'var(--cyan)', fontWeight: 700 }}>{t('login.waiting')}</span>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', maxWidth: 320, lineHeight: 1.55 }}>
            {t('login.tapStart')}
          </p>
          {/* SECOURS TOUJOURS VISIBLE : sur ordinateur, l'ouverture automatique est souvent bloquée par le
              navigateur. Ce lien est un vrai <a> — un clic dessus n'est jamais bloqué. Il marche aussi
              depuis le téléphone si Telegram n'est installé que là. */}
          {link && (
            <a href={link} target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', borderRadius: 12, textDecoration: 'none', fontWeight: 800, fontSize: 13.5, color: '#fff', background: 'linear-gradient(90deg,#2AABEE,#229ED9)', boxShadow: '0 0 18px rgba(42,171,238,.3)' }}>
              {t('login.fallback')}
            </a>
          )}
          <button onClick={() => void start()} style={{ border: 'none', background: 'transparent', color: 'var(--dim)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
            {t('login.restart')}
          </button>
        </div>
      )}

      {phase === 'expired' && <Err>{t('login.expired')}</Err>}
      {phase === 'error' && <Err>{t('login.error')}</Err>}
      <p className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', letterSpacing: 1 }}>{t('login.footer')}</p>
    </main>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 12.5, color: 'rgba(210,150,165,.9)', border: '1px solid rgba(255,107,138,.3)', borderRadius: 9, padding: '9px 14px', background: 'rgba(255,107,138,.07)', margin: 0 }}>
      {children}
    </p>
  );
}
