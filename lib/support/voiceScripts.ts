// Liste des 19 vocaux du mode guidé (SUPPORT_VOICE_RECORDER).
// Les textes validés par Mathieu vivent hors dépôt : `script` reste vide tant qu'ils n'y sont pas.
// Un script vide → le bot n'affiche que la clé et le titre (lib/support/voiceRecorder.ts).
import { FAQ_KIND, FAQ_LABELS, FAQ_WAIT_LABEL, FAQ_WAIT_TOPIC, type FaqTopic } from '../member/faqVoice';

/** Où le code envoie déjà quelque chose de proche. `none` = ce vocal n'est branché nulle part. */
export type VoiceAutoSend = 'faq' | 'wait' | 'none';

export type VoiceScript = {
  /** 1..19, ordre d'enregistrement. */
  n: number;
  /** Clé du parcours (celle que Mathieu voit). */
  key: string;
  title: string;
  /** TODO : texte validé, hors dépôt. Vide = pas affiché. */
  script: string;
  /** kind écrit dans support_assets. Jamais welcome_video : un vocal n'est pas une bulle. */
  kind: typeof FAQ_KIND | 'script_voice';
  /** situation écrite dans support_assets. */
  situation: string;
  /** true = la ligne fixe FAQ_LINES part avec le vocal (pas pour l'attente n°19). */
  fixedLine: boolean;
  /** Envoi automatique actuel. `none` = enregistré, pas encore envoyé tout seul. */
  autoSend: VoiceAutoSend;
  /**
   * Concept déjà dans le code (texte ou bulle), s'il y en a un.
   * Le vocal n'utilise PAS ce kind : le relier enverrait le mauvais média.
   */
  relatesTo?: string;
};

const faq = (n: number, key: FaqTopic): VoiceScript => ({
  n, key, title: FAQ_LABELS[key], script: '', kind: FAQ_KIND, situation: key, fixedLine: true, autoSend: 'faq',
});

export const VOICE_SCRIPTS: readonly VoiceScript[] = [
  faq(1, 'faq_how_it_works'),
  faq(2, 'faq_broker'),
  faq(3, 'faq_deposit'),
  faq(4, 'faq_cost_free'),
  faq(5, 'faq_connect'),
  faq(6, 'faq_results_myfxbook'),
  faq(7, 'faq_gold_only'),
  faq(8, 'faq_withdraw_30d'),
  faq(9, 'faq_risk_lots'),
  faq(10, 'faq_kyc_raisefx'),
  // 11–18 : aucun vocal n'est envoyé aujourd'hui. Le plus proche est un texte ou une bulle vidéo.
  { n: 11, key: 'accueil_generique', title: 'Accueil générique', script: '', kind: 'script_voice', situation: 'accueil_generique', fixedLine: false, autoSend: 'none', relatesTo: 'welcome_video' },
  { n: 12, key: 'relance_avant_broker', title: 'Relance avant broker', script: '', kind: 'script_voice', situation: 'relance_avant_broker', fixedLine: false, autoSend: 'none', relatesTo: 'followup:0' },
  { n: 13, key: 'relance_already_have_account', title: 'Relance compte déjà ouvert', script: '', kind: 'script_voice', situation: 'relance_already_have_account', fixedLine: false, autoSend: 'none' },
  { n: 14, key: 'relance_apres_origine', title: 'Relance après l’origine', script: '', kind: 'script_voice', situation: 'relance_apres_origine', fixedLine: false, autoSend: 'none', relatesTo: 'followup:1' },
  { n: 15, key: 'pre_depot_rassurance', title: 'Réassurance avant dépôt', script: '', kind: 'script_voice', situation: 'pre_depot_rassurance', fixedLine: false, autoSend: 'none' },
  { n: 16, key: 'refus_no_deposit', title: 'Refus sans dépôt', script: '', kind: 'script_voice', situation: 'refus_no_deposit', fixedLine: false, autoSend: 'none', relatesTo: 'reject:no_deposit' },
  { n: 17, key: 'refus_not_partner', title: 'Refus pas partenaire', script: '', kind: 'script_voice', situation: 'refus_not_partner', fixedLine: false, autoSend: 'none', relatesTo: 'reject:not_partner' },
  { n: 18, key: 'refus_wrong_credentials', title: 'Refus mauvais identifiants', script: '', kind: 'script_voice', situation: 'refus_wrong_credentials', fixedLine: false, autoSend: 'none', relatesTo: 'reject:wrong_credentials' },
  // 19 : même modèle que le tag manuel (kind faq_voice, situation faq_attente_5h9h). Pas de ligne fixe.
  { n: 19, key: 'attente_5h9h', title: FAQ_WAIT_LABEL, script: '', kind: FAQ_KIND, situation: FAQ_WAIT_TOPIC, fixedLine: false, autoSend: 'wait' },
];

export const scriptByKey = (key: string): VoiceScript | undefined => VOICE_SCRIPTS.find((s) => s.key === key);

/** Prompt d'une étape. Script vide → clé + titre seulement, sans ligne blanche. */
export function scriptPrompt(s: VoiceScript, n: number, total: number): string {
  const lines = [`${n}/${total}`, s.key];
  if (s.situation !== s.key) lines.push(s.situation);
  lines.push(s.title);
  const body = s.script.trim();
  if (body) lines.push(body);
  return lines.join('\n');
}
