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
}

/** Charge le membre connecté ; redirige vers /member/login si pas de session. */
export function useMe(opts: { requireOnboarded?: boolean } = {}) {
  const [member, setMember] = useState<Member | null>(null);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    void fetch('/api/member/me')
      .then(async (r) => {
        if (r.status === 401) { router.replace('/member/login'); return null; }
        return (await r.json()) as { member: Member; admin: boolean };
      })
      .then((d) => {
        if (!alive || !d?.member) return;
        if (opts.requireOnboarded && d.member.status === 'onboarding') { router.replace('/member/onboarding'); return; }
        setMember(d.member);
        setAdmin(!!d.admin);
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { member, setMember, admin, loading };
}

const TABS = [
  { href: '/member', label: 'Home', icon: '⌂' },
  { href: '/member/live', label: 'Live', icon: '▲' },
  { href: '/member/history', label: 'History', icon: '≡' },
  { href: '/member/academy', label: 'Academy', icon: '◆' },
];

export function MemberChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const bare = path?.includes('/login') || path?.includes('/denied'); // pas de nav avant connexion
  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/member-sw.js').catch(() => {});
  }, []);
  return (
    <div style={{ minHeight: '100vh', maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', paddingBottom: bare ? 0 : 76 }}>
      <div style={{ flex: 1, padding: '14px 14px 0' }}>{children}</div>
      {!bare && (
        <nav
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
            display: 'flex', justifyContent: 'center', gap: 2,
            padding: 'max(8px, env(safe-area-inset-bottom)) 10px max(10px, env(safe-area-inset-bottom))',
            background: 'rgba(8,16,31,.92)', backdropFilter: 'blur(10px)', borderTop: '1px solid var(--border)',
          }}
        >
          {TABS.map((t) => {
            const active = path === t.href || (t.href !== '/member' && path?.startsWith(t.href));
            return (
              <button
                key={t.href}
                onClick={() => router.push(t.href)}
                style={{
                  flex: 1, maxWidth: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  padding: '7px 4px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: active ? 'rgba(43,227,245,.09)' : 'transparent',
                  color: active ? 'var(--cyan)' : 'var(--dim)',
                }}
              >
                <span style={{ fontSize: 15 }}>{t.icon}</span>
                <span style={{ fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', fontWeight: active ? 700 : 500 }}>{t.label}</span>
              </button>
            );
          })}
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
