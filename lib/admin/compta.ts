// COMPTA — calculs de l'onglet COMPTA de l'admin (30/09/2026, demande Mathieu : « à chaque fois je me demande
// combien j'ai fait aujourd'hui, ou même hier, du coup je dois compter manuellement »).
//
// Fonctions pures, sans React ni réseau : l'onglet leur passe les lignes brutes de /api/member/admin/compta.
//
// CE QUE « GAGNÉ » VEUT DIRE ICI :
//   · commission broker attendue ou reçue (tout sauf « LOST ») + paiements d'accès direct ;
//   · « encaissé » = commissions marquées RECEIVED + accès directs (déjà payés) ;
//   · coûts = parrainage PAYÉ (referral_payouts status 'paid') + dépenses saisies (table expenses) ;
//   · net = gagné − coûts.
// DATES : on range un dépôt au jour RÉEL du dépôt (deposited_at), pas au mois comptable (booked_ym) de l'onglet
// DEPOSITS — ici on veut savoir ce qui s'est passé tel jour. Une date saisie à la main (minuit UTC pile) est un
// jour calendaire ; un horodatage réel (GO LIVE) est converti au jour LOCAL de l'admin.

export interface RawDeposit { id: string; tg_id: number; member_no: number | null; created_at: string; detail: Record<string, unknown> | null }
export interface RawMember { tg_id: number; member_no: number | null; tg_username: string | null; country: string | null; source: string | null; broker: string | null }
export interface RawPayout { id: string; tg_id: number; amount: number; status: string; created_at: string; decided_at: string | null }
export interface RawExpense { id: string; spent_on: string; amount_usd: number; category: string; note: string | null; paid_by?: string | null }

export interface Dep {
  id: string; tgId: number; memberNo: number | null; who: string; day: string;
  nature: 'broker' | 'direct'; amount: number; com: number; status: 'pending' | 'received' | 'canceled';
  broker: string; country: string; source: string; redeposit: boolean;
}
export type Partner = 'mathieu' | 'benjamin';
export interface Cost { id: string; day: string; amount: number; kind: 'referral' | 'expense'; label: string; paidBy: Partner | null }

const pad = (n: number) => String(n).padStart(2, '0');
/** Jour local AAAA-MM-JJ d'une date. */
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Jour d'une date stockée : date pure (minuit UTC) → ce jour-là ; horodatage réel → jour local. */
export function dayOf(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso) || /T00:00:00(\.000)?(Z|\+00:00)$/.test(iso)) return iso.slice(0, 10);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : localDay(d);
}
export const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d); };
/** Lundi de la semaine du jour donné. */
export const weekStart = (day: string) => { const d = new Date(`${day}T12:00:00`); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return localDay(d); };
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
export const monthEnd = (day: string) => { const d = new Date(`${monthStart(day)}T12:00:00`); d.setMonth(d.getMonth() + 1); d.setDate(0); return localDay(d); };
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000) + 1;

export function normalize(deps: RawDeposit[], members: RawMember[], payouts: RawPayout[], expenses: RawExpense[]): { deps: Dep[]; costs: Cost[] } {
  const byTg = new Map(members.map((m) => [Number(m.tg_id), m]));
  const out: Dep[] = deps.map((d) => {
    const x = d.detail ?? {};
    const m = byTg.get(Number(d.tg_id));
    const st = String(x.commission_status ?? 'pending');
    return {
      id: d.id, tgId: Number(d.tg_id), memberNo: d.member_no ?? m?.member_no ?? null,
      who: m?.tg_username ? `@${m.tg_username}` : `#${d.member_no ?? m?.member_no ?? '?'}`,
      day: dayOf(String(x.deposited_at ?? d.created_at)),
      nature: String(x.nature ?? 'broker') === 'direct' ? 'direct' : 'broker',
      amount: Number(x.amount_usd ?? 0) || 0, com: Number(x.commission_usd ?? 0) || 0,
      status: st === 'received' ? 'received' : st === 'canceled' ? 'canceled' : 'pending',
      broker: String(x.broker ?? m?.broker ?? '') || '—',
      country: m?.country || 'Unknown',
      source: m?.source || 'Unknown',
      redeposit: x.redeposit === true,
    };
  });
  const costs: Cost[] = [
    // les retraits de parrainage sont payés par Mathieu (01/10/2026)
    ...payouts.filter((p) => p.status === 'paid').map((p) => ({ id: p.id, day: dayOf(p.decided_at ?? p.created_at), amount: Number(p.amount) || 0, kind: 'referral' as const, label: 'Referral payout', paidBy: 'mathieu' as Partner })),
    ...expenses.map((e) => ({ id: e.id, day: String(e.spent_on).slice(0, 10), amount: Number(e.amount_usd) || 0, kind: 'expense' as const, label: e.note ? `${e.category} · ${e.note}` : e.category, paidBy: (e.paid_by === 'mathieu' || e.paid_by === 'benjamin' ? e.paid_by : null) as Partner | null })),
  ];
  return { deps: out, costs };
}

export interface Totals {
  accounts: number; deposited: number; earned: number; cash: number; pending: number; lost: number;
  brokerCom: number; direct: number; directCount: number; referral: number; expenses: number; net: number;
}
const inRange = (day: string, from: string, to: string) => day >= from && day <= to;

export function totals(deps: Dep[], costs: Cost[], from: string, to: string): Totals {
  const t: Totals = { accounts: 0, deposited: 0, earned: 0, cash: 0, pending: 0, lost: 0, brokerCom: 0, direct: 0, directCount: 0, referral: 0, expenses: 0, net: 0 };
  for (const d of deps) {
    if (!inRange(d.day, from, to)) continue;
    if (d.nature === 'direct') { t.direct += d.com; t.directCount += 1; t.earned += d.com; t.cash += d.com; continue; }
    if (!d.redeposit) t.accounts += 1;
    t.deposited += d.amount;
    if (d.status === 'canceled') { t.lost += d.com; continue; }
    t.brokerCom += d.com; t.earned += d.com;
    if (d.status === 'received') t.cash += d.com; else t.pending += d.com;
  }
  for (const c of costs) {
    if (!inRange(c.day, from, to)) continue;
    if (c.kind === 'referral') t.referral += c.amount; else t.expenses += c.amount;
  }
  t.net = t.earned - t.referral - t.expenses;
  return t;
}

export interface DayPoint { day: string; earned: number; deposited: number; accounts: number; costs: number }
export function series(deps: Dep[], costs: Cost[], from: string, to: string): DayPoint[] {
  const n = Math.max(1, Math.min(400, daysBetween(from, to)));
  const pts = new Map<string, DayPoint>();
  for (let i = 0; i < n; i++) { const day = addDays(from, i); pts.set(day, { day, earned: 0, deposited: 0, accounts: 0, costs: 0 }); }
  for (const d of deps) {
    const p = pts.get(d.day); if (!p) continue;
    if (d.nature === 'direct') { p.earned += d.com; continue; }
    p.deposited += d.amount; if (!d.redeposit) p.accounts += 1;
    if (d.status !== 'canceled') p.earned += d.com;
  }
  for (const c of costs) { const p = pts.get(c.day); if (p) p.costs += c.amount; }
  return [...pts.values()];
}

export interface GroupRow { key: string; accounts: number; deposited: number; earned: number; avgDeposit: number }
/** Répartition par pays / broker / source, triée par gagné. Les accès directs comptent dans « gagné » de leur pays/source. */
export function breakdown(deps: Dep[], from: string, to: string, by: 'country' | 'broker' | 'source'): GroupRow[] {
  const g = new Map<string, GroupRow & { deps: number }>();
  for (const d of deps) {
    if (!inRange(d.day, from, to)) continue;
    const key = by === 'broker' ? (d.nature === 'direct' ? 'Direct access' : d.broker.toUpperCase()) : d[by];
    const r = g.get(key) ?? { key, accounts: 0, deposited: 0, earned: 0, avgDeposit: 0, deps: 0 };
    if (d.nature === 'direct') r.earned += d.com;
    else {
      r.deposited += d.amount; r.deps += 1;
      if (!d.redeposit) r.accounts += 1;
      if (d.status !== 'canceled') r.earned += d.com;
    }
    g.set(key, r);
  }
  return [...g.values()].map(({ deps: n, ...r }) => ({ ...r, avgDeposit: n ? r.deposited / n : 0 })).sort((a, b) => b.earned - a.earned || b.deposited - a.deposited);
}

/** Variation en % (null si la période de comparaison est à zéro). */
export const delta = (cur: number, prev: number): number | null => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);

// ── PARTAGE ENTRE ASSOCIÉS (01/10/2026) ─────────────────────────────────────────────────────────────────
// Mathieu 60 %, Benjamin 40 %, sur le bénéfice RÉELLEMENT encaissé. Toutes les recettes (commissions broker
// reçues, accès directs) arrivent sur le compte de Benjamin ; chacun paie des dépenses de son côté (le
// parrainage, c'est Mathieu). Règle de Mathieu : « je paie 60 % de ses dépenses, il paie 40 % des miennes ;
// je reçois 60 % des com, il en reçoit 40 % ». Algébriquement :
//   Benjamin doit à Mathieu = 60 % × encaissé − 60 % × dépenses payées par Benjamin + 40 % × dépenses payées par Mathieu
// (négatif = c'est Mathieu qui doit à Benjamin). Une dépense sans payeur est EXCLUE et signalée : la
// compter chez l'un ou l'autre au hasard fausserait le virement.
export const PARTNERS: Record<Partner, { label: string; share: number }> = {
  mathieu: { label: 'Mathieu', share: 0.6 },
  benjamin: { label: 'Benjamin', share: 0.4 },
};
export const INCOME_HOLDER: Partner = 'benjamin';

export interface Split {
  cashed: number; paidMathieu: number; paidBenjamin: number; unassigned: number; unassignedCount: number;
  net: number; mathieuNet: number; benjaminNet: number; benjaminOwesMathieu: number;
}
export function split(deps: Dep[], costs: Cost[], from: string, to: string): Split {
  const t = totals(deps, costs, from, to);
  let paidMathieu = 0, paidBenjamin = 0, unassigned = 0, unassignedCount = 0;
  for (const c of costs) {
    if (!inRange(c.day, from, to)) continue;
    if (c.paidBy === 'mathieu') paidMathieu += c.amount;
    else if (c.paidBy === 'benjamin') paidBenjamin += c.amount;
    else { unassigned += c.amount; unassignedCount += 1; }
  }
  const cashed = t.cash;
  const net = cashed - paidMathieu - paidBenjamin;
  const m = PARTNERS.mathieu.share, b = PARTNERS.benjamin.share;
  return {
    cashed, paidMathieu, paidBenjamin, unassigned, unassignedCount, net,
    mathieuNet: m * net, benjaminNet: b * net,
    benjaminOwesMathieu: m * cashed - m * paidBenjamin + b * paidMathieu,
  };
}
