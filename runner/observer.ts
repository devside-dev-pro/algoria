// OBSERVATEUR DE COPIE (11/09/2026) — enregistrer les positions que le runner n'a pas ouvertes lui-même.
//
// Ce qui a changé : le compte suivi par les membres ne génère plus ses propres signaux, il reçoit ses trades
// d'un copieur externe. Or tout le code d'enregistrement partait du principe inverse — l'ouverture était
// écrite au moment où le runner passait l'ordre, et le DealRecorder ignore explicitement les deals d'entrée
// « parce que l'ouverture est gérée par le runner ». Plus personne ne la gère.
//
// Conséquence sans ce module, et elle est visible côté client : aucune position ouverte dans l'app, et à la
// clôture une ligne « close-only » sans direction, sans prix d'entrée et sans lot. La carte de gain postée
// dans le VIP lit la direction pour dessiner sa flèche : sans ligne d'ouverture, elle affiche l'inverse.
//
// Ce module ne passe AUCUN ordre. Il regarde les positions du compte et écrit en base celles qu'il ne
// connaît pas. La clôture, elle, était déjà correctement captée par le DealRecorder.
import { listOpenTickets, recordTradeOpen, updateTradeStop } from '../lib/supabase/sync';
import { INSTRUMENTS } from '../lib/engine/instruments';

const EVERY_MS = 15_000;
// Un copieur peut mettre quelques secondes à poser le stop après l'ouverture. On laisse passer ce délai avant
// d'enregistrer, sinon on fige un SL nul en base et le cockpit dessine une position sans risque affiché.
const SETTLE_MS = 8_000;

/** Nom broker → label affiché dans l'app. Un symbole inconnu du registre garde son nom broker : mieux vaut
 *  « EURUSD.r » dans l'historique que rien du tout — la vérité brute plutôt qu'un trou. */
function displayOf(brokerSymbol: string): string {
  return INSTRUMENTS.find((i) => i.broker === brokerSymbol)?.display ?? brokerSymbol;
}

export interface ObserverDeps {
  terminal: { positions?: unknown[] };
  label?: string;
}

/** Démarre la boucle d'observation. Retourne la fonction d'arrêt (utile aux tests ; le runner ne s'arrête pas). */
export function startCopyObserver({ terminal, label = 'copie' }: ObserverDeps): () => void {
  // Mémoire de process : évite de réinterroger la base pour des tickets qu'on vient d'écrire. La base reste
  // la source de vérité (relue à chaque passage), ce cache ne fait qu'éviter des écritures en double dans la
  // même minute si deux passages se chevauchent.
  const written = new Set<string>();

  // ── LE STOP N'ÉTAIT LU QU'UNE FOIS (17/09/2026) ────────────────────────────────────────────────────
  // Jusqu'ici une position déjà connue était sautée sèchement (`known.has(ticket) → continue`) : son stop
  // était figé à la valeur vue 8 secondes après l'ouverture, pour toujours. Tant que le compte suivi n'était
  // qu'un suiveur de plus, ça n'avait pas d'importance — personne ne touchait à ces positions.
  //
  // Ce n'est plus vrai. Le compte master est maintenant piloté à la main : Mathieu y pose des stops et
  // resserre après coup. Ces stops sont RÉELS pour les membres (le copieur les propage), mais la base ne les
  // voyait pas : mesuré sur 7 jours avant correction, 95 des 111 trades copiés clôturés n'avaient aucun SL
  // enregistré, et le R n'était calculable sur AUCUN des 111.
  //
  // Une absence de stop à l'écran quand le stop existe est un mensonge par omission ; un stop affiché après
  // qu'il a été retiré en est un autre, dans l'autre sens. On suit donc la valeur du broker, dans les deux
  // sens, à chaque passage.
  //
  // Mémoire de process, pas de requête supplémentaire : on n'écrit QUE sur changement. Au redémarrage elle
  // est vide, donc le premier passage réaligne la base sur le broker pour chaque position ouverte — c'est
  // exactement le rattrapage qu'on veut, et il coûte une écriture par position, une fois.
  const lastSl = new Map<string, number>();
  const syncStop = async (ticket: string, sl: number) => {
    if (lastSl.get(ticket) === sl) return;
    const had = lastSl.has(ticket);
    lastSl.set(ticket, sl);
    await updateTradeStop(ticket, sl > 0 ? sl : null);
    if (had) console.log(`[algoria] ${label} : stop suivi · ticket ${ticket} → ${sl > 0 ? sl : 'retiré'}`);
  };

  const pass = async () => {
    const positions = (terminal.positions ?? []) as Array<Record<string, unknown>>;
    if (!positions.length) return;
    const known = await listOpenTickets();
    const now = Date.now();
    for (const p of positions) {
      const ticket = String(p.id ?? '');
      if (!ticket) continue;
      // Position déjà en base : rien à insérer, mais son stop a pu bouger depuis.
      if (known.has(ticket) || written.has(ticket)) { await syncStop(ticket, Number(p.stopLoss ?? 0)); continue; }
      const openedAt = p.time ? new Date(p.time as string).getTime() : now;
      if (now - openedAt < SETTLE_MS) continue; // trop frais : le stop n'est peut-être pas encore posé
      const brokerSymbol = String(p.symbol ?? '');
      const entry = Number(p.openPrice ?? 0);
      const lot = Number(p.volume ?? 0);
      if (!brokerSymbol || !entry || !lot) continue; // position incomplète : on repassera
      const direction = String(p.type ?? '').includes('SELL') ? 'short' : 'long';
      const sl = Number(p.stopLoss ?? 0);
      written.add(ticket);
      lastSl.set(ticket, sl); // point de départ du suivi : on ne réécrira qu'au prochain changement
      await recordTradeOpen({
        ticket,
        // Préfixe « copy- » VOLONTAIRE : les couches swing/tendance/zone reconnaissent LEURS positions par un
        // motif dans signal_ref (ILIKE '%-swing-%'…). Un trade copié ne doit ressembler à aucune d'elles,
        // sinon une couche réactivée un jour croirait avoir déjà une position ouverte et resterait muette.
        signalRef: `copy-${ticket}`,
        symbol: displayOf(brokerSymbol),
        direction,
        entry,
        lot,
        openedAt,
        ...(sl > 0 ? { sl } : {}),
      });
      console.log(`[algoria] ${label} : position copiée enregistrée · ${displayOf(brokerSymbol)} ${direction} ${lot} @ ${entry}${sl > 0 ? ` (SL ${sl})` : ' (sans stop)'} · ticket ${ticket}`);
    }
    // Une position refermée n'a plus à occuper le cache : sans ce nettoyage, un ticket réutilisé par le
    // broker après des mois ne serait jamais réenregistré.
    const liveTickets = new Set(positions.map((p) => String(p.id ?? '')));
    for (const t of written) if (!liveTickets.has(t)) written.delete(t);
    for (const t of lastSl.keys()) if (!liveTickets.has(t)) lastSl.delete(t);
  };

  const timer = setInterval(() => { void pass().catch((e) => console.error(`[algoria] ${label} : observation échouée:`, e)); }, EVERY_MS);
  console.log(`[algoria] ${label} : observateur démarré (toutes les ${EVERY_MS / 1000} s, tous symboles)`);
  return () => clearInterval(timer);
}
