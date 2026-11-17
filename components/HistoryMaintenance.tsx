// ÉCRAN PROSPECT DE L'HISTORIQUE (17/11/2026, décision Mathieu : plus d'écran « maintenance »).
// Affiché sur History, Home et Track record (in-app et page publique) tant que HISTORY_MAINTENANCE
// est à true (lib/member/historyMaintenance.ts). Les membres live ou en pause, et l'admin, ne passent
// pas par ici : leur historique réel reste inchangé.
//
// Trois blocs, dans cet ordre :
//   1. un aperçu flouté avec cadenas — silhouette d'une liste, données factices STATIQUES, montants
//      masqués (••••), jamais un vrai trade, jamais un P&L lisible même si le flou est retiré ;
//   2. la carte « preuve vérifiée » Myfxbook, bouton officiel de la #579 ;
//   3. « How it works » en 3 cartes, terminologie de l'onboarding (lib/member/ui-text.ts).
// Aucun chiffre de résultat (gain, %, winrate). Aucune promesse, aucun montant à déposer.
import { MYFXBOOK_URL } from '@/lib/member/myfxbook';

// Silhouette uniquement. Pas de prix, pas de P&L, pas d'heure réelle, pas de symbole lisible.
const TEASER_ROWS: ReadonlyArray<{ side: 'buy' | 'sell' }> = [
  { side: 'buy' },
  { side: 'sell' },
  { side: 'buy' },
  { side: 'sell' },
  { side: 'buy' },
  { side: 'sell' },
];

const HOW_IT_WORKS: ReadonlyArray<{ n: string; title: string; body: string }> = [
  {
    n: '1',
    title: 'Open your broker account via our link',
    body: 'One account with a partner broker, opened through Algoria\u2019s link.',
  },
  {
    n: '2',
    title: 'Connect your MetaTrader account',
    body: 'Enter your MT5 details once in the app.',
  },
  {
    n: '3',
    title: 'Copy automatically',
    body: 'Every Algoria trade is copied to your account, at the size you chose.',
  },
];

export function HistoryMaintenance() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section className="panel" style={{ position: 'relative', overflow: 'hidden', padding: 0 }}>
        <div
          aria-hidden="true"
          style={{ filter: 'blur(8px)', userSelect: 'none', pointerEvents: 'none', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: 1.4, fontWeight: 800, color: 'var(--gold)' }}>•••••• · ••••••••</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>••••</span>
          </div>
          {TEASER_ROWS.map((row, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, opacity: 0.85 }}>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', minWidth: 38 }}>••:••</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: row.side === 'buy' ? 'var(--up)' : 'var(--muted)' }}>{row.side === 'buy' ? '▲' : '▼'}</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>••••••</span>
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: 1 }}>••••</span>
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
            padding: 18,
            textAlign: 'center',
            background: 'linear-gradient(180deg, rgba(8,14,28,.42) 0%, rgba(8,14,28,.62) 100%)',
          }}
        >
          <div style={{ fontSize: 28, lineHeight: 1 }} aria-hidden>🔒</div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, lineHeight: 1.45, color: 'var(--text)', maxWidth: 260 }}>
            Unlocked once your account is connected
          </p>
        </div>
      </section>

      <a
        href={MYFXBOOK_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="panel"
        style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'var(--text)', borderColor: 'rgba(43,227,245,.28)' }}
      >
        <span style={{ fontSize: 20 }} aria-hidden>🔗</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, fontWeight: 800, color: 'var(--cyan)' }}>VERIFIED PROOF</span>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>Open the official track record on Myfxbook</span>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.45 }}>Verified by a third party · the live copied account</span>
        </span>
        <span style={{ color: 'var(--cyan)', fontSize: 18 }} aria-hidden>↗</span>
      </a>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <h2 className="mono" style={{ fontSize: 11, letterSpacing: 1.6, color: 'var(--muted)', margin: '2px 0 0', fontWeight: 800, textAlign: 'center' }}>HOW IT WORKS</h2>
        {HOW_IT_WORKS.map((step) => (
          <div key={step.n} className="panel" style={{ display: 'flex', gap: 12, padding: '12px 14px' }}>
            <span className="mono" style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, color: 'var(--gold)' }}>{step.n}</span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 750 }}>{step.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: 2 }}>{step.body}</div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
