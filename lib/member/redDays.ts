// JOURS ROUGES ET RATTRAPAGE (01/10/2026) — partagé client (écran « avant d'arrêter la copie ») et serveur
// (messages WIN-BACK de l'admin). Pur : aucune dépendance, aucun secret.
//
// Pourquoi : 6 des 10 déposants partis se sont déconnectés EUX-MÊMES, d'un tap, souvent un jour rouge
// (trois en dix minutes le 23/09, seul jour rouge de la semaine, effacé dès le lendemain). On leur montre
// les faits PASSÉS du track record au moment où ils décident — jamais une promesse sur la suite.
//
// Mesure : la courbe ramenée à 1 lot (`u` de /api/public/track), insensible aux dépôts et retraits du compte
// source. Un jour rouge est « rattrapé » quand le cumul repasse au-dessus de son niveau de la veille ; on
// compte en jours TRADÉS (les week-ends et les jours sans trade ne comptent pas).
export interface TrackDayLite { d: string; u?: number; net: number; n: number }

export interface RedDayStats {
  tradingDays: number;
  red: number;
  recovered: number;
  medianDays: number | null; // jours tradés pour rattraper, médiane
  maxDays: number | null; // le plus long rattrapage
  stillOpen: boolean; // le dernier jour rouge n'est pas encore rattrapé
}

const val = (d: TrackDayLite) => (typeof d.u === 'number' ? d.u : d.net);

/** Pour chaque jour rouge : combien de jours tradés avant que le cumul repasse au-dessus de la veille (null = pas encore). */
export function redDayRecoveries(days: TrackDayLite[]): Array<{ d: string; days: number | null }> {
  const traded = days.filter((x) => x.n > 0);
  const out: Array<{ d: string; days: number | null }> = [];
  let cum = 0;
  for (let i = 0; i < traded.length; i++) {
    const before = cum;
    cum += val(traded[i]);
    if (val(traded[i]) >= 0) continue;
    let c = cum, rec: number | null = null;
    for (let j = i + 1; j < traded.length; j++) {
      c += val(traded[j]);
      if (c >= before) { rec = j - i; break; }
    }
    out.push({ d: traded[i].d, days: rec });
  }
  return out;
}

export function redDayStats(days: TrackDayLite[]): RedDayStats {
  const rec = redDayRecoveries(days);
  const done = rec.filter((r) => r.days != null).map((r) => r.days as number).sort((a, b) => a - b);
  return {
    tradingDays: days.filter((x) => x.n > 0).length,
    red: rec.length,
    recovered: done.length,
    medianDays: done.length ? done[Math.floor(done.length / 2)] : null,
    maxDays: done.length ? done[done.length - 1] : null,
    stillOpen: rec.length > 0 && rec[rec.length - 1].days == null,
  };
}
