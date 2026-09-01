// Brokers partenaires (liens IB/affiliés ALGORIA — commission au dépôt ≥ 500$).
// RaiseFX en VEDETTE (le broker d'Algoria : mêmes spreads que le maître + meilleure commission),
// les autres en alternatives si le membre a déjà un compte ailleurs. Constantes client-safe (liens publics).
export interface Broker {
  key: string;
  name: string;
  url: string;
  featured?: boolean;
  note?: string;
  // Noms EXACTS des serveurs MT5 (au caractère près) — proposés en menu déroulant à la connexion.
  // Le copieur STH exige la chaîne EXACTE : « PuPrime Live6 » ≠ « PUPrime-Live 6 » → erreur, la copie ne démarre pas.
  // Relevés directement dans la liste serveur de STH/MT5 (screens Mathieu). SERVEURS LIVE UNIQUEMENT (pas de demo :
  // un membre doit être en réel). Serveur non listé → saisie libre en repli, donc jamais de blocage.
  servers?: string[];
  // Code bonus de dépôt négocié avec le broker (confirmé cumulable avec le lien IB). ARME DE CLOSING,
  // pas un banner : servi uniquement aux hésitants (popup onboarding sur signal d'hésitation, relances
  // bot J+6+, rappel admin BEST LINK). pct = % du dépôt offert EN CRÉDIT DE TRADING (pas du cash
  // retirable) — toujours formuler « double ta puissance de trading », jamais « double ton argent ».
  bonus?: { code: string; pct: number };
  // HORS PARTENAIRES (03/08) : aucun de nos brokers n'accepte les résidents américains. Ils paient donc
  // l'accès directement, et gardent le broker qu'ils ont déjà. Ce choix n'apparaît PAS à l'étape « ouvre
  // ton compte » (on n'a pas de lien à leur donner) — uniquement dans le menu de connexion, où il ouvre
  // une saisie libre du nom du broker et du serveur. La connexion au copieur se fait à la main : le nom
  // exact du serveur MT ne s'invente pas, et une erreur de frappe côté membre bloquerait la copie.
  nonPartner?: boolean;
  // NUMÉRO D'AFFILIÉ ALGORIA chez ce broker — le `bta=` du lien de parrainage, confirmé par Mathieu le
  // 17/08 comme étant bien l'identifiant à citer. Il sert à UNE chose : le membre qui avait déjà un compte
  // chez ce broker doit demander LUI-MÊME au support de le rattacher à ce numéro. Personne d'autre ne peut
  // le faire — ni nous, ni le support sans la demande du titulaire — et sans rattachement le compte reste
  // invisible dans le dashboard partenaire, donc incommissionnable et impossible à valider.
  affiliateId?: string;
  // RETIRÉ DE LA BOUCLE (10/08/2026, décision Mathieu) : le partenariat s'arrête. Un broker retiré
  // DISPARAÎT de tout endroit où un client CHOISIT (étape « ouvre ton compte », menu broker de
  // l'onboarding, ajout d'un second compte, ordres de mise en avant) — plus aucun nouveau compte ne
  // peut s'ouvrir chez lui. Mais son entrée RESTE ICI, et c'est délibéré : la fiche d'un membre
  // résout son broker par cette liste (`BROKERS.find(b => b.key === r.broker)?.name`, admin:459).
  // Supprimer la ligne afficherait « ⚠ broker ? » sur les membres concernés, ferait perdre les noms
  // de serveurs MT5 qui valident leur connexion, et couperait le pré-remplissage de leur commission.
  // L'admin continue donc de le voir dans ses menus — le support doit pouvoir corriger une fiche.
  retired?: boolean;
}

export const BROKERS: Broker[] = [
  {
    key: 'raisefx',
    name: 'RaiseFX',
    url: 'https://partners.raisefx.com/visit/?bta=168726&brand=raisefx&afp=ALGORIA',
    featured: true,
    affiliateId: '168726',
    note: "Algoria's own broker — the exact same spreads as the AI you watch live.",
    servers: ['RaiseGlobal-Live'], // société "RaiseGlobal"
    bonus: { code: 'ALGORIA100', pct: 100 }, // 100% de bonus de dépôt — confirmé RaiseFX 27/07/2026
  },
  { key: 'vtmarkets', name: 'VT Markets', url: 'https://go.vtaffiliates.com/visit/?bta=35824&brand=vt', affiliateId: '35824', servers: ['VTMarkets-Live', 'VTMarkets-Live 2', 'VTMarkets-Live 3', 'VTMarkets-Live 5', 'VTMarkets-Live 6', 'VTMarkets-Live 7', 'VTMarkets-Live 8'] },
  // PU Prime — attention : « PUPrime-Live2 » (sans espace) ET « PUPrime-Live 2 » (avec espace) sont DEUX serveurs distincts.
  { key: 'puprime', name: 'PU Prime', url: 'https://go.puprime.partners/visit/?bta=35491&brand=pu&campaign=230205&afp=ALGORIA', affiliateId: '35491', servers: ['PUPrime-Live', 'PUPrime-Live 2', 'PUPrime-Live2', 'PUPrime-Live 4', 'PUPrime-Live 5', 'PUPrime-Live 6', 'PUPrime-Live 7'] },
  // FXCESS — RETIRÉ le 10/08/2026 : le broker arrête et s'auto-remplace par TradingSphere, sa seconde
  // société (déjà partenaire ci-dessous). Lien d'affiliation VIDÉ : même si un chemin oublié affichait
  // encore la carte, il n'y aurait rien à cliquer. 5 membres étaient chez eux au moment du retrait
  // (2 live, 2 onboarding, 1 pending_copier) — leurs fiches continuent de fonctionner grâce à cette
  // entrée conservée, serveurs MT5 compris. Voir le champ `retired` pour le détail.
  { key: 'fxcess', name: 'FXCESS', url: '', retired: true, servers: ['FXCESS-Live01', 'FXCESS-Live02', 'FXCess-Live02'] },
  { key: 'tradingsphere', name: 'TradingSphere', url: 'https://go.tradingsphere.com/visit/?bta=35182&brand=tradingsphere&afp=ALGORIA', affiliateId: '35182', servers: ['TradingSphere-Real1'] },
  // XLENCE — nouveau partenaire (01/09/2026). Il PREND LA PLACE DE FXCESS, retiré le 10/08 : on repasse
  // donc à cinq brokers ouverts. Barème IDENTIQUE à TradingSphere (400/700/900/1800, confirmé sur leur
  // dashboard partenaire), ce qui en fait un second lien de tête sur les gros dépôts.
  //
  // ⚠️ AUCUN SERVEUR MT5 LISTÉ POUR L'INSTANT, ET C'EST VOLONTAIRE. Le champ `servers` exige la chaîne
  // EXACTE attendue par STH — une approximation ne provoque pas une erreur visible, elle provoque une
  // copie qui ne démarre jamais. Les noms n'ont pas encore été relevés sur la liste serveur MT5, donc on
  // ne devine pas : sans liste, l'écran de connexion bascule en SAISIE LIBRE (repli déjà prévu), le
  // membre tape ce que son terminal affiche, et rien n'est bloqué. À compléter dès que Mathieu a la
  // capture — c'est la seule chose qui manque sur ce broker.
  { key: 'xlence', name: 'Xlence', url: 'https://go.xlence.com/visit/?bta=35553&brand=xlence&afp=ALGORIA', affiliateId: '35553' },
  { key: 'other', name: 'Other broker (I already have one)', url: '', nonPartner: true },
];

/** Brokers PARTENAIRES OUVERTS — ceux chez qui un client peut encore ouvrir un compte aujourd'hui.
 *  Exclut les retirés : c'est CETTE liste qui alimente l'étape « ouvre ton compte » du tunnel. */
export const PARTNER_BROKERS = BROKERS.filter((b) => !b.nonPartner && !b.retired);

/** Options du menu « quel est ton broker ? ». Un broker retiré n'apparaît QUE s'il est déjà celui du
 *  membre — sinon sa fiche s'ouvrirait sur un menu vide et le moindre enregistrement effacerait son
 *  broker. Personne d'autre ne peut le sélectionner. */
export function selectableBrokers(currentKey?: string | null): Broker[] {
  return BROKERS.filter((b) => !b.retired || b.key === currentKey);
}
