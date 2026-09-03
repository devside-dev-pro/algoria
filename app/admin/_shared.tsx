'use client';
// BRIQUES PARTAGÉES DE L’ADMIN (03/09/2026) — types, constantes, styles et petits composants qui vivaient en
// tête et en pied de app/admin/page.tsx avant le découpage par onglet. Contenu déplacé tel quel.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { openTelegram } from '@/lib/telegram';
import { ask } from '@/components/admin/Dialog';


export interface WL { username: string; added_by: string | null; created_at: string }
export interface Row {
  member_no: number; tg_id: number; tg_username: string | null; tg_name: string | null; status: string;
  broker: string | null; risk_tier: string; created_at: string; updated_at: string | null; onboarding_step: number;
  mt5_login: string | null; mt5_server: string | null; usdt_trc20: string | null; referred_by: number | null;
  country: string | null;
  source: string | null; // canal d'acquisition (cookie UTM au premier clic) — null = organique/cross-device
  banned_at?: string | null; // 🚫 accès révoqué (concurrent, abus) — session ET reconnexion bloquées
  locale?: string | null; // marché : 'en' (canal anglais) | 'it' (canal italien) — pilote app, DM et relances
  strategy?: number | null; // S1 / S2 / S3 — le master STH auquel son compte est abonné
  lot?: number | null; // la VRAIE taille de copie (risk_tier n'est qu'un libellé dérivé)
}
// SCRIPTS PAR SEGMENT — le message de relance générique ne fonctionne QUE sur des gens à qui on a déjà
// parlé. Sur les 219 personnes de la file, 196 n'avaient jamais écrit une ligne : leur envoyer « alors, tu
// en es où ? » revenait à relancer une conversation qui n'a jamais eu lieu.
// Le script de premier contact se termine donc par une QUESTION et pas par un lien : on cherche une
// réponse, pas un clic — et beaucoup ont quitté le canal depuis, ce qui rend un lien collé inutile alors
// qu'une proposition de le renvoyer relance l'échange.
/** « Hey! » → « Hey Marc! » quand on connaît le prénom. Un message qui commence par le prénom se lit
 *  comme écrit à la main ; sans prénom on garde le « Hey! » nu plutôt qu'un « Hey undefined ». */
export const personalise = (text: string, name?: string | null): string => {
  const first = String(name ?? '').trim().split(/\s+/)[0];
  return /^[\p{L}][\p{L}'-]{1,20}$/u.test(first) ? text.replace(/^Hey!/, `Hey ${first}!`) : text;
};

// ===== MODÈLES DE CTA POUR LES CANAUX (16/08/2026) =====================================================
// Écrire un bon CTA devant 2 000 personnes à froid, à chaque fois, c'est le genre de tâche qu'on repousse.
// Ces modèles pré-remplissent le composeur et restent ENTIÈREMENT modifiables — ce sont des points de
// départ, pas des textes figés.
//
// DEUX FAMILLES, parce que les deux ne servent pas au même moment :
//   · → APP  : pour ceux qui avanceront seuls. Un lien, ils s'inscrivent, personne n'intervient.
//   · → TOI  : pour ceux qui ont besoin d'un humain. Ça remplit ta boîte, mais c'est là que se ferment
//              les dossiers coincés — et sur 288 personnes en attente, la plupart ne bougeront que
//              si quelqu'un leur parle.
//
// ⚠️ Le texte est traduit automatiquement vers l'italien, PAS le libellé du bouton (il resterait
// anglais). D'où des libellés courts et universels, qui se comprennent dans les deux langues.
// Le corps se lit en trois secondes : une accroche, une raison d'y aller, rien de plus. Un post de
// canal qui demande un effort de lecture ne convertit pas.
// (non exportée : un fichier de page Next ne peut exporter que ses symboles réservés)
// L'annonce S1 → S2 du 20/08 vivait ici en texte pré-rempli, envoyable en deux clics à 17 membres, trois
// semaines après coup (audit 03/09). Une campagne d'un jour ne reste pas dans le code : le champ part vide.
export const CTA_TEMPLATES: Array<{ id: string; label: string; target: 'app' | 'mathieu'; text: string; btn: string; url: string }> = [
  {
    id: 'results', label: '📈 Résultats du jour → app', target: 'app',
    text: "📈 <b>Algoria has been trading all day.</b>\n\nEvery trade, every win, every stop — live in the app, at your own copy size. Nothing hidden, nothing rounded up.\n\nSee what your account would have done today 👇",
    btn: '🚀 OPEN ALGORIA', url: 'https://app.algoria.tech/member',
  },
  {
    id: 'start', label: '⚡ Commencer à copier → wizard', target: 'app',
    text: "⚡ <b>The AI trades, your account copies. That's the whole thing.</b>\n\nYou keep your money in <i>your own</i> broker account — we never touch it. Withdraw whenever you want. Start from $200.\n\nSetup takes about 5 minutes 👇",
    btn: '⚡ START COPYING', url: 'https://app.algoria.tech/member/onboarding',
  },
  {
    id: 'install', label: '📲 Installer l\'app → download', target: 'app',
    text: "📲 <b>Algoria on your home screen.</b>\n\nThe live AI feed, your copying status, and a notification the moment a trade closes green. No App Store, installs in seconds, free forever.",
    btn: '📲 INSTALL THE APP', url: 'https://app.algoria.tech/download',
  },
  {
    id: 'proof', label: '🎥 Comprendre en 2 min → academy', target: 'app',
    text: "🎥 <b>New here? Start with this.</b>\n\nTwo minutes to understand exactly what Algoria is, how it trades gold and Bitcoin, and why your money never leaves your own account.",
    btn: '▶ WATCH THE INTRO', url: 'https://app.algoria.tech/academy',
  },
  {
    id: 'stuck', label: '💬 Bloqué dans ton inscription → toi', target: 'mathieu',
    text: "💬 <b>Stuck somewhere in your setup?</b>\n\nThe broker, the deposit, the MT5 connection — whatever it is, it takes me two minutes to unblock. Write to me directly, I answer myself.\n\nNo sales pitch. Just tell me where you're stuck 👇",
    btn: '💬 MESSAGE MATHIEU', url: 'https://t.me/mathieu_algoria',
  },
  {
    id: 'question', label: '💬 Une question ? → toi', target: 'mathieu',
    text: "💬 <b>Any question about Algoria?</b>\n\nHow the copying works, which broker to pick, how much to start with — ask me. A real human answers, usually within the hour.",
    btn: '💬 ASK MATHIEU', url: 'https://t.me/mathieu_algoria',
  },
  {
    id: 'call', label: '📞 Réserver un appel → toi', target: 'mathieu',
    text: "📞 <b>Want to go through it together?</b>\n\nTen minutes on a call and your account is live. I walk you through the broker, the deposit and the connection, step by step.",
    btn: '📞 BOOK A CALL', url: "https://t.me/mathieu_algoria?text=" + encodeURIComponent("Hey Mathieu! I'd like to book a quick call to activate my Algoria access 📞"),
  },
  {
    id: 'bonus', label: '🎁 Code bonus ALGORIA100 → toi', target: 'mathieu',
    text: "🎁 <b>100% deposit bonus at RaiseFX — code ALGORIA100.</b>\n\nDeposit $300, the AI trades with $600 of buying power. The bonus is broker trading credit — <i>your</i> deposit stays yours, withdrawable anytime.\n\nWrite to me and I'll set it up with you 👇",
    btn: '🎁 CLAIM THE BONUS', url: 'https://t.me/mathieu_algoria',
  },
  {
    id: 'referral', label: '💸 Parrainage 10% → app', target: 'app',
    text: "💸 <b>Bring a friend, earn 10% of what they deposit.</b>\n\nUp to $200 per friend, paid in USDT straight to your wallet. They fund their account, you get paid — and they get the same AI you're running.\n\nYour personal link is in the app 👇",
    btn: '💸 GET MY LINK', url: 'https://app.algoria.tech/member/profile',
  },
];

export const SCRIPTS: Record<string, string> = {
  deposited:
    "Hey! Mathieu here, from Algoria. I can see your deposit came through — thank you, and sorry you had to wait.\n\nYour account just isn't connected to the copier yet, so the AI isn't trading for you. That's on us to finish and it takes 2 minutes. Can you confirm the broker and account number you funded, and I'll switch it on right now?",
  rejected:
    "Hey! Mathieu from Algoria. Your account connection didn't go through — and I want to be clear it's not you being refused, it's almost always one detail that doesn't match.\n\nMost of the time it's the password: MetaTrader needs your TRADING password (the one the broker emailed you when the account was created), not the one you use on the broker's website. Send me your account number and I'll check what's blocking it on my side.",
  first:
    "Hey! Mathieu here — I'm the founder of Algoria, the AI that trades gold and Bitcoin live. You created an account on our app a few days ago (that's how I have your name), but never finished setting it up.\n\nNo pressure at all — I'm just going through the list one by one. Are you still interested?\n\nEverything you need is right below: pick up where you left off, get back into the channel if you left it, or just message me.",
  followup:
    "Hey! Following up on our conversation — where are you at with your setup?\n\nIf something's blocking you, tell me what it is and I'll sort it out. Algoria's been trading every day in the meantime.",
};

export interface Action { id: string; tg_id?: number; member_no: number | null; kind: string; status?: string; done_by?: string | null; detail: Record<string, unknown> | null; created_at: string }
export interface Comm { id: string; referrer_tg_id: number; referred_tg_id: number | null; kind: string; amount: number; status: string; reason: string | null; detail: Record<string, unknown> | null; created_at: string }
export interface Payout { id: string; tg_id: number; amount: number; address: string; status: string; tx_hash: string | null; reason: string | null; created_at: string }
export interface Affiliate { pendingCommissions: Comm[]; recentCommissions: Comm[]; pendingPayouts: Payout[]; recentPayouts: Payout[]; owedUsd: number; flagged: { tg_id: number; balance: number; username: string | null; member_no: number | null }[] }
// registre des dépôts broker (bilan mensuel) — porté par member_actions kind='deposit'
export interface Deposit {
  id: string; tg_id: number; member_no: number | null; created_at: string;
  // booked_ym : mois COMPTABLE quand il diffère de celui du dépôt (report d'une com pas encore validée)
  detail: { broker?: string | null; amount_usd?: number; commission_usd?: number; commission_status?: string; note?: string | null; deposited_at?: string; booked_ym?: string | null } | null;
}

export type Tab = 'dashboard' | 'queue' | 'members' | 'deposits' | 'affiliate' | 'tools';


// ===== briques UI du CRM =====
export function Kpi({ label, value, accent, hot, sub }: { label: string; value: string; accent: string; hot?: boolean; sub?: string }) {
  return (
    <div className="panel" style={{ padding: '13px 15px', borderTop: `2px solid ${accent}`, boxShadow: hot ? `0 0 18px ${accent}22` : undefined }}>
      <div style={{ fontSize: 9.5, letterSpacing: 1.3, color: 'var(--dim)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 23, fontWeight: 800, marginTop: 3, color: hot ? accent : 'var(--text)' }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 9.5, marginTop: 2, color: 'var(--gold)' }}>{sub}</div>}
    </div>
  );
}
export function StatusChip({ status }: { status: string }) {
  const c = status === 'live' ? 'var(--up)' : status === 'offboarded' ? 'var(--down)' : status === 'paused' ? 'var(--gold)' : status === 'pending_copier' ? 'var(--cyan)' : 'var(--muted)';
  return <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, color: c, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{status.toUpperCase()}</span>;
}
export function RowLine({ icon, text, sub, onClick, gold }: { icon: string; text: string; sub?: string; onClick: () => void; gold?: boolean }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', border: `1px solid ${gold ? 'rgba(245,194,74,.35)' : 'var(--border)'}`, background: gold ? 'rgba(245,194,74,.05)' : 'rgba(10,17,31,.55)', color: 'var(--text)' }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 700 }}>{text}</span>
      <span style={{ flex: 1 }} />
      {sub && <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{sub}</span>}
      <span style={{ color: 'var(--dim)' }}>→</span>
    </button>
  );
}
export function Center({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: '90vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>{children}</main>;
}

// PORTE DE CONNEXION ADMIN — remplace l'ancien cul-de-sac « admin only ». Même login Telegram natif que
// l'espace membre (code à usage unique + deep-link, pollé). `forbidden` = une session NON-admin traîne sur
// ce poste → on la purge (logout) avant de relancer, pour repartir propre. L'accès reste gardé côté API :
// tout compte hors ADMIN_TG_USERNAMES se reconnecte puis se refait refuser — il ne voit jamais le CRM.
export function AdminGate({ forbidden, deniedAs }: { forbidden: boolean; deniedAs?: string | null }) {
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'expired' | 'error'>('idle');
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  // UN SEUL CODE PAR TENTATIVE (02/08). Trois connexions bloquées ce jour-là, dont une où deux codes
  // sont partis à 187 ms d'intervalle : Telegram a ouvert le PREMIER lien, l'utilisateur a tapé START,
  // la connexion a réussi — mais la page interrogeait le SECOND code, que personne ne confirmerait
  // jamais. « waiting for Telegram… » à l'infini, alors que tout avait marché.
  //  · inFlight : un tap qui déclenche deux événements (fréquent sur mobile) ne crée plus deux codes.
  //  · link : le bouton de secours ROUVRE le même lien au lieu d'en forger un nouveau. C'était le pire
  //    des deux défauts — le mécanisme de secours abandonnait le code que Telegram allait confirmer,
  //    donc plus l'utilisateur insistait, plus il s'enfonçait.
  const inFlight = useRef(false);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);
  const start = async () => {
    if (inFlight.current) return;
    if (link) { openTelegram(link, { fallbackNewTab: true }); return; } // secours : on rouvre, on ne recrée pas
    inFlight.current = true;
    try {
      if (forbidden) { try { await fetch('/api/member/logout', { method: 'POST' }); } catch { /* purge best-effort */ } }
      const r = await fetch('/api/member/tglogin', { method: 'POST' });
      const d = (await r.json()) as { code?: string; link?: string };
      if (!d.code || !d.link) { setPhase('error'); return; }
      setLink(d.link);
      setPhase('waiting');
      openTelegram(d.link, { fallbackNewTab: true });
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const p = (await fetch(`/api/member/tglogin?code=${d.code}`).then((x) => x.json()).catch(() => null)) as { ok?: boolean; expired?: boolean } | null;
        if (p?.ok) { if (poll.current) clearInterval(poll.current); window.location.replace('/admin'); } // reload complet → re-check admin
        else if (p?.expired) { if (poll.current) clearInterval(poll.current); setLink(null); setPhase('expired'); }
      }, 2000);
    } catch {
      setPhase('error');
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, textAlign: 'center', padding: '0 18px', background: 'radial-gradient(90% 60% at 50% -10%, #0e1c33 0%, #070b12 60%)' }}>
      <img src="/brand/algoria-mark.png" alt="Algoria" width={60} height={60} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(43,227,245,.45))' }} />
      <div>
        <h1 style={{ fontSize: 24, margin: 0, letterSpacing: 0.5 }}>ALGORIA <span className="goldText">ADMIN</span></h1>
        <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.6, maxWidth: 360, margin: '9px auto 0' }}>
          {forbidden
            ? 'This account isn’t an admin. Sign in with your authorized Telegram to open the back-office.'
            : 'Restricted back-office. Sign in with your authorized Telegram account.'}
        </p>
        {/* QUI vient de se connecter — sans ça, quelqu'un dont Telegram est resté sur un autre compte
            retape START à l'infini sans comprendre. Le pseudo affiché règle la question en une seconde. */}
        {forbidden && (
          <p className="mono" style={{ fontSize: 12, margin: '10px auto 0', color: 'var(--gold)', maxWidth: 360, lineHeight: 1.6 }}>
            Signed in as {deniedAs ? '@' + deniedAs : '(no Telegram username)'}
            <br />
            <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>
              Switch account inside Telegram BEFORE tapping START — otherwise you will sign back in as this same account.
            </span>
          </p>
        )}
      </div>
      {phase !== 'waiting' ? (
        <button onClick={() => void start()} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '13px 26px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: 0.5, fontSize: 14.5, color: '#fff', background: 'linear-gradient(90deg,#2AABEE,#229ED9)', boxShadow: '0 0 24px rgba(42,171,238,.35)' }}>
          ✈️ {forbidden ? 'SIGN IN WITH A DIFFERENT ACCOUNT' : 'LOG IN WITH TELEGRAM'}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
          <span className="pulse" style={{ fontSize: 13, color: 'var(--cyan)', fontWeight: 700 }}>● waiting for Telegram…</span>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', maxWidth: 300, lineHeight: 1.55 }}>Telegram just opened — tap <strong style={{ color: 'var(--text)' }}>START</strong> in the bot chat.</p>
          <button onClick={() => void start()} style={{ border: 'none', background: 'transparent', color: 'var(--dim)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>Didn’t open? Tap to retry</button>
        </div>
      )}
      {phase === 'expired' && <p style={{ fontSize: 12, color: 'rgba(210,150,165,.9)' }}>Link expired — tap to try again.</p>}
      {phase === 'error' && <p style={{ fontSize: 12, color: 'rgba(210,150,165,.9)' }}>Something went wrong — try again.</p>}
      <p className="mono" style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: 1 }}>ADMIN ONLY · ADMIN_TG_USERNAMES</p>
    </main>
  );
}
export const secH: CSSProperties = { fontSize: 12, margin: 0, letterSpacing: 1.4, color: 'var(--muted)' };
export const warnBox: CSSProperties = { border: '1px solid rgba(255,107,138,.45)', background: 'rgba(255,107,138,.08)', borderRadius: 10, padding: '10px 13px', fontSize: 12, color: 'rgba(210,150,165,.95)' };
export const dimP: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dim)' };
export const td: CSSProperties = { padding: '8px 10px', verticalAlign: 'top' };
export const inp: CSSProperties = { padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 13, outline: 'none' };
export const okBtn: CSSProperties = { border: '1px solid rgba(31,216,176,.45)', background: 'rgba(31,216,176,.1)', color: 'var(--up)', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' };
export const goldBtn: CSSProperties = { border: '1px solid rgba(245,194,74,.45)', background: 'rgba(245,194,74,.08)', color: 'var(--gold)', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' };
export const dangerBtn: CSSProperties = { border: '1px solid rgba(255,107,138,.4)', background: 'transparent', color: 'rgba(210,150,165,.85)', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
export const miniBtn: CSSProperties = { border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', borderRadius: 6, padding: '1px 8px', fontSize: 10, cursor: 'pointer' };


/** Écran étroit (téléphone) ? — l'admin est utilisé « à 70 % sur le téléphone » : les tableaux à 9 colonnes
 *  deviennent des cartes, les champs prennent toute la largeur. false au premier rendu (SSR), puis suivi live. */
export function useNarrow(maxPx = 720): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxPx}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [maxPx]);
  return narrow;
}
