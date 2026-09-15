import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, ClipboardText, Handshake, Heartbeat, Hourglass, IdentificationCard, MagnifyingGlass, ShieldCheck } from '@phosphor-icons/react';
import { api } from '../api';
import { useResource, useAsync, Field, Notice, Loading, Status, NextStep, Journey, requestJourney, ScoreBreakdown, FlagList, ConfirmButton, ReasonDialogButton, PrivateHint, AppHeader, StatStrip, Box, Tabs, InlineEmpty, formValues, formatDate, formatDateTime, ageFrom } from '../components';
import { PRIORITIES } from '../../shared/options';
import { MatchPdfButton } from '../ExportPdf';

const capitalize = (value) => value[0].toUpperCase() + value.slice(1);
const requestBadge = (r) => r.status === 'closed' ? 'closed' : r.verification === 'verified' ? r.priority : r.verification;

export function HospitalPortal() {
  const me = useResource('/hospital/me');
  if (!me.data) return me.error ? <Notice>{me.error}</Notice> : <Loading />;
  const { hospital } = me.data;
  if (hospital.status !== 'verified') {
    const pending = hospital.status === 'pending';
    return <div className="screen"><AppHeader title={hospital.name} subtitle={`${hospital.city}, ${hospital.state}`} /><NextStep calm icon={Hourglass} title={pending ? 'Awaiting verification by an administrator' : 'This hospital is suspended'} body={pending ? 'Once verified, you can review patient requests and propose matches. You’ll get a notification.' : 'You can’t review requests or propose matches right now. Contact an administrator.'} /></div>;
  }
  return <HospitalWorkspace hospital={hospital} />;
}

const VIEWS = { queue: 'Patient queue', matches: 'Matches', registry: 'Report a death' };
function HospitalWorkspace({ hospital }) {
  const [params, setParams] = useSearchParams();
  const view = VIEWS[params.get('tab')] ? params.get('tab') : 'queue';
  const requests = useResource('/hospital/requests');
  const matches = useResource('/hospital/matches');
  const rows = requests.data || [];
  const matchRows = matches.data || [];
  const pending = rows.filter((r) => r.status === 'open' && r.verification === 'pending');
  const readyToConfirm = matchRows.filter((m) => m.status === 'proposed' && m.donor_response === 'accepted');
  const selectedId = Number(params.get('request')) || (pending[0] || rows.find((r) => r.status === 'open') || rows[0])?.id || null;
  const select = (id) => setParams({ request: String(id) });
  const open = (tab) => setParams(tab === 'queue' ? {} : { tab });
  const refreshAll = () => { requests.refresh(); matches.refresh(); };
  return <div className="screen">
    <AppHeader title={VIEWS[view]} subtitle={`${hospital.name} · ${hospital.city}, ${hospital.state}`} />
    <Notice>{requests.error || matches.error}</Notice>
    {view !== 'registry' && <StatStrip items={[
      { label: 'Need verification', value: pending.length, icon: ClipboardText, onClick: pending.length ? () => select(pending[0].id) : undefined },
      { label: 'Verified open requests', value: rows.filter((r) => r.status === 'open' && r.verification === 'verified').length, icon: ShieldCheck },
      { label: 'Donor accepted, to confirm', value: readyToConfirm.length, icon: Handshake, onClick: () => open('matches') },
      { label: 'Confirmed matches', value: matchRows.filter((m) => m.status === 'confirmed').length, icon: Heartbeat, onClick: () => open('matches') },
    ]} />}
    {view === 'queue' && (!requests.data ? <Loading variant="cards" /> : !rows.length
      ? <Box><InlineEmpty icon={ClipboardText}>No patient requests yet. They appear when members choose {hospital.name} as the treating hospital.</InlineEmpty></Box>
      : <div className="screen-grid queue-layout grow"><RequestQueue rows={rows} selectedId={selectedId} onSelect={select} />{selectedId ? <RequestPane key={selectedId} id={selectedId} matches={matchRows} onChanged={refreshAll} /> : <Box><InlineEmpty>Select a request from the queue.</InlineEmpty></Box>}</div>)}
    {view === 'matches' && <MatchesBoard resource={matches} onChanged={refreshAll} />}
    {view === 'registry' && <ReportDeath hospital={hospital} />}
  </div>;
}

const QUEUE_FILTERS = [
  ['attention', 'To verify', (r) => r.status === 'open' && r.verification === 'pending'],
  ['verified', 'Verified', (r) => r.status === 'open' && r.verification === 'verified'],
  ['all', 'All', () => true],
];
function RequestQueue({ rows, selectedId, onSelect }) {
  const [filter, setFilter] = useState(() => rows.some(QUEUE_FILTERS[0][2]) ? 'attention' : rows.some(QUEUE_FILTERS[1][2]) ? 'verified' : 'all');
  const visible = rows.filter(QUEUE_FILTERS.find(([key]) => key === filter)[2]);
  return <Box scroll className="queue-box" head={<Tabs label="Filter requests" value={filter} onChange={setFilter} tabs={QUEUE_FILTERS.map(([key, label, test]) => [key, label, rows.filter(test).length])} />} bodyClass="flush">
    {visible.length ? <ul className="queue-list">{visible.map((r) => <li key={r.id}><button type="button" className={`queue-item ${r.id === selectedId ? 'selected' : ''}`} aria-current={r.id === selectedId ? 'true' : undefined} onClick={() => onSelect(r.id)}>
      <span className="row"><strong>{r.organ} · {r.blood_group}</strong><Status value={requestBadge(r)} /></span>
      <span className="row"><small>{r.first_name} {r.last_name} · age {ageFrom(r.patient_dob)}</small><small>#{r.id}</small></span>
      {r.active_matches > 0 && <small>{r.active_matches} active {r.active_matches === 1 ? 'match' : 'matches'}</small>}
    </button></li>)}</ul> : <InlineEmpty>No requests in this view.</InlineEmpty>}
  </Box>;
}

function RequestPane({ id, matches, onChanged }) {
  const detail = useResource(`/hospital/requests/${id}`);
  const candidates = useResource(`/hospital/requests/${id}/candidates`);
  const [tab, setTab] = useState(null);
  const refresh = () => { detail.refresh(); candidates.refresh(); onChanged(); };
  if (!detail.data) return <Box>{detail.error ? <Notice>{detail.error}</Notice> : <Loading />}</Box>;
  const r = detail.data;
  const related = matches.filter((m) => m.request_id === r.id);
  const open = r.status === 'open';
  // Start where the work is: verification first, then the ranked donors.
  const current = tab || (open && r.verification !== 'verified' ? 'verify' : open ? 'donors' : 'overview');
  const donorCount = candidates.data?.candidates?.length;
  const tabs = [['overview', 'Overview'], ...(open ? [['verify', r.verification === 'verified' ? 'Verification' : 'Verify']] : []), ['donors', 'Ranked donors', donorCount]];
  const facts = [['Requester email', r.email], ['Patient blood group', r.blood_group], ['Patient age', ageFrom(r.patient_dob)], ['Quantity', r.quantity], ['Reported urgency', r.urgency === 'Not Emergency' ? 'Standard' : r.urgency], ['Phone', r.phone], ['Address', `${r.address} ${r.zip}`], ['Priority', r.priority ? capitalize(r.priority) : '—'], ['Clinical score', r.verification === 'verified' ? `${r.clinical_score} of 40` : '—'], ['On verified list since', r.verified_at ? formatDate(r.verified_at) : '—']];
  return <section className="box scroll request-pane" aria-label={`${r.organ} request for ${r.first_name} ${r.last_name}`}>
    <div className="box-head"><div className="box-title"><h2>{r.organ} for {r.first_name} {r.last_name}</h2><small>Request #{r.id} · {formatDate(r.created_at)} · {r.blood_group} · age {ageFrom(r.patient_dob)}</small></div><Status value={requestBadge(r)} /></div>
    <div className="box-sub"><Journey compact steps={requestJourney(r, related)} /><Tabs label="Request sections" value={current} onChange={setTab} tabs={tabs} /></div>
    <div className="box-body">
      {current === 'overview' && <><dl className="detail-grid">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><PrivateHint>Patient details are visible only to your hospital, the requester, and administrators</PrivateHint>{r.note && <p className="request-note">{r.note}</p>}</>}
      {current === 'verify' && <VerificationForm key={`${r.verification}-${r.priority}-${r.clinical_score}`} request={r} onSaved={(decision) => { refresh(); if (decision === 'verified') setTab('donors'); }} />}
      {current === 'donors' && <><Candidates request={r} resource={candidates} onProposed={refresh} /><p className="quiet-note">Rankings are suggestions based on the information supplied. Crossmatching, tissue typing, and eligibility are decided by the transplant team.</p></>}
    </div>
  </section>;
}

function VerificationForm({ request, onSaved }) {
  const action = useAsync();
  const [decision, setDecision] = useState(request.verification === 'rejected' ? 'rejected' : 'verified');
  return <form onSubmit={(e) => { e.preventDefault(); const body = formValues(e.currentTarget); action.run(async () => { await api(`/hospital/requests/${request.id}/verification`, { method: 'PATCH', body }); onSaved(body.decision); }, { success: body.decision === 'verified' ? 'Request verified. The patient is now in priority matching.' : 'Request rejected. The requester has been notified.' }); }}>
    <p className="muted">Only verified requests enter priority matching. The priority and clinical score you set drive the ranking.</p>
    <div className="fields">
      <Field label="Decision" name="decision" options={[{ value: 'verified', label: 'Verify' }, { value: 'rejected', label: 'Reject' }]} value={decision} onChange={(e) => setDecision(e.target.value)} />
      {decision === 'verified' && <><Field label="Medical priority" name="priority" options={PRIORITIES.map((p) => ({ value: p, label: capitalize(p) }))} defaultValue={request.priority || ''} /><Field label="Clinical score (0–40)" name="clinical_score" type="number" min={0} max={40} defaultValue={request.clinical_score ?? 0} hint="Organ-specific severity, such as MELD (6–40) for liver. Use 0 when none applies." /></>}
      <Field label={decision === 'rejected' ? 'Reason for rejection' : 'Hospital note'} name="note" multiline required={decision === 'rejected'} minLength={decision === 'rejected' ? 5 : undefined} defaultValue={request.hospital_note || ''} wide />
    </div>
    <Notice>{action.error}</Notice>
    <div className="form-actions"><button className="button" disabled={action.busy}>{action.busy ? 'Saving…' : 'Save verification'}<ArrowRight size={18} /></button></div>
  </form>;
}

function Candidates({ request, resource, onProposed }) {
  if (!resource.data) return resource.error ? <Notice>{resource.error}</Notice> : <Loading variant="cards" />;
  const { candidates, notice } = resource.data;
  if (notice) return <InlineEmpty icon={ShieldCheck}>{notice}</InlineEmpty>;
  if (!candidates.length) return <InlineEmpty>No eligible donors right now. No active pledge passes the organ, blood group, age, and availability rules for this request. New pledges are ranked automatically.</InlineEmpty>;
  return <div className={`candidate-list ${resource.refreshing ? 'refreshing' : ''}`}>{candidates.length > 1 && <CompareDonors candidates={candidates} />}{candidates.map((c, i) => <Candidate key={c.pledge_id} position={i + 1} candidate={c} request={request} onProposed={onProposed} />)}</div>;
}
function CompareDonors({ candidates }) {
  const factor = (c, key) => c.breakdown.find((b) => b.factor === key)?.label || '—';
  return <section aria-label="Compare donors"><h3 className="mini-title">Compare the top donors</h3><div className="compare">{candidates.slice(0, 3).map((c, i) => <article key={c.pledge_id} className={`compare-card ${i === 0 ? 'best' : ''}`}>
    <div className="row"><h3>{c.donor_label}</h3>{i === 0 && <Status value="verified" label="Top ranked" />}</div>
    {[['Priority score', `${c.score} / 100`], ['Rank for this donor', `#${c.recipient_rank} of ${c.competing_recipients}`], ['Blood match', c.blood_match.replace('-', ' ')], ['Distance', factor(c, 'proximity')], ['Age / BMI', `${c.age} / ${c.bmi}`], ['Screening flags', c.flags.length], ['Donation', c.donor_type === 'living' ? 'Living' : 'After death']].map(([label, value]) => <div key={label} className="compare-row"><span>{label}</span><strong>{value}</strong></div>)}
  </article>)}</div></section>;
}
function Candidate({ candidate: c, position, request, onProposed }) {
  const action = useAsync();
  const rankNote = c.requires_override ? `This patient ranks #${c.recipient_rank} of ${c.competing_recipients} eligible recipients for this donor, so proposing requires a recorded override reason.` : `This patient is the highest-priority eligible recipient for this donor (${c.competing_recipients} eligible).`;
  return <article className="panel candidate"><div>
    <span className="eyebrow">#{position} · {c.donor_type === 'living' ? 'Living donor' : 'After-death donor'} · pledged {formatDate(c.pledged_at)}</span>
    <h3>{c.donor_label}</h3>
    <div className="candidate-meta"><span>Blood group <strong>{c.blood_group}</strong> ({c.blood_match.replace('-', ' ')})</span><span>Age <strong>{c.age}</strong></span><span>{c.location}</span><span>BMI <strong>{c.bmi}</strong></span></div>
    <FlagList flags={c.flags} />
    <p className={`rank-note ${c.requires_override ? 'warn' : ''}`}>{rankNote}</p>
    <details><summary>Health screening</summary><dl className="health-details"><div><dt>Height / weight / BMI</dt><dd>{c.height} cm / {c.weight} kg / {c.bmi}</dd></div><div><dt>Last donation</dt><dd>{c.last_donation ? formatDate(c.last_donation) : 'Not supplied'}</dd></div><div><dt>Operations</dt><dd>{c.health.operation_type} — {c.health.operation_desc || 'No details'}</dd></div><div><dt>Disease history</dt><dd>{c.health.disease_type} — {c.health.disease_desc || 'No details'}</dd></div><div><dt>Accident history</dt><dd>{c.health.accident_type} — {c.health.accident_desc || 'No details'}</dd></div><div><dt>Pregnant / menstruating</dt><dd>{c.health.pregnant} / {c.health.menstruation}</dd></div></dl></details>
    <form onSubmit={(e) => { e.preventDefault(); const body = { request_id: request.id, pledge_id: c.pledge_id, override_reason: formValues(e.currentTarget).override_reason || '' }; action.run(async () => { await api('/hospital/matches', { method: 'POST', body }); onProposed(); }, { success: c.donor_type === 'living' ? 'Match proposed. The donor has been notified.' : 'Match proposed. After-death consent is already recorded, so you can confirm it in Matches.' }); }}>
      {c.requires_override && <div className="fields one"><Field label="Override reason" name="override_reason" multiline minLength={20} wide placeholder="Why this patient should receive this donor ahead of higher-priority recipients" /></div>}
      <Notice>{action.error}</Notice>
      <div className="inline-actions"><button className="button small" disabled={action.busy}>{action.busy ? 'Proposing…' : 'Propose match'}</button></div>
    </form>
  </div><ScoreBreakdown score={c.score} breakdown={c.breakdown} /></article>;
}

const BOARD = [
  ['proposed', 'Proposed', (m) => m.status === 'proposed' && m.donor_response === 'pending'],
  ['accepted', 'Donor accepted', (m) => m.status === 'proposed' && m.donor_response === 'accepted'],
  ['confirmed', 'Confirmed', (m) => m.status === 'confirmed'],
  ['declined', 'Declined', (m) => m.status === 'declined'],
];
function MatchesBoard({ resource, onChanged }) {
  if (!resource.data) return <Loading variant="cards" />;
  if (!resource.data.length) return <Box><InlineEmpty icon={Handshake}>No matches yet. Propose one from a verified request’s ranked donors.</InlineEmpty></Box>;
  return <div className={`board grow ${resource.refreshing ? 'refreshing' : ''}`}>{BOARD.map(([key, label, test]) => {
    const items = resource.data.filter(test);
    return <section key={key} className="board-column" aria-label={label}><h3>{label} <span>{items.length}</span></h3>{items.length ? items.map((m) => <MatchCard key={m.id} match={m} resource={resource} onChanged={onChanged} />) : <p className="board-empty">Nothing here</p>}</section>;
  })}</div>;
}
function MatchCard({ match, resource, onChanged }) {
  const donor = match.donor_first_name ? `${match.donor_first_name} ${match.donor_last_name}` : match.donor_label;
  const decide = async (body) => { await resource.mutate((rows) => rows.map((m) => m.id === match.id ? { ...m, status: body.status, decision_reason: body.reason } : m), () => api(`/hospital/matches/${match.id}`, { method: 'PATCH', body })); onChanged(); };
  return <article className="board-card">
    <h4>{match.organ} · {match.requester_first_name} {match.requester_last_name}</h4>
    <p>Donor: <strong>{donor}</strong> ({match.donor_type === 'living' ? 'living' : 'after death'}, {match.donor_blood_group})</p>
    {match.donor_email && <PrivateHint>{match.donor_phone} · {match.donor_email}</PrivateHint>}
    <p className="muted">Score {match.score} · rank #{match.recipient_rank}{match.override_reason ? ' · override recorded' : ''}</p>
    {match.decision_reason && <p className="muted">Note: {match.decision_reason}</p>}
    {match.status === 'confirmed' && <div className="inline-actions"><MatchPdfButton id={match.id} compact /></div>}
    {match.status === 'proposed' && <div className="inline-actions">
      {match.donor_response === 'accepted'
        ? <ConfirmButton danger={false} className="button small" title={`Confirm match #${match.id}?`} description="Confirm only after crossmatching and medical tests are complete. The donor and requester will be notified." confirmLabel="Confirm match" success="Match confirmed." onConfirm={() => decide({ status: 'confirmed', reason: '' })}>Confirm after tests</ConfirmButton>
        : <span className="muted">Waiting for the donor</span>}
      <ReasonDialogButton title="Decline this match?" description="The donor and requester will be notified, and this pairing won’t be offered again." minLength={5} confirmLabel="Decline match" busyLabel="Declining…" success="Match declined." onSubmit={(reason) => decide({ status: 'declined', reason })}>Decline</ReasonDialogButton>
    </div>}
    <details><summary>Decision history</summary><ul className="event-list">{match.events.map((event, i) => <li key={i}>{formatDateTime(event.created_at)} · {event.action.replaceAll('_', ' ')} · {event.actor}</li>)}</ul></details>
  </article>;
}

const ORGAN_STATE = {
  ready: (o) => o.donor_type === 'living' ? 'Pledged for living donation · can be donated after death' : 'After-death pledge',
  available: (o) => `Available for matching${o.available_hospital_name ? ` at ${o.available_hospital_name}` : ''}`,
  matched: () => 'Already matched or donated',
};
function ReportDeath({ hospital }) {
  const search = useAsync();
  const [record, setRecord] = useState(null);
  const [version, setVersion] = useState(0);
  const lookup = (email) => search.run(async () => { setRecord(await api(`/hospital/deceased?email=${encodeURIComponent(email)}`)); setVersion((v) => v + 1); });
  return <div className="screen-grid side-form grow">
    <Box title="Find the donor" subtitle="Every search is recorded in the audit log">
      <form onSubmit={(e) => { e.preventDefault(); lookup(formValues(e.currentTarget).email); }}>
        <div className="fields one"><Field label="Donor email" name="email" type="email" autoComplete="off" /></div>
        <Notice>{search.error}</Notice>
        <div className="form-actions"><button className="button" disabled={search.busy}><MagnifyingGlass size={18} />{search.busy ? 'Searching…' : 'Find donor'}</button></div>
      </form>
      <ol className="how-steps">
        <li>Search for the registered donor by email.</li>
        <li>Choose the pledged organs to donate.</li>
        <li>Confirm the death certificate and consent. The organs enter priority matching from {hospital.name}.</li>
      </ol>
    </Box>
    {record ? <DeathReport key={version} record={record} hospital={hospital} onDone={() => lookup(record.donor.email)} />
      : <Box><InlineEmpty icon={IdentificationCard}>Search for a donor to see their pledged organs.</InlineEmpty></Box>}
  </div>;
}
function DeathReport({ record: { donor, organs }, hospital, onDone }) {
  const ready = organs.filter((o) => o.state === 'ready');
  const [chosen, setChosen] = useState(() => new Set(ready.map((o) => o.pledge_id)));
  const [certified, setCertified] = useState(false);
  const [consent, setConsent] = useState(false);
  const deceased = donor.donor_status === 'deceased';
  const name = `${donor.first_name} ${donor.last_name}`;
  const toggle = (id) => setChosen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const count = chosen.size;
  const organWord = count === 1 ? 'organ' : 'organs';
  const label = deceased ? `Donate ${count} ${organWord}` : `Mark deceased and donate ${count} ${organWord}`;
  const selected = organs.filter((o) => chosen.has(o.pledge_id)).map((o) => o.organ.toLowerCase()).join(', ');
  return <Box scroll title={name} subtitle={`${donor.email} · blood group ${donor.blood_group || '—'}${donor.dob ? ` · age ${ageFrom(donor.dob)}` : ''}`} actions={<Status value={deceased ? 'closed' : 'active'} label={deceased ? 'Deceased' : 'Alive'} />}>
    <h3 className="mini-title">Pledged organs</h3>
    {organs.length ? <ul className="organ-choices">{organs.map((o) => {
      const locked = o.state !== 'ready';
      return <li key={o.pledge_id}><label className={`organ-choice ${locked ? 'locked' : ''}`}><input type="checkbox" disabled={locked} checked={o.state === 'available' || chosen.has(o.pledge_id)} onChange={() => toggle(o.pledge_id)} /><span><strong>{o.organ}</strong><small>{ORGAN_STATE[o.state](o)}</small></span></label></li>;
    })}</ul> : <InlineEmpty>This donor has not pledged any organs, so there is nothing to donate.</InlineEmpty>}
    {ready.length > 0 ? <div className="decision-bar">
      <div className="confirm-checks">
        <label className="checkbox-label"><input type="checkbox" checked={certified} onChange={(e) => setCertified(e.target.checked)} /><span>Death has been certified as the law requires.</span></label>
        <label className="checkbox-label"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>Consent to donate the selected organs is documented.</span></label>
      </div>
      <p className="quiet-note">{deceased ? '' : 'The donor will be marked deceased and any living-donation matches closed. '}Selected organs enter priority matching from {hospital.name}, {hospital.city}. Organs you leave unticked are not donated.</p>
      {count > 0 && certified && consent
        ? <ConfirmButton className="button" title={deceased ? `Donate organs from ${name}?` : `Mark ${name} as deceased?`} description={`These organs will enter priority matching from ${hospital.name}: ${selected}. Continue only after death is certified and consent is documented.`} confirmLabel={label} busyLabel="Saving…" success={`${count} ${count === 1 ? 'organ is' : 'organs are'} now available for priority matching.`} onConfirm={async () => { await api('/hospital/deceased', { method: 'POST', body: { email: donor.email, pledge_ids: [...chosen], death_certified: true, consent_documented: true } }); onDone(); }}>{label}</ConfirmButton>
        : <button type="button" className="button" disabled>{count > 0 ? label : 'Choose at least one organ'}</button>}
    </div> : organs.length > 0 && <p className="quiet-note">Every pledged organ has already been made available or matched.</p>}
  </Box>;
}
