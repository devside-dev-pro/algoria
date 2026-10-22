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
} as const;

export const INCIDENT_KIND = 'incident_claim';
export const PROOF_BUCKET = 'incident-proofs';

/** Ce que STH a montré pour ce membre au contrôle « qui copiait vraiment » (null = pas encore contrôlé). */
export type SthSeen = 'copying' | 'not-copying' | 'unknown';

export interface Affected {
  tg_id: number; member_no: number | null; tg_name: string | null; tg_username: string | null; locale: string | null; lot: number; broker: string | null; status: string; since: string | null;
  sth: SthSeen | null; sth_detail: string | null; excluded: boolean;
  /** la ligne de l'instantané (null sans instantané) : c'est elle qui porte le contrôle STH et le retrait à la main */
  snapshot: { id: number; detail: Record<string, unknown> } | null;
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
  const frozen = ((snap ?? []) as Array<{ id: number; tg_id: number; detail: Record<string, unknown> }>).filter((r) => r.detail?.incident === INCIDENT.id);
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
        snapshot: row ? { id: Number(row.id), detail: d } : null,
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
