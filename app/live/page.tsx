'use client';
// SCÈNE LIVE PORTRAIT (/live) — la page à streamer SOUS la cam dans TikTok LIVE Studio.
// Leçon du premier live : le cockpit est un outil d'opérateur, pas un spectacle — les viewers ne captaient
// pas qu'une IA trade. Ici tout est construit pour le mobile et pour le récit :
//   · bandeau permanent « AI TRADING LIVE · REAL ACCOUNT » — le contexte en 1 seconde
//   · CHART DOMINANT en M1 (gros, lisible), avec les dessins d'analyse d'Algoria
//   · RYTHME : compte à rebours vers la clôture M1 (une « décision » par minute — l'attente est du contenu)
//   · VERDICTS : chaque lecture du desk devient une carte flash — même « no edge » est un événement
//   · EN POSITION : héros P&L flottant géant qui tique en temps réel
//   · WIN : célébration plein cadre · SL : carte sobre 5 s (« risk managed ») — jamais de rouge dramatisé
//   · footer : défilé des wins du jour + CTA + QR vers algoria.tech (funnel Telegram — le closing passe par
//     le canal et le contact humain AVANT l'app : choix produit)
// Ouvrir dans le navigateur du stream (session opérateur connectée) et cropper la source en portrait.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from '@/components/Chart';
import { AlgoriaOrb } from '@/components/Orb';
import { Telemetry } from '@/components/Telemetry';
import { useDesk, useSignals, useTrades, usePrice, useLatestState } from '@/lib/cockpit/useRealtime';
import { getLatestTick } from '@/lib/cockpit/tickStore';

const CTAS = [
  '💯 ALGORIA IS COMPLETELY FREE — LINK IN BIO',
  '🤖 100% AUTONOMOUS — NO HUMAN TOUCHES THESE TRADES',
  '📲 SCAN THE CODE — JOIN FREE ON TELEGRAM',
  '🔎 OR TYPE ALGORIA.TECH IN YOUR BROWSER — 100% FREE',
  '🎁 EARN $50 FOR EVERY FRIEND YOU BRING',
];

export default function LiveStage() {
  const signals = useSignals(30);
  const trades = useTrades(60);
  const deskItems = useDesk(12);
  const st = useLatestState() as any;
  // MODE SOLO (?solo=1) — live autonome de nuit, sans cam : la zone caméra devient le terminal
  // mission control qui défile (l'IA visiblement au travail pendant que l'humain dort).
  const [solo, setSolo] = useState(false);
  useEffect(() => { setSolo(new URLSearchParams(window.location.search).get('solo') === '1'); }, []);
  const [qr, setQr] = useState<string | null>(null);
  const [ctaIdx, setCtaIdx] = useState(0);
  const [countdown, setCountdown] = useState(60);
  const [verdict, setVerdict] = useState<{ msg: string; sym: string } | null>(null);
  const [flash, setFlash] = useState<{ kind: 'win' | 'loss'; pnl: number; sym: string } | null>(null);
  const [, tickRender] = useState(0); // re-render 2×/s pour le P&L flottant qui tique
  const mountedAt = useRef(Date.now());
  const seenDesk = useRef<Set<string>>(new Set());
  const seenClosed = useRef<Set<string>>(new Set());

  useEffect(() => {
    void import('qrcode').then((m) =>
      m.toDataURL('https://algoria.tech', { margin: 1, width: 200, color: { dark: '#0b0e14', light: '#dce9ff' } }).then(setQr),
    );
    const ivCta = window.setInterval(() => setCtaIdx((i) => (i + 1) % CTAS.length), 8000);
    const ivSec = window.setInterval(() => {
      setCountdown(60 - new Date().getSeconds());
      tickRender((x) => x + 1);
    }, 500);
    return () => { window.clearInterval(ivCta); window.clearInterval(ivSec); };
  }, []);

  // hors BEAST : les micro-scalps du show ne pilotent ni le héros position ni les célébrations
  const rafale = useMemo(
    () => new Set((signals as any[]).filter((s) => Array.isArray(s.rationale) && s.rationale.join(' ').includes('RAFALE')).map((s) => String(s.ticket))),
    [signals],
  );

  // ===== position ouverte (le héros) : trade ouvert + son signal (SL/TP) — P&L flottant recalculé au tick
  const openTrade = (trades as any[]).find((t) => !t.closed_at && t.ticket != null && !rafale.has(String(t.ticket)));
  const hero = String(openTrade?.symbol ?? 'XAUUSD');
  const openSig = openTrade ? (signals as any[]).find((s) => String(s.ticket) === String(openTrade.ticket)) : null;
  const activeTrade = openTrade
    ? {
        direction: String(openTrade.direction),
        entry: Number(openTrade.entry),
        entryTime: openTrade.opened_at ? Date.parse(openTrade.opened_at) : null,
        sl: Number(openTrade.sl ?? openSig?.stop_loss) || null,
        tp: Number(openSig?.take_profits?.[0]) || null,
        tps: (Array.isArray(openSig?.take_profits) ? openSig.take_profits : []).map(Number).filter((x: number) => Number.isFinite(x) && x > 0).slice(0, 1),
      }
    : null;
  const t0 = openTrade ? getLatestTick(hero) : null;
  const floating = openTrade && t0
    ? ((t0.bid + t0.ask) / 2 - Number(openTrade.entry)) * (openTrade.direction === 'long' ? 1 : -1) * (hero === 'XAUUSD' ? 100 : 1) * Number(openTrade.lot ?? 1)
    : null;

  // ===== VERDICTS : chaque nouvelle lecture du desk (post-montage) = carte flash 7 s
  useEffect(() => {
    for (const e of deskItems as any[]) {
      const id = String(e.id);
      if (seenDesk.current.has(id)) continue;
      seenDesk.current.add(id);
      const ms = typeof e.ts === 'string' ? Date.parse(e.ts) : NaN;
      if (!Number.isFinite(ms) || ms < mountedAt.current - 5000 || !e.msg) continue;
      setVerdict({ msg: String(e.msg), sym: String(e?.data?.symbol ?? 'XAUUSD') === 'XAUUSD' ? 'GOLD' : 'BTC' });
      window.setTimeout(() => setVerdict((v) => (v?.msg === String(e.msg) ? null : v)), 7000);
      break;
    }
  }, [deskItems]);

  // ===== clôtures : WIN plein cadre 5 s · SL carte sobre 4 s (honnête, jamais dramatisé)
  useEffect(() => {
    for (const t of trades as any[]) {
      const k = t.ticket != null ? String(t.ticket) : '';
      if (!k || !t.closed_at || t.pnl == null || seenClosed.current.has(k)) continue;
      seenClosed.current.add(k);
      if (Date.parse(t.closed_at) < mountedAt.current - 5000 || rafale.has(k)) continue;
      const pnl = Number(t.pnl);
      setFlash({ kind: pnl > 0 ? 'win' : 'loss', pnl, sym: String(t.symbol) === 'XAUUSD' ? 'GOLD' : 'BTC' });
      window.setTimeout(() => setFlash(null), pnl > 0 ? 5000 : 4000);
      break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades]);

  // wins du jour (≥5$, hors BEAST) — footer + pastilles chart
  const dayStartMs = new Date().setUTCHours(0, 0, 0, 0);
  const wins = (trades as any[]).filter((t) => t.closed_at && Number(t.pnl) >= 5 && !rafale.has(String(t.ticket)) && Date.parse(t.closed_at) >= dayStartMs);
  const winTotal = wins.reduce((a, t) => a + Number(t.pnl), 0);
  const reel = wins.length ? [...wins, ...wins, ...wins] : [];
  const chartSigs = (signals as any[]).filter((s) => s.symbol === hero);
  const winsForChart = wins.filter((t) => t.symbol === hero).slice(0, 24).map((t) => ({ time: Date.parse(t.closed_at), pnl: Number(t.pnl) }));
  const lastRead = (deskItems as any[]).find((e) => e?.msg);
  const state: 'position' | 'scanning' = openTrade ? 'position' : 'scanning';

  return (
    // SCÈNE 9:16 VERROUILLÉE — la page EST le format portrait (bandes noires autour en fenêtre paysage) :
    // capture la fenêtre dans TikTok Studio, cale-la plein cadre, pose ta cam sur la ZONE CAMÉRA du haut. Zéro crop.
    <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', overflow: 'hidden' }}>
    <main style={{ height: 'min(100dvh, 177.78vw)', width: 'min(100vw, 56.25dvh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#070c18' }}>
      <style>{`@keyframes liveScroll { from { transform: translateX(0); } to { transform: translateX(-33.333%); } }
@keyframes popIn { from { opacity: 0; transform: translate(-50%, 14px) scale(.94); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes winZoom { 0% { opacity: 0; transform: scale(.7); } 12% { opacity: 1; transform: scale(1.06); } 20% { transform: scale(1); } 88% { opacity: 1; } 100% { opacity: 0; } }`}</style>

      {/* ===== ZONE HAUTE (~32%) — cam par-dessus en mode normal ; en SOLO (?solo=1, live autonome de nuit)
           c'est le terminal mission control qui défile : l'IA visiblement au travail, ça impressionne ===== */}
      {solo ? (
        <div style={{ flex: '0 0 32%', minHeight: 0, display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: 'rgba(255,107,138,.07)', borderBottom: '1px solid rgba(255,107,138,.25)' }}>
            <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff6b8a' }} />
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: '#ff8aa2' }}>AUTONOMOUS NIGHT SESSION — THE AI RUNS THIS STREAM</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 6 }}>
            <Telemetry state={st} signals={signals} symbol={hero} />
          </div>
        </div>
      ) : (
        <div style={{
          flex: '0 0 32%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
          background: 'radial-gradient(80% 90% at 50% 30%, #0d1a33 0%, #070c18 100%)', borderBottom: '1px solid var(--border)',
        }}>
          <img src="/brand/algoria-mark.png" alt="" width={38} height={38} style={{ objectFit: 'contain', opacity: 0.35 }} />
          <span className="mono" style={{ fontSize: 10, letterSpacing: 2, color: 'rgba(84,104,142,.6)' }}>— YOUR CAMERA HERE —</span>
        </div>
      )}

      {/* ===== BANDEAU CONTEXTE — la réponse à « c'est quoi ce truc ? » en 1 seconde, toujours visible ===== */}
      <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(90deg, rgba(43,227,245,.07), rgba(255,107,138,.05))' }}>
        <AlgoriaOrb size={44} state={state === 'position' ? 'speaking' : 'thinking'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 0.6 }}>
            <span style={{ background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA</span>
            <span style={{ color: 'var(--text)' }}> — THE AI IS TRADING</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, letterSpacing: 1.4, color: '#ff6b8a', fontWeight: 800 }}>
            <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff6b8a' }} /> LIVE · REAL ACCOUNT · NO HUMAN HANDS
          </div>
        </div>
        <HeaderPx sym="XAUUSD" label="GOLD" dp={1} active={hero === 'XAUUSD'} />
        <HeaderPx sym="BTCUSD" label="BTC" dp={0} active={hero === 'BTCUSD'} />
      </header>

      {/* ===== CHART DOMINANT (M1) + overlays d'état ===== */}
      <section style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', padding: '8px 8px 0' }}>
        <Chart key={hero} symbol={hero} signals={chartSigs} activeTrade={activeTrade} wins={winsForChart} defaultTf="M1" />

        {/* HÉROS EN POSITION — le P&L flottant géant qui tique : LE moment hypnotique du live */}
        {openTrade && (
          <div style={{
            position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 20, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', gap: 14, padding: '10px 22px', borderRadius: 14,
            background: 'rgba(7,12,24,.92)', border: `1px solid ${(floating ?? 0) >= 0 ? 'rgba(34,224,166,.55)' : 'rgba(130,152,190,.4)'}`,
            boxShadow: `0 10px 34px rgba(2,6,16,.7), 0 0 26px ${(floating ?? 0) >= 0 ? 'rgba(34,224,166,.2)' : 'rgba(130,152,190,.1)'}`,
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: openTrade.direction === 'long' ? 'var(--up)' : 'var(--down)' }}>
              {openTrade.direction === 'long' ? '▲ LONG' : '▼ SHORT'} {hero === 'XAUUSD' ? 'GOLD' : 'BTC'}
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>in @ {Number(openTrade.entry).toFixed(1)}</span>
            <span className="mono" style={{ fontSize: 26, fontWeight: 800, color: (floating ?? 0) >= 0 ? 'var(--up)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              {floating == null ? '—' : `${floating >= 0 ? '+' : ''}${floating.toFixed(0)}$`}
            </span>
          </div>
        )}

        {/* CARTE VERDICT — la lecture du desk qui vient de tomber (l'IA « parle » même sans trade) */}
        {verdict && !flash && (
          <div style={{
            position: 'absolute', bottom: 18, left: '50%', zIndex: 20, pointerEvents: 'none', animation: 'popIn .35s cubic-bezier(.2,.9,.25,1)',
            transform: 'translateX(-50%)', maxWidth: '92%', padding: '12px 18px', borderRadius: 14,
            background: 'rgba(7,12,24,.94)', border: '1px solid rgba(43,227,245,.5)', boxShadow: '0 10px 34px rgba(2,6,16,.7), 0 0 24px rgba(43,227,245,.15)',
          }}>
            <div style={{ fontSize: 9.5, letterSpacing: 1.6, color: 'var(--cyan)', fontWeight: 800, marginBottom: 3 }}>🧠 ALGORIA JUST ANALYZED · {verdict.sym}</div>
            <div style={{ fontSize: 15, lineHeight: 1.45, color: 'var(--text)', fontWeight: 600 }}>{verdict.msg}</div>
          </div>
        )}

        {/* WIN plein cadre / SL sobre */}
        {flash && flash.kind === 'win' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'radial-gradient(60% 50% at 50% 50%, rgba(34,224,166,.16), rgba(7,12,24,.82))', animation: 'winZoom 5s ease-out forwards', pointerEvents: 'none' }}>
            <div style={{ fontSize: 15, letterSpacing: 2.5, color: 'var(--up)', fontWeight: 800 }}>✓ TRADE CLOSED · {flash.sym}</div>
            <div className="mono goldText" style={{ fontSize: 74, fontWeight: 800, lineHeight: 1 }}>+{flash.pnl.toFixed(0)}$</div>
            <div style={{ fontSize: 13, letterSpacing: 1.2, color: 'var(--muted)' }}>BANKED BY THE AI — MEMBERS GOT IT AUTOMATICALLY</div>
          </div>
        )}
        {flash && flash.kind === 'loss' && (
          <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 20, pointerEvents: 'none', animation: 'popIn .3s ease-out', padding: '10px 18px', borderRadius: 12, background: 'rgba(7,12,24,.94)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>🛡 Risk managed on {flash.sym} — small controlled stop, on to the next.</span>
          </div>
        )}
      </section>

      {/* ===== BARRE CERVEAU — le rythme : décision à chaque clôture M1 + dernière lecture ===== */}
      <section style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '9px 16px', borderTop: '1px solid var(--border)' }}>
        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', width: 74 }}>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: countdown <= 5 ? 'var(--gold)' : 'var(--cyan)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {countdown === 60 ? '✓' : `0:${String(countdown).padStart(2, '0')}`}
          </div>
          <div style={{ fontSize: 7.5, letterSpacing: 1.2, color: 'var(--dim)', marginTop: 2, textAlign: 'center' }}>NEXT AI DECISION</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, letterSpacing: 1.4, color: state === 'position' ? 'var(--up)' : 'var(--cyan)', fontWeight: 800 }}>
            {state === 'position' ? '● MANAGING THE POSITION' : '● SCANNING THE MARKET'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {lastRead ? String(lastRead.msg) : 'warming up — first market read incoming…'}
          </div>
        </div>
        {qr && (
          <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <img src={qr} alt="algoria.tech" width={70} height={70} style={{ borderRadius: 8, border: '2px solid rgba(43,227,245,.4)' }} />
            {/* pas à l'aise avec les QR ? l'adresse en toutes lettres — les deux portes d'entrée à l'écran */}
            <span className="mono" style={{ fontSize: 9, letterSpacing: 0.6, color: 'var(--cyan)', fontWeight: 700 }}>algoria.tech</span>
            <span className="mono" style={{ fontSize: 6.5, letterSpacing: 0.8, color: 'var(--dim)' }}>SCAN OR TYPE IT — FREE</span>
          </div>
        )}
      </section>

      {/* ===== FOOTER — preuve sociale en mouvement + CTA ===== */}
      <footer style={{ flex: 'none', borderTop: '1px solid var(--border)', padding: '8px 0 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ overflow: 'hidden' }}>
          {reel.length ? (
            <div style={{ display: 'flex', gap: 10, animation: `liveScroll ${Math.max(20, reel.length * 2.4)}s linear infinite`, width: 'max-content' }}>
              {reel.map((t: any, i) => (
                <span key={`${t.ticket}-${i}`} className="mono" style={{ whiteSpace: 'nowrap', fontSize: 13, fontWeight: 800, color: 'var(--up)', padding: '5px 13px', borderRadius: 8, border: '1px solid rgba(34,224,166,.35)', background: 'rgba(34,224,166,.06)' }}>
                  ✓ +{Number(t.pnl).toFixed(0)}$ <span style={{ color: 'var(--dim)', fontWeight: 500 }}>{String(t.symbol) === 'XAUUSD' ? 'GOLD' : 'BTC'}</span>
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--dim)', textAlign: 'center' }}>⚡ today&rsquo;s wins parade here as the AI banks them</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <span key={ctaIdx} className="cardIn" style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: 0.4, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '94%', padding: '9px 18px', borderRadius: 999, border: '1px solid rgba(245,194,74,.45)', background: 'linear-gradient(90deg, rgba(245,194,74,.13), rgba(43,227,245,.08))' }}>
            {CTAS[ctaIdx]}
          </span>
          {winTotal > 0 && <span className="mono goldText" style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap' }}>+{winTotal.toFixed(0)}$ today</span>}
        </div>
      </footer>
    </main>
    </div>
  );
}

function HeaderPx({ sym, label, dp, active }: { sym: string; label: string; dp: number; active: boolean }) {
  const px = usePrice(sym);
  return (
    <div style={{ textAlign: 'right', opacity: active ? 1 : 0.55 }}>
      <div style={{ fontSize: 9, letterSpacing: 1.2, color: 'var(--dim)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 17, fontWeight: 800, color: px ? (px.dir >= 0 ? 'var(--up)' : 'var(--down)') : 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
        {px ? px.mid.toFixed(dp) : '—'}
      </div>
    </div>
  );
}
