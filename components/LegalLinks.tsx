// Le pied de page légal : conditions, confidentialité, risques, contact, société (voir lib/legal.ts).
import { LEGAL } from '@/lib/legal';

const link = { color: 'var(--muted)', textDecoration: 'none', borderBottom: '1px solid var(--border)' } as const;

export function LegalLinks({ style }: { style?: React.CSSProperties }) {
  return (
    <p style={{ fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.6, margin: 0, textAlign: 'center', ...style }}>
      <a href="/terms" style={link}>Terms</a> · <a href="/privacy" style={link}>Privacy</a> · <a href="/risk" style={link}>Risk disclosure</a> · <a href={`mailto:${LEGAL.contact}`} style={link}>{LEGAL.contact}</a>
      <br />© {new Date().getFullYear()} {LEGAL.company}, a {LEGAL.state} limited liability company. Algoria is a trading software, not a broker.
    </p>
  );
}
