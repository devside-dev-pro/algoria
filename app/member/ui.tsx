'use client';
// Coque CLIENT de l'espace membre : enregistrement du service worker, nav basse (onglets), hook useMe.
// Réutilise le langage visuel du cockpit (globals.css : .panel, .goldText, .mono) — même ADN, mobile-first.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { tgHref } from '@/lib/telegram';

export interface Member {
  member_no: number;
  tg_username: string | null;
  tg_name: string | null;
  photo_url: string | null;
  status: 'onboarding' | 'pending_copier' | 'live' | 'paused';
  broker: string | null;
  risk_tier: 'low' | 'balanced' | 'high';
  onboarding_step: number;
  created_at: string;
  mt5_login: string | null;
  mt5_server: string | null;
  referral_code: string | null;
  usdt_trc20: string | null;
}

export interface RefCommission { id: string; kind: string; amount: number; status: string; reason: string | null; detail: Record<string, unknown> | null; created_at: string }
export interface RefPayout { id: string; amount: number; address: string; status: string; tx_hash: string | null; reason: string | null; created_at: string }
export interface Referral {
  code: string | null;
  invited: number;
  activated: number;
  availableUsd: number;
  pendingUsd: number;
  paidUsd: number;
  totalEarnedUsd: number;
  rewardUsd: number;
  minPayoutUsd: number;
  nextMilestone: { at: number; bonus: number; label: string; remaining: number } | null;
  address: string | null;
  commissions: RefCommission[];
  payouts: RefPayout[];
}

/** Charge le membre connecté ; redirige vers /member/login si pas de session.
 *  PLUS AUCUNE redirection bloquante pour les prospects : un compte non activé (onboarding/pending_copier)
 *  voit TOUTE l'app en mode TEASER — contenu exclusif grisé, historique des gains en clair, paywall
 *  « unlock » = wizard broker. Un mur donne envie de partir ; un aperçu grisé donne envie d'entrer.
 *  `unlocked` = admin OU copie activée (live/paused) — c'est LE drapeau que les pages consultent. */
export function useMe() {
  const [member, setMember] = useState<Member | null>(null);
  const [referral, setReferral] = useState<Referral | null>(null);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    void fetch('/api/member/me')
      .then(async (r) => {
        if (r.status === 401) { router.replace('/member/login'); return null; }
        return (await r.json()) as { member: Member; admin: boolean; referral?: Referral };
      })
      .then((d) => {
        if (!alive || !d?.member) return;
        setMember(d.member);
        setReferral(d.referral ?? null);
        setAdmin(!!d.admin);
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const unlocked = admin || member?.status === 'live' || member?.status === 'paused';
  return { member, setMember, referral, admin, unlocked, loading };
}

// ===== MODE TEASER (prospects) — le paywall qui donne envie =====
export const SUPPORT_TG = 'https://t.me/mathieu_algoria';
// RÉSERVER UN APPEL — l'arme de closing : un prospect au téléphone 10 min = un client. Par défaut,
// chat Telegram avec message pré-rempli (zéro infra) ; brancher NEXT_PUBLIC_BOOKING_URL (Calendly…) plus tard.
export const BOOK_CALL_URL =
  process.env.NEXT_PUBLIC_BOOKING_URL ??
  `https://t.me/mathieu_algoria?text=${encodeURIComponent("Hey Mathieu! I'd like to book a quick call to activate my Algoria access 📞")}`;

/** Contenu réservé : flouté + cadenas cliquable → ouvre le paywall. Le VRAI contenu reste dessous
 *  (déjà rédigé côté serveur pour le flux IA) — on voit qu'il se passe des choses, pas ce qui se passe. */
export function Locked({ unlocked, onUnlock, children, label = 'MEMBERS ONLY' }: {
  unlocked: boolean;
  onUnlock: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  if (unlocked) return <>{children}</>;
  return (
    <div style={{ position: 'relative', minHeight: 130, display: 'flex', flexDirection: 'column' }}>
      <div aria-hidden style={{ filter: 'blur(7px) saturate(.7)', pointerEvents: 'none', userSelect: 'none', opacity: 0.75, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      <button
        onClick={onUnlock}
        style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
          border: 'none', cursor: 'pointer', background: 'linear-gradient(180deg, rgba(8,16,31,.12) 0%, rgba(8,16,31,.5) 100%)', borderRadius: 14,
        }}
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 999,
          fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'var(--gold)',
          background: 'rgba(7,12,24,.92)', border: '1px solid rgba(245,194,74,.5)', boxShadow: '0 6px 24px rgba(2,6,16,.6), 0 0 18px rgba(245,194,74,.15)',
        }}>
          🔒 {label}
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--text)', letterSpacing: 0.4, textShadow: '0 1px 6px rgba(2,6,16,.9)' }}>tap to unlock</span>
      </button>
    </div>
  );
}

/** Le PAYWALL — bottom sheet : pas d'abonnement, l'accès se débloque en ouvrant le compte broker
 *  partenaire (le wizard existant EST le paywall). Variante « en vérification » pour pending_copier.
 *  PORTAL vers <body> obligatoire : rendue dans les pages, la sheet vivait DANS .appScroll — sur iOS,
 *  un conteneur -webkit-overflow-scrolling piège les position:fixed → sheet clippée/coupée par la nav.
 *  maxHeight + scroll interne : le CTA reste atteignable même sur un petit écran avec les barres navigateur. */
export function UnlockSheet({ open, onClose, status }: { open: boolean; onClose: () => void; status: Member['status'] }) {
  const router = useRouter();
  if (!open || typeof document === 'undefined') return null;
  const pending = status === 'pending_copier';
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(3,7,15,.74)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div
        className="cardIn"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, borderRadius: '22px 22px 0 0', borderBottom: 'none',
          border: '1px solid rgba(245,194,74,.42)', background: 'linear-gradient(180deg, #132342 0%, #0a1425 100%)',
          boxShadow: '0 -18px 60px rgba(2,6,16,.8), 0 0 34px rgba(245,194,74,.1)',
          padding: '20px 20px max(24px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 13,
          maxHeight: '86dvh', overflowY: 'auto',
        }}
      >
        <span style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(130,152,190,.35)', margin: '0 auto' }} />
        {pending ? (
          <>
            <h2 style={{ margin: 0, fontSize: 19, textAlign: 'center' }}>⧗ Almost there</h2>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, textAlign: 'center' }}>
              Your setup is in — the team is verifying your broker account and switching the copy on. Everything unlocks automatically, usually <b style={{ color: 'var(--text)' }}>within a few hours</b>.
            </p>
            <a {...tgHref(SUPPORT_TG)} rel="noreferrer" style={sheetGoldCta}>💬 MESSAGE SUPPORT — @mathieu_algoria</a>
          </>
        ) : (
          <>
            <div className="mono" style={{ fontSize: 10, letterSpacing: 2, color: 'var(--gold)', textAlign: 'center', fontWeight: 800 }}>MEMBERS ONLY</div>
            <h2 style={{ margin: 0, fontSize: 20, textAlign: 'center' }}>Unlock your Algoria access</h2>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, textAlign: 'center' }}>
              <b style={{ color: 'var(--text)' }}>No subscription.</b> Your access unlocks when you open an account with our partner broker — then Algoria trades on it automatically, and you watch it live from here.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['1', 'Open your account with the partner broker (min $500 deposit)'],
                ['2', 'Connect it — encrypted, takes 2 minutes'],
                ['3', 'Algoria copies every trade to your account, hands-free'],
              ].map(([n, t]) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(10,17,31,.6)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 13px' }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--gold)' }}>{n}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.45 }}>{t}</span>
                </div>
              ))}
            </div>
            <button onClick={() => router.push('/member/onboarding')} style={{ ...sheetGoldCta, border: 'none', cursor: 'pointer' }}>⚡ UNLOCK MY ACCESS →</button>
            <a
              {...tgHref(BOOK_CALL_URL)}
              rel="noreferrer"
              style={{ padding: '12px 16px', borderRadius: 13, textAlign: 'center', textDecoration: 'none', display: 'block', fontWeight: 700, letterSpacing: 0.4, fontSize: 13, color: 'var(--cyan)', border: '1px solid rgba(43,227,245,.4)', background: 'rgba(43,227,245,.06)' }}
            >
              📞 Prefer a human? Book a call with Mathieu
            </a>
            <a {...tgHref(SUPPORT_TG)} rel="noreferrer" style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--muted)', textDecoration: 'none' }}>
              💬 Or just message <b style={{ color: 'var(--cyan)' }}>@mathieu_algoria</b>
            </a>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
const sheetGoldCta: CSSProperties = {
  padding: '14px 16px', borderRadius: 13, textAlign: 'center', textDecoration: 'none', display: 'block',
  fontWeight: 800, letterSpacing: 0.6, fontSize: 14, color: '#0b0e14',
  background: 'linear-gradient(90deg,#ffd166,#f5a623)', boxShadow: '0 8px 26px rgba(245,166,35,.28)',
};

// Icônes SVG de la nav (traits fins, style cockpit — fini les glyphes texte "basiques")
const ic = (d: string) => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const ICONS: Record<string, React.ReactNode> = {
  home: ic('M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5'),
  history: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3.2 2" />
    </svg>
  ),
  academy: ic('M12 3 2 8.5 12 14l10-5.5L12 3zM6 11v5c0 1.6 2.7 3 6 3s6-1.4 6-3v-5'),
  profile: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1.3-3.4 4.1-5 7.5-5s6.2 1.6 7.5 5" />
    </svg>
  ),
};

// PROMPT D'INSTALLATION PWA — personne n'a le réflexe "ajouter à l'écran d'accueil" : on le provoque.
// Un SEUL bouton : Android/Chrome → prompt natif (un tap, imbattable) ; sinon → la page store /download
// (fiche façon App Store : screenshots, avis, tuto iPhone détaillé — bien mieux qu'un mini-guide en popup).
// Réapparaît à CHAQUE ouverture (dismiss = session seulement) ; disparaît définitivement une fois installée.
function InstallPrompt() {
  const [mode, setMode] = useState<'hidden' | 'native' | 'store'>('hidden');
  const deferred = useRef<{ prompt: () => Promise<void> } | null>(null);
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone || sessionStorage.getItem('alg_install_hide')) return;
    setMode('store'); // par défaut : direction la fiche store (iOS, Firefox, navigateur intégré…)
    const onBip = (e: Event) => { e.preventDefault(); deferred.current = e as unknown as { prompt: () => Promise<void> }; setMode('native'); };
    window.addEventListener('beforeinstallprompt', onBip);
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, []);
  if (mode === 'hidden') return null;
  const dismiss = () => { sessionStorage.setItem('alg_install_hide', '1'); setMode('hidden'); };
  return (
    <div style={{ position: 'fixed', left: 10, right: 10, bottom: 88, zIndex: 45, maxWidth: 540, margin: '0 auto' }}>
      <div className="panel cardIn" style={{ padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'rgba(43,227,245,.4)', boxShadow: '0 10px 34px rgba(2,6,16,.7), 0 0 24px rgba(43,227,245,.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <img src="/brand/algoria-mark.png" alt="" width={34} height={34} style={{ objectFit: 'contain' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Get the Algoria app</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>Full-screen, on your home screen, with win alerts — this is meant to live on your phone.</div>
          </div>
          <button onClick={dismiss} aria-label="close" style={{ border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)', color: 'var(--muted)', borderRadius: 7, width: 24, height: 24, cursor: 'pointer', fontSize: 13, lineHeight: '20px' }}>×</button>
        </div>
        {mode === 'native' ? (
          <button
            onClick={() => { void deferred.current?.prompt(); dismiss(); }}
            style={{ padding: '11px 14px', borderRadius: 11, border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: 0.5, fontSize: 13, color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', textAlign: 'center' }}
          >
            ⬇ INSTALL — ONE TAP
          </button>
        ) : (
          <a
            href="/download"
            style={{ padding: '11px 14px', borderRadius: 11, cursor: 'pointer', fontWeight: 800, letterSpacing: 0.5, fontSize: 13, color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', textAlign: 'center', textDecoration: 'none' }}
          >
            ⬇ GET THE APP
          </a>
        )}
      </div>
    </div>
  );
}

export function MemberChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  // pas de nav avant connexion NI pendant l'onboarding / l'attente d'approbation (tous les onglets sont verrouillés)
  const bare = ['/login', '/denied', '/onboarding', '/pending', '/invite'].some((p) => path?.includes(p));
  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/member-sw.js').catch(() => {});
  }, []);
  const Tab = ({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) => {
    const active = path === href || (href !== '/member' && path?.startsWith(href));
    return (
      <button
        onClick={() => router.push(href)}
        style={{
          flex: 1, maxWidth: 110, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          padding: '7px 4px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'transparent',
          color: active ? 'var(--cyan)' : 'var(--dim)',
        }}
      >
        {icon}
        <span style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', fontWeight: active ? 700 : 500 }}>{label}</span>
      </button>
    );
  };
  const liveActive = path?.startsWith('/member/live');
  // le prompt d'installation vit sur les pages connectées (y compris l'attente d'approbation — le bon moment pour installer)
  const preAuth = ['/login', '/denied', '/invite'].some((p) => path?.includes(p));
  return (
    // .appShell : document VERROUILLÉ (zéro rebond/vide), .appScroll = la seule scroll view — sensation native
    <div className="appShell" style={{ maxWidth: 560, margin: '0 auto', width: '100%' }}>
      <div className="appScroll" style={{ padding: bare ? '14px 14px 20px' : '14px 14px 96px' }}>{children}</div>
      {!preAuth && <InstallPrompt />}
      {!bare && (
        <nav
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2,
            padding: '6px 10px max(10px, env(safe-area-inset-bottom))',
            background: 'rgba(8,16,31,.94)', backdropFilter: 'blur(10px)', borderTop: '1px solid var(--border)',
          }}
        >
          {/* 5 onglets — ALGORIA AI parfaitement centré : Home·History | AI | Academy·Profile */}
          <Tab href="/member" label="Home" icon={ICONS.home} />
          <Tab href="/member/history" label="History" icon={ICONS.history} />
          {/* ALGORIA AI — le bouton PRINCIPAL : central, surélevé, la marque au centre (le flux live de l'IA) */}
          <button
            onClick={() => router.push('/member/live')}
            aria-label="Algoria AI — live feed"
            style={{ flex: 1, maxWidth: 118, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', cursor: 'pointer', marginTop: -22 }}
          >
            <span
              className={liveActive ? undefined : 'liveGlow'}
              style={{
                width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(160deg, #12213e 0%, #0a1425 100%)',
                border: `1.5px solid ${liveActive ? 'rgba(43,227,245,.8)' : 'rgba(43,227,245,.4)'}`,
                boxShadow: liveActive ? '0 0 22px rgba(43,227,245,.4)' : '0 4px 16px rgba(2,6,16,.6)',
              }}
            >
              <img src="/brand/algoria-mark.png" alt="" width={32} height={32} style={{ objectFit: 'contain' }} />
            </span>
            <span style={{ fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 800, color: liveActive ? 'var(--cyan)' : 'var(--muted)' }}>Algoria AI</span>
          </button>
          <Tab href="/member/academy" label="Academy" icon={ICONS.academy} />
          <Tab href="/member/profile" label="Profile" icon={ICONS.profile} />
        </nav>
      )}
    </div>
  );
}

// ===== Briques UI partagées (mobile-first, ADN cockpit) =====
export const card: CSSProperties = { borderRadius: 14, padding: '16px 16px' };
export function StatusPill({ status }: { status: Member['status'] }) {
  const map: Record<Member['status'], { label: string; color: string; bg: string; pulse?: boolean }> = {
    live: { label: '● COPYING LIVE', color: 'var(--up)', bg: 'rgba(31,216,176,.1)', pulse: true },
    paused: { label: '⏸ COPY PAUSED', color: 'var(--gold)', bg: 'rgba(245,194,74,.1)' },
    pending_copier: { label: '⧗ CONNECTING YOUR ACCOUNT', color: 'var(--cyan)', bg: 'rgba(43,227,245,.08)', pulse: true },
    onboarding: { label: 'SETUP IN PROGRESS', color: 'var(--muted)', bg: 'rgba(130,152,190,.1)' },
  };
  const m = map[status] ?? map.onboarding;
  return (
    <span className={m.pulse ? 'pulse' : undefined} style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, padding: '5px 11px', borderRadius: 7, color: m.color, background: m.bg, border: `1px solid color-mix(in srgb, ${m.color} 40%, transparent)` }}>
      {m.label}
    </span>
  );
}

export const RISK_TIERS = [
  { key: 'low', label: 'CAUTIOUS', lot: '0.01', blurb: 'Discover the machine with minimal exposure.' },
  { key: 'balanced', label: 'BALANCED', lot: '0.05', blurb: 'The recommended setting — visible rhythm, contained risk.' },
  { key: 'high', label: 'AGGRESSIVE', lot: '0.10', blurb: 'For funded accounts only — bigger swings both ways.' },
] as const;

export function RiskPicker({ value, onPick, busy }: { value: string; onPick: (k: 'low' | 'balanced' | 'high') => void; busy?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {RISK_TIERS.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            disabled={busy}
            onClick={() => onPick(t.key)}
            style={{
              textAlign: 'left', display: 'flex', alignItems: 'center', gap: 13, padding: '13px 15px', borderRadius: 12, cursor: 'pointer',
              border: `1px solid ${active ? 'rgba(43,227,245,.55)' : 'var(--border)'}`,
              background: active ? 'rgba(43,227,245,.07)' : 'rgba(10,17,31,.55)',
              boxShadow: active ? '0 0 16px rgba(43,227,245,.12)' : undefined,
              color: 'var(--text)', opacity: busy ? 0.6 : 1,
            }}
          >
            <span className="mono" style={{ fontSize: 19, fontWeight: 800, minWidth: 56, color: t.key === 'high' ? 'var(--gold)' : active ? 'var(--cyan)' : 'var(--text)' }}>{t.lot}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 1 }}>{t.label}{t.key === 'balanced' ? <span style={{ color: 'var(--dim)', fontWeight: 500 }}> · default</span> : ''}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{t.blurb}</span>
            </span>
            {active && <span style={{ marginLeft: 'auto', color: 'var(--cyan)', fontSize: 15 }}>✓</span>}
          </button>
        );
      })}
    </div>
  );
}
