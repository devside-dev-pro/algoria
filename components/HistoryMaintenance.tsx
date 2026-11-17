// ÉCRAN PROSPECT DE L'HISTORIQUE (17/11/2026, maquette history-prospect.html).
// Affiché sur History, Home et Track record (in-app et page publique) tant que HISTORY_MAINTENANCE
// est à true (lib/member/historyMaintenance.ts). Les membres live ou en pause, et l'admin, ne passent
// pas par ici : leur historique réel reste inchangé.
//
// Trois blocs + une ligne de risque, alignés sur la maquette :
//   1. aperçu flouté (barres skeleton, aucune donnée réelle, aucun P&L lisible) + cadenas SVG + CTA ;
//   2. carte « preuve vérifiée » Myfxbook (URL unique de lib/member/myfxbook.ts, bouton #579) ;
//   3. « How it works » en 3 cartes (textes de la maquette). « 24/5 » est conservé : il décrit le
//      trading de l'or, qui ne cote pas le week-end — « 24/7 » serait factuellement faux.
// Icônes : SVG en traits, même style que la nav membre (app/member/ui.tsx). Pas d'emoji.
// Aucun chiffre de résultat. Aucune promesse de gain.
import type { ReactNode } from 'react';
import { MYFXBOOK_URL } from '@/lib/member/myfxbook';

const GHOST_ROWS: ReadonlyArray<{ w1: string; w2: string }> = [
  { w1: '58%', w2: '38%' },
  { w1: '46%', w2: '30%' },
  { w1: '64%', w2: '42%' },
  { w1: '52%', w2: '34%' },
];

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const HOW_IT_WORKS: ReadonlyArray<{ title: string; body: string; icon: ReactNode }> = [
  {
    title: 'The AI trades gold 24/5',
    body: 'Algoria AI watches the gold market around the clock, whenever it\u2019s open (Monday to Friday).',
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3.2 2" />
      </Icon>
    ),
  },
  {
    title: 'A stop-loss on every trade',
    body: 'Each trade has a set exit if it goes wrong. The loss is cut, never left to run.',
    icon: (
      <Icon>
        <path d="M12 3 5 6.5v5.2c0 4 3 6.8 7 8.3 4-1.5 7-4.3 7-8.3V6.5L12 3z" />
      </Icon>
    ),
  },
  {
    title: 'Your money stays with your broker',
    body: 'In your name, on your own account. Algoria never holds your funds.',
    icon: (
      <Icon>
        <path d="M4 21h16M6 21V10l6-5 6 5v11M9 21v-6h6v6" />
      </Icon>
    ),
  },
];

export function HistoryMaintenance() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div
          aria-hidden="true"
          style={{ padding: 12, minHeight: 290, display: 'flex', flexDirection: 'column', gap: 9, filter: 'blur(3px)', opacity: 0.75, userSelect: 'none', pointerEvents: 'none' }}
        >
          {GHOST_ROWS.map((row, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', borderRadius: 12, background: 'var(--surface)', border: '1px solid rgba(130,152,190,.12)' }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(130,152,190,.22)', flex: 'none' }} />
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'block', height: 8, borderRadius: 4, background: 'rgba(130,152,190,.25)', width: row.w1 }} />
                <span style={{ display: 'block', height: 8, borderRadius: 4, background: 'rgba(130,152,190,.25)', width: row.w2, opacity: 0.6 }} />
              </span>
              <span style={{ width: 52, height: 10, borderRadius: 5, background: 'rgba(130,152,190,.2)', flex: 'none' }} />
            </div>
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            textAlign: 'center',
            padding: 20,
            background: 'radial-gradient(70% 60% at 50% 50%, rgba(8,16,31,.88), rgba(8,16,31,.55))',
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--cyan)',
              background: 'rgba(43,227,245,.1)',
              border: '1px solid rgba(43,227,245,.45)',
              boxShadow: '0 0 20px rgba(43,227,245,.25)',
            }}
          >
            <Icon size={22}>
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </Icon>
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', maxWidth: 280, lineHeight: 1.35 }}>
            Unlocked once your account is connected
          </div>
          <p style={{ margin: '-4px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--muted)', maxWidth: 280 }}>
            Every trade copied on your account will show up here.
          </p>
          <a
            href="/member/onboarding"
            style={{
              width: 'auto',
              padding: '13px 20px',
              borderRadius: 14,
              border: 0,
              background: 'var(--grad-brand)',
              color: 'var(--ink)',
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: 0.2,
              textDecoration: 'none',
              boxShadow: '0 6px 22px rgba(43,227,245,.25)',
            }}
          >
            Connect my account →
          </a>
          <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>About 5 minutes · we save as you go</span>
        </div>
      </section>

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 9, borderColor: 'rgba(31,216,176,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              display: 'grid',
              placeItems: 'center',
              flex: 'none',
              color: 'var(--up)',
              background: 'rgba(31,216,176,.1)',
              border: '1px solid rgba(31,216,176,.4)',
            }}
          >
            <Icon size={18}>
              <path d="M5 12.5 9.5 17 19 7.5" />
            </Icon>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 10.5, letterSpacing: 2.2, color: 'var(--up)', textTransform: 'uppercase', fontWeight: 500 }}>Verified track record</div>
            <h2 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700 }}>Checked by a third party</h2>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--muted)' }}>
          Algoria&rsquo;s master account is published on <b style={{ color: 'var(--text)', fontWeight: 700 }}>Myfxbook</b>, an independent site that reads the trades straight from the broker. Look at the full history there, losses included.
        </p>
        <a
          href={MYFXBOOK_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            padding: 12,
            borderRadius: 12,
            border: '1px solid rgba(43,227,245,.4)',
            background: 'rgba(43,227,245,.06)',
            color: 'var(--cyan)',
            fontWeight: 600,
            fontSize: 14,
            textDecoration: 'none',
          }}
        >
          View on Myfxbook
          <Icon size={15}>
            <path d="M9 5h10v10M19 5 9 15M5 9v10h10" />
          </Icon>
        </a>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: 2.2, color: 'var(--gold)', textTransform: 'uppercase', fontWeight: 500 }}>How it works</div>
        {HOW_IT_WORKS.map((step) => (
          <div key={step.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 13, borderRadius: 13, border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <div
              style={{
                width: 36,
                height: 36,
                flex: 'none',
                borderRadius: 10,
                display: 'grid',
                placeItems: 'center',
                color: 'var(--gold)',
                background: 'rgba(245,194,74,.08)',
                border: '1px solid rgba(245,194,74,.3)',
              }}
            >
              {step.icon}
            </div>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>{step.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.45, marginTop: 2 }}>{step.body}</div>
            </div>
          </div>
        ))}
      </section>

      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: 'var(--muted)', display: 'flex', gap: 7, alignItems: 'flex-start', padding: '9px 11px', borderRadius: 10, border: '1px solid rgba(245,194,74,.28)', background: 'rgba(245,194,74,.05)' }}>
        <span style={{ color: 'var(--gold)', flex: 'none', marginTop: 1 }}>
          <Icon size={15}>
            <path d="M12 3.8 2.7 20h18.6L12 3.8z" />
            <path d="M12 9v5" />
            <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
          </Icon>
        </span>
        <span><b style={{ color: 'var(--gold)', fontWeight: 600 }}>Trading involves risk of capital loss.</b> Past performance does not guarantee future results.</span>
      </p>
    </div>
  );
}
