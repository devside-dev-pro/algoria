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
import { voiceEngine, type VoiceEngine, chime } from '@/lib/cockpit/voice';
import { AlgoriaOrb, type OrbState } from './Orb';

export const getSbToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null;

const EN_NAME: Record<string, string> = { XAUUSD: 'gold', NAS100: 'the Nasdaq', BTCUSD: 'Bitcoin' }; // NAS conservé pour relire les vieux trades
const symName = (s: string) => EN_NAME[s] ?? s;
// « Algoria » n'existe pas dans le vocabulaire du recognizer : il transcrit « Algeria », « Gloria »,
// « algorithm », voire « I'll go yeah » (vu en live !). Détection en 2 étages :
// 1) regex rapide sur les formes propres, 2) MATCHING FLOU (distance d'édition ≤ 2 vs « algoria »
//    sur fenêtres glissantes du texte normalisé qui suit le greeting) → attrape les massacres phonétiques.
const WAKE = /\b(?:hey|hi|ok|okay)[\s,]+(?:al\w*r[iy]a\w*|gloria|glory|aloria|elgoria|algo\w*|allegri\w*)\b/i;
const GREET = /\b(?:hey|hi|ok|okay)\b/i;

function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/** Le texte qui suit le greeting ressemble-t-il (même de loin) à « Algoria » ? */
function likeAlgoria(tail: string): boolean {
  const joined = tail.toLowerCase().replace(/[^a-z]/g, '').slice(0, 14); // "I'll go yeah" → "illgoyeah"
  if (!joined) return false;
  // signatures phonétiques adjacentes : aLG…, LG+voyelle(s)+r/y, GL+voyelle(s)+r (gloria)
  if (/alg|l+g[aeiou]*r|gl[aeiou]*r|l+g[aeiou]*y/.test(joined)) return true;
  // distance d'édition vs "algoria" sur fenêtres glissantes 6-9 lettres
  for (let L = 6; L <= 9; L++) for (let i = 0; i + L <= joined.length; i++) if (lev(joined.slice(i, i + L), 'algoria') <= 2) return true;
  return false;
}

/** Wake word : forme propre (regex) OU greeting suivi d'un massacre phonétique plausible. */
function wakeHeard(text: string): boolean {
  if (WAKE.test(text)) return true;
  const m = text.match(/\b(?:hey|hi|ok|okay)\b([\s\S]{0,26})/i);
  return !!m && likeAlgoria(m[1]);
}

/** Retire « hey <nom massacré> » en tête pour isoler la question (le cerveau ignore le reste de toute façon). */
function stripWake(text: string): string {
  return text
    .replace(/^[\s\S]*?\b(?:hey|hi|ok|okay)\b[\s,]*/i, '')
    .replace(/^(?:al\w*r[iy]a\w*|algeria|gloria|glory|algo\w*|i'?ll go\w*( yeah?)?)[\s,]*/i, '')
    .trim();
}

type Mode = 'idle' | 'listening' | 'thinking';

export function AlgoriaVoice({ deskItems, trades, st, symbol, dayPnl, rafaleTickets, autopilot = false }: {
  deskItems: any[];
  trades: any[];
  st: any;
  symbol: string;
  dayPnl: number | null;
  rafaleTickets: Set<string>;
  autopilot?: boolean; // mode AUTOPILOT : annonces forcées ON, micro coupé (l'opérateur est parti), overlay masqué (la scène prend le relais)
}) {
  const [on, setOn] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [question, setQuestion] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);
  const [heard, setHeard] = useState<string | null>(null); // feedback micro : ce que la reco a VRAIMENT entendu
  const heardTimer = useRef<number | null>(null);

  const engineRef = useRef<VoiceEngine | null>(null);
  const recRef = useRef<any>(null);
  const onRef = useRef(on);
  onRef.current = on;
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const speakingRef = useRef(false);
  const listenTimer = useRef<number | null>(null);
  // dédup annonces + FILTRE TEMPOREL : on n'annonce QUE ce qui survient APRÈS l'ouverture de la page.
  // (le seed seul ne suffisait pas : le desk arrive souvent AVANT la liste des trades → le verrou se fermait
  // sur une liste vide et TOUT le backlog était lu à voix haute au chargement suivant)
  const seenOpen = useRef<Set<string>>(new Set());
  const seenClose = useRef<Set<string>>(new Set());
  const seenNews = useRef<Set<string>>(new Set());
  const mountedAt = useRef(Date.now());

  const apRef = useRef(autopilot);
  apRef.current = autopilot;

  const engine = (): VoiceEngine => {
    if (!engineRef.current) engineRef.current = voiceEngine(getSbToken); // moteur PARTAGÉ (une seule bouche, Autopilot inclus)
    return engineRef.current;
  };
  useEffect(() => {
    return engine().subscribe({
      text: (t) => setSubtitle(t),
      speaking: (s) => {
        speakingRef.current = s;
        setSpeaking(s);
        // micro coupé pendant la parole, relancé après (sinon Algoria s'entend elle-même)
        if (s) stopRec();
        else if (onRef.current && !apRef.current) startRec();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Persistance + démarrage/arrêt =====
  useEffect(() => {
    setOn(localStorage.getItem('algoria.voice') === '1');
  }, []);
  useEffect(() => {
    localStorage.setItem('algoria.voice', on ? '1' : '0');
    // en AUTOPILOT le micro opérateur reste COUPÉ (personne devant l'écran + risque de larsen avec sa propre voix)
    if (on && !autopilot) {
      startRec();
      return () => stopRec();
    }
    stopRec();
    if (!on && !autopilot) engineRef.current?.stop();
    setMode('idle');
    setQuestion(null);
  }, [on, autopilot]); // eslint-disable-line react-hooks/exhaustive-deps

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
    rec.maxAlternatives = 3; // « Algoria » est souvent la 2ᵉ/3ᵉ hypothèse du recognizer
    rec.onresult = (ev: any) => {
      let finalTxt = '';
      let interim = '';
      let anyAlt = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript as string;
        for (let j = 0; j < ev.results[i].length; j++) anyAlt += ' ' + ev.results[i][j].transcript;
        if (ev.results[i].isFinal) finalTxt += ' ' + t;
        else interim += ' ' + t;
      }
      const all = (finalTxt + ' ' + interim).trim();
      void all;
      if (modeRef.current === 'idle') {
        // feedback opérateur : si un greeting est entendu mais que le wake ne matche pas, on AFFICHE
        // ce que la reco a compris → plus jamais de « je parle et rien ne se passe » inexplicable
        if (finalTxt.trim() && GREET.test(finalTxt) && !wakeHeard(anyAlt)) {
          setHeard(finalTxt.trim().slice(0, 60));
          if (heardTimer.current) window.clearTimeout(heardTimer.current);
          heardTimer.current = window.setTimeout(() => setHeard(null), 3500);
        }
        if (wakeHeard(anyAlt)) {
          setHeard(null);
          chime();
          setMode('listening');
          setQuestion(null);
          // question DANS la même phrase (« hey algoria, are you in a position? ») → on la prend direct
          const after = stripWake(finalTxt);
          if (after.length > 8) return void ask(after);
          // sinon : fenêtre de 9 s pour poser la question
          if (listenTimer.current) window.clearTimeout(listenTimer.current);
          listenTimer.current = window.setTimeout(() => {
            if (modeRef.current === 'listening') setMode('idle');
          }, 9000);
        }
      } else if (modeRef.current === 'listening') {
        if (interim.trim()) setQuestion(interim.trim()); // feedback visuel pendant qu'on parle
        const q = stripWake(finalTxt) || finalTxt.trim();
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

  // ===== ÉVEIL MANUEL : un clic sur l'orbe = elle écoute immédiatement (zéro dépendance au wake word).
  // En live c'est LA garantie de fluidité : clic → carillon → question. Interrompt sa phrase en cours.
  function manualWake() {
    engineRef.current?.stop(); // si elle parlait, on l'interrompt (le micro se relance via onSpeaking)
    chime();
    setHeard(null);
    setMode('listening');
    setQuestion(null);
    if (listenTimer.current) window.clearTimeout(listenTimer.current);
    listenTimer.current = window.setTimeout(() => {
      if (modeRef.current === 'listening') setMode('idle');
    }, 9000);
    if (!recRef.current) startRec();
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
        prices: { gold: px('XAUUSD'), bitcoin: px('BTCUSD') },
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
  // Règle simple et infaillible : un événement n'est annoncé que si son horodatage est POSTÉRIEUR à
  // l'ouverture de la page (mountedAt) ET qu'il n'a pas déjà été annoncé (sets de dédup).
  useEffect(() => {
    if (!on && !autopilot) return; // autopilot ⇒ annonces forcées (elle DOIT vivre pendant que l'opérateur est parti)
    const fresh = (iso: unknown) => {
      const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
      return Number.isFinite(ms) && ms > mountedAt.current - 30_000; // petite marge : événement en cours d'écriture au mount
    };
    for (const t of trades as any[]) {
      const k = t.ticket != null ? String(t.ticket) : '';
      if (!k || rafaleTickets.has(k)) continue;
      if (!t.closed_at && !seenOpen.current.has(k)) {
        seenOpen.current.add(k);
        if (fresh(t.opened_at)) {
          const swing = String(t.signal_ref ?? '').includes('-swing-');
          engine().speak(`${swing ? 'Swing position' : 'Position'} opened. ${t.direction === 'long' ? 'Long' : 'Short'} on ${symName(String(t.symbol))} at ${Math.round(Number(t.entry))} dollars.`);
        }
      }
      if (t.closed_at && !seenClose.current.has(k)) {
        seenClose.current.add(k);
        if (fresh(t.closed_at)) {
          const pnl = Math.round(Number(t.pnl ?? 0));
          engine().speak(pnl >= 0
            ? `Trade closed on ${symName(String(t.symbol))}. Plus ${pnl} dollars.`
            : `Trade closed on ${symName(String(t.symbol))}, minus ${Math.abs(pnl)} dollars. On to the next one.`);
        }
      }
    }
    for (const e of deskItems as any[]) {
      if (e?.data?.kind !== 'news' || seenNews.current.has(String(e.id))) continue;
      seenNews.current.add(String(e.id));
      if (!fresh(e.ts)) continue;
      const m = Number(e.data.minutes ?? 0);
      engine().speak(`Heads up. ${String(e.data.title ?? 'High-impact economic release')} in ${m || 'a few'} minutes. High impact — I'm standing aside until it settles.`);
    }
  }, [trades, deskItems, on, autopilot]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = mode !== 'idle' || speaking;
  const orbState: OrbState = speaking ? 'speaking' : mode === 'thinking' ? 'thinking' : mode === 'listening' ? 'listening' : 'idle';
  return (
    <>
      {/* ===== L'ORBE permanent (header) — le cerveau d'Algoria, en vie tout le temps. C'est aussi le bouton.
           Un clic = ON/OFF, point. (l'éveil manuel a son propre petit bouton ASK juste à côté : avant, le clic
           déclenchait l'écoute et il devenait IMPOSSIBLE d'éteindre la voix — vécu en live) ===== */}
      <button
        onClick={() => setOn((v) => !v)}
        title={supported
          ? on
            ? 'ALGORIA is live — click to turn her off. Say “Hey Algoria …” (or hit ASK) to talk to her.'
            : 'Wake ALGORIA — she announces trades & news out loud and answers to “Hey Algoria …” (mic required)'
          : 'Voice announcements only — the wake word needs Chrome (speech recognition unavailable here)'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '2px 12px 2px 4px', borderRadius: 999, cursor: 'pointer',
          fontSize: 10.5, fontWeight: on ? 700 : 500, letterSpacing: 0.6,
          border: `1px solid ${on ? (speaking ? 'rgba(245,194,74,.5)' : 'rgba(43,227,245,.5)') : 'var(--border)'}`,
          background: on ? 'rgba(43,227,245,.07)' : 'transparent',
          color: on ? (speaking ? 'var(--gold)' : 'var(--cyan)') : 'var(--muted)',
        }}
      >
        <AlgoriaOrb size={30} state={on ? orbState : 'idle'} dim={!on} />
        {on ? 'VOICE ON' : 'Voice'}
      </button>

      {/* ===== ASK — l'éveil manuel : elle écoute IMMÉDIATEMENT, zéro dépendance au wake word (fluidité en live) ===== */}
      {on && !autopilot && supported && (
        <button
          onClick={manualWake}
          title="make ALGORIA listen right now — no wake word needed (interrupts her if she's talking)"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
            fontSize: 10, fontWeight: 600, letterSpacing: 0.8,
            border: `1px solid ${mode === 'listening' ? 'rgba(43,227,245,.6)' : 'var(--border)'}`,
            background: mode === 'listening' ? 'rgba(43,227,245,.12)' : 'transparent',
            color: mode === 'listening' ? 'var(--cyan)' : 'var(--muted)',
          }}
        >
          🎙 ASK
        </button>
      )}

      {/* ===== Feedback micro : ce que la reco a entendu quand le wake word n'a PAS matché ===== */}
      {on && heard && !active && !autopilot && (
        <div className="cardIn" style={{
          position: 'fixed', left: '50%', bottom: 96, transform: 'translateX(-50%)', zIndex: 59, pointerEvents: 'none',
          fontSize: 11, color: 'var(--muted)', background: 'rgba(7,12,24,.88)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '5px 12px', maxWidth: 520, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          heard “{heard}” — say <b style={{ color: 'var(--cyan)' }}>Hey Algoria…</b>
        </div>
      )}

      {/* ===== L'ÉVEIL — « Hey Algoria » : le grand orbe surgit au centre, façon Siri, sous-titres pour le stream ===== */}
      {on && active && !autopilot && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 96, transform: 'translateX(-50%)', zIndex: 60,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          maxWidth: 760, width: 'max-content', pointerEvents: 'none',
        }}>
          <div className="cardIn" style={{ filter: 'drop-shadow(0 0 34px rgba(43,227,245,.22))' }}>
            <AlgoriaOrb size={150} state={orbState} />
          </div>
          <div className="cardIn" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 22px', borderRadius: 14,
            maxWidth: 720, textAlign: 'center', marginTop: -14,
            background: 'linear-gradient(180deg, rgba(14,23,44,.96) 0%, rgba(7,12,24,.96) 100%)',
            border: `1px solid ${speaking ? 'rgba(245,194,74,.5)' : 'rgba(43,227,245,.45)'}`,
            boxShadow: `0 12px 40px rgba(2,6,16,.6), 0 0 24px ${speaking ? 'rgba(245,194,74,.16)' : 'rgba(43,227,245,.13)'}`,
          }}>
            <div style={{ fontSize: 9, letterSpacing: 1.6, color: speaking ? 'var(--gold)' : 'var(--cyan)' }}>
              {speaking ? '◆ ALGORIA' : mode === 'thinking' ? '◆ ALGORIA IS THINKING…' : '● ALGORIA IS LISTENING'}
            </div>
            <div style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--text)' }}>
              {speaking ? subtitle : question ? `“${question}”` : 'ask your question…'}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
