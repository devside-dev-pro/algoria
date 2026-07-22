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

interface WL { username: string; added_by: string | null; created_at: string }
interface Row {
  member_no: number; tg_id: number; tg_username: string | null; tg_name: string | null; status: string;
  broker: string | null; risk_tier: string; created_at: string; updated_at: string | null; onboarding_step: number;
  mt5_login: string | null; mt5_server: string | null; usdt_trc20: string | null; referred_by: number | null;
}
interface Action { id: string; tg_id?: number; member_no: number | null; kind: string; status?: string; done_by?: string | null; detail: Record<string, unknown> | null; created_at: string }
interface Comm { id: string; referrer_tg_id: number; referred_tg_id: number | null; kind: string; amount: number; status: string; reason: string | null; detail: Record<string, unknown> | null; created_at: string }
interface Payout { id: string; tg_id: number; amount: number; address: string; status: string; tx_hash: string | null; reason: string | null; created_at: string }
interface Affiliate { pendingCommissions: Comm[]; recentCommissions: Comm[]; pendingPayouts: Payout[]; recentPayouts: Payout[]; owedUsd: number; flagged: { tg_id: number; balance: number; username: string | null; member_no: number | null }[] }
// registre des dépôts broker (bilan mensuel) — porté par member_actions kind='deposit'
interface Deposit {
  id: string; tg_id: number; member_no: number | null; created_at: string;
  detail: { broker?: string | null; amount_usd?: number; commission_usd?: number; commission_status?: string; note?: string | null; deposited_at?: string } | null;
}

type Tab = 'dashboard' | 'queue' | 'members' | 'deposits' | 'affiliate' | 'tools';

export default function AdminCRM() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [wl, setWl] = useState<WL[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [aff, setAff] = useState<Affiliate | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden' | 'anon'>('loading');
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [creds, setCreds] = useState<Record<string, { login: string; server: string; password: string }>>({});
  const [selCreds, setSelCreds] = useState<{ login: string; server: string; password: string } | null>(null);
  // ===== registre des dépôts : mois affiché + formulaire de saisie =====
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [pushTgIds, setPushTgIds] = useState<number[]>([]); // tg_id ayant au moins 1 appareil abonné aux alertes
  const [nudges, setNudges] = useState<{ tg_id: number; created_at: string; done_by?: string }[]>([]); // historique des relances (auto + manuelles)
  const [runnerLastSeen, setRunnerLastSeen] = useState<number | null>(null); // heartbeat runner (dernière bougie écrite)
  const [legalNames, setLegalNames] = useState<Record<string, string>>({}); // tg_id → nom légal broker (kyc) : LE pont entre les 3 identités
  const [ym, setYm] = useState(() => new Date().toISOString().slice(0, 7)); // 'YYYY-MM' du bilan affiché
  const [depTg, setDepTg] = useState('');
  const [depBroker, setDepBroker] = useState('');
  const [depAmount, setDepAmount] = useState('');
  const [depCom, setDepCom] = useState('');
  const [depDate, setDepDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [depNote, setDepNote] = useState('');
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
      if (r.status === 403) return setState('forbidden');
      const d = (await r.json()) as { whitelist: WL[]; members: Row[]; actions: Action[]; affiliate?: Affiliate; deposits?: Deposit[]; pushTgIds?: number[]; nudges?: { tg_id: number; created_at: string; done_by?: string }[] };
      setWl(d.whitelist);
      setRows(d.members);
      setActions(d.actions ?? []);
      setAff(d.affiliate ?? null);
      setDeposits(d.deposits ?? []);
      setPushTgIds(d.pushTgIds ?? []);
      setNudges(d.nudges ?? []);
      setRunnerLastSeen((d as { runnerLastSeen?: number | null }).runnerLastSeen ?? null);
      setLegalNames((d as { legalNames?: Record<string, string> }).legalNames ?? {});
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
  const liveAlert = () => { if (window.confirm('Send "🔴 ALGORIA IS LIVE" to every subscribed member?')) post({ liveAlert: true }); };
  // révéler les identifiants d'un membre À TOUT MOMENT (déchiffrés côté serveur, tracés en timeline)
  const showCreds = (tgId: number) => {
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revealMember: tgId }) })
      .then(async (r) => { const d = (await r.json()) as { login?: string; server?: string; password?: string; error?: string }; if (d.error) window.alert(d.error); else if (d.password) setSelCreds({ login: d.login ?? '', server: d.server ?? '', password: d.password }); })
      .finally(() => setBusy(false));
  };
  // connexion AUTO via STH : branche le compte dans le copieur, puis enchaîne `done` (passage LIVE) si OK
  const connectViaSth = (id: string) => {
    if (!window.confirm('Connect this account to the copier via STH now?\n\nVerify the deposit first — on success the member goes LIVE.')) return;
    setBusy(true);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectSth: id }) })
      .then(async (r) => { const d = (await r.json()) as { ok?: boolean; error?: string }; setBusy(false); if (d.error) return window.alert(d.error); post({ done: id }, () => setCreds((c) => { const n = { ...c }; delete n[id]; return n; })); })
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

  const nameOf = (tg: number | null | undefined) => {
    const m = rows.find((r) => Number(r.tg_id) === Number(tg));
    return m ? (m.tg_username ? '@' + m.tg_username : `#${m.member_no}`) : tg == null ? '—' : String(tg);
  };
  // nom légal (compte broker) d'un membre — la clé pour rapprocher Telegram ↔ admin ↔ broker/STH
  const legalOf = (tg: number | null | undefined) => (tg != null ? legalNames[String(tg)] ?? null : null);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    // tg_id inclus : c'est l'ID que STH affiche pour les receivers API — coller « 7557770646 » retrouve le membre
    return rows.filter((r) => [r.tg_username, r.tg_name, r.broker, r.mt5_login, String(r.member_no), String(r.tg_id), r.status, legalOf(r.tg_id)].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  // ===== ALERTES PUSH : qui a activé, qui relancer (Telegram) =====
  const pushSet = useMemo(() => new Set(pushTgIds.map(Number)), [pushTgIds]);
  const alertsOff = useMemo(() => rows.filter((r) => !pushSet.has(Number(r.tg_id))), [rows, pushSet]);
  const alertsOn = rows.length - alertsOff.length;

  // ===== bilan du mois affiché : lignes + totaux (dépôts, coms reçues/attendues/sautées) =====
  const depDateOf = (d: Deposit) => String(d.detail?.deposited_at ?? d.created_at);
  const monthDeps = useMemo(
    () => deposits.filter((d) => depDateOf(d).slice(0, 7) === ym).sort((a, b) => depDateOf(a).localeCompare(depDateOf(b))),
    [deposits, ym],
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
  const shiftMonth = (delta: number) => {
    const [y, m] = ym.split('-').map(Number);
    setYm(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
  };
  const monthLabel = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
  const addDeposit = () => {
    if (!depTg || !depAmount) return;
    post(
      { addDeposit: { tg_id: Number(depTg), broker: depBroker, amount: Number(depAmount), commission: Number(depCom || 0), date: depDate, note: depNote } },
      () => { setDepAmount(''); setDepCom(''); setDepNote(''); },
    );
  };
  const editDepositCom = (d: Deposit) => {
    const v = window.prompt('Expected commission ($):', String(d.detail?.commission_usd ?? 0));
    if (v !== null && Number.isFinite(Number(v))) post({ updateDeposit: { id: d.id, commission: Number(v) } });
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
    if (a.kind === 'connect') return `MT5 ${String(d.login ?? '?')} @ ${String(d.server ?? '?')} · lot ${String(d.lot ?? '?')}${d.reject_reason ? ` · ✗ ${String(d.reject_reason)}` : ''}`;
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
      ['date', 'member', 'username', 'broker', 'deposit_usd', 'commission_usd', 'commission_status', 'note'],
      ...monthDeps.map((d) => [
        depDateOf(d).slice(0, 10),
        d.member_no != null ? `#${d.member_no}` : '',
        (() => { const m = rows.find((r) => Number(r.tg_id) === Number(d.tg_id)); return m?.tg_username ? '@' + m.tg_username : (m?.tg_name ?? ''); })(),
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
    a.download = `algoria-deposits-${ym}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (state === 'loading') return <Center>loading…</Center>;
  if (state === 'anon' || state === 'forbidden') return <AdminGate forbidden={state === 'forbidden'} />;

  const live = rows.filter((r) => r.status === 'live').length;
  const pendingRev = rows.filter((r) => r.status === 'pending_copier').length;
  // les coms de dépôt EN ATTENTE comptent dans le travail à faire : confirmer quand le broker a payé
  const depPending = deposits.filter((d) => String(d.detail?.commission_status ?? 'pending') === 'pending');
  const todo = actions.length + (aff?.pendingCommissions.length ?? 0) + (aff?.pendingPayouts.length ?? 0) + depPending.length;
  const KIND_LABEL: Record<string, string> = { connect: '🔌 CONNECT ACCOUNT', risk_change: '⚖ RISK CHANGE', strategy_change: '🎯 STRATEGY CHANGE (move master in STH)', pause: '⏸ PAUSE COPY', resume: '▶ RESUME COPY', disconnect: '⛔ DISCONNECT (remove from copier)', referral_reward: '💰 PAY REFERRAL REWARD (legacy)', kyc: '🪪 BROKER DETAILS', deposit: '🏦 DEPOSIT', note: '📝 NOTE' };
  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'dashboard', label: 'DASHBOARD' },
    { key: 'queue', label: 'QUEUE', badge: actions.length },
    { key: 'members', label: 'MEMBERS', badge: rows.length },
    { key: 'deposits', label: 'DEPOSITS', badge: deposits.filter((d) => String(d.detail?.commission_status ?? 'pending') === 'pending').length },
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
              </section>
            ) : (
              <section className="panel" style={{ padding: 22, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>All clear — nothing waiting on you. 🎉</section>
            )}
            {/* ===== RELANCES DU JOUR — la file de leads à toucher EN PERSONNE (message/vocal Mathieu).
                Prospects en onboarding 1-21 j, pas touchés depuis 3 j (relances auto comprises). Le bot
                filet passe à 10h UTC derrière — mais TON vocal convertit mieux : déroule cette liste d'abord. */}
            {(() => {
              const now = Date.now();
              const lastNudge = new Map<number, number>();
              for (const n of nudges) { const t = Number(n.tg_id); const at = Date.parse(n.created_at); if ((lastNudge.get(t) ?? 0) < at) lastNudge.set(t, at); }
              const queue = rows
                .filter((r) => r.status === 'onboarding')
                .map((r) => ({ r, days: Math.floor((now - Date.parse(r.created_at)) / 86_400_000), touched: lastNudge.get(Number(r.tg_id)) }))
                .filter((x) => x.days >= 1 && x.days <= 21 && (!x.touched || now - x.touched > 3 * 86_400_000))
                .sort((a, b) => a.days - b.days);
              if (queue.length === 0) return <section className="panel" style={{ padding: 16, color: 'var(--dim)', fontSize: 12.5 }}>📞 Relance queue clear — every recent lead was touched in the last 3 days.</section>;
              return (
                <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <h2 style={secH}>📞 RELANCES DU JOUR · {queue.length} — your personal DM/voice beats any bot</h2>
                  {queue.slice(0, 15).map(({ r, days, touched }) => (
                    <div key={r.tg_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.5)' }}>
                      <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12, minWidth: 36 }}>#{r.member_no}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>{r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '—')}</span>
                      {legalOf(r.tg_id) && <span className="mono" style={{ fontSize: 10, color: 'var(--gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }} title="name on the broker account">🏦 {legalOf(r.tg_id)}</span>}
                      <span className="mono" style={{ fontSize: 10, fontWeight: 800, color: days >= 5 ? '#ff8a5c' : 'var(--gold)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px' }}>J+{days}</span>
                      {touched && <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>last touch {Math.floor((now - touched) / 86_400_000)}d ago</span>}
                      <span style={{ flex: 1 }} />
                      {r.tg_username && <a href={`https://t.me/${r.tg_username}`} target="_blank" rel="noreferrer" style={{ ...miniBtn, textDecoration: 'none', color: 'var(--cyan)', borderColor: 'rgba(43,227,245,.4)' }}>💬 DM</a>}
                      <button disabled={busy} onClick={() => post({ nudged: r.tg_id })} title="I sent my personal message/voice note — remove from the queue for 3 days" style={okBtn}>✓ FAIT</button>
                    </div>
                  ))}
                  {queue.length > 15 && <p style={{ margin: 0, fontSize: 11, color: 'var(--dim)' }}>+{queue.length - 15} more — the 10:00 UTC auto-nudge (push + bot DM) catches whoever you don&rsquo;t reach.</p>}
                </section>
              );
            })()}
          </>
        )}

        {/* ===== QUEUE — à appliquer dans Social Trade Hub ===== */}
        {tab === 'queue' && (
          <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={secH}>TO APPLY IN SOCIAL TRADE HUB {actions.length > 0 && `· ${actions.length}`}</h2>
            {actions.length === 0 && <p style={dimP}>Queue clear — nothing to apply.</p>}
            {actions.map((a) => (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                      {a.kind === 'connect' && `MT5 ${String(a.detail?.login ?? '?')} @ ${String(a.detail?.server ?? '?')} · lot ${String(a.detail?.lot ?? '?')}${a.detail?.strategy ? ` · S${String(a.detail.strategy)}` : ''} · `}
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
                      return (
                        <div style={{ fontSize: 10.5, marginTop: 2, color: 'var(--gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          VERIFY → {broker ? broker.toUpperCase() : '⚠ broker ?'} · {bname ?? '⚠ no name — ask'} · {dep ? `$${dep} declared` : '⚠ no deposit declared — ask'}{uname ? <span style={{ color: 'var(--cyan)' }}> · @{uname}</span> : ''}
                        </div>
                      );
                    })()}
                  </div>
                  {a.kind === 'connect' && !creds[a.id] && (
                    <button disabled={busy} onClick={() => reveal(a.id)} title="decrypt the member's MT5 password (timestamped)" style={goldBtn}>🔑 REVEAL</button>
                  )}
                  {a.kind === 'connect' && (
                    <button disabled={busy} onClick={() => connectViaSth(a.id)} title="connect this account to the copier via STH now, then go LIVE (one click, no manual STH entry)" style={{ ...okBtn, color: '#06121f', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', border: 'none' }}>🔗 CONNECT (STH)</button>
                  )}
                  {a.kind === 'strategy_change' && (
                    <button disabled={busy} onClick={() => moveViaSth(a.id)} title="move this member's receiver to their new strategy's master via the STH API (API-connected members only — manually-added receivers must be moved in the STH dashboard)" style={{ ...okBtn, color: '#06121f', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', border: 'none' }}>🔀 MOVE (STH)</button>
                  )}
                  <button disabled={busy} onClick={() => post({ done: a.id }, () => setCreds((c) => { const n = { ...c }; delete n[a.id]; return n; }))} title="mark done manually (if you connected the account in STH yourself)" style={okBtn}>✓ DONE</button>
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
              <span style={{ fontSize: 15, fontWeight: 800 }}>{sel.tg_username ? '@' + sel.tg_username : (sel.tg_name ?? '—')}</span>
              {sel.tg_username && sel.tg_name && <span style={{ fontSize: 12, color: 'var(--dim)' }}>{sel.tg_name}</span>}
              {legalOf(sel.tg_id) && <span className="mono" style={{ fontSize: 11, color: 'var(--gold)', border: '1px solid rgba(245,194,74,.35)', borderRadius: 6, padding: '2px 8px' }} title="name on the broker account">🏦 {legalOf(sel.tg_id)}</span>}
              <StatusChip status={sel.status} />
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
              <span>broker <b style={{ color: 'var(--text)' }}>{sel.broker ?? '—'}</b></span>
              <span>risk <b style={{ color: 'var(--text)' }}>{sel.risk_tier}</b></span>
              <span>MT5 <b style={{ color: 'var(--text)' }}>{sel.mt5_login ? `${sel.mt5_login} @ ${sel.mt5_server ?? '?'}` : '—'}</b></span>
              {/* l'ID que STH affiche pour les receivers connectés via l'API (UserID = tg_id) — la clé pour
                  rapprocher « 7557770646 » vu dans STH ↔ le bon membre ici. Copiable en un clic. */}
              <span>STH id <b style={{ color: 'var(--gold)' }}>{sel.tg_id}</b> <button onClick={() => void navigator.clipboard?.writeText(String(sel.tg_id))} style={miniBtn}>copy</button></span>
              <span>USDT <b style={{ color: 'var(--text)' }}>{sel.usdt_trc20 ? sel.usdt_trc20.slice(0, 8) + '…' : '—'}</b></span>
              <span>since <b style={{ color: 'var(--text)' }}>{new Date(sel.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</b></span>
              <span>referred by <b style={{ color: 'var(--text)' }}>{sel.referred_by ? nameOf(sel.referred_by) : '—'}</b></span>
              <span>invited <b style={{ color: 'var(--text)' }}>{rows.filter((r) => Number(r.referred_by) === Number(sel.tg_id)).length}</b></span>
            </div>
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
        {tab === 'members' && (
          <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderColor: 'rgba(43,227,245,.28)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={secH}>🔔 PUSH ALERTS</h2>
              <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: alertsOn > 0 ? 'var(--up)' : 'var(--dim)' }}>{alertsOn}<span style={{ color: 'var(--dim)', fontWeight: 500 }}> / {rows.length}</span></span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>have alerts on{alertsOff.length ? ` · ${alertsOff.length} to nudge` : ' · everyone covered 🎉'}</span>
            </div>
            {alertsOff.length > 0 && (
              <>
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5 }}>
                  These members haven&rsquo;t enabled notifications (no device subscribed). Ping them on Telegram — installing the app + one tap on <b style={{ color: 'var(--muted)' }}>Profile → Enable alerts</b> is all it takes.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {alertsOff.map((r) => (
                    <span key={r.member_no} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(10,17,31,.5)', fontSize: 11.5 }}>
                      <span className="goldText mono" style={{ fontWeight: 800 }}>#{r.member_no}</span>
                      <span style={{ color: 'var(--text)' }}>{r.tg_username ? '@' + r.tg_username : (r.tg_name ?? '—')}</span>
                      <StatusChip status={r.status} />
                      {r.tg_username && <a href={`https://t.me/${r.tg_username}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none', color: 'var(--cyan)', fontWeight: 700, fontSize: 10.5 }}>💬 DM</a>}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
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
                <input value={depBroker} onChange={(e) => setDepBroker(e.target.value)} placeholder="broker" style={{ ...inp, width: 150 }} />
                <input value={depAmount} onChange={(e) => setDepAmount(e.target.value)} placeholder="deposit $" inputMode="decimal" style={{ ...inp, width: 110 }} />
                <input value={depCom} onChange={(e) => setDepCom(e.target.value)} placeholder="expected com $" inputMode="decimal" style={{ ...inp, width: 140 }} />
                <input type="date" value={depDate} onChange={(e) => setDepDate(e.target.value)} style={{ ...inp, width: 150 }} />
                <input value={depNote} onChange={(e) => setDepNote(e.target.value)} placeholder="note (optional)" style={{ ...inp, flex: 1, minWidth: 160 }} />
                <button disabled={busy || !depTg || !Number(depAmount)} onClick={addDeposit} style={{ padding: '10px 18px', borderRadius: 9, border: 'none', fontWeight: 800, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', opacity: !depTg || !Number(depAmount) ? 0.5 : 1 }}>+ ADD</button>
              </div>
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
                      <span className="mono goldText" style={{ fontWeight: 800, fontSize: 12 }}>#{d.member_no ?? '—'}</span>
                      {/* pas nameOf : sans @username il renvoie #no, déjà affiché juste avant → doublon */}
                      <span style={{ fontSize: 12, color: 'var(--text)' }}>{(() => { const m = rows.find((r) => Number(r.tg_id) === Number(d.tg_id)); return m?.tg_username ? '@' + m.tg_username : (m?.tg_name ?? '—'); })()}</span>
                      {legalOf(d.tg_id) && <span className="mono" style={{ fontSize: 10.5, color: 'var(--gold)' }} title="name on the broker account">🏦 {legalOf(d.tg_id)}</span>}
                      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{(d.detail?.broker ?? '—').toUpperCase()}</span>
                      <span className="mono" style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--cyan)' }}>${Number(d.detail?.amount_usd ?? 0)}</span>
                      <span style={{ color: 'var(--dim)', fontSize: 11 }}>→ com</span>
                      <button onClick={() => editDepositCom(d)} title="edit expected commission" className="mono" style={{ ...miniBtn, fontSize: 12, fontWeight: 800, color: 'var(--gold)' }}>${Number(d.detail?.commission_usd ?? 0)} ✎</button>
                      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, color: stC, border: `1px solid color-mix(in srgb, ${stC} 40%, transparent)`, borderRadius: 6, padding: '2px 7px' }}>{st === 'canceled' ? 'LOST' : st.toUpperCase()}</span>
                      <span style={{ flex: 1 }} />
                      {st !== 'received' && <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, comStatus: 'received' } })} style={okBtn}>✓ RECEIVED</button>}
                      {st !== 'canceled' && <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, comStatus: 'canceled' } })} title="commission fell through (flash withdrawal, broker refusal…)" style={dangerBtn}>✗ LOST</button>}
                      {st !== 'pending' && <button disabled={busy} onClick={() => post({ updateDeposit: { id: d.id, comStatus: 'pending' } })} title="back to pending" style={miniBtn}>↺</button>}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
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
                <div key={period} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(245,194,74,.35)', background: 'rgba(245,194,74,.05)' }}>
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
                <div key={t.ticket} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' }}>
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
function AdminGate({ forbidden }: { forbidden: boolean }) {
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'expired' | 'error'>('idle');
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);
  const start = async () => {
    try {
      if (forbidden) { try { await fetch('/api/member/logout', { method: 'POST' }); } catch { /* purge best-effort */ } }
      const r = await fetch('/api/member/tglogin', { method: 'POST' });
      const d = (await r.json()) as { code?: string; link?: string };
      if (!d.code || !d.link) { setPhase('error'); return; }
      setPhase('waiting');
      openTelegram(d.link, { fallbackNewTab: true });
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const p = (await fetch(`/api/member/tglogin?code=${d.code}`).then((x) => x.json()).catch(() => null)) as { ok?: boolean; expired?: boolean } | null;
        if (p?.ok) { if (poll.current) clearInterval(poll.current); window.location.replace('/admin'); } // reload complet → re-check admin
        else if (p?.expired) { if (poll.current) clearInterval(poll.current); setPhase('expired'); }
      }, 2000);
    } catch {
      setPhase('error');
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
