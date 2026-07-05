'use client';
// ALGORIA COMES ALIVE — the cockpit's voice, built for the live stream (English — the audience's language):
// 1) AUTO ANNOUNCEMENTS: trade opens/closes (excl. BEAST), eco news alerts T-30/T-5.
// 2) "HEY ALGORIA": wake word caught on the mic (browser en-US speech recognition) → chime →
//    the question goes to /api/voice/ask with the live context → Algoria answers OUT LOUD,
//    gold subtitles on screen (viewers read AND hear her).
// The mic is MUTED while she speaks (she'd hear herself), then restarted automatically.
// Chrome desktop required for the wake word (webkitSpeechRecognition) — that's the stream browser anyway.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getLatestTick } from '@/lib/cockpit/tickStore';
import { VoiceEngine, chime } from '@/lib/cockpit/voice';

const EN_NAME: Record<string, string> = { XAUUSD: 'gold', NAS100: 'the Nasdaq', BTCUSD: 'Bitcoin' };
const symName = (s: string) => EN_NAME[s] ?? s;
const WAKE = /\b(?:hey|hi|ok|okay)[\s,]+al[gq]o?u?ria\b/i;

type Mode = 'idle' | 'listening' | 'thinking';

export function AlgoriaVoice({ deskItems, trades, st, symbol, dayPnl, rafaleTickets }: {
  deskItems: any[];
  trades: any[];
  st: any;
  symbol: string;
  dayPnl: number | null;
  rafaleTickets: Set<string>;
}) {
  const [on, setOn] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [question, setQuestion] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);

  const engineRef = useRef<VoiceEngine | null>(null);
  const recRef = useRef<any>(null);
  const onRef = useRef(on);
  onRef.current = on;
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const speakingRef = useRef(false);
  const listenTimer = useRef<number | null>(null);
  // dédup annonces (seed au 1er lot non vide → pas de lecture du backlog au chargement)
  const seenOpen = useRef<Set<string>>(new Set());
  const seenClose = useRef<Set<string>>(new Set());
  const seenNews = useRef<Set<string>>(new Set());
  const seeded = useRef(false);

  const engine = () => {
    if (!engineRef.current) {
      const e = new VoiceEngine(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null);
      e.onText = (t) => setSubtitle(t);
      e.onSpeaking = (s) => {
        speakingRef.current = s;
        setSpeaking(s);
        // micro coupé pendant la parole, relancé après (sinon Algoria s'entend elle-même)
        if (s) stopRec();
        else if (onRef.current) startRec();
      };
      engineRef.current = e;
    }
    return engineRef.current;
  };

  // ===== Persistance + démarrage/arrêt =====
  useEffect(() => {
    setOn(localStorage.getItem('algoria.voice') === '1');
  }, []);
  useEffect(() => {
    localStorage.setItem('algoria.voice', on ? '1' : '0');
    if (on) {
      startRec();
      return () => stopRec();
    }
    stopRec();
    engineRef.current?.stop();
    setMode('idle');
    setQuestion(null);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== Reconnaissance vocale — mot d'éveil + capture de la question =====
  function stopRec() {
    try {
      recRef.current?.stop();
    } catch { /* déjà arrêté */ }
    recRef.current = null;
  }

  function startRec() {
    if (recRef.current || !onRef.current || speakingRef.current) return;
    const SR = (window as any).webkitSpeechRecognition ?? (window as any).SpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev: any) => {
      let finalTxt = '';
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript as string;
        if (ev.results[i].isFinal) finalTxt += ' ' + t;
        else interim += ' ' + t;
      }
      const all = (finalTxt + ' ' + interim).trim();
      if (modeRef.current === 'idle') {
        if (WAKE.test(all)) {
          chime();
          setMode('listening');
          setQuestion(null);
          // if the question is IN the same sentence ("hey algoria, are you in a position?") → take it directly
          const after = finalTxt.split(WAKE).pop()?.trim() ?? '';
          if (after.length > 6) return void ask(after);
          // otherwise: 9s window to ask the question
          if (listenTimer.current) window.clearTimeout(listenTimer.current);
          listenTimer.current = window.setTimeout(() => {
            if (modeRef.current === 'listening') setMode('idle');
          }, 9000);
        }
      } else if (modeRef.current === 'listening') {
        if (interim.trim()) setQuestion(interim.trim()); // feedback visuel pendant qu'on parle
        const q = finalTxt.replace(WAKE, '').trim();
        if (q.length > 2) {
          if (listenTimer.current) window.clearTimeout(listenTimer.current);
          void ask(q);
        }
      }
    };
    rec.onend = () => {
      recRef.current = null;
      // relance auto (le navigateur coupe la reco régulièrement) — sauf si OFF ou en train de parler
      if (onRef.current && !speakingRef.current) window.setTimeout(() => startRec(), 400);
    };
    rec.onerror = () => { /* onend suit toujours → relance gérée là-bas */ };
    try {
      rec.start();
      recRef.current = rec;
    } catch { /* start() double → ignoré */ }
  }

  // ===== La question part au cerveau avec le contexte live =====
  async function ask(q: string) {
    setQuestion(q);
    setMode('thinking');
    stopRec(); // silence radio pendant la réflexion
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const px = (s: string) => {
        const t = getLatestTick(s);
        return t ? +((t.bid + t.ask) / 2).toFixed(1) : null;
      };
      const context = {
        utc_time: new Date().toISOString().slice(0, 16).replace('T', ' '),
        displayed_market: symName(symbol),
        prices: { gold: px('XAUUSD'), nasdaq: px('NAS100'), bitcoin: px('BTCUSD') },
        account: { balance: st?.balance ?? null, equity: st?.equity ?? null, day_pnl: dayPnl, open_positions: st?.open_positions ?? 0 },
        session: st?.session ?? null,
        regime: st?.regime ?? null,
        latest_desk_reads: (deskItems as any[]).slice(0, 3).map((e) => ({ market: symName(String(e?.data?.symbol ?? 'XAUUSD')), read: e?.msg })),
        recent_trades: (trades as any[])
          .filter((t) => t.closed_at && t.pnl != null && !rafaleTickets.has(String(t.ticket)))
          .slice(0, 5)
          .map((t) => ({ market: symName(String(t.symbol)), side: t.direction, result_dollars: Math.round(Number(t.pnl)) })),
      };
      const res = await fetch('/api/voice/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ question: q, context }),
      });
      if (res.status === 501) engine().speak("My voice brain isn't wired up on the server yet. Add the API key and ask me again.");
      else if (!res.ok) engine().speak("Small glitch reaching my brain. Ask me again in a moment.");
      else {
        const { text } = await res.json();
        engine().speak(String(text ?? ''));
      }
    } catch {
      engine().speak("I couldn't think that one through — try again.");
    } finally {
      setMode('idle');
      if (onRef.current && !speakingRef.current) startRec();
    }
  }

  // ===== Annonces AUTO : trades ouverts/clôturés (hors BEAST) + alertes éco =====
  useEffect(() => {
    if (!seeded.current) {
      if (trades.length || deskItems.length) {
        for (const t of trades as any[]) {
          if (t.ticket != null && !t.closed_at) seenOpen.current.add(String(t.ticket));
          if (t.ticket != null && t.closed_at) seenClose.current.add(String(t.ticket));
        }
        for (const e of deskItems as any[]) if (e?.data?.kind === 'news') seenNews.current.add(String(e.id));
        seeded.current = true;
      }
      return;
    }
    if (!on) return;
    for (const t of trades as any[]) {
      const k = t.ticket != null ? String(t.ticket) : '';
      if (!k || rafaleTickets.has(k)) continue;
      if (!t.closed_at && !seenOpen.current.has(k)) {
        seenOpen.current.add(k);
        const swing = String(t.signal_ref ?? '').includes('-swing-');
        engine().speak(`${swing ? 'Swing position' : 'Position'} opened. ${t.direction === 'long' ? 'Long' : 'Short'} on ${symName(String(t.symbol))} at ${Math.round(Number(t.entry))} dollars.`);
      }
      if (t.closed_at && !seenClose.current.has(k)) {
        seenClose.current.add(k);
        const pnl = Math.round(Number(t.pnl ?? 0));
        engine().speak(pnl >= 0
          ? `Trade closed on ${symName(String(t.symbol))}. Plus ${pnl} dollars.`
          : `Trade closed on ${symName(String(t.symbol))}, minus ${Math.abs(pnl)} dollars. On to the next one.`);
      }
    }
    for (const e of deskItems as any[]) {
      if (e?.data?.kind !== 'news' || seenNews.current.has(String(e.id))) continue;
      seenNews.current.add(String(e.id));
      const m = Number(e.data.minutes ?? 0);
      engine().speak(`Heads up. ${String(e.data.title ?? 'High-impact economic release')} in ${m || 'a few'} minutes. High impact — I'm standing aside until it settles.`);
    }
  }, [trades, deskItems, on]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = mode !== 'idle' || speaking;
  return (
    <>
      {/* ===== Bouton header ===== */}
      <button
        onClick={() => setOn((v) => !v)}
        title={supported
          ? 'ALGORIA VOICE — she announces trades & news out loud, and answers to “Hey Algoria …” (mic required)'
          : 'Voice announcements ON — wake word needs Chrome (speech recognition unavailable here)'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
          fontSize: 11, fontWeight: on ? 700 : 500, letterSpacing: 0.4,
          border: `1px solid ${on ? 'rgba(43,227,245,.55)' : 'var(--border)'}`,
          background: on ? 'rgba(43,227,245,.1)' : 'transparent',
          color: on ? 'var(--cyan)' : 'var(--muted)',
        }}
      >
        {on && <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: speaking ? 'var(--gold)' : 'var(--cyan)' }} />}
        🎙 {on ? 'VOICE ON' : 'Voice'}
      </button>

      {/* ===== Overlay stream : écoute / réflexion / sous-titres ===== */}
      {on && active && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 110, transform: 'translateX(-50%)', zIndex: 60,
          maxWidth: 720, width: 'max-content', pointerEvents: 'none',
        }}>
          <div className="cardIn" style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderRadius: 14,
            background: 'linear-gradient(180deg, rgba(16,26,48,.97) 0%, rgba(8,14,28,.97) 100%)',
            border: `1px solid ${speaking ? 'rgba(245,194,74,.55)' : 'rgba(43,227,245,.5)'}`,
            boxShadow: `0 12px 40px rgba(2,6,16,.6), 0 0 24px ${speaking ? 'rgba(245,194,74,.18)' : 'rgba(43,227,245,.15)'}`,
          }}>
            {/* équaliseur — Algoria « vit » quand elle parle/écoute */}
            <span aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: 2.5, height: 18 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} style={{
                  width: 3, borderRadius: 2,
                  background: speaking ? 'var(--gold)' : 'var(--cyan)',
                  animation: `algoriaEq .9s ease-in-out ${i * 0.12}s infinite alternate`,
                }} />
              ))}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9, letterSpacing: 1.4, color: speaking ? 'var(--gold)' : 'var(--cyan)', marginBottom: 3 }}>
                {speaking ? '◆ ALGORIA' : mode === 'thinking' ? '◆ ALGORIA IS THINKING…' : '🎙 ALGORIA IS LISTENING — ask your question'}
              </div>
              <div style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--text)' }}>
                {speaking ? subtitle : question ? `“${question}”` : '…'}
              </div>
            </div>
          </div>
          <style>{`@keyframes algoriaEq { from { height: 4px; opacity: .55 } to { height: 18px; opacity: 1 } }`}</style>
        </div>
      )}
    </>
  );
}
