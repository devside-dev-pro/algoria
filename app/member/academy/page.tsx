'use client';
// ACADEMY — OUVERTE AU PUBLIC (pas de login requis) : c'est la page de closing.
// Le lien partageable est algoria.tech/academy → un prospect lit sans friction ; dès qu'il touche
// Home/History/…, le useMe de CES pages le renvoie au login Telegram. Ici : pas de redirect sur 401.
//
// 30/09/2026 : les deux vidéos du fondateur (Welcome, « Meet ALGORIA 2.0 ») sont retirées — elles parlaient
// encore de 3 stratégies. À la place : le contenu de lib/member/academy.ts, en texte natif (lisible sur
// téléphone, suit le thème clair/sombre), plus un quiz. Lien direct vers un module : /academy#faq, #quiz…
// Vidéo d'intro : NEXT_PUBLIC_INTRO_VIDEO_URL (16:9, .mp4/.webm ou iframe) — affichée seulement si elle existe.
import { Fragment, useEffect, useState } from 'react';
import { ACADEMY, QUIZ, type Fact, type Lesson } from '@/lib/member/academy';

const INTRO = process.env.NEXT_PUBLIC_INTRO_VIDEO_URL ?? '';
const isFile = (u: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);
const TABS = [...ACADEMY.map((m) => ({ key: m.key, label: m.label, icon: m.icon })), { key: 'quiz', label: 'Quiz', icon: '🎯' }];

// Style Mathieu : une espace avant ? et ! — insécable, sinon le « ? » part seul en début de ligne.
const nb = (s: string) => s.replace(/ ([?!])/g, '\u00a0$1');

/** `**gras**` → <b>, rien d'autre (contenu statique écrit par nous). */
function Rich({ text }: { text: string }) {
  return <>{nb(text).split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <b key={i} style={{ color: 'var(--text)', fontWeight: 700 }}>{p}</b> : <Fragment key={i}>{p}</Fragment>))}</>;
}

function Mark({ ok }: { ok: boolean }) {
  const c = ok ? 'var(--up)' : 'var(--down)';
  return (
    <span aria-label={ok ? 'yes' : 'no'} style={{ flex: '0 0 auto', width: 22, height: 22, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c, border: `1.5px solid ${c}`, fontSize: 12, fontWeight: 800, marginTop: 1 }}>
      {ok ? '✓' : '✕'}
    </span>
  );
}

function FactRow({ f }: { f: Fact }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Mark ok={f.ok} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--text)' }}>{f.t}</span>
        {f.s && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{f.s}</span>}
      </div>
    </div>
  );
}

function LessonCard({ l, n, total }: { l: Lesson; n: number; total: number }) {
  return (
    <article className="panel" style={{ padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase' }}>
        <span style={{ color: 'var(--gold)' }}>{l.kicker}</span>
        <span style={{ color: 'var(--dim)' }}>{n}/{total}</span>
      </div>
      <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.25, letterSpacing: -0.2 }}>{nb(l.title)}</h2>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--muted)' }}><Rich text={l.body} /></p>
      {l.facts && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '11px 12px', borderRadius: 11, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {l.facts.map((f, i) => <FactRow key={i} f={f} />)}
        </div>
      )}
      {l.note && (
        <div style={{ padding: '9px 12px', borderLeft: '3px solid var(--cyan)', borderRadius: '0 10px 10px 0', background: 'rgba(43,227,245,.06)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)' }}>
          <span className="mono" style={{ display: 'block', fontSize: 9, letterSpacing: 1.4, color: 'var(--cyan)', marginBottom: 2 }}>AT ALGORIA</span>
          {l.note}
        </div>
      )}
      {l.link && (
        <a href={l.link.href} target="_blank" rel="noreferrer" style={{ alignSelf: 'flex-start', fontSize: 12.5, fontWeight: 750, color: 'var(--cyan)', textDecoration: 'none' }}>↗ {l.link.label}</a>
      )}
    </article>
  );
}

function Quiz() {
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const done = i >= QUIZ.length;
  if (done) {
    return (
      <section className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
        <span style={{ fontSize: 34 }}>{score === QUIZ.length ? '🏆' : score >= 7 ? '🙌' : '📚'}</span>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{score}/{QUIZ.length}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, maxWidth: 300 }}>
          {score === QUIZ.length ? 'Perfect score. You know Algoria inside out.' : score >= 7 ? 'Nice one. Check the lessons for the ones you missed.' : 'The lessons above cover every answer, have a look and try again.'}
        </div>
        <button onClick={() => { setI(0); setPick(null); setScore(0); }} style={btn(false)}>↺ Try again</button>
      </section>
    );
  }
  const q = QUIZ[i];
  const answered = pick !== null;
  return (
    <section className="panel" style={{ padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, letterSpacing: 1.4 }}>
        <span style={{ color: 'var(--gold)' }}>QUIZ</span>
        <span style={{ color: 'var(--dim)' }}>{i + 1}/{QUIZ.length} · SCORE {score}</span>
      </div>
      <h2 style={{ margin: 0, fontSize: 17, lineHeight: 1.3 }}>{nb(q.q)}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {q.options.map((o, k) => {
          const right = answered && k === q.answer;
          const wrong = answered && k === pick && k !== q.answer;
          return (
            <button
              key={k}
              disabled={answered}
              onClick={() => { setPick(k); if (k === q.answer) setScore((s) => s + 1); }}
              style={{
                textAlign: 'left', padding: '11px 13px', borderRadius: 11, fontSize: 13.5, fontWeight: 650, cursor: answered ? 'default' : 'pointer',
                color: 'var(--text)', background: right ? 'rgba(31,216,176,.12)' : wrong ? 'rgba(255,107,138,.1)' : 'var(--surface)',
                border: `1px solid ${right ? 'var(--up)' : wrong ? 'var(--down)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              {answered && (right || wrong) ? <Mark ok={right} /> : <span style={{ flex: '0 0 auto', width: 22, height: 22, borderRadius: 11, border: '1.5px solid var(--dim)' }} />}
              {o}
            </button>
          );
        })}
      </div>
      {answered && (
        <>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--muted)' }}>
            <b style={{ color: pick === q.answer ? 'var(--up)' : 'var(--down)' }}>{pick === q.answer ? 'Correct. ' : 'Not quite. '}</b>{q.why}
          </div>
          <button onClick={() => { setI(i + 1); setPick(null); }} style={btn(true)}>{i + 1 < QUIZ.length ? 'Next question →' : 'See my score →'}</button>
        </>
      )}
    </section>
  );
}

export default function Academy() {
  // Auth TOLÉRANTE : on veut juste savoir si la personne est connectée (pour le CTA), jamais la rediriger.
  const [anon, setAnon] = useState<boolean | null>(null);
  const [tab, setTab] = useState(TABS[0].key);
  useEffect(() => {
    void fetch('/api/member/me').then((r) => setAnon(r.status === 401)).catch(() => setAnon(true));
    const h = window.location.hash.slice(1);
    if (TABS.some((t) => t.key === h)) setTab(h);
  }, []);
  const choose = (k: string) => {
    setTab(k);
    try { window.history.replaceState(null, '', `#${k}`); } catch { /* sans importance */ }
  };
  const mod = ACADEMY.find((m) => m.key === tab);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
      {INTRO ? (
        <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          {isFile(INTRO) ? (
            <video src={INTRO} controls playsInline preload="metadata" style={{ width: '100%', aspectRatio: '16 / 9', display: 'block', background: 'var(--panel-2)' }} />
          ) : (
            <div style={{ position: 'relative', paddingTop: '56.25%' }}>
              <iframe src={INTRO} title="Algoria in 1 minute" allowFullScreen style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }} />
            </div>
          )}
        </section>
      ) : (
        <section className="panel" style={{ padding: '18px 16px', display: 'flex', alignItems: 'center', gap: 14, background: 'radial-gradient(90% 120% at 0% 0%, var(--panel-top) 0%, var(--panel-bottom) 100%)' }}>
          <img src="/brand/algoria-mark.png" alt="" width={44} height={44} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 9px rgba(43,227,245,.45))' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontWeight: 800, letterSpacing: 0.6 }}>ALGORIA ACADEMY</span>
            <span style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.45 }}>Everything you need to know about Algoria, in 5 minutes.</span>
          </div>
        </section>
      )}

      {/* CTA prospect : visible hors connexion seulement. */}
      {anon === true && (
        <a href="/member/login" className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px 15px', textDecoration: 'none', fontWeight: 800, letterSpacing: 0.4, color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', border: 'none' }}>
          🚀 Ready? Continue with Telegram, 2 minutes to set up
        </a>
      )}

      <nav style={{ display: 'flex', gap: 7, overflowX: 'auto', margin: '0 -2px', padding: '2px 2px 4px', scrollbarWidth: 'none' }}>
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <button key={t.key} onClick={() => choose(t.key)} style={{ flex: '0 0 auto', padding: '8px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 750, cursor: 'pointer', whiteSpace: 'nowrap', color: on ? '#0b0e14' : 'var(--text)', background: on ? 'linear-gradient(90deg,#2be3f5,#2e8bf0)' : 'var(--surface)', border: on ? '1px solid transparent' : '1px solid var(--border)' }}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </nav>

      {mod ? (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--dim)', padding: '0 2px' }}>{mod.blurb}</div>
          {mod.lessons.map((l, k) => <LessonCard key={l.id} l={l} n={k + 1} total={mod.lessons.length} />)}
        </>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--dim)', padding: '0 2px' }}>{nb('10 questions. How well do you know Algoria ?')}</div>
          <Quiz />
        </>
      )}

      <p style={{ margin: '4px 2px 0', fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>Trading involves risk. Past results do not guarantee future results.</p>
    </main>
  );
}

const btn = (primary: boolean) => ({
  padding: '12px 16px', borderRadius: 11, fontWeight: 800, fontSize: 13.5, cursor: 'pointer',
  color: primary ? '#0b0e14' : 'var(--text)', background: primary ? 'linear-gradient(90deg,#2be3f5,#2e8bf0)' : 'var(--surface)',
  border: primary ? 'none' : '1px solid var(--border)',
}) as const;
