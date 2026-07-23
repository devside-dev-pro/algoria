// Lien COURT partageable — algoria.tech/academy → renvoie vers app.algoria.tech/academy (l'académie publique).
// IMPORTANT : la cible DOIT être le sous-domaine app. — c'est LÀ que le login Telegram + les cookies de session
// vivent. Rediriger vers /member/academy sur le domaine nu casserait le « Continue with Telegram » du closing.
// C'est ce lien que Mathieu donne en DM/pub : zéro friction, la vidéo joue direct, et le CTA convertit.
import { redirect } from 'next/navigation';

export default function AcademyShortlink() {
  redirect('https://app.algoria.tech/academy');
}
