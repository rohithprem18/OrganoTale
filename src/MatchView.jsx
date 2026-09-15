import { Journey, Status, formatDateTime } from './components';

const EVENT_TEXT = { proposed: 'Match proposed', donor_accepted: 'Donor accepted', donor_declined: 'Donor declined', confirmed: 'Confirmed after medical tests', declined: 'Match declined' };

// One match on one screen: its status, the next action, the people involved, the score, and the history.
// Hospital staff and members share this layout; each passes only what they are allowed to see.
export function MatchLayout({ label, title, subtitle, stage, stageText, journey, next, cards, score, events = [] }) {
  return <section className="box scroll match-pane" aria-label={label}>
    <div className="box-head"><div className="box-title"><h2>{title}</h2><small>{subtitle}</small></div><Status value={stage} label={stageText} /></div>
    <div className="box-sub"><Journey compact steps={journey} /></div>
    <div className="box-body match-fit">
      <div className={`next-action ${next.tone || stage}`}><div><strong>{next.title}</strong>{next.body && <p>{next.body}</p>}</div>{next.actions && <div className="inline-actions">{next.actions}</div>}</div>
      <div className={`match-cards ${score ? 'with-score' : ''}`}>{cards}{score && <ScoreBars {...score} />}</div>
      {events.length > 0 && <MatchHistory events={events} />}
    </div>
  </section>;
}

export function MatchCard({ title, name, facts = [], children }) {
  return <section className="match-card" aria-label={title}>
    <h3 className="mini-title">{title}</h3>
    {name && <strong className="match-card-name">{name}</strong>}
    {facts.length > 0 && <dl className="match-facts">{facts.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>}
    {children}
  </section>;
}

export function ScoreBars({ score, rank, breakdown = [] }) {
  return <section className="match-card score-card" aria-label="Priority score">
    <div className="score-card-head"><h3 className="mini-title">Why this recipient</h3><span className="score-total"><strong>{score}</strong> / 100{rank ? ` · rank #${rank}` : ''}</span></div>
    <ul className="score-bars">{breakdown.map((item) => <li key={item.factor} title={`${item.label}: ${item.points} of ${item.max}`}>
      <span className="score-bars-label">{item.label}</span>
      <span className="score-bars-track" aria-hidden="true"><span style={{ width: `${item.max ? Math.round((item.points / item.max) * 100) : 0}%` }} /></span>
      <span className="score-bars-points">{item.points}/{item.max}</span>
    </li>)}</ul>
  </section>;
}

export function MatchHistory({ events }) {
  return <section className="match-history" aria-label="Decision history">
    <h3 className="mini-title">Decision history</h3>
    <ol>{events.map((event, i) => <li key={i}><strong>{EVENT_TEXT[event.action] || event.action.replaceAll('_', ' ')}</strong><small>{formatDateTime(event.at)} · {event.by}</small></li>)}</ol>
  </section>;
}
