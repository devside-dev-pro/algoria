// OUVERTURE TELEGRAM SANS FRICTION — un lien https://t.me affiche d'abord une page web avec un bouton
// « VIEW IN TELEGRAM » : un écran + un tap de perdus sur CHAQUE CTA du funnel. Le deep link tg:// ouvre
// l'app DIRECTEMENT (c'est exactement ce que fait ce bouton). Stratégie : on tente tg://, et si rien ne
// s'ouvre (Telegram absent) on retombe sur la page t.me après ~1,6 s — personne ne finit dans une impasse.

/** https://t.me/... → tg://... (null si le lien n'est pas convertible). */
export function tgDeepLink(url: string): string | null {
  const m = /^https?:\/\/t\.me\/(.+)$/i.exec(url);
  if (!m) return null;
  const path = m[1];
  const inv = /^(?:\+|joinchat\/)([\w-]+)/.exec(path); // canal/groupe privé : t.me/+HASH
  if (inv) return `tg://join?invite=${inv[1]}`;
  const res = /^([A-Za-z0-9_]{3,})(?:\?(.*))?$/.exec(path); // @username public (+ params, ex. ?start=… des bots)
  if (res) return `tg://resolve?domain=${res[1]}${res[2] ? `&${res[2]}` : ''}`;
  return null;
}

/** Ouvre Telegram en direct ; repli web automatique si l'app ne prend pas la main.
 *  fallbackNewTab : repli dans un NOUVEL onglet — indispensable quand la page doit rester vivante
 *  (ex. login : le polling attend la confirmation du bot). */
export function openTelegram(url: string, opts: { fallbackNewTab?: boolean } = {}): void {
  const deep = tgDeepLink(url);
  if (!deep) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  // si l'app s'ouvre, la page passe en arrière-plan → on annule le repli
  const fallback = window.setTimeout(() => {
    if (opts.fallbackNewTab) window.open(url, '_blank', 'noopener');
    else window.location.href = url;
  }, 1600);
  const cancel = () => {
    if (document.visibilityState === 'hidden') {
      window.clearTimeout(fallback);
      document.removeEventListener('visibilitychange', cancel);
    }
  };
  document.addEventListener('visibilitychange', cancel);
  window.location.href = deep;
}

/** Props prêtes à étaler sur un <a> : href t.me conservé (SEO, clic droit, desktop) + interception deep link. */
export function tgHref(url: string) {
  return {
    href: url,
    onClick: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      openTelegram(url);
    },
  };
}
