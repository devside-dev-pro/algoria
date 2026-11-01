// FEUILLE « DÉPÔTS À VÉRIFIER » (01/11/2026) — le format du Google Sheet « Dépôts Algoria » tenu pour la compta :
//   Name | ID Account | Broker | Date | Dépôt | Pays | Commission | Note | CPA
// UNE LIGNE PAR COMPTE BROKER, pas une ligne par saisie. Le registre (member_actions kind='deposit') garde,
// lui, chaque saisie : un membre qui repasse par GO LIVE (reconnexion, compte refusé puis revalidé) se voit
// redemander le montant, et une 2e ligne est écrite avec detail.redeposit=true et commission 0. Exportées
// telles quelles, ces lignes faisaient croire à la comptable à des dépôts en double.
//
// Règle :
//  - clé = (membre, broker) : UN dépôt valable par broker (décision Mathieu, 01/11/2026 — un membre qui se
//    déconnecte/reconnecte reçoit un nouveau numéro de compte, ce n'est pas un nouveau dépôt).
//  - même clé → UNE ligne : date, montant et numéro de compte du 1er dépôt (le compte = dernière connexion
//    validée chez ce broker avant le dépôt, +1 h de marge). Les saisies suivantes sont notées : « Ressaisi le
//    JJ/MM » (même compte) ou « Reconnecté, compte X » (autre numéro).
//  - la ligne appartient au mois comptable de ce 1er dépôt (booked_ym sinon sa date) : une ressaisie en
//    octobre d'un compte déjà déposé en septembre ne réapparaît pas en octobre.
//  - accès direct (nature='direct') : pas un dépôt broker → hors feuille.
// Commission et CPA restent VIDES : ils se constatent chez le broker le 1er du mois, la valeur en base n'est
// qu'une estimation. Dates en heure de Dubaï.

export type SheetDeposit = { id: string; tg_id: number; created_at: string; detail?: Record<string, unknown> | null };
export type SheetConnect = { tg_id: number; created_at: string; detail?: { broker?: string; login?: string } | null };
export type SheetRow = { name: string; account: string; broker: string; date: string; deposit: string; country: string; commission: string; note: string; cpa: boolean; sortKey: string };

export const SHEET_HEADER = ['Name', 'ID Account', 'Broker', 'Date', 'Dépôt', 'Pays', 'Commission', 'Note', 'CPA'];
const BROKER_LABEL: Record<string, string> = { raisefx: 'RaiseFX', vtmarkets: 'VT Markets', puprime: 'PU Prime', tradingsphere: 'TradingSphere', xlence: 'Xlence' };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const depAt = (d: SheetDeposit) => String(d.detail?.deposited_at ?? d.created_at);
const depMonth = (d: SheetDeposit) => String(d.detail?.booked_ym ?? depAt(d).slice(0, 7));
export const brokerLabel = (b: string) => BROKER_LABEL[b.toLowerCase()] ?? b;

/** JJ/MM/AAAA (ou JJ/MM) en heure de Dubaï. */
export function dubaiDate(iso: string, short = false): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return short ? `${p.day}/${p.month}` : `${p.day}/${p.month}/${p.year}`;
}

export function buildDepositSheet(input: {
  deposits: SheetDeposit[];
  connects: SheetConnect[];
  ym: string;
  nameOf: (tg: number) => string;
  countryOf: (tg: number) => string;
}): SheetRow[] {
  const conns = [...input.connects].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const accountAt = (tg: number, broker: string, at: string): string => {
    const lim = Date.parse(at) + 3_600_000;
    let hit = '';
    for (const c of conns) {
      if (Number(c.tg_id) !== Number(tg) || String(c.detail?.broker ?? '').toLowerCase() !== broker || !c.detail?.login) continue;
      if (Date.parse(c.created_at) <= lim) hit = String(c.detail.login);
      else if (!hit) hit = String(c.detail.login); // aucune connexion avant : la 1re après
    }
    return hit;
  };
  const groups = new Map<string, SheetDeposit[]>();
  const broker = [...input.deposits]
    .filter((d) => String(d.detail?.nature ?? 'broker') !== 'direct')
    .sort((a, b) => depAt(a).localeCompare(depAt(b)));
  for (const d of broker) {
    const b = String(d.detail?.broker ?? '').toLowerCase();
    const key = `${d.tg_id}|${b}`;
    const g = groups.get(key);
    if (g) g.push(d); else groups.set(key, [d]);
  }
  const rows: SheetRow[] = [];
  for (const [key, g] of groups) {
    const first = g[0];
    if (depMonth(first) !== input.ym) continue;
    const notes: string[] = [];
    const real = depAt(first).slice(0, 7);
    if (real !== input.ym) notes.push(`Reporté de ${MONTHS[Number(real.slice(5, 7)) - 1]}`);
    const b = key.split('|')[1];
    const acc = accountAt(first.tg_id, b, depAt(first));
    for (const x of g.slice(1)) {
      const a2 = accountAt(x.tg_id, b, depAt(x));
      notes.push(a2 && a2 !== acc ? `Reconnecté le ${dubaiDate(depAt(x), true)}, compte ${a2} (fusionné)` : `Ressaisi le ${dubaiDate(depAt(x), true)} (même compte, fusionné)`);
    }
    rows.push({
      name: input.nameOf(first.tg_id),
      account: acc,
      broker: brokerLabel(String(first.detail?.broker ?? '')),
      date: dubaiDate(depAt(first)),
      deposit: `${Number(first.detail?.amount_usd ?? 0)}$`,
      country: input.countryOf(first.tg_id),
      commission: '',
      note: notes.join(' · '),
      cpa: false,
      sortKey: depAt(first),
    });
  }
  return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

const cells = (r: SheetRow) => [r.name, r.account, r.broker, r.date, r.deposit, r.country, r.commission, r.note, r.cpa ? 'TRUE' : 'FALSE'];

/** CSV (BOM UTF-8, séparateur virgule) — s'importe tel quel dans Google Sheets. */
export function sheetCsv(rows: SheetRow[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return '\ufeff' + [SHEET_HEADER, ...rows.map(cells)].map((l) => l.map(esc).join(',')).join('\r\n');
}

/** TSV pour le presse-papiers : collé dans un onglet Google Sheets, chaque valeur tombe dans sa colonne. */
export function sheetTsv(rows: SheetRow[]): string {
  const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ');
  return [SHEET_HEADER, ...rows.map(cells)].map((l) => l.map(clean).join('\t')).join('\n');
}
