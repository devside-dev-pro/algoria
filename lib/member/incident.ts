// 🚨 L'INCIDENT DU 21-22/10/2026 — la déclaration des pertes.
//
// Entre 23 h et 1 h UTC, le copieur externe a ouvert sur le master 145 achats d'or en deux heures, presque tous
// sans stop (jusqu'à 69 positions ouvertes en même temps) : master 72 952 $ → 10 919 $. Les membres en copie
// ont pris les mêmes trades à leur lot, la plupart des petits comptes ont été clôturés par le broker.
//
// Mathieu (22/10) : « j'aimerais quantifier et demander à tout le monde combien ils ont perdu pour essayer de
// trouver une solution… il ne faut pas qu'ils pensent qu'ils vont être remboursés à 100 % ». Ici : qui était
// touché (calculé côté serveur, jamais fourni par le navigateur), et ce que chacun déclare (solde avant / après,
// capture, commentaire). Une déclaration n'est PAS une demande de remboursement et le texte le dit.
import { HISTORY_MAINTENANCE } from './historyMaintenance';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const INCIDENT = {
  id: '2026-10-22',
  /** la première des positions de la nuit (copie déclenchée à 23:10 UTC) */
  start: '2026-10-21T23:00:00Z',
  /** la dernière position ouverte : 00:31 UTC */
  lastOpen: '2026-10-22T00:32:00Z',
  /** perte du master sur la nuit, à 1.00 lot (trades fermés entre 23 h et 2 h UTC) */
  masterLoss: 60849,
  tag: 'incident-22-10',
  /** jusqu'à quand le support traite la nuit comme un sujet chaud (garde du pilote automatique + note au modèle) */
  guardUntil: '2026-11-05T00:00:00Z',
} as const;

export const incidentActive = (now = Date.now()): boolean => now < Date.parse(INCIDENT.guardUntil);

/** LE SUPPORT PENDANT L'INCIDENT (22/10, Mathieu : « faut pas stopper tout, les onboardings continuent »). Le
 *  pilote automatique repart, mais tout ce qui touche à la nuit ou aux résultats passe par une carte : Mathieu
 *  répond lui-même, le bot n'improvise pas là-dessus. */
export const INCIDENT_TOPIC = /\b(blown|wiped|liquidat\w*|margin call|stop ?out|stopped out|account (?:was |got |is |has been )?(?:closed|gone|empty|blown|wiped)|what happened|last night|yesterday night|drawdown|crash\w*|bug|glitch|malfunction\w*|compensat\w*|results?|performance|profits?|returns?|track ?record|win ?rate|how much (?:did|do|can|could) (?:you|we|i|people) (?:make|earn))\b/i;

/** LA RÉPONSE D'ATTENTE DE MATHIEU (24/10/2026 : « que le support sache un peu gérer l'incident, au moins les faire
 *  patienter et les prévenir que j'ai mis en place des sécurités supplémentaires, que j'ai contacté le broker, que
 *  j'attends un retour, qu'ils ne s'inquiètent pas, on devrait trouver des solutions dans les prochains jours »).
 *  Un message sur la nuit elle-même (plus étroit que INCIDENT_TOPIC, qui couvre aussi les questions sur les résultats),
 *  ou n'importe quel message d'un membre touché : le bot rédige ce message d'attente, et il arrive chez Mathieu en
 *  proposition (« au moins qu'il m'envoie les propositions de réponses »). */
export const INCIDENT_TALK = /\b(incident|blown|wiped|liquidat\w*|margin call|stop ?out|stopped out|account (?:was |got |is |has been )?(?:closed|gone|empty|blown|wiped)|what happened|last night|yesterday night|crash\w*|bug|glitch|malfunction\w*|compensat\w*|refund\w*|money back|lost (?:my|all|everything|it|money)|losses?)\b/i;
/** … sauf ce qui reste à Mathieu même là : un retrait, une arnaque, un avocat, une plainte. */
export const INCIDENT_ESCALATE = /\b(withdraw\w*|scam\w*|fraud\w*|stolen|hack\w*|police|lawyer|solicitor|court|sue|legal action|chargeback|regulator|fsca|fca|ritir\w*|truffa)\b/i;
/** MYFXBOOK DU NOUVEAU MASTER (27/10/2026). Compte réel RaiseFX, MT5, vérifié par un tiers. Mathieu vient de le
 *  créer : ce lien REMPLACE la promesse « track record vérifiable à venir » (guide §13). Une seule constante :
 *  le support et le bot de l'app la recopient, les garde-fous ne laissent passer qu'elle. Aucun chiffre de
 *  résultat — le lien est la preuve. Pas le CM, pas la page /track-record, pas HISTORY_MAINTENANCE. */
export const MYFXBOOK_URL = 'https://www.myfxbook.com/members/AlgoriaAI/algoria-ai/12279938';
/** Liste fermée des liens de résultats. Tout autre Myfxbook, et la page track record de l'app, sont refusés. */
export const ALLOWED_RESULT_LINKS = [MYFXBOOK_URL] as const;

// 28/10/2026 : le lien est TOUJOURS suivi de l'avertissement, et ce n'est que le compte de la nouvelle version depuis
// le 26/10, jamais « tout l'historique ». Pas de petit échantillon (environ 5 trades par jour) : ni nombre de trades,
// ni nombre de jours, ni taux de réussite tiré de ce compte.
const MYFXBOOK_LINE = `the verified record of the new version since 26 October is followed by a third party on Myfxbook: ${MYFXBOOK_URL} then always "Past results don't guarantee future results." (it is the record of the new version only, never present it as the whole history of Algoria, and never quote a number of trades, days or wins from it)`;
/** 28/10/2026 : le bot n'amène jamais l'incident lui-même ; une question directe sur des pertes a sa phrase. */
const LOSSES_RULE = `Never bring up the incident yourself. If they ask directly whether there were losses, one sentence: "Yes, the previous engine had an incident on 21-22 October. The engine has been fully rebuilt since, and here's its verified record on Myfxbook." then ${MYFXBOOK_URL} and "Past results don't guarantee future results.". Never deny it, never say it cannot happen again.`;

/** 28/10/2026 (audit du support, 14 jours) : ce message d'attente disait « don't worry, we should be able to find
 *  solutions in the next few days » (24-27/10), et le bot ajoutait « Mathieu will get back to you personally today ».
 *  Plus aucun délai, plus aucune promesse de dédommagement ni de récupération des fonds : la phrase de suivi est
 *  celle de Mathieu, FOLLOW_UP_LINE. Et il partait sur un « 👋 », une question sur les pubs Telegram, une photo : il ne
 *  part plus que si le message parle de l'incident, et jamais deux fois à la même personne. */
export const FOLLOW_UP_LINE = "I've noted your situation and I'll come back to you personally as soon as I have something concrete.";
/** Réponse en une phrase à « il y a eu des pertes ? » (28/10/2026). Jamais nier, jamais « ça ne peut plus arriver ». */
export const LOSSES_LINE = "Yes, the previous engine had an incident on 21-22 October. The engine has been fully rebuilt since, and here's its verified record on Myfxbook.";
/** L'avertissement qui suit toujours le lien Myfxbook (28/10/2026). Ajouté par le code s'il manque. */
export const PAST_RESULTS_LINE = "Past results don't guarantee future results.";
/** Ce qui signe le paragraphe d'incident dans un texte déjà envoyé (détection de répétition). */
export const INCIDENT_PARAGRAPH = /\b(?:extra|additional) safeguards\b|\bcontacted (?:the broker|raisefx|vt markets|the brokers?)\b|\bwaiting for (?:their|the broker'?s) (?:answer|reply)\b/i;
const NO_PROMISE = `Never a deadline (no "today", "tonight", "tomorrow", "in the next few days", "this week", "in a few hours"), never a promise or a hint of a compensation, a refund, getting the money back or recovering the funds, never "don't worry", never an amount or a date, never blame the broker or the market, no figure about their loss. To say you will follow up, use exactly this line: "${FOLLOW_UP_LINE}"`;
export function incidentReplyNote(affected: boolean): string {
  return `${affected ? 'This person was affected by the incident of 21-22 October and their new message is about it.' : 'This person writes about the incident of 21-22 October (they were not on the list of affected members).'} Answer as Mathieu, in your own words, short, warm and calm. ${affected ? `If it is their first message about it in the Recent exchange: he is really sorry for what happened; extra safeguards now run on Algoria AI (a trade without a stop loss gets one automatically within 2 minutes, and everything closes if the day reaches −5%); he has contacted the broker about the incident and is waiting for their answer. If they have not told where they stand yet, you may invite them to do it in the app: https://app.getalgoria.com/member/incident (it is not a refund request).` : `If they ask whether there were losses, one sentence: "${LOSSES_LINE}" followed by ${MYFXBOOK_URL} and "${PAST_RESULTS_LINE}".`} ${NO_PROMISE} The incident was on the night of 21 to 22 October: always say "on 21-22 October", never "last night", "yesterday" or "this morning". If this was already said to them (Recent exchange or Note), never repeat it: answer only what is new, or intent "skip" for a simple thanks or ok.`;
}
/** Compat : le texte pour un membre touché. */
export const INCIDENT_REPLY_NOTE = incidentReplyNote(true);
/** Un membre touché écrit sur AUTRE chose (« 👋 », une photo, une question sur les pubs, l'app, le broker). */
export const INCIDENT_OTHER_NOTE = `This person was affected by the incident of 21-22 October, but their new message is about something else. Answer ONLY what they wrote, as Mathieu, short. Do NOT mention the incident, the safeguards, the broker contact or their loss: they raise it if they want to. A bare greeting or emoji gets a short greeting back. ${NO_PROMISE}`;

/** UN PROSPECT DEMANDE LES RÉSULTATS (26/10/2026). Mathieu garde l'historique en maintenance tant que le nouveau compte
 *  n'a pas quelques semaines de trades (option B), et il veut que le support en parle seul : « oui il peut en parler tout
 *  seul ». Depuis le 27/10/2026 le Myfxbook tient lieu de track record : plus de promesse « à venir », toujours aucun
 *  chiffre et jamais la page /track-record. 27/10/2026, retour de Mathieu : ne plus citer la limite de
 *  10 positions. On envoie environ 5 trades par jour, ça n'apporte rien. Les sécurités à dire : stop sous
 *  2 minutes, et tout se ferme à −5 % sur la journée. */
export const RESULTS_REPLY_NOTE = `This person has not started yet and asks about results, performance, profits, proof or the track record. Answer it yourself, short and calm, as Mathieu, in your own words: the new version of Algoria AI started trading on 26 October on a new account, with new safeguards (a trade without a stop loss gets one automatically within 2 minutes, and everything closes if the day reaches −5%); ${MYFXBOOK_LINE}. No result figure or percentage, no day's result, no link to the track record page (the Myfxbook link replaces the figures), never what someone could make, and no "I'll get back to you" or "let me check": the answer is complete as it is. If they also ask something else, answer that too. ${LOSSES_RULE} This is a routine answer: intent "auto".`;

/** Prospect qui demande ce qui s'est passé en octobre, une fois la garde de l'incident terminée mais tant que
 *  l'historique reste masqué (27/10/2026). La réponse « nouvelle version » ne doit PAS recouvrir la perte :
 *  on la dit telle quelle, on ne l'appelle pas « maintenance ». Le Myfxbook vient après, sans autre chiffre. */
export const HISTORY_LOSS_NOTE = `This person asks what happened in October, about the previous account, or why there is a new account. Answer honestly, short and calm, as Mathieu: on the night of 21 to 22 October a failure opened far too many buy positions on gold, almost all without a stop loss; the main account lost about 85%, and most members who were copying it took a heavy loss. Do not hide that loss, do not minimise it, do not blame the market or the broker, and never call it "maintenance" or a pause, never say it cannot happen again. Then one line: the new version of Algoria AI started trading on 26 October on a new account, with the new safeguards, and ${MYFXBOOK_LINE}. No other figure, no link to the track record page, never what someone could make. This is a routine answer: intent "auto".`;

/** Le bloc qui REMPLACE les chiffres du track record pour un prospect tant que l'historique est en maintenance
 *  (27/10/2026). Après le 05/11, incidentActive() devient faux et l'ancien code réinjectait REAL PAST RESULTS
 *  plus la consigne « cite les chiffres et le lien » de la page. L'historique de l'app reste masqué. Ici : la
 *  nouvelle version, les garde-fous, le Myfxbook à la place des chiffres, et la perte d'octobre dite franchement
 *  si on la demande. */
export const HISTORY_RESULTS_NOTE = `IMPORTANT — RESULTS, for someone who has not started and cannot see the history yet (this overrides the PAST RESULTS rule, the KNOWLEDGE and any older lesson about quoting results or sending the track record page):
Do NOT quote any result figure, percentage, win rate or dollar P&L, and do NOT send any link to the track record page. Do not say the history is in the app. Never answer a results question with the word "maintenance". The only results link you may send is ${MYFXBOOK_URL}, copied exactly.
If they ask about results, performance, profits, proof or the track record: the new version of Algoria AI started trading on 26 October on a new account, with new safeguards (a trade without a stop loss gets one automatically within 2 minutes, and everything closes if the day reaches −5%); ${MYFXBOOK_LINE}. Never what someone could make, and no "I'll get back to you". ${LOSSES_RULE} If they also ask something else, answer that too. Routine answer: intent "auto" when you write as Mathieu, "simple" when you are the Algoria bot.
If they ask what happened in October, about the previous account, or why there is a new account: do not hide it and do not dress it up. On the night of 21 to 22 October a failure opened far too many buy positions on gold, almost all without a stop loss. The main account lost about 85%, and most members who were copying it took a heavy loss; many accounts were closed by the broker. Never call that loss "maintenance" or a pause, never minimise it, never blame the market or the broker, never promise a refund or a compensation, never say it cannot happen again. Then the new version and the Myfxbook link, as above. No other figure.`;

export type ResultsPolicy = 'incident' | 'maintenance' | 'open';

/** Quel traitement des résultats. Jusqu'au 05/11 (incidentActive) : tout le monde, la note d'incident, aucun chiffre.
 *  Après : tant que l'historique est en maintenance, un prospect (ni live ni en pause) n'a ni chiffre de
 *  performance ni lien vers la page track record : la preuve est MYFXBOOK_URL. Un membre live ou en pause revoit
 *  les vrais chiffres, perte d'octobre comprise — on ne la retire pas. `historyMaintenance` ne sert qu'au script
 *  de contrôle ; en production on lit la constante HISTORY_MAINTENANCE. */
export function resultsPolicy(opts: { now?: number; status?: string | null; historyMaintenance?: boolean } = {}): ResultsPolicy {
  const now = opts.now ?? Date.now();
  if (incidentActive(now)) return 'incident';
  const maintenance = opts.historyMaintenance ?? HISTORY_MAINTENANCE;
  if (maintenance && opts.status !== 'live' && opts.status !== 'paused') return 'maintenance';
  return 'open';
}

/** Était-il sur la liste figée des membres touchés ? (une requête, pour la garde du pilote automatique) */
export async function wasAffected(db: Db, tgId: number): Promise<boolean> {
  const { data } = await db.from('member_actions').select('detail').eq('tg_id', tgId).eq('kind', 'incident_affected').eq('status', 'done').limit(5);
  return ((data ?? []) as Array<{ detail: Record<string, unknown> }>).some((r) => r.detail?.incident === INCIDENT.id);
}

/** Ce que le modèle doit savoir pour rédiger (à la place des chiffres du track record, tant que la garde court :
 *  octobre affiche la chute, et citer un « +X % depuis le lancement » ce jour-là serait trompeur). Les faits sont
 *  ceux du message VIP de Mathieu du 22/10. Depuis le 25/10 (Mathieu : « le nouvel EA est bien connecté, le service
 *  peut reprendre ») : le trading reprend le 26/10 sur un nouveau master, surveillé par les garde-fous du runner, et
 *  l'onboarding n'attend plus. Depuis le 26/10 (option B de Mathieu, historique en maintenance) : une question sur les
 *  résultats reçoit la nouvelle version, sans chiffre de performance. Depuis le 27/10, la preuve est le Myfxbook
 *  (MYFXBOOK_URL), pas la page /track-record et plus une promesse « à venir ». */
export const INCIDENT_NOTE = `IMPORTANT CONTEXT, since 22 October 2026 (it overrides any results or performance figures you may know):
On the night of 21 to 22 October, a failure in our trading system opened far too many buy positions on gold, almost all without a stop loss. The main account lost about 85%, and most members who were copying it took a very heavy loss; many accounts were closed by the broker. Trading was stopped while the failure was fixed. Since 26 October, the new version of Algoria AI trades again, on a new main account, with the extra safeguards described below. Mathieu told the full truth in the VIP channel.
- Never bring the incident up yourself: someone who writes about something else gets an answer to that only. It was on the night of 21 to 22 October: always say "on 21-22 October", never "last night", "yesterday" or "this morning".
- If someone mentions it: acknowledge it plainly, never minimise it, never deny it, never say it cannot happen again, never blame the market or the broker. Extra safeguards run on Algoria AI (a trade without a stop loss gets one automatically within 2 minutes, and everything closes if the day reaches −5%); Mathieu has contacted the broker about the incident and is waiting for their answer; nothing is confirmed. Never a deadline (today, tomorrow, in the next few days…), never a promise or a hint of a compensation, a refund, getting the money back or recovering the funds, never "don't worry". To say he will follow up: "${FOLLOW_UP_LINE}" (or, as the Algoria bot: Mathieu has noted their situation and will come back to them personally as soon as he has something concrete).
- If they ask directly whether there were losses (a prospect): one sentence, "${LOSSES_LINE}", then ${MYFXBOOK_URL} and "${PAST_RESULTS_LINE}".
- Do not quote ANY past results, percentages or win rates right now.
- If someone asks about results, performance, profits, proof or the track record: the new version of Algoria AI started trading on 26 October 2026 on a new account, with the safeguards below; ${MYFXBOOK_LINE}. No result figure, no link to the track record page (the Myfxbook link replaces the figures), never what someone could make. If they ask about the previous version or why a new account, answer honestly with the facts above.
- Onboarding works as usual again: new people open their account, connect it in the app, and the copy starts once their account is verified.
- Our address changed on 22 October: the app is now https://app.getalgoria.com. Old algoria.tech links no longer open, and neither does the Algoria icon installed on the phone before 22 October (it points to the old address). If someone can't connect, says the site is down or the app won't open: it is NOT maintenance (never say maintenance). Tell them the address changed, to delete the old Algoria icon and install the app again from https://app.getalgoria.com/download, then log in with Telegram (one tap, no password). Their trading account and settings are not affected.`;

export const INCIDENT_KIND = 'incident_claim';
export const PROOF_BUCKET = 'incident-proofs';

/** Ce que STH a montré pour ce membre au contrôle « qui copiait vraiment » (null = pas encore contrôlé). */
export type SthSeen = 'copying' | 'not-copying' | 'unknown';

export interface Affected {
  tg_id: number; member_no: number | null; tg_name: string | null; tg_username: string | null; locale: string | null; lot: number; broker: string | null; status: string; since: string | null;
  sth: SthSeen | null; sth_detail: string | null; excluded: boolean;
  /** la ligne de l'instantané (null sans instantané) : c'est elle qui porte le contrôle STH et le retrait à la main */
  snapshot: { id: string; detail: Record<string, unknown> } | null; // id = uuid de member_actions (jamais un nombre)
}

/** QUI REÇOIT LE DM (Mathieu, 22/10 : « que les gens qui étaient connectés… moins cela fera de bruit, mieux c'est
 *  pour notre image »). La liste figée ne contient déjà que des membres live cette nuit-là ; on retire en plus ceux
 *  que STH montre abonnés à aucun master (ou à un autre), et ceux que Mathieu a retirés à la main. Un « unknown »
 *  (STH injoignable) RESTE : rater quelqu'un qui a vraiment perdu serait pire qu'un message de trop. Un membre retiré
 *  garde le droit de déclarer sur la page s'il y arrive. */
export const inAudience = (m: Affected): boolean => !m.excluded && m.sth !== 'not-copying';

type Base = Pick<Affected, 'tg_id' | 'member_no' | 'tg_name' | 'tg_username' | 'locale' | 'broker' | 'status'> & { lot: number | null };

/** Les membres qui copiaient pendant l'incident. D'abord l'INSTANTANÉ figé le 22/10 au matin (lignes member_actions
 *  'incident_affected', les 72 live de ce moment-là) : une mise en pause générale sur STH ensuite ne doit faire sortir
 *  personne de la liste. Sans instantané : branchés (connect validé) avant la dernière position, et encore live, ou
 *  passés en pause / débranchés APRÈS le début de l'incident. */
export async function affectedMembers(db: Db): Promise<Affected[]> {
  const { data: snap } = await db.from('member_actions').select('id,tg_id,detail').eq('kind', 'incident_affected').eq('status', 'done').limit(2000);
  const frozen = ((snap ?? []) as Array<{ id: string; tg_id: number; detail: Record<string, unknown> }>).filter((r) => r.detail?.incident === INCIDENT.id);
  if (frozen.length) {
    const ids = frozen.map((r) => Number(r.tg_id));
    const { data: ms } = await db.from('members').select('tg_id,member_no,tg_name,tg_username,locale,lot,broker,status').in('tg_id', ids).is('banned_at', null);
    const at = new Map(frozen.map((r) => [Number(r.tg_id), r]));
    return ((ms ?? []) as Array<Base>).map((m) => {
      const row = at.get(Number(m.tg_id));
      const d = row?.detail ?? {};
      return {
        ...m, tg_id: Number(m.tg_id), lot: Number(d.lot ?? m.lot ?? 0.01) || 0.01, since: (d.since as string | undefined) ?? null,
        sth: (d.sth as SthSeen | undefined) ?? null, sth_detail: (d.sth_detail as string | undefined) ?? null, excluded: d.excluded === true,
        snapshot: row ? { id: String(row.id), detail: d } : null,
      };
    });
  }
  const [{ data: ms }, { data: starts }, { data: after }] = await Promise.all([
    db.from('members').select('tg_id,member_no,tg_name,tg_username,locale,lot,broker,status').in('status', ['live', 'paused', 'offboarded']).is('banned_at', null).limit(2000),
    db.from('member_actions').select('tg_id,done_at').eq('kind', 'connect').eq('status', 'done').not('done_at', 'is', null).lt('done_at', INCIDENT.lastOpen).limit(5000),
    db.from('member_actions').select('tg_id').in('kind', ['pause', 'disconnect']).gte('created_at', INCIDENT.start).limit(5000),
  ]);
  const first = new Map<number, string>();
  for (const s of (starts ?? []) as Array<{ tg_id: number; done_at: string }>) {
    const k = Number(s.tg_id);
    if (!first.has(k) || s.done_at < first.get(k)!) first.set(k, s.done_at);
  }
  const stoppedAfter = new Set(((after ?? []) as Array<{ tg_id: number }>).map((r) => Number(r.tg_id)));
  return ((ms ?? []) as Array<Base>)
    .filter((m) => first.has(Number(m.tg_id)) && (m.status === 'live' || stoppedAfter.has(Number(m.tg_id))))
    .map((m) => ({ ...m, tg_id: Number(m.tg_id), lot: Number(m.lot ?? 0.01) || 0.01, since: first.get(Number(m.tg_id)) ?? null, sth: null, sth_detail: null, excluded: false, snapshot: null }));
}

/** Ce que les trades de la nuit représentent à son lot, s'il les a tous copiés (sa vraie perte est plafonnée par son
 *  solde : le broker clôture le compte avant). Une estimation pour Mathieu, jamais montrée comme un chiffre dû. */
export const estimatedLoss = (lot: number) => Math.round(INCIDENT.masterLoss * lot);
