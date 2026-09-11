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
import { listOpenTickets, recordTradeOpen } from '../lib/supabase/sync';
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

  const pass = async () => {
    const positions = (terminal.positions ?? []) as Array<Record<string, unknown>>;
    if (!positions.length) return;
    const known = await listOpenTickets();
    const now = Date.now();
    for (const p of positions) {
      const ticket = String(p.id ?? '');
      if (!ticket || known.has(ticket) || written.has(ticket)) continue;
      const openedAt = p.time ? new Date(p.time as string).getTime() : now;
      if (now - openedAt < SETTLE_MS) continue; // trop frais : le stop n'est peut-être pas encore posé
      const brokerSymbol = String(p.symbol ?? '');
      const entry = Number(p.openPrice ?? 0);
      const lot = Number(p.volume ?? 0);
      if (!brokerSymbol || !entry || !lot) continue; // position incomplète : on repassera
      const direction = String(p.type ?? '').includes('SELL') ? 'short' : 'long';
      const sl = Number(p.stopLoss ?? 0);
      written.add(ticket);
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
  };

  const timer = setInterval(() => { void pass().catch((e) => console.error(`[algoria] ${label} : observation échouée:`, e)); }, EVERY_MS);
  console.log(`[algoria] ${label} : observateur démarré (toutes les ${EVERY_MS / 1000} s, tous symboles)`);
  return () => clearInterval(timer);
}
