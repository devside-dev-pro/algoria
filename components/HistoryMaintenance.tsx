// 🛠 L'écran « historique en maintenance » (lib/member/historyMaintenance.ts) — le même partout : History, Home,
// Track record (in-app et page publique). Il ne dit rien de faux : on refait le dispositif de trading, l'historique
// revient ensuite.
export function HistoryMaintenance() {
  return (
    <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: 26, lineHeight: 1 }}>🛠</div>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: 1.6, fontWeight: 800, color: 'var(--gold)' }}>TRADE HISTORY · MAINTENANCE</div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--muted)', maxWidth: 360 }}>
        We&rsquo;re upgrading Algoria&rsquo;s trading setup. The trade history will be back here soon.
      </p>
    </section>
  );
}
