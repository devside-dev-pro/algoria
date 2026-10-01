// TÉMOIGNAGES RÉELS (01/10/2026) — des messages de membres envoyés au support de Mathieu, avec la capture
// MetaTrader qu'ils ont eux-mêmes partagée. Publiés avec leur accord (demandé par Mathieu aux VIP).
//
// Règles, pour qu'ils restent irréprochables :
//   · le texte est copié TEL QUEL (fautes et emojis compris) — rien n'est réécrit ni « amélioré » ;
//   · prénom + initiale seulement ; l'en-tête Telegram, les numéros de compte et les références de dépôt
//     sont coupés de la capture (public/testimonials, recadrées depuis les originaux) ;
//   · les pertes restent visibles quand elles y sont (Reece, premier jour) — c'est ce qui rend crédible ;
//   · résultats PASSÉS uniquement, avec le rappel que chacun est un cas individuel.
// Remplace les faux avis retirés de /download le 30/09.
export const TESTIMONIALS = [
  { name: 'Reece', when: '17 Sep 2026', lot: '0.05 lot', img: '/testimonials/reece.webp', text: 'Very happy with my first day can’t win every trade but profit is what matters. Incredible mate 👍🏻' },
  { name: 'Ajibade O.', when: '22 Sep 2026', lot: '0.05 lot', img: '/testimonials/ajibade.webp', text: 'Thank you Mathieu.. your algoria Ai is producing great results. Today is my first day with you and I am happy to be with you. We achieved good success today. Market was a bit crazy today but at the end I got unbelievable profits' },
  { name: 'M. Manzini', when: '25 Sep 2026', lot: '0.01 lot', img: '/testimonials/manzini.webp', text: 'When I checked 30min ago it was 510, now 518. Wow.' },
  { name: 'Peter B.', when: '24 Sep 2026', lot: '0.01 lot', img: '/testimonials/peter.webp', text: 'And it’s ONLY midday! Low wins but they soon accumulate! Climbing to £1000 then up my lot size slightly! ALGORIA TO THE MOON! 🚀💥' },
  { name: 'Rapheal', when: '18 Sep 2026', lot: '0.01 lot', img: '/testimonials/rapheal.webp', text: 'I have seen it God bless you abundantly I’m grateful' },
];

export function Testimonials({ title = 'What members say' }: { title?: string }) {
  return (
    <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
      <h2 style={{ fontSize: 12, letterSpacing: 1.6, color: 'var(--muted)', margin: '0 0 2px', textAlign: 'center', textTransform: 'uppercase' }}>{title}</h2>
      {/* image calée en BAS : c'est là que MetaTrader affiche le total (Reece : des pertes en haut, +129 $ au total en bas) */}
      <div className="deskscroll" style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '2px 2px 10px', scrollSnapType: 'x mandatory' }}>
        {TESTIMONIALS.map((t) => (
          <figure key={t.name} className="panel" style={{ flex: '0 0 248px', margin: 0, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, scrollSnapAlign: 'start' }}>
            <blockquote style={{ margin: 0, padding: '10px 12px', borderRadius: '4px 14px 14px 14px', background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.5, color: 'var(--text)' }}>
              {t.text}
            </blockquote>
            <figcaption style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
              <b style={{ color: 'var(--text)' }}>{t.name}</b>
              <span className="mono" style={{ color: 'var(--dim)' }}>{t.lot} · {t.when}</span>
            </figcaption>
            <img src={t.img} alt={`MetaTrader history shared by ${t.name}`} width={224} loading="lazy" decoding="async"
              style={{ width: '100%', height: 300, objectFit: 'cover', objectPosition: 'bottom', borderRadius: 10, border: '1px solid var(--border)', background: '#fff' }} />
          </figure>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--dim)', textAlign: 'center', lineHeight: 1.5 }}>
        Real messages and MetaTrader screenshots shared by members, published with their permission. Individual results vary,
        and past results do not guarantee future results. <a href="https://algoria.tech/track-record" style={{ color: 'var(--cyan)' }}>See every trade of the account →</a>
      </p>
    </section>
  );
}
