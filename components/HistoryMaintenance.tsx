// 🛠 L'écran « historique en maintenance » (lib/member/historyMaintenance.ts) — le même partout : History, Home,
// Track record (in-app et page publique). Il ne dit rien de faux : on refait le dispositif de trading, l'historique
// revient ensuite.
//
// 17/11/2026 — le bouton Myfxbook officiel (#579) reste visible pour les prospects pendant la maintenance :
// c'est la preuve tierce, le seul track record qu'ils peuvent ouvrir.
import { MYFXBOOK_URL } from '@/lib/member/myfxbook';

export function HistoryMaintenance() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: 26, lineHeight: 1 }}>🛠</div>
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: 1.6, fontWeight: 800, color: 'var(--gold)' }}>TRADE HISTORY · MAINTENANCE</div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--muted)', maxWidth: 360 }}>
          We&rsquo;re upgrading Algoria&rsquo;s trading setup. The trade history will be back here soon.
        </p>
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
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>Open the official track record on Myfxbook</span>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.45 }}>Verified by a third party · the live copied account</span>
        </span>
        <span style={{ color: 'var(--cyan)', fontSize: 18 }} aria-hidden>↗</span>
      </a>
    </div>
  );
}
