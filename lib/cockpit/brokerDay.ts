// « AUJOURD'HUI » = LE JOUR METATRADER (heure serveur broker, UTC+3 chez la plupart des brokers MT5 —
// la bougie daily clôture à 17h New York). Avant, chaque compteur utilisait minuit UTC : à 00h15 locale
// les « wins today » affichaient encore la veille et le bilan divergeait du terminal MT5.
// Réglable sans redeploy : NEXT_PUBLIC_MT5_UTC_OFFSET (défaut 3).
const OFFSET_H = Number(process.env.NEXT_PUBLIC_MT5_UTC_OFFSET ?? 3);

/** Timestamp (ms UTC) du début du jour COURANT côté serveur MT5. */
export function brokerDayStartMs(now: number = Date.now()): number {
  const shifted = new Date(now + OFFSET_H * 3_600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted.getTime() - OFFSET_H * 3_600_000;
}

/** Date du jour MT5 (AAAA-MM-JJ) auquel appartient cet instant — l'étiquette que porte une séance.
 *  Une séance qui commence à 21h00 UTC le 14 est la journée broker du 15 : c'est cette date-là qu'un
 *  humain appelle « la séance d'aujourd'hui », et donc celle qui doit figurer sur la carte partagée. */
export function brokerDateOf(ms: number): string {
  return new Date(ms + OFFSET_H * 3_600_000).toISOString().slice(0, 10);
}
