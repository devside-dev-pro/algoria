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
import { useMe, Locked, UnlockSheet } from '../ui';

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
      {watch && <span style={{ fontSize: 8, letterSpacing: 1, color: 'var(--gold)', fontWeight: 800, marginTop: 1 }}>◆ WATCH · SWING</span>}
    </button>
  );
}

// compte à rebours vers la prochaine clôture M5 = la prochaine DÉCISION du moteur
function useScan() {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const iv = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(iv); }, []);
  const left = 300_000 - (clock % 300_000);
  return `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`;
}

export default function MemberLive() {
  const { member, unlocked, loading } = useMe();
  const [items, setItems] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [hero, setHero] = useState('XAUUSD');
  const [paywall, setPaywall] = useState(false);
  const scan = useScan();
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

  if (loading || !member) return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>loading…</main>;

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
          {/* ===== LE GRAPHIQUE ROI ===== */}
          <section style={{ position: 'relative', flex: '0 0 46%', minHeight: 264, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(43,227,245,.3)', background: '#070f1d' }}>
            <Chart key={hero} symbol={hero} signals={[]} wins={wins} defaultTf="M5" broadcast />

            {/* bandeau moniteur posé sur le chart : mini-orbe qui respire + état + méta */}
            <div style={{ position: 'absolute', top: 8, left: 10, zIndex: 20, display: 'flex', alignItems: 'center', gap: 9, pointerEvents: 'none' }}>
              <AlgoriaOrb size={30} state="thinking" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.3, color: stColor, textShadow: '0 1px 8px rgba(2,6,16,.9)' }}>
                  {glyphOf(meta?.state)} {stateWord}{conf != null && <span style={{ fontSize: 9, color: 'var(--dim)', fontWeight: 600 }}> · {conf}%</span>}
                </span>
                <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: 0.4 }}>
                  {hero} · M5{meta?.session ? ` · ${meta.session}` : ''}
                </span>
              </div>
            </div>

            {/* live + scan (droite) */}
            <div style={{ position: 'absolute', top: 9, right: 10, zIndex: 20, display: 'flex', alignItems: 'center', gap: 9, pointerEvents: 'none' }}>
              <span className="pulse mono" style={{ fontSize: 10, color: 'var(--up)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--up)', boxShadow: '0 0 8px var(--up)' }} />live
              </span>
            </div>
            <div style={{ position: 'absolute', bottom: 8, right: 10, zIndex: 20, pointerEvents: 'none', fontFamily: 'var(--mono, ui-monospace)', fontSize: 9.5, color: 'var(--dim)', background: 'rgba(7,13,24,.7)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 7px' }}>
              scan {scan}
            </div>

            {/* honnêteté BTC : watch-only, jamais de scalp intraday */}
            {isWatch && (
              <div style={{ position: 'absolute', bottom: 8, left: 10, zIndex: 20, pointerEvents: 'none', fontFamily: 'var(--mono, ui-monospace)', fontSize: 9, fontWeight: 800, letterSpacing: 0.6, color: 'var(--gold)', border: '1px solid rgba(245,194,74,.4)', background: 'rgba(245,194,74,.08)', borderRadius: 5, padding: '2px 7px' }}>
                ◆ WATCH · SWING ONLY
              </div>
            )}
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
