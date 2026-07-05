'use client';
// ALGORIA LIVE (lecture seule) — le wow de la PWA : le membre voit l'IA penser en direct depuis sa poche.
// Prix : broadcast realtime (canal public 'algoria-ticks', comme le cockpit). Desk : /api/member/feed (30 s).
// AUCUN contrôle ici : le cockpit /app reste l'outil de l'opérateur.
import { useEffect, useState } from 'react';
import { Desk } from '@/components/Desk';
import { usePrice } from '@/lib/cockpit/useRealtime';
import { useMe, Locked, UnlockSheet } from '../ui';

const SYMS = [
  { key: 'XAUUSD', short: 'XAU', dp: 2 },
  { key: 'NAS100', short: 'NAS', dp: 1 },
  { key: 'BTCUSD', short: 'BTC', dp: 1 },
];

function PriceChip({ sym, short, dp, active, onClick }: { sym: string; short: string; dp: number; active: boolean; onClick: () => void }) {
  const px = usePrice(sym);
  return (
    <button onClick={onClick} className="mono" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '9px 6px', borderRadius: 11, cursor: 'pointer', border: `1px solid ${active ? 'rgba(43,227,245,.5)' : 'var(--border)'}`, background: active ? 'rgba(43,227,245,.07)' : 'rgba(10,17,31,.55)' }}>
      <span style={{ fontSize: 10, letterSpacing: 1.2, color: active ? 'var(--cyan)' : 'var(--dim)', fontWeight: 700 }}>{short}</span>
      <span style={{ fontSize: 14.5, fontWeight: 700, color: px ? (px.dir >= 0 ? 'var(--up)' : 'var(--down)') : 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
        {px ? px.mid.toFixed(dp) : '—'}
      </span>
    </button>
  );
}

export default function MemberLive() {
  const { member, unlocked, loading } = useMe();
  const [items, setItems] = useState<unknown[]>([]);
  const [hero, setHero] = useState('XAUUSD');
  const [paywall, setPaywall] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => void fetch('/api/member/feed').then(async (r) => (r.ok && alive ? setItems(((await r.json()) as { desk: unknown[] }).desk) : null));
    load();
    const iv = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  if (loading || !member) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;
  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6, height: 'calc(100vh - 96px)' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {SYMS.map((s) => <PriceChip key={s.key} sym={s.key} short={s.short} dp={s.dp} active={hero === s.key} onClick={() => setHero(s.key)} />)}
      </div>
      {/* prospect : le flux TOURNE dessous, grisé — il voit l'IA vivre sans lire ses analyses (rédigées côté serveur) */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Locked unlocked={unlocked} onUnlock={() => setPaywall(true)} label="LIVE AI FEED — MEMBERS ONLY">
          <Desk items={items as never[]} heroSymbol={hero} />
        </Locked>
      </div>
      <p className="mono" style={{ margin: 0, fontSize: 10, color: 'var(--dim)', textAlign: 'center', letterSpacing: 1 }}>
        {unlocked ? 'READ-ONLY FEED · THE COCKPIT STAYS IN THE STREAM' : 'THE AI IS LIVE — UNLOCK TO READ HER ANALYSIS'}
      </p>
      <UnlockSheet open={paywall} onClose={() => setPaywall(false)} status={member.status} />
    </main>
  );
}
