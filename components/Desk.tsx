'use client';
import { useDesk } from '@/lib/cockpit/useRealtime';

// Desk ALGORIA AI — surface distincte du terminal (police sans, couleurs par type) où Claude
// pose ses opportunités / trades / analyses en langage naturel, persistants et lisibles sur le live.
const KIND: Record<string, { label: string; color: string }> = {
  opportunity: { label: 'OPPORTUNITY', color: 'var(--gold)' },
  trade: { label: 'TRADE', color: 'var(--up)' },
  analysis: { label: 'MARKET READ', color: 'var(--cyan)' },
};

function badge(e: any): { label: string; color: string } {
  const k = (e?.data?.kind as string) ?? 'analysis';
  if (k === 'trade') {
    const long = e?.data?.direction === 'long';
    return { label: long ? 'BOUGHT · LONG' : 'SOLD · SHORT', color: long ? 'var(--up)' : 'var(--down)' };
  }
  return KIND[k] ?? KIND.analysis;
}

export function Desk() {
  const items = useDesk(10);
  return (
    <section className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, borderColor: 'rgba(43,227,245,.3)' }}>
      <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>◆ ALGORIA&nbsp;AI · desk</span>
        <span className="pulse" style={{ fontSize: 10.5, color: 'var(--cyan)' }}>● live analysis</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 && <span style={{ color: 'var(--dim)', fontSize: 12 }}>ALGORIA is watching the tape… opportunities and calls appear here.</span>}
        {items.map((e: any, i: number) => {
          const b = badge(e);
          const d = e?.data ?? {};
          return (
            <div
              key={e.id ?? i}
              style={{
                borderLeft: `3px solid ${b.color}`,
                background: i === 0 ? 'rgba(43,227,245,.06)' : 'rgba(255,255,255,.015)',
                borderRadius: 6,
                padding: '7px 10px',
                boxShadow: i === 0 ? '0 0 16px rgba(43,227,245,.13)' : undefined,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: b.color }}>{b.label}</span>
                <span style={{ fontSize: 10, color: 'var(--dim)' }}>{e.ts ? new Date(e.ts).toLocaleTimeString('en-GB') : ''}</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text)' }}>{e.msg}</div>
              {(d.entry != null || d.confidence != null) && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
                  {d.entry != null ? `entry ${Number(d.entry).toFixed(1)} · sl ${Number(d.sl).toFixed(1)} · tp ${Number(d.tp).toFixed(1)}` : ''}
                  {d.entry != null && d.confidence != null ? ' · ' : ''}
                  {d.confidence != null ? `conviction ${Math.round(Number(d.confidence) * 100)}%` : ''}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
