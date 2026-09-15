import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BellRinging, CalendarBlank, CheckCircle, ClipboardText, HandHeart, Handshake, Heartbeat, Hospital, Hourglass, MapPin, Plus, Sparkle, WarningCircle } from '@phosphor-icons/react';
import { api } from '../api';
import { useAuth, useResource, useAsync, useToast, useDraftSaver, readDraft, Field, Combobox, Wizard, ReviewList, Notice, Loading, FormShell, ButtonLink, Status, SearchBox, ConfirmButton, ReasonDialogButton, NextStep, Journey, requestJourney, matchJourney, DataTable, VerifiedBadge, PrivateHint, AppHeader, StatStrip, Box, Tabs, InlineEmpty, ListRow, formValues, formatDate } from '../components';
import { BLOOD_GROUPS, ORGANS, URGENCIES, LIVING_ORGANS } from '../../shared/options';
import { LocationFields } from '../LocationFields';

const today = () => new Date().toISOString().slice(0, 10);
const HEALTH_OPTIONS = ['Yes', 'No', 'Not applicable', 'Prefer not to say'];
const hospitalOption = (h) => ({ value: String(h.id), label: h.name, detail: `${h.city}, ${h.state} · Verified hospital` });
const donationLabel = (type) => type === 'deceased' ? 'After death' : 'Living';
const requestBadge = (r) => r.status === 'closed' ? 'closed' : r.verification === 'verified' ? r.priority : r.verification;

// ---------- Requests: stage wording ----------
const STAGE_TEXT = { Verified: 'Waiting for hospital verification', 'Donor proposed': 'In priority matching', 'Donor accepted': 'Waiting for the donor to accept', Confirmed: 'Medical tests next' };
function requestStage(request, matches) {
  const steps = requestJourney(request, matches);
  if (request.status === 'closed' && steps[4].state !== 'done') return 'Closed';
  if (steps.some((s) => s.state === 'failed')) return 'Could not be verified';
  const current = steps.find((s) => s.state === 'current');
  return current ? STAGE_TEXT[current.label] : 'Match confirmed';
}
function RequestCard({ request, matches, showJourney = false }) {
  const { user } = useAuth();
  const owner = request.user_id === user.id;
  const badge = requestBadge(request);
  return <article className="request-card">
    <div className="request-card-top"><span className="organ-icon"><Heartbeat size={22} /></span><Status value={badge} label={badge === 'pending' ? 'Awaiting hospital' : undefined} /></div>
    <div className="request-title"><h3>{request.organ}</h3><span className="blood-type">{request.blood_group}</span></div>
    <p className="request-person">Requested by {request.first_name} {request.last_name}</p>
    <div className="request-details"><span><Hospital size={16} />{request.hospital_name || 'No hospital selected'}</span>{request.hospital_status === 'verified' && <VerifiedBadge />}<span><MapPin size={16} />{request.hospital_city ? `${request.hospital_city}, ${request.hospital_state}` : request.address}</span><span><CalendarBlank size={16} />{formatDate(request.created_at)}</span></div>
    {showJourney && <Journey compact steps={requestJourney(request, matches)} />}
    <div className="request-bottom"><span>Quantity <strong>{request.quantity}</strong></span>{owner || user.role === 'admin' ? <Link className="text-link" to={`/requests/${request.id}`}>Open <ArrowUpRight size={17} /></Link> : <Link className="text-link" to={`/pledge?organ=${encodeURIComponent(request.organ)}`}>Pledge to donate <ArrowUpRight size={17} /></Link>}</div>
  </article>;
}

// ---------- Matches: wording and donor response ----------
const DONOR_HEADLINES = { proposed: 'A hospital has proposed you as a donor for a patient.', accepted: 'You accepted. The hospital will contact you to arrange medical tests.', confirmed: 'Your match is confirmed by the hospital.', declined: 'This match did not go ahead.' };
const REQUESTER_HEADLINES = { proposed: 'A compatible donor has been proposed for your request.', accepted: 'The donor accepted. The hospital is arranging medical tests.', confirmed: 'The hospital has confirmed a donor match for your request.', declined: 'A proposed match did not go ahead.' };
const matchPhase = (m) => m.status === 'proposed' && m.donor_response === 'accepted' ? 'accepted' : m.status;
const matchHeadline = (m) => (m.is_donor ? DONOR_HEADLINES : REQUESTER_HEADLINES)[matchPhase(m)];
const waitingOnMe = (m) => m.is_donor && m.status === 'proposed' && m.donor_response === 'pending';

function MatchResponse({ match, resource, onChanged }) {
  // Update the list straight away; mutate rolls back if the server refuses.
  const respond = async (response, reason = '') => {
    await resource.mutate((rows) => rows.map((m) => m.id === match.id ? { ...m, donor_response: response, status: response === 'declined' ? 'declined' : m.status } : m), () => api(`/matches/${match.id}/response`, { method: 'PATCH', body: { response, reason } }));
    onChanged?.();
  };
  return <span className="row-actions">
    <ConfirmButton danger={false} className="button small" title="Accept this match?" description={`Accepting shares your name, phone number, and email with ${match.hospital_name} so they can arrange medical tests. A match is not a medical clearance.`} confirmLabel="Accept match" busyLabel="Accepting…" success="Match accepted. The hospital can now contact you." onConfirm={() => respond('accepted')}>Accept</ConfirmButton>
    <ReasonDialogButton title="Decline this match?" description={`${match.hospital_name} will be told. Adding a reason is optional.`} required={false} confirmLabel="Decline match" busyLabel="Declining…" success="Match declined." onSubmit={(reason) => respond('declined', reason)}>Decline</ReasonDialogButton>
  </span>;
}

// ---------- Dashboard ----------
export function Dashboard() {
  const { user } = useAuth();
  const summary = useResource('/overview');
  const mine = useResource('/requests?mine=true');
  const pledges = useResource('/pledges');
  const matches = useResource('/matches');
  const refresh = () => { summary.refresh(); mine.refresh(); pledges.refresh(); };
  const ready = matches.data && mine.data && pledges.data;
  const matchRows = matches.data || [];
  const myRequests = mine.data || [];
  const myPledges = pledges.data || [];
  const awaiting = matchRows.filter(waitingOnMe);
  const rejected = myRequests.filter((r) => r.status === 'open' && r.verification === 'rejected');
  const pending = myRequests.find((r) => r.status === 'open' && r.verification === 'pending');
  let next = null;
  if (ready) {
    if (awaiting.length) next = <NextStep icon={BellRinging} title={awaiting.length === 1 ? 'A hospital proposed you as a donor' : `${awaiting.length} matches are waiting for your answer`} body="Accept or decline it under Needs your attention." />;
    else if (rejected.length) next = <NextStep icon={WarningCircle} title={`Your ${rejected[0].organ.toLowerCase()} request needs attention`} body={rejected[0].hospital_note || 'The hospital could not verify it.'} action="Open request" to={`/requests/${rejected[0].id}`} />;
    else if (pending) next = <NextStep calm icon={Hourglass} title={`Waiting for ${pending.hospital_name || 'the hospital'} to verify your request`} body="You’ll get a notification as soon as it’s verified." />;
    else if (!myPledges.length && !myRequests.length) next = <NextStep calm icon={Sparkle} title="Pledge to donate, or request an organ for a patient" body="It takes a few minutes, and your draft is saved as you go." action="Pledge to donate" to="/pledge" />;
    else next = <NextStep calm icon={CheckCircle} title="You’re all caught up" body="We’ll notify you when something changes." />;
  }
  const s = summary.data;
  return <div className="screen">
    <AppHeader title={`Welcome, ${user.first_name}`} subtitle="Your pledges, requests, and matches at a glance" actions={<><ButtonLink secondary to="/requests/new">Request an organ</ButtonLink><ButtonLink to="/pledge">Pledge to donate</ButtonLink></>} />
    {next}
    <Notice>{summary.error || matches.error || mine.error || pledges.error}</Notice>
    <StatStrip items={[
      { label: 'My requests', value: s?.requests ?? '–', icon: Heartbeat, to: '/requests?mine=true' },
      { label: 'Active pledges', value: s?.pledges ?? '–', icon: HandHeart, to: '/pledges' },
      { label: 'Active matches', value: s?.matches ?? '–', icon: Handshake, to: '/matches' },
      { label: 'Donation records', value: s?.records ?? '–', icon: ClipboardText, to: '/records' },
    ]} />
    <div className="screen-grid two grow">
      <Box scroll title="Needs your attention" actions={<Link className="text-link" to="/matches">All matches <ArrowRight size={15} /></Link>} bodyClass="flush">
        {!ready ? <Loading /> : awaiting.length || rejected.length ? <ul className="rows">
          {awaiting.map((m) => <ListRow key={`m${m.id}`} title={`Match #${m.id} · ${m.organ}`} meta={`${m.hospital_name} proposed you as a donor`} actions={<MatchResponse match={m} resource={matches} onChanged={refresh} />} />)}
          {rejected.map((r) => <ListRow key={`r${r.id}`} to={`/requests/${r.id}`} title={`${r.organ} request could not be verified`} meta={r.hospital_note || 'Open the request to update it.'} status={<Status value="rejected" />} />)}
        </ul> : <InlineEmpty icon={CheckCircle}>Nothing needs your attention right now.</InlineEmpty>}
      </Box>
      <Box scroll title="Your activity" bodyClass="flush">
        {!ready ? <Loading /> : <>
          <div className="row-group-title">Pledges</div>
          {myPledges.length ? <ul className="rows">{myPledges.slice(0, 4).map((p) => <ListRow key={p.id} to="/pledges" title={p.organ} meta={`${donationLabel(p.donor_type)} · ${p.city}, ${p.state}`} status={<Status value={p.status} />} />)}</ul>
            : <InlineEmpty icon={HandHeart} action={<Link className="text-link" to="/pledge">Pledge to donate</Link>}>No pledges yet.</InlineEmpty>}
          <div className="row-group-title">Requests</div>
          {myRequests.length ? <ul className="rows">{myRequests.slice(0, 4).map((r) => <ListRow key={r.id} to={`/requests/${r.id}`} title={`${r.organ} request`} meta={`${requestStage(r, matchRows)} · ${r.hospital_name || 'No hospital'}`} status={<Status value={requestBadge(r)} label={requestBadge(r) === 'pending' ? 'Awaiting hospital' : undefined} />} />)}</ul>
            : <InlineEmpty icon={Heartbeat} action={<Link className="text-link" to="/requests/new">Request an organ</Link>}>No requests yet.</InlineEmpty>}
          <div className="row-group-title">Latest matches</div>
          {matchRows.length ? <ul className="rows">{matchRows.slice(0, 3).map((m) => <ListRow key={m.id} to={`/matches?match=${m.id}`} title={`Match #${m.id} · ${m.organ}`} meta={matchHeadline(m)} status={<Status value={m.status} />} />)}</ul>
            : <InlineEmpty icon={Handshake}>No matches yet.</InlineEmpty>}
        </>}
      </Box>
    </div>
  </div>;
}

// ---------- My pledges ----------
function pledgeColumns(resource, onChanged) {
  const setStatus = async (pledge, status) => { await resource.mutate((rows) => rows.map((p) => p.id === pledge.id ? { ...p, status } : p), () => api(`/pledges/${pledge.id}`, { method: 'PATCH', body: { status } })); onChanged(); };
  return [
    { key: 'organ', header: 'Organ', render: (p) => <strong>{p.organ}</strong> },
    { key: 'donor_type', header: 'Donation', render: (p) => <Status value={p.donor_type} /> },
    { key: 'city', header: 'Location', render: (p) => `${p.city}, ${p.state}` },
    { key: 'created_at', header: 'Pledged', render: (p) => formatDate(p.created_at) },
    { key: 'status', header: 'Status', render: (p) => <><Status value={p.status} />{p.available_at && <small>Reported available by {p.available_hospital_name}</small>}</> },
    { key: 'action', header: 'Action', sortable: false, render: (p) => p.status === 'active'
      ? <ConfirmButton title="Withdraw this pledge?" description="Any proposed match will be declined. You can reactivate the pledge later." confirmLabel="Withdraw" busyLabel="Withdrawing…" success="Pledge withdrawn." onConfirm={() => setStatus(p, 'withdrawn')}>Withdraw</ConfirmButton>
      : p.status === 'withdrawn' ? <ConfirmButton danger={false} title="Reactivate this pledge?" description="Hospitals will be able to find you as a donor again." confirmLabel="Reactivate" success="Pledge reactivated." onConfirm={() => setStatus(p, 'active')}>Reactivate</ConfirmButton> : '—' },
  ];
}
export function MyPledges() {
  const resource = useResource('/pledges');
  const rows = resource.data || [];
  return <div className="screen">
    <AppHeader title="My pledges" subtitle={resource.data ? `${rows.length} ${rows.length === 1 ? 'pledge' : 'pledges'} · ${rows.filter((p) => p.status === 'active').length} active` : 'Your willingness to donate'} actions={<ButtonLink to="/pledge">Pledge to donate</ButtonLink>} />
    <Notice>{resource.error}</Notice>
    <Box scroll className="grow" bodyClass="flush">{!resource.data ? <Loading /> : <DataTable columns={pledgeColumns(resource, resource.refresh)} rows={rows} emptyTitle="You haven’t pledged yet." emptyText="Pledge once to join the donor registry." />}</Box>
  </div>;
}

// ---------- Matches ----------
export function MyMatches() {
  const [params, setParams] = useSearchParams();
  const resource = useResource('/matches');
  const rows = resource.data || [];
  const waiting = rows.filter(waitingOnMe);
  const selectedId = Number(params.get('match')) || (waiting[0] || rows[0])?.id;
  const selected = rows.find((m) => m.id === selectedId);
  return <div className="screen">
    <AppHeader title="Matches" subtitle={waiting.length ? `${waiting.length} waiting for your answer` : 'Follow your donation and request journeys'} />
    <Notice>{resource.error}</Notice>
    {!resource.data ? <Loading variant="cards" /> : !rows.length ? <Box><InlineEmpty icon={Handshake}>No matches yet. When a hospital proposes one, it appears here and in your notifications.</InlineEmpty></Box>
      : <div className="screen-grid detail grow">
        <Box scroll title="All matches" subtitle={`${rows.length} total`} bodyClass="flush"><ul className="rows">{rows.map((m) => <li key={m.id}><button type="button" className={`row-item selectable ${m.id === selectedId ? 'selected' : ''}`} aria-current={m.id === selectedId ? 'true' : undefined} onClick={() => setParams({ match: String(m.id) })}><span className="row-main"><strong>#{m.id} · {m.organ}</strong><small>{m.is_donor ? 'You are the donor' : 'Your request'} · {formatDate(m.created_at)}</small></span>{waitingOnMe(m) ? <Status value="pending" label="Your answer" /> : <Status value={m.status} />}</button></li>)}</ul></Box>
        {selected && <MatchDetail key={selected.id} match={selected} resource={resource} />}
      </div>}
  </div>;
}
function MatchDetail({ match, resource }) {
  return <Box scroll title={`Match #${match.id} · ${match.organ}`} subtitle={match.is_donor ? 'You are the donor' : 'Your request'} actions={<Status value={match.status} />}>
    <div className="detail-columns">
      <div><h3 className="mini-title">Progress</h3><Journey vertical steps={matchJourney(match)} /></div>
      <div>
        <p className="lead">{matchHeadline(match)}</p>
        <dl className="detail-grid">
          <div><dt>Hospital</dt><dd>{match.hospital_name}</dd></div>
          <div><dt>Location</dt><dd>{match.hospital_city}, {match.hospital_state}</dd></div>
          <div><dt>Hospital phone</dt><dd>{match.hospital_phone}</dd></div>
          <div><dt>Proposed</dt><dd>{formatDate(match.created_at)}</dd></div>
          <div><dt>Last update</dt><dd>{formatDate(match.updated_at)}</dd></div>
          {!match.is_donor && <div><dt>Request</dt><dd><Link className="text-link" to={`/requests/${match.request_id}`}>Open request</Link></dd></div>}
        </dl>
        {match.status === 'declined' && match.decision_reason && <Notice>Reason: {match.decision_reason}</Notice>}
        {waitingOnMe(match) && <div className="decision-bar"><p className="quiet-note">Accepting shares your name, phone number, and email with {match.hospital_name}. A match is not a medical clearance.</p><MatchResponse match={match} resource={resource} /></div>}
      </div>
    </div>
  </Box>;
}

// ---------- Requests list ----------
export function Requests() {
  const [params, setParams] = useSearchParams();
  const mine = params.get('mine') === 'true';
  const [search, setSearch] = useState(''); const [organ, setOrgan] = useState(''); const [blood, setBlood] = useState(''); const [verification, setVerification] = useState('');
  const resource = useResource(`/requests${mine ? '?mine=true' : ''}`);
  const matches = useResource(mine ? '/matches' : null);
  const rows = (resource.data || []).filter((r) => (!organ || r.organ === organ) && (!blood || r.blood_group === blood) && (!verification || r.verification === verification) && `${r.organ} ${r.first_name} ${r.last_name} ${r.address} ${r.hospital_name || ''}`.toLowerCase().includes(search.toLowerCase()));
  const clear = () => { setSearch(''); setOrgan(''); setBlood(''); setVerification(''); };
  return <div className="screen">
    <AppHeader title={mine ? 'My requests' : 'Organ requests'} subtitle={mine ? 'Requests you created and where each one stands' : 'Hospitals verify each request; compatibility is decided by the transplant team'} actions={<><Tabs label="Request view" value={mine ? 'mine' : 'open'} onChange={(v) => setParams(v === 'mine' ? { mine: 'true' } : {})} tabs={[['open', 'Open requests'], ['mine', 'My requests']]} /><ButtonLink to="/requests/new">Create a request</ButtonLink></>} />
    <Notice>{resource.error}</Notice>
    <Box scroll className="grow" head={<>
      <SearchBox value={search} onChange={setSearch} placeholder="Search by name, organ, hospital or location" />
      <select aria-label="Filter by organ" value={organ} onChange={(e) => setOrgan(e.target.value)}><option value="">All organs</option>{ORGANS.map((v) => <option key={v}>{v}</option>)}</select>
      <select aria-label="Filter by blood group" value={blood} onChange={(e) => setBlood(e.target.value)}><option value="">All blood groups</option>{BLOOD_GROUPS.map((v) => <option key={v}>{v}</option>)}</select>
      <select aria-label="Filter by verification" value={verification} onChange={(e) => setVerification(e.target.value)}><option value="">Any verification</option><option value="verified">Verified by hospital</option><option value="pending">Awaiting hospital</option></select>
      <span className="results">{resource.data ? `${rows.length} shown` : ''}</span>
    </>}>
      {!resource.data ? <Loading variant="cards" /> : rows.length ? <div className={`request-grid ${resource.refreshing ? 'refreshing' : ''}`}>{rows.map((r) => <RequestCard key={r.id} request={r} matches={matches.data || []} showJourney={mine} />)}</div>
        : <InlineEmpty action={<button type="button" className="text-button" onClick={clear}>Clear filters</button>}>{mine && !resource.data.length ? 'You haven’t created a request yet.' : 'No requests match these filters.'}</InlineEmpty>}
    </Box>
  </div>;
}

// ---------- Request detail ----------
const STATE_COPY = {
  closed: 'This request is closed.',
  rejected: 'The hospital could not verify this request. Update it and it will be reviewed again.',
  pending: 'Waiting for the hospital to verify this request and set its medical priority.',
  verified: 'Verified and in priority matching. You’ll be notified when a donor is proposed.',
  proposed: 'A donor has been proposed. Waiting for the donor to accept.',
  accepted: 'The donor accepted. The hospital is arranging medical tests.',
  confirmed: 'A donor match is confirmed. The hospital will contact you about next steps.',
};
export function RequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const request = useResource(`/requests/${id}`);
  const matches = useResource('/matches');
  const [tab, setTab] = useState('details');
  if (!request.data) return request.error ? <div className="screen"><AppHeader back="/requests" backLabel="Back to requests" title="Request" /><Notice>{request.error}</Notice></div> : <Loading />;
  const r = request.data;
  const owner = r.user_id === user.id || user.role === 'admin';
  const related = (matches.data || []).filter((m) => m.request_id === r.id);
  const active = related.find((m) => m.status === 'confirmed') || related.find((m) => m.status === 'proposed');
  const phase = r.status === 'closed' && !active ? 'closed' : active ? (active.status === 'confirmed' ? 'confirmed' : active.donor_response === 'accepted' ? 'accepted' : 'proposed') : r.verification;
  const setStatus = async (status) => { await request.mutate((row) => ({ ...row, status }), () => api(`/requests/${r.id}`, { method: 'PATCH', body: { status } })); matches.refresh(); };
  const facts = [
    ['Patient blood group', r.blood_group], ['Quantity', r.quantity], ['Urgency you reported', r.urgency === 'Not Emergency' ? 'Standard' : r.urgency],
    ['Hospital', <>{r.hospital_name || '—'} {r.hospital_status === 'verified' && <VerifiedBadge />}</>], ['Verification', <Status value={r.verification} />],
    ['Priority set by hospital', r.priority ? <Status value={r.priority} /> : '—'], ['On the verified list since', r.verified_at ? formatDate(r.verified_at) : '—'],
    owner && ['Patient date of birth', r.patient_dob ? formatDate(r.patient_dob) : '—'], owner && ['Phone', r.phone], owner && ['Address', `${r.address} ${r.zip}`],
  ].filter(Boolean);
  const actions = owner && <>
    {r.status === 'open' && <ButtonLink secondary to={`/requests/${r.id}/edit`}>Edit</ButtonLink>}
    {r.status === 'open'
      ? <ConfirmButton danger={false} className="button secondary" title="Close this request?" description="Any proposed match will be declined. You can reopen the request later." confirmLabel="Close request" success="Request closed." onConfirm={() => setStatus('closed')}>Close request</ConfirmButton>
      : <ConfirmButton danger={false} className="button secondary" title="Reopen this request?" description="It will return to the open requests list." confirmLabel="Reopen request" success="Request reopened." onConfirm={() => setStatus('open')}>Reopen request</ConfirmButton>}
    <ConfirmButton title="Delete this request?" description="Requests with match history can’t be deleted; close them instead." confirmLabel="Delete" busyLabel="Deleting…" success="Request deleted." onConfirm={async () => { await api(`/requests/${r.id}`, { method: 'DELETE' }); navigate('/requests?mine=true'); }}>Delete</ConfirmButton>
  </>;
  return <div className="screen">
    <AppHeader back={r.user_id === user.id ? '/requests?mine=true' : '/requests'} backLabel="Back to requests" title={`${r.organ} request #${r.id}`} subtitle={`Requested by ${r.first_name} ${r.last_name} · ${formatDate(r.created_at)}`} actions={actions} />
    <div className="screen-grid detail grow">
      <Box scroll title="Progress" actions={<Status value={requestBadge(r)} label={requestBadge(r) === 'pending' ? 'Awaiting hospital' : undefined} />}>
        <Journey vertical steps={requestJourney(r, related)} />
        <p className="stage-copy">{STATE_COPY[phase]}</p>
        {r.verification === 'rejected' && r.hospital_note && <Notice>Hospital note: {r.hospital_note}</Notice>}
      </Box>
      <Box scroll head={<Tabs label="Request sections" value={tab} onChange={setTab} tabs={[['details', 'Details'], ['matches', 'Matches', related.length]]} />} bodyClass={tab === 'matches' ? 'flush' : ''}>
        {tab === 'details'
          ? <><dl className="detail-grid">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{owner && <PrivateHint />}{r.note && <p className="request-note">{r.note}</p>}</>
          : !matches.data ? <Loading /> : related.length ? <ul className="rows">{related.map((m) => <ListRow key={m.id} to={`/matches?match=${m.id}`} title={`Match #${m.id} · ${formatDate(m.created_at)}`} meta={matchHeadline(m)} status={<Status value={m.status} />} />)}</ul>
            : <InlineEmpty icon={Handshake}>No matches yet. You’ll get a notification when the hospital proposes a donor.</InlineEmpty>}
      </Box>
    </div>
  </div>;
}

// ---------- Request form ----------
export function RequestForm() {
  const { id } = useParams();
  const resource = useResource(id ? `/requests/${id}` : null);
  if (id && !resource.data) return resource.error ? <div className="screen"><AppHeader back="/requests" backLabel="Back to requests" title="Edit request" /><Notice>{resource.error}</Notice></div> : <Loading />;
  return <RequestEditor key={id || 'new'} initial={id ? resource.data : null} />;
}
function RequestEditor({ initial }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const action = useAsync();
  const hospitals = useResource('/hospitals');
  const draftKey = initial ? null : `request:${user.id}`;
  const draft = useDraftSaver(draftKey);
  const [formKey, setFormKey] = useState(0);
  const saved = useMemo(() => readDraft(draftKey)?.values || {}, [draftKey, formKey]);
  if (initial && initial.user_id !== user.id && user.role !== 'admin') return <div className="screen"><AppHeader back="/requests" backLabel="Back to requests" title="Edit request" /><Notice>You can only edit your own requests.</Notice></div>;
  const d = { ...(initial || { blood_group: user.blood_group, phone: user.phone, zip: user.zip, address: user.address, quantity: 1, urgency: 'Not Emergency' }), ...saved };
  const options = (hospitals.data || []).map(hospitalOption);
  if (initial?.hospital_id && hospitals.data && !options.some((o) => o.value === String(initial.hospital_id))) options.push({ value: String(initial.hospital_id), label: `${initial.hospital_name} (no longer verified)` });
  const steps = [
    { title: 'Patient', content: <><h3 className="form-section-title">Patient and organ</h3><div className="fields"><Field label="Organ type" name="organ" options={ORGANS} defaultValue={d.organ || ''} /><Field label="Patient blood group" name="blood_group" options={BLOOD_GROUPS} defaultValue={d.blood_group || ''} /><Field label="Patient date of birth" name="patient_dob" type="date" min="1900-01-01" max={today()} defaultValue={d.patient_dob || ''} hint={<PrivateHint />} /><Field label="Quantity" name="quantity" type="number" min={1} max={7} defaultValue={d.quantity} /><Field label="Urgency as you understand it" name="urgency" options={URGENCIES.map((v) => ({ value: v, label: v === 'Not Emergency' ? 'Standard' : v }))} defaultValue={d.urgency} wide hint="The treating hospital sets the priority used for matching." /></div></> },
    { title: 'Hospital', blocked: !hospitals.data || !options.length, content: <><h3 className="form-section-title">Treating hospital</h3>{!hospitals.data ? <Loading /> : options.length ? <div className="fields"><Combobox label="Hospital" name="hospital_id" options={options} defaultValue={d.hospital_id ? String(d.hospital_id) : ''} placeholder="Search by hospital name or city" wide hint="Only hospitals verified by OrganoTale are listed." /></div> : <Notice>No verified hospitals yet. The patient’s treating hospital needs to <Link to="/hospital/register">register on OrganoTale</Link> and be approved before a request can be created.</Notice>}</> },
    { title: 'Contact', content: <><h3 className="form-section-title">Location and contact</h3><div className="fields"><Field label="Address or area" name="address" defaultValue={d.address} maxLength={300} wide /><LocationFields initial={{ zip: d.zip }} pinName="zip" includeLocation={false} /><Field label="Phone number" name="phone" type="tel" defaultValue={d.phone} pattern="[+0-9 .\(\)\-]{7,25}" hint={<PrivateHint />} /><Field label="Note for the community" name="note" defaultValue={d.note || ''} multiline required={false} placeholder="Keep private medical details out." wide /></div></> },
    { title: 'Review', content: (v) => <><h3 className="form-section-title">Check the details</h3><ReviewList items={[['Organ', v.organ], ['Patient blood group', v.blood_group], ['Patient date of birth', v.patient_dob && formatDate(v.patient_dob)], ['Quantity', v.quantity], ['Urgency', v.urgency === 'Not Emergency' ? 'Standard' : v.urgency], ['Hospital', options.find((o) => o.value === v.hospital_id)?.label], ['Address', v.address], ['Postal code', v.zip], ['Phone', v.phone], ['Note', v.note]]} />{initial?.verification === 'verified' && <Notice>Changing the organ, blood group, hospital, or patient date of birth sends this request back to the hospital for verification.</Notice>}</> },
  ];
  return <FormShell back={initial ? `/requests/${initial.id}` : '/requests?mine=true'} backLabel={initial ? 'Back to request' : 'Back to requests'} title={initial ? 'Edit your request' : 'Request an organ'} description="The treating hospital verifies your request and sets its medical priority for matching.">
    <Wizard key={formKey} steps={steps} busy={action.busy} error={action.error || hospitals.error} submitLabel={initial ? 'Save changes' : 'Create request'} draft={initial ? null : draft} onDiscard={() => { draft.clear(); setFormKey((k) => k + 1); }}
      aside={<><p>Your name, hospital, city, and note are visible to signed-in members.</p><PrivateHint>Patient date of birth and your contact details go only to the hospital and administrators.</PrivateHint></>}
      onSubmit={(body) => action.run(async () => {
        const result = await api(initial ? `/requests/${initial.id}` : '/requests', { method: initial ? 'PATCH' : 'POST', body });
        draft.clear();
        navigate(`/requests/${initial ? initial.id : result.id}`);
      }, { success: initial ? 'Request updated.' : 'Request created. The hospital has been notified.' })} />
  </FormShell>;
}

// ---------- Pledge form ----------
export function PledgeForm() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const draftKey = `pledge:${user.id}`;
  const draft = useDraftSaver(draftKey);
  const [formKey, setFormKey] = useState(0);
  const [done, setDone] = useState(false);
  const saved = useMemo(() => readDraft(draftKey)?.values || {}, [draftKey, formKey]);
  if (done) return <div className="screen"><AppHeader title="Pledge saved" /><Box className="success-box"><span className="success-symbol"><CheckCircle size={48} /></span><h2>Thank you for offering hope.</h2><p>{user.donor_status === 'deceased' ? 'The after-death pledge is recorded. A verified hospital must document death and consent and report this organ available before it can enter matching.' : 'Your pledge is recorded. Living pledges enter priority matching; after-death pledges stay in the registry until a hospital verifies availability. Match updates appear on your dashboard.'}</p><div className="inline-actions"><ButtonLink to="/dashboard">Go to my dashboard</ButtonLink><ButtonLink secondary to="/pledges">View my pledges</ButtonLink></div></Box></div>;
  return <FormShell back="/pledges" backLabel="Back to my pledges" title="Pledge to donate" description="Pledge once. Hospitals match pledged donors to verified patients by medical priority.">
    <PledgeWizard key={formKey} saved={saved} initialOrgan={ORGANS.includes(params.get('organ')) ? params.get('organ') : ''} draft={draft} user={user} onDiscard={() => { draft.clear(); setFormKey((k) => k + 1); }} onDone={() => { draft.clear(); setDone(true); }} />
  </FormShell>;
}
export function PledgeWizard({ saved, initialOrgan, draft, user, onDiscard, onDone }) {
  const action = useAsync();
  const [organ, setOrgan] = useState(saved.organ || initialOrgan);
  const deceased = user.donor_status === 'deceased';
  const [chosenType, setChosenType] = useState(saved.donor_type || (initialOrgan && !LIVING_ORGANS.includes(initialOrgan) ? 'deceased' : 'living'));
  const donorType = deceased ? 'deceased' : chosenType;
  const eligibleOrgans = donorType === 'living' ? LIVING_ORGANS : ORGANS;
  const changeType = (value) => { setChosenType(value); if (value === 'living' && !LIVING_ORGANS.includes(organ)) setOrgan(''); };
  const livingNotAllowed = Boolean(organ) && donorType === 'living' && !LIVING_ORGANS.includes(organ);
  const steps = [
    { title: 'Organ', blocked: livingNotAllowed, content: <><h3 className="form-section-title">Your pledge</h3><p className="quiet-note">{deceased ? 'Donor status: deceased. All after-death organ pledges are available; the hospital must verify each organ before matching.' : 'Donor status: alive. Choose living donation or register a future after-death pledge.'} <Link to="/settings">Manage donor status</Link></p><div className="fields"><Field label="Organ" name="organ" options={eligibleOrgans} value={eligibleOrgans.includes(organ) ? organ : ''} onChange={(e) => setOrgan(e.target.value)} /><Field label="Donation type" name="donor_type" options={deceased ? [{ value: 'deceased', label: 'After death (registry)' }] : [{ value: 'living', label: 'Living donation' }, { value: 'deceased', label: 'After death (registry)' }]} value={donorType} onChange={(e) => changeType(e.target.value)} /></div>{livingNotAllowed && <Notice>{organ} can only be pledged for donation after death. Choose “After death (registry)”.</Notice>}</> },
    { title: 'Health', content: <><h3 className="form-section-title">A few details about you</h3><div className="fields"><Field label="Height (cm)" name="height" type="number" min={50} max={260} step="0.1" placeholder="e.g. 170" defaultValue={saved.height || ''} /><Field label="Weight (kg)" name="weight" type="number" min={10} max={500} step="0.1" placeholder="e.g. 65" defaultValue={saved.weight || ''} /><Field label="Last donation date" name="last_donation" type="date" min="1900-01-01" max={today()} required={false} defaultValue={saved.last_donation || ''} wide /></div><h3 className="form-section-title separated">Health history</h3><div className="fields"><Field label="Previous operations" name="operation_type" options={['None', 'Minor', 'Major']} defaultValue={saved.operation_type || 'None'} /><Field label="Operation details" name="operation_desc" required={false} defaultValue={saved.operation_desc || ''} /><Field label="Disease history" name="disease_type" options={['None', 'Acute', 'Chronic']} defaultValue={saved.disease_type || 'None'} /><Field label="Disease details" name="disease_desc" required={false} defaultValue={saved.disease_desc || ''} /><Field label="Accident history" name="accident_type" options={['None', 'Minor', 'Critical']} defaultValue={saved.accident_type || 'None'} /><Field label="Accident details" name="accident_desc" required={false} defaultValue={saved.accident_desc || ''} /><Field label="Currently pregnant" name="pregnant" options={HEALTH_OPTIONS} defaultValue={saved.pregnant || 'Not applicable'} /><Field label="Currently menstruating" name="menstruation" options={HEALTH_OPTIONS} defaultValue={saved.menstruation || 'Not applicable'} /></div></> },
    { title: 'Location', content: <><h3 className="form-section-title">Where you live</h3><div className="fields"><LocationFields initial={{ ...saved, city: saved.city ?? user.address?.split(',')[0]?.trim() ?? '' }} required={false} /></div></> },
    { title: 'Review', content: (v) => <><h3 className="form-section-title">Check your pledge</h3><ReviewList items={[['Organ', v.organ], ['Donation type', v.donor_type === 'deceased' ? 'After death (registry)' : 'Living donation'], ['City', v.city], ['State', v.state], ['Height / weight', v.height && `${v.height} cm / ${v.weight} kg`], ['Last donation', v.last_donation && formatDate(v.last_donation)], ['Operations', v.operation_type], ['Disease history', v.disease_type], ['Accident history', v.accident_type]]} /><label className="checkbox-label"><input name="consent" type="checkbox" required /><span>{deceased ? 'I am authorized to act for this donor. I understand that the hospital must verify death, consent, and organ suitability before donation, and that offering or accepting payment for organs is illegal.' : 'I understand that a pledge is not a medical clearance, that hospitals decide eligibility, that I can withdraw at any time, and that offering or accepting payment for organs is illegal.'}</span></label></> },
  ];
  return <Wizard steps={steps} busy={action.busy} error={action.error} submitLabel="Save pledge" draft={draft} onDiscard={onDiscard}
    aside={<><PrivateHint>Hospitals see an anonymous donor number with your health answers. {deceased ? 'The hospital documents after-death consent before proposing a match; no response is requested from the donor.' : 'Your contact details are shared only if you accept a match.'}</PrivateHint><p>A living donor can give a kidney, or part of a liver, lung, pancreas, or intestine. Heart, eyes, and heart valves are pledged for after death.</p></>}
    onSubmit={(body) => action.run(async () => { await api('/pledges', { method: 'POST', body: { ...body, consent: body.consent === 'on' } }); onDone(); }, { success: 'Pledge saved.' })} />;
}

// ---------- Records ----------
export function Records() {
  const resource = useResource('/records'); const { user } = useAuth(); const [showForm, setShowForm] = useState(false); const action = useAsync(); const toast = useToast();
  const rows = resource.data || [];
  const columns = [
    { key: 'organ', header: 'Organ', render: (r) => <strong>{r.organ}</strong> },
    { key: 'blood_group', header: 'Blood group', render: (r) => <span className="blood-type">{r.blood_group}</span> },
    { key: 'quantity', header: 'Quantity' },
    { key: 'donated_on', header: 'Donation date', render: (r) => formatDate(r.donated_on) },
    { key: 'note', header: 'Personal note', sortable: false, render: (r) => r.note || '—' },
    { key: 'action', header: 'Action', sortable: false, render: (r) => <ConfirmButton title="Delete this record?" confirmLabel="Delete" busyLabel="Deleting…" success="Record deleted." onConfirm={async () => { await resource.mutate((list) => list.filter((row) => row.id !== r.id), () => api(`/records/${r.id}`, { method: 'DELETE' })); }}>Delete</ConfirmButton> },
  ];
  return <div className="screen">
    <AppHeader title="Donation records" subtitle={resource.data ? `${rows.length} ${rows.length === 1 ? 'record' : 'records'} · ${rows.reduce((sum, r) => sum + r.quantity, 0)} recorded in total` : 'Your self-reported donation history'} actions={<button type="button" className="button" onClick={() => setShowForm(!showForm)}>{showForm ? 'Close form' : <><Plus size={18} /> Add a record</>}</button>} />
    <Notice>{resource.error}</Notice>
    <div className={`screen-grid grow ${showForm ? 'side-form' : 'single'}`}>
      {showForm && <Box scroll title="Add a donation record" subtitle="Self-reported, separate from pledges and matches">
        <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const body = formValues(form); action.run(async () => { await api('/records', { method: 'POST', body }); form.reset(); setShowForm(false); toast('Your donation record has been saved.'); resource.refresh(); }); }}>
          <div className="fields one"><Field label="Organ type" name="organ" options={ORGANS} /><Field label="Blood group" name="blood_group" options={BLOOD_GROUPS} defaultValue={user.blood_group} /><Field label="Quantity" name="quantity" type="number" min={1} max={7} defaultValue={1} /><Field label="Donation date" name="donated_on" type="date" min="1900-01-01" max={today()} /><Field label="Personal note" name="note" multiline required={false} /></div>
          <Notice>{action.error}</Notice>
          <div className="form-actions"><button className="text-button" type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="button" disabled={action.busy}>{action.busy ? 'Saving…' : 'Save record'}<ArrowRight size={18} /></button></div>
        </form>
      </Box>}
      <Box scroll bodyClass="flush">{!resource.data ? <Loading /> : rows.length ? <DataTable columns={columns} rows={rows} initialSort={{ key: 'donated_on', dir: 'desc' }} /> : <InlineEmpty icon={ClipboardText} action={!showForm && <button type="button" className="text-button" onClick={() => setShowForm(true)}>Add your first record</button>}>No donation records yet.</InlineEmpty>}</Box>
    </div>
  </div>;
}
