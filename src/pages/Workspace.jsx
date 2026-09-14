import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, BellRinging, CalendarBlank, CheckCircle, ClipboardText, Funnel, HandHeart, Handshake, Heartbeat, Hospital, Hourglass, MapPin, Plus, Sparkle, WarningCircle } from '@phosphor-icons/react';
import { api } from '../api';
import { useT } from '../i18n';
import { useAuth, useResource, useAsync, useToast, useDraftSaver, readDraft, Field, Combobox, Wizard, ReviewList, Notice, Loading, Empty, PageHeading, FormShell, ButtonLink, Status, Stats, SearchBox, ConfirmButton, NextStep, Journey, requestJourney, matchJourney, DataTable, VerifiedBadge, PrivateHint, formValues, formatDate } from '../components';
import { BLOOD_GROUPS, ORGANS, URGENCIES, LIVING_ORGANS, STATES } from '../../shared/options';
import { LocationFields } from '../LocationFields';

const today = () => new Date().toISOString().slice(0, 10);
const HEALTH_OPTIONS = ['Yes', 'No', 'Not applicable', 'Prefer not to say'];
const STATE_OPTIONS = STATES.map((s) => ({ value: s, label: s }));
const hospitalOption = (h) => ({ value: String(h.id), label: h.name, detail: `${h.city}, ${h.state} · Verified hospital` });

function RequestCard({ request, matches, showJourney = false }) {
  const t = useT();
  const { user } = useAuth();
  const owner = request.user_id === user.id;
  const badge = request.status === 'closed' ? 'closed' : request.verification === 'verified' ? request.priority : request.verification;
  return <article className="request-card">
    <div className="request-card-top"><span className="organ-icon"><Heartbeat size={25} /></span><Status value={badge} label={badge === 'pending' ? t('Awaiting hospital') : undefined} /></div>
    <div className="request-title"><h3>{request.organ}</h3><span className="blood-type">{request.blood_group}</span></div>
    <p className="request-person">Requested by {request.first_name} {request.last_name}</p>
    <div className="request-details"><span><Hospital size={16} />{request.hospital_name || 'No hospital selected'}</span>{request.hospital_status === 'verified' && <VerifiedBadge />}<span><MapPin size={16} />{request.hospital_city ? `${request.hospital_city}, ${request.hospital_state}` : request.address}</span><span><CalendarBlank size={16} />{formatDate(request.created_at)}</span></div>
    {request.note && <p className="request-note">{request.note}</p>}
    {showJourney && <Journey compact steps={requestJourney(request, matches)} />}
    <div className="request-bottom"><span>Quantity <strong>{request.quantity}</strong></span>{owner || user.role === 'admin' ? <Link className="text-link" to={`/requests/${request.id}`}>{t('Review')} <ArrowUpRight size={17} /></Link> : <Link className="text-link" to={`/pledge?organ=${encodeURIComponent(request.organ)}`}>{t('Pledge to donate')} <ArrowUpRight size={17} /></Link>}</div>
  </article>;
}

const DONOR_HEADLINES = { proposed: 'A hospital has proposed you as a donor for a patient.', accepted: 'You accepted. The hospital will contact you to arrange medical tests.', confirmed: 'Your match is confirmed by the hospital.', declined: 'This match did not go ahead.' };
const REQUESTER_HEADLINES = { proposed: 'A compatible donor has been proposed for your request.', accepted: 'The donor accepted. The hospital is arranging medical tests.', confirmed: 'The hospital has confirmed a donor match for your request.', declined: 'A proposed match did not go ahead.' };
function MatchUpdate({ match, resource, onChanged }) {
  const t = useT();
  const action = useAsync();
  const [declining, setDeclining] = useState(false);
  const waiting = match.is_donor && match.status === 'proposed' && match.donor_response === 'pending';
  const phase = match.status === 'proposed' && match.donor_response === 'accepted' ? 'accepted' : match.status;
  const respond = (body) => action.run(async () => {
    // Show the answer straight away; roll back if the server refuses.
    resource.setData((rows) => rows.map((m) => m.id === match.id ? { ...m, donor_response: body.response, status: body.response === 'declined' ? 'declined' : m.status } : m));
    try { await api(`/matches/${match.id}/response`, { method: 'PATCH', body }); } catch (err) { resource.refresh(); throw err; }
    onChanged?.();
  }, { success: body.response === 'accepted' ? 'Match accepted. The hospital can now contact you.' : 'Match declined.', toastError: true });
  return <article className="panel match-card">
    <div className="review-heading"><div><span className="eyebrow">Match #{match.id} · {formatDate(match.created_at)} · {match.is_donor ? 'You are the donor' : 'Your request'}</span><h3>{match.organ}</h3><p>{(match.is_donor ? DONOR_HEADLINES : REQUESTER_HEADLINES)[phase]}</p></div><Status value={match.status} /></div>
    <Journey compact steps={matchJourney(match)} />
    <p className="muted"><Hospital size={15} /> {match.hospital_name}, {match.hospital_city} · {match.hospital_phone}</p>
    {match.status === 'declined' && match.decision_reason && <p className="muted">Reason: {match.decision_reason}</p>}
    {waiting && <p className="quiet-note">Accepting shares your name, phone number, and email with {match.hospital_name} so they can arrange medical tests. A match is not a medical clearance.</p>}
    {waiting && (declining
      ? <form className="inline-actions" onSubmit={(e) => { e.preventDefault(); respond({ response: 'declined', reason: formValues(e.currentTarget).reason }); }}><Field label="Reason" name="reason" required={false} wide /><button className="button small" disabled={action.busy}>{t('Decline')}</button><button type="button" className="text-button" onClick={() => setDeclining(false)}>{t('Cancel')}</button></form>
      : <div className="inline-actions"><button type="button" className="button small" disabled={action.busy} onClick={() => respond({ response: 'accepted' })}>{t('Accept match')}</button><button type="button" className="text-button danger" disabled={action.busy} onClick={() => setDeclining(true)}>{t('Decline')}</button></div>)}
  </article>;
}

function pledgeColumns(resource, onChanged, t) {
  const setStatus = async (pledge, status) => { await resource.mutate((rows) => rows.map((p) => p.id === pledge.id ? { ...p, status } : p), () => api(`/pledges/${pledge.id}`, { method: 'PATCH', body: { status } })); onChanged(); };
  return [
    { key: 'organ', header: 'Organ', render: (p) => <strong>{p.organ}</strong> },
    { key: 'donor_type', header: 'Donation', render: (p) => <Status value={p.donor_type} /> },
    { key: 'city', header: 'Location', render: (p) => `${p.city}, ${p.state}` },
    { key: 'created_at', header: 'Pledged', render: (p) => formatDate(p.created_at) },
    { key: 'status', header: 'Status', render: (p) => <><Status value={p.status} />{p.available_at && <small>Reported available by {p.available_hospital_name}</small>}</> },
    { key: 'action', header: 'Action', sortable: false, render: (p) => p.status === 'active'
      ? <ConfirmButton title="Withdraw this pledge?" description="Any proposed match will be declined. You can reactivate the pledge later." confirmLabel={t('Withdraw')} busyLabel="Withdrawing…" success="Pledge withdrawn." onConfirm={() => setStatus(p, 'withdrawn')}>{t('Withdraw')}</ConfirmButton>
      : p.status === 'withdrawn' ? <ConfirmButton danger={false} title="Reactivate this pledge?" description="Hospitals will be able to find you as a donor again." confirmLabel={t('Reactivate')} success="Pledge reactivated." onConfirm={() => setStatus(p, 'active')}>{t('Reactivate')}</ConfirmButton> : '—' },
  ];
}

export function Dashboard() {
  const t = useT();
  const { user } = useAuth();
  const summary = useResource('/overview');
  const community = useResource('/requests');
  const mine = useResource('/requests?mine=true');
  const pledges = useResource('/pledges');
  const matches = useResource('/matches');
  const refresh = () => { summary.refresh(); pledges.refresh(); matches.refresh(); mine.refresh(); };
  const matchRows = matches.data || [];
  const myRequests = mine.data || [];
  const awaitingMe = matchRows.filter((m) => m.is_donor && m.status === 'proposed' && m.donor_response === 'pending');
  const rejected = myRequests.find((r) => r.status === 'open' && r.verification === 'rejected');
  const pendingRequest = myRequests.find((r) => r.status === 'open' && r.verification === 'pending');
  const scrollToMatches = () => document.getElementById('match-updates')?.scrollIntoView({ behavior: 'smooth' });
  let next;
  if (!matches.data || !mine.data || !pledges.data) next = null;
  else if (awaitingMe.length) next = <NextStep icon={BellRinging} title={awaitingMe.length === 1 ? 'A hospital proposed you as a donor' : `${awaitingMe.length} matches are waiting for your answer`} body="Review the match and accept or decline it." action={t('Review')} onClick={scrollToMatches} />;
  else if (rejected) next = <NextStep icon={WarningCircle} title={`Your ${rejected.organ.toLowerCase()} request needs attention`} body={rejected.hospital_note || 'The hospital could not verify it.'} action={t('Review')} to={`/requests/${rejected.id}`} />;
  else if (pendingRequest) next = <NextStep calm icon={Hourglass} title={`Waiting for ${pendingRequest.hospital_name || 'the hospital'} to verify your request`} body="You’ll get a notification as soon as it’s verified." action={t('Review')} to={`/requests/${pendingRequest.id}`} />;
  else if (!pledges.data.length && !myRequests.length) next = <NextStep calm icon={Sparkle} title="Pledge to donate, or request an organ for a patient" body="It takes a few minutes, and you can save a draft as you go." action={t('Pledge to donate')} to="/pledge" />;
  else next = <NextStep calm icon={CheckCircle} title="You’re all caught up" body="We’ll notify you when something changes." />;
  return <div className="page-container workspace">
    <PageHeading eyebrow="Your corner of the community" title={`Welcome, ${user.first_name}.`} action={<ButtonLink to="/pledge">{t('Pledge to donate')}</ButtonLink>}>A small step today. A little more hope for tomorrow.</PageHeading>
    {next || <Loading />}
    <Notice>{summary.error}</Notice>
    {summary.data ? <Stats items={[['My requests', summary.data.requests, Heartbeat], ['Active pledges', summary.data.pledges, HandHeart], ['Active matches', summary.data.matches, Handshake], ['Donation records', summary.data.records, ClipboardText]]} /> : <Loading variant="cards" />}
    <div className="section-heading compact" id="match-updates"><div><span className="eyebrow">What’s happening</span><h2>{t('Match updates')}</h2></div></div>
    <Notice>{matches.error}</Notice>
    {!matches.data ? <Loading /> : matchRows.length ? <div className={`match-list ${matches.refreshing ? 'refreshing' : ''}`}>{matchRows.map((m) => <MatchUpdate key={m.id} match={m} resource={matches} onChanged={refresh} />)}</div> : <Empty title="No match updates yet">When a hospital proposes a match for your pledge or your request, it will appear here.</Empty>}
    <div className="section-heading compact"><div><span className="eyebrow">Your requests</span><h2>{t('My requests')}</h2></div><Link className="text-link" to="/requests/new">{t('Request an organ')} <Plus size={17} /></Link></div>
    {!mine.data ? <Loading variant="cards" /> : myRequests.length ? <div className="request-grid">{myRequests.slice(0, 4).map((r) => <RequestCard key={r.id} request={r} matches={matchRows} showJourney />)}</div> : <Empty title="No requests yet">Create a request with the patient’s treating hospital. The hospital verifies it and sets its medical priority.</Empty>}
    <div className="section-heading compact"><div><span className="eyebrow">Your willingness to help</span><h2>{t('My pledges')}</h2></div><Link className="text-link" to="/pledge">{t('Pledge to donate')} <Plus size={17} /></Link></div>
    <Notice>{pledges.error}</Notice>
    {!pledges.data ? <Loading /> : <DataTable columns={pledgeColumns(pledges, refresh, t)} rows={pledges.data} emptyTitle="You haven’t pledged yet" emptyText="Pledge once, and hospitals can find you as an anonymous donor for patients by medical priority." />}
    <div className="section-heading compact"><div><span className="eyebrow">The community</span><h2>{t('Recent organ requests')}</h2></div><Link className="text-link" to="/requests">View all <ArrowRight size={17} /></Link></div>
    {!community.data ? <Loading variant="cards" /> : community.data.length ? <div className="request-grid">{community.data.slice(0, 3).map((r) => <RequestCard key={r.id} request={r} />)}</div> : <Empty title="A fresh start for the community">Organ requests will appear here when members add them.</Empty>}
  </div>;
}

export function MyPledges() {
  const t = useT();
  const resource = useResource('/pledges');
  return <div className="page-container workspace"><PageHeading title={t('My pledges')} action={<ButtonLink to="/pledge">{t('Pledge to donate')}</ButtonLink>}>Manage your willingness to donate and follow each pledge.</PageHeading><Notice>{resource.error}</Notice>{!resource.data ? <Loading /> : <DataTable columns={pledgeColumns(resource, resource.refresh, t)} rows={resource.data} emptyTitle="You haven’t pledged yet" emptyText="Create a pledge to join the donor registry." />}</div>;
}

export function MyMatches() {
  const t = useT();
  const resource = useResource('/matches');
  const waiting = (resource.data || []).filter((m) => m.is_donor && m.status === 'proposed' && m.donor_response === 'pending');
  return <div className="page-container workspace"><PageHeading title={t('Matches')}>Follow your donation and request journeys.</PageHeading><Notice>{resource.error}</Notice>{!resource.data ? <Loading variant="cards" /> : <>
    <NextStep calm={!waiting.length} icon={waiting.length ? BellRinging : CheckCircle} title={waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'match is' : 'matches are'} waiting for your response` : 'You’re all caught up'} body={waiting.length ? 'Review the hospital details before accepting or declining.' : 'New proposals and confirmations will appear here.'} />
    {resource.data.length ? <div className="match-list">{resource.data.map((match) => <MatchUpdate key={match.id} match={match} resource={resource} />)}</div> : <Empty title="No matches yet">When a hospital proposes a match, you’ll see the full journey here.</Empty>}
  </>}</div>;
}

export function Requests() {
  const t = useT();
  const [params, setParams] = useSearchParams(); const mine = params.get('mine') === 'true'; const setMine = (value) => setParams(value ? { mine: 'true' } : {}); const [search, setSearch] = useState(''); const [organ, setOrgan] = useState(''); const [blood, setBlood] = useState(''); const [verification, setVerification] = useState('');
  const resource = useResource(`/requests${mine ? '?mine=true' : ''}`);
  const matches = useResource(mine ? '/matches' : null);
  const rows = resource.data?.filter((r) => (!organ || r.organ === organ) && (!blood || r.blood_group === blood) && (!verification || r.verification === verification) && `${r.organ} ${r.first_name} ${r.last_name} ${r.address} ${r.hospital_name || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page-container workspace">
    <PageHeading eyebrow="Find a way to make a difference" title="A request. A reason to hope." action={<ButtonLink to="/requests/new">{t('Create a request')}</ButtonLink>}>Hospitals verify each request and match pledged donors by medical priority.</PageHeading>
    <div className="tabs" role="group" aria-label="Request view"><button className={!mine ? 'active' : ''} aria-pressed={!mine} onClick={() => setMine(false)}>Open requests</button><button className={mine ? 'active' : ''} aria-pressed={mine} onClick={() => setMine(true)}>{t('My requests')}</button></div>
    <div className="filters"><SearchBox value={search} onChange={setSearch} placeholder="Search by name, organ, hospital or location" /><span className="filter-label"><Funnel size={18} /> Filter</span><select aria-label="Filter by organ" value={organ} onChange={(e) => setOrgan(e.target.value)}><option value="">All organs</option>{ORGANS.map((v) => <option key={v}>{v}</option>)}</select><select aria-label="Filter by blood group" value={blood} onChange={(e) => setBlood(e.target.value)}><option value="">All blood groups</option>{BLOOD_GROUPS.map((v) => <option key={v}>{v}</option>)}</select><select aria-label="Filter by verification" value={verification} onChange={(e) => setVerification(e.target.value)}><option value="">Any verification</option><option value="verified">Verified by hospital</option><option value="pending">{t('Awaiting hospital')}</option></select></div>
    <Notice>{resource.error}</Notice>
    {!resource.data ? <Loading variant="cards" /> : <div className={resource.refreshing ? 'refreshing' : ''}><p className="results-count">{rows.length} {rows.length === 1 ? 'request' : 'requests'} {mine ? 'created by you' : 'to explore'}</p>{rows.length ? <div className="request-grid">{rows.map((r) => <RequestCard key={r.id} request={r} matches={matches.data || []} showJourney={mine} />)}</div> : <Empty title="No requests found" action={<button className="text-button" onClick={() => { setSearch(''); setOrgan(''); setBlood(''); setVerification(''); }}>Clear filters</button>}>Try a different filter, or create a new request.</Empty>}</div>}
    <p className="quiet-note">Blood group filters help you browse. Compatibility and donor eligibility are assessed by the transplant team.</p>
  </div>;
}

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
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const request = useResource(`/requests/${id}`);
  const matches = useResource('/matches');
  if (!request.data) return request.error ? <div className="page-container"><Notice>{request.error}</Notice><Link className="text-link" to="/requests">Back to requests</Link></div> : <Loading />;
  const r = request.data;
  const owner = r.user_id === user.id || user.role === 'admin';
  const related = (matches.data || []).filter((m) => m.request_id === r.id);
  const active = related.find((m) => m.status === 'confirmed') || related.find((m) => m.status === 'proposed');
  const phase = r.status === 'closed' && !active ? 'closed' : active ? (active.status === 'confirmed' ? 'confirmed' : active.donor_response === 'accepted' ? 'accepted' : 'proposed') : r.verification;
  const setStatus = async (status) => { await request.mutate((row) => ({ ...row, status }), () => api(`/requests/${r.id}`, { method: 'PATCH', body: { status } })); matches.refresh(); };
  const facts = [
    ['Patient blood group', r.blood_group], ['Quantity', r.quantity], ['Urgency you reported', r.urgency === 'Not Emergency' ? t('Standard') : t(r.urgency)],
    ['Hospital', <>{r.hospital_name || '—'} {r.hospital_status === 'verified' && <VerifiedBadge />}</>], ['Verification', <Status value={r.verification} />],
    ['Priority set by hospital', r.priority ? <Status value={r.priority} /> : '—'], ['On the verified list since', r.verified_at ? formatDate(r.verified_at) : '—'],
    owner && ['Patient date of birth', r.patient_dob ? formatDate(r.patient_dob) : '—'], owner && ['Phone', r.phone], owner && ['Address', `${r.address} ${r.zip}`],
  ].filter(Boolean);
  return <div className="page-container workspace">
    <Link className="back-link" to="/requests"><ArrowLeft size={17} /> Back to requests</Link>
    <PageHeading eyebrow={`Request #${r.id} · ${formatDate(r.created_at)}`} title={`${r.organ} request`} action={owner && r.status === 'open' ? <ButtonLink secondary to={`/requests/${r.id}/edit`}>{t('Edit')}</ButtonLink> : null}>Requested by {r.first_name} {r.last_name}</PageHeading>
    <section className="panel"><Journey steps={requestJourney(r, related)} /><p className="muted">{STATE_COPY[phase]}</p>{r.verification === 'rejected' && r.hospital_note && <Notice>Hospital note: {r.hospital_note}</Notice>}</section>
    <div className="portal-grid">
      <section className="panel"><h2>Details</h2><dl className="detail-grid">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{owner && <PrivateHint />}{r.note && <p className="request-note">{r.note}</p>}</section>
      <section><h2 className="form-section-title">{t('Match updates')}</h2>{!matches.data ? <Loading /> : related.length ? <div className="match-list">{related.map((m) => <MatchUpdate key={m.id} match={m} resource={matches} onChanged={request.refresh} />)}</div> : <Empty title="No matches yet">When the hospital proposes a donor, you’ll see it here and get a notification.</Empty>}</section>
    </div>
    {owner && <div className="inline-actions">
      {r.status === 'open'
        ? <ConfirmButton danger={false} className="button secondary" title="Close this request?" description="Any proposed match will be declined. You can reopen the request later." confirmLabel={t('Close request')} success="Request closed." onConfirm={() => setStatus('closed')}>{t('Close request')}</ConfirmButton>
        : <ConfirmButton danger={false} className="button secondary" title="Reopen this request?" description="It will return to the open requests list." confirmLabel={t('Reopen request')} success="Request reopened." onConfirm={() => setStatus('open')}>{t('Reopen request')}</ConfirmButton>}
      <ConfirmButton title="Delete this request?" description="Requests with match history can’t be deleted; close them instead." confirmLabel={t('Delete')} busyLabel="Deleting…" success="Request deleted." onConfirm={async () => { await api(`/requests/${r.id}`, { method: 'DELETE' }); navigate('/requests'); }}>{t('Delete')}</ConfirmButton>
    </div>}
  </div>;
}

export function RequestForm() {
  const { id } = useParams();
  const resource = useResource(id ? `/requests/${id}` : null);
  if (id && !resource.data) return resource.error ? <div className="page-container"><Notice>{resource.error}</Notice><Link to="/requests">Back to requests</Link></div> : <Loading />;
  return <RequestEditor key={id || 'new'} initial={id ? resource.data : null} />;
}
function RequestEditor({ initial }) {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const action = useAsync();
  const hospitals = useResource('/hospitals');
  const draftKey = initial ? null : `request:${user.id}`;
  const draft = useDraftSaver(draftKey);
  const [formKey, setFormKey] = useState(0);
  const saved = useMemo(() => readDraft(draftKey)?.values || {}, [draftKey, formKey]);
  if (initial && initial.user_id !== user.id && user.role !== 'admin') return <div className="page-container"><Notice>You can only edit your own requests.</Notice><Link to="/requests">Back to requests</Link></div>;
  const d = { ...(initial || { blood_group: user.blood_group, phone: user.phone, zip: user.zip, address: user.address, quantity: 1, urgency: 'Not Emergency' }), ...saved };
  const options = (hospitals.data || []).map(hospitalOption);
  if (initial?.hospital_id && hospitals.data && !options.some((o) => o.value === String(initial.hospital_id))) options.push({ value: String(initial.hospital_id), label: `${initial.hospital_name} (no longer verified)` });
  const steps = [
    { title: 'Patient', content: <><h3 className="form-section-title">Patient and organ</h3><div className="fields"><Field label="Organ type" name="organ" options={ORGANS} defaultValue={d.organ || ''} /><Field label="Patient blood group" name="blood_group" options={BLOOD_GROUPS} defaultValue={d.blood_group || ''} /><Field label="Patient date of birth" name="patient_dob" type="date" min="1900-01-01" max={today()} defaultValue={d.patient_dob || ''} hint={<PrivateHint />} /><Field label="Quantity" name="quantity" type="number" min={1} max={7} defaultValue={d.quantity} /><Field label="Urgency as you understand it" name="urgency" options={URGENCIES.map((v) => ({ value: v, label: v === 'Not Emergency' ? 'Standard' : v }))} defaultValue={d.urgency} wide hint="The treating hospital sets the priority used for matching." /></div></> },
    { title: 'Hospital', blocked: !hospitals.data || !options.length, content: <><h3 className="form-section-title">Treating hospital</h3>{!hospitals.data ? <Loading /> : options.length ? <div className="fields"><Combobox label="Hospital" name="hospital_id" options={options} defaultValue={d.hospital_id ? String(d.hospital_id) : ''} placeholder="Search by hospital name or city" wide hint="Only hospitals verified by OrganoTale are listed." /></div> : <Notice>No verified hospitals yet. The patient’s treating hospital needs to <Link to="/hospital/register">register on OrganoTale</Link> and be approved before a request can be created.</Notice>}</> },
    { title: 'Contact', content: <><h3 className="form-section-title">Location and contact</h3><div className="fields"><Field label="Address or area" name="address" defaultValue={d.address} maxLength={300} wide /><LocationFields initial={{ zip: d.zip }} pinName="zip" includeLocation={false} /><Field label="Phone number" name="phone" type="tel" defaultValue={d.phone} pattern="[+0-9 .\(\)\-]{7,25}" hint={<PrivateHint />} /><Field label="Note for the community" name="note" defaultValue={d.note || ''} multiline required={false} placeholder="Keep private medical details out." wide /></div></> },
    { title: 'Review', content: (v) => <><h3 className="form-section-title">Check the details</h3><ReviewList items={[['Organ', v.organ], ['Patient blood group', v.blood_group], ['Patient date of birth', v.patient_dob && formatDate(v.patient_dob)], ['Quantity', v.quantity], ['Urgency', v.urgency === 'Not Emergency' ? 'Standard' : v.urgency], ['Hospital', options.find((o) => o.value === v.hospital_id)?.label], ['Address', v.address], ['Postal code', v.zip], ['Phone', v.phone], ['Note', v.note]]} />{initial?.verification === 'verified' && <Notice>Changing the organ, blood group, hospital, or patient date of birth sends this request back to the hospital for verification.</Notice>}</> },
  ];
  return <FormShell back={initial ? `/requests/${initial.id}` : '/requests'} backLabel={initial ? 'Back to request' : 'Back to requests'} eyebrow="Share your need with the community" title={initial ? 'Edit your request' : t('Request an organ')} description="The treating hospital verifies your request and sets its medical priority for matching." aside={<p>Your name, hospital, city, and note are visible to signed-in members. The patient’s date of birth and your contact details are shared only with the hospital and administrators.</p>}>
    <Wizard key={formKey} steps={steps} busy={action.busy} error={action.error || hospitals.error} submitLabel={initial ? 'Save changes' : t('Create a request')} draft={initial ? null : draft} onDiscard={() => { draft.clear(); setFormKey((k) => k + 1); }}
      onSubmit={(body) => action.run(async () => {
        const result = await api(initial ? `/requests/${initial.id}` : '/requests', { method: initial ? 'PATCH' : 'POST', body });
        draft.clear();
        navigate(`/requests/${initial ? initial.id : result.id}`);
      }, { success: initial ? 'Request updated.' : 'Request created. The hospital has been notified.' })} />
  </FormShell>;
}

export function PledgeForm() {
  const t = useT();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const draftKey = `pledge:${user.id}`;
  const draft = useDraftSaver(draftKey);
  const [formKey, setFormKey] = useState(0);
  const [done, setDone] = useState(false);
  const saved = useMemo(() => readDraft(draftKey)?.values || {}, [draftKey, formKey]);
  if (done) return <div className="page-container success-page"><span className="success-symbol"><CheckCircle size={55} /></span><span className="eyebrow">Your pledge is recorded</span><h1>Thank you for offering hope.</h1><p>Hospitals can now find you as an anonymous donor for patients who need this organ, ranked by medical priority. Any proposed match will appear on your dashboard and in your notifications.</p><ButtonLink to="/dashboard">Go to my dashboard</ButtonLink></div>;
  return <FormShell eyebrow="A willingness to help" title={t('Pledge to donate')} description="Pledge once. Hospitals match pledged donors to verified patients by medical priority." aside={<><p>Hospitals see your pledge as an anonymous donor number with your health answers. Your name and contact details are shared only if you accept a proposed match.</p><p>A living donor can give a kidney, or part of a liver, lung, pancreas, or intestine. Heart, eyes, and heart valves are pledged for donation after death.</p></>}>
    <PledgeWizard key={formKey} saved={saved} initialOrgan={ORGANS.includes(params.get('organ')) ? params.get('organ') : ''} draft={draft} user={user} onDiscard={() => { draft.clear(); setFormKey((k) => k + 1); }} onDone={() => { draft.clear(); setDone(true); window.scrollTo(0, 0); }} />
  </FormShell>;
}
function PledgeWizard({ saved, initialOrgan, draft, user, onDiscard, onDone }) {
  const action = useAsync();
  const [organ, setOrgan] = useState(saved.organ || initialOrgan);
  const [donorType, setDonorType] = useState(saved.donor_type || 'living');
  
  const livingNotAllowed = Boolean(organ) && donorType === 'living' && !LIVING_ORGANS.includes(organ);
  const steps = [
    { title: 'Organ', blocked: livingNotAllowed, content: <><h3 className="form-section-title">Your pledge</h3><div className="fields"><Field label="Organ" name="organ" options={ORGANS} value={organ} onChange={(e) => setOrgan(e.target.value)} /><Field label="Donation type" name="donor_type" options={[{ value: 'living', label: 'Living donation' }, { value: 'deceased', label: 'After death (registry)' }]} value={donorType} onChange={(e) => setDonorType(e.target.value)} /></div>{livingNotAllowed && <Notice>{organ} can only be pledged for donation after death. Choose “After death (registry)”.</Notice>}</> },
    { title: 'Health', content: <><h3 className="form-section-title">A few details about you</h3><div className="fields"><Field label="Height (cm)" name="height" type="number" min={50} max={260} step="0.1" placeholder="e.g. 170" defaultValue={saved.height || ''} /><Field label="Weight (kg)" name="weight" type="number" min={10} max={500} step="0.1" placeholder="e.g. 65" defaultValue={saved.weight || ''} /><Field label="Last donation date" name="last_donation" type="date" min="1900-01-01" max={today()} required={false} defaultValue={saved.last_donation || ''} wide /></div><h3 className="form-section-title separated">Health history</h3><div className="fields"><Field label="Previous operations" name="operation_type" options={['None', 'Minor', 'Major']} defaultValue={saved.operation_type || 'None'} /><Field label="Operation details" name="operation_desc" required={false} defaultValue={saved.operation_desc || ''} /><Field label="Disease history" name="disease_type" options={['None', 'Acute', 'Chronic']} defaultValue={saved.disease_type || 'None'} /><Field label="Disease details" name="disease_desc" required={false} defaultValue={saved.disease_desc || ''} /><Field label="Accident history" name="accident_type" options={['None', 'Minor', 'Critical']} defaultValue={saved.accident_type || 'None'} /><Field label="Accident details" name="accident_desc" required={false} defaultValue={saved.accident_desc || ''} /><Field label="Currently pregnant" name="pregnant" options={HEALTH_OPTIONS} defaultValue={saved.pregnant || 'Not applicable'} /><Field label="Currently menstruating" name="menstruation" options={HEALTH_OPTIONS} defaultValue={saved.menstruation || 'Not applicable'} /></div><p className="field-hint"><WarningCircle size={14} /> Hospitals see these answers with an anonymous donor number.</p></> },
    { title: 'Location', content: <><h3 className="form-section-title">Where you live</h3><div className="fields"><LocationFields initial={{ ...saved, city: saved.city ?? user.address?.split(',')[0]?.trim() ?? '' }} required={false} /></div></> },
    { title: 'Review', content: (v) => <><h3 className="form-section-title">Check your pledge</h3><ReviewList items={[['Organ', v.organ], ['Donation type', v.donor_type === 'deceased' ? 'After death (registry)' : 'Living donation'], ['City', v.city], ['State', v.state], ['Height / weight', v.height && `${v.height} cm / ${v.weight} kg`], ['Last donation', v.last_donation && formatDate(v.last_donation)], ['Operations', v.operation_type], ['Disease history', v.disease_type], ['Accident history', v.accident_type]]} /><label className="checkbox-label"><input name="consent" type="checkbox" required /><span>I understand that a pledge is not a medical clearance, that hospitals decide eligibility, that I can withdraw at any time, and that offering or accepting payment for organs is illegal.</span></label></> },
  ];
  return <Wizard steps={steps} busy={action.busy} error={action.error} submitLabel="Save pledge" draft={draft} onDiscard={onDiscard}
    onSubmit={(body) => action.run(async () => { await api('/pledges', { method: 'POST', body: { ...body, consent: body.consent === 'on' } }); onDone(); }, { success: 'Pledge saved.' })} />;
}

export function Records() {
  const t = useT();
  const resource = useResource('/records'); const { user } = useAuth(); const [showForm, setShowForm] = useState(false); const action = useAsync(); const toast = useToast();
  const columns = [
    { key: 'organ', header: 'Organ', render: (r) => <strong>{r.organ}</strong> },
    { key: 'blood_group', header: 'Blood group', render: (r) => <span className="blood-type">{r.blood_group}</span> },
    { key: 'quantity', header: 'Quantity' },
    { key: 'donated_on', header: 'Donation date', render: (r) => formatDate(r.donated_on) },
    { key: 'note', header: 'Personal note', sortable: false, render: (r) => r.note || '—' },
    { key: 'action', header: 'Action', sortable: false, render: (r) => <ConfirmButton title="Delete this record?" confirmLabel={t('Delete')} busyLabel="Deleting…" success="Record deleted." onConfirm={async () => { await resource.mutate((rows) => rows.filter((row) => row.id !== r.id), () => api(`/records/${r.id}`, { method: 'DELETE' })); }}>{t('Delete')}</ConfirmButton> },
  ];
  return <div className="page-container workspace">
    <PageHeading eyebrow="A personal record of your journey" title="Every act has a story." action={<button className="button" onClick={() => setShowForm(!showForm)}><Plus size={18} />{showForm ? 'Close form' : 'Add a record'}</button>}>Keep your donation history together, one meaningful moment at a time.</PageHeading>
    {showForm && <div className="record-form panel"><h2>Add a donation record</h2><p>These are your self-reported records, separate from pledges and hospital matches.</p><form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const body = formValues(form); action.run(async () => { await api('/records', { method: 'POST', body }); form.reset(); setShowForm(false); toast('Your donation record has been saved.'); resource.refresh(); }); }}><div className="fields"><Field label="Organ type" name="organ" options={ORGANS} /><Field label="Blood group" name="blood_group" options={BLOOD_GROUPS} defaultValue={user.blood_group} /><Field label="Quantity" name="quantity" type="number" min={1} max={7} defaultValue={1} /><Field label="Donation date" name="donated_on" type="date" min="1900-01-01" max={today()} /><Field label="Personal note" name="note" multiline required={false} wide /></div><Notice>{action.error}</Notice><div className="form-actions"><button className="text-button" type="button" onClick={() => setShowForm(false)}>{t('Cancel')}</button><button className="button" disabled={action.busy}>{action.busy ? 'Saving…' : t('Save')}<ArrowRight size={18} /></button></div></form></div>}
    <Notice>{resource.error}</Notice>
    {!resource.data ? <Loading /> : <>{resource.data.length > 0 && <Stats items={[['Personal records', resource.data.length, ClipboardText], ['Total quantity recorded', resource.data.reduce((sum, r) => sum + r.quantity, 0), HandHeart]]} />}<DataTable columns={columns} rows={resource.data} initialSort={{ key: 'donated_on', dir: 'desc' }} emptyTitle="Your story has room to grow" emptyText="Keep a personal record of past donations and the moments that matter." /></>}
  </div>;
}
