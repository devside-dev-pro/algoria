// TÉMOIGNAGES RÉELS (01/10/2026) — les captures des conversations Telegram de Mathieu avec les membres,
// telles quelles : leur message et la capture MetaTrader qu'ils ont envoyée. Publiés avec leur accord
// (confirmé par Mathieu le 01/10). Montrer la vraie conversation plutôt qu'une bulle retapée : c'est
// ce qui les rend vérifiables, et c'est ce qui les distingue des faux avis retirés de /download le 30/09.
//
// Règles, pour qu'ils restent irréprochables :
//   · capture d'origine, recadrée de l'en-tête de la conversation jusqu'au message — rien n'est réécrit ;
//   · seuls le nom de famille dans l'en-tête et la référence de dépôt (Rapheal) sont floutés
//     (public/testimonials, générées depuis les originaux) ;
//   · les pertes restent visibles quand elles y sont (Reece, premier jour) — c'est ce qui rend crédible ;
//   · résultats PASSÉS uniquement, avec le rappel que chacun est un cas individuel.
// `text` = le message copié tel quel, pour le texte alternatif de l'image (lecteurs d'écran, référencement).
export const TESTIMONIALS = [
  { name: 'Reece', when: '17 Sep 2026', lot: '0.05 lot', img: '/testimonials/reece.webp', text: 'Very happy with my first day can’t win every trade but profit is what matters. Incredible mate 👍🏻' },
  { name: 'Ajibade O.', when: '22 Sep 2026', lot: '0.05 lot', img: '/testimonials/ajibade.webp', text: 'Thank you Mathieu.. your algoria Ai is producing great results.\n\nToday is my first day with you and I am happy to be with you\nWe achieved good success today\n\nMarket was a bit crazy today but at the end I got unbelievable profits' },
  { name: 'M. Manzini', when: '25 Sep 2026', lot: '0.01 lot', img: '/testimonials/manzini.webp', text: 'When I checked 30min ago it was 510, now 518. Wow.' },
  { name: 'Peter B.', when: '24 Sep 2026', lot: '0.01 lot', img: '/testimonials/peter.webp', text: 'And it’s ONLY midday! Low wins but they soon accumulate! Climbing to £1000 then up my lot size slightly! ALGORIA TO THE MOON! 🚀💥' },
  { name: 'Rapheal', when: '18 Sep 2026', lot: '0.01 lot', img: '/testimonials/rapheal.webp', text: 'I have seen it God bless you abundantly I’m grateful' },
];

export function Testimonials({ title = 'What members say' }: { title?: string }) {
  return (
    <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
      <h2 style={{ fontSize: 12, letterSpacing: 1.6, color: 'var(--muted)', margin: '0 0 2px', textAlign: 'center', textTransform: 'uppercase' }}>{title}</h2>
      <div className="deskscroll" style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '2px 2px 10px', scrollSnapType: 'x mandatory', alignItems: 'flex-start' }}>
        {TESTIMONIALS.map((t) => (
          <figure key={t.name} className="panel" style={{ flex: '0 0 252px', margin: 0, padding: 8, display: 'flex', flexDirection: 'column', gap: 8, scrollSnapAlign: 'start' }}>
            <img src={t.img} alt={`Telegram conversation with ${t.name}: “${t.text}”`} width={236} loading="lazy" decoding="async"
              style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 10, border: '1px solid var(--border)', background: '#000' }} />
            <figcaption style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, padding: '0 4px 2px' }}>
              <b style={{ color: 'var(--text)' }}>{t.name}</b>
              <span className="mono" style={{ color: 'var(--dim)' }}>{t.lot} · {t.when}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--dim)', textAlign: 'center', lineHeight: 1.5 }}>
        Real Telegram conversations with members, shared with their permission (surnames blurred). Individual results vary,
        and past results do not guarantee future results. <a href="https://algoria.tech/track-record" style={{ color: 'var(--cyan)' }}>See every trade of the account →</a>
      </p>
    </section>
  );
}
