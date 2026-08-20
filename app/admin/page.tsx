'use client';
// ALGORIA ADMIN — le back-office CRM de l'opérateur (admin.algoria.tech). Desktop-first, hors coque membre.
// 6 espaces : DASHBOARD (les chiffres qui comptent), QUEUE (à appliquer dans Social Trade Hub),
// MEMBERS (le CRM : recherche, statuts, comptes), DEPOSITS (le registre des dépôts broker → bilan
// mensuel exportable en CSV), AFFILIATE (l'argent des parrains), TOOLS (whitelist, push).
// Garde : l'API /api/member/admin renvoie 403 à quiconque n'est pas dans ADMIN_TG_USERNAMES — cette page
// n'est qu'une façade. Session : le même login Telegram que l'espace membre.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { drawWinCard, drawRecapCard, shareOrDownloadCard } from '@/lib/cards/winCard';
import { openTelegram } from '@/lib/telegram';
import { BROKERS } from '@/lib/member/brokers';
import { LOT_CHOICES, LOT_MAX } from '@/lib/member/lots';
import { estimateCommission, rankBrokersByCommission } from '@/lib/member/commissions';

interface WL { username: string; added_by: string | null; created_at: string }
interface Row {
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
const personalise = (text: string, name?: string | null): string => {
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
// ===== ANNONCE S1 → S2 (20/08/2026) ====================================================================
// Demande de Mathieu : prévenir les membres basculés, « sans phrase trop inquiétante » — on annonce la
// maintenance et la migration, pas un post-mortem.
//
// TON : court et calme. La première version détaillait le défaut de construction (caps journaliers
// asymétriques) ; Mathieu l'a jugée trop lourde, et il a raison — le membre n'a rien à faire, il n'a pas
// besoin d'un rapport d'incident. On dit ce qui change et ce qui ne change pas, point.
//
// LA PHRASE SUR S2 EST UN FAIT PASSÉ, VÉRIFIABLE, JAMAIS UNE PROJECTION. « solidly positive these last
// few weeks » = +8 519$ master sur 4 semaines, dont +8 254$ sur la dernière. On évite délibérément « la
// meilleure des trois » : sur 7 jours c'est S3 qui mène (+881$ contre +825$ à 0,1 lot), et le membre a ce
// comparatif SOUS LES YEUX dans l'app — une phrase que son propre écran contredit coûte plus cher que le
// silence. Et jamais de promesse sur la suite : un « maintenant ça va gagner » se ressort trois semaines
// plus tard.
const S1_TO_S2_ANNOUNCE = `Hey{name} 👋

Quick update on your account — nothing for you to do.

We are putting <b>S1 STEADY</b> into maintenance after its recent results, and moving you over to <b>S2 BALANCED</b>, our reference profile, <b>at no extra cost</b>.

S2 has been solidly positive these last few weeks, and it is the engine behind the track record we publish.

Nothing changes on your side: same account, same broker, same lot size. The copying carries on automatically on S2 — you will see it in the app.

Any question, just reply here.

— Mathieu`;

const CTA_TEMPLATES: Array<{ id: string; label: string; target: 'app' | 'mathieu'; text: string; btn: string; url: string }> = [
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

const SCRIPTS: Record<string, string> = {
  deposited:
    "Hey! Mathieu here, from Algoria. I can see your deposit came through — thank you, and sorry you had to wait.\n\nYour account just isn't connected to the copier yet, so the AI isn't trading for you. That's on us to finish and it takes 2 minutes. Can you confirm the broker and account number you funded, and I'll switch it on right now?",
  rejected:
    "Hey! Mathieu from Algoria. Your account connection didn't go through — and I want to be clear it's not you being refused, it's almost always one detail that doesn't match.\n\nMost of the time it's the password: MetaTrader needs your TRADING password (the one the broker emailed you when the account was created), not the one you use on the broker's website. Send me your account number and I'll check what's blocking it on my side.",
  first:
    "Hey! Mathieu here — I'm the founder of Algoria, the AI that trades gold and Bitcoin live. You created an account on our app a few days ago (that's how I have your name), but never finished setting it up.\n\nNo pressure at all — I'm just going through the list one by one. Are you still interested? If you've lost the channel, tell me and I'll send you the invite back.",
  followup:
    "Hey! Following up on our conversation — where are you at with your setup?\n\nIf something's blocking you, tell me what it is and I'll sort it out. Algoria's been trading every day in the meantime.",
};

interface Action { id: string; tg_id?: number; member_no: number | null; kind: string; status?: string; done_by?: string | null; detail: Record<string, unknown> | null; created_at: string }
interface Comm { id: string; referrer_tg_id: number; referred_tg_id: number | null; kind: string; amount: number; status: string; reason: string | null; detail: Record<string, unknown> | null; created_at: string }
interface Payout { id: string; tg_id: number; amount: number; address: string; status: string; tx_hash: string | null; reason: string | null; created_at: string }
interface Affiliate { pendingCommissions: Comm[]; recentCommissions: Comm[]; pendingPayouts: Payout[]; recentPayouts: Payout[]; owedUsd: number; flagged: { tg_id: number; balance: number; username: string | null; member_no: number | null }[] }
// registre des dépôts broker (bilan mensuel) — porté par member_actions kind='deposit'
interface Deposit {
  id: string; tg_id: number; member_no: number | null; created_at: string;
  // booked_ym : mois COMPTABLE quand il diffère de celui du dépôt (report d'une com pas encore validée)
  detail: { broker?: string | null; amount_usd?: number; commission_usd?: number; commission_status?: string; note?: string | null; deposited_at?: string; booked_ym?: string | null } | null;
}

type Tab = 'dashboard' | 'queue' | 'members' | 'deposits' | 'affiliate' | 'tools';

export default function AdminCRM() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [wl, setWl] = useState<WL[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [aff, setAff] = useState<Affiliate | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden' | 'anon'>('loading');
  // pseudo Telegram de la session refusée : LE renseignement qui manquait pour sortir de la boucle
  const [deniedAs, setDeniedAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [creds, setCreds] = useState<Record<string, { login: string; server: string; password: string }>>({});
  const [selCreds, setSelCreds] = useState<{ login: string; server: string; password: string } | null>(null);
  // ===== registre des dépôts : mois affiché + formulaire de saisie =====
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [pushTgIds, setPushTgIds] = useState<number[]>([]); // tg_id ayant au moins 1 appareil abonné aux alertes
  const [nudges, setNudges] = useState<{ tg_id: number; created_at: string; done_by?: string }[]>([]); // historique des relances (auto + manuelles)
  // SEGMENTATION de la file du jour : qui a déjà écrit au bot, qui s'est fait refuser une connexion.
  const [spokeTgIds, setSpokeTgIds] = useState<number[]>([]);
  const [rejectedTgIds, setRejectedTgIds] = useState<number[]>([]);
  const [relSeg, setRelSeg] = useState<string | null>(null); // onglet de segment choisi (null = le plus prioritaire non vide)
  const [copiedScript, setCopiedScript] = useState<string | null>(null);
  // COMPOSEUR DE POST CANAL (avec bouton) — Telegram n'autorise un clavier inline QUE via un bot.
  const [cpText, setCpText] = useState('');
  const [cpBtn, setCpBtn] = useState('🚀 OPEN ALGORIA');
  const [cpUrl, setCpUrl] = useState('https://app.algoria.tech/member');
  const [cpChat, setCpChat] = useState<string>('');
  const [cpReport, setCpReport] = useState<Array<{ channel: string; ok: boolean; error?: string }> | null>(null);
  // 📣 ANNONCE GROUPÉE VIA LE BOT — prévenir un segment entier d'un changement, en une fois.
  // Le texte par défaut est celui du basculement S1 → S2 du 20/08. L'étiquette (tag) sert d'anti-doublon
  // côté serveur : quiconque l'a déjà reçue est sauté, donc un second clic ne renvoie rien à personne.
  const [bcText, setBcText] = useState(S1_TO_S2_ANNOUNCE);
  const [bcTag, setBcTag] = useState('s1-to-s2-2026-08-20');
  const [bcAudience, setBcAudience] = useState<'ex_s1' | 'live'>('ex_s1');
  const [bcReport, setBcReport] = useState<{ sent: number; skipped: number; failed: number; report: Array<{ member_no: number | null; ok: boolean; error?: string; skipped?: boolean }> } | null>(null);
  const sendBroadcast = () => {
    if (!bcText.trim() || !bcTag.trim()) return;
    const who = bcAudience === 'ex_s1' ? 'the members still awaiting their S1 → S2 move' : 'ALL live + paused members';
    if (!window.confirm(`Send this message through the bot to ${who}?\n\nAnyone who already received the tag "${bcTag}" is skipped automatically.`)) return;
    setBusy(true);
    setBcReport(null);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botBroadcast: { audience: bcAudience, text: bcText, tag: bcTag } }) })
      .then(async (r) => {
        const d = (await r.json()) as { error?: string; sent?: number; skipped?: number; failed?: number; report?: Array<{ member_no: number | null; ok: boolean; error?: string; skipped?: boolean }> };
        if (d.error) return window.alert(`⚠ ${d.error}`);
        setBcReport({ sent: d.sent ?? 0, skipped: d.skipped ?? 0, failed: d.failed ?? 0, report: d.report ?? [] });
        load();
      })
      .finally(() => setBusy(false));
  };
  const [runnerLastSeen, setRunnerLastSeen] = useState<number | null>(null); // heartbeat runner (dernière bougie écrite)
  const [legalNames, setLegalNames] = useState<Record<string, string>>({}); // tg_id → nom légal broker (kyc) : LE pont entre les 3 identités
  // comptes SUPPLÉMENTAIRES (multi-stratégies) — affichés sur la fiche membre (broker + stratégie + statut + STH id)
  const [extraAccounts, setExtraAccounts] = useState<Array<{ id: string; tg_id: number; account_no: number; broker: string | null; strategy: number; status: string; mt5_login: string | null; declared_deposit: number | null }>>([]);
  // 🤖 BOT ACTIVITY : fil envoyé (nudge, texte du DM) / reçu (bot_reply) — visibilité totale sur le bot
  const [botActivity, setBotActivity] = useState<Array<{ id: string; tg_id: number; member_no: number | null; kind: string; detail: Record<string, unknown> | null; created_at: string }>>([]);
  const [tgInboxOn, setTgInboxOn] = useState(false); // état réel du webhook Telegram (getWebhookInfo)
  // 🌍 FILTRE MARCHÉ (01/08 — ouverture de l'Italie, deux entités comptables séparées) : 'all' | 'en' | 'it'.
  // Il pilote la liste des membres ET le registre des dépôts : « où en est l'Italie ce mois-ci ? » devient
  // une question à un clic, et l'export CSV suit le filtre (une compta par marché).
  const [market, setMarket] = useState<'all' | 'en' | 'it'>('all');
  const localeOf = (tg: number | null | undefined) => String(rows.find((r) => Number(r.tg_id) === Number(tg))?.locale ?? 'en');
  // 🎁 CAMPAGNE PROSPECTS : texte pré-rempli avec l'offre de fin de mois (éditable avant envoi)
  const [blastText, setBlastText] = useState(
    [
      '🎁 <b>Last day of the month — exclusive offer</b>',
      '',
      'Fund your account today and RaiseFX <b>doubles your deposit in trading credit</b> with the code <b>ALGORIA100</b>.',
      'Deposit $300 → the AI trades with $600 of buying power.',
      '',
      '⏳ <b>Valid until midnight tonight.</b>',
      '',
      'Remember:',
      '• Start from $200 (STEADY strategy)',
      '• YOUR money stays in YOUR broker account — withdraw anytime',
      '• Risk is capped every single day',
      '• Algoria itself stays <b>completely free</b>',
      '',
      '👉 app.algoria.tech/member/onboarding',
      'Need a hand? Message @mathieu_algoria — he does this all day.',
    ].join('\n'),
  );
  const [blastTitle, setBlastTitle] = useState('🎁 Last day: 100% deposit bonus');
  const [blastBody, setBlastBody] = useState('Code ALGORIA100 at RaiseFX — doubles your deposit. Until midnight.');
  // 📣 attribution des demandes d'adhésion par lien d'invitation nommé (une campagne = un lien)
  const [joinSources, setJoinSources] = useState<Array<{ source: string; n: number; accepted: number; dmSent: number; dmFailed: number; last: string }>>([]);
  // canaux où le bot est admin, avec leur ID -100… (invisible dans Telegram) et le rôle qu'ils jouent
  const [tgChats, setTgChats] = useState<Array<{ chat_id: number; title: string | null; type: string | null; username: string | null; last_seen_at: string; role: string | null }>>([]);
  const [chatCopied, setChatCopied] = useState<number | null>(null);
  // audit STH : lignes renvoyees par /api/member/admin (sthAudit) — etat reel de la copie chez STH
  const [sthAudit, setSthAudit] = useState<{ rows: Array<{ member_no: number | null; name: string; state: string; detail: string }>; summary: Record<string, number> } | null>(null);
  const [botDrafts, setBotDrafts] = useState<Record<string, string>>({}); // brouillons de réponse via le bot (par ligne du fil)
  const [ym, setYm] = useState(() => new Date().toISOString().slice(0, 7)); // 'YYYY-MM' du bilan affiché
  const [depTg, setDepTg] = useState('');
  const [depBroker, setDepBroker] = useState('');
  const [depAmount, setDepAmount] = useState('');
  const [depCom, setDepCom] = useState('');
  // true = le champ com est vide ou contient une valeur auto (barème) → on peut le réécrire quand
  // broker/montant changent ; une saisie manuelle le fige (la vider le réarme). Ref et pas state :
  // aucun rendu à déclencher, juste un verrou lu par l'effet de pré-remplissage.
  const depComAuto = useRef(true);
  const [depDate, setDepDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [depNote, setDepNote] = useState('');
  // ===== BEST LINK (DEPOSITS) : « il veut mettre X $, quel broker lui envoyer ? » =====
  const [planAmount, setPlanAmount] = useState('');
  const [planTg, setPlanTg] = useState(''); // prospect optionnel → exclut ses brokers existants
  const [planCopied, setPlanCopied] = useState<string | null>(null); // key du lien copié (feedback ✓)
  // ===== QUEUE : « copier les infos dépôt » → un message prêt à COLLER dans le groupe WhatsApp du
  // staff (vérification CellXpert chez le broker). Format calqué sur les messages actuels de Mathieu :
  // entête + nom broker + login MT + broker + montant. Le staff répond ✅/« je le vois pas » → CONNECT (STH).
  const [depInfoCopied, setDepInfoCopied] = useState<string | null>(null); // id de la carte copiée (feedback ✓)
  // ===== push composer (TOOLS) : message libre + segment ciblé =====
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushUrl, setPushUrl] = useState('/member');
  const [pushAud, setPushAud] = useState<'self' | 'prospects' | 'live' | 'all'>('self');
  const [pushResult, setPushResult] = useState<string | null>(null);
  // ===== fiche membre (MEMBERS) : timeline complète + notes privées =====
  const [sel, setSel] = useState<Row | null>(null);
  const [selActs, setSelActs] = useState<Action[] | null>(null);
  const [noteText, setNoteText] = useState('');
  // ===== win card studio (TOOLS) : les gains récents du compte maître, à télécharger pour la CM =====
  const [feedWins, setFeedWins] = useState<{ ticket: string; symbol: string; direction: string; pnl: number; closed_at: string }[]>([]);
  const [carding, setCarding] = useState<string | null>(null);
  // stats jour/semaine (wins only, API publique) — alimentent les cartes RÉCAP du studio
  const [proof, setProof] = useState<{ today: { count: number; total: number; best: number }; week: { count: number; total: number; best: number } } | null>(null);

  const load = () =>
    void fetch('/api/member/admin').then(async (r) => {
      // 401 = aucune session · 403 = session mais pas admin. Les DEUX ouvrent la porte de connexion admin
      // (au lieu d'un cul-de-sac) — mais l'accès reste réservé à ADMIN_TG_USERNAMES : un autre compte
      // se reconnecte, se refait renvoyer en 403, et ne voit jamais le CRM. Sécurité intacte, porte ajoutée.
      if (r.status === 401) return setState('anon');
      if (r.status === 403) {
        const d = (await r.json().catch(() => ({}))) as { username?: string | null };
        setDeniedAs(d.username ?? null);
        return setState('forbidden');
      }
      const d = (await r.json()) as { whitelist: WL[]; members: Row[]; actions: Action[]; affiliate?: Affiliate; deposits?: Deposit[]; pushTgIds?: number[]; nudges?: { tg_id: number; created_at: string; done_by?: string }[]; spokeTgIds?: number[]; rejectedTgIds?: number[] };
      setWl(d.whitelist);
      setRows(d.members);
      setActions(d.actions ?? []);
      setAff(d.affiliate ?? null);
      setDeposits(d.deposits ?? []);
      setPushTgIds(d.pushTgIds ?? []);
      setNudges(d.nudges ?? []);
      setSpokeTgIds(d.spokeTgIds ?? []);
      setRejectedTgIds(d.rejectedTgIds ?? []);
      setRunnerLastSeen((d as { runnerLastSeen?: number | null }).runnerLastSeen ?? null);
      setLegalNames((d as { legalNames?: Record<string, string> }).legalNames ?? {});
      setExtraAccounts(((d as unknown as { extraAccounts?: typeof extraAccounts }).extraAccounts) ?? []);
      setBotActivity(((d as unknown as { botActivity?: typeof botActivity }).botActivity) ?? []);
      setTgInboxOn(!!(d as unknown as { tgInboxOn?: boolean }).tgInboxOn);
      setJoinSources((d as unknown as { joinSources?: Array<{ source: string; n: number; accepted: number; dmSent: number; dmFailed: number; last: string }> }).joinSources ?? []);
      setTgChats(((d as unknown as { tgChats?: typeof tgChats }).tgChats) ?? []);
      setState('ok');
    });
  useEffect(() => { load(); const iv = setInterval(load, 30_000); return () => clearInterval(iv); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // gains récents pour le WIN CARD STUDIO — le feed membre renvoie tout à une session admin
  useEffect(() => {
    void fetch('/api/member/feed').then(async (r) => {
      if (!r.ok) return;
      const d = (await r.json()) as { trades?: { ticket: string; symbol: string; direction: string; pnl: number; closed_at: string }[] };
      setFeedWins((d.trades ?? []).filter((t) => Number(t.pnl) > 0).slice(0, 8));
    });
    void fetch('/api/public/proof').then(async (r) => {
      if (!r.ok) return;
      const d = (await r.json()) as { today: { count: number; total: number; best: number }; week: { count: number; total: number; best: number } };
      setProof(d);
    });
  }, []);
  const downloadRecap = async (period: 'day' | 'week', format: 'story' | 'landscape') => {
    if (!proof) return;
    const s = period === 'day' ? proof.today : proof.week;
    const fmtD = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    setCarding(`${period}-${format}`);
    try {
      const blob = await drawRecapCard({
        periodLabel: period === 'day' ? "TODAY'S SESSION" : 'THIS WEEK', format,
        count: s.count, total: s.total, best: s.best,
        dateLabel: period === 'day' ? fmtD(Date.now()) : `${fmtD(Date.now() - 7 * 86_400_000)} – ${fmtD(Date.now())}`,
        qrUrl: 'https://algoria.tech', qrLabel: 'algoria.tech',
      });
      await shareOrDownloadCard(blob, `algoria-${period}-recap-${format === 'landscape' ? 'wide' : 'story'}.png`);
    } finally {
      setCarding(null);
    }
  };
  const downloadCard = async (t: { ticket: string; symbol: string; direction: string; pnl: number; closed_at: string }, format: 'story' | 'landscape') => {
    setCarding(`${t.ticket}-${format}`);
    try {
      const blob = await drawWinCard({ symbol: t.symbol, direction: t.direction, pnl: Number(t.pnl), closedAt: t.closed_at, format, qrUrl: 'https://algoria.tech', qrLabel: 'algoria.tech' });
      await shareOrDownloadCard(blob, `algoria-win-${t.ticket}-${format === 'landscape' ? 'wide' : 'story'}.png`);
    } finally {
      setCarding(null);
    }
  };

  const post = (body: Record<string, unknown>, cb?: () => void) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async (r) => { const d = (await r.json()) as { error?: string }; if (d.error) window.alert(d.error); cb?.(); load(); })
      .finally(() => setBusy(false));
  };
  const reveal = (id: string) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reveal: id }) })
      .then(async (r) => { const d = (await r.json()) as { login?: string; server?: string; password?: string }; if (d.password) setCreds((c) => ({ ...c, [id]: { login: d.login ?? '', server: d.server ?? '', password: d.password! } })); })
      .finally(() => setBusy(false));
  };
  const cancelCommission = (id: string) => { const reason = window.prompt('Cancel reason (e.g. "client withdrew deposit"):'); if (reason !== null) post({ cancelCommission: id, reason }); };
  const payPayout = (id: string) => { const tx = window.prompt('USDT sent? Paste the TRC20 transaction hash:'); if (tx?.trim()) post({ payoutPaid: id, tx: tx.trim() }); };
  const rejectPayout = (id: string) => { const reason = window.prompt('Reject reason (shown to the member):'); if (reason !== null) post({ payoutReject: id, reason }); };
  // refuser une CONNEXION (vérification broker échouée) : le membre repasse en onboarding avec la raison — jamais bloqué
  const rejectConnect = (id: string) => { const reason = window.prompt('Decline reason (shown to the member, e.g. "no deposit found under this name"):'); if (reason !== null && reason.trim()) post({ rejectConnect: id, reason }); };
  // EN ATTENTE DU BROKER — le cas « compte préexistant non rattaché à notre numéro d'affilié » : il
  // n'apparaît pas dans le dashboard partenaire, et seul le titulaire peut demander le rattachement au
  // support du broker. Le délai est chez le broker, pas chez nous. Marquer l'attente évite que la carte se
  // lise comme oubliée — et que la surveillance alerte sur un dossier déjà traité. Deuxième clic = attente
  // levée. Rien n'est envoyé au membre : ce marquage est une note interne, pas une décision.
  const waitBroker = (a: Action) => {
    const waiting = a.detail?.waiting_broker != null;
    if (waiting) { if (window.confirm('Broker replied — clear the “waiting on broker” flag?')) post({ waitBroker: a.id }); return; }
    const note = window.prompt('⏳ Waiting on the broker to attach this account to your affiliate ID.\n\nOptional note (e.g. "support ticket opened 17/08, member contacted them"):', '');
    if (note !== null) post({ waitBroker: a.id, reason: note });
  };
  const liveAlert = () => { if (window.confirm('Send "🔴 ALGORIA IS LIVE" to every subscribed member?')) post({ liveAlert: true }); };
  // révéler les identifiants d'un membre À TOUT MOMENT (déchiffrés côté serveur, tracés en timeline)
  const showCreds = (tgId: number) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revealMember: tgId }) })
      .then(async (r) => { const d = (await r.json()) as { login?: string; server?: string; password?: string; error?: string }; if (d.error) window.alert(d.error); else if (d.password) setSelCreds({ login: d.login ?? '', server: d.server ?? '', password: d.password }); })
      .finally(() => setBusy(false));
  };
  // ENREGISTREMENT DU DÉPÔT dans la foulée de la connexion (demande Mathieu 28/07 : « à 5 dépôts/jour
  // je me perds entre valider, connecter, vérifier ») : un seul prompt, pré-rempli avec le montant
  // DÉCLARÉ — corriger si CellXpert dit autre chose. La com attendue vient du barème (estimateCommission).
  // Annuler = pas de ligne (le filet « LIVE sans dépôt » du registre DEPOSITS la rattrapera).
  const recordDepositAfterConnect = (a: Action) => {
    const m = rows.find((r) => Number(r.tg_id) === Number(a.tg_id));
    const broker = String(a.detail?.broker ?? m?.broker ?? '').trim().toLowerCase() || null;
    const declared = Number(a.detail?.declared_deposit ?? 0) || null;
    const v = window.prompt(
      `🏦 Log the deposit now? Validated amount ($)\n\nBroker: ${broker ? broker.toUpperCase() : '?'} — expected com auto from the schedule.\nCancel = no line (it will show up in DEPOSITS → "live, no deposit logged").`,
      declared ? String(declared) : '',
    );
    if (v === null) return;
    const amount = Number(v);
    if (!Number.isFinite(amount) || amount <= 0) return window.alert('Invalid amount — no deposit logged. Add it in DEPOSITS.');
    // garde anti-doublon : même membre, même montant, même jour → la ligne existe déjà (double clic, DONE après CONNECT…)
    const today = new Date().toISOString().slice(0, 10);
    const dup = deposits.some((d) => Number(d.tg_id) === Number(a.tg_id) && Number(d.detail?.amount_usd ?? 0) === amount && String(d.detail?.deposited_at ?? d.created_at).slice(0, 10) === today);
    if (dup) return window.alert('Already logged today for this member (same amount) — nothing added.');
    const commission = estimateCommission(broker, amount);
    // LE PAYS DANS LA MÊME FOULÉE (17/08). Avant : valider le dépôt, puis RETOURNER dans le CRM chercher le
    // membre pour renseigner son pays. À quatre ou cinq clients par jour, autant d'allers-retours pour une
    // donnée qu'on tient déjà — et c'est cette friction qui a laissé 472 fiches sur 516 sans pays.
    // Le pays détecté à l'inscription (geo:<iso2>) est PRÉ-REMPLI : dans le cas normal il n'y a plus qu'à
    // valider. On ne demande rien si le pays est déjà connu, et laisser vide n'annule pas le dépôt — le
    // pays est une donnée de compta, il ne doit jamais bloquer l'enregistrement d'un encaissement.
    let country: string | null = null;
    if (!m?.country) {
      const guess = geoCountryOf(m?.source);
      const c = window.prompt(
        `🌍 Country of this member?\n\n${guess ? `Detected at signup: ${guess} — press OK to accept.` : 'Not detected (VPN, or member created before geo capture) — type it.'}\n\nAd geos: South Africa · New Zealand · Australia · UK · UAE\nLeave empty to skip (the deposit is logged either way).`,
        guess ?? '',
      );
      const v = (c ?? '').trim();
      // on réaligne la casse sur la liste : « south africa » tapé à la main doit devenir « South Africa »,
      // sinon l'export compta et les regroupements par pays se retrouvent avec deux libellés pour un pays.
      if (v) country = COUNTRIES.find((x) => x.toLowerCase() === v.toLowerCase()) ?? v;
    }
    post(
      { addDeposit: { tg_id: Number(a.tg_id), broker: broker ?? undefined, amount, commission: commission ?? 0, note: 'logged at connect' } },
      country ? () => post({ setCountry: { tg_id: Number(a.tg_id), country } }) : undefined,
    );
  };
  // connexion AUTO via STH : branche le compte dans le copieur, puis enchaîne `done` (passage LIVE) si OK,
  // puis propose d'enregistrer le dépôt (un prompt) — les 3 gestes en un seul clic.
  const connectViaSth = (a: Action) => {
    if (!window.confirm('Connect this account to the copier via STH now?\n\nVerify the deposit first — on success the member goes LIVE.')) return;
    const id = a.id;
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectSth: id }) })
      .then(async (r) => { const d = (await r.json()) as { ok?: boolean; error?: string }; setBusy(false); if (d.error) return window.alert(d.error); post({ done: id }, () => { setCreds((c) => { const n = { ...c }; delete n[id]; return n; }); recordDepositAfterConnect(a); }); })
      .catch(() => setBusy(false));
  };
  // RE-connexion STH depuis la fiche membre (ex. déconnecté par erreur sur le dashboard STH) : identifiants
  // déjà en base — rien à ressaisir, ne touche pas au statut du membre.
  const reconnectSth = (r: Row) => {
    const who = r.tg_username ? '@' + r.tg_username : (r.tg_name ?? `#${r.member_no}`);
    if (!window.confirm(`Re-connect ${who} to the STH copier?\n\nUses the credentials on file — nothing to retype. Their account re-joins their strategy's master.`)) return;
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reconnectSth: r.tg_id }) })
      .then(async (res) => { const d = (await res.json()) as { ok?: boolean; error?: string }; window.alert(d.error ?? '✓ re-connected to the copier'); })
      .finally(() => setBusy(false));
  };
  // vérité STH (diagnostic) : compte MT connecté au copieur ? masters visibles + abonnements — direct depuis leur API
  const sthCheck = (tgId: number) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sthStatusCheck: tgId }) })
      .then(async (r) => {
        const d = (await r.json()) as { connected?: boolean; masters?: Array<Record<string, unknown>>; error?: string };
        if (d.error) return window.alert(d.error);
        // « géré par l'API » = liste de masters non vide ; le flag connected (bridge MT instantané) peut traîner
        const known = (d.masters ?? []).length > 0;
        const subs = (d.masters ?? []).filter((m) => m.userIsSubscribed === true).map((m) => String(m.name ?? m.id));
        window.alert(`STH status (live from their API)\n\nAPI-managed: ${known ? '✅ YES' : '❌ NO (manually-added receiver or never connected)'}\nSubscribed to: ${subs.join(', ') || '(none)'}\nMT bridge right now: ${d.connected ? '✅ up' : '⚠ down/lagging (STH-side flag)'}\n\nMasters:\n${(d.masters ?? []).map((m) => '• ' + JSON.stringify(m)).join('\n') || '(none visible)'}`);
      })
      .finally(() => setBusy(false));
  };
  // PAYS du membre (compta fin de mois + ciblage pubs) — dropdown des pays principaux + « other… » libre.
  // Le pays vit sur le MEMBRE (les dépôts l'héritent) ; éditable depuis la fiche ET les lignes DEPOSITS (rattrapage).
  // LES PAYS CIBLÉS PAR LES PUBS D'ABORD (17/08) : South Africa et New Zealand manquaient à la liste, donc
  // les premiers dépôts venus de ces deux campagnes ont dû être classés en « other… » et tapés à la main.
  // Un pays visé par une campagne doit être à un clic — c'est lui qu'on saisira le plus souvent.
  // Le reste de la liste couvre les pays déjà présents en base plus les marchés voisins évidents.
  const COUNTRIES = [
    'South Africa', 'New Zealand', 'Australia', 'UK', 'UAE', // les cinq géos des sets de pub
    'USA', 'Canada', 'Ireland', 'Germany', 'France', 'Italy', 'Spain', 'Portugal',
    'Netherlands', 'Belgium', 'Switzerland', 'Malta', 'Singapore', 'Philippines', 'India', 'Nigeria', 'Kenya',
  ];
  // geo:<iso2> → libellé de la liste. Le code pays est posé à la CRÉATION de la fiche depuis l'en-tête
  // Vercel (voir lib/member/login.ts) : il sert ici de valeur PAR DÉFAUT au moment de valider le dépôt.
  const GEO_LABEL: Record<string, string> = {
    za: 'South Africa', nz: 'New Zealand', au: 'Australia', gb: 'UK', ae: 'UAE',
    us: 'USA', ca: 'Canada', ie: 'Ireland', de: 'Germany', fr: 'France', it: 'Italy', es: 'Spain', pt: 'Portugal',
    nl: 'Netherlands', be: 'Belgium', ch: 'Switzerland', mt: 'Malta', sg: 'Singapore', ph: 'Philippines', in: 'India', ng: 'Nigeria', ke: 'Kenya',
  };
  const geoCountryOf = (src: string | null | undefined): string | null => {
    const m = /^geo:([a-z]{2})$/.exec(String(src ?? '').toLowerCase());
    return m ? GEO_LABEL[m[1]] ?? null : null;
  };
  const setCountry = (tgId: number, value: string) => {
    const country = value === '__other' ? (window.prompt('Country?') ?? '').trim() : value;
    if (value === '__other' && !country) return;
    post({ setCountry: { tg_id: tgId, country } });
  };
  const countrySelect = (tgId: number, current: string | null, source?: string | null) => {
    // Pays DÉTECTÉ à l'inscription, proposé en tête de liste quand la case est vide : un clic au lieu d'une
    // recherche dans vingt-deux entrées. Marqué « (detected) » — c'est une déduction sur IP, pas une
    // certitude, et rien n'est écrit en base avant que Mathieu ne l'ait choisi.
    const guess = current ? null : geoCountryOf(source);
    return (
      <select
        disabled={busy}
        value={current && !COUNTRIES.includes(current) ? '__custom' : (current ?? '')}
        onChange={(e) => { if (e.target.value !== '__custom') setCountry(tgId, e.target.value); }}
        className="mono"
        title="member's country (for the monthly accounting export + ads targeting)"
        style={{ fontSize: 10.5, padding: '3px 6px', borderRadius: 7, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: current ? 'var(--text)' : 'var(--dim)', cursor: 'pointer' }}
      >
        <option value="">🌍 country…</option>
        {guess && <option value={guess}>✨ {guess} (detected)</option>}
        {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        {current && !COUNTRIES.includes(current) && <option value="__custom">{current}</option>}
        <option value="__other">other…</option>
      </select>
    );
  };
  // changement de stratégie en un clic : join STH déclaratif → le receiver bascule sur le master de la nouvelle
  // stratégie, puis `done` clôt la carte. Membres ajoutés à la main dans STH → erreur explicite (à faire à la main).
  const moveViaSth = (id: string) => {
    if (!window.confirm("Move this member to their NEW strategy's master via STH now?\n\nWorks for API-connected members. Manually-added receivers must be moved in the STH dashboard (the card shows their STH id).")) return;
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moveSth: id }) })
      .then(async (r) => { const d = (await r.json()) as { ok?: boolean; error?: string }; setBusy(false); if (d.error) return window.alert(d.error); post({ done: id }); })
      .catch(() => setBusy(false));
  };
  // off-board : le client est parti → paused + déconnexion copieur + note (le kick du canal Telegram reste manuel)
  const offboard = (r: Row) => {
    const who = r.tg_username ? '@' + r.tg_username : (r.tg_name ?? `#${r.member_no}`);
    if (!window.confirm(`Off-board ${who}?\n\n• status → paused\n• copier disconnect queued (remove from STH)\n• DON'T FORGET to remove them from the VIP Telegram channel (manual)`)) return;
    post({ offboard: r.tg_id }, () => setSel((s) => (s ? { ...s, status: 'paused' } : s)));
  };

  // 🚫 BAN / UNBAN — révoque l'accès app d'un compte (concurrent qui copie, abus). Confirmation obligatoire :
  // c'est visible côté client (il tombe sur « accès refusé »), donc jamais sur un clic accidentel.
  const banMember = (r: Row, undo: boolean) => {
    const who = r.tg_username ? '@' + r.tg_username : (r.tg_name ?? `#${r.member_no}`);
    if (undo) {
      if (!window.confirm(`Lift the ban on ${who}?\n\nThey'll be able to sign in again. The copier is NOT reconnected automatically.`)) return;
      post({ ban: { tg_id: r.tg_id, undo: true } }, () => setSel((s) => (s ? { ...s, banned_at: null } : s)));
      return;
    }
    const reason = window.prompt(`🚫 BAN ${who}?\n\n• kills their current session AND blocks any new sign-in\n• disconnects the copier\n• removes them from the VIP whitelist\n\nReason (kept in their timeline):`, 'competitor / scraping the app');
    if (reason === null) return;
    post({ ban: { tg_id: r.tg_id, reason } }, () => setSel((s) => (s ? { ...s, banned_at: new Date().toISOString(), status: 'paused' } : s)));
  };
  const nameOf = (tg: number | null | undefined) => {
    const m = rows.find((r) => Number(r.tg_id) === Number(tg));
    return m ? (m.tg_username ? '@' + m.tg_username : `#${m.member_no}`) : tg == null ? '—' : String(tg);
  };
  // nom légal (compte broker) d'un membre — la clé pour rapprocher Telegram ↔ admin ↔ broker/STH
  const legalOf = (tg: number | null | undefined) => (tg != null ? legalNames[String(tg)] ?? null : null);
  // ÉDITER LE NOM DU TITULAIRE — le membre le saisit au wizard et se trompe (vu : « VTMarkets » à la place
  // du nom de la personne). Ce champ relie son pseudo Telegram, son compte broker et la ligne de commission :
  // faux, on ne retrouve plus son dépôt. On ajoute une correction, on n'écrase pas la saisie d'origine.
  const editLegalName = (tg: number | null | undefined, current: string | null) => {
    if (tg == null) return;
    const v = window.prompt('Name on the broker account (as written at the broker — this is what links his deposit to him):', current ?? '');
    if (v === null) return;
    if (v.trim().length < 2) { window.alert('Enter the real full name.'); return; }
    post({ setLegalName: { tg_id: Number(tg), name: v.trim() } });
  };

  // ===== CORRIGER UNE FICHE MEMBRE (03/08) — le tour complet des champs =====
  // Tout ce qui est saisi par le MEMBRE au wizard finit tôt ou tard faux : un caractère d'écart sur le
  // serveur MT et le copieur ne démarre jamais, une adresse USDT tronquée et le retrait part dans le vide,
  // un mauvais broker et la commission n'est pas réclamée au bon endroit. Ces champs n'étaient rattrapables
  // qu'en SQL. Ils le sont maintenant d'un clic, et chaque correction laisse « ancien → nouveau » en timeline.
  // `sync` remonte le résultat de la resynchronisation STH (stratégie/lot) : un échec DOIT sauter aux yeux,
  // sinon la fiche afficherait S1 pendant que le compte copie toujours S2 — le mensonge exact que l'audit
  // du 03/08 vient de débusquer.
  const editMember = (tg: number, field: string, value: string | null) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editMember: { tg_id: tg, field, value } }) })
      .then(async (r) => {
        const d = (await r.json()) as { error?: string; sync?: string | null };
        if (d.error) window.alert(d.error);
        else if (d.sync?.includes('FAILED')) window.alert(`Saved, BUT the copier was not re-synced:\n${d.sync}\n\nUse 🔗 RECONNECT STH.`);
        load();
      })
      .finally(() => setBusy(false));
  };
  // saisie libre (texte) — pointillés + « ✎ » : on voit du premier coup d'œil ce qui est rattrapable
  const editText = (tg: number, field: string, label: string, current: string | null, shown?: string, hint?: string) => (
    <button
      disabled={busy}
      onClick={() => { const v = window.prompt(hint ? `${label}\n\n${hint}` : label, current ?? ''); if (v !== null) editMember(tg, field, v.trim()); }}
      className="mono"
      title={`click to fix — ${label}`}
      style={{ fontSize: 11.5, fontWeight: 700, cursor: 'pointer', background: 'transparent', border: 'none', borderBottom: `1px dashed ${current ? 'rgba(130,152,190,.5)' : 'var(--border)'}`, padding: '0 1px', color: current ? 'var(--text)' : 'var(--dim)' }}
    >
      {shown ?? current ?? '—'} ✎
    </button>
  );
  // valeur à choisir dans une liste fermée (broker, marché, statut, stratégie, lot, serveur MT)
  const editPick = (tg: number, field: string, current: string, opts: Array<{ v: string; label: string }>, title: string, confirmMsg?: (v: string) => string) => (
    <select
      disabled={busy}
      value={current}
      onChange={(e) => { const v = e.target.value; if (v === current) return; if (confirmMsg && !window.confirm(confirmMsg(v))) return; editMember(tg, field, v); }}
      className="mono"
      title={title}
      style={{ fontSize: 10.5, padding: '3px 6px', borderRadius: 7, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: current ? 'var(--text)' : 'var(--dim)', cursor: 'pointer' }}
    >
      {!current && <option value="">—</option>}
      {opts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
  // SERVEUR MT — la chaîne doit être EXACTE au caractère près (« PUPrime-Live2 » ≠ « PUPrime-Live 2 »), donc
  // on propose d'abord les serveurs relevés chez le broker du membre, et la saisie libre reste ouverte pour
  // les brokers hors partenaires (où l'on n'a aucune liste).
  const serverPick = (r: Row) => {
    const known = BROKERS.find((b) => b.key === r.broker)?.servers ?? [];
    const cur = r.mt5_server ?? '';
    return (
      <select
        disabled={busy}
        value={known.includes(cur) ? cur : '__free'}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__free') { const t = window.prompt('MT server — EXACT string as shown at the broker (a single wrong character stops the copier):', cur); if (t !== null) editMember(r.tg_id, 'mt5_server', t); return; }
          editMember(r.tg_id, 'mt5_server', v);
        }}
        className="mono"
        title="MT server — must match the broker's string exactly, character for character"
        style={{ fontSize: 10.5, padding: '3px 6px', borderRadius: 7, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: cur ? 'var(--text)' : 'var(--dim)', cursor: 'pointer' }}
      >
        {known.map((s) => <option key={s} value={s}>{s}</option>)}
        <option value="__free">{known.includes(cur) ? 'type it…' : (cur || 'type it…')}</option>
      </select>
    );
  };
  // TAILLE DE COPIE — la grille 0.01→0.10 en accès rapide, plus une saisie libre jusqu'à LOT_MAX : elle
  // bridait les gros comptes à dix fois moins que ce que leur solde supporte (un client à plusieurs
  // milliers d'euros ne peut pas rester à 0.10). Même validation serveur que côté membre.
  const lotPick = (r: Row) => {
    const cur = r.lot != null ? String(Number(r.lot)) : '';
    const inGrid = LOT_CHOICES.some((l) => String(l) === cur);
    return (
      <select
        disabled={busy}
        value={inGrid ? cur : '__free'}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__free') { const t = window.prompt(`Copy size in lots (0.01 to ${LOT_MAX.toFixed(2)}, steps of 0.01) — re-synced to STH immediately:`, cur); if (t !== null && t.trim()) editMember(r.tg_id, 'lot', t.trim().replace(',', '.')); return; }
          if (window.confirm(`Set the copy size to ${v} lot?\n\nIf they are connected, the copier is re-synced right away.`)) editMember(r.tg_id, 'lot', v);
        }}
        className="mono"
        title="copy size — free entry above the grid, re-synced to STH"
        style={{ fontSize: 10.5, padding: '3px 6px', borderRadius: 7, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: cur ? 'var(--text)' : 'var(--dim)', cursor: 'pointer' }}
      >
        {LOT_CHOICES.map((l) => <option key={l} value={String(l)}>{l.toFixed(2)}</option>)}
        <option value="__free">{inGrid || !cur ? 'type it…' : `${Number(cur).toFixed(2)} · type it…`}</option>
      </select>
    );
  };
  // mot de passe MT : jamais affiché ici (🔑 SHOW CREDENTIALS le déchiffre à la demande, horodaté) — on
  // ne fait que le REMPLACER, ce qui est le cas réel : le membre l'a changé chez son broker, la copie tombe.
  const editPassword = (r: Row) => {
    const v = window.prompt(`New MT password for ${r.mt5_login ?? 'this account'}\n\nThe TRADER password, not the investor one. It is re-encrypted immediately — after saving, hit 🔗 RECONNECT STH so the copier picks it up.`, '');
    if (v === null || !v.trim()) return;
    editMember(r.tg_id, 'mt5_password', v.trim());
  };
  // message « nouveau dépôt à vérifier » → presse-papiers (WhatsApp staff). Nom du compte broker en
  // priorité (c'est LUI que le staff cherche dans CellXpert), sinon le nom Telegram en repli.
  const copyDepositInfo = (a: Action) => {
    const m = rows.find((r) => Number(r.tg_id) === Number(a.tg_id));
    const brokerKey = String(a.detail?.broker ?? m?.broker ?? '');
    const brokerLabel = BROKERS.find((b) => b.key === brokerKey)?.name ?? (brokerKey || '⚠ broker ?');
    const who = String(a.detail?.broker_name ?? '') || legalOf(a.tg_id) || nameOf(a.tg_id);
    const dep = Number(a.detail?.declared_deposit ?? 0);
    const text = ['🔔 Nouveau dépôt à vérifier', who, String(a.detail?.login ?? '⚠ login ?'), brokerLabel, dep ? `${dep}$` : '⚠ montant non déclaré'].join('\n');
    void navigator.clipboard?.writeText(text).then(() => {
      setDepInfoCopied(a.id);
      setTimeout(() => setDepInfoCopied((v) => (v === a.id ? null : v)), 1600);
    });
  };
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = market === 'all' ? rows : rows.filter((r) => String(r.locale ?? 'en') === market);
    if (!q) return base;
    // tg_id inclus : c'est l'ID que STH affiche pour les receivers API — coller « 7557770646 » retrouve le membre
    return base.filter((r) => [r.tg_username, r.tg_name, r.broker, r.mt5_login, String(r.member_no), String(r.tg_id), r.status, r.country, legalOf(r.tg_id)].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [rows, search, market]);

  // ===== ALERTES PUSH : qui a activé, qui relancer (Telegram) =====
  const pushSet = useMemo(() => new Set(pushTgIds.map(Number)), [pushTgIds]);
  const alertsOff = useMemo(() => rows.filter((r) => !pushSet.has(Number(r.tg_id))), [rows, pushSet]);
  const alertsOn = rows.length - alertsOff.length;

  // ===== bilan du mois affiché : lignes + totaux (dépôts, coms reçues/attendues/sautées) =====
  const depDateOf = (d: Deposit) => String(d.detail?.deposited_at ?? d.created_at);
  // MOIS COMPTABLE (01/08) : par défaut celui du dépôt, sauf report explicite (booked_ym). Un dépôt dont
  // la commission n'est pas encore validée — le membre n'a pas tradé son lot — est reporté sur le mois
  // suivant plutôt que de rester en « pending » à fausser le bilan. La date réelle, elle, ne bouge jamais.
  const depMonthOf = (d: Deposit) => String(d.detail?.booked_ym ?? depDateOf(d).slice(0, 7));
  const nextYm = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
  const monthDeps = useMemo(
    () => deposits
      .filter((d) => depMonthOf(d) === ym && (market === 'all' || localeOf(d.tg_id) === market))
      .sort((a, b) => depDateOf(a).localeCompare(depDateOf(b))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deposits, ym, market, rows],
  );
  const depTotals = useMemo(() => {
    const t = { deposited: 0, received: 0, pending: 0, lost: 0 };
    for (const d of monthDeps) {
      t.deposited += Number(d.detail?.amount_usd ?? 0);
      const com = Number(d.detail?.commission_usd ?? 0);
      const st = String(d.detail?.commission_status ?? 'pending');
      if (st === 'received') t.received += com;
      else if (st === 'canceled') t.lost += com;
      else t.pending += com;
    }
    return t;
  }, [monthDeps]);
  // FILET DE SÉCURITÉ (demande Mathieu 28/07) : les membres LIVE sans AUCUNE ligne de dépôt — les
  // « connectés mais pas encore ajoutés aux dépôts » qui se perdaient quand il y a du volume.
  // Les comptes de la WHITELIST admin (Mathieu, la CM…) sont exclus : un compte de test interne n'a pas
  // de dépôt à réclamer — sans ça, le bandeau orange réclamait le compte #1 de Mathieu à l'infini (29/07).
  const liveNoDeposit = useMemo(() => {
    const funded = new Set(deposits.map((d) => Number(d.tg_id)));
    const admins = new Set(wl.map((w) => w.username.toLowerCase()));
    return rows.filter((r) => r.status === 'live' && !funded.has(Number(r.tg_id)) && !(r.tg_username && admins.has(r.tg_username.toLowerCase())));
  }, [rows, deposits, wl]);
  const shiftMonth = (delta: number) => {
    const [y, m] = ym.split('-').map(Number);
    setYm(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
  };
  const monthLabel = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
  // pré-remplissage « expected com $ » depuis le barème par broker (lib/member/commissions) —
  // recalculé à chaque changement de broker/montant TANT QUE l'opérateur n'a pas saisi une valeur
  // à la main. Barème vide ou palier non atteint → champ vidé (pas de reliquat d'un autre broker).
  useEffect(() => {
    if (!depComAuto.current) return;
    const est = estimateCommission(depBroker, Number(depAmount));
    setDepCom(est != null ? String(est) : '');
  }, [depBroker, depAmount]);
  // classement des brokers pour le budget annoncé — brokers déjà utilisés par le prospect exclus
  // (compte principal + comptes multi-stratégies) : on ne renvoie jamais quelqu'un là où il est déjà
  const planExcluded = useMemo(() => {
    const used = new Set<string>();
    if (planTg) {
      const m = rows.find((r) => String(r.tg_id) === planTg);
      if (m?.broker) used.add(m.broker);
      for (const a of extraAccounts) if (String(a.tg_id) === planTg && a.broker) used.add(a.broker);
    }
    return used;
  }, [planTg, rows, extraAccounts]);
  const planRanking = useMemo(() => rankBrokersByCommission(Number(planAmount), planExcluded), [planAmount, planExcluded]);
  const copyBrokerLink = (key: string, url: string) => {
    void navigator.clipboard.writeText(url).then(() => {
      setPlanCopied(key);
      setTimeout(() => setPlanCopied((k) => (k === key ? null : k)), 1500);
    });
  };
  const addDeposit = () => {
    if (!depTg || !depAmount) return;
    post(
      { addDeposit: { tg_id: Number(depTg), broker: depBroker, amount: Number(depAmount), commission: Number(depCom || 0), date: depDate, note: depNote } },
      () => { setDepAmount(''); setDepCom(''); setDepNote(''); depComAuto.current = true; },
    );
  };
  // envoi de la campagne : on DEMANDE d'abord l'audience exacte au serveur (dryRun), puis confirmation
  // chiffrée — un envoi de masse ne se déclenche jamais sur un clic seul.
  const sendBlast = () => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerBlast: { dryRun: true } }) })
      .then(async (r) => {
        const d = (await r.json()) as { audience?: number; alreadySent?: number; error?: string };
        setBusy(false);
        if (d.error) return window.alert(d.error);
        const n = d.audience ?? 0;
        if (!n) return window.alert('No prospect to reach right now (everyone already got it in the last 12h, or every member has deposited).');
        if (!window.confirm(`Send this campaign to ${n} prospect(s) with no deposit?\n\n${d.alreadySent ? `${d.alreadySent} person(s) already received it in the last 12h and are skipped.\n\n` : ''}Depositors are never included. This cannot be undone.`)) return;
        setBusy(true);
        void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerBlast: { text: blastText, title: blastTitle || undefined, pushBody: blastBody || undefined, url: '/member/onboarding' } }) })
          .then(async (r2) => {
            const d2 = (await r2.json()) as { audience?: number; dmOk?: number; pushOk?: number; error?: string };
            if (d2.error) window.alert(d2.error);
            else window.alert(`✓ Campaign sent\n\n${d2.dmOk ?? 0} Telegram DM delivered\n${d2.pushOk ?? 0} push notification(s)\nout of ${d2.audience ?? 0} prospect(s)`);
            load();
          })
          .finally(() => setBusy(false));
      })
      .catch(() => setBusy(false));
  };
  const editDepositCom = (d: Deposit) => {
    const v = window.prompt('Expected commission ($):', String(d.detail?.commission_usd ?? 0));
    if (v !== null && Number.isFinite(Number(v))) post({ updateDeposit: { id: d.id, commission: Number(v) } });
  };
  // montant du dépôt éditable (29/07 — Jamie a déposé en 2 fois 265+250 : la com se corrigeait mais pas le
  // montant → bilan incohérent). L'API updateDeposit acceptait déjà amount, il manquait juste le crayon.
  const editDepositAmount = (d: Deposit) => {
    const v = window.prompt('Deposit amount ($) — cumule les dépôts multiples du même compte :', String(d.detail?.amount_usd ?? 0));
    if (v !== null && Number.isFinite(Number(v)) && Number(v) > 0) post({ updateDeposit: { id: d.id, amount: Number(v) } });
  };
  const deleteDeposit = (d: Deposit) => {
    if (window.confirm(`Delete this deposit line ($${Number(d.detail?.amount_usd ?? 0)} · #${d.member_no ?? '—'})? This can't be undone.`)) post({ deleteDeposit: d.id });
  };

  // ===== PUSH COMPOSER + relance des leads (TOOLS) =====
  const sendCustomPush = (payload: { audience: string; tg_id?: number; title: string; body: string; url?: string }, label: string) => {
    setBusy(true);
    setPushResult(null);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customPush: payload }) })
      .then(async (r) => {
        const d = (await r.json()) as { sent?: number; error?: string };
        if (d.error) { window.alert(d.error); return; }
        const n = d.sent ?? 0;
        setPushResult(`${label} → delivered to ${n} device${n === 1 ? '' : 's'}${n === 0 ? ' (no push-enabled devices — DM on Telegram instead)' : ''}`);
      })
      .finally(() => setBusy(false));
  };
  const composerSend = () => {
    if (pushAud !== 'self' && !window.confirm(`Send this push to ${pushAud.toUpperCase()}? Test it on yourself first if you haven't.`)) return;
    sendCustomPush({ audience: pushAud, title: pushTitle, body: pushBody, url: pushUrl }, pushAud.toUpperCase());
  };
  // ENVOI PAR LE BOT — indispensable depuis la file du jour : 109 des 219 personnes n'ont pas de @pseudo,
  // donc AUCUN lien t.me ne mène à elles. Le bot, lui, peut toujours écrire : tout le monde ici a tapé
  // START pour se connecter à l'app. On confirme avant d'envoyer (c'est un message réel à un vrai
  // prospect, pas un brouillon) et on marque la personne comme touchée dans la foulée.
  const sendViaBot = (tgId: number, text: string) => {
    if (!window.confirm(`Send this to ${tgId} through the Algoria bot?\n\n${text}`)) return;
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botDm: { tg_id: tgId, text } }) })
      .then(async (r) => {
        const d = (await r.json()) as { error?: string };
        if (d.error) window.alert(`⚠ ${d.error}`);
        else load(); // le botDm trace déjà un nudge → la personne sort de la file pour 3 jours
      })
      .finally(() => setBusy(false));
  };

  /** Publie sur le canal choisi, avec bouton. Confirmation OBLIGATOIRE : un post de canal part devant
   *  des milliers de personnes et ne se rattrape pas — l'aperçu montre exactement ce qui va partir. */
  const sendChannelPost = () => {
    const text = cpText.trim();
    if (!text || !cpChat) return;
    const target = tgChats.find((c) => String(c.chat_id) === cpChat);
    const label = target?.title ?? cpChat;
    const btn = cpBtn.trim() ? `\n\n[ ${cpBtn.trim()} ] → ${cpUrl.trim()}` : '\n\n(aucun bouton)';
    if (!window.confirm(`Publier sur « ${label} » ?\n\n${text}${btn}\n\nLe miroir UK et le canal IT suivront automatiquement (bouton compris).`)) return;
    setBusy(true);
    setCpReport(null);
    void fetch('/api/member/admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelPost: { chatId: cpChat, text, buttonText: cpBtn.trim(), buttonUrl: cpUrl.trim() } }),
    })
      .then(async (r) => {
        const d = (await r.json()) as { ok?: boolean; error?: string; report?: Array<{ channel: string; ok: boolean; error?: string }> };
        // Le rapport s'affiche MÊME en cas d'échec : savoir que le miroir est passé mais pas l'italien
        // vaut infiniment mieux qu'un « erreur » global qui laisse deviner ce qui a été publié.
        if (d.report) setCpReport(d.report);
        if (d.error) window.alert(`⚠ ${d.error}`);
        else setCpText('');
      })
      .finally(() => setBusy(false));
  };

  // relance individuelle d'un lead coincé — message fixe, bienveillant, qui renvoie vers le wizard
  const nudge = (r: Row) => {
    sendCustomPush({
      audience: 'user', tg_id: r.tg_id,
      title: '👋 Need a hand finishing your setup?',
      body: 'Your Algoria access is 2 minutes from ready. Mathieu can walk you through it — reply on Telegram or book a call from the app.',
      url: '/member/onboarding',
    }, `#${r.member_no}`);
  };
  // ===== FICHE MEMBRE : ouverture + notes privées =====
  // La fiche ouverte est un INSTANTANÉ de la ligne cliquée. Sans resynchronisation, une correction partait
  // bien en base mais l'écran continuait d'afficher l'ancienne valeur jusqu'à la réouverture de la fiche —
  // et l'opérateur re-corrigeait, croyant que ça n'avait pas pris (le pays était déjà dans ce cas).
  useEffect(() => { setSel((s) => (s ? rows.find((r) => Number(r.tg_id) === Number(s.tg_id)) ?? s : s)); }, [rows]);
  const openMember = (r: Row) => {
    setSel(r);
    setSelActs(null);
    setSelCreds(null);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberDetail: r.tg_id }) })
      .then(async (res) => { const d = (await res.json()) as { actions?: Action[] }; setSelActs(d.actions ?? []); });
  };
  const addNote = () => {
    if (!sel || !noteText.trim()) return;
    post({ addNote: { tg_id: sel.tg_id, text: noteText } }, () => { setNoteText(''); openMember(sel); });
  };
  const delNote = (id: string) => { if (sel && window.confirm('Delete this note?')) post({ deleteNote: id }, () => openMember(sel)); };
  // résumé d'une action pour la timeline de la fiche — chaque kind a sa ligne parlante
  const actSummary = (a: Action) => {
    const d = (a.detail ?? {}) as Record<string, unknown>;
    if (a.kind === 'connect') {
      // l'attente broker se lit SUR la carte, avec son ancienneté : c'est ce qui distingue « bloqué chez le
      // broker depuis 5 jours » de « jamais regardé depuis 5 jours ».
      const w = d.waiting_broker as { since?: string; note?: string | null } | undefined;
      const days = w?.since ? Math.floor((Date.now() - Date.parse(w.since)) / 86_400_000) : null;
      const wait = w ? ` · ⏳ waiting on broker${days ? ` ${days}d` : ''}${w.note ? ` (${w.note})` : ''}` : '';
      return `MT5 ${String(d.login ?? '?')} @ ${String(d.server ?? '?')} · lot ${String(d.lot ?? '?')}${d.reject_reason ? ` · ✗ ${String(d.reject_reason)}` : ''}${wait}`;
    }
    if (a.kind === 'kyc') return `${String(d.broker_name ?? '?')} · declared $${String(d.declared_deposit ?? '?')}`;
    if (a.kind === 'risk_change') return `→ ${String(d.to ?? '?')} (lot ${String(d.lot ?? '?')})`;
    if (a.kind === 'deposit') return `$${Number(d.amount_usd ?? 0)} deposited · com $${Number(d.commission_usd ?? 0)} (${String(d.commission_status ?? 'pending')})`;
    if (a.kind === 'note') return String(d.text ?? '');
    return '';
  };

  // LEADS COINCÉS : encore en onboarding, triés du plus ancien mouvement au plus récent — la liste de closing
  const leads = useMemo(
    () => rows.filter((r) => r.status === 'onboarding').sort((a, b) => Date.parse(a.updated_at ?? a.created_at) - Date.parse(b.updated_at ?? b.created_at)),
    [rows],
  );
  const STEP_LABEL = ['signed up — never picked a broker', 'picked a broker — MT5 not submitted', 'MT5 in — never finished the risk step'];
  const daysStuck = (r: Row) => Math.floor((Date.now() - Date.parse(r.updated_at ?? r.created_at)) / 86_400_000);
  // EXPORT CSV (bilan du mois) — généré côté client, s'ouvre direct dans Google Sheets / Excel (BOM UTF-8)
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['date', 'market', 'member', 'username', 'country', 'broker', 'deposit_usd', 'commission_usd', 'commission_status', 'note'],
      ...monthDeps.map((d) => [
        depDateOf(d).slice(0, 10),
        localeOf(d.tg_id).toUpperCase(),
        d.member_no != null ? `#${d.member_no}` : '',
        (() => { const m = rows.find((r) => Number(r.tg_id) === Number(d.tg_id)); return m?.tg_username ? '@' + m.tg_username : (m?.tg_name ?? ''); })(),
        rows.find((r) => Number(r.tg_id) === Number(d.tg_id))?.country ?? '',
        d.detail?.broker ?? '',
        Number(d.detail?.amount_usd ?? 0),
        Number(d.detail?.commission_usd ?? 0),
        d.detail?.commission_status ?? 'pending',
        d.detail?.note ?? '',
      ]),
      [],
      ['SUMMARY ' + ym],
      ['deposits', monthDeps.length],
      ['deposited_usd', depTotals.deposited],
      ['commission_received_usd', depTotals.received],
      ['commission_pending_usd', depTotals.pending],
      ['commission_lost_usd', depTotals.lost],
    ];
    const csv = '\ufeff' + lines.map((l) => l.map(esc).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `algoria-deposits-${ym}${market === 'all' ? '' : '-' + market}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (state === 'loading') return <Center>loading…</Center>;
  if (state === 'anon' || state === 'forbidden') return <AdminGate forbidden={state === 'forbidden'} deniedAs={deniedAs} />;

  const live = rows.filter((r) => r.status === 'live').length;
  const pendingRev = rows.filter((r) => r.status === 'pending_copier').length;
  // les coms de dépôt EN ATTENTE comptent dans le travail à faire : confirmer quand le broker a payé
  const depPending = deposits.filter((d) => String(d.detail?.commission_status ?? 'pending') === 'pending');
  const todo = actions.length + (aff?.pendingCommissions.length ?? 0) + (aff?.pendingPayouts.length ?? 0) + depPending.length + liveNoDeposit.length;
  const KIND_LABEL: Record<string, string> = { connect: '🔌 CONNECT ACCOUNT', risk_change: '⚖ RISK CHANGE', strategy_change: '🎯 STRATEGY CHANGE (move master in STH)', pause: '⏸ PAUSE COPY', resume: '▶ RESUME COPY', disconnect: '⛔ DISCONNECT (remove from copier)', referral_reward: '💰 PAY REFERRAL REWARD (legacy)', kyc: '🪪 BROKER DETAILS', deposit: '🏦 DEPOSIT', note: '📝 NOTE' };
  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'dashboard', label: 'DASHBOARD' },
    { key: 'queue', label: 'QUEUE', badge: actions.length },
    { key: 'members', label: 'MEMBERS', badge: rows.length },
    { key: 'deposits', label: 'DEPOSITS', badge: deposits.filter((d) => String(d.detail?.commission_status ?? 'pending') === 'pending').length + liveNoDeposit.length },
    { key: 'affiliate', label: 'AFFILIATE', badge: (aff?.pendingCommissions.length ?? 0) + (aff?.pendingPayouts.length ?? 0) },
    { key: 'tools', label: 'TOOLS' },
  ];

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* ===== barre haute : marque + navigation + actions globales ===== */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '12px 22px', borderBottom: '1px solid var(--border)', background: 'rgba(8,16,31,.6)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/brand/algoria-mark.png" alt="" width={24} height={24} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(43,227,245,.4))' }} />
          <strong style={{ fontSize: 15, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA</strong>
          <span className="mono goldText" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>ADMIN</span>
        </div>
        <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, cursor: 'pointer',
              fontSize: 11, fontWeight: 800, letterSpacing: 1,
              border: `1px solid ${tab === t.key ? 'rgba(43,227,245,.5)' : 'transparent'}`,
              background: tab === t.key ? 'rgba(43,227,245,.08)' : 'transparent',
              color: tab === t.key ? 'var(--cyan)' : 'var(--muted)',
            }}>
              {t.label}
              {!!t.badge && <span className="mono" style={{ fontSize: 9.5, fontWeight: 800, padding: '1px 6px', borderRadius: 8, background: tab === t.key ? 'rgba(43,227,245,.15)' : 'rgba(245,194,74,.14)', color: tab === t.key ? 'var(--cyan)' : 'var(--gold)' }}>{t.badge}</span>}
            </button>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        {/* 🌍 MARCHÉ — bascule UK / Italie : filtre les membres ET le registre des dépôts (deux entités
            comptables séparées). Visible en permanence : savoir « sur quel marché je regarde » est aussi
            important que l'onglet où l'on se trouve. */}
        <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.6)' }}>
          {([['all', '🌍 ALL'], ['en', '🇬🇧 UK'], ['it', '🇮🇹 IT']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setMarket(k)} className="mono" title={k === 'all' ? 'both markets' : k === 'en' ? 'English channel (UK/UAE/DE…)' : 'Italian channel'}
              style={{ padding: '5px 9px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                background: market === k ? 'rgba(43,227,245,.14)' : 'transparent', color: market === k ? 'var(--cyan)' : 'var(--dim)' }}>
              {label}{market === k && k !== 'all' ? ` · ${rows.filter((r) => String(r.locale ?? 'en') === k).length}` : ''}
            </button>
          ))}
        </div>
        <button disabled={busy} onClick={liveAlert} style={{ padding: '7px 13px', borderRadius: 9, border: '1px solid rgba(255,90,60,.5)', background: 'rgba(255,90,60,.08)', color: '#ff8a5c', fontWeight: 800, letterSpacing: 0.6, fontSize: 11, cursor: 'pointer' }}>📣 LIVE ALERT</button>
        <form action="/api/member/logout" method="post" style={{ display: 'flex' }}>
          <button style={{ padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 11, cursor: 'pointer' }}>sign out</button>
        </form>
      </header>

      <div style={{ flex: 1, width: '100%', maxWidth: 1240, margin: '0 auto', padding: '18px 22px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* WATCHDOG — visible sur TOUS les onglets : si le runner n'écrit plus de bougie depuis > 20 min
            (BTC 24/7 → il devrait toujours en écrire), quelque chose est mort côté Railway. */}
        {runnerLastSeen != null && Date.now() - runnerLastSeen > 20 * 60_000 && (
          <div style={{ ...warnBox, borderColor: 'rgba(255,90,60,.6)', background: 'rgba(255,90,60,.1)', color: '#ff8a5c', fontWeight: 800 }}>
            🚨 RUNNER SILENT — no candle written for {Math.floor((Date.now() - runnerLastSeen) / 60_000)} min. Check Railway (the cron also pushes this alert to your phone).
          </div>
        )}
        {/* ===== DASHBOARD — les chiffres qui comptent, toujours en tête ===== */}
        {tab === 'dashboard' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <Kpi label="MEMBERS" value={String(rows.length)} accent="var(--cyan)" />
              <Kpi label="COPYING LIVE" value={String(live)} accent="var(--up)" />
              <Kpi label="UNDER REVIEW" value={String(pendingRev)} accent="var(--gold)" hot={pendingRev > 0} />
              <Kpi label="TO PROCESS" value={String(todo)} accent="#ff8a5c" hot={todo > 0} />
              <Kpi label="OWED TO PARTNERS" value={`$${Math.floor(aff?.owedUsd ?? 0)}`} accent="var(--gold)" />
              {/* reçu = encaissé (✓ RECEIVED) ; le pending s'affiche en dessous — sinon $0 après une
                  saisie de dépôt semble être un bug alors que la com attend juste le paiement broker */}
              <Kpi label={`BROKER COM · ${monthLabel.split(' ')[0].slice(0, 3)}`} value={`$${Math.floor(depTotals.received)}`} accent="var(--up)" hot={depTotals.pending > 0}
                sub={depTotals.pending > 0 ? `+ $${Math.floor(depTotals.pending)} pending broker payout` : undefined} />
            </div>
            {(aff?.flagged.length ?? 0) > 0 && (
              <div style={{ ...warnBox }}>⚠ negative balances: {aff!.flagged.map((f) => `${f.username ? '@' + f.username : '#' + f.member_no} (${Math.floor(f.balance)}$)`).join(' · ')}</div>
            )}
            {/* ===== ENTONNOIR D'ACTIVATION — où fuit l'argent. Le levier n°1 : la plupart des inscrits ne
                financent jamais. On voit la marche qui saigne + la relance auto la travaille chaque jour. */}
            {(() => {
              const signups = rows.length;
              const depositors = new Set(deposits.map((d) => Number(d.tg_id))).size;
              const liveN = rows.filter((r) => r.status === 'live').length;
              const started = rows.filter((r) => !(r.status === 'onboarding' && (r.onboarding_step ?? 0) === 0)).length; // a dépassé l'écran broker
              const step0 = rows.filter((r) => r.status === 'onboarding' && (r.onboarding_step ?? 0) === 0).length;
              const step1 = rows.filter((r) => r.status === 'onboarding' && (r.onboarding_step ?? 0) >= 1).length;
              const stages: Array<{ label: string; n: number; col: string }> = [
                { label: 'signed up', n: signups, col: 'var(--cyan)' },
                { label: 'started setup', n: started, col: '#7aa2f7' },
                { label: 'funded', n: depositors, col: 'var(--gold)' },
                { label: 'copying live', n: liveN, col: 'var(--up)' },
              ];
              const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
              return (
                <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <h2 style={secH}>🎯 ACTIVATION FUNNEL — where the money leaks</h2>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    {stages.map((s, i) => (
                      <div key={s.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
                        <span className="mono" style={{ fontSize: 19, fontWeight: 800, color: s.col }}>{s.n}</span>
                        <div style={{ width: '100%', height: 8, borderRadius: 5, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct(s.n, signups)}%`, height: '100%', background: s.col }} />
                        </div>
                        <span style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: 0.4, textAlign: 'center' }}>{s.label}</span>
                        {i > 0 && <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{pct(s.n, stages[i - 1].n)}% of prev</span>}
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                    <span>🧱 stuck at <b style={{ color: 'var(--text)' }}>deposit wall</b> (step 0): <b style={{ color: '#ff8a5c' }}>{step0}</b></span>
                    <span>🔌 stuck at <b style={{ color: 'var(--text)' }}>MT5 connect</b> (step 1): <b style={{ color: 'var(--gold)' }}>{step1}</b></span>
                    <span style={{ color: 'var(--dim)' }}>· auto-sequence works these daily — your voice notes close them (see below)</span>
                  </div>
                  {/* 📡 PAR CANAL (attribution UTM au premier clic) — le juge de paix des ads : inscrits et
                      FINANCÉS par source. "organic / unknown" = pas de cookie (organique, ou flux cross-device
                      ads→Telegram→autre appareil : attribution partielle assumée). Croiser avec la dépense
                      hebdo du media buyer → CAC réel par financé, par canal (rituel du lundi). */}
                  {(() => {
                    const bySrc = new Map<string, { signups: number; funded: number; live: number }>();
                    const fundedSet = new Set(deposits.map((d) => Number(d.tg_id)));
                    for (const r of rows) {
                      const k = r.source ?? 'organic / unknown';
                      const e = bySrc.get(k) ?? { signups: 0, funded: 0, live: 0 };
                      e.signups++;
                      if (fundedSet.has(Number(r.tg_id))) e.funded++;
                      if (r.status === 'live') e.live++;
                      bySrc.set(k, e);
                    }
                    const srcRows = [...bySrc.entries()].sort((a, b) => b[1].signups - a[1].signups);
                    if (srcRows.length <= 1) return (
                      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--dim)' }}>
                        📡 Per-channel attribution is live — tag your ad links with <b className="mono" style={{ color: 'var(--muted)' }}>?utm_source=meta&utm_campaign=uk</b> (or ?src=…) and new signups will break down by channel here.
                      </p>
                    );
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid rgba(130,152,190,.12)', paddingTop: 9 }}>
                        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.5, color: 'var(--dim)', fontWeight: 800 }}>📡 BY CHANNEL (first-click UTM)</span>
                        {srcRows.map(([src, v]) => (
                          <div key={src} className="mono" style={{ display: 'flex', gap: 14, fontSize: 11, alignItems: 'baseline' }}>
                            <span style={{ color: src === 'organic / unknown' ? 'var(--dim)' : 'var(--cyan)', fontWeight: 700, minWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src}</span>
                            <span style={{ color: 'var(--muted)' }}>{v.signups} signups</span>
                            <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{v.funded} funded</span>
                            <span style={{ color: 'var(--up)' }}>{v.live} live</span>
                            <span style={{ color: 'var(--dim)' }}>{v.signups > 0 ? Math.round((v.funded / v.signups) * 100) : 0}% conv</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </section>
              );
            })()}
            {/* le travail en attente, cliquable — le dashboard est un cockpit, pas un tableau mort */}
            {todo > 0 ? (
              <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
                <h2 style={secH}>NEEDS YOU NOW</h2>
                {actions.slice(0, 5).map((a) => (
                  <RowLine key={a.id} onClick={() => setTab('queue')} icon="🔌" text={`${(KIND_LABEL[a.kind] ?? a.kind).replace(/^[^\p{L}]+\s*/u, '')} · member #${a.member_no ?? '—'}`} sub={new Date(a.created_at).toLocaleString('en-GB')} />
                ))}
                {(aff?.pendingPayouts ?? []).map((p) => (
                  <RowLine key={p.id} onClick={() => setTab('affiliate')} icon="💸" text={`payout $${Number(p.amount)} → ${nameOf(p.tg_id)}`} sub="waiting for USDT transfer" gold />
                ))}
                {(aff?.pendingCommissions ?? []).slice(0, 5).map((c) => (
                  <RowLine key={c.id} onClick={() => setTab('affiliate')} icon="💰" text={`commission $${Number(c.amount)} → ${nameOf(c.referrer_tg_id)}`} sub="confirm once the broker paid you" />
                ))}
                {depPending.slice(0, 5).map((d) => (
                  <RowLine key={d.id} onClick={() => setTab('deposits')} icon="🏦" text={`deposit com $${Number(d.detail?.commission_usd ?? 0)} · member #${d.member_no ?? '—'} (${(d.detail?.broker ?? '?').toUpperCase()})`} sub="mark ✓ RECEIVED once the broker paid you" gold />
                ))}
                {/* connectés mais dépôt jamais enregistré — le trou dans lequel les journées à 5 dépôts tombaient */}
                {liveNoDeposit.slice(0, 5).map((r) => (
                  <RowLine key={r.tg_id} onClick={() => setTab('deposits')} icon="⚠" text={`live, no deposit logged · #${r.member_no} ${r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '')}`} sub="click → DEPOSITS, the orange strip prefills the form" gold />
                ))}
              </section>
            ) : (
              <section className="panel" style={{ padding: 22, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>All clear — nothing waiting on you. 🎉</section>
            )}
            {/* ===== RELANCES DU JOUR — la file de leads à toucher EN PERSONNE (message/vocal Mathieu).
                Prospects en onboarding 1-21 j, pas touchés depuis 3 j (relances auto comprises). Le bot
                filet passe à 10h UTC derrière — mais TON vocal convertit mieux : déroule cette liste d'abord. */}
            {(() => {
              const now = Date.now();
              // LE BOT NE VIDE PLUS TA FILE (14/08). La règle « masqué 3 jours après une relance » ne
              // distinguait pas QUI avait relancé. Depuis que la relance automatique couvre 60 jours au
              // lieu de 21, le bot touche en permanence les mêmes gens — il aurait donc effacé de la file
              // manuelle, en continu, ceux que Mathieu voulait justement appeler. L'outil automatique
              // aurait saboté la session humaine qu'il est censé compléter.
              // Seul un contact HUMAIN masque désormais quelqu'un (done_by ≠ 'auto' : ✓ FAIT ou envoi par
              // le bot déclenché à la main). Le passage du bot reste AFFICHÉ sur la ligne — l'information
              // est utile, elle ne doit simplement pas décider à ta place.
              const lastNudge = new Map<number, number>(); // contacts HUMAINS uniquement
              const lastAuto = new Map<number, number>(); // dernier passage de la relance automatique
              for (const n of nudges) {
                const t = Number(n.tg_id); const at = Date.parse(n.created_at);
                const map = String(n.done_by ?? '') === 'auto' ? lastAuto : lastNudge;
                if ((map.get(t) ?? 0) < at) map.set(t, at);
              }
              // ═══ SEGMENTATION (14/08) ═══════════════════════════════════════════════════════════════
              // La file mélangeait des situations qui n'appellent PAS le même message. Mesuré sur les 219
              // personnes qu'elle contenait : 196 n'avaient JAMAIS écrit une ligne au bot. Leur envoyer une
              // relance (« alors, tu en es où ? ») n'avait aucun sens — elles ne savent même pas qui écrit,
              // et beaucoup ont quitté le canal depuis. Deux avaient déjà DÉPOSÉ sans finir : les plus
              // chaudes de toute la base, noyées au milieu. Douze s'étaient fait REFUSER leur connexion :
              // celles-là ont essayé, elles méritent un rattrapage, pas une relance.
              // Un ordre unique ne pouvait pas servir quatre conversations différentes. On sépare.
              const spoke = new Set(spokeTgIds);
              const rejectedSet = new Set(rejectedTgIds);
              const depositedSet = new Set(deposits.map((d) => Number(d.tg_id)));
              type Seg = 'deposited' | 'rejected' | 'first' | 'followup';
              const segOf = (tg: number): Seg =>
                depositedSet.has(tg) ? 'deposited' : rejectedSet.has(tg) ? 'rejected' : spoke.has(tg) ? 'followup' : 'first';
              const all = rows
                .filter((r) => r.status === 'onboarding')
                .map((r) => ({ r, days: Math.floor((now - Date.parse(r.created_at)) / 86_400_000), touched: lastNudge.get(Number(r.tg_id)), autoTouched: lastAuto.get(Number(r.tg_id)), seg: segOf(Number(r.tg_id)) }))
                // FENÊTRE 21 → 60 JOURS (14/08). À 21 jours, 46 personnes inscrites entre 22 et 39 jours
                // n'apparaissaient NULLE PART : jamais contactées à la main, sorties de la file sans que
                // personne ne le décide. « Froid » n'est pas « perdu » quand on ne leur a jamais parlé.
                // La borne basse reste à 1 jour : quelqu'un qui vient de s'inscrire mérite quelques heures
                // avant qu'on lui saute dessus, et l'auto-nudge passe de toute façon.
                .filter((x) => x.days >= 1 && x.days <= 60 && (!x.touched || now - x.touched > 3 * 86_400_000))
                // le plus ancien d'abord : la session commence par la dette la plus vieille (12/08)
                .sort((a, b) => b.days - a.days);
              if (all.length === 0) return <section className="panel" style={{ padding: 16, color: 'var(--dim)', fontSize: 12.5 }}>📞 Relance queue clear — every recent lead was touched in the last 3 days.</section>;
              // ordre des onglets = ordre de PRIORITÉ commerciale, pas alphabétique : l'argent déjà déposé
              // d'abord, puis ceux qui ont essayé, puis la masse froide.
              const SEGS: Array<{ key: Seg; label: string; hint: string; color: string }> = [
                { key: 'deposited', label: '💰 DEPOSITED, NOT LIVE', hint: 'They already put money in and never finished. Nothing in this admin is more urgent — finish it for them, or call.', color: 'var(--up)' },
                { key: 'rejected', label: '🛠 REJECTED, TO RESCUE', hint: 'Their connection was declined. They tried. Tell them exactly what to fix — most think they were refused as a person.', color: '#ff8a5c' },
                { key: 'first', label: '👋 FIRST CONTACT', hint: 'They have NEVER written to us. This is not a follow-up — introduce yourself, say which channel this is, and give the invite back: many have left it since.', color: 'var(--cyan)' },
                { key: 'followup', label: '💬 REAL FOLLOW-UP', hint: 'You already have a conversation with them. Pick it back up where it stopped.', color: 'var(--gold)' },
              ];
              const counts = Object.fromEntries(SEGS.map((s) => [s.key, all.filter((x) => x.seg === s.key).length])) as Record<Seg, number>;
              const active = SEGS.find((s) => s.key === relSeg && counts[s.key] > 0) ?? SEGS.find((s) => counts[s.key] > 0) ?? SEGS[0];
              const queue = all.filter((x) => x.seg === active.key);
              return (
                <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <h2 style={secH}>📞 RELANCES DU JOUR · {all.length} — oldest first, your personal DM/voice beats any bot</h2>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {SEGS.map((sg) => (
                      <button key={sg.key} onClick={() => setRelSeg(sg.key)} disabled={counts[sg.key] === 0}
                        style={{ padding: '6px 10px', borderRadius: 8, cursor: counts[sg.key] ? 'pointer' : 'default', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
                          border: `1px solid ${active.key === sg.key ? sg.color : 'var(--border)'}`,
                          background: active.key === sg.key ? 'rgba(255,255,255,.06)' : 'transparent',
                          color: counts[sg.key] === 0 ? 'var(--dim)' : active.key === sg.key ? sg.color : 'var(--muted)', opacity: counts[sg.key] === 0 ? 0.45 : 1 }}>
                        {sg.label} · {counts[sg.key]}
                      </button>
                    ))}
                  </div>
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>{active.hint}</p>
                  {/* SCRIPT PRÊT À COLLER, propre au segment. Le message de relance générique ne marche que
                      sur le dernier segment — sur les trois autres il tombe à côté, et ça se voit. */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55, whiteSpace: 'pre-wrap', flex: 1 }}>{SCRIPTS[active.key]}</span>
                    <button onClick={() => { void navigator.clipboard?.writeText(SCRIPTS[active.key]); setCopiedScript(active.key); window.setTimeout(() => setCopiedScript(null), 1800); }}
                      style={{ ...miniBtn, flex: 'none', color: 'var(--cyan)', borderColor: 'rgba(43,227,245,.4)' }}>
                      {copiedScript === active.key ? '✓ copied' : '⧉ copy'}
                    </button>
                  </div>
                  {queue.slice(0, 15).map(({ r, days, touched, autoTouched }) => (
                    <div key={r.tg_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.5)', flexWrap: 'wrap' }}>
                      <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12, minWidth: 36 }}>#{r.member_no}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>{r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '—')}</span>
                      {legalOf(r.tg_id) && <span className="mono" style={{ fontSize: 10, color: 'var(--gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }} title="name on the broker account">🏦 {legalOf(r.tg_id)}</span>}
                      <span className="mono" style={{ fontSize: 10, fontWeight: 800, color: days >= 5 ? '#ff8a5c' : 'var(--gold)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px' }}>J+{days}</span>
                      {/* OÙ IL EN EST : sans ça, impossible de savoir quoi lui dire sans ouvrir sa fiche */}
                      <span style={{ fontSize: 10.5, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{STEP_LABEL[r.onboarding_step] ?? STEP_LABEL[0]}</span>
                      {touched && <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>you: {Math.floor((now - touched) / 86_400_000)}d ago</span>}
                      {/* passage du bot : affiché pour que tu ne doubles pas à quelques heures près, mais
                          il ne masque plus personne — c'est toi qui décides si un DM auto suffit. */}
                      {autoTouched && <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>🤖 {Math.floor((now - autoTouched) / 86_400_000)}d ago</span>}
                      <span style={{ flex: 1 }} />
                      {/* PAS DE @PSEUDO = PAS DE LIEN t.me. La moitié de la file est dans ce cas (109 sur 219),
                          et le bouton DM manquant donnait une ligne sans aucune action possible. Le bot, lui,
                          peut TOUJOURS écrire : tout le monde ici a tapé START pour se connecter à l'app. */}
                      {r.tg_username
                        ? <a href={`https://t.me/${r.tg_username}`} target="_blank" rel="noreferrer" style={{ ...miniBtn, textDecoration: 'none', color: 'var(--cyan)', borderColor: 'rgba(43,227,245,.4)' }}>💬 DM</a>
                        : <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }} title="no @username — Telegram gives no direct link, use the bot">no @ · bot only</span>}
                      <button disabled={busy} onClick={() => sendViaBot(Number(r.tg_id), personalise(SCRIPTS[active.key], r.tg_name))} title="send this segment's script through the Algoria bot — works even without a @username" style={{ ...miniBtn, color: 'var(--gold)', borderColor: 'rgba(245,194,74,.45)' }}>🤖 BOT</button>
                      <button disabled={busy} onClick={() => post({ nudged: r.tg_id })} title="I sent my personal message/voice note — remove from the queue for 3 days" style={okBtn}>✓ FAIT</button>
                    </div>
                  ))}
                  {queue.length > 15 && <p style={{ margin: 0, fontSize: 11, color: 'var(--dim)' }}>+{queue.length - 15} more in this segment, all newer than these — the 10:00 UTC auto-nudge catches whoever you don&rsquo;t reach.</p>}
                </section>
              );
            })()}
            {/* ===== 🎁 CAMPAGNE PROSPECTS — DM du bot + push à tous les membres SANS dépôt. Né de
                l'opération « dernier jour du mois » (31/07) : offre ALGORIA100 limitée dans le temps.
                Le texte est éditable AVANT envoi ; le compte exact de destinataires est demandé au
                serveur puis confirmé. Les déposants sont exclus d'office, et personne n'est touché
                deux fois en 12 h même si on reclique. */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'rgba(245,194,74,.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ ...secH, color: 'var(--gold)' }}>🎁 CAMPAIGN — PROSPECTS ONLY</h2>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>bot DM + push to every member with no deposit yet (depositors excluded)</span>
              </div>
              <textarea value={blastText} onChange={(e) => setBlastText(e.target.value)} rows={9}
                placeholder="Message (HTML Telegram : <b>gras</b>, <i>italique</i>)"
                style={{ width: '100%', padding: 10, borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 12.5, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={blastTitle} onChange={(e) => setBlastTitle(e.target.value)} placeholder="push title (optional)" style={{ ...inp, flex: '1 1 180px' }} />
                <input value={blastBody} onChange={(e) => setBlastBody(e.target.value)} placeholder="push body (optional)" style={{ ...inp, flex: '1 1 220px' }} />
                <button disabled={busy || blastText.trim().length < 10} onClick={sendBlast}
                  title="asks the server how many prospects would receive this, then requires confirmation before sending"
                  style={{ padding: '10px 18px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#f5c24a,#e39a2b)', opacity: blastText.trim().length < 10 ? 0.5 : 1 }}>
                  📣 SEND CAMPAIGN
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.5 }}>
                Telegram DM only reaches people who already opened a chat with the bot — the push notification covers part of the rest. Every send is logged in BOT ACTIVITY.
              </p>
            </section>
            {/* ===== 📣 SOURCES DES DEMANDES D'ADHÉSION — l'attribution enfin possible (30/07) : un lien
                d'invitation Telegram NOMMÉ par campagne (« META-UK-JUL ») apparaît ici avec ses demandes,
                ses acceptations et le taux de DM automatique délivré. Les ads pointent vers le canal, donc
                c'était le seul chaînon manquant entre le budget pub et les vrais entrants. */}
            {joinSources.length > 0 && (
              <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={secH}>📣 JOIN REQUESTS BY SOURCE</h2>
                  <span style={{ fontSize: 11, color: 'var(--dim)' }}>name one Telegram invite link per campaign to see it split here</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ color: 'var(--dim)', textAlign: 'left' }}>
                        <th style={{ padding: '4px 8px 6px 0' }}>source</th>
                        <th style={{ padding: '4px 8px 6px 0', textAlign: 'right' }}>requests</th>
                        <th style={{ padding: '4px 8px 6px 0', textAlign: 'right' }}>accepted</th>
                        <th style={{ padding: '4px 8px 6px 0', textAlign: 'right' }}>auto-DM</th>
                        <th style={{ padding: '4px 0 6px 0' }}>last</th>
                      </tr>
                    </thead>
                    <tbody>
                      {joinSources.map((j) => (
                        <tr key={j.source} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '5px 8px 5px 0', color: 'var(--text)', fontWeight: 700 }}>{j.source}</td>
                          <td style={{ padding: '5px 8px 5px 0', textAlign: 'right', color: 'var(--cyan)', fontWeight: 800 }}>{j.n}</td>
                          <td style={{ padding: '5px 8px 5px 0', textAlign: 'right' }}>{j.accepted}</td>
                          <td style={{ padding: '5px 8px 5px 0', textAlign: 'right', color: j.dmFailed > j.dmSent ? '#ff8a5c' : 'var(--up)' }}>{j.dmSent}{j.dmFailed ? ` (${j.dmFailed} ko)` : ''}</td>
                          <td style={{ padding: '5px 0', color: 'var(--dim)' }}>{new Date(j.last).toLocaleDateString('en-GB')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {/* ===== 📡 CANAUX TELEGRAM (01/08) — Telegram ne montre NULLE PART l'ID d'un canal, or c'est
                la seule chose que l'API accepte (un lien t.me ne marche pas pour un canal privé). Le bot
                est ajouté admin → la ligne apparaît ici → l'ID se copie dans les variables Vercel.
                La colonne ROLE dit à quoi chaque canal est branché : un « — » = variable manquante. */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={secH}>📡 TELEGRAM CHANNELS</h2>
                  <span style={{ fontSize: 11, color: 'var(--dim)' }}>click an ID to copy it — paste into the Vercel env vars</span>
                </div>
                {tgChats.length === 0 && <p style={dimP}>No channel seen yet — add the bot as an admin of the channel, then post anything in it.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {tgChats.map((c) => (
                    <div key={c.chat_id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.5)' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 750, color: 'var(--text)' }}>{c.title ?? '(sans titre)'}</span>
                      {c.username && <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>@{c.username}</span>}
                      <span style={{ flex: 1 }} />
                      {c.role
                        ? <span className="mono" style={{ fontSize: 10, fontWeight: 800, color: 'var(--up)', border: '1px solid rgba(31,216,176,.4)', borderRadius: 7, padding: '3px 8px' }}>{c.role}</span>
                        : <span className="mono" style={{ fontSize: 10, fontWeight: 800, color: 'var(--dim)', border: '1px dashed var(--border)', borderRadius: 7, padding: '3px 8px' }}>not wired</span>}
                      <button
                        onClick={() => { void navigator.clipboard.writeText(String(c.chat_id)); setChatCopied(c.chat_id); setTimeout(() => setChatCopied(null), 1500); }}
                        className="mono" title="copier l'ID du canal"
                        style={{ fontSize: 11, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 9px', background: 'transparent', color: chatCopied === c.chat_id ? 'var(--up)' : 'var(--cyan)' }}>
                        {chatCopied === c.chat_id ? '✓ copied' : c.chat_id}
                      </button>
                    </div>
                  ))}
                </div>
            </section>
            {/* ===== 🤖 BOT ACTIVITY — TOUT ce que le bot envoie (relances, texte complet) et reçoit
                (réponses des prospects, via le webhook Telegram). « Je veux voir ce que le bot fait » —
                le fil est là. Le bouton ENABLE INBOX branche le webhook (à cliquer UNE fois). */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={secH}>🤖 BOT ACTIVITY</h2>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>sent → and received ← by the Telegram bot</span>
                <span style={{ flex: 1 }} />
                {tgInboxOn ? (
                  <span className="mono" style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--up)', border: '1px solid rgba(31,216,176,.4)', borderRadius: 7, padding: '4px 9px' }}>✓ INBOX ON</span>
                ) : (
                  <button disabled={busy} onClick={() => { setBusy(true); void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupTgWebhook: true }) }).then(async (r) => { const d = (await r.json()) as { error?: string }; if (d.error) window.alert(`⚠ ${d.error}`); else { setTgInboxOn(true); window.alert('✓ Bot inbox enabled — replies to the bot now land here.'); } }).finally(() => setBusy(false)); }}
                    title="one-time setup: point the Telegram webhook at the app so replies to the bot are recorded here (+ auto-acknowledgement routing people to you)" style={goldBtn}>🔌 ENABLE INBOX</button>
                )}
              </div>
              {botActivity.length === 0 && <p style={dimP}>No bot activity recorded yet — the 10:00 UTC auto-nudges will appear here with their full text.</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
                {botActivity.slice(0, 60).map((b) => {
                  const d = b.detail ?? {};
                  const incoming = b.kind === 'bot_reply';
                  const who = rows.find((r) => Number(r.tg_id) === Number(b.tg_id));
                  const label = who ? (who.tg_username ? '@' + who.tg_username : (who.tg_name ?? `#${who.member_no}`)) : String((d as { username?: string }).username ? '@' + (d as { username?: string }).username : ((d as { name?: string }).name ?? b.tg_id));
                  const text = String((d as { text?: string }).text ?? (d as { note?: string }).note ?? '');
                  return (
                    <div key={b.id} style={{ display: 'flex', gap: 9, padding: '8px 11px', borderRadius: 9, border: `1px solid ${incoming ? 'rgba(245,194,74,.4)' : 'var(--border)'}`, background: incoming ? 'rgba(245,194,74,.05)' : 'rgba(10,17,31,.5)' }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: incoming ? 'var(--gold)' : 'var(--cyan)', minWidth: 16 }}>{incoming ? '←' : '→'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 750, color: 'var(--text)' }}>{label}</span>
                          {who?.member_no != null && <span className="mono goldText" style={{ fontSize: 10, fontWeight: 800 }}>#{who.member_no}</span>}
                          <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{incoming ? 'replied to the bot' : (d as { via?: string }).via === 'manual' ? '👤 your personal touch (logged)' : (d as { via?: string }).via === 'admin' ? '💬 you replied via the bot' : 'auto-nudge sent'}</span>
                          <span style={{ flex: 1 }} />
                          <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{new Date(b.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: 11.5, color: incoming ? 'var(--text)' : 'var(--muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text || '—'}</p>
                        {/* RÉPONSE VIA LE BOT — part dans la conversation que la personne a DÉJÀ avec le bot
                            (le lien t.me échouait sans @username public). Enter ou SEND pour envoyer. */}
                        {incoming && (
                          <div style={{ display: 'flex', gap: 7, marginTop: 7 }}>
                            <input
                              value={botDrafts[b.id] ?? ''}
                              onChange={(e) => setBotDrafts((s) => ({ ...s, [b.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter' && (botDrafts[b.id] ?? '').trim()) { e.preventDefault(); const t = botDrafts[b.id].trim(); setBusy(true); void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botDm: { tg_id: b.tg_id, text: t } }) }).then(async (r) => { const dd = (await r.json()) as { error?: string }; if (dd.error) window.alert(`⚠ ${dd.error}`); else { setBotDrafts((s) => ({ ...s, [b.id]: '' })); load(); } }).finally(() => setBusy(false)); } }}
                              placeholder="reply via the bot — lands in their existing chat…"
                              style={{ ...inp, flex: 1, fontSize: 12, padding: '8px 11px' }}
                            />
                            <button
                              disabled={busy || !(botDrafts[b.id] ?? '').trim()}
                              onClick={() => { const t = (botDrafts[b.id] ?? '').trim(); if (!t) return; setBusy(true); void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botDm: { tg_id: b.tg_id, text: t } }) }).then(async (r) => { const dd = (await r.json()) as { error?: string }; if (dd.error) window.alert(`⚠ ${dd.error}`); else { setBotDrafts((s) => ({ ...s, [b.id]: '' })); load(); } }).finally(() => setBusy(false)); }}
                              style={{ padding: '8px 14px', borderRadius: 9, border: 'none', fontWeight: 800, fontSize: 11.5, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', opacity: (botDrafts[b.id] ?? '').trim() ? 1 : 0.5 }}
                            >SEND</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {/* ===== QUEUE — à appliquer dans Social Trade Hub ===== */}
        {tab === 'queue' && (
          <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={secH}>TO APPLY IN SOCIAL TRADE HUB {actions.length > 0 && `· ${actions.length}`}</h2>
            {actions.length === 0 && <p style={dimP}>Queue clear — nothing to apply.</p>}
            {actions.map((a) => (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
                {/* flexWrap : l'admin vit à 70% sur le téléphone de Mathieu — sans wrap, les boutons
                    débordaient sur le texte de la carte (vécu en screenshot). Les boutons passent
                    à la ligne proprement sur écran étroit. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {/* QUI : @username cliquable (ouvre la fiche) — un #numéro seul ne dit rien à personne */}
                  <button
                    onClick={() => { const m = rows.find((r) => Number(r.tg_id) === Number(a.tg_id)); if (m) { openMember(m); setTab('members'); } }}
                    title="open this member's card"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, minWidth: 96, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                  >
                    <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12 }}>#{a.member_no ?? '—'}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{nameOf(a.tg_id)}</span>
                    {legalOf(a.tg_id) && <span style={{ fontSize: 9.5, color: 'var(--gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }} title="name on the broker account">🏦 {legalOf(a.tg_id)}</span>}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6 }}>{KIND_LABEL[a.kind] ?? a.kind.toUpperCase()}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.kind === 'connect' && `MT5 ${String(a.detail?.login ?? '?')} @ ${String(a.detail?.server ?? '?')} · lot ${String(a.detail?.lot ?? '?')}${a.detail?.strategy ? ` · S${String(a.detail.strategy)}` : ''}${a.detail?.add_strategy ? ` · ➕ EXTRA ACCOUNT #${String(a.detail?.account_no ?? '?')} (STH id ${String(a.tg_id)}-${String(a.detail?.account_no ?? '?')})` : ''} · `}
                      {a.kind === 'risk_change' && `→ ${String(a.detail?.to ?? '?')} (lot ${String(a.detail?.lot ?? '?')}) · `}
                      {a.kind === 'strategy_change' && `→ S${String(a.detail?.to ?? '?')} · `}
                      {/* l'ID que STH affiche pour ce membre (UserID = tg_id) — pour le retrouver dans le dashboard STH */}
                      {['strategy_change', 'pause', 'resume', 'disconnect'].includes(a.kind) && `STH id ${String(a.tg_id)} · `}
                      {new Date(a.created_at).toLocaleString('en-GB')}
                    </div>
                    {/* la ligne VÉRIFICATION : tout ce qu'il faut contrôler chez le broker AVANT d'approuver.
                        Anciennes demandes (sans les nouveaux champs) : broker/@ récupérés de la fiche membre + ⚠ sur le manquant */}
                    {a.kind === 'connect' && (() => {
                      const m = rows.find((r) => r.member_no != null && r.member_no === a.member_no);
                      const broker = String(a.detail?.broker ?? m?.broker ?? '') || null;
                      const uname = String(a.detail?.username ?? m?.tg_username ?? '') || null;
                      const bname = String(a.detail?.broker_name ?? '') || null;
                      const dep = Number(a.detail?.declared_deposit ?? 0) || null;
                      // BROKER HORS PARTENAIRES : le membre a tapé le nom lui-même et le CONNECT auto échouera
                      // (serveur MT jamais exact du premier coup). On le dit AVANT que le support ne clique.
                      const label = String(a.detail?.broker_label ?? '') || null;
                      const manual = broker === 'other' || Boolean(a.detail?.manual_connect);
                      return (
                        <>
                          {manual && (
                            <div style={{ fontSize: 10.5, marginTop: 3, color: '#ff8a5c', fontWeight: 800, letterSpacing: 0.4 }}>
                              ⚠ NON-PARTNER BROKER{label ? ` · ${label.toUpperCase()}` : ''} — connect by hand in STH, the auto-connect will fail on the server name
                            </div>
                          )}
                          <div style={{ fontSize: 10.5, marginTop: 2, color: 'var(--gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            VERIFY → {label ? label.toUpperCase() : broker ? broker.toUpperCase() : '⚠ broker ?'} · {bname ?? '⚠ no name — ask'} · {dep ? `$${dep} declared` : '⚠ no deposit declared — ask'}{uname ? <span style={{ color: 'var(--cyan)' }}> · @{uname}</span> : ''}
                          </div>
                          {/* CE QUE LE MEMBRE A JURÉ (14/08) : compte né du lien Algoria + compte financé.
                              Les demandes ANTÉRIEURES au formulaire n'ont pas ces champs — on affiche donc
                              « not asked » plutôt qu'une croix, pour ne pas faire porter au membre une
                              case qu'on ne lui a jamais montrée. */}
                          <div style={{ fontSize: 10, marginTop: 2, color: 'var(--dim)' }}>
                            {a.detail?.ack_link == null && a.detail?.ack_funded == null
                              ? 'claims: not asked (request predates the checkboxes)'
                              : <>claims: <b style={{ color: a.detail?.ack_link ? 'var(--up)' : '#ff8a5c' }}>{a.detail?.ack_link ? '✓ opened via our link' : '✗ NOT via our link'}</b> · <b style={{ color: a.detail?.ack_funded ? 'var(--up)' : '#ff8a5c' }}>{a.detail?.ack_funded ? '✓ funded' : '✗ not funded'}</b></>}
                          </div>
                          {/* IDENTIFIANTS DÉJÀ TESTÉS À L'INSCRIPTION : 'ok' = STH a réellement joint ce
                              compte MetaTrader. Inutile de le refuser pour « invalid account » — s'il y a
                              un problème il est ailleurs (rattachement, dépôt). Ça enlève le premier motif
                              de refus du champ des hypothèses avant même d'ouvrir le dashboard broker. */}
                          {a.detail?.verify === 'ok' && (
                            <div style={{ fontSize: 10, marginTop: 2, color: 'var(--up)', fontWeight: 700 }}>🔐 credentials verified at signup — MetaTrader login/password/server all work</div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  {a.kind === 'connect' && (
                    <button onClick={() => copyDepositInfo(a)} title="copie « nouveau dépôt à vérifier » (nom, login, broker, montant) — à coller dans le groupe WhatsApp du staff" style={depInfoCopied === a.id ? { ...goldBtn, color: 'var(--up)' } : goldBtn}>{depInfoCopied === a.id ? '✓ COPIÉ' : '📋 WHATSAPP'}</button>
                  )}
                  {a.kind === 'connect' && !creds[a.id] && (
                    <button disabled={busy} onClick={() => reveal(a.id)} title="decrypt the member's MT5 password (timestamped)" style={goldBtn}>🔑 REVEAL</button>
                  )}
                  {a.kind === 'connect' && (
                    <button disabled={busy} onClick={() => connectViaSth(a)} title="connect this account to the copier via STH now, then go LIVE + log the deposit (one click, no manual STH entry)" style={{ ...okBtn, color: '#06121f', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', border: 'none' }}>🔗 CONNECT (STH)</button>
                  )}
                  {a.kind === 'strategy_change' && (
                    <button disabled={busy} onClick={() => moveViaSth(a.id)} title="move this member's receiver to their new strategy's master via the STH API (API-connected members only — manually-added receivers must be moved in the STH dashboard)" style={{ ...okBtn, color: '#06121f', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', border: 'none' }}>🔀 MOVE (STH)</button>
                  )}
                  <button disabled={busy} onClick={() => post({ done: a.id }, () => { setCreds((c) => { const n = { ...c }; delete n[a.id]; return n; }); if (a.kind === 'connect') recordDepositAfterConnect(a); })} title="mark done manually (if you connected the account in STH yourself) — connect cards also offer to log the deposit" style={okBtn}>✓ DONE</button>
                  {a.kind === 'connect' && (
                    <button disabled={busy} onClick={() => waitBroker(a)} title="account not attached to your affiliate ID — the member must ask the broker's support to attach it. Marks the card as blocked upstream so it stops reading as forgotten. Click again once the broker replied." style={a.detail?.waiting_broker ? { ...goldBtn, color: 'var(--gold)', fontWeight: 800 } : miniBtn}>{a.detail?.waiting_broker ? '⏳ WAITING' : '⏳ BROKER'}</button>
                  )}
                  {a.kind === 'connect' && (
                    <button disabled={busy} onClick={() => rejectConnect(a.id)} title="verification failed → member goes back to the wizard with your reason, can resubmit" style={dangerBtn}>REJECT</button>
                  )}
                  <button disabled={busy} onClick={() => post({ dismiss: a.id })} title="dismiss without applying anything (stale/spam card — no side effects)" style={miniBtn}>✕</button>
                </div>
                {creds[a.id] && (
                  <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(245,194,74,.35)', background: 'rgba(245,194,74,.06)' }}>
                    <span>login <b style={{ color: 'var(--text)' }}>{creds[a.id].login}</b></span>
                    <span>server <b style={{ color: 'var(--text)' }}>{creds[a.id].server}</b></span>
                    <span>password <b style={{ color: 'var(--gold)' }}>{creds[a.id].password}</b></span>
                    <button onClick={() => void navigator.clipboard?.writeText(creds[a.id].password)} style={miniBtn}>copy</button>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* ===== MEMBERS — le CRM : recherche + table complète + FICHE au clic ===== */}
        {tab === 'members' && sel && (
          <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderColor: 'rgba(43,227,245,.35)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="mono goldText" style={{ fontWeight: 800, fontSize: 15 }}>#{sel.member_no}</span>
              {/* marché du membre : pilote la langue de l'app, des DM et des relances. Corrigeable : un Italien
                  entré par une pub anglaise recevait des DM en anglais à vie, sans aucun moyen de le basculer. */}
              {editPick(sel.tg_id, 'locale', String(sel.locale ?? 'en'), [{ v: 'en', label: '🇬🇧 EN' }, { v: 'it', label: '🇮🇹 IT' }], "member's market — drives the app language, the bot DMs and the nudges")}
              <span style={{ fontSize: 15, fontWeight: 800 }}>{sel.tg_username ? '@' + sel.tg_username : (sel.tg_name ?? '—')}</span>
              {sel.tg_username && sel.tg_name && <span style={{ fontSize: 12, color: 'var(--dim)' }}>{sel.tg_name}</span>}
              <button onClick={() => editLegalName(sel.tg_id, legalOf(sel.tg_id))} className="mono"
                title="name on the broker account — click to fix it (members often type the broker's name here by mistake)"
                style={{ fontSize: 11, cursor: 'pointer', color: legalOf(sel.tg_id) ? 'var(--gold)' : 'var(--dim)', border: `1px ${legalOf(sel.tg_id) ? 'solid rgba(245,194,74,.35)' : 'dashed var(--border)'}`, background: 'transparent', borderRadius: 6, padding: '2px 8px' }}>
                🏦 {legalOf(sel.tg_id) ?? 'no holder name — add'} ✎
              </button>
              <StatusChip status={sel.status} />
              {/* rattrapage MANUEL du statut : un membre coincé en « pending_copier » alors qu'il copie déjà
                  n'avait aucune sortie. Ne touche ni au copieur ni au bannissement (→ RECONNECT / BAN). */}
              {editPick(sel.tg_id, 'status', sel.status, [
                { v: 'onboarding', label: 'onboarding' }, { v: 'pending_copier', label: 'pending_copier' },
                { v: 'live', label: 'live' }, { v: 'paused', label: 'paused' },
              ], 'fix the status by hand — does NOT touch the copier (use RECONNECT / OFF-BOARD for that)',
                (v) => `Set the status to "${v}" by hand?\n\nThis only changes the label in our database — the copier is NOT touched.`)}
              {sel.tg_username && <a href={`https://t.me/${sel.tg_username}`} target="_blank" rel="noreferrer" style={{ ...miniBtn, textDecoration: 'none', color: 'var(--cyan)', borderColor: 'rgba(43,227,245,.4)' }}>💬 DM</a>}
              <span style={{ flex: 1 }} />
              <button onClick={() => { setSel(null); setSelActs(null); setSelCreds(null); }} style={miniBtn}>✕ close</button>
            </div>
            {/* actions fiche : voir les identifiants à tout moment + off-board d'un client parti */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {sel.mt5_login && <button disabled={busy} onClick={() => showCreds(sel.tg_id)} title="decrypt this member's MT5 login/server/password (timestamped)" style={goldBtn}>🔑 SHOW CREDENTIALS</button>}
              {sel.mt5_login && <button disabled={busy} onClick={() => reconnectSth(sel)} title="re-connect this member to the STH copier with the credentials on file (e.g. after an accidental disconnect on the STH dashboard)" style={goldBtn}>🔗 RECONNECT STH</button>}
              {sel.mt5_login && <button disabled={busy} onClick={() => sthCheck(sel.tg_id)} title="ask the STH API directly: is this member's MT account connected to the copier, and which masters does it see?" style={goldBtn}>🔍 STH STATUS</button>}
              {/* TOUJOURS visible : « paused » peut venir du membre lui-même (bouton pause copy) — masquer
                  l'off-board sur un membre en pause bloquait pile le cas « il a retiré, je veux le sortir » */}
              <button disabled={busy} onClick={() => offboard(sel)} title="client left → status paused + copier disconnect (STH or queued) + timeline note (remove from the VIP Telegram channel manually)" style={dangerBtn}>⛔ OFF-BOARD</button>
              {/* 🚫 BAN — coupe l'accès à l'app : session en cours ET reconnexion. Pour les concurrents /
                  abus, pas pour un client qui part (→ OFF-BOARD). Réversible. */}
              {sel.banned_at ? (
                <button disabled={busy} onClick={() => banMember(sel, true)} title="lift the ban — this account can sign in again" style={{ ...goldBtn, color: 'var(--up)', borderColor: 'rgba(31,216,176,.45)' }}>✅ UNBAN</button>
              ) : (
                <button disabled={busy} onClick={() => banMember(sel, false)} title="revoke access: kills the live session AND blocks any new sign-in, cuts the copier, removes from the VIP whitelist" style={{ ...dangerBtn, fontWeight: 800 }}>🚫 BAN</button>
              )}
              {selCreds && (
                <span className="mono" style={{ display: 'inline-flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(10,17,31,.6)' }}>
                  <span>login <b style={{ color: 'var(--text)' }}>{selCreds.login}</b></span>
                  <span>server <b style={{ color: 'var(--text)' }}>{selCreds.server}</b></span>
                  <span>password <b style={{ color: 'var(--gold)' }}>{selCreds.password}</b></span>
                  <button onClick={() => void navigator.clipboard?.writeText(selCreds.password)} style={miniBtn}>copy pwd</button>
                </span>
              )}
            </div>
            {/* identité + compte — tout ce qu'il faut savoir avant un appel */}
            <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', fontSize: 11.5, color: 'var(--muted)' }}>
              {/* le broker pilote le barème de commission ET le message « à vérifier » envoyé au staff :
                  faux, la com n'est pas réclamée au bon endroit. Les dépôts DÉJÀ saisis gardent le leur
                  (ils ont leur propre édition dans DEPOSITS) — on ne réécrit pas une compta passée. */}
              <span>broker {editPick(sel.tg_id, 'broker', sel.broker ?? '', BROKERS.map((b) => ({ v: b.key, label: b.name })), "member's broker — drives the commission schedule and the staff verification message")}</span>
              {/* STRATÉGIE + LOT : la colonne n'est pas la vérité, le copieur l'est → changer ici resynchronise
                  STH dans la foulée (et remonte l'échec au lieu de l'avaler). C'est le geste « passe-le en S1 ». */}
              <span>strategy {editPick(sel.tg_id, 'strategy', String(sel.strategy ?? ''), [{ v: '1', label: 'S1' }, { v: '2', label: 'S2' }, { v: '3', label: 'S3' }], 'strategy — also moves the copier to that master via STH',
                (v) => `Move this member to S${v}?\n\nIf they are connected, the copier is switched to the S${v} master right away.`)}</span>
              <span>lot {lotPick(sel)}</span>
              <span title="legacy label derived from the lot — the lot above is the real copy size">risk <b style={{ color: 'var(--dim)' }}>{sel.risk_tier}</b></span>
              {/* un seul caractère d'écart sur le serveur et la copie ne démarre jamais — c'est LA panne
                  la plus fréquente, et elle était invisible autant qu'incorrigeable depuis ici. */}
              <span>MT5 {editText(sel.tg_id, 'mt5_login', 'MT account number (login)', sel.mt5_login)} @ {serverPick(sel)}</span>
              <span>MT pwd <button disabled={busy} onClick={() => editPassword(sel)} className="mono" title="replace the stored MT password (the member changed it at the broker → the copy drops)" style={{ fontSize: 11.5, fontWeight: 700, cursor: 'pointer', background: 'transparent', border: 'none', borderBottom: '1px dashed rgba(130,152,190,.5)', padding: '0 1px', color: 'var(--text)' }}>replace ✎</button></span>
              {/* l'ID que STH affiche pour les receivers connectés via l'API (UserID = tg_id) — la clé pour
                  rapprocher « 7557770646 » vu dans STH ↔ le bon membre ici. Copiable en un clic. */}
              <span>STH id <b style={{ color: 'var(--gold)' }}>{sel.tg_id}</b> <button onClick={() => void navigator.clipboard?.writeText(String(sel.tg_id))} style={miniBtn}>copy</button></span>
              <span>country {countrySelect(sel.tg_id, sel.country, sel.source)}</span>
              {/* adresse de retrait du parrain : une adresse fausse, et le virement part dans le vide sans
                  retour possible. Affichée en ENTIER ici (elle était tronquée à 8 caractères, donc invérifiable). */}
              <span>USDT {editText(sel.tg_id, 'usdt_trc20', 'USDT TRC20 payout address', sel.usdt_trc20, sel.usdt_trc20 ?? '—', 'Paste the full TRC20 address (starts with T, 34 characters). Empty = clear it.')}</span>
              <span>since <b style={{ color: 'var(--text)' }}>{new Date(sel.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</b></span>
              {/* attribution de parrainage : elle décide qui touche la commission — donc elle se conteste,
                  donc elle doit se corriger. Accepte #numéro, @pseudo ou tg id ; vide = plus de parrain. */}
              <span>referred by {editText(sel.tg_id, 'referred_by', 'Referred by', sel.referred_by ? String(sel.referred_by) : null, sel.referred_by ? nameOf(sel.referred_by) : '—', 'Enter #member number, @username or the Telegram id. Empty = no referrer.')}</span>
              <span>invited <b style={{ color: 'var(--text)' }}>{rows.filter((r) => Number(r.referred_by) === Number(sel.tg_id)).length}</b></span>
              {/* VOLONTAIREMENT non éditable : le canal d'acquisition est une mesure, pas une donnée client.
                  Le réécrire à la main fausserait pile la répartition par source qui sert au bilan hebdo. */}
              <span title="acquisition channel, captured at the first click — read-only on purpose: editing it would falsify the weekly per-source funnel">source <b style={{ color: sel.source ? 'var(--cyan)' : 'var(--dim)' }}>{sel.source ?? 'organic / unknown'}</b></span>
            </div>
            {/* ➕ COMPTES SUPPLÉMENTAIRES (multi-stratégies) — chaque compte a SON STH id ({tg_id}-{n}) */}
            {extraAccounts.filter((a) => Number(a.tg_id) === Number(sel.tg_id)).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid rgba(43,227,245,.25)', borderRadius: 10, padding: '10px 12px', background: 'rgba(43,227,245,.04)' }}>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.6, color: 'var(--cyan)', fontWeight: 800 }}>➕ EXTRA ACCOUNTS (MULTI-STRATEGY)</span>
                {extraAccounts.filter((a) => Number(a.tg_id) === Number(sel.tg_id)).map((a) => (
                  <div key={a.id} className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11, color: 'var(--muted)', alignItems: 'center' }}>
                    <b style={{ color: a.status === 'live' ? 'var(--up)' : a.status === 'pending' ? 'var(--gold)' : 'var(--dim)' }}>S{a.strategy} · {a.status}</b>
                    <span>{a.broker ?? '—'}</span>
                    <span>MT {a.mt5_login ?? '—'}</span>
                    {a.declared_deposit != null && <span>${Number(a.declared_deposit)}</span>}
                    <span>STH id <b style={{ color: 'var(--gold)' }}>{sel.tg_id}-{a.account_no}</b> <button onClick={() => void navigator.clipboard?.writeText(`${sel.tg_id}-${a.account_no}`)} style={miniBtn}>copy</button></span>
                  </div>
                ))}
              </div>
            )}
            {/* notes privées — le réflexe CRM avant/après chaque appel */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }} placeholder="private note — e.g. called on the 12th, waiting for his salary…" style={{ ...inp, flex: 1 }} />
              <button disabled={busy || !noteText.trim()} onClick={addNote} style={{ padding: '10px 16px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', opacity: noteText.trim() ? 1 : 0.5 }}>+ NOTE</button>
            </div>
            {/* timeline — toutes ses actions (connect, kyc, dépôts, notes…), la plus récente en premier */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
              {selActs == null && <p style={dimP}>loading history…</p>}
              {selActs?.length === 0 && <p style={dimP}>No activity yet — this member signed up and stopped there.</p>}
              {selActs?.map((a) => {
                const stC = a.status === 'pending' ? 'var(--gold)' : a.status === 'rejected' ? '#ff6b8a' : (a.status === 'superseded' || a.status === 'dismissed') ? 'var(--dim)' : 'var(--up)';
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border)', background: a.kind === 'note' ? 'rgba(245,194,74,.05)' : 'rgba(10,17,31,.5)' }}>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>{KIND_LABEL[a.kind] ?? a.kind.toUpperCase()}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', flex: 1, minWidth: 120, overflowWrap: 'anywhere' }}>{actSummary(a)}</span>
                    {a.kind !== 'note' && a.status && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.8, color: stC, whiteSpace: 'nowrap' }}>{a.status.toUpperCase()}</span>}
                    {a.kind === 'note' && <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap' }}>by {a.done_by ?? '—'}</span>}
                    {a.kind === 'note' && <button disabled={busy} onClick={() => delNote(a.id)} style={miniBtn}>🗑</button>}
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {/* PUSH ALERTS : réduit à UNE ligne de stat — le mur de 85 chips « à relancer » prenait tout
            l'écran sans être actionnable (retiré à la demande de Mathieu, 27/07). Le compteur reste :
            c'est le seul signal utile (couverture push de la base). */}
        {tab === 'members' && (
          <div className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 4px', fontSize: 11.5, color: 'var(--muted)' }}>
            <span>🔔</span>
            <b style={{ color: alertsOn > 0 ? 'var(--up)' : 'var(--dim)', fontSize: 13 }}>{alertsOn}</b>
            <span>/ {rows.length} have push alerts on</span>
          </div>
        )}

        {tab === 'members' && (
          <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={secH}>MEMBERS · {filtered.length}</h2>
              <span style={{ flex: 1 }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search @, name, broker, MT5, status…" style={{ ...inp, width: 280 }} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 860 }}>
                <thead>
                  <tr>
                    {['#', 'MEMBER', 'STATUS', 'BROKER', 'RISK', 'MT5', 'USDT', 'REFERRED BY', 'SINCE'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '7px 10px', fontSize: 9.5, letterSpacing: 1.2, color: 'var(--dim)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.member_no} onClick={() => openMember(r)} title="open member file"
                      style={{ borderBottom: '1px solid rgba(130,152,190,.08)', cursor: 'pointer', background: sel?.member_no === r.member_no ? 'rgba(43,227,245,.06)' : undefined }}>
                      <td style={td}><span className="goldText" style={{ fontWeight: 800 }}>#{r.member_no}</span></td>
                      <td style={{ ...td, maxWidth: 190 }}>
                        <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '—')}</div>
                        {r.tg_username && r.tg_name && <div style={{ fontSize: 9.5, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tg_name}</div>}
                        {legalOf(r.tg_id) && <div style={{ fontSize: 9.5, color: 'var(--gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="name on the broker account (what you see in STH / deposits)">🏦 {legalOf(r.tg_id)}</div>}
                      </td>
                      <td style={td}><StatusChip status={r.status} /></td>
                      <td style={{ ...td, color: 'var(--muted)' }}>{r.broker ?? '—'}</td>
                      <td style={{ ...td, color: 'var(--muted)' }}>{r.risk_tier}</td>
                      <td style={{ ...td, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.mt5_login ? `${r.mt5_login} @ ${r.mt5_server ?? '?'}` : '—'}</td>
                      <td style={{ ...td, color: r.usdt_trc20 ? 'var(--cyan)' : 'var(--dim)' }} title={r.usdt_trc20 ?? undefined}>{r.usdt_trc20 ? r.usdt_trc20.slice(0, 6) + '…' : '—'}</td>
                      <td style={{ ...td, color: 'var(--muted)' }}>{r.referred_by ? nameOf(r.referred_by) : '—'}</td>
                      <td style={{ ...td, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p style={{ ...dimP, padding: 10 }}>No member matches “{search}”.</p>}
            </div>
          </section>
        )}

        {/* ===== DEPOSITS — le registre des dépôts broker : la source du bilan de fin de mois ===== */}
        {tab === 'deposits' && (
          <>
            {/* filet de sécurité : LIVE sans ligne de dépôt — cliquer pré-remplit le formulaire ci-dessous */}
            {liveNoDeposit.length > 0 && (
              <section className="panel" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid rgba(255,138,92,.45)' }}>
                <h2 style={{ ...secH, color: '#ff8a5c' }}>⚠ LIVE, NO DEPOSIT LOGGED · {liveNoDeposit.length}</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {liveNoDeposit.map((r) => (
                    <button
                      key={r.tg_id}
                      onClick={() => { setDepTg(String(r.tg_id)); if (r.broker) setDepBroker(r.broker); depComAuto.current = true; }}
                      title="prefills the form below — enter the validated amount and hit + ADD"
                      className="mono"
                      style={{ fontSize: 11, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', cursor: 'pointer' }}
                    >
                      #{r.member_no} {r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '')}{r.broker ? ` · ${r.broker.toUpperCase()}` : ''}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {/* saisie : une ligne dès qu'un dépôt est constaté chez le broker partenaire */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={secH}>LOG A DEPOSIT</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={depTg}
                  onChange={(e) => {
                    setDepTg(e.target.value);
                    const m = rows.find((r) => String(r.tg_id) === e.target.value);
                    if (m?.broker) setDepBroker(m.broker);
                  }}
                  style={{ ...inp, width: 210 }}
                >
                  <option value="">member…</option>
                  {[...rows].sort((a, b) => a.member_no - b.member_no).map((r) => (
                    <option key={r.tg_id} value={String(r.tg_id)}>#{r.member_no} {r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '')}</option>
                  ))}
                </select>
                {/* liste déroulante des 5 brokers partenaires (fini la saisie à la main) — pré-remplie avec le
                    broker principal du membre au choix du membre ; PENSER à la changer pour le dépôt d'un
                    2e compte (multi-stratégies). Valeur legacy hors liste conservée en option pour l'édition. */}
                <select value={depBroker} onChange={(e) => setDepBroker(e.target.value)} style={{ ...inp, width: 160 }}>
                  <option value="">broker…</option>
                  {BROKERS.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
                  {depBroker && !BROKERS.some((b) => b.key === depBroker) && <option value={depBroker}>{depBroker}</option>}
                </select>
                <input value={depAmount} onChange={(e) => setDepAmount(e.target.value)} placeholder="deposit $" inputMode="decimal" style={{ ...inp, width: 110 }} />
                <input value={depCom} onChange={(e) => { setDepCom(e.target.value); depComAuto.current = e.target.value === ''; }} placeholder="expected com $" title="pré-rempli depuis le barème du broker — modifiable, vider le champ pour réactiver l'auto" inputMode="decimal" style={{ ...inp, width: 140 }} />
                <input type="date" value={depDate} onChange={(e) => setDepDate(e.target.value)} style={{ ...inp, width: 150 }} />
                <input value={depNote} onChange={(e) => setDepNote(e.target.value)} placeholder="note (optional)" style={{ ...inp, flex: 1, minWidth: 160 }} />
                <button disabled={busy || !depTg || !Number(depAmount)} onClick={addDeposit} style={{ padding: '10px 18px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', opacity: !depTg || !Number(depAmount) ? 0.5 : 1 }}>+ ADD</button>
              </div>
            </section>

            {/* ===== BEST LINK — le tunnel optimisé : budget annoncé → broker le plus rémunérateur.
                Demander au prospect combien il compte investir AVANT de lui envoyer un lien, saisir le
                montant ici, envoyer le lien du haut du classement. Prospect sélectionné → ses brokers
                existants sont retirés du classement (jamais renvoyer quelqu'un là où il a déjà un compte). */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={secH}>BEST LINK — WHERE TO SEND A DEPOSIT</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={planAmount} onChange={(e) => setPlanAmount(e.target.value)} placeholder="planned deposit $" inputMode="decimal" style={{ ...inp, width: 150 }} />
                <select value={planTg} onChange={(e) => setPlanTg(e.target.value)} title="optional — removes the brokers this member already uses" style={{ ...inp, width: 210 }}>
                  <option value="">prospect (optional)…</option>
                  {[...rows].sort((a, b) => a.member_no - b.member_no).map((r) => (
                    <option key={r.tg_id} value={String(r.tg_id)}>#{r.member_no} {r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '')}</option>
                  ))}
                </select>
                {planExcluded.size > 0 && <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>already at: {[...planExcluded].map((k) => (BROKERS.find((b) => b.key === k)?.name ?? k)).join(', ')}</span>}
              </div>
              {!Number(planAmount) && <p style={dimP}>Ask the prospect how much he plans to invest, type it above — the ranking tells you which broker link pays the most for that budget.</p>}
              {Number(planAmount) > 0 && planRanking.length === 0 && <p style={dimP}>No commission at this amount on any available broker{Number(planAmount) < 200 ? ' — only RaiseFX pays under $200 (from $100)' : ''}.</p>}
              {planRanking.map(({ key, usd }, i) => {
                const b = BROKERS.find((x) => x.key === key);
                if (!b) return null;
                const top = i === 0;
                const bonus = b.bonus; // capturé : le narrowing TS ne traverse pas les callbacks onClick
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', borderRadius: 10, border: `1px solid ${top ? 'color-mix(in srgb, var(--gold) 45%, transparent)' : 'var(--border)'}`, background: top ? 'rgba(240,200,80,.06)' : 'rgba(10,17,31,.55)' }}>
                    <span className="mono" style={{ fontSize: 11, color: top ? 'var(--gold)' : 'var(--dim)', minWidth: 18, fontWeight: 800 }}>{i + 1}.</span>
                    <span style={{ fontSize: 12.5, fontWeight: top ? 800 : 600, color: 'var(--text)' }}>{b.name}</span>
                    {top && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, color: 'var(--gold)', border: '1px solid color-mix(in srgb, var(--gold) 40%, transparent)', borderRadius: 6, padding: '2px 7px' }}>BEST</span>}
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--up)' }}>${usd}</span>
                    {/* code bonus (closing manuel) — clic = copie du CODE seul, à coller dans le DM avec le lien */}
                    {bonus && (
                      <button onClick={() => copyBrokerLink(key + ':code', bonus.code)} title={`${bonus.pct}% deposit bonus — click to copy the code`} className="mono" style={{ ...miniBtn, fontWeight: 800, color: 'var(--gold)' }}>
                        {planCopied === key + ':code' ? '✓ code copied' : `🎁 ${bonus.code}`}
                      </button>
                    )}
                    <span style={{ flex: 1 }} />
                    <button onClick={() => copyBrokerLink(key, b.url)} style={miniBtn}>{planCopied === key ? '✓ copied' : '⧉ copy link'}</button>
                  </div>
                );
              })}
            </section>

            {/* le bilan du mois : navigation ‹ › + totaux + export CSV (Google Sheets / Excel) */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={() => shiftMonth(-1)} style={miniBtn}>‹</button>
                <h2 style={{ ...secH, minWidth: 150, textAlign: 'center' }}>{monthLabel}</h2>
                <button onClick={() => shiftMonth(1)} style={miniBtn}>›</button>
                <span style={{ flex: 1 }} />
                <button disabled={monthDeps.length === 0} onClick={exportCsv} style={{ ...goldBtn, opacity: monthDeps.length === 0 ? 0.5 : 1 }}>⬇ EXPORT CSV</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <Kpi label="DEPOSITS" value={String(monthDeps.length)} accent="var(--cyan)" />
                <Kpi label="DEPOSITED" value={`$${Math.floor(depTotals.deposited)}`} accent="var(--cyan)" />
                <Kpi label="COM RECEIVED" value={`$${Math.floor(depTotals.received)}`} accent="var(--up)" />
                <Kpi label="COM PENDING" value={`$${Math.floor(depTotals.pending)}`} accent="var(--gold)" hot={depTotals.pending > 0} />
                <Kpi label="COM LOST" value={`$${Math.floor(depTotals.lost)}`} accent="#ff6b8a" />
              </div>
              {monthDeps.length === 0 && <p style={dimP}>No deposits logged for this month yet — add one above as soon as a member funds his broker account.</p>}
              {monthDeps.map((d) => {
                const st = String(d.detail?.commission_status ?? 'pending');
                const stC = st === 'received' ? 'var(--up)' : st === 'canceled' ? '#ff6b8a' : 'var(--gold)';
                return (
                  <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', minWidth: 70 }}>{depDateOf(d).slice(0, 10)}</span>
                      {/* la ligne vient d'un mois précédent : sans ce repère, un dépôt de juillet reporté
                          en août ressemble à un dépôt d'août et le bilan devient illisible à la relecture */}
                      {d.detail?.booked_ym && depDateOf(d).slice(0, 7) !== String(d.detail.booked_ym) && (
                        <span className="mono" title={`deposited in ${depDateOf(d).slice(0, 7)}, booked here because the commission was not validated yet`}
                          style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, color: 'var(--cyan)', border: '1px solid rgba(43,227,245,.4)', borderRadius: 6, padding: '2px 6px' }}>
                          ↪ FROM {depDateOf(d).slice(0, 7)}
                        </span>
                      )}
                      <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12 }}>#{d.member_no ?? '—'}</span>
                      {/* pas nameOf : sans @username il renvoie #no, déjà affiché juste avant → doublon */}
                      <span style={{ fontSize: 12, color: 'var(--text)' }}>{(() => { const m = rows.find((r) => Number(r.tg_id) === Number(d.tg_id)); return m?.tg_username ? '@' + m.tg_username : (m?.tg_name ?? '—'); })()}</span>
                      {legalOf(d.tg_id) && <span className="mono" style={{ fontSize: 10.5, color: 'var(--gold)' }} title="name on the broker account">🏦 {legalOf(d.tg_id)}</span>}
                      {/* pays : hérité du membre — éditable ICI pour rattraper les dépôts déjà saisis en 2 clics */}
                      {countrySelect(d.tg_id, rows.find((r) => Number(r.tg_id) === Number(d.tg_id))?.country ?? null, rows.find((r) => Number(r.tg_id) === Number(d.tg_id))?.source ?? null)}
                      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{(d.detail?.broker ?? '—').toUpperCase()}</span>
                      <button onClick={() => editDepositAmount(d)} title="edit deposit amount (e.g. member deposited in several chunks)" className="mono" style={{ ...miniBtn, fontSize: 12.5, fontWeight: 800, color: 'var(--cyan)' }}>${Number(d.detail?.amount_usd ?? 0)} ✎</button>
                      <span style={{ color: 'var(--dim)', fontSize: 11 }}>→ com</span>
                      <button onClick={() => editDepositCom(d)} title="edit expected commission" className="mono" style={{ ...miniBtn, fontSize: 12, fontWeight: 800, color: 'var(--gold)' }}>${Number(d.detail?.commission_usd ?? 0)} ✎</button>
                      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, color: stC, border: `1px solid color-mix(in srgb, ${stC} 40%, transparent)`, borderRadius: 6, padding: '2px 7px' }}>{st === 'canceled' ? 'LOST' : st.toUpperCase()}</span>
                      <span style={{ flex: 1 }} />
                      {st !== 'received' && <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, comStatus: 'received' } })} style={okBtn}>✓ RECEIVED</button>}
                      {st !== 'canceled' && <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, comStatus: 'canceled' } })} title="commission fell through (flash withdrawal, broker refusal…)" style={dangerBtn}>✗ LOST</button>}
                      {st !== 'pending' && <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, comStatus: 'pending' } })} title="back to pending" style={miniBtn}>↺</button>}
                      {/* REPORT AU MOIS SUIVANT — pour les dépôts dont la com n'est pas encore validée (lot
                          minimum pas atteint). La ligne quitte le bilan de ce mois et réapparaît au suivant,
                          SANS que la date du dépôt soit modifiée. Réversible : le bouton ↩ la ramène. */}
                      {d.detail?.booked_ym ? (
                        <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, bookedYm: null } })}
                          title={`reported to ${String(d.detail.booked_ym)} — click to put it back in its real month (${depDateOf(d).slice(0, 7)})`}
                          style={{ ...miniBtn, color: 'var(--gold)' }}>↩ UNDO MOVE</button>
                      ) : (
                        <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, bookedYm: nextYm(ym) } })}
                          title={`commission not validated yet (lot not traded) → move this line to ${nextYm(ym)}. The deposit date is NOT changed.`}
                          style={{ ...miniBtn, color: 'var(--cyan)' }}>→ {nextYm(ym)}</button>
                      )}
                      <button disabled={busy} onClick={() => deleteDeposit(d)} title="delete this line (typo)" style={miniBtn}>🗑</button>
                    </div>
                    {d.detail?.note && <div style={{ fontSize: 11, color: 'var(--dim)', paddingLeft: 80 }}>{String(d.detail.note)}</div>}
                  </div>
                );
              })}
            </section>
          </>
        )}

        {/* ===== AFFILIATE — l'argent des parrains ===== */}
        {tab === 'affiliate' && aff && (
          <>
            {aff.flagged.length > 0 && <div style={warnBox}>⚠ negative balance: {aff.flagged.map((f) => `${f.username ? '@' + f.username : '#' + f.member_no} (${Math.floor(f.balance)}$)`).join(' · ')}</div>}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={secH}>PAYOUTS — WAITING {aff.pendingPayouts.length > 0 && `· ${aff.pendingPayouts.length}`}</h2>
              {aff.pendingPayouts.length === 0 && <p style={dimP}>No withdrawal requests.</p>}
              {aff.pendingPayouts.map((p) => (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(245,194,74,.35)', background: 'rgba(245,194,74,.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800 }}>💸 <span className="goldText">${Number(p.amount)}</span> → {nameOf(p.tg_id)}</span>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{new Date(p.created_at).toLocaleString('en-GB')}</span>
                    <span style={{ flex: 1 }} />
                    <button disabled={busy} onClick={() => payPayout(p.id)} style={okBtn}>✓ PAID</button>
                    <button disabled={busy} onClick={() => rejectPayout(p.id)} style={dangerBtn}>REJECT</button>
                  </div>
                  <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
                    <span>{p.address}</span>
                    <button onClick={() => void navigator.clipboard?.writeText(p.address)} style={miniBtn}>copy</button>
                  </div>
                </div>
              ))}
            </section>
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={secH}>COMMISSIONS — CONFIRM WHEN THE BROKER PAID YOU {aff.pendingCommissions.length > 0 && `· ${aff.pendingCommissions.length}`}</h2>
              {aff.pendingCommissions.length === 0 && <p style={dimP}>Nothing pending — commissions appear when a referred member is approved.</p>}
              {aff.pendingCommissions.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12 }}>
                    💰 <b className="goldText">${Number(c.amount)}</b> → {nameOf(c.referrer_tg_id)}
                    <span style={{ color: 'var(--dim)', fontSize: 10.5 }}> · referred {c.detail?.referred_member_no ? `#${String(c.detail.referred_member_no)}` : nameOf(c.referred_tg_id)}</span>
                  </span>
                  <span style={{ flex: 1 }} />
                  <button disabled={busy} onClick={() => post({ confirmCommission: c.id })} style={okBtn}>✓ CONFIRM</button>
                  <button disabled={busy} onClick={() => cancelCommission(c.id)} style={dangerBtn}>CANCEL</button>
                </div>
              ))}
              {aff.recentCommissions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, borderTop: '1px solid rgba(130,152,190,.12)', paddingTop: 9 }}>
                  <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.4, color: 'var(--dim)' }}>RECENT DECISIONS</span>
                  {aff.recentCommissions.slice(0, 10).map((c) => (
                    <div key={c.id} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--dim)' }}>
                      <span style={{ color: c.status === 'confirmed' ? 'var(--up)' : 'rgba(210,150,165,.75)' }}>{c.status === 'confirmed' ? '✓' : '✗'}</span>
                      <span>${Number(c.amount)} → {nameOf(c.referrer_tg_id)}{c.kind === 'milestone' ? ' (milestone)' : ''}{c.reason ? ` · ${c.reason}` : ''}</span>
                      <span style={{ flex: 1 }} />
                      {c.status === 'confirmed' && <button disabled={busy} onClick={() => cancelCommission(c.id)} title="client withdrew his deposit → claw back" style={miniBtn}>claw back</button>}
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h2 style={secH}>PAYOUT HISTORY</h2>
              {aff.recentPayouts.length === 0 && <p style={dimP}>No processed payouts yet.</p>}
              {aff.recentPayouts.map((p) => (
                <div key={p.id} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--dim)' }}>
                  <span style={{ color: p.status === 'paid' ? 'var(--up)' : 'rgba(210,150,165,.75)' }}>{p.status === 'paid' ? '✓' : '✗'}</span>
                  <span>${Number(p.amount)} → {nameOf(p.tg_id)}{p.reason ? ` · ${p.reason}` : ''}</span>
                  {p.tx_hash && <a href={`https://tronscan.org/#/transaction/${p.tx_hash}`} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'none', fontSize: 10 }}>tx ↗</a>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 9.5 }}>{new Date(p.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                </div>
              ))}
            </section>
          </>
        )}

        {/* ===== TOOLS — la boîte à outils de l'opérateur : push composer, relance des leads, legacy ===== */}
        {tab === 'tools' && (
          <>
            {/* 📣 ANNONCE GROUPÉE — née du basculement S1 → S2 : prévenir 17 membres un par un depuis le
                fil BOT ACTIVITY, c'est 17 clics et la certitude d'en oublier un. L'audience est résolue
                CÔTÉ SERVEUR (le navigateur n'envoie qu'un nom de segment), et l'étiquette empêche qu'un
                double clic renvoie le même message à quelqu'un qui l'a déjà reçu. */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
              <h2 style={secH}>📣 ANNOUNCE TO A SEGMENT (bot DM)</h2>
              <p style={dimP}>One message, sent through the Algoria bot to a whole segment. The tag below is the anti-duplicate lock: anyone who already received it is skipped, so clicking twice is safe.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={bcAudience} onChange={(e) => setBcAudience(e.target.value as 'ex_s1' | 'live')} className="mono" style={{ fontSize: 11.5, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)' }}>
                  <option value="ex_s1">ex-S1 — awaiting their move to S2</option>
                  <option value="live">all live + paused members</option>
                </select>
                <input value={bcTag} onChange={(e) => setBcTag(e.target.value)} placeholder="anti-duplicate tag" className="mono" style={{ fontSize: 11.5, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', flex: '1 1 190px' }} />
              </div>
              <textarea value={bcText} onChange={(e) => setBcText(e.target.value)} rows={13}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 12.5, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical' }} />
              <p style={{ ...dimP, margin: 0 }}>{'{name}'} becomes the member&rsquo;s first name when we know it, and disappears cleanly when we don&rsquo;t. Basic HTML (&lt;b&gt;, &lt;i&gt;) is supported.</p>
              <button disabled={busy || !bcText.trim()} onClick={sendBroadcast} style={{ padding: '10px 16px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', opacity: busy ? 0.5 : 1, alignSelf: 'flex-start' }}>📣 SEND</button>
              {bcReport && (
                <div className="mono" style={{ fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid var(--border)', paddingTop: 9 }}>
                  <span><b style={{ color: 'var(--up)' }}>{bcReport.sent} sent</b>{bcReport.skipped > 0 && <> · {bcReport.skipped} already had it</>}{bcReport.failed > 0 && <> · <b style={{ color: '#ff6b8a' }}>{bcReport.failed} failed</b></>}</span>
                  {bcReport.report.filter((r) => !r.ok).map((r, i) => (
                    <span key={i} style={{ color: '#ff6b8a' }}>#{r.member_no ?? '?'} — {r.error}</span>
                  ))}
                </div>
              )}
            </section>

            {/* AUDIT STH (03/08) — ne dans le cas #7 : une cliente affichee LIVE chez nous, connectee chez
                STH, mais abonnee a AUCUN master. Elle ne recevait plus un seul trade, et RIEN dans notre
                base ne permettait de le voir — seul STH connait cet etat. C'est le pire defaut possible
                pour un copieur : le membre croit trader, regarde un ecran qui ne bouge plus, et c'est lui
                qui finit par nous prevenir. Ce bouton pose la question a STH pour chaque membre live.
                Les membres EN PAUSE ne sont jamais touches : leur absence de master est volontaire. */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
              <h2 style={secH}>🩺 STH AUDIT — who is actually copying?</h2>
              <p style={dimP}>Asks STH, member by member, whether each LIVE account is really subscribed to a master. Paused members are never touched — their empty subscription is deliberate.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button disabled={busy} onClick={() => { setBusy(true); setSthAudit(null); void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sthAudit: 'check' }) }).then(async (r) => { const d = await r.json(); if (d.error) window.alert(`⚠ ${d.error}`); else setSthAudit(d); }).finally(() => setBusy(false)); }}
                  style={goldBtn}>🔍 CHECK ONLY</button>
                <button disabled={busy || !sthAudit || !(sthAudit.summary.orphan > 0)} onClick={() => { if (!window.confirm(`Reconnect ${sthAudit?.summary.orphan} member(s) to their strategy? This resumes copying on their live account.`)) return; setBusy(true); void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sthAudit: 'repair' }) }).then(async (r) => { const d = await r.json(); if (d.error) window.alert(`⚠ ${d.error}`); else setSthAudit(d); }).finally(() => setBusy(false)); }}
                  style={{ ...goldBtn, opacity: sthAudit && sthAudit.summary.orphan > 0 ? 1 : 0.45 }}>🔧 REPAIR ORPHANS</button>
              </div>
              {sthAudit && (
                <>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {sthAudit.summary.checked} checked · <b style={{ color: 'var(--up)' }}>{sthAudit.summary.ok} ok</b>
                    {sthAudit.summary.orphan > 0 && <> · <b style={{ color: '#ff8a5c' }}>{sthAudit.summary.orphan} copying nothing</b></>}
                    {sthAudit.summary.repaired > 0 && <> · <b style={{ color: 'var(--up)' }}>{sthAudit.summary.repaired} repaired</b></>}
                    {sthAudit.summary.failed > 0 && <> · <b style={{ color: '#ff6b8a' }}>{sthAudit.summary.failed} failed</b></>}
                    {sthAudit.summary.unknown > 0 && <> · {sthAudit.summary.unknown} not connected</>}
                    {sthAudit.summary.error > 0 && <> · {sthAudit.summary.error} STH error</>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 360, overflowY: 'auto' }}>
                    {sthAudit.rows.filter((r) => r.state !== 'ok').map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline', flexWrap: 'wrap', padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.5)' }}>
                        <span className="mono goldText" style={{ fontSize: 11, fontWeight: 800 }}>#{r.member_no ?? '—'}</span>
                        <span style={{ fontSize: 12, color: 'var(--text)' }}>{r.name}</span>
                        <span className="mono" style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, color: r.state === 'repaired' ? 'var(--up)' : r.state === 'orphan' ? '#ff8a5c' : '#ff6b8a' }}>{r.state.toUpperCase()}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 11, color: 'var(--dim)' }}>{r.detail}</span>
                      </div>
                    ))}
                    {sthAudit.rows.every((r) => r.state === 'ok') && <p style={dimP}>Everyone live is really copying. Nothing to fix.</p>}
                  </div>
                </>
              )}
            </section>

            {/* PUSH COMPOSER — le canal marketing gratuit : message libre vers un segment, test sur soi d'abord */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
              <h2 style={secH}>📣 PUSH COMPOSER</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {([['self', '🧪 ONLY ME — TEST'], ['prospects', `PROSPECTS · ${rows.filter((r) => ['onboarding', 'pending_copier'].includes(r.status)).length}`], ['live', `LIVE MEMBERS · ${rows.filter((r) => ['live', 'paused'].includes(r.status)).length}`], ['all', `EVERYONE · ${rows.length}`]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setPushAud(k)} style={{
                    padding: '7px 12px', borderRadius: 9, cursor: 'pointer', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8,
                    border: `1px solid ${pushAud === k ? 'rgba(43,227,245,.5)' : 'var(--border)'}`,
                    background: pushAud === k ? 'rgba(43,227,245,.08)' : 'transparent',
                    color: pushAud === k ? 'var(--cyan)' : 'var(--muted)',
                  }}>{label}</button>
                ))}
              </div>
              <input value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} placeholder="title — e.g. 🔥 +1,896$ banked today" maxLength={80} style={inp} />
              <textarea value={pushBody} onChange={(e) => setPushBody(e.target.value)} placeholder="message — e.g. The AI closed 25 winning trades today. Come see the recap live." maxLength={300} rows={3} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="/member or https://…" style={{ ...inp, flex: 1, minWidth: 200 }} />
                <button disabled={busy || !pushTitle.trim() || !pushBody.trim()} onClick={composerSend} style={{ padding: '10px 18px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', opacity: !pushTitle.trim() || !pushBody.trim() ? 0.5 : 1 }}>
                  {pushAud === 'self' ? '🧪 SEND TEST' : '📣 SEND'}
                </button>
              </div>
              {pushResult && <p style={{ ...dimP, color: 'var(--up)' }}>✓ {pushResult}</p>}
              <p style={dimP}>Only members who enabled notifications receive it — always 🧪 test on yourself before blasting a segment.</p>
            </section>

            {/* WIN CARD STUDIO — les stories façon Binance pour la CM : P&L en énorme + QR algoria.tech,
                format 1080×1920 prêt à poster (canal, stories, TikTok) — à déposer dans le Drive */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9, maxWidth: 680 }}>
              <h2 style={secH}>🎨 WIN CARDS — STORY 9:16 · WIDE 16:9</h2>
              {/* les RÉCAPS — le post de fin de session et le bilan hebdo, wins only (règle 70/30) */}
              {([
                ['day', '📅 DAY RECAP', proof?.today] as const,
                ['week', '🗓 WEEK RECAP', proof?.week] as const,
              ]).map(([period, label, s]) => (
                <div key={period} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(245,194,74,.35)', background: 'rgba(245,194,74,.05)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 800 }}>{label}</span>
                  <span className="mono" style={{ fontSize: 11.5, color: s?.count ? 'var(--up)' : 'var(--dim)' }}>
                    {s ? (s.count ? `✓ ${s.count} wins · +$${Math.round(s.total)} · best +$${Math.round(s.best)}` : 'no wins yet') : '…'}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button disabled={!s?.count || carding === `${period}-story`} onClick={() => void downloadRecap(period, 'story')} style={{ ...goldBtn, opacity: s?.count ? 1 : 0.45 }}>{carding === `${period}-story` ? '…' : '⬇ STORY'}</button>
                  <button disabled={!s?.count || carding === `${period}-landscape`} onClick={() => void downloadRecap(period, 'landscape')} style={{ ...goldBtn, opacity: s?.count ? 1 : 0.45 }}>{carding === `${period}-landscape` ? '…' : '⬇ WIDE'}</button>
                </div>
              ))}
              {feedWins.length === 0 && <p style={dimP}>Recent wins appear here as trades close — each downloads as a ready-to-post story card.</p>}
              {feedWins.map((t) => (
                <div key={t.ticket} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: t.direction === 'long' ? 'var(--up)' : 'var(--down)' }}>{t.direction === 'long' ? '▲ LONG' : '▼ SHORT'}</span>
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t.symbol === 'XAUUSD' ? 'GOLD' : 'BTC'}</span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--up)' }}>+${Number(t.pnl).toFixed(0)}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{new Date(t.closed_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span style={{ flex: 1 }} />
                  <button disabled={carding === `${t.ticket}-story`} onClick={() => void downloadCard(t, 'story')} style={goldBtn}>{carding === `${t.ticket}-story` ? '…' : '⬇ STORY'}</button>
                  <button disabled={carding === `${t.ticket}-landscape`} onClick={() => void downloadCard(t, 'landscape')} style={goldBtn}>{carding === `${t.ticket}-landscape` ? '…' : '⬇ WIDE'}</button>
                </div>
              ))}
            </section>

            {/* ===== POST DE CANAL AVEC BOUTON (16/08/2026) =====================================
                Telegram n'autorise un clavier inline QUE via un bot : impossible de poser un bouton à la
                main depuis l'app Telegram. Mathieu devait donc se contenter d'un lien nu dans le texte,
                qui convertit nettement moins bien qu'un bouton.
                On publie sur UN canal — le source — et le fan-out existant s'occupe du reste : le miroir
                UK et le pont italien transportent maintenant le clavier. Publier sur les trois d'ici
                créerait des doublons, puisque le fan-out se déclenche sur le post source. */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
              <h2 style={secH}>📣 POST A CTA TO A CHANNEL — with a real button</h2>
              <p style={dimP}>
                Telegram only lets a <b>bot</b> attach a button, which is why you can&rsquo;t do it by hand. Pick the
                <b> source channel</b> and this posts to <b>all three</b> in one go: source and UK mirror as written,
                IT channel translated — same button everywhere. The button label itself stays in English, as you type it.
              </p>
              {/* MODÈLES — deux familles, parce qu'elles ne servent pas au même moment : « → app » pour
                  ceux qui avanceront seuls, « → toi » pour ceux qui ne bougeront que si un humain leur
                  parle. Un clic pré-remplit tout, et tout reste modifiable ensuite. */}
              {(['app', 'mathieu'] as const).map((fam) => (
                <div key={fam} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span className="mono" style={{ fontSize: 9, letterSpacing: 1.4, color: 'var(--dim)', fontWeight: 800 }}>
                    {fam === 'app' ? '→ VERS L’APP · ils avancent seuls' : '→ VERS TOI · ils ont besoin de te parler'}
                  </span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {CTA_TEMPLATES.filter((t) => t.target === fam).map((t) => (
                      <button key={t.id} onClick={() => { setCpText(t.text.replace(/\\n/g, '\n')); setCpBtn(t.btn); setCpUrl(t.url); setCpReport(null); }}
                        style={{ padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                          border: `1px solid ${cpBtn === t.btn ? 'rgba(43,227,245,.55)' : 'var(--border)'}`,
                          background: cpBtn === t.btn ? 'rgba(43,227,245,.08)' : 'transparent',
                          color: cpBtn === t.btn ? 'var(--cyan)' : 'var(--muted)' }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <select value={cpChat} onChange={(e) => setCpChat(e.target.value)} style={{ ...inp, maxWidth: 380 }}>
                <option value="">Choose the channel…</option>
                {tgChats.map((c) => (
                  <option key={c.chat_id} value={String(c.chat_id)}>{c.title ?? c.chat_id}{c.role ? ` · ${c.role}` : ''}</option>
                ))}
              </select>
              <textarea
                value={cpText} onChange={(e) => setCpText(e.target.value)} rows={5}
                placeholder={'Your message. HTML allowed: <b>bold</b>, <i>italic</i>, <a href="...">link</a>'}
                style={{ ...inp, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={cpBtn} onChange={(e) => setCpBtn(e.target.value)} placeholder="Button label" style={{ ...inp, flex: '1 1 170px' }} />
                <input value={cpUrl} onChange={(e) => setCpUrl(e.target.value)} placeholder="https://…" style={{ ...inp, flex: '2 1 240px' }} />
              </div>
              {/* APERÇU : ce qui part est définitif et public — on le montre avant, pas après. */}
              {cpText.trim() && (
                <div style={{ border: '1px solid rgba(43,227,245,.3)', background: 'rgba(43,227,245,.05)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{cpText}</div>
                  {cpBtn.trim() && (
                    <div style={{ textAlign: 'center', padding: '9px 12px', borderRadius: 9, background: 'rgba(43,227,245,.14)', border: '1px solid rgba(43,227,245,.4)', color: 'var(--cyan)', fontWeight: 700, fontSize: 12.5 }}>{cpBtn}</div>
                  )}
                </div>
              )}
              <button disabled={busy || !cpText.trim() || !cpChat} onClick={sendChannelPost}
                style={{ padding: '12px 18px', borderRadius: 11, border: 'none', cursor: cpText.trim() && cpChat ? 'pointer' : 'default', fontWeight: 800, fontSize: 13, letterSpacing: 0.5,
                  color: '#04223a', background: cpText.trim() && cpChat ? 'linear-gradient(90deg,#2be3f5,#39a0ff)' : 'rgba(130,152,190,.25)' }}>
                {busy ? 'POSTING…' : '📣 POST TO CHANNEL'}
              </button>
              {cpReport && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {cpReport.map((r) => (
                    <p key={r.channel} style={{ margin: 0, fontSize: 12, color: r.ok ? 'var(--up)' : 'rgba(210,150,165,.9)' }}>
                      {r.ok ? '✓' : '✗'} {r.channel}{r.error ? ` — ${r.error}` : ''}
                    </p>
                  ))}
                </div>
              )}
            </section>

            {/* RELANCE — les leads coincés dans le funnel, du plus ancien au plus récent : ta liste de closing */}
            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 9, maxWidth: 680 }}>
              <h2 style={secH}>🎯 FOLLOW-UP — STUCK IN THE FUNNEL {leads.length > 0 && `· ${leads.length}`}</h2>
              {leads.length === 0 && <p style={dimP}>Nobody stuck — every signup either finished the wizard or is waiting in the QUEUE.</p>}
              {leads.map((r) => (
                <div key={r.member_no} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)', flexWrap: 'wrap' }}>
                  <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12, minWidth: 34 }}>#{r.member_no}</span>
                  <span style={{ fontSize: 12, color: 'var(--text)', minWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '—')}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1, minWidth: 150 }}>{STEP_LABEL[r.onboarding_step] ?? STEP_LABEL[0]}</span>
                  <span className="mono" style={{ fontSize: 10, color: daysStuck(r) >= 3 ? 'var(--gold)' : 'var(--dim)', whiteSpace: 'nowrap' }}>{daysStuck(r) === 0 ? 'today' : `${daysStuck(r)}d stuck`}</span>
                  {r.tg_username && <a href={`https://t.me/${r.tg_username}`} target="_blank" rel="noreferrer" style={{ ...miniBtn, textDecoration: 'none', color: 'var(--cyan)', borderColor: 'rgba(43,227,245,.4)' }}>💬 DM</a>}
                  <button disabled={busy} onClick={() => nudge(r)} title="push: 'Need a hand finishing your setup?' → opens the wizard" style={goldBtn}>🔔 NUDGE</button>
                </div>
              ))}
              {pushResult && leads.length > 0 && <p style={{ ...dimP, color: 'var(--up)' }}>✓ {pushResult}</p>}
            </section>

            <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 11, maxWidth: 680 }}>
            <h2 style={secH}>👑 VIP / TEAM ACCESS</h2>
            {/* whitelist RESSUSCITÉE : un @ ici voit l'app COMPLÈTE (zéro mode teaser) sans connexion
                copieur — CM (screens vue utilisateur), partenaires, invités. Ne touche pas au statut. */}
            <p style={dimP}>Handles here see the FULL app (no teaser mode) without connecting a broker account — for your CM, partners and trusted guests. Members still unlock automatically when they go LIVE.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="@username" style={{ ...inp, flex: 1 }} />
              <button disabled={busy || !input.trim()} onClick={() => post({ add: input }, () => setInput(''))} style={{ padding: '10px 16px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)' }}>ADD</button>
            </div>
            {wl.map((w) => (
              <div key={w.username} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <span style={{ color: 'var(--text)' }}>@{w.username}</span>
                <span style={{ fontSize: 10, color: 'var(--dim)' }}>by {w.added_by ?? '—'}</span>
                <span style={{ flex: 1 }} />
                <button disabled={busy} onClick={() => post({ remove: w.username })} style={dangerBtn}>remove</button>
              </div>
            ))}
            {wl.length === 0 && <p style={dimP}>Empty — add your CM&rsquo;s @ to give her the full member view.</p>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

// ===== briques UI du CRM =====
function Kpi({ label, value, accent, hot, sub }: { label: string; value: string; accent: string; hot?: boolean; sub?: string }) {
  return (
    <div className="panel" style={{ padding: '13px 15px', borderTop: `2px solid ${accent}`, boxShadow: hot ? `0 0 18px ${accent}22` : undefined }}>
      <div style={{ fontSize: 9.5, letterSpacing: 1.3, color: 'var(--dim)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 23, fontWeight: 800, marginTop: 3, color: hot ? accent : 'var(--text)' }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 9.5, marginTop: 2, color: 'var(--gold)' }}>{sub}</div>}
    </div>
  );
}
function StatusChip({ status }: { status: string }) {
  const c = status === 'live' ? 'var(--up)' : status === 'paused' ? 'var(--gold)' : status === 'pending_copier' ? 'var(--cyan)' : 'var(--muted)';
  return <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, color: c, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{status.toUpperCase()}</span>;
}
function RowLine({ icon, text, sub, onClick, gold }: { icon: string; text: string; sub?: string; onClick: () => void; gold?: boolean }) {
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
function Center({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: '90vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>{children}</main>;
}

// PORTE DE CONNEXION ADMIN — remplace l'ancien cul-de-sac « admin only ». Même login Telegram natif que
// l'espace membre (code à usage unique + deep-link, pollé). `forbidden` = une session NON-admin traîne sur
// ce poste → on la purge (logout) avant de relancer, pour repartir propre. L'accès reste gardé côté API :
// tout compte hors ADMIN_TG_USERNAMES se reconnecte puis se refait refuser — il ne voit jamais le CRM.
function AdminGate({ forbidden, deniedAs }: { forbidden: boolean; deniedAs?: string | null }) {
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
const secH: CSSProperties = { fontSize: 12, margin: 0, letterSpacing: 1.4, color: 'var(--muted)' };
const warnBox: CSSProperties = { border: '1px solid rgba(255,107,138,.45)', background: 'rgba(255,107,138,.08)', borderRadius: 10, padding: '10px 13px', fontSize: 12, color: 'rgba(210,150,165,.95)' };
const dimP: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dim)' };
const td: CSSProperties = { padding: '8px 10px', verticalAlign: 'top' };
const inp: CSSProperties = { padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 13, outline: 'none' };
const okBtn: CSSProperties = { border: '1px solid rgba(31,216,176,.45)', background: 'rgba(31,216,176,.1)', color: 'var(--up)', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' };
const goldBtn: CSSProperties = { border: '1px solid rgba(245,194,74,.45)', background: 'rgba(245,194,74,.08)', color: 'var(--gold)', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' };
const dangerBtn: CSSProperties = { border: '1px solid rgba(255,107,138,.4)', background: 'transparent', color: 'rgba(210,150,165,.85)', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
const miniBtn: CSSProperties = { border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', borderRadius: 6, padding: '1px 8px', fontSize: 10, cursor: 'pointer' };
