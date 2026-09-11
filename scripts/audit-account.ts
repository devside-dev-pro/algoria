import 'dotenv/config';
// AUDIT D'UN COMPTE MT5 (11/09/2026) — la question à laquelle il faut répondre AVANT de brancher des membres
// dessus : est-ce que cette performance est reproductible, ou est-ce qu'elle est empruntée au hasard ?
//
// Pourquoi ce script existe : un compte affichant +100 % sur un an peut être excellent, ou être une
// martingale qui n'a pas encore rencontré sa mauvaise semaine. Les deux courbes se ressemblent jusqu'au jour
// où elles ne se ressemblent plus, et ce jour-là c'est l'argent des membres. Les cinq signaux qui séparent
// les deux sont ici, et ils se lisent tous depuis un accès EN LECTURE SEULE (mot de passe investisseur) :
//
//   1. Le creux maximum — combien le compte a perdu depuis un sommet, et combien de temps pour s'en remettre.
//   2. La couverture des stops — quelle part des sorties vient d'un stop. Une stratégie sans stop n'a pas de
//      perte maximale : elle a une perte différée.
//   3. La progression des lots après une perte — la signature d'une martingale. Si le lot médian après une
//      perte est nettement plus gros qu'après un gain, la stratégie se refait en augmentant la mise.
//   4. La concentration — quelle part du gain total vient des cinq meilleurs trades. Beaucoup = chance.
//   5. La durée réelle de l'historique — un an annoncé, trois mois en base, c'est une autre conversation.
//
// LECTURE SEULE : ce script n'appelle aucune méthode d'exécution. Il ne peut pas trader, même par erreur.
//
//   AUDIT_ACCOUNT_ID=<id MetaApi> npx tsx scripts/audit-account.ts          → 12 derniers mois
//   AUDIT_ACCOUNT_ID=<id MetaApi> npx tsx scripts/audit-account.ts 24       → 24 mois
//
// Le mot de passe investisseur ne passe jamais par ici : le compte est ajouté côté MetaApi, ce script ne
// connaît que son identifiant.
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';

const MetaApi: any = (MetaApiPkg as any).default ?? MetaApiPkg;

interface Deal {
  id?: string; type?: string; time?: string | Date; symbol?: string; volume?: number;
  profit?: number; commission?: number; swap?: number; entryType?: string; reason?: string;
  positionId?: string; price?: number;
}

const money = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)} %`;
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const dayOf = (d: Deal) => new Date(d.time as string).toISOString().slice(0, 10);
const monthOf = (d: Deal) => new Date(d.time as string).toISOString().slice(0, 7);
/** Le résultat NET d'une sortie : le brut ment dès qu'il y a de la commission ou du swap. */
const net = (d: Deal) => Number(d.profit ?? 0) + Number(d.commission ?? 0) + Number(d.swap ?? 0);

function section(title: string) {
  console.log(`\n\x1b[36m━━ ${title.toUpperCase()} ${'━'.repeat(Math.max(0, 58 - title.length))}\x1b[0m`);
}
function line(label: string, value: string, warn = false) {
  console.log(`  ${label.padEnd(38)} ${warn ? '\x1b[33m' : ''}${value}\x1b[0m`);
}

async function main() {
  const accountId = process.env.AUDIT_ACCOUNT_ID;
  if (!process.env.METAAPI_TOKEN || !accountId) {
    console.error('AUDIT_ACCOUNT_ID et METAAPI_TOKEN sont requis.');
    console.error('Le compte doit d\'abord être ajouté sur MetaApi (mot de passe investisseur suffit).');
    process.exit(2);
  }
  const months = Number(process.argv[2] ?? 12);
  const since = new Date(Date.now() - months * 30 * 86_400_000);

  const api = new MetaApi(process.env.METAAPI_TOKEN);
  const account = await api.metatraderAccountApi.getAccount(accountId);
  console.log(`compte ${account.name ?? accountId} · ${account.server ?? '?'} · connexion…`);
  await account.waitConnected();
  const conn = account.getRPCConnection();
  await conn.connect();
  await conn.waitSynchronized();

  const info = await conn.getAccountInformation();
  const positions = (await conn.getPositions()) as Array<{ symbol?: string; volume?: number; stopLoss?: number }>;
  const deals = ((await conn.getDealsByTimeRange(since, new Date())).deals ?? []) as Deal[];

  // Les sorties portent le résultat. Les lignes de solde (dépôts, retraits) ne sont pas des trades : elles
  // faussent tout si on les compte comme tels, et elles expliquent une partie de la courbe si on les ignore.
  const exits = deals.filter((d) => d.entryType === 'DEAL_ENTRY_OUT' || d.entryType === 'DEAL_ENTRY_INOUT')
    .sort((a, b) => +new Date(a.time as string) - +new Date(b.time as string));
  const cash = deals.filter((d) => d.type === 'DEAL_TYPE_BALANCE');
  const cashNet = cash.reduce((s, d) => s + Number(d.profit ?? 0), 0);

  if (!exits.length) { console.error('\nAucun trade clôturé sur la période. Rien à auditer.'); process.exit(1); }

  const pnl = exits.map(net);
  const total = pnl.reduce((a, b) => a + b, 0);
  const wins = pnl.filter((p) => p > 0);
  const losses = pnl.filter((p) => p < 0);
  const balance = Number(info.balance ?? 0);
  // Le solde de départ se déduit : solde actuel − ce que les trades ont produit − les mouvements d'espèces.
  const start = balance - total - cashNet;

  section('le compte');
  line('devise / levier', `${info.currency ?? '?'} · 1:${info.leverage ?? '?'}`);
  line('solde actuel', money(balance));
  line('solde estimé au début de la période', money(start));
  line('dépôts / retraits sur la période', cashNet === 0 ? 'aucun' : money(cashNet), cashNet !== 0);
  line('positions ouvertes maintenant', String(positions.length));

  section('la période réellement couverte');
  const first = new Date(exits[0].time as string), last = new Date(exits[exits.length - 1].time as string);
  const days = Math.max(1, Math.round((+last - +first) / 86_400_000));
  line('premier trade clôturé', first.toISOString().slice(0, 10));
  line('dernier trade clôturé', last.toISOString().slice(0, 10));
  line('durée de l\'historique', `${days} jours (${(days / 30).toFixed(1)} mois)`, days < 180);
  if (days < 180) console.log('  \x1b[33m⚠ moins de six mois : une seule saison de marché, pas une preuve.\x1b[0m');

  section('la performance');
  line('résultat net', `${money(total)} ${info.currency ?? ''}`);
  if (start > 0) line('rendement sur le solde de départ', pct((total / start) * 100));
  line('trades clôturés', String(exits.length));
  line('taux de réussite', `${((wins.length / exits.length) * 100).toFixed(1)} %`);
  const grossWin = wins.reduce((a, b) => a + b, 0), grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  line('facteur de profit', grossLoss ? (grossWin / grossLoss).toFixed(2) : '∞');
  line('gain moyen / perte moyenne', `${money(grossWin / (wins.length || 1))} / ${money(-grossLoss / (losses.length || 1))}`);
  line('meilleur trade / pire trade', `${money(Math.max(...pnl))} / ${money(Math.min(...pnl))}`);

  section('le risque — ce qui décide');
  // 1. CREUX MAXIMUM sur la courbe cumulée. C'est la question « combien j'aurais perdu au pire moment ».
  let cum = start, peak = start, maxDd = 0, maxDdPct = 0, peakAt = first, worstSpan = 0;
  for (const d of exits) {
    cum += net(d);
    if (cum > peak) { peak = cum; peakAt = new Date(d.time as string); }
    const dd = peak - cum;
    if (dd > maxDd) { maxDd = dd; maxDdPct = peak > 0 ? (dd / peak) * 100 : 0; }
    const span = (+new Date(d.time as string) - +peakAt) / 86_400_000;
    if (cum < peak && span > worstSpan) worstSpan = span;
  }
  line('creux maximum', `${money(maxDd)} (${maxDdPct.toFixed(1)} % du sommet)`, maxDdPct > 25);
  line('plus longue période sous un sommet', `${Math.round(worstSpan)} jours`, worstSpan > 60);

  // 2. COUVERTURE DES STOPS. Une stratégie dont presque aucune sortie n'est un stop n'a pas de perte bornée.
  const byReason = new Map<string, number>();
  for (const d of exits) byReason.set(d.reason ?? '?', (byReason.get(d.reason ?? '?') ?? 0) + 1);
  const slExits = byReason.get('DEAL_REASON_SL') ?? 0;
  const slShare = (slExits / exits.length) * 100;
  line('sorties par stop', `${slExits} sur ${exits.length} (${slShare.toFixed(1)} %)`, slShare < 5);
  line('détail des sorties', [...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r.replace('DEAL_REASON_', '')} ${n}`).join(' · '));
  const noSl = positions.filter((p) => !p.stopLoss).length;
  if (positions.length) line('positions ouvertes sans stop', `${noSl} sur ${positions.length}`, noSl > 0);
  if (slShare < 5) console.log('  \x1b[33m⚠ quasi aucune sortie au stop : la perte maximale d\'un trade n\'est pas bornée.\x1b[0m');

  // 3. MARTINGALE. Le lot après une perte contre le lot après un gain, et les séries croissantes.
  const afterLoss: number[] = [], afterWin: number[] = [];
  let run = 0, maxRun = 0;
  for (let i = 1; i < exits.length; i++) {
    const v = Number(exits[i].volume ?? 0);
    (net(exits[i - 1]) < 0 ? afterLoss : afterWin).push(v);
    if (net(exits[i - 1]) < 0 && v > Number(exits[i - 1].volume ?? 0)) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
  }
  const ml = median(afterLoss), mw = median(afterWin);
  const ratio = mw > 0 ? ml / mw : 0;
  line('lot médian après une perte', ml.toFixed(2));
  line('lot médian après un gain', mw.toFixed(2));
  line('rapport des deux', ratio ? `${ratio.toFixed(2)}×` : '—', ratio > 1.3);
  line('plus longue série de lots croissants après pertes', String(maxRun), maxRun >= 3);
  if (ratio > 1.3 || maxRun >= 3) console.log('  \x1b[33m⚠ signature de martingale : la mise augmente après les pertes.\x1b[0m');

  // 4. CONCENTRATION. Si le gain tient à cinq trades, il tient à la chance.
  const top5 = [...pnl].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const share = total > 0 ? (top5 / total) * 100 : 0;
  line('part du gain venant des 5 meilleurs trades', total > 0 ? `${share.toFixed(0)} %` : '—', share > 50);

  // 5. LA PIRE JOURNÉE. Ce qu'un membre aurait vu sur son écran au pire moment.
  const byDay = new Map<string, number>();
  for (const d of exits) byDay.set(dayOf(d), (byDay.get(dayOf(d)) ?? 0) + net(d));
  const worstDay = [...byDay.entries()].sort((a, b) => a[1] - b[1])[0];
  line('pire journée', `${worstDay[0]} · ${money(worstDay[1])}`);
  line('jours tradés', String(byDay.size));

  section('mois par mois');
  const byMonth = new Map<string, number>();
  for (const d of exits) byMonth.set(monthOf(d), (byMonth.get(monthOf(d)) ?? 0) + net(d));
  for (const [m, v] of [...byMonth.entries()].sort()) {
    const bar = '█'.repeat(Math.min(30, Math.round(Math.abs(v) / Math.max(1, Math.max(...[...byMonth.values()].map(Math.abs))) * 30)));
    console.log(`  ${m}  ${money(v).padStart(12)}  ${v >= 0 ? '\x1b[32m' : '\x1b[31m'}${bar}\x1b[0m`);
  }
  const red = [...byMonth.values()].filter((v) => v < 0).length;
  line('mois perdants', `${red} sur ${byMonth.size}`);

  section('symboles');
  const bySym = new Map<string, { n: number; pnl: number }>();
  for (const d of exits) {
    const k = d.symbol ?? '?';
    const cur = bySym.get(k) ?? { n: 0, pnl: 0 };
    bySym.set(k, { n: cur.n + 1, pnl: cur.pnl + net(d) });
  }
  for (const [s, v] of [...bySym.entries()].sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 10)) {
    console.log(`  ${s.padEnd(12)} ${String(v.n).padStart(5)} trades  ${money(v.pnl).padStart(12)}`);
  }

  console.log('\n\x1b[2mLecture seule : aucun ordre n\'a été envoyé. Les chiffres sortent des deals du compte, pas d\'une page de vente.\x1b[0m\n');
  process.exit(0);
}

void main().catch((e) => { console.error('\naudit impossible :', e?.message ?? e); process.exit(1); });
