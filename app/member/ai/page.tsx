'use client';
// ALGORIA AI — le CŒUR de l'app, derrière le bouton central (30/09/2026).
//
// Historique : le bouton central ouvrait le Desk d'analystes IA, retiré le 29/09 (coût Anthropic quotidien,
// un « HOLD » tous les jours). Mathieu : « retire pas le bouton central, c'est le cœur de l'app — une orbe
// vivante qui incarnerait Algoria AI, avec un agent à qui on peut parler, ou un graphique comme avant ».
// Il a aussi posé la limite : « il va falloir que je la forme bien pour qu'elle dise pas de bêtises ».
//
// D'où cette V1, SANS IA LIBRE :
//   · l'orbe vivante (canvas, respire, s'emballe quand elle « répond ») ;
//   · la vraie courbe du compte copié depuis juillet (/api/public/track), en FORME seulement — aucun
//     montant, aucun % : les chiffres vivent dans le track record, à un tap ;
//   · « Ask Algoria AI » : des questions prêtes dont les réponses sont les leçons VALIDÉES de l'Academy
//     (lib/member/academy.ts). Zéro génération, donc zéro bêtise possible. Le reste → Mathieu.
// Page publique comme l'Academy (données publiques uniquement).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ACADEMY, type Lesson } from '@/lib/member/academy';

interface TrackDay { d: string; u: number; n: number }
interface Ask { q: string; module: string; lesson: string }

// Chaque question pointe une leçon de l'Academy : une seule source de vérité, relue par Mathieu.
const ASKS: Ask[] = [
  { q: 'Why no trade right now ?', module: 'basics', lesson: 'quiet' },
  { q: 'Is my money safe ?', module: 'basics', lesson: 'copy' },
  { q: 'Is it a martingale ?', module: 'basics', lesson: 'lot' },
  { q: 'What if a trade goes wrong ?', module: 'basics', lesson: 'sl' },
  { q: 'How much should I deposit ?', module: 'faq', lesson: 'deposit' },
  { q: 'When can I withdraw ?', module: 'faq', lesson: 'withdraw' },
  { q: 'Which broker should I pick ?', module: 'faq', lesson: 'broker' },
  { q: 'How does the referral work ?', module: 'referral', lesson: 'ref-how' },
];
const lessonOf = (a: Ask): Lesson | undefined => ACADEMY.find((m) => m.key === a.module)?.lessons.find((l) => l.id === a.lesson);
const nb = (s: string) => s.replace(/ ([?!])/g, ' $1');
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1');

function Rich({ text }: { text: string }) {
  return <>{nb(text).split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <b key={i} style={{ color: 'var(--text)', fontWeight: 700 }}>{p}</b> : <Fragment key={i}>{p}</Fragment>))}</>;
}

/** L'orbe : sphère de plasma dessinée au canvas. `energy` 0 → repos, 1 → elle répond. */
function Orb({ energy, onTap }: { energy: number; onTap: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const energyRef = useRef(energy);
  energyRef.current = energy;
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const g = cv.getContext('2d'); if (!g) return;
    const S = 240, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = S * dpr; cv.height = S * dpr; g.scale(dpr, dpr);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, t = 0, e = 0, last = performance.now();
    const blobs = [
      { c: '43,227,245', r: 62, sp: .7, ph: 0, orb: 26 },
      { c: '46,139,240', r: 70, sp: -.5, ph: 2, orb: 30 },
      { c: '245,194,74', r: 38, sp: 1.1, ph: 4, orb: 34 },
      { c: '30,64,229', r: 80, sp: .35, ph: 1, orb: 18 },
    ];
    const draw = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      e += (energyRef.current - e) * Math.min(1, dt * 3);
      t += dt * (1 + e * 2.2);
      const cx = S / 2, cy = S / 2, R = 78 + Math.sin(t * 1.3) * 3 + e * 6;
      g.clearRect(0, 0, S, S);
      // halo
      const halo = g.createRadialGradient(cx, cy, R * .6, cx, cy, R * 1.55);
      halo.addColorStop(0, `rgba(43,227,245,${.28 + e * .25})`); halo.addColorStop(1, 'rgba(43,227,245,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, R * 1.55, 0, Math.PI * 2); g.fill();
      // corps
      g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
      const body = g.createRadialGradient(cx - R * .3, cy - R * .35, R * .1, cx, cy, R);
      body.addColorStop(0, '#12306b'); body.addColorStop(1, '#050b1a');
      g.fillStyle = body; g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'lighter';
      for (const b of blobs) {
        const a = t * b.sp + b.ph;
        const x = cx + Math.cos(a) * b.orb, y = cy + Math.sin(a * 1.3) * b.orb;
        const gr = g.createRadialGradient(x, y, 0, x, y, b.r * (1 + e * .25));
        gr.addColorStop(0, `rgba(${b.c},${.55 + e * .3})`); gr.addColorStop(1, `rgba(${b.c},0)`);
        g.fillStyle = gr; g.fillRect(0, 0, S, S);
      }
      g.globalCompositeOperation = 'source-over';
      // reflet
      const hl = g.createRadialGradient(cx - R * .38, cy - R * .45, 0, cx - R * .38, cy - R * .45, R * .55);
      hl.addColorStop(0, 'rgba(255,255,255,.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hl; g.fillRect(0, 0, S, S);
      g.restore();
      // anneaux
      g.lineWidth = 1.5;
      for (let i = 0; i < 2; i++) {
        g.save(); g.translate(cx, cy); g.rotate(t * (i ? -.4 : .3) + i);
        g.strokeStyle = i ? `rgba(245,194,74,${.45 + e * .3})` : `rgba(43,227,245,${.55 + e * .3})`;
        g.beginPath(); g.ellipse(0, 0, R * (1.22 + i * .12), R * (.34 + Math.sin(t * .8 + i) * .08), 0, 0, Math.PI * 2); g.stroke();
        g.restore();
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <button onClick={onTap} aria-label="Algoria AI" style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'block', margin: '0 auto' }}>
      <canvas ref={ref} style={{ width: 240, height: 240, display: 'block' }} />
    </button>
  );
}

/** La forme de la courbe réelle depuis juillet — cumul ramené à 1 lot, aucun chiffre affiché. */
function Curve({ days }: { days: TrackDay[] }) {
  const W = 320, H = 90;
  const pts = useMemo(() => {
    let c = 0; const ys = days.map((d) => (c += d.u));
    const min = Math.min(0, ...ys), max = Math.max(...ys, min + 1e-6);
    return ys.map((y, i) => [(i / Math.max(1, ys.length - 1)) * W, H - 6 - ((y - min) / (max - min)) * (H - 12)] as const);
  }, [days]);
  if (pts.length < 2) return null;
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 90, display: 'block' }} aria-hidden>
      <defs>
        <linearGradient id="aiFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgba(43,227,245,.28)" /><stop offset="1" stopColor="rgba(43,227,245,0)" /></linearGradient>
        <linearGradient id="aiLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#2e8bf0" /><stop offset="1" stopColor="#2be3f5" /></linearGradient>
      </defs>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="url(#aiFill)" />
      <path d={line} fill="none" stroke="url(#aiLine)" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0] - 2} cy={pts[pts.length - 1][1]} r={3.5} fill="var(--gold)" />
    </svg>
  );
}

const GREETINGS = [
  'Hi, I’m Algoria AI. Ask me anything below.',
  'I trade gold and crypto, only on clean setups.',
  'Every trade I take has a stop loss.',
  'Your money never leaves your own broker account.',
];

export default function AlgoriaAI() {
  const router = useRouter();
  const [days, setDays] = useState<TrackDay[] | null>(null);
  const [greet, setGreet] = useState(0);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [typed, setTyped] = useState(0);
  const answerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void fetch('/api/public/track').then((r) => (r.ok ? r.json() : null)).then((d: { days?: TrackDay[] } | null) => setDays(d?.days ?? [])).catch(() => setDays([]));
  }, []);
  const lesson = ask ? lessonOf(ask) : undefined;
  const full = lesson ? plain(nb(lesson.body)) : '';
  // réponse « tapée » par l'orbe, puis le texte riche complet
  useEffect(() => {
    if (!full) return;
    setTyped(0);
    const id = setInterval(() => setTyped((n) => { if (n >= full.length) { clearInterval(id); return n; } return n + 3; }), 16);
    return () => clearInterval(id);
  }, [full]);
  useEffect(() => { if (ask) answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [ask]);
  const answering = Boolean(full) && typed < full.length;
  const week = useMemo(() => {
    if (!days) return null;
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    return days.filter((d) => d.d >= from).reduce((a, d) => a + d.n, 0);
  }, [days]);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      <section className="panel" style={{ padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: 'radial-gradient(90% 80% at 50% 30%, var(--panel-top) 0%, var(--panel-bottom) 100%)' }}>
        <div className="mono" style={{ fontSize: 9.5, letterSpacing: 1.6, color: 'var(--up)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="liveGlow" style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--up)', display: 'inline-block' }} /> ONLINE · WATCHING GOLD &amp; CRYPTO
        </div>
        <Orb energy={answering ? 1 : 0} onTap={() => { setAsk(null); setGreet((g) => (g + 1) % GREETINGS.length); }} />
        <div style={{ fontWeight: 800, letterSpacing: 2, fontSize: 15 }}>ALGORIA <span style={{ color: 'var(--cyan)' }}>AI</span></div>
        <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', minHeight: 20, maxWidth: 300 }}>{nb(GREETINGS[greet])}</div>
      </section>

      <section className="panel" style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 9.5, letterSpacing: 1.2, whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--gold)' }}>REAL ACCOUNT · SINCE JULY</span>
          {week !== null && <span style={{ color: 'var(--dim)' }}>{week} TRADES · 7D</span>}
        </div>
        {days === null ? <div style={{ height: 90 }} /> : days.length > 1 ? <Curve days={days} /> : <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>The curve is updating, try again in a moment.</div>}
        <button onClick={() => router.push('/member/track-record')} style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: 0, color: 'var(--cyan)', fontWeight: 750, fontSize: 12.5, cursor: 'pointer' }}>
          See every trade, in % or at your lot →
        </button>
      </section>

      <section className="panel" style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--gold)' }}>ASK ALGORIA AI</div>
        {ask && lesson && (
          <div ref={answerRef} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <img src="/brand/algoria-mark.png" alt="" width={26} height={26} style={{ objectFit: 'contain', marginTop: 2, filter: 'drop-shadow(0 0 6px rgba(43,227,245,.45))' }} />
            <div style={{ flex: 1, padding: '10px 12px', borderRadius: '4px 14px 14px 14px', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--muted)' }}>
                {answering ? full.slice(0, typed) : <Rich text={lesson.body} />}
              </p>
              {!answering && lesson.facts && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {lesson.facts.map((f, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: 'var(--text)' }}>
                      <span style={{ color: f.ok ? 'var(--up)' : 'var(--down)', fontWeight: 800, marginRight: 6 }}>{f.ok ? '✓' : '✕'}</span>
                      {f.t}{f.s && <span style={{ color: 'var(--dim)' }}> · {f.s}</span>}
                    </div>
                  ))}
                </div>
              )}
              {!answering && lesson.note && <div style={{ fontSize: 12.5, color: 'var(--cyan)' }}>{lesson.note}</div>}
              {!answering && (
                <button onClick={() => router.push(`/member/academy#${ask.module}`)} style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: 0, color: 'var(--cyan)', fontWeight: 750, fontSize: 12, cursor: 'pointer' }}>
                  🎓 More in the Academy →
                </button>
              )}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {ASKS.map((a) => {
            const on = ask?.q === a.q;
            return (
              <button key={a.q} onClick={() => setAsk(a)} style={{ padding: '8px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: on ? '#0b0e14' : 'var(--text)', background: on ? 'linear-gradient(90deg,#2be3f5,#2e8bf0)' : 'var(--surface)', border: on ? '1px solid transparent' : '1px solid var(--border)' }}>
                {nb(a.q)}
              </button>
            );
          })}
        </div>
        <a href="https://t.me/mathieu_algoria" target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--dim)', textDecoration: 'none' }}>
          Something else&nbsp;? <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>Ask Mathieu on Telegram →</span>
        </a>
      </section>
    </main>
  );
}
