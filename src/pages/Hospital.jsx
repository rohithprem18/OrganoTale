import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ClipboardText, Handshake, Heartbeat, MagnifyingGlass, ShieldCheck } from '@phosphor-icons/react';
import { api } from '../api';
import { useResource, useAsync, Field, Notice, Loading, Empty, PageHeading, Status, Stats, ScoreBreakdown, FlagList, ConfirmButton, formValues, formatDate, formatDateTime, ageFrom } from '../components';
import { PRIORITIES } from '../../shared/options';

const capitalize = (value) => value[0].toUpperCase() + value.slice(1);

export function HospitalPortal() {
  const me = useResource('/hospital/me');
  if (me.loading) return <div className="page-container"><Loading /></div>;
  if (me.error) return <div className="page-container"><Notice>{me.error}</Notice></div>;
  const { hospital } = me.data;
  if (hospital.status !== 'verified') {
    return <div className="page-container workspace"><PageHeading eyebrow={`Hospital portal · ${hospital.city}, ${hospital.state}`} title={hospital.name} /><Empty title={hospital.status === 'pending' ? 'Awaiting verification' : 'Account suspended'}>{hospital.status === 'pending' ? 'An administrator is reviewing your hospital registration. Once it is verified you can review patient requests and propose matches.' : 'This hospital cannot review requests or propose matches right now. Contact an administrator.'}</Empty></div>;
  }
  return <VerifiedPortal hospital={hospital} />;
}

function VerifiedPortal({ hospital }) {
  const [tab, setTab] = useState('requests');
  const requests = useResource('/hospital/requests'); const matches = useResource('/hospital/matches');
  const rows = requests.data || []; const matchRows = matches.data || [];
  return <div className="page-container workspace">
    <PageHeading eyebrow={`Hospital portal · ${hospital.city}, ${hospital.state}`} title={hospital.name}>Verify your patients’ requests, review ranked donors, and manage matches.</PageHeading>
    <Notice>{requests.error || matches.error}</Notice>
    <Stats items={[['Awaiting verification', rows.filter((r) => r.status === 'open' && r.verification === 'pending').length, ClipboardText], ['Verified open requests', rows.filter((r) => r.status === 'open' && r.verification === 'verified').length, ShieldCheck], ['Proposed matches', matchRows.filter((m) => m.status === 'proposed').length, Handshake], ['Confirmed matches', matchRows.filter((m) => m.status === 'confirmed').length, Heartbeat]]} />
    <div className="admin-toolbar"><div className="tabs" role="group" aria-label="Hospital view">{[['requests', 'Patient requests'], ['matches', 'Matches'], ['registry', 'Donor registry']].map(([key, label]) => <button key={key} aria-pressed={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</div></div>
    {tab === 'requests' && (requests.loading ? <Loading /> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Patient request</th><th>Organ</th><th>Blood group</th><th>Patient age</th><th>Reported</th><th>Verification</th><th>Priority</th><th>Active matches</th><th>Action</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.first_name} {r.last_name}</strong><small>#{r.id} · {formatDate(r.created_at)}</small></td><td>{r.organ}</td><td><span className="blood-type">{r.blood_group}</span></td><td>{ageFrom(r.patient_dob)}</td><td><Status value={r.urgency} /></td><td><Status value={r.status === 'closed' ? 'closed' : r.verification} /></td><td>{r.priority ? <Status value={r.priority} /> : '—'}</td><td>{r.active_matches}</td><td><Link className="text-link" to={`/hospital/requests/${r.id}`}>Review <ArrowRight size={16} /></Link></td></tr>)}</tbody></table></div> : <Empty title="No patient requests yet">Requests appear here when members choose your hospital as the treating hospital.</Empty>)}
    {tab === 'matches' && <HospitalMatches resource={matches} />}
    {tab === 'registry' && <DonorRegistry />}
  </div>;
}

function HospitalMatches({ resource }) {
  if (resource.loading && !resource.data) return <Loading />;
  if (!resource.data?.length) return <Empty title="No matches yet">Propose a match from a verified request’s ranked donor list.</Empty>;
  return <div className="match-list">{resource.data.map((m) => <HospitalMatch key={m.id} match={m} onChange={resource.refresh} />)}</div>;
}
function HospitalMatch({ match, onChange }) {
  const action = useAsync(); const [declining, setDeclining] = useState(false);
  const decide = (body) => action.run(async () => { await api(`/hospital/matches/${match.id}`, { method: 'PATCH', body }); setDeclining(false); onChange(); });
  const donor = match.donor_first_name ? `${match.donor_first_name} ${match.donor_last_name}` : match.donor_label;
  return <article className="panel match-card">
    <div className="review-heading"><div><span className="eyebrow">Match #{match.id} · {formatDate(match.created_at)}</span><h3>{match.organ} for {match.requester_first_name} {match.requester_last_name}</h3><p>Donor: <strong>{donor}</strong> · {match.donor_type === 'living' ? 'Living' : 'Deceased'} · {match.donor_blood_group}{match.donor_email && <> · {match.donor_phone} · {match.donor_email}</>}</p></div><div className="status-stack"><Status value={match.status} /><Status value={match.donor_response} label={`Donor ${match.donor_response}`} /></div></div>
    <p className="muted">Priority score {match.score} · this patient ranked #{match.recipient_rank} for the donor{match.override_reason && <> · Override: {match.override_reason}</>}</p>
    {match.decision_reason && <p className="muted">Decision note: {match.decision_reason}</p>}
    {match.status === 'proposed' && (declining
      ? <form className="inline-actions" onSubmit={(event) => { event.preventDefault(); decide({ status: 'declined', reason: formValues(event.currentTarget).reason }); }}><Field label="Reason for declining" name="reason" minLength={5} wide /><button className="button small" disabled={action.busy}>Decline match</button><button type="button" className="text-button" onClick={() => setDeclining(false)}>Cancel</button></form>
      : <div className="inline-actions"><button className="button small" disabled={action.busy || match.donor_response !== 'accepted'} onClick={() => decide({ status: 'confirmed', reason: '' })}>Confirm after medical tests</button><button className="text-button danger" onClick={() => setDeclining(true)}>Decline</button>{match.donor_response === 'pending' && <span className="muted">Waiting for the donor to accept.</span>}</div>)}
    <details><summary>Decision history</summary><ul className="event-list">{match.events.map((event, i) => <li key={i}>{formatDateTime(event.created_at)} · {event.action.replaceAll('_', ' ')} · {event.actor}</li>)}</ul></details>
    <Notice>{action.error}</Notice>
  </article>;
}

function DonorRegistry() {
  const search = useAsync(); const [email, setEmail] = useState(''); const [results, setResults] = useState(null); const [message, setMessage] = useState('');
  const lookup = (value) => search.run(async () => { setResults(await api(`/hospital/donors?email=${encodeURIComponent(value)}`)); setEmail(value); });
  return <div className="panel"><h2>Report a deceased donor</h2><p>Find a registry pledge by the donor’s email. Report it available only after death has been certified and consent documented as the law requires. It then enters priority matching from your hospital’s location. Every search is recorded in the audit log.</p>
    <form className="inline-actions" onSubmit={(event) => { event.preventDefault(); setMessage(''); lookup(formValues(event.currentTarget).email); }}><Field label="Donor email" name="email" type="email" wide /><button className="button small" disabled={search.busy}><MagnifyingGlass size={16} /> Search</button></form>
    <Notice>{search.error}</Notice><Notice success>{message}</Notice>
    {results && (results.length ? <div className="table-wrap"><table><thead><tr><th>Pledge</th><th>Donor</th><th>Organ</th><th>Blood group</th><th>Age</th><th>Status</th><th>Action</th></tr></thead><tbody>{results.map((p) => <tr key={p.id}><td>#{p.id}</td><td>{p.first_name} {p.last_name}</td><td>{p.organ}</td><td>{p.blood_group}</td><td>{ageFrom(p.dob)}</td><td>{p.available_at ? `Reported by ${p.available_hospital_name}` : 'Registry'}</td><td>{p.available_at ? '—' : <ConfirmButton confirmLabel="Report available" busyLabel="Reporting…" description={`Report pledge #${p.id} (${p.organ}) as available at your hospital?`} onConfirm={async () => { await api(`/hospital/pledges/${p.id}/availability`, { method: 'POST', body: {} }); setMessage(`Pledge #${p.id} is now available for priority matching.`); await lookup(email); }}>Report available</ConfirmButton>}</td></tr>)}</tbody></table></div> : <Empty title="No active registry pledges">This email has no active deceased-donor pledges.</Empty>)}
  </div>;
}

export function HospitalRequest() {
  const { id } = useParams();
  const detail = useResource(`/hospital/requests/${id}`);
  const candidates = useResource(`/hospital/requests/${id}/candidates`);
  const [message, setMessage] = useState('');
  const refresh = (text = '') => { setMessage(text); detail.refresh(); candidates.refresh(); };
  if (detail.loading && !detail.data) return <div className="page-container"><Loading /></div>;
  if (detail.error) return <div className="page-container"><Notice>{detail.error}</Notice><Link className="text-link" to="/hospital">Back to hospital portal</Link></div>;
  const r = detail.data;
  const facts = [['Requester email', r.email], ['Patient blood group', r.blood_group], ['Patient age', ageFrom(r.patient_dob)], ['Quantity', r.quantity], ['Reported urgency', r.urgency === 'Not Emergency' ? 'Standard' : r.urgency], ['Phone', r.phone], ['Address', `${r.address} ${r.zip}`], ['Status', r.status], ['Verification', r.verification], ['Priority', r.priority ? capitalize(r.priority) : '—'], ['Clinical score', r.verification === 'verified' ? `${r.clinical_score} of 40` : '—'], ['On verified list since', r.verified_at ? formatDate(r.verified_at) : '—']];
  return <div className="page-container workspace">
    <Link className="back-link" to="/hospital"><ArrowLeft size={17} /> Back to hospital portal</Link>
    <PageHeading eyebrow={`Request #${r.id} · ${formatDate(r.created_at)}`} title={`${r.organ} for ${r.first_name} ${r.last_name}`}>Verify the request, then review donors ranked by priority.</PageHeading>
    <Notice success>{message}</Notice>
    <div className="portal-grid">
      <section className="panel"><h2>Patient request</h2><dl className="detail-grid">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{r.note && <p className="request-note">{r.note}</p>}</section>
      <VerificationForm key={`${r.verification}-${r.priority}-${r.clinical_score}`} request={r} onSaved={refresh} />
    </div>
    <div className="section-heading compact"><div><span className="eyebrow">Priority matching</span><h2>Ranked donors</h2></div></div>
    <Candidates request={r} resource={candidates} onProposed={() => refresh('Match proposed. The donor will be asked to accept before you can confirm it in the Matches tab.')} />
    <p className="quiet-note">Rankings are suggestions based on the information supplied. Crossmatching, tissue typing, and eligibility are decided by the transplant team.</p>
  </div>;
}

function VerificationForm({ request, onSaved }) {
  const action = useAsync(); const [decision, setDecision] = useState(request.verification === 'rejected' ? 'rejected' : 'verified');
  if (request.status !== 'open') return <section className="panel"><h2>Verification</h2><p>This request is closed.</p></section>;
  return <section className="panel"><h2>{request.verification === 'verified' ? 'Update verification' : 'Verify this request'}</h2><p className="muted">Only verified requests enter priority matching. The priority and clinical score you set here drive the ranking.</p>
    <form onSubmit={(event) => { event.preventDefault(); const body = formValues(event.currentTarget); action.run(async () => { await api(`/hospital/requests/${request.id}/verification`, { method: 'PATCH', body }); onSaved(body.decision === 'verified' ? 'Request verified. It is now in priority matching.' : 'Request rejected. The requester can see your note.'); }); }}>
      <div className="fields"><Field label="Decision" name="decision" options={[{ value: 'verified', label: 'Verify' }, { value: 'rejected', label: 'Reject' }]} value={decision} onChange={(e) => setDecision(e.target.value)} />{decision === 'verified' && <><Field label="Medical priority" name="priority" options={PRIORITIES.map((p) => ({ value: p, label: capitalize(p) }))} defaultValue={request.priority || ''} /><Field label="Clinical score (0–40)" name="clinical_score" type="number" min={0} max={40} defaultValue={request.clinical_score ?? 0} /></>}<Field label={decision === 'rejected' ? 'Reason for rejection' : 'Hospital note'} name="note" multiline required={decision === 'rejected'} minLength={decision === 'rejected' ? 5 : undefined} defaultValue={request.hospital_note || ''} wide /></div>
      <p className="quiet-note">Clinical score is an organ-specific severity measure, such as MELD (6–40) for liver. Use 0 when none applies.</p>
      <Notice>{action.error}</Notice><div className="form-actions"><button className="button" disabled={action.busy}>{action.busy ? 'Saving…' : 'Save verification'}<ArrowRight size={18} /></button></div>
    </form></section>;
}

function Candidates({ request, resource, onProposed }) {
  if (resource.loading && !resource.data) return <Loading />;
  if (resource.error) return <Notice>{resource.error}</Notice>;
  const { candidates, notice } = resource.data;
  if (notice) return <Empty title="No ranking yet">{notice}</Empty>;
  if (!candidates.length) return <Empty title="No eligible donors right now">No active pledge passes the organ, blood group, age, and availability rules for this request. New pledges are ranked automatically.</Empty>;
  return <div className="candidate-list">{candidates.map((c, i) => <Candidate key={c.pledge_id} position={i + 1} candidate={c} request={request} onProposed={onProposed} />)}</div>;
}
function Candidate({ candidate: c, position, request, onProposed }) {
  const action = useAsync();
  return <article className="panel candidate"><div>
    <span className="eyebrow">#{position} · {c.donor_type === 'living' ? 'Living donor' : 'Deceased donor'} · pledged {formatDate(c.pledged_at)}</span>
    <h3>{c.donor_label}</h3>
    <div className="candidate-meta"><span>Blood group <strong>{c.blood_group}</strong> ({c.blood_match.replace('-', ' ')})</span><span>Age <strong>{c.age}</strong></span><span>{c.location}</span><span>BMI <strong>{c.bmi}</strong></span></div>
    <FlagList flags={c.flags} />
    <p className={`rank-note ${c.requires_override ? 'warn' : ''}`}>{c.requires_override ? `This patient ranks #${c.recipient_rank} of ${c.competing_recipients} eligible recipients for this donor. Proposing requires a recorded override reason.` : `This patient is the highest-priority eligible recipient for this donor (${c.competing_recipients} eligible in total).`}</p>
    <details><summary>Health screening</summary><dl className="health-details"><div><dt>Height / weight / BMI</dt><dd>{c.height} cm / {c.weight} kg / {c.bmi}</dd></div><div><dt>Last donation</dt><dd>{c.last_donation ? formatDate(c.last_donation) : 'Not supplied'}</dd></div><div><dt>Operations</dt><dd>{c.health.operation_type} — {c.health.operation_desc || 'No details'}</dd></div><div><dt>Disease history</dt><dd>{c.health.disease_type} — {c.health.disease_desc || 'No details'}</dd></div><div><dt>Accident history</dt><dd>{c.health.accident_type} — {c.health.accident_desc || 'No details'}</dd></div><div><dt>Pregnant / menstruating</dt><dd>{c.health.pregnant} / {c.health.menstruation}</dd></div></dl></details>
    <form onSubmit={(event) => { event.preventDefault(); const body = { request_id: request.id, pledge_id: c.pledge_id, override_reason: formValues(event.currentTarget).override_reason || '' }; action.run(async () => { await api('/hospital/matches', { method: 'POST', body }); onProposed(); }); }}>
      {c.requires_override && <div className="fields"><Field label="Override reason" name="override_reason" multiline minLength={20} wide placeholder="Why this patient should receive this donor ahead of higher-priority recipients" /></div>}
      <Notice>{action.error}</Notice><div className="inline-actions"><button className="button small" disabled={action.busy}>{action.busy ? 'Proposing…' : 'Propose match'}</button></div>
    </form>
  </div><ScoreBreakdown score={c.score} breakdown={c.breakdown} /></article>;
}
