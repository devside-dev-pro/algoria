'use client';
// FICHE STORE — la page se comporte comme une fiche d'app :
//   · bouton GET intelligent : Android/Chrome → prompt d'installation NATIF (un tap) ;
//     iPhone → tuto Safari détaillé (pas d'API Apple) ; déjà installée → OPEN.
//   · piège n°1 du funnel TikTok : le navigateur INTÉGRÉ (TikTok/Instagram) ne sait PAS installer
//     une PWA → bannière « ouvre dans ton vrai navigateur » détectée à l'user-agent.
//   · screenshots = VRAIES captures de l'app (public/adshots → WebP 600 px). C'étaient des maquettes
//     CSS jusqu'au 14/08, dérivées au point de ne plus rien montrer de l'app.
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

// ===== DÉTECTION DU NAVIGATEUR INTÉGRÉ (13/08/2026) =====
// C'EST LE blocage n°1 de l'installation, et il était invisible : la liste ne contenait que TikTok,
// Instagram, Facebook et Snapchat — PAS TELEGRAM. Or la quasi-totalité des membres arrivent par le canal
// Telegram. Ils ouvraient donc cette page dans le navigateur de Telegram, ne voyaient AUCUN avertissement,
// et lisaient « touche le bouton Partage » — un bouton qui, dans ce navigateur, n'offre pas « Sur l'écran
// d'accueil ». Ils tapaient partout sans résultat, et Mathieu finissait par les guider capture par capture.
//
// Sur iOS, l'user-agent de Telegram est CELUI DE SAFARI, à un détail près : les WebView intégrées ne
// mettent pas le jeton `Version/xx`. C'est le seul signal fiable — chercher « Telegram » dans l'UA ne
// donne rien sur iPhone. Sur Android, la marque `; wv` identifie la WebView.
type Browser = { platform: Platform; inApp: boolean; appName: string | null };

// (non exportée : un fichier de page Next ne peut exporter que ses symboles réservés)
// `hints` = signaux relevés sur window. L'user-agent de Telegram ne le nomme NI sur iPhone NI sur Android,
// mais son WebView injecte `TelegramWebviewProxy` : c'est le seul moyen de nommer l'app à l'écran, et le
// nommer change tout — « tap ⋯ then Open in Safari » se suit, « cherche un menu quelque part » se subit.
// Signal purement cosmétique : le drapeau `inApp` est déjà correct sans lui, donc s'il manque on retombe
// simplement sur la formulation générique.
function detectBrowser(ua: string, hints: { telegram?: boolean } = {}): Browser {
  const ios = /iphone|ipad|ipod/i.test(ua);
  const android = /android/i.test(ua);
  const platform: Platform = ios ? 'ios' : android ? 'android' : 'desktop';
  const named: Array<[RegExp, string]> = [
    [/telegram/i, 'Telegram'],
    [/musical_ly|bytedance|tiktok/i, 'TikTok'],
    [/instagram/i, 'Instagram'],
    [/fban|fbav|fb_iab/i, 'Facebook'],
    [/snapchat/i, 'Snapchat'],
    [/\bline\//i, 'LINE'],
    [/micromessenger/i, 'WeChat'],
  ];
  const appName = hints.telegram ? 'Telegram' : named.find(([re]) => re.test(ua))?.[1] ?? null;
  // ⚠️ CORRECTIF (14/08) : « pas de Version/ » ne suffit PAS à conclure à une WebView. Les navigateurs
  // TIERS sur iPhone — Chrome (CriOS), Firefox (FxiOS), Edge, Opera, DuckDuckGo — n'ont pas ce jeton non
  // plus : seul Safari le pose. La règle brute les accusait donc tous d'être des navigateurs intégrés, et
  // affichait « sors d'ici » à quelqu'un sur Chrome qui pouvait parfaitement installer (constaté aussitôt
  // en production). On les reconnaît nommément avant d'appliquer l'heuristique.
  // Ces navigateurs installent bien une PWA sur iOS 16.4+, via la même feuille de partage que Safari.
  const realIosBrowser = /crios|fxios|edgios|opios|opt\/|duckduckgo|yabrowser|puffin|focus\//i.test(ua);
  // iOS : ni navigateur tiers connu, ni `Version/` ⇒ WebView intégrée (Telegram compris, qui ne se nomme
  // jamais sur iPhone). Android : `; wv`. Un nom d'app trouvé dans l'UA tranche dans tous les cas.
  const iosInApp = ios && !realIosBrowser && !/version\/\d/i.test(ua);
  const androidInApp = android && /;\s*wv\b/i.test(ua);
  return { platform, inApp: appName != null || iosInApp || androidInApp, appName };
}

/** Sortie vers le VRAI navigateur, formulée pour l'app détectée — c'est l'étape zéro, sans elle rien ne marche. */
function exitSteps(b: Browser): { where: string; how: React.ReactNode } {
  const target = b.platform === 'ios' ? 'Safari' : 'Chrome';
  if (b.appName === 'Telegram')
    return {
      where: 'Telegram',
      how: b.platform === 'ios'
        ? <>Tap the <b>⋯</b> at the top right of this page, then <b>Open in Safari</b>.</>
        : <>Tap the <b>⋮</b> at the top right, then <b>Open in browser</b>.</>,
    };
  if (b.appName === 'Instagram' || b.appName === 'Facebook')
    return { where: b.appName, how: <>Tap the <b>⋯</b> at the top right, then <b>Open in {target}</b>.</> };
  if (b.appName === 'TikTok')
    return { where: 'TikTok', how: <>Tap the <b>⋯</b> at the top right, then <b>Open in browser</b>.</> };
  return {
    where: 'this app’s built-in browser',
    how: <>Look for <b>⋯</b> or <b>⋮</b> (usually top right) and choose <b>Open in {target}</b>.</>,
  };
}

/** Le glyphe EXACT du bouton Partage de Safari — carré avec une flèche qui sort par le haut. */
function ShareGlyph({ size = 22, color = 'var(--cyan)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15V3" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}
/** Le glyphe « Sur l'écran d'accueil » — carré avec un +, tel qu'il apparaît dans la feuille de partage. */
function AddGlyph({ size = 20, color = 'var(--text)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

export default function DownloadPage() {
  // `browser` est null au premier rendu : la détection lit navigator, qui n'existe pas côté serveur.
  // Tant qu'elle n'a pas eu lieu on n'affiche NI bannière NI tutoriel ciblé — mieux vaut un instant neutre
  // qu'une instruction destinée au mauvais navigateur (c'est ce qui égarait les gens).
  const [browser, setBrowser] = useState<Browser | null>(null);
  const platform = browser?.platform ?? 'desktop';
  const inApp = browser?.inApp ?? false;
  const [installed, setInstalled] = useState(false);
  const [canNative, setCanNative] = useState(false);
  const [showManual, setShowManual] = useState(false); // Android sans beforeinstallprompt → guide menu Chrome
  const [copied, setCopied] = useState(false);
  const deferred = useRef<BipEvent | null>(null);
  const iosRef = useRef<HTMLDivElement>(null);
  const manualRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const w = window as unknown as Record<string, unknown>;
    setBrowser(detectBrowser(ua, { telegram: w.TelegramWebviewProxy != null || w.TelegramWebview != null }));
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) setInstalled(true);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/member-sw.js').catch(() => {});
    const onBip = (e: Event) => { e.preventDefault(); deferred.current = e as unknown as BipEvent; setCanNative(true); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onBip); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  /** Copie l'adresse — le secours UNIVERSEL : coller dans le vrai navigateur marche partout, quelle que
   *  soit l'app dans laquelle la personne est enfermée et quel que soit l'endroit où son menu se cache. */
  const copyLink = async () => {
    const url = 'https://app.algoria.tech/download';
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard refusé (contexte non sécurisé, WebView restrictive) → sélection manuelle du champ
      const el = document.createElement('input');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      try { document.execCommand('copy'); } catch { /* tant pis : l'adresse reste affichée en clair */ }
      el.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };

  const install = async () => {
    if (installed) { window.location.href = '/member'; return; }
    // DANS UNE WEBVIEW, ON N'ENVOIE PLUS VERS LE TUTORIEL D'INSTALLATION : il y décrit un bouton Partage
    // qui n'ouvre pas « Sur l'écran d'accueil ». On envoie vers la sortie, qui est la vraie première étape.
    if (inApp) { exitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (deferred.current) { void deferred.current.prompt(); return; } // Android/Chrome : LE bouton natif, un tap
    if (platform === 'ios') { iosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    setShowManual(true);
    window.setTimeout(() => manualRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '26px 18px 48px' }}>
      <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* ── ÉTAPE ZÉRO : SORTIR DU NAVIGATEUR INTÉGRÉ ──────────────────────────────────────────────
            Le blocage n°1, et il passait inaperçu : Telegram n'était pas détecté (son user-agent iOS est
            celui de Safari), donc les membres venus du canal ne voyaient aucun avertissement et suivaient
            un tutoriel inapplicable chez eux. On nomme l'app, on donne le chemin EXACT de son menu, et on
            offre la copie de l'adresse — le secours qui marche même si le menu est ailleurs que décrit.
            Tant que la personne est ici, tout le reste de la page est secondaire : ce bloc passe devant. */}
        {inApp && !installed && (() => {
          const ex = exitSteps(browser!);
          return (
            <div ref={exitRef} className="panel cardIn" style={{ padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 12, scrollMarginTop: 14, borderColor: 'rgba(245,194,74,.55)', boxShadow: '0 0 26px rgba(245,194,74,.16)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>
                  <b>You&rsquo;re browsing inside {ex.where}</b> — this browser <b>cannot</b> install apps. Nothing you tap here will work until you leave it.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 11, alignItems: 'center', background: 'rgba(245,194,74,.08)', border: '1px solid rgba(245,194,74,.3)', borderRadius: 12, padding: '11px 13px' }}>
                <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--gold)' }}>1</span>
                <span style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5 }}>{ex.how}</span>
              </div>
              <div style={{ display: 'flex', gap: 11, alignItems: 'center', background: 'rgba(245,194,74,.08)', border: '1px solid rgba(245,194,74,.3)', borderRadius: 12, padding: '11px 13px' }}>
                <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--gold)' }}>2</span>
                <span style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5 }}>You&rsquo;ll land on this same page — then follow the install steps below.</span>
              </div>
              {/* SECOURS UNIVERSEL : le menu n'est pas toujours là où on le décrit (versions, Android vs iOS).
                  Coller l'adresse dans le vrai navigateur, ça, ça marche partout. */}
              <button onClick={() => void copyLink()}
                style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1px solid rgba(245,194,74,.45)', cursor: 'pointer', background: 'rgba(245,194,74,.1)', color: 'var(--gold)', fontSize: 12.5, fontWeight: 800, letterSpacing: 0.4 }}>
                {copied ? '✓ LINK COPIED — now paste it in ' + (platform === 'ios' ? 'Safari' : 'Chrome') : '⧉ CAN’T FIND THE MENU? COPY THE LINK'}
              </button>
            </div>
          );
        })()}

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
          {installed ? '✓ INSTALLED — OPEN'
            // dans une WebView, promettre « installer » serait mentir : le bouton dit ce qu'il fait vraiment
            : inApp ? `⚠ OPEN IN ${platform === 'ios' ? 'SAFARI' : 'CHROME'} FIRST`
            : canNative ? '⬇ INSTALL THE APP'
            : platform === 'ios' ? '⬇ GET — HOW TO INSTALL' : '⬇ GET THE APP'}
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

        {/* ── SCREENSHOTS — LES VRAIES (14/08/2026) ────────────────────────────────────────────────
            C'étaient des MAQUETTES CSS. L'intention était bonne — « zéro asset à maintenir » — mais sans
            personne pour les tenir à jour elles avaient dérivé jusqu'à ne plus rien montrer de l'app :
            onglets inventés (Live/Copy/Learn/Alerts au lieu de HOME/HISTORY/ALGORIA AI/ACADEMY/PROFILE),
            écrans qui n'existent pas, chiffres inventés. Sur une page qui se présente comme une fiche
            d'app, montrer autre chose que l'app est le seul défaut qu'un visiteur vérifie lui-même en
            trente secondes — et celui-là ne pardonne pas.
            Les vraies captures dormaient dans public/adshots depuis le 30/07, référencées nulle part.
            Servies en WebP 600 px : 2,6 Mo → ~50 Ko pièce, l'original reste pour les visuels publicitaires.
            ⚠️ Quand l'app change d'allure, refaire les captures PUIS régénérer :
               sharp(src).resize({ width: 600 }).webp({ quality: 82 }) */}
        <div className="deskscroll" style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '4px 2px 10px' }}>
          {[
            { src: '/adshots/web/cockpit.webp', title: 'Live AI feed' },
            { src: '/adshots/web/history.webp', title: 'Your gains, trade by trade' },
            { src: '/adshots/web/home.webp', title: 'Copying status' },
            { src: '/adshots/web/strategies.webp', title: 'Pick your strategy' },
          ].map((sh) => (
            <div key={sh.src} style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center' }}>
              <img
                src={sh.src} alt={`Algoria app — ${sh.title}`} width={196} height={426} loading="lazy" decoding="async"
                style={{
                  width: 196, height: 426, objectFit: 'cover', objectPosition: 'top', display: 'block', borderRadius: 26,
                  border: '1px solid rgba(43,227,245,.22)', boxShadow: '0 14px 40px rgba(2,6,16,.65)',
                }}
              />
              <span style={{ fontSize: 10.5, color: 'var(--dim)', letterSpacing: 0.4 }}>{sh.title}</span>
            </div>
          ))}
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
              ⚠️ These steps only work in <b>Safari</b> — do the step above first, otherwise the Share button
              won&rsquo;t offer &ldquo;Add to Home Screen&rdquo;.
            </div>
          )}
          {/* ILLUSTRÉ, pas seulement décrit (13/08) : « le carré avec une flèche » ne parle qu'à ceux qui
              savent déjà. On DESSINE le bouton et on montre où il se trouve dans la barre Safari — c'est
              exactement ce que Mathieu refaisait à la main, capture par capture, pour chaque membre. */}
          {/* ⚠️ Ne PAS écrire « Safari uniquement » : depuis iOS 16.4, Chrome, Firefox et Edge installent
              aussi, par la même feuille de partage — vérifié en production le 14/08. Ce qui ne marche
              jamais, c'est le navigateur INTÉGRÉ d'une app. Exiger Safari à tort, c'est envoyer faire un
              détour inutile quelqu'un qui était déjà au bon endroit. */}
          <Step n="1" glyph={<span style={{ fontSize: 17 }}>🧭</span>}>
            Open this page in a <b style={{ color: 'var(--text)' }}>real browser</b> — Safari, Chrome or Firefox all work. What never works is a browser opened inside another app
          </Step>
          <Step n="2" glyph={<ShareGlyph />}>
            Tap the <b style={{ color: 'var(--text)' }}>Share</b> button — <b style={{ color: 'var(--text)' }}>bottom centre</b> in Safari, <b style={{ color: 'var(--text)' }}>top right</b> in Chrome (and on iPad)
          </Step>
          {/* barre Safari reconstituée : la personne compare l'image à son écran et trouve le bouton */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 4, padding: '11px 14px', borderRadius: 12, background: 'rgba(255,255,255,.045)', border: '1px solid var(--border)' }}>
            {['‹', '›'].map((c) => <span key={c} style={{ fontSize: 19, color: 'var(--dim)' }}>{c}</span>)}
            <span className="pulse" style={{ display: 'inline-flex', padding: 7, borderRadius: 10, border: '2px solid var(--cyan)', boxShadow: '0 0 16px rgba(43,227,245,.45)' }}>
              <ShareGlyph size={21} />
            </span>
            <span style={{ fontSize: 17, color: 'var(--dim)' }}>▢</span>
            <span style={{ fontSize: 17, color: 'var(--dim)' }}>⧉</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--cyan)', textAlign: 'center', marginTop: -6 }}>↑ this is your Safari bar — tap the highlighted one</div>
          <Step n="3" glyph={<AddGlyph />}>
            Scroll the list that opens and tap <b style={{ color: 'var(--text)' }}>&ldquo;Add to Home Screen&rdquo;</b> — it&rsquo;s low in the list, keep scrolling
          </Step>
          {/* la ligne exacte de la feuille de partage, telle qu'elle apparaît sur l'iPhone */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderRadius: 12, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(43,227,245,.4)' }}>
            <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>Add to Home Screen</span>
            <AddGlyph size={19} color="var(--cyan)" />
          </div>
          <Step n="4" glyph={<span style={{ fontSize: 17 }}>✓</span>}>
            Tap <b style={{ color: 'var(--text)' }}>Add</b> (top right) — Algoria appears with your apps
          </Step>
          <Step n="5" glyph={<span style={{ fontSize: 17 }}>🚀</span>}>
            Open <b style={{ color: 'var(--cyan)' }}>Algoria</b> from your home screen — full screen, like a native app
          </Step>
          <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>
            No &ldquo;Add to Home Screen&rdquo; in the list? Then you&rsquo;re in a browser opened inside another app — go back to step 1.
            <br />Tip: enable notifications inside the app (Profile → Alerts) to get the win alerts on your lock screen.
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

/** Une étape du tutoriel : numéro, glyphe DESSINÉ (pas décrit), consigne. */
function Step({ n, glyph, children }: { n: string; glyph: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 13px' }}>
      <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--cyan)', width: 14, flex: 'none' }}>{n}</span>
      <span style={{ display: 'inline-flex', width: 24, justifyContent: 'center', flex: 'none' }}>{glyph}</span>
      <span style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}
