// DÉBUT DU TRACK RECORD PUBLIÉ — 1er juillet 2026, lancement d'Algoria (décision Mathieu, 24/09/2026).
//
// Le compte source existe depuis mars 2026 et toute son histoire est en base (source_deals). On ne publie
// que la période où Algoria existait : ni le canal ni l'app n'existaient avant. L'écran le DIT en toutes
// lettres — ces chiffres ne sont jamais présentés comme l'historique complet du compte.
export const SOURCE_TRACK_START = '2026-07-01';
export const SOURCE_TRACK_START_LABEL = 'July 2026';

// À PARTIR D'OCTOBRE 2026 : LE MASTER (décision Mathieu, 10/10/2026).
// Le compte source est celui qu'Algoria 2.0 copiait ; le master ne le suit plus depuis le 1er octobre (Mathieu),
// et les membres, eux, ont toujours copié le MASTER. Octobre l'a montré : −23,3 % au track record, à cause d'une seule journée du source (9 octobre,
// 18 ventes empilées, −102 874 $ à 1 lot) que le master n'a pas prise, alors que le master finit le mois à
// −306,84 $ swap compris (au centime près son MetaTrader 5). Juillet à septembre restent sur le compte source ;
// à partir de cette date, chaque jour est celui du master : ses trades copiés (table trades) et son vrai solde
// (state_snapshots). Pas de bandeau à l'écran (décision Mathieu, 10/10) : la bascule est de la plomberie interne.
export const MASTER_TRACK_FROM = '2026-10-01';
