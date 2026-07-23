// Lien COURT partageable — algoria.tech/academy → l'académie (publique, sans login).
// C'est CE lien que Mathieu donne en DM/pub : zéro friction, la vidéo de closing joue direct.
import { redirect } from 'next/navigation';

export default function AcademyShortlink() {
  redirect('/member/academy');
}
