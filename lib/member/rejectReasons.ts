// MOTIFS DE REFUS D'UNE CONNEXION — liste fermée, côté admin ET côté membre (03/09/2026).
//
// Audit : 72 refus sur 155 demandes, avec 40 formulations libres différentes (« Invalid account. »,
// « Invalide credentials. », « Account not find. »…). Le membre recevait ce texte tel quel, en anglais
// approximatif, sans dire quoi corriger — et le formulaire se refermait derrière lui. Un motif codé
// permet trois choses : un texte propre dans la langue du membre, une consigne de correction précise, et
// des statistiques honnêtes sur POURQUOI on refuse (donc sur quoi améliorer dans le formulaire).
// Client-safe : des chaînes, rien d'autre.
import type { Locale } from './i18n';

export interface RejectReason {
  code: string;
  admin: string; // libellé court pour l'opérateur (français, comme le reste de l'admin)
  member: { en: string; it: string }; // ce que lit le membre, avec la correction attendue
}

export const REJECT_REASONS: RejectReason[] = [
  { code: 'wrong_credentials', admin: 'Identifiants MetaTrader invalides (login / mot de passe)', member: {
    en: 'We could not log in with these details. Check the MetaTrader account NUMBER (the digits shown at the top of MetaTrader) and its trading password — not your broker website login.',
    it: 'Non siamo riusciti ad accedere con questi dati. Controlla il NUMERO di conto MetaTrader (le cifre in alto in MetaTrader) e la password di trading — non il login del sito del broker.' } },
  { code: 'not_partner', admin: 'Compte pas sous le lien partenaire Algoria', member: {
    en: 'This account was not opened through the Algoria link, so the broker does not count it as ours. Open a new account with a partner broker through the link, or ask your broker to attach this account to Algoria.',
    it: 'Questo conto non è stato aperto tramite il link Algoria, quindi il broker non lo riconosce come nostro. Apri un nuovo conto con un broker partner tramite il link, oppure chiedi al tuo broker di collegare questo conto ad Algoria.' } },
  { code: 'not_attached', admin: 'Broker n’a pas encore rattaché le compte', member: {
    en: 'Your broker has not attached this account to Algoria yet. Send them the message again, and resubmit once they confirm.',
    it: 'Il tuo broker non ha ancora collegato questo conto ad Algoria. Rimanda il messaggio e reinvia la richiesta quando confermano.' } },
  { code: 'demo', admin: 'Compte démo', member: {
    en: 'This is a demo account. Algoria only copies live accounts with real funds — pick your live server and resubmit.',
    it: 'Questo è un conto demo. Algoria copia solo conti reali con fondi reali — scegli il tuo server reale e reinvia.' } },
  { code: 'no_deposit', admin: 'Aucun dépôt trouvé sur le compte', member: {
    en: 'No deposit found on this account yet. Fund it, then resubmit.',
    it: 'Nessun deposito trovato su questo conto. Deposita, poi reinvia.' } },
  { code: 'below_min', admin: 'Dépôt sous le minimum de la stratégie', member: {
    en: 'The deposit is below the minimum for the strategy you picked. Top up, or pick a strategy that matches your deposit.',
    it: 'Il deposito è sotto il minimo della strategia scelta. Ricarica, oppure scegli una strategia adatta al tuo deposito.' } },
  { code: 'wrong_name', admin: 'Nom du titulaire différent du compte', member: {
    en: 'The name on the broker account does not match what you entered. Enter the exact name on the account.',
    it: 'Il nome sul conto broker non corrisponde a quello inserito. Inserisci il nome esatto del conto.' } },
  { code: 'other', admin: 'Autre (texte libre)', member: { en: '', it: '' } },
];

export const rejectReasonOf = (code: string | null | undefined): RejectReason | undefined => REJECT_REASONS.find((r) => r.code === code);

/** Texte lu par le membre : le motif codé dans sa langue, sinon le texte libre de l'admin. */
export function rejectMessage(code: string | null | undefined, custom: string | null | undefined, locale: Locale): string {
  const r = rejectReasonOf(code);
  if (r && r.code !== 'other') return r.member[locale] || r.member.en;
  return (custom ?? '').trim() || (locale === 'it' ? 'verifica non riuscita' : 'verification failed');
}
