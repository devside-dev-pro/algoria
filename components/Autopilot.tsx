'use client';
// MODE AUTOPILOT — Algoria tient le live TOUTE SEULE pendant que l'opérateur est parti :
//   · le cockpit RESTE INTÉGRALEMENT VISIBLE (chart, stats, desk, trades — rien ne bouge) ; l'autopilot
//     n'ajoute QUE des calques flottants : orbe + sous-titres au centre-bas (même emplacement que l'overlay
//     Voice, masqué dans ce mode), fil du chat en bas à gauche, bannière d'acquisition tournante en bas à droite
//   · elle LIT le chat TikTok (pont runner → live_comments) et RÉPOND à voix haute — persona « viewer »
//     durci côté serveur : les commentaires sont des DONNÉES, jamais des ordres (aucun trade possible)
//   · silences meublés : sans question depuis ~2 min, elle narre sa lecture du marché (cartes du desk)
//   · le trading, lui, est déjà autonome (runner) — les annonces de trades continuent via AlgoriaVoice
// Cadence maîtrisée : 1 réponse / ~25 s max, file vocale partagée (une seule bouche), anti-backlog au montage.
import { useEffect, useRef, useState } from 'react';
import { voiceEngine } from '@/lib/cockpit/voice';
import { getSbToken } from './Voice';
import { useLiveComments, sendCommand } from '@/lib/cockpit/useRealtime';
import { getLatestTick } from '@/lib/cockpit/tickStore';
import { AlgoriaOrb, type OrbState } from './Orb';

const NAME: Record<string, string> = { XAUUSD: 'gold', NAS100: 'the Nasdaq', BTCUSD: 'Bitcoin' }; // NAS conservé pour relire les vieux events
const ANSWER_GAP_MS = 25_000; // au max ~2 réponses/min — elle respire, elle ne mitraille pas
const FILLER_GAP_MS = 110_000; // silence > ~2 min → elle meuble avec sa lecture du marché
const BLOCKED = /(fuck|shit|bitch|nigg|fag|nazi|hitler|porn|sex|dick|cunt|whore|slut|retard|kys|kill yourself)/i; // jamais lu à l'antenne

const CTAS = [
  '🤖 Fully autonomous — my human stepped away, I run this stream myself',
  '💬 Ask me anything in chat — I answer out loud',
  '📈 Every trade on screen is mine, executed live on a real account',
  '🚀 Want my trades in your pocket? Free Telegram — link in bio',
];

export function Autopilot({ st, deskItems, dayPnl }: { st: any; deskItems: any[]; dayPnl: number | null }) {
  const comments = useLiveComments(40, true);
  const [answering, setAnswering] = useState<{ user: string; text: string } | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [ctaIdx, setCtaIdx] = useState(0);
  const seen = useRef<Set<string>>(new Set());
  const mountedAt = useRef(Date.now()); // filtre temporel anti-backlog : on ne répond qu'aux commentaires POST-montage
  const busy = useRef(false);
  const lastAnswerAt = useRef(0);
  const lastSpokeAt = useRef(Date.now());
  const lastByUser = useRef<Map<string, number>>(new Map());
  const fillerCount = useRef(0);
  const deskRef = useRef(deskItems);
  deskRef.current = deskItems;
  const stRef = useRef(st);
  stRef.current = st;
  const dayPnlRef = useRef(dayPnl);
  dayPnlRef.current = dayPnl;

  const engine = () => voiceEngine(getSbToken);

  // ── branchements : voix partagée, pont TikTok runner, garde d'écran, greeting
  useEffect(() => engine().subscribe({
    text: setSubtitle,
    speaking: (s) => {
      setSpeaking(s);
      if (s) lastSpokeAt.current = Date.now();
    },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void sendCommand('autopilot', { on: true }); // le runner branche le chat TikTok
    let lock: { release?: () => Promise<void> } | null = null;
    void (navigator as any).wakeLock?.request?.('screen').then((l: any) => (lock = l)).catch(() => {});
    const t = window.setTimeout(() => {
      engine().speak("Autopilot engaged. My human stepped away, so it's just you and me now. I'm trading gold and Bitcoin live — drop your questions in the chat and I'll answer out loud.");
    }, 1500);
    return () => {
      window.clearTimeout(t);
      void sendCommand('autopilot', { on: false });
      void lock?.release?.();
      engine().stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── sélection des commentaires : 1 réponse / 25 s max, jamais le backlog (filtre temporel)
  useEffect(() => {
    void maybeAnswer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments]);

  function eligible(c: any): boolean {
    const text = String(c.text ?? '').trim();
    const user = String(c.username ?? '');
    const ts = typeof c.ts === 'string' ? Date.parse(c.ts) : NaN;
    if (!Number.isFinite(ts) || ts < mountedAt.current - 15_000) return false; // backlog → jamais lu
    if (text.length < 3 || text.length > 180) return false;
    if (BLOCKED.test(text) || BLOCKED.test(user)) return false;
    const lastU = lastByUser.current.get(user) ?? 0;
    return Date.now() - lastU > 90_000; // pas deux réponses au même viewer en 90 s (anti-monopole)
  }

  async function maybeAnswer() {
    if (busy.current || Date.now() - lastAnswerAt.current < ANSWER_GAP_MS) return;
    const fresh = (comments as any[]).filter((c) => !seen.current.has(String(c.id)));
    if (!fresh.length) return;
    for (const c of fresh) seen.current.add(String(c.id)); // considérés une seule fois — le flux ne s'accumule pas
    const pool = fresh.filter(eligible).reverse(); // les plus récents d'abord
    const pick = pool.find((c) => String(c.text).includes('?')) ?? pool[0]; // priorité aux vraies questions
    if (!pick) return;
    await answer(String(pick.username ?? 'viewer'), String(pick.text));
  }

  async function answer(user: string, text: string) {
    busy.current = true;
    lastAnswerAt.current = Date.now();
    lastByUser.current.set(user, Date.now());
    setAnswering({ user, text });
    setThinking(true);
    try {
      const token = await getSbToken();
      const res = await fetch('/api/voice/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ question: text, viewer: user, mode: 'viewer', context: buildContext() }),
      });
      if (res.ok) {
        const { text: out } = await res.json();
        engine().speak(String(out ?? ''));
      }
    } catch {
      /* une réponse ratée n'arrête pas le live */
    } finally {
      setThinking(false);
      busy.current = false;
      window.setTimeout(() => setAnswering(null), 12_000);
    }
  }

  function buildContext() {
    const px = (s: string) => {
      const t = getLatestTick(s);
      return t ? +((t.bid + t.ask) / 2).toFixed(1) : null;
    };
    return {
      utc_time: new Date().toISOString().slice(0, 16).replace('T', ' '),
      prices: { gold: px('XAUUSD'), bitcoin: px('BTCUSD') },
      account: {
        balance: stRef.current?.balance ?? null,
        equity: stRef.current?.equity ?? null,
        day_pnl: dayPnlRef.current,
        open_positions: stRef.current?.open_positions ?? 0,
        // + = profit latent · − = drawdown : elle assume ses positions rouges au lieu de dire qu'elle est flat
        floating_pnl_dollars: stRef.current?.equity != null && stRef.current?.balance != null ? Math.round(Number(stRef.current.equity) - Number(stRef.current.balance)) : null,
      },
      latest_desk_reads: (deskRef.current as any[]).slice(0, 3).map((e) => ({ market: NAME[String(e?.data?.symbol ?? 'XAUUSD')] ?? 'gold', read: e?.msg })),
    };
  }

  // ── meubler les silences : lecture du marché (desk) + invitation occasionnelle
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (busy.current || speaking || Date.now() - lastSpokeAt.current < FILLER_GAP_MS) return;
      lastSpokeAt.current = Date.now();
      fillerCount.current++;
      if (fillerCount.current % 3 === 0) {
        engine().speak('Quick reminder — I answer every question in chat out loud, and my trade alerts are free on the Telegram, link in bio.');
        return;
      }
      const hero = (deskRef.current as any[]).find((e) => e?.msg);
      if (hero) engine().speak(`Here's my current read on ${NAME[String(hero?.data?.symbol ?? 'XAUUSD')] ?? 'gold'}: ${String(hero.msg)}`);
    }, 20_000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaking]);

  // ── bannière CTA tournante
  useEffect(() => {
    const iv = window.setInterval(() => setCtaIdx((i) => (i + 1) % CTAS.length), 9000);
    return () => window.clearInterval(iv);
  }, []);

  const orbState: OrbState = speaking ? 'speaking' : thinking ? 'thinking' : 'idle';
  const recent = (comments as any[]).slice(-5);

  return (
    <>
      {/* ===== présence centre-bas : orbe + statut + sous-titres — le cockpit reste visible derrière ===== */}
      <div style={{
        position: 'fixed', left: '50%', bottom: 96, transform: 'translateX(-50%)', zIndex: 60,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        maxWidth: 760, width: 'max-content', pointerEvents: 'none',
      }}>
        <div className="cardIn" style={{ filter: 'drop-shadow(0 0 34px rgba(43,227,245,.22))' }}>
          <AlgoriaOrb size={120} state={orbState} />
        </div>
        <div className="cardIn" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '9px 20px', borderRadius: 14,
          maxWidth: 700, textAlign: 'center', marginTop: -12,
          background: 'linear-gradient(180deg, rgba(14,23,44,.96) 0%, rgba(7,12,24,.96) 100%)',
          border: `1px solid ${speaking ? 'rgba(245,194,74,.5)' : 'rgba(255,107,138,.45)'}`,
          boxShadow: `0 12px 40px rgba(2,6,16,.6), 0 0 24px ${speaking ? 'rgba(245,194,74,.16)' : 'rgba(255,107,138,.12)'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, letterSpacing: 1.6, color: speaking ? 'var(--gold)' : '#ff8aa2', fontWeight: 700 }}>
            <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: speaking ? 'var(--gold)' : '#ff6b8a' }} />
            {speaking ? 'ALGORIA' : thinking ? 'AUTOPILOT — THINKING…' : 'AUTOPILOT — LISTENING TO CHAT'}
          </div>
          {answering && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', maxWidth: 640, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <b style={{ color: 'var(--cyan)' }}>@{answering.user}</b> — “{answering.text.slice(0, 110)}”
            </div>
          )}
          {subtitle && <div style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--text)' }}>{subtitle}</div>}
        </div>
      </div>

      {/* ===== fil du chat TikTok — coin bas-gauche, discret (les viewers voient leurs messages arriver) ===== */}
      <div style={{
        position: 'fixed', left: 14, bottom: 96, zIndex: 55, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 320, padding: '8px 12px', borderRadius: 12,
        background: 'rgba(7,12,24,.84)', border: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 8.5, letterSpacing: 1.6, color: 'var(--dim)', fontWeight: 700 }}>LIVE CHAT</div>
        {recent.map((c: any) => (
          <div key={String(c.id)} style={{ fontSize: 11, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span style={{ color: 'rgba(43,227,245,.75)' }}>@{String(c.username)}</span> {String(c.text)}
          </div>
        ))}
        {!recent.length && <div style={{ fontSize: 11, color: 'var(--dim)' }}>waiting for the chat…</div>}
      </div>

      {/* ===== bannière CTA tournante — coin bas-droit ===== */}
      <div key={ctaIdx} className="cardIn" style={{
        position: 'fixed', right: 14, bottom: 96, zIndex: 55, pointerEvents: 'none',
        fontSize: 12, fontWeight: 600, letterSpacing: 0.3, color: 'var(--text)', whiteSpace: 'nowrap',
        padding: '8px 16px', borderRadius: 999, border: '1px solid rgba(245,194,74,.4)',
        background: 'linear-gradient(90deg, rgba(245,194,74,.12), rgba(43,227,245,.09))',
      }}>
        {CTAS[ctaIdx]}
      </div>
    </>
  );
}
