'use client';
// ANCIENNE ADRESSE DU DESK (retiré le 29/09/2026, décision Mathieu : des crédits Anthropic tous les jours
// pour un « HOLD » quotidien qui n'aidait personne). Les pushes déjà envoyés et les vieux liens pointent
// encore ici : on les emmène sur le track record réel, ce que le bouton central ouvre désormais.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LiveMoved() {
  const router = useRouter();
  useEffect(() => { router.replace('/member/track-record'); }, [router]);
  return null;
}
