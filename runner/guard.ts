// 🛡️ LES GARDE-FOUS DU MASTER (22/10/2026, après la nuit du 21 au 22 — voir lib/member/incident.ts).
//
// Cette nuit-là, le copieur externe a ouvert 145 achats d'or en 81 minutes, 124 sans stop, jusqu'à 69 positions en
// même temps : 70 989 $ → 10 919 $ en 2 h 12. Rien chez nous ne pouvait l'arrêter. En mode copie, le runner observait
// sans jamais intervenir, et le plafond de perte du jour était même volontairement coupé depuis le 11/09 (voir le
// « CAP DUR » dans index.ts). Entre −5 % (00:18 UTC) et la clôture forcée du broker (01:01), 43 minutes ont passé sans
// que personne n'agisse.
//
// Trois règles, validées par Mathieu le 22/10, qui ne dépendent plus du copieur :
//   1. STOP DE SECOURS. Le trade part toujours tout de suite, au meilleur prix (Mathieu : « le trade est lancé vite
//      pour avoir le meilleur prix d'entrée et ensuite le SL est ajouté »). Une position encore SANS stop 2 minutes
//      après son ouverture reçoit un stop à 25 $ de son prix d'entrée sur l'or (2 % ailleurs) : plus large que les
//      stops habituels (pire perte avec stop avant la nuit : −2 393 $ à 1 lot, ≈ 24 $). Si le vrai stop arrive
//      ensuite, il remplace le nôtre. Position déjà au-delà de ce stop → fermée (le broker refuserait le stop).
//   2. 10 POSITIONS AU MAXIMUM (le record avant la nuit : 12). Au-delà, les plus récentes sont fermées aussitôt. Si le
//      copieur les rouvre en boucle (5 fermetures en 10 minutes), c'est la règle 3 qui prend le relais.
//   3. COUPURE À −5 % SUR LA JOURNÉE. L'équité comparée au solde du début de la journée (heure de Paris). Tout est
//      fermé, et toute nouvelle position est refermée aussitôt jusqu'à minuit (Paris). Le verrou survit à un
//      redémarrage (support_settings 'guard_lock' = la journée verrouillée ; 'off' le lève). La coupure d'urgence
//      (commande kill du cockpit) fait la même chose : en mode copie elle ne faisait jusqu'ici RIEN.
//      La perte doit TENIR 90 s (l'équité lue chez le broker fait des sauts d'une minute, surtout à la pause de 22 h
//      UTC) et ne compte que s'il y a des positions ouvertes. Attention : un retrait d'argent du master en cours de
//      journée fait baisser l'équité comme une perte.
//
// LES SEUILS SE RÈGLENT SANS REDÉPLOIEMENT : support_settings 'guard_config', JSON partiel relu chaque minute
// (ex. {"dayLossPct":0.15,"maxOpen":8}). Mesuré avant de les fixer, sur les 30 jours de trading du copieur
// (11/09 → 21/10) : il descendait souvent loin en latent avant de remonter (−24 % le 17/09, −30 % le 23/09). Une
// coupure à −5 % aurait arrêté 19 journées sur 30, dont 12 finies positives ; à −15 %, 6 (3 positives) ; à −25 %, 2.
// Le plafond de 10 positions, lui, n'aurait jamais mordu ces jours-là (10 au plus) — et c'est lui, avec le verrou
// « le copieur continue d'ouvrir », qui arrête une nuit comme celle du 22/10, quel que soit le seuil de coupure.
//
// Cette nuit-là, la règle 3 aurait coupé à 00:18 avec 35 positions ouvertes (≈ −3 500 $ au lieu de −60 000 $), et la
// règle 2 aurait refermé dès 00:00 la 11e position.
//
// Chaque intervention : une note dans le journal + une alerte à Mathieu (DM + push), au plus une par type toutes les
// 10 minutes. La décision est une fonction pure (planGuard, runner/guardPlan.ts), rejouable sur n'importe quelle nuit.
import { closePosition } from './metaapi/execution';
import { getSetting, setSetting, logNote, updateTradeStop } from '../lib/supabase/sync';
import { notifyOwner } from '../lib/member/notifyOwner';
import { tradingDayOf } from '../lib/display/tradingDay';
import { GUARD, planGuard, readGuardConfig, type GuardConfig, type GuardPos } from './guardPlan';

const describe = (c: GuardConfig) =>
  `stop de secours ${c.safetyGoldUsd} $ après ${Math.round(c.safetyAfterMs / 60_000)} min · ${c.maxOpen} positions max · coupure à −${Math.round(c.dayLossPct * 100)} % sur la journée (tenue ${Math.round(c.cutPersistMs / 1000)} s)`;

/** Position MetaApi → GuardPos (null si incomplète : on repassera). */
function toGuardPos(p: Record<string, unknown>, now: number): GuardPos | null {
  const id = String(p.id ?? '');
  const entry = Number(p.openPrice ?? 0);
  if (!id || !entry) return null;
  const price = Number(p.currentPrice ?? 0) || entry;
  return {
    id, symbol: String(p.symbol ?? ''), long: !String(p.type ?? '').includes('SELL'), entry, price,
    sl: Number(p.stopLoss ?? 0) || 0, tp: Number(p.takeProfit ?? 0) || 0,
    openedAt: p.time ? new Date(p.time as string).getTime() : now,
  };
}

export function startGuard({ stream, terminal, isKilled, label = 'garde-fous' }: { stream: any; terminal: any; isKilled: () => boolean; label?: string }): () => void {
  let anchor: { day: string; start: number } | null = null;
  let lockedDay: string | null = null;
  let lastLockRead = 0;
  let cfg: GuardConfig = GUARD;
  let cfgKey = '';
  let breachSince: number | null = null;
  const busy = new Map<string, number>(); // id → jusqu'à quand on attend le broker avant de redemander
  const slFails = new Map<string, number>();
  const excessCloses: number[] = [];
  const lastAlert = new Map<string, number>();

  const alert = async (tag: string, title: string, lines: string[]) => {
    void logNote(`🛡️ ${title}${lines.length ? ` · ${lines.join(' · ')}` : ''}`, 'veto');
    if (Date.now() - (lastAlert.get(tag) ?? 0) < 10 * 60_000) return;
    lastAlert.set(tag, Date.now());
    await notifyOwner({ title: `🛡️ ${title}`, lines, path: '/', tag: `guard-${tag}` }).catch(() => {});
  };

  const loadState = async (today: string, balance: number) => {
    if (!anchor || anchor.day !== today) {
      const saved = await getSetting('guard_day');
      let parsed: { day?: string; start?: number } | null = null;
      try { parsed = saved ? (JSON.parse(saved) as { day?: string; start?: number }) : null; } catch { parsed = null; }
      if (parsed?.day === today && Number(parsed.start) > 0) anchor = { day: today, start: Number(parsed.start) };
      else if (balance > 0) {
        anchor = { day: today, start: balance };
        void setSetting('guard_day', JSON.stringify(anchor));
        console.log(`[algoria] ${label} : nouvelle journée ${today}, solde de départ ${Math.round(balance)} $`);
      }
    }
    if (Date.now() - lastLockRead > 60_000) { // relu chaque minute : on peut lever le verrou et régler les seuils depuis la base
      const [v, c] = await Promise.all([getSetting('guard_lock'), getSetting('guard_config')]);
      if (v !== undefined) { lockedDay = v; lastLockRead = Date.now(); }
      if (c !== undefined) {
        cfg = readGuardConfig(c);
        const key = JSON.stringify(cfg);
        if (key !== cfgKey) { cfgKey = key; console.log(`[algoria] ${label} : ${describe(cfg)}`); }
      }
    }
  };

  const pass = async () => {
    const now = Date.now();
    const today = tradingDayOf(now);
    const info = (terminal.accountInformation ?? {}) as { balance?: number; equity?: number };
    const balance = Number(info.balance ?? 0);
    const equity = info.equity != null ? Number(info.equity) : null;
    await loadState(today, balance);
    const killed = isKilled();
    const positions = ((terminal.positions ?? []) as Array<Record<string, unknown>>).map((p) => toGuardPos(p, now)).filter((p): p is GuardPos => !!p);
    const plan = planGuard({ positions, now, equity, dayStart: anchor?.start ?? null, locked: killed || lockedDay === today, breachSince, cfg });
    breachSince = plan.breach ? (breachSince ?? now) : null;

    if (plan.trip) {
      lockedDay = today;
      void setSetting('guard_lock', today);
      breachSince = null;
      await alert('cut', `COUPURE −${Math.round(cfg.dayLossPct * 100)} % : tout est fermé, rien ne rouvre avant minuit (heure de Paris)`, [plan.trip, `${positions.length} position(s) fermée(s)`]);
    }
    for (const c of plan.close) {
      if ((busy.get(c.id) ?? 0) > now) continue;
      busy.set(c.id, now + 15_000);
      try {
        await closePosition(stream, c.id);
        console.log(`[algoria] ${label} : position ${c.id} fermée (${c.why})`);
        if (c.why.startsWith('more than')) {
          excessCloses.push(now);
          await alert('max', `Plus de ${cfg.maxOpen} positions ouvertes : position fermée`, [`ticket ${c.id}`]);
        } else if (c.why.startsWith('no stop')) {
          await alert('nostop', `Position sans stop, déjà au-delà de la distance de secours (${cfg.safetyGoldUsd} $ sur l'or) : fermée`, [`ticket ${c.id}`]);
        } else if (!plan.trip) {
          await alert('locked', killed ? 'Coupure d’urgence active : position refermée' : 'Journée verrouillée : position refermée', [`ticket ${c.id}`]);
        }
      } catch (e) {
        console.error(`[algoria] ${label} : fermeture ${c.id} échouée:`, (e as { message?: string })?.message ?? e);
      }
    }
    // le copieur continue d'ouvrir au-delà du plafond (ou rouvre ce qu'on ferme) : on verrouille la journée
    while (excessCloses.length && now - excessCloses[0] > cfg.loopWindowMs) excessCloses.shift();
    if (excessCloses.length >= cfg.loopCloses && lockedDay !== today) {
      lockedDay = today;
      void setSetting('guard_lock', today);
      excessCloses.length = 0;
      await alert('cut', `Le copieur continue d'ouvrir au-delà de ${cfg.maxOpen} positions : journée verrouillée, tout est fermé`, [`${cfg.loopCloses} positions refermées en ${cfg.loopWindowMs / 60_000} min`]);
    }
    for (const s of plan.stops) {
      if ((busy.get(s.id) ?? 0) > now) continue;
      busy.set(s.id, now + 15_000);
      try {
        await stream.modifyPosition(s.id, s.sl, s.tp > 0 ? s.tp : undefined);
        void updateTradeStop(s.id, s.sl);
        slFails.delete(s.id);
        console.log(`[algoria] ${label} : stop de secours posé · ticket ${s.id} → SL ${s.sl}`);
        await alert('safety', `Position sans stop depuis ${Math.round(cfg.safetyAfterMs / 60_000)} min : stop de secours posé`, [`ticket ${s.id} · SL ${s.sl}`]);
      } catch (e) {
        const n = (slFails.get(s.id) ?? 0) + 1;
        slFails.set(s.id, n);
        console.error(`[algoria] ${label} : stop de secours refusé (${n}/3) · ${s.id}:`, (e as { message?: string })?.message ?? e);
        if (n >= 3) { // le broker refuse le stop : on ne laisse pas une position sans protection
          slFails.delete(s.id);
          try { await closePosition(stream, s.id); await alert('nostop', 'Stop de secours refusé 3 fois : position fermée', [`ticket ${s.id}`]); } catch { /* repassera */ }
        }
      }
    }
    const live = new Set(positions.map((p) => p.id));
    for (const id of busy.keys()) if (!live.has(id)) busy.delete(id);
    for (const id of slFails.keys()) if (!live.has(id)) slFails.delete(id);
  };

  let running = false;
  const timer = setInterval(() => {
    if (running) return; // un passage lent (broker) ne doit pas se superposer au suivant
    running = true;
    void pass().catch((e) => console.error(`[algoria] ${label} : passage échoué:`, e)).finally(() => { running = false; });
  }, GUARD.everyMs);
  console.log(`[algoria] ${label} : ACTIFS · ${describe(GUARD)} (support_settings 'guard_config' pour régler)`);
  return () => clearInterval(timer);
}
