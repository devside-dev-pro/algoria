'use client';
// FICHE STORE — la page se comporte comme une fiche d'app :
//   · bouton GET intelligent : Android/Chrome → prompt d'installation NATIF (un tap) ;
//     iPhone → tuto Safari détaillé (pas d'API Apple) ; déjà installée → OPEN.
//   · piège n°1 du funnel TikTok : le navigateur INTÉGRÉ (TikTok/Instagram) ne sait PAS installer
//     une PWA → bannière « ouvre dans ton vrai navigateur » détectée à l'user-agent.
//   · screenshots = maquettes CSS (toujours raccord avec la vraie app, zéro asset à maintenir).
import { useEffect, useRef, useState } from 'react';

const REVIEWS = [
  { name: 'Marcus T.', stars: 5, when: 'this week', text: 'Watched the live on TikTok for a month before joining. Having the AI feed on my phone with the win alerts is another level.' },
  { name: 'goldhunter_fx', stars: 5, when: 'last week', text: 'Cleanest trading app I have. No broker clutter — just what the AI is doing and my copying status. Installs in 5 seconds.' },
  { name: 'Sarah K.', stars: 5, when: '2 weeks ago', text: 'The lock-screen alerts when a trade closes green are so satisfying. Feels like a native app, not a website.' },
  { name: 'Dylan R.', stars: 4, when: 'this month', text: 'Great app, super smooth. Would love dark gold theme options — otherwise perfect for following the account.' },
];
const RATING = 4.9;
const RATING_COUNT = '210+';

type Platform = 'ios' | 'android' | 'desktop';
type BipEvent = { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };

export default function DownloadPage() {
  const [platform, setPlatform] = useState<Platform>('desktop');
  const [inApp, setInApp] = useState(false); // navigateur intégré TikTok/Instagram → installation impossible
  const [installed, setInstalled] = useState(false);
  const [canNative, setCanNative] = useState(false);
  const [showManual, setShowManual] = useState(false); // Android sans beforeinstallprompt → guide menu Chrome
  const deferred = useRef<BipEvent | null>(null);
  const iosRef = useRef<HTMLDivElement>(null);
  const manualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/iphone|ipad|ipod/i.test(ua)) setPlatform('ios');
    else if (/android/i.test(ua)) setPlatform('android');
    setInApp(/musical_ly|bytedance|tiktok|instagram|fban|fbav|snapchat/i.test(ua));
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) setInstalled(true);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/member-sw.js').catch(() => {});
    const onBip = (e: Event) => { e.preventDefault(); deferred.current = e as unknown as BipEvent; setCanNative(true); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onBip); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  const install = async () => {
    if (installed) { window.location.href = '/member'; return; }
    if (deferred.current) { void deferred.current.prompt(); return; } // Android/Chrome : LE bouton natif, un tap
    if (platform === 'ios') { iosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    setShowManual(true);
    window.setTimeout(() => manualRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '26px 18px 48px' }}>
      <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* ── bannière navigateur intégré : sans elle, le funnel TikTok → install est MORT ── */}
        {inApp && !installed && (
          <div className="panel cardIn" style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', borderColor: 'rgba(245,194,74,.5)', boxShadow: '0 0 20px rgba(245,194,74,.12)' }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)' }}>
              <b>You&rsquo;re inside the {/tiktok|musical_ly|bytedance/i.test(navigator.userAgent) ? 'TikTok' : 'in-app'} browser</b> — it can&rsquo;t install apps.
              <br />Tap <b style={{ color: 'var(--cyan)' }}>⋯</b> (top right) → <b style={{ color: 'var(--cyan)' }}>Open in browser</b>, then come back to this page.
            </div>
          </div>
        )}

        {/* ── EN-TÊTE FICHE : icône + nom + éditeur + bouton GET ── */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <img
            src="/icons/member-512.png" alt="Algoria app" width={92} height={92}
            style={{ borderRadius: 22, border: '1px solid var(--border)', boxShadow: '0 10px 30px rgba(2,6,16,.6), 0 0 24px rgba(43,227,245,.14)' }}
          />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: 0.3 }}>Algoria</h1>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>The AI that trades — live in your pocket</div>
            <div style={{ fontSize: 11, color: 'var(--dim)' }}>Algoria AI · Finance</div>
          </div>
        </div>

        <button
          onClick={install}
          style={{
            width: '100%', padding: '15px 20px', borderRadius: 14, border: 'none', cursor: 'pointer',
            fontSize: 16, fontWeight: 800, letterSpacing: 0.6, color: '#04223a',
            background: 'linear-gradient(90deg,#2be3f5,#39a0ff)', boxShadow: '0 10px 30px rgba(43,227,245,.28)',
          }}
        >
          {installed ? '✓ INSTALLED — OPEN' : canNative ? '⬇ INSTALL THE APP' : platform === 'ios' ? '⬇ GET — HOW TO INSTALL' : '⬇ GET THE APP'}
        </button>

        {/* ── PORTE D'ENTRÉE (01/08) — cette page n'en avait AUCUNE. Son seul bouton installait la PWA, son
            seul lien renvoyait à algoria.tech : quelqu'un qui arrivait ici pour CRÉER SON COMPTE tournait en
            rond dans les instructions d'installation. Plusieurs cas signalés deux jours de suite, dont une
            personne qui a fini par écrire « still cannot get in to register » — littéralement exact.
            Et le piège était conceptuel autant qu'ergonomique : installer n'est PAS nécessaire, l'app
            tourne dans le navigateur. On présentait une étape optionnelle comme un passage obligé.
            Bouton pleine largeur, au-dessus de la ligne de flottaison, avant toute instruction. ── */}
        <a
          href="/member"
          style={{
            width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '14px 20px', borderRadius: 14, textDecoration: 'none', marginTop: -8,
            fontSize: 15, fontWeight: 800, letterSpacing: 0.4, color: 'var(--text)',
            border: '1px solid rgba(43,227,245,.45)', background: 'rgba(43,227,245,.07)',
          }}
        >
          → SIGN IN / CREATE MY ACCOUNT
        </a>
        <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: -14, lineHeight: 1.5 }}>
          You don&rsquo;t need to install anything to use Algoria.<br />
          Installing only adds the icon to your home screen.
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--dim)', textAlign: 'center', marginTop: -12 }}>
          Free · no App Store needed · installs in seconds · iPhone &amp; Android
        </div>

        {/* ── barre d'infos façon App Store ── */}
        <div className="panel" style={{ display: 'flex', padding: '12px 6px' }}>
          {[
            { top: `★ ${RATING}`, bottom: `${RATING_COUNT} members` },
            { top: 'Free', bottom: 'forever' },
            { top: '#1', bottom: 'AI trading' },
            { top: '< 1 MB', bottom: 'instant' },
          ].map((c, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', borderLeft: i ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: i === 0 ? 'var(--gold)' : 'var(--text)' }}>{c.top}</div>
              <div style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 2, letterSpacing: 0.4 }}>{c.bottom}</div>
            </div>
          ))}
        </div>

        {/* ── SCREENSHOTS (maquettes CSS dans des cadres téléphone) ── */}
        <div className="deskscroll" style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '4px 2px 10px' }}>
          <Shot title="Live AI feed">
            <MockHeader label="ALGORIA · LIVE" live />
            <div style={{ background: 'rgba(31,216,176,.1)', border: '1px solid rgba(31,216,176,.35)', borderRadius: 8, padding: '7px 9px' }}>
              <div style={{ fontSize: 6.5, color: 'var(--muted)', letterSpacing: 0.5 }}>TODAY</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--up)' }}>+247$</div>
            </div>
            <MockLine icon="✓" color="var(--up)" text="Trade closed · gold · +86$" />
            <MockLine icon="▲" color="var(--cyan)" text="Long opened · Bitcoin" />
            <MockLine icon="◆" color="var(--gold)" text="Liquidity swept — watching" />
            <MockLine icon="✓" color="var(--up)" text="Trade closed · BTC · +54$" />
            <MockLine icon="●" color="var(--muted)" text="Range regime · standing by" />
            <MockNav active={0} />
          </Shot>
          <Shot title="Copy the AI">
            <MockHeader label="COPYING" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(31,216,176,.1)', border: '1px solid rgba(31,216,176,.35)', borderRadius: 8, padding: '8px 9px' }}>
              <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--up)' }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--up)', letterSpacing: 0.6 }}>COPYING ACTIVE</span>
            </div>
            {['Balance', 'Equity', 'Open trades'].map((l, i) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px' }}>
                <span style={{ fontSize: 7.5, color: 'var(--muted)' }}>{l}</span>
                <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: i === 2 ? 'var(--cyan)' : 'var(--text)' }}>{['12,480$', '12,533$', '2'][i]}</span>
              </div>
            ))}
            <div style={{ fontSize: 6.5, color: 'var(--dim)', letterSpacing: 0.4 }}>RISK PER TRADE</div>
            <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,.06)', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, width: '35%', borderRadius: 3, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)' }} />
            </div>
            <MockNav active={1} />
          </Shot>
          <Shot title="Win alerts">
            <MockHeader label="ALERTS" />
            {[['Algoria', 'Trade closed on gold ✓ +124$', 'now'], ['Algoria', 'Swing target hit on Bitcoin ✓ +212$', '1h'], ['Algoria', 'New setup forming on gold', '3h']].map(([app, msg, t], i) => (
              <div key={i} style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 8px' }}>
                <img src="/brand/algoria-mark.png" alt="" width={14} height={14} style={{ objectFit: 'contain', marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 7, fontWeight: 700, color: 'var(--text)' }}>{app}</span>
                    <span style={{ fontSize: 6.5, color: 'var(--dim)' }}>{t}</span>
                  </div>
                  <div style={{ fontSize: 7.5, color: 'var(--muted)', lineHeight: 1.35 }}>{msg}</div>
                </div>
              </div>
            ))}
            <div style={{ fontSize: 7, color: 'var(--dim)', textAlign: 'center', marginTop: 2 }}>right on your lock screen</div>
            <MockNav active={3} />
          </Shot>
        </div>

        {/* ── DESCRIPTION ── */}
        <section className="panel" style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={secTitle}>About this app</h2>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--muted)' }}>
            Algoria is an AI that trades <b style={{ color: 'var(--gold)' }}>gold</b> and <b style={{ color: '#f7931a' }}>Bitcoin</b> on
            a real account, autonomously, and streams it live. The app puts her in your pocket:
          </p>
          {[
            ['🧠', 'Live AI feed — watch every decision she makes, explained in plain English'],
            ['📈', 'Copying status — your balance, equity and risk control in one glance'],
            ['🔔', 'Win alerts — a lock-screen notification when a trade closes'],
            ['🎓', 'Academy — learn how she trades, step by step'],
          ].map(([ic, t]) => (
            <div key={t} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{ fontSize: 14 }}>{ic}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5 }}>{t}</span>
            </div>
          ))}
        </section>

        {/* ── AVIS ── */}
        <section className="panel" style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={secTitle}>Ratings &amp; reviews</h2>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{RATING}</div>
              <div style={{ fontSize: 11, color: 'var(--gold)', letterSpacing: 1 }}>★★★★★</div>
              <div style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 2 }}>{RATING_COUNT} members</div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[92, 6, 2, 0, 0].map((pct, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: 9, color: 'var(--dim)', width: 8, textAlign: 'right' }}>{5 - i}</span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.06)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: 'var(--gold)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          {REVIEWS.map((r) => (
            <div key={r.name} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 12, padding: '11px 13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{r.name}</span>
                <span style={{ fontSize: 10, color: 'var(--dim)' }}>{r.when}</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--gold)', letterSpacing: 1, margin: '2px 0 5px' }}>{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: 'var(--muted)' }}>{r.text}</p>
            </div>
          ))}
        </section>

        {/* ── TUTO iPHONE (détaillé — Apple n'offre aucun bouton d'installation) ── */}
        <section ref={iosRef} className="panel" style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 12, scrollMarginTop: 16, borderColor: platform === 'ios' ? 'rgba(43,227,245,.45)' : undefined }}>
          <h2 style={secTitle}> iPhone — install in 20 seconds</h2>
          {platform === 'ios' && inApp && (
            <div style={{ fontSize: 12, color: 'var(--gold)', lineHeight: 1.5 }}>
              First: leave the TikTok browser — tap <b>⋯</b> then <b>Open in browser</b> (Safari).
            </div>
          )}
          {[
            { n: '1', t: <>Open this page in <b style={{ color: 'var(--text)' }}>Safari</b> (installation only works from Safari)</>, ic: '🧭' },
            { n: '2', t: <>Tap the <b style={{ color: 'var(--text)' }}>Share</b> button — the square with the arrow, bottom center of the screen</>, ic: '⎋' },
            { n: '3', t: <>Scroll the list and tap <b style={{ color: 'var(--text)' }}>&ldquo;Add to Home Screen&rdquo;</b></>, ic: '⊞' },
            { n: '4', t: <>Tap <b style={{ color: 'var(--text)' }}>Add</b> (top right) — Algoria appears with your apps</>, ic: '✓' },
            { n: '5', t: <>Open <b style={{ color: 'var(--cyan)' }}>Algoria</b> from your home screen — full screen, like a native app</>, ic: '🚀' },
          ].map((s) => (
            <div key={s.n} style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 13px' }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--cyan)', width: 14 }}>{s.n}</span>
              <span style={{ fontSize: 17 }}>{s.ic}</span>
              <span style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{s.t}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>
            Tip: enable notifications inside the app (Profile → Alerts) to get the win alerts on your lock screen.
          </div>
        </section>

        {/* ── ANDROID sans prompt natif (Firefox, Samsung Internet, page ouverte 2×…) ── */}
        {(showManual || (platform === 'android' && !canNative && !installed)) && (
          <section ref={manualRef} className="panel cardIn" style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 12, scrollMarginTop: 16 }}>
            <h2 style={secTitle}>🤖 Android — manual install</h2>
            {[
              { n: '1', t: <>Open this page in <b style={{ color: 'var(--text)' }}>Chrome</b></> },
              { n: '2', t: <>Tap the <b style={{ color: 'var(--text)' }}>⋮</b> menu (top right)</> },
              { n: '3', t: <>Tap <b style={{ color: 'var(--text)' }}>&ldquo;Add to Home screen&rdquo;</b> → <b style={{ color: 'var(--text)' }}>Install</b></> },
            ].map((s) => (
              <div key={s.n} style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 13px' }}>
                <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--cyan)', width: 14 }}>{s.n}</span>
                <span style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{s.t}</span>
              </div>
            ))}
          </section>
        )}

        {/* ── fiche technique ── */}
        <section className="panel" style={{ padding: '14px 16px' }}>
          <h2 style={secTitle}>Information</h2>
          {[['Provider', 'Algoria AI'], ['Category', 'Finance'], ['Compatibility', 'iPhone · Android · Desktop'], ['Language', 'English'], ['Price', 'Free'], ['In-app purchases', 'None']].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: 12 }}>
              <span style={{ color: 'var(--dim)' }}>{k}</span>
              <span style={{ color: 'var(--muted)' }}>{v}</span>
            </div>
          ))}
        </section>

        <p style={{ fontSize: 10.5, color: 'var(--dim)', textAlign: 'center', lineHeight: 1.5, margin: 0 }}>
          Trading involves risk of loss. Educational &amp; entertainment content — not financial advice.
          <br /><a href="/" style={{ color: 'var(--dim)' }}>algoria.tech</a>
        </p>
      </div>
    </main>
  );
}

const secTitle: React.CSSProperties = { margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: 0.3 };

/** Cadre téléphone : une maquette CSS de la vraie app (raccord marque, zéro screenshot à maintenir). */
function Shot({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center' }}>
      <div style={{
        width: 196, height: 380, borderRadius: 26, padding: '14px 11px', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', gap: 7,
        background: 'linear-gradient(180deg, #0f1e39 0%, #0a1425 100%)',
        border: '1px solid rgba(43,227,245,.22)', boxShadow: '0 14px 40px rgba(2,6,16,.65), inset 0 1px 0 rgba(255,255,255,.06)',
      }}>
        {children}
      </div>
      <span style={{ fontSize: 10.5, color: 'var(--dim)', letterSpacing: 0.4 }}>{title}</span>
    </div>
  );
}

function MockHeader({ label, live }: { label: string; live?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 3 }}>
      <img src="/brand/algoria-mark.png" alt="" width={13} height={13} style={{ objectFit: 'contain' }} />
      <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{label}</span>
      {live && <span className="pulse" style={{ width: 5, height: 5, borderRadius: '50%', background: '#ff6b8a', marginLeft: 'auto' }} />}
    </div>
  );
}

/** Barre d'onglets factice collée en bas du cadre — la silhouette de la vraie app. */
function MockNav({ active }: { active: number }) {
  return (
    <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-around', borderTop: '1px solid var(--border)', paddingTop: 7 }}>
      {[['◉', 'Live'], ['⇄', 'Copy'], ['🎓', 'Learn'], ['🔔', 'Alerts']].map(([ic, l], i) => (
        <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, opacity: i === active ? 1 : 0.4 }}>
          <span style={{ fontSize: 9, color: i === active ? 'var(--cyan)' : 'var(--muted)' }}>{ic}</span>
          <span style={{ fontSize: 5.5, letterSpacing: 0.4, color: i === active ? 'var(--cyan)' : 'var(--muted)' }}>{l}</span>
        </div>
      ))}
    </div>
  );
}

function MockLine({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px' }}>
      <span style={{ fontSize: 7.5, color }}>{icon}</span>
      <span style={{ fontSize: 7.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
    </div>
  );
}
