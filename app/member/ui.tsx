'use client';
// Coque CLIENT de l'espace membre : enregistrement du service worker, nav basse (onglets), hook useMe.
// Réutilise le langage visuel du cockpit (globals.css : .panel, .goldText, .mono) — même ADN, mobile-first.
import { useEffect, useState, type CSSProperties } from 'react';
import { usePathname, useRouter } from 'next/navigation';

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
}

export interface Referral {
  code: string | null;
  invited: number;
  activated: number;
  earnedUsd: number;
  pendingUsd: number;
  rewardUsd: number;
}

/** Charge le membre connecté ; redirige vers /member/login si pas de session.
 *  requireOnboarded : bloque AUSSI les comptes en attente d'approbation admin (pending_copier) —
 *  tant que l'accès n'a pas été validé (compte via notre lien + dépôt ≥ 500$ + copieur), AUCUN onglet n'est accessible. */
export function useMe(opts: { requireOnboarded?: boolean } = {}) {
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
        // Les ADMINS ne passent JAMAIS par le tunnel membre (onboarding/attente d'approbation) —
        // sinon l'opérateur se retrouve coincé dans son propre wizard en allant sur admin.algoria.tech.
        if (opts.requireOnboarded && !d.admin && d.member.status === 'onboarding') { router.replace('/member/onboarding'); return; }
        if (opts.requireOnboarded && !d.admin && d.member.status === 'pending_copier') { router.replace('/member/pending'); return; }
        setMember(d.member);
        setReferral(d.referral ?? null);
        setAdmin(!!d.admin);
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { member, setMember, referral, admin, loading };
}

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
  return (
    <div style={{ minHeight: '100vh', maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', paddingBottom: bare ? 0 : 86 }}>
      <div style={{ flex: 1, padding: '14px 14px 0' }}>{children}</div>
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
