// La mise en page commune des pages légales (app/terms, app/privacy, app/risk).
import { LEGAL } from '@/lib/legal';
import { LegalLinks } from './LegalLinks';

export type Section = { title: string; body: Array<string | string[]> };

export function LegalPage({ title, intro, sections }: { title: string; intro: string; sections: Section[] }) {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 18px 60px', display: 'flex', flexDirection: 'column', gap: 18, color: 'var(--text)' }}>
      <a href="/" style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'none' }}>← Algoria</a>
      <h1 style={{ margin: 0, fontSize: 26 }}>{title}</h1>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>Last updated: {LEGAL.updated} · {LEGAL.company}</p>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: 'var(--muted)' }}>{intro}</p>
      {sections.map((s) => (
        <section key={s.title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: '8px 0 0', fontSize: 17 }}>{s.title}</h2>
          {s.body.map((b, i) => Array.isArray(b)
            ? <ul key={i} style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.65, color: 'var(--muted)' }}>{b.map((li) => <li key={li}>{li}</li>)}</ul>
            : <p key={i} style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--muted)' }}>{b}</p>)}
        </section>
      ))}
      <LegalLinks style={{ marginTop: 24 }} />
    </main>
  );
}
