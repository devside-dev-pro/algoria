'use client';
// ALGORIA LIVE — « le cockpit dans la poche » (lecture seule). Maquette B « le graphique roi » :
//   sélecteur GOLD/BTC → GRAPHIQUE dominant (bougies live + prix + zones, mode broadcast = zéro outil
//   opérateur) surmonté d'un bandeau moniteur (mini-orbe qui respire + état + scan) → DESK filtré dessous.
// Tout est déjà alimenté : le chart lit la table `candles` + les ticks temps réel (par symbole), le desk
// vient de /api/member/feed. AUCUN contrôle ici : le vrai cockpit /app reste l'outil de l'opérateur.
import { useEffect, useMemo, useState } from 'react';
import { Chart } from '@/components/Chart';
import { AlgoriaOrb } from '@/components/Orb';
import { Desk } from '@/components/Desk';
import { usePrice } from '@/lib/cockpit/useRealtime';
import { useMe, Locked, UnlockSheet, LoadFailed } from '../ui';

const SYMS = [
  { key: 'XAUUSD', short: 'XAU', dp: 2, watch: false },
  { key: 'BTCUSD', short: 'BTC', dp: 1, watch: true }, // watch-only : Algoria surveille + swing, ne scalpe pas
];

// état moteur → mot + couleur (miroir de StateHero côté Desk)
const STATE_WORD: Record<string, string> = { in_long: 'IN LONG', in_short: 'IN SHORT', stalking_long: 'STALKING LONG', stalking_short: 'STALKING SHORT', aside: 'STANDING ASIDE' };
const stateColor = (st?: string) => (st?.includes('long') ? 'var(--up)' : st?.includes('short') ? 'var(--down)' : 'var(--muted)');
const glyphOf = (st?: string) => (st?.includes('long') ? '▲' : st?.includes('short') ? '▼' : '◆');

function PriceChip({ sym, short, dp, watch, active, onClick }: { sym: string; short: string; dp: number; watch: boolean; active: boolean; onClick: () => void }) {
  const px = usePrice(sym);
  return (
    <button onClick={onClick} className="mono" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '8px 6px', borderRadius: 11, cursor: 'pointer', border: `1px solid ${active ? 'rgba(43,227,245,.5)' : 'var(--border)'}`, background: active ? 'rgba(43,227,245,.07)' : 'rgba(10,17,31,.55)', boxShadow: active ? '0 0 16px rgba(43,227,245,.1)' : undefined }}>
      <span style={{ fontSize: 10, letterSpacing: 1.2, color: active ? 'var(--cyan)' : 'var(--dim)', fontWeight: 700 }}>{short}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: px ? (px.dir >= 0 ? 'var(--up)' : 'var(--down)') : 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
        {px ? px.mid.toFixed(dp) : '—'}
      </span>
      {watch && <span style={{ fontSize: 8, letterSpacing: 1, color: 'var(--gold)', fontWeight: 800, marginTop: 1 }}>◆ SWING ONLY</span>}
    </button>
  );
}

export default function MemberLive() {
  const { member, unlocked, loading } = useMe();
  const [items, setItems] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [hero, setHero] = useState('XAUUSD');
  const [paywall, setPaywall] = useState(false);
  const isWatch = hero === 'BTCUSD';

  useEffect(() => {
    let alive = true;
    const load = () => void fetch('/api/member/feed').then(async (r) => {
      if (!r.ok || !alive) return;
      const d = (await r.json()) as { desk: any[]; trades: any[] };
      setItems(d.desk ?? []);
      setTrades(d.trades ?? []);
    });
    load();
    const iv = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // méta du marché sélectionné (état · conviction · session) pour le bandeau moniteur
  const meta = useMemo(() => items.find((e: any) => e?.data?.state && (e.data.symbol ?? 'XAUUSD') === hero)?.data ?? null, [items, hero]);
  // marqueurs de gains sur le chart : trades gagnants clôturés du marché sélectionné
  const wins = useMemo(
    () => trades.filter((t) => String(t.symbol) === hero && Number(t.pnl) > 0 && t.closed_at).map((t) => ({ time: Date.parse(t.closed_at), pnl: Number(t.pnl) })),
    [trades, hero],
  );

  if (loading) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;
  if (!member) return <LoadFailed />; // échec de chargement : une issue, jamais un « loading… » sans fin

  const stateWord = isWatch && !meta ? 'WATCHING' : STATE_WORD[meta?.state] ?? 'STANDING ASIDE';
  const stColor = isWatch ? 'var(--gold)' : stateColor(meta?.state);
  const conf = typeof meta?.confidence === 'number' ? Math.round(meta.confidence * 100) : null;

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6, height: 'calc(100vh - 96px)' }}>
      {/* SÉLECTEUR — pilote le chart (key={hero}) ET le desk (only={hero}) : il « fait » enfin quelque chose */}
      <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
        {SYMS.map((s) => <PriceChip key={s.key} sym={s.key} short={s.short} dp={s.dp} watch={s.watch} active={hero === s.key} onClick={() => setHero(s.key)} />)}
      </div>

      {unlocked ? (
        <>
          {/* ===== BANDEAU MONITEUR — au-DESSUS du chart (le chart a déjà son propre HUD OHLC/EMA :
                  poser l'orbe dessus le cachait). Mini-orbe qui respire + état moteur + scan. ===== */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 11px', borderRadius: 12, border: '1px solid var(--border)', background: 'linear-gradient(180deg,rgba(18,33,62,.55),rgba(10,20,37,.55))', flex: '0 0 auto' }}>
            <AlgoriaOrb size={34} state="thinking" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.3, color: stColor, display: 'flex', alignItems: 'center', gap: 6 }}>
                {glyphOf(meta?.state)} {stateWord}
                {conf != null && <span style={{ fontSize: 9.5, color: 'var(--dim)', fontWeight: 600, fontFamily: 'var(--mono, ui-monospace)' }}>· {conf}%</span>}
                {isWatch && <span title="Position trades held for days — no intraday scalping on Bitcoin" style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.6, color: 'var(--gold)', border: '1px solid rgba(245,194,74,.4)', background: 'rgba(245,194,74,.08)', borderRadius: 5, padding: '1px 6px' }}>◆ SWING ONLY</span>}
              </span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: 0.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {hero} · M5{meta?.session ? ` · ${meta.session}` : ''}
              </span>
            </div>
          </div>

          {/* ===== LE GRAPHIQUE ROI (garde son propre HUD, aucun overlay par-dessus) ===== */}
          <section style={{ position: 'relative', flex: '0 0 44%', minHeight: 250, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(43,227,245,.3)', background: '#070f1d' }}>
            <Chart key={hero} symbol={hero} signals={[]} wins={wins} defaultTf="M5" broadcast />
          </section>

          {/* ===== LE DESK, filtré sur le marché choisi ===== */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Desk items={items} heroSymbol={hero} only={hero} />
          </div>
          <p className="mono" style={{ margin: 0, fontSize: 10, color: 'var(--dim)', textAlign: 'center', letterSpacing: 1 }}>
            READ-ONLY · YOUR COCKPIT IN YOUR POCKET
          </p>
        </>
      ) : (
        /* PROSPECT : le flux tourne, grisé — il voit l'IA vivre sans lire ses analyses */
        <>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Locked unlocked={unlocked} onUnlock={() => setPaywall(true)} label="LIVE AI COCKPIT — MEMBERS ONLY">
              <Desk items={items} heroSymbol={hero} only={hero} />
            </Locked>
          </div>
          <p className="mono" style={{ margin: 0, fontSize: 10, color: 'var(--dim)', textAlign: 'center', letterSpacing: 1 }}>
            THE AI IS LIVE — UNLOCK TO OPEN YOUR COCKPIT
          </p>
        </>
      )}

      <UnlockSheet open={paywall} onClose={() => setPaywall(false)} status={member.status} />
    </main>
  );
}
