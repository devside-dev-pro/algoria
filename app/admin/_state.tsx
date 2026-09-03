'use client';
// ÉTAT + HANDLERS DE L’ADMIN (03/09/2026) — extraits tels quels de app/admin/page.tsx quand la page a été
// découpée en un fichier par onglet. Un seul hook tient tout (états, chargement, actions API) ; les onglets
// le lisent par contexte (useAdmin). Rien n’a changé de comportement : c’est un déplacement, pas une réécriture.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { drawWinCard, drawRecapCard, shareOrDownloadCard } from '@/lib/cards/winCard';
import { BROKERS } from '@/lib/member/brokers';
import { REJECT_REASONS } from '@/lib/member/rejectReasons';
import { LOT_CHOICES, LOT_MAX } from '@/lib/member/lots';
import { estimateCommission, rankBrokersByCommission } from '@/lib/member/commissions';
import { ACTIVATION_LOTS, lotsStateOf } from '@/lib/member/activation';
import { ask, toast, type FormField } from '@/components/admin/Dialog';
import { WL, Row, Action, Affiliate, Deposit, Tab, Center, AdminGate } from './_shared';

export function useAdminState() {
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
  const [pendingTotal, setPendingTotal] = useState<number | null>(null); // vrai nombre de cartes en attente (la liste est plafonnée à 500)
  const [nudges, setNudges] = useState<{ tg_id: number; created_at: string; done_by?: string }[]>([]); // historique des relances (auto + manuelles)
  // SEGMENTATION de la file du jour : qui a déjà écrit au bot, qui s'est fait refuser une connexion.
  const [spokeTgIds, setSpokeTgIds] = useState<number[]>([]);
  const [rejectedTgIds, setRejectedTgIds] = useState<number[]>([]);
  // gens que le bot ne peut PLUS joindre (blocage, compte supprimé, jamais tapé START) — calculé côté
  // serveur, chronologie comprise : une preuve de contact postérieure au refus les fait ressortir d'ici
  const [botBlocked, setBotBlocked] = useState<number[]>([]);
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
  const [bcText, setBcText] = useState('');
  const [bcTag, setBcTag] = useState('');
  const [bcAudience, setBcAudience] = useState<'pending' | 'live'>('live');
  const [bcReport, setBcReport] = useState<{ sent: number; skipped: number; failed: number; report: Array<{ member_no: number | null; ok: boolean; error?: string; skipped?: boolean }> } | null>(null);
  const sendBroadcast = async () => {
    if (!bcText.trim() || !bcTag.trim()) return;
    const who = bcAudience === 'pending' ? 'the members whose account is in the QUEUE (pending)' : 'ALL live + paused members';
    if (!await ask.confirm(`Send this message through the bot to ${who}?\n\nAnyone who already received the tag "${bcTag}" is skipped automatically.`)) return;
    setBusy(true);
    setBcReport(null);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botBroadcast: { audience: bcAudience, text: bcText, tag: bcTag, cta: true } }) })
      .then(async (r) => {
        const d = (await r.json()) as { error?: string; sent?: number; skipped?: number; failed?: number; report?: Array<{ member_no: number | null; ok: boolean; error?: string; skipped?: boolean }> };
        if (d.error) return void ask.alert(`⚠ ${d.error}`);
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
  const [botActivity, setBotActivity] = useState<Array<{ id: string; tg_id: number; member_no: number | null; kind: string; detail: Record<string, unknown> | null; created_at: string; status?: string | null }>>([]);
  const [tgInboxOn, setTgInboxOn] = useState(false); // état réel du webhook Telegram (getWebhookInfo)
  // (tg_id|broker) → numéro de compte, tiré de l'historique des connexions validées. Sert l'export des
  // dépôts : la fiche membre ne garde que le DERNIER compte, l'historique garde celui de chaque broker.
  const [brokerLogins, setBrokerLogins] = useState<Record<string, string>>({});
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
      const d = (await r.json()) as { pendingTotal?: number; whitelist: WL[]; members: Row[]; actions: Action[]; affiliate?: Affiliate; deposits?: Deposit[]; pushTgIds?: number[]; nudges?: { tg_id: number; created_at: string; done_by?: string }[]; spokeTgIds?: number[]; rejectedTgIds?: number[]; botBlocked?: number[] };
      setWl(d.whitelist);
      setRows(d.members);
      setActions(d.actions ?? []);
      setPendingTotal(typeof d.pendingTotal === 'number' ? d.pendingTotal : null);
      setAff(d.affiliate ?? null);
      setDeposits(d.deposits ?? []);
      setPushTgIds(d.pushTgIds ?? []);
      setNudges(d.nudges ?? []);
      setBrokerLogins((d as unknown as { brokerLogins?: Record<string, string> }).brokerLogins ?? {});
      setSpokeTgIds(d.spokeTgIds ?? []);
      setRejectedTgIds(d.rejectedTgIds ?? []);
      setBotBlocked(d.botBlocked ?? []);
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
      .then(async (r) => { const d = (await r.json()) as { error?: string }; if (d.error) toast(`⚠ ${d.error}`, 'error'); else toast('✓ saved'); cb?.(); load(); })
      .finally(() => setBusy(false));
  };
  const reveal = (id: string) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reveal: id }) })
      .then(async (r) => { const d = (await r.json()) as { login?: string; server?: string; password?: string }; if (d.password) setCreds((c) => ({ ...c, [id]: { login: d.login ?? '', server: d.server ?? '', password: d.password! } })); })
      .finally(() => setBusy(false));
  };
  const cancelCommission = async (id: string) => { const reason = await ask.prompt('Cancel reason (e.g. "client withdrew deposit"):', '', { multiline: true, danger: true, ok: 'CANCEL COMMISSION' }); if (reason !== null) post({ cancelCommission: id, reason }); };
  const payPayout = async (id: string) => { const tx = await ask.prompt('USDT sent? Paste the TRC20 transaction hash:', '', { placeholder: 'transaction hash', ok: 'MARK PAID' }); if (tx?.trim()) post({ payoutPaid: id, tx: tx.trim() }); };
  const rejectPayout = async (id: string) => { const reason = await ask.prompt('Reject reason (shown to the member):', '', { multiline: true, danger: true, ok: 'REJECT' }); if (reason !== null) post({ payoutReject: id, reason }); };
  // refuser une CONNEXION (vérification broker échouée) : le membre repasse en onboarding avec la raison — jamais bloqué
  // VALIDATION DU VOLUME D'ACTIVATION. Deux issues, jamais une seule : soit le volume est là (on saisit
  // combien on a vu), soit on force AVEC un motif écrit. Le forçage reste possible — il faut pouvoir
  // débloquer un membre un dimanche — mais il coûte une phrase, et il s'affiche ensuite « ⚠ LOTS FORCÉS »
  // sur la carte. Une exception silencieuse redevient la règle en une semaine ; une exception visible non.
  const validateLots = async (a: Action) => {
    const seen = await ask.prompt(`Volume tradé constaté sur le dashboard partenaire (attendu : ${ACTIVATION_LOTS} lot).\n\nSaisis le nombre de lots — ou laisse VIDE pour forcer le déblocage avec un motif :`, String(ACTIVATION_LOTS), { type: 'number', ok: 'VALIDATE' });
    if (seen === null) return;
    if (!seen.trim()) {
      const reason = await ask.prompt('Forçage — motif obligatoire (il restera affiché sur la carte et au bilan) :', '', { multiline: true, danger: true, ok: 'FORCE' });
      if (reason === null || !reason.trim()) return;
      post({ lotsOk: a.id, reason });
      return;
    }
    const n = Number(seen.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) { void ask.alert('Volume invalide.'); return; }
    if (n < ACTIVATION_LOTS && !await ask.confirm(`${n} lot < ${ACTIVATION_LOTS} lot attendu.\n\nValider quand même ? La commission risque d'être refusée par le broker.`)) return;
    post({ lotsOk: a.id, lots: n });
  };
  // MOTIFS FERMÉS (03/09) : un numéro suffit, le membre reçoit le texte propre dans sa langue avec la
  // correction attendue (lib/member/rejectReasons.ts). Un texte libre reste possible (« other »).
  const rejectConnect = async (id: string) => {
    const code = await ask.prompt('Motif du refus (le membre reçoit le message correspondant) :', '', { options: REJECT_REASONS.map((r) => ({ value: r.code, label: r.admin })), danger: true });
    if (!code) return;
    if (code !== 'other') { post({ rejectConnect: id, code }); return; }
    const free = await ask.prompt('Texte libre (montré au membre) :', '', { multiline: true, ok: 'REJECT', danger: true });
    if (free !== null && free.trim()) post({ rejectConnect: id, code: 'other', reason: free.trim() });
  };
  // EN ATTENTE DU BROKER — le cas « compte préexistant non rattaché à notre numéro d'affilié » : il
  // n'apparaît pas dans le dashboard partenaire, et seul le titulaire peut demander le rattachement au
  // support du broker. Le délai est chez le broker, pas chez nous. Marquer l'attente évite que la carte se
  // lise comme oubliée — et que la surveillance alerte sur un dossier déjà traité. Deuxième clic = attente
  // levée. Rien n'est envoyé au membre : ce marquage est une note interne, pas une décision.
  const waitBroker = async (a: Action) => {
    const waiting = a.detail?.waiting_broker != null;
    if (waiting) { if (await ask.confirm('Broker replied — clear the “waiting on broker” flag?')) post({ waitBroker: a.id }); return; }
    const note = await ask.prompt('⏳ Waiting on the broker to attach this account to your affiliate ID.\n\nOptional note (e.g. "support ticket opened 17/08, member contacted them"):', '');
    if (note !== null) post({ waitBroker: a.id, reason: note });
  };
  const liveAlert = async () => { if (await ask.confirm('Send "🔴 ALGORIA IS LIVE" to every subscribed member?')) post({ liveAlert: true }); };
  // révéler les identifiants d'un membre À TOUT MOMENT (déchiffrés côté serveur, tracés en timeline)
  const showCreds = (tgId: number) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revealMember: tgId }) })
      .then(async (r) => { const d = (await r.json()) as { login?: string; server?: string; password?: string; error?: string }; if (d.error) void ask.alert(d.error); else if (d.password) setSelCreds({ login: d.login ?? '', server: d.server ?? '', password: d.password }); })
      .finally(() => setBusy(false));
  };
  // ENREGISTREMENT DU DÉPÔT dans la foulée de la connexion (demande Mathieu 28/07 : « à 5 dépôts/jour
  // je me perds entre valider, connecter, vérifier ») : un seul prompt, pré-rempli avec le montant
  // DÉCLARÉ — corriger si CellXpert dit autre chose. La com attendue vient du barème (estimateCommission).
  // Annuler = pas de ligne (le filet « LIVE sans dépôt » du registre DEPOSITS la rattrapera).
  const recordDepositAfterConnect = async (a: Action) => {
    const m = rows.find((r) => Number(r.tg_id) === Number(a.tg_id));
    const broker = String(a.detail?.broker ?? m?.broker ?? '').trim().toLowerCase() || null;
    const declared = Number(a.detail?.declared_deposit ?? 0) || null;
    const v = await ask.prompt(
      `🏦 Log the deposit now? Validated amount ($)\n\nBroker: ${broker ? broker.toUpperCase() : '?'} — expected com auto from the schedule.\nCancel = no line (it will show up in DEPOSITS → "live, no deposit logged").`,
      declared ? String(declared) : '',
      { type: 'number', ok: 'LOG DEPOSIT' },
    );
    if (v === null) return;
    const amount = Number(v);
    if (!Number.isFinite(amount) || amount <= 0) return void ask.alert('Invalid amount — no deposit logged. Add it in DEPOSITS.');
    // garde anti-doublon : même membre, même montant, même jour → la ligne existe déjà (double clic, DONE après CONNECT…)
    const today = new Date().toISOString().slice(0, 10);
    const dup = deposits.some((d) => Number(d.tg_id) === Number(a.tg_id) && Number(d.detail?.amount_usd ?? 0) === amount && String(d.detail?.deposited_at ?? d.created_at).slice(0, 10) === today);
    if (dup) return void ask.alert('Already logged today for this member (same amount) — nothing added.');
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
      const c = await ask.prompt(
        `🌍 Country of this member?\n\n${guess ? `Detected at signup: ${guess} — press OK to accept.` : 'Not detected (VPN, or member created before geo capture) — type it.'}\n\nAd geos: South Africa · New Zealand · Australia · UK · UAE\nLeave empty to skip (the deposit is logged either way).`,
        guess ?? '',
        { placeholder: 'country', ok: 'SAVE' },
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
  // ⚡ GO LIVE EN UN TAP (03/09/2026) — une seule fiche (lot constaté, montant, pays) et le serveur
  // enchaîne lots → connect STH → live → dépôt → pays (voir `goLive` dans l'API). Les anciens boutons
  // restent pour reprendre un dossier là où il a cassé.
  const goLive = async (a: Action) => {
    const m = rows.find((r) => Number(r.tg_id) === Number(a.tg_id));
    const L = lotsStateOf(a.detail as Record<string, unknown>);
    const cleared = L.ok || L.override != null;
    const declared = Number(a.detail?.declared_deposit ?? 0) || null;
    const broker = String(a.detail?.broker ?? m?.broker ?? '').trim().toLowerCase() || null;
    const guess = m?.country ? null : geoCountryOf(m?.source);
    const who = nameOf(a.tg_id);
    const fields: FormField[] = [];
    if (!cleared) {
      fields.push({ key: 'lots', label: 'Activation volume seen on the partner dashboard (lots)', value: String(ACTIVATION_LOTS), type: 'number', optional: true, hint: `Expected ${ACTIVATION_LOTS} lot. Not there? Empty this field and write a reason below to force.` });
      fields.push({ key: 'force', label: 'Force without volume — reason', optional: true, placeholder: 'only if the volume is not there', hint: 'Stays on the card and in the month report.' });
    }
    fields.push({ key: 'amount', label: 'Validated deposit ($)', value: declared ? String(declared) : '', type: 'number', optional: true, hint: `Broker ${broker ? broker.toUpperCase() : '?'} — commission from the schedule. Empty = log it later in DEPOSITS.` });
    if (!m?.country) fields.push({ key: 'country', label: 'Country', value: guess ?? '', optional: true, placeholder: 'country', hint: guess ? 'Detected at signup.' : 'Not detected — type it, or leave empty.' });
    const v = await ask.form(`⚡ Go live — ${who}\nValidates the activation lot, connects the copier via STH, switches the member LIVE and logs the deposit. One tap, stops at the first failing step.`, fields, { ok: 'GO LIVE' });
    if (!v) return;
    const lots = Number(String(v.lots ?? '').replace(',', '.'));
    const force = String(v.force ?? '').trim();
    if (!cleared && !force && !(Number.isFinite(lots) && lots > 0)) { toast('Enter the volume seen, or a reason to force.', 'error'); return; }
    if (!cleared && !force && lots < ACTIVATION_LOTS && !(await ask.confirm(`${lots} lot < ${ACTIVATION_LOTS} lot expected.\nValidate anyway? The broker may refuse the commission.`))) return;
    let amount = Number(String(v.amount ?? '').replace(',', '.'));
    if (!(Number.isFinite(amount) && amount > 0)) amount = 0;
    if (amount > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const dup = deposits.some((d) => Number(d.tg_id) === Number(a.tg_id) && Number(d.detail?.amount_usd ?? 0) === amount && String(d.detail?.deposited_at ?? d.created_at).slice(0, 10) === today);
      if (dup) { toast('Deposit already logged today for this member — not logged twice.', 'info'); amount = 0; }
    }
    const rawCountry = String(v.country ?? '').trim();
    const country = rawCountry ? (COUNTRIES.find((x) => x.toLowerCase() === rawCountry.toLowerCase()) ?? rawCountry) : '';
    setBusy(true);
    try {
      const r = await fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goLive: { id: a.id, ...(cleared ? {} : force ? { force } : { lots }), ...(amount > 0 ? { amount } : {}), ...(country ? { country } : {}) } }) });
      const d = (await r.json()) as { ok?: boolean; error?: string; steps?: Array<{ step: string; ok: boolean; error?: string }> };
      const done = (d.steps ?? []).filter((x) => x.ok).map((x) => x.step);
      if (d.error) toast(`⚠ ${d.error}${done.length ? `\nDone so far: ${done.join(' → ')} — the card stays in the queue for the rest.` : ''}`, 'error');
      else toast(`⚡ ${who} is LIVE · ${done.join(' → ')}`);
      setCreds((c) => { const n = { ...c }; delete n[a.id]; return n; });
      load();
    } catch (e) {
      toast(`⚠ ${(e as { message?: string })?.message ?? 'network error'}`, 'error');
    } finally { setBusy(false); }
  };
  // connexion AUTO via STH : branche le compte dans le copieur, puis enchaîne `done` (passage LIVE) si OK,
  // puis propose d'enregistrer le dépôt (un prompt) — les 3 gestes en un seul clic.
  const connectViaSth = async (a: Action) => {
    if (!await ask.confirm('Connect this account to the copier via STH now?\n\nVerify the deposit first — on success the member goes LIVE.')) return;
    const id = a.id;
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectSth: id }) })
      .then(async (r) => { const d = (await r.json()) as { ok?: boolean; error?: string }; setBusy(false); if (d.error) return void ask.alert(d.error); post({ done: id }, () => { setCreds((c) => { const n = { ...c }; delete n[id]; return n; }); recordDepositAfterConnect(a); }); })
      .catch(() => setBusy(false));
  };
  // RE-connexion STH depuis la fiche membre (ex. déconnecté par erreur sur le dashboard STH) : identifiants
  // déjà en base — rien à ressaisir, ne touche pas au statut du membre.
  const reconnectSth = async (r: Row) => {
    const who = r.tg_username ? '@' + r.tg_username : (r.tg_name ?? `#${r.member_no}`);
    if (!await ask.confirm(`Re-connect ${who} to the STH copier?\n\nUses the credentials on file — nothing to retype. Their account re-joins their strategy's master.`)) return;
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reconnectSth: r.tg_id }) })
      .then(async (res) => { const d = (await res.json()) as { ok?: boolean; error?: string }; if (d.error) toast(`⚠ ${d.error}`, 'error'); else toast('✓ re-connected to the copier'); })
      .finally(() => setBusy(false));
  };
  // vérité STH (diagnostic) : compte MT connecté au copieur ? masters visibles + abonnements — direct depuis leur API
  const sthCheck = (tgId: number) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sthStatusCheck: tgId }) })
      .then(async (r) => {
        const d = (await r.json()) as { connected?: boolean; masters?: Array<Record<string, unknown>>; error?: string };
        if (d.error) return void ask.alert(d.error);
        // « géré par l'API » = liste de masters non vide ; le flag connected (bridge MT instantané) peut traîner
        const known = (d.masters ?? []).length > 0;
        const subs = (d.masters ?? []).filter((m) => m.userIsSubscribed === true).map((m) => String(m.name ?? m.id));
        void ask.alert(`STH status (live from their API)\n\nAPI-managed: ${known ? '✅ YES' : '❌ NO (manually-added receiver or never connected)'}\nSubscribed to: ${subs.join(', ') || '(none)'}\nMT bridge flag: ${d.connected ? 'up' : 'down (STH reports this on everyone — NOT a fault signal, ignore it)'}\n\nMasters:\n${(d.masters ?? []).map((m) => `• ${String(m.name ?? m.id ?? '?')} · ${m.userIsSubscribed === true ? 'subscribed' : 'not subscribed'}${m.id != null && m.name != null ? ` · id ${String(m.id)}` : ''}`).join('\n') || '(none visible)'}`);
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
  const setCountry = async (tgId: number, value: string) => {
    const country = value === '__other' ? (await ask.prompt('Country?') ?? '').trim() : value;
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
  const moveViaSth = async (id: string) => {
    if (!await ask.confirm("Move this member to their NEW strategy's master via STH now?\n\nWorks for API-connected members. Manually-added receivers must be moved in the STH dashboard (the card shows their STH id).")) return;
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moveSth: id }) })
      .then(async (r) => { const d = (await r.json()) as { ok?: boolean; error?: string }; setBusy(false); if (d.error) return void ask.alert(d.error); post({ done: id }); })
      .catch(() => setBusy(false));
  };
  // off-board : le client est parti → paused + déconnexion copieur + note (le kick du canal Telegram reste manuel)
  // OFF-BOARD + RÉCUPÉRATION. Le motif choisi ici décide du TEXTE envoyé au membre (jamais de l'effet
  // technique : l'accès tombe pareil dans tous les cas). Le message part avec un bouton vers son écran de
  // récupération — c'est tout l'intérêt : sur 15 off-boards passés, un seul membre est revenu, et de sa
  // propre initiative. On peut couper l'envoi, mais c'est un choix explicite, pas le défaut.
  const OFFBOARD_MENU: Array<{ key: string; label: string }> = [
    { key: 'withdrawal', label: '1 — capital retiré du compte' },
    { key: 'inactive', label: '2 — compte inactif / vide' },
    { key: 'broker_detached', label: '3 — compte non rattaché au broker' },
    { key: 'other', label: '4 — autre motif' },
  ];
  const offboard = async (r: Row) => {
    const who = r.tg_username ? '@' + r.tg_username : (r.tg_name ?? `#${r.member_no}`);
    const pick = await ask.prompt(`Off-board ${who} — motif (il choisit le message envoyé au membre) :`, '', { options: [...OFFBOARD_MENU.map((m) => ({ value: m.key, label: m.label })), { value: '__silent', label: '0 — off-boarder SANS prévenir le membre' }], danger: true });
    if (pick === null) return;
    const notify = pick !== '__silent';
    const reason = notify ? pick : 'withdrawal';
    if (!(await ask.confirm(`Off-board ${who}?\n\n• status → offboarded (il ne peut PAS se rebrancher seul)\n• copier disconnect via STH\n• ${notify ? `message envoyé au membre (${reason}) avec son lien de récupération` : 'AUCUN message au membre'}\n• DON'T FORGET to remove them from the VIP Telegram channel (manual)`, { danger: true, ok: 'OFF-BOARD' }))) return;
    post({ offboard: r.tg_id, reason, notify }, () => setSel((s) => (s ? { ...s, status: 'offboarded' } : s)));
  };

  // 🚫 BAN / UNBAN — révoque l'accès app d'un compte (concurrent qui copie, abus). Confirmation obligatoire :
  // c'est visible côté client (il tombe sur « accès refusé »), donc jamais sur un clic accidentel.
  const banMember = async (r: Row, undo: boolean) => {
    const who = r.tg_username ? '@' + r.tg_username : (r.tg_name ?? `#${r.member_no}`);
    if (undo) {
      if (!await ask.confirm(`Lift the ban on ${who}?\n\nThey'll be able to sign in again. The copier is NOT reconnected automatically.`)) return;
      post({ ban: { tg_id: r.tg_id, undo: true } }, () => setSel((s) => (s ? { ...s, banned_at: null } : s)));
      return;
    }
    const reason = await ask.prompt(`🚫 BAN ${who}?\n\n• kills their current session AND blocks any new sign-in\n• disconnects the copier\n• removes them from the VIP whitelist\n\nReason (kept in their timeline):`, 'competitor / scraping the app', { danger: true, ok: 'BAN' });
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
  const editLegalName = async (tg: number | null | undefined, current: string | null) => {
    if (tg == null) return;
    const v = await ask.prompt('Name on the broker account (as written at the broker — this is what links his deposit to him):', current ?? '');
    if (v === null) return;
    if (v.trim().length < 2) { void ask.alert('Enter the real full name.'); return; }
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
        if (d.error) void ask.alert(d.error);
        else if (d.sync?.includes('FAILED')) void ask.alert(`Saved, BUT the copier was not re-synced:\n${d.sync}\n\nUse 🔗 RECONNECT STH.`);
        load();
      })
      .finally(() => setBusy(false));
  };
  // saisie libre (texte) — pointillés + « ✎ » : on voit du premier coup d'œil ce qui est rattrapable
  const editText = (tg: number, field: string, label: string, current: string | null, shown?: string, hint?: string) => (
    <button
      disabled={busy}
      onClick={async () => { const v = await ask.prompt(hint ? `${label}\n\n${hint}` : label, current ?? ''); if (v !== null) editMember(tg, field, v.trim()); }}
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
      onChange={async (e) => { const v = e.target.value; if (v === current) return; if (confirmMsg && !await ask.confirm(confirmMsg(v))) return; editMember(tg, field, v); }}
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
        onChange={async (e) => {
          const v = e.target.value;
          if (v === '__free') { const t = await ask.prompt('MT server — EXACT string as shown at the broker (a single wrong character stops the copier):', cur); if (t !== null) editMember(r.tg_id, 'mt5_server', t); return; }
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
        onChange={async (e) => {
          const v = e.target.value;
          if (v === '__free') { const t = await ask.prompt(`Copy size in lots (0.01 to ${LOT_MAX.toFixed(2)}, steps of 0.01) — re-synced to STH immediately:`, cur, { type: 'number' }); if (t !== null && t.trim()) editMember(r.tg_id, 'lot', t.trim().replace(',', '.')); return; }
          if (await ask.confirm(`Set the copy size to ${v} lot?\n\nIf they are connected, the copier is re-synced right away.`)) editMember(r.tg_id, 'lot', v);
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
  const editPassword = async (r: Row) => {
    const v = await ask.prompt(`New MT password for ${r.mt5_login ?? 'this account'}\n\nThe TRADER password, not the investor one. It is re-encrypted immediately — after saving, hit 🔗 RECONNECT STH so the copier picks it up.`, '', { type: 'password', ok: 'REPLACE' });
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
        if (d.error) return void ask.alert(d.error);
        const n = d.audience ?? 0;
        if (!n) return void ask.alert('No prospect to reach right now (everyone already got it in the last 12h, or every member has deposited).');
        if (!await ask.confirm(`Send this campaign to ${n} prospect(s) with no deposit?\n\n${d.alreadySent ? `${d.alreadySent} person(s) already received it in the last 12h and are skipped.\n\n` : ''}Depositors are never included. This cannot be undone.`)) return;
        setBusy(true);
        void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerBlast: { text: blastText, title: blastTitle || undefined, pushBody: blastBody || undefined, url: '/member/onboarding' } }) })
          .then(async (r2) => {
            const d2 = (await r2.json()) as { audience?: number; dmOk?: number; pushOk?: number; error?: string };
            if (d2.error) void ask.alert(d2.error);
            else void ask.alert(`✓ Campaign sent\n\n${d2.dmOk ?? 0} Telegram DM delivered\n${d2.pushOk ?? 0} push notification(s)\nout of ${d2.audience ?? 0} prospect(s)`);
            load();
          })
          .finally(() => setBusy(false));
      })
      .catch(() => setBusy(false));
  };
  const editDepositCom = async (d: Deposit) => {
    const v = await ask.prompt('Expected commission ($):', String(d.detail?.commission_usd ?? 0), { type: 'number' });
    if (v !== null && Number.isFinite(Number(v))) post({ updateDeposit: { id: d.id, commission: Number(v) } });
  };
  // montant du dépôt éditable (29/07 — Jamie a déposé en 2 fois 265+250 : la com se corrigeait mais pas le
  // montant → bilan incohérent). L'API updateDeposit acceptait déjà amount, il manquait juste le crayon.
  const editDepositAmount = async (d: Deposit) => {
    const v = await ask.prompt('Deposit amount ($) — cumule les dépôts multiples du même compte :', String(d.detail?.amount_usd ?? 0), { type: 'number' });
    if (v !== null && Number.isFinite(Number(v)) && Number(v) > 0) post({ updateDeposit: { id: d.id, amount: Number(v) } });
  };
  const deleteDeposit = async (d: Deposit) => {
    if (await ask.confirm(`Delete this deposit line ($${Number(d.detail?.amount_usd ?? 0)} · #${d.member_no ?? '—'})? This can't be undone.`)) post({ deleteDeposit: d.id });
  };

  // ===== PUSH COMPOSER + relance des leads (TOOLS) =====
  const sendCustomPush = (payload: { audience: string; tg_id?: number; title: string; body: string; url?: string }, label: string) => {
    setBusy(true);
    setPushResult(null);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customPush: payload }) })
      .then(async (r) => {
        const d = (await r.json()) as { sent?: number; error?: string };
        if (d.error) { void ask.alert(d.error); return; }
        const n = d.sent ?? 0;
        setPushResult(`${label} → delivered to ${n} device${n === 1 ? '' : 's'}${n === 0 ? ' (no push-enabled devices — DM on Telegram instead)' : ''}`);
      })
      .finally(() => setBusy(false));
  };
  const composerSend = async () => {
    if (pushAud !== 'self' && !await ask.confirm(`Send this push to ${pushAud.toUpperCase()}? Test it on yourself first if you haven't.`)) return;
    sendCustomPush({ audience: pushAud, title: pushTitle, body: pushBody, url: pushUrl }, pushAud.toUpperCase());
  };
  // ENVOI PAR LE BOT — indispensable depuis la file du jour : 109 des 219 personnes n'ont pas de @pseudo,
  // donc AUCUN lien t.me ne mène à elles. Le bot, lui, peut toujours écrire : tout le monde ici a tapé
  // START pour se connecter à l'app. On confirme avant d'envoyer (c'est un message réel à un vrai
  // prospect, pas un brouillon) et on marque la personne comme touchée dans la foulée.
  // cta: true → le message part avec ses trois boutons (app / canal / Mathieu). C'est une RELANCE :
  // sans eux la personne n'a aucun moyen d'agir, et répondre au bot ne mène nulle part. La réponse
  // conversationnelle du fil BOT ACTIVITY, elle, n'en met pas — voir botDm côté serveur.
  const sendViaBot = async (tgId: number, text: string) => {
    if (!await ask.confirm(`Send this to ${tgId} through the Algoria bot?\n\n${text}\n\n[+ buttons: open the app · join the channel · ask Mathieu]`)) return;
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botDm: { tg_id: tgId, text, cta: true } }) })
      .then(async (r) => {
        const d = (await r.json()) as { error?: string };
        if (d.error) void ask.alert(`⚠ ${d.error}`);
        else load(); // le botDm trace déjà un nudge → la personne sort de la file pour 3 jours
      })
      .finally(() => setBusy(false));
  };

  /** Publie sur le canal choisi, avec bouton. Confirmation OBLIGATOIRE : un post de canal part devant
   *  des milliers de personnes et ne se rattrape pas — l'aperçu montre exactement ce qui va partir. */
  const sendChannelPost = async () => {
    const text = cpText.trim();
    if (!text || !cpChat) return;
    const target = tgChats.find((c) => String(c.chat_id) === cpChat);
    const label = target?.title ?? cpChat;
    const btn = cpBtn.trim() ? `\n\n[ ${cpBtn.trim()} ] → ${cpUrl.trim()}` : '\n\n(aucun bouton)';
    if (!await ask.confirm(`Publier sur « ${label} » ?\n\n${text}${btn}\n\nLe miroir UK et le canal IT suivront automatiquement (bouton compris).`)) return;
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
        if (d.error) void ask.alert(`⚠ ${d.error}`);
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
  const delNote = async (id: string) => { if (sel && await ask.confirm('Delete this note?')) post({ deleteNote: id }, () => openMember(sel)); };
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
    // NUMÉRO DE COMPTE CHEZ LE BROKER — c'est la clé de rapprochement avec le dashboard partenaire, et
    // c'est ce qui manquait pour pointer les commissions ligne à ligne.
    //
    // ⚠️ ON LE CHERCHE PAR BROKER, PAS SUR LA FICHE MEMBRE. Un membre peut porter jusqu'à trois comptes
    // (un par stratégie, chez des brokers différents — voir member_accounts) : prendre bêtement
    // `member.mt5_login` sortirait le numéro du compte PRINCIPAL sur la ligne d'un dépôt fait chez un
    // AUTRE broker. Le rapprochement échouerait sur les cas multi-comptes, précisément ceux qui portent
    // les plus gros dépôts. On résout donc sur le broker de la ligne : fiche principale si son broker
    // correspond, sinon le compte supplémentaire ouvert chez ce broker-là.
    const brokerLoginOf = (tgId: number, broker: string | null | undefined): string => {
      const b = String(broker ?? '');
      // 1. l'historique des connexions validées chez CE broker — la source la plus fiable
      const hist = brokerLogins[`${tgId}|${b}`];
      if (hist) return hist;
      // 2. un compte supplémentaire encore ouvert chez ce broker (multi-stratégies)
      const extra = extraAccounts.find((a) => Number(a.tg_id) === Number(tgId) && String(a.broker ?? '') === b && a.mt5_login);
      if (extra?.mt5_login) return String(extra.mt5_login);
      // 3. la fiche membre, SEULEMENT si son broker correspond
      const m = rows.find((r) => Number(r.tg_id) === Number(tgId));
      if (m?.mt5_login && String(m.broker ?? '') === b) return String(m.mt5_login);
      // Rien de fiable : on laisse VIDE. Sortir ici le compte principal reviendrait à imprimer, sur une
      // ligne RaiseFX, un numéro PU Prime — on partirait le chercher dans le mauvais dashboard.
      return '';
    };
    const lines = [
      ['date', 'market', 'member', 'username', 'holder_name', 'country', 'broker', 'broker_account', 'deposit_usd', 'commission_usd', 'commission_status', 'note'],
      ...monthDeps.map((d) => [
        depDateOf(d).slice(0, 10),
        localeOf(d.tg_id).toUpperCase(),
        d.member_no != null ? `#${d.member_no}` : '',
        (() => { const m = rows.find((r) => Number(r.tg_id) === Number(d.tg_id)); return m?.tg_username ? '@' + m.tg_username : (m?.tg_name ?? ''); })(),
        legalOf(d.tg_id) ?? '',
        rows.find((r) => Number(r.tg_id) === Number(d.tg_id))?.country ?? '',
        d.detail?.broker ?? '',
        brokerLoginOf(d.tg_id, d.detail?.broker),
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

  // ÉCRAN DE GARDE : rendu par page.tsx (un hook ne peut pas court-circuiter le rendu).
  const gate = state === 'loading' ? <Center>loading…</Center> : state === 'anon' || state === 'forbidden' ? <AdminGate forbidden={state === 'forbidden'} deniedAs={deniedAs} /> : null;

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


  return { tab, setTab, goLive, wl, setWl, rows, setRows, actions, setActions, aff, setAff, state, setState, deniedAs, setDeniedAs, busy, setBusy, input, setInput, search, setSearch, creds, setCreds, selCreds, setSelCreds, deposits, setDeposits, pushTgIds, setPushTgIds, pendingTotal, setPendingTotal, nudges, setNudges, spokeTgIds, setSpokeTgIds, rejectedTgIds, setRejectedTgIds, botBlocked, setBotBlocked, relSeg, setRelSeg, copiedScript, setCopiedScript, cpText, setCpText, cpBtn, setCpBtn, cpUrl, setCpUrl, cpChat, setCpChat, cpReport, setCpReport, bcText, setBcText, bcTag, setBcTag, bcAudience, setBcAudience, bcReport, setBcReport, sendBroadcast, runnerLastSeen, setRunnerLastSeen, legalNames, setLegalNames, extraAccounts, setExtraAccounts, botActivity, setBotActivity, tgInboxOn, setTgInboxOn, brokerLogins, setBrokerLogins, market, setMarket, localeOf, blastText, setBlastText, blastTitle, setBlastTitle, blastBody, setBlastBody, joinSources, setJoinSources, tgChats, setTgChats, chatCopied, setChatCopied, sthAudit, setSthAudit, botDrafts, setBotDrafts, ym, setYm, depTg, setDepTg, depBroker, setDepBroker, depAmount, setDepAmount, depCom, setDepCom, depComAuto, depDate, setDepDate, depNote, setDepNote, planAmount, setPlanAmount, planTg, setPlanTg, planCopied, setPlanCopied, depInfoCopied, setDepInfoCopied, pushTitle, setPushTitle, pushBody, setPushBody, pushUrl, setPushUrl, pushAud, setPushAud, pushResult, setPushResult, sel, setSel, selActs, setSelActs, noteText, setNoteText, feedWins, setFeedWins, carding, setCarding, proof, setProof, load, downloadRecap, downloadCard, post, reveal, cancelCommission, payPayout, rejectPayout, validateLots, rejectConnect, waitBroker, liveAlert, showCreds, recordDepositAfterConnect, connectViaSth, reconnectSth, sthCheck, COUNTRIES, GEO_LABEL, geoCountryOf, setCountry, countrySelect, moveViaSth, OFFBOARD_MENU, offboard, banMember, nameOf, legalOf, editLegalName, editMember, editText, editPick, serverPick, lotPick, editPassword, copyDepositInfo, filtered, pushSet, alertsOff, alertsOn, depDateOf, depMonthOf, nextYm, monthDeps, depTotals, liveNoDeposit, shiftMonth, monthLabel, planExcluded, planRanking, copyBrokerLink, addDeposit, sendBlast, editDepositCom, editDepositAmount, deleteDeposit, sendCustomPush, composerSend, sendViaBot, sendChannelPost, nudge, openMember, addNote, delNote, actSummary, leads, STEP_LABEL, daysStuck, exportCsv, gate, live, pendingRev, depPending, todo, KIND_LABEL, TABS };
}

export type AdminState = ReturnType<typeof useAdminState>;
export const AdminCtx = createContext<AdminState | null>(null);
export function useAdmin(): AdminState {
  const c = useContext(AdminCtx);
  if (!c) throw new Error('useAdmin() outside <AdminCtx.Provider>');
  return c;
}
