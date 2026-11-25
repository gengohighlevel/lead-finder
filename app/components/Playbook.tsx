import { PLAYBOOK } from '@/lib/playbook';
import { Icon } from './Icons';

const RULES = [
  'No tech words up front: no CRM, automation, AI or pipeline.',
  'Owner-to-owner tone. Problem before solution.',
  'If we have not verified a problem, ask it as a question.',
  'No invented stats, and no fake “clients I’ve worked with”.',
  'Cold messages stay under 65 words.',
];
const TOP5: [string, string][] = [
  ['followups', 'Quote-based trades: roofers, HVAC, builders, movers, landscapers'],
  ['booking', 'Dentists, clinics, physios, salons, med spas'],
  ['reactivation', 'Dental, gyms, salons, auto service, vets'],
  ['reviews', 'Any local business competing on Google'],
  ['lead_management', 'Real estate, law firms, med spas, home services'],
];

/** The copy rules the app follows when it writes outreach angles. Edit lib/playbook.ts to change them. */
export function Playbook() {
  return (
    <>
      <div className="grid-2">
        <section className="panel material" aria-labelledby="rules-h">
          <div className="panel-head"><h2 id="rules-h">Copy rules</h2><span className="hint">every angle follows these</span></div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {RULES.map(r => <li key={r} style={{ display: 'flex', gap: 9 }}><span className="tick"><Icon name="check" size={16} /></span>{r}</li>)}
          </ul>
        </section>
        <section className="panel material" aria-labelledby="top-h">
          <div className="panel-head"><h2 id="top-h">Best first pitch by business</h2><span className="hint">used when no gap decides it</span></div>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {TOP5.map(([id, who], i) => (
              <li key={id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span className="badge num" data-tone="accent">{i + 1}</span>
                <span><b>{PLAYBOOK[id].service.replace(/ System$/, '')}</b><span className="muted"> · {who}</span></span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="panel material" aria-labelledby="svc-h">
        <div className="panel-head"><h2 id="svc-h">The 10 services</h2><span className="hint">open one to see its questions</span></div>
        <div className="play-grid">
          {Object.values(PLAYBOOK).map(p => (
            <details className="fold inset" key={p.id}>
              <summary><Icon name="chevron" size={16} className="chev" />{p.service.replace(/ System$/, '')}</summary>
              <div className="fold-body">
                <dl className="kv">
                  <dt>Opening question</dt><dd className="quote inset">{p.question}</dd>
                  <dt>Hook</dt><dd className="quote inset">{p.hook}</dd>
                  <dt>What we offer</dt><dd style={{ paddingTop: 9 }}>{p.opportunity}.</dd>
                </dl>
              </div>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
