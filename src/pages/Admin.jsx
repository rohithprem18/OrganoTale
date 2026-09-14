import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Handshake, HandHeart, Heartbeat, Hospital, WarningCircle, XCircle } from '@phosphor-icons/react';
import { api } from '../api';
import { useT } from '../i18n';
import { useResource, Notice, Loading, Empty, PageHeading, Status, Stats, SearchBox, ConfirmButton, ScoreBreakdown, FlagList, NextStep, DataTable, BarChart, formatDate, formatDateTime } from '../components';

const TABS = [['overview', 'Overview'], ['hospitals', 'Hospitals'], ['members', 'Members'], ['requests', 'Requests'], ['pledges', 'Pledges'], ['matches', 'Matches'], ['records', 'Records'], ['audit', 'Audit log']];

export function Admin() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'overview';
  const resource = useResource('/admin/dashboard');
  const analytics = useResource(tab === 'overview' ? '/admin/analytics' : null);
  const [search, setSearch] = useState('');
  const [ranking, setRanking] = useState(null);
  const data = resource.data;
  const find = (rows, ...fields) => rows.filter((row) => fields.map((field) => row[field] ?? '').join(' ').toLowerCase().includes(search.toLowerCase()));
  const setHospital = async (hospital, status) => { await resource.mutate((data) => ({ ...data, hospitals: data.hospitals.map((h) => h.id === hospital.id ? { ...h, status } : h) }), () => api(`/admin/hospitals/${hospital.id}`, { method: 'PATCH', body: { status } })); analytics.refresh(); };
  return <div className="page-container workspace">
    <PageHeading eyebrow="National coordination" title="Care starts with coordination.">Verify hospitals, oversee priority matching, and review every decision on the record.</PageHeading>
    <Notice>{resource.error}</Notice>
    <div className="admin-toolbar"><div className="tabs" role="group" aria-label="Administration view">{TABS.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} className={tab === key ? 'active' : ''} onClick={() => { setSearch(''); setParams(key === 'overview' ? {} : { tab: key }); }}>{t(label)}</button>)}</div>{!['overview', 'audit'].includes(tab) && <SearchBox value={search} onChange={setSearch} placeholder="Search this list" />}</div>
    {!data ? <Loading variant="cards" /> : <div className={resource.refreshing ? 'refreshing' : ''}>
      {tab === 'overview' && <Overview data={data} analytics={analytics} onTab={(key) => setParams({ tab: key })} />}
      {tab === 'hospitals' && <DataTable rows={find(data.hospitals, 'name', 'registration_number', 'city', 'state', 'email')} emptyTitle="No hospitals" columns={[
        { key: 'name', header: 'Hospital', render: (h) => <><strong>{h.name}</strong><small>{h.registration_number}</small></> },
        { key: 'state', header: 'Location', render: (h) => `${h.city}, ${h.state} ${h.pincode}` },
        { key: 'email', header: 'Contact', render: (h) => <>{h.email}<small>{h.phone}</small></> },
        { key: 'request_count', header: 'Requests' },
        { key: 'created_at', header: 'Joined', render: (h) => formatDate(h.created_at) },
        { key: 'status', header: 'Status', render: (h) => <Status value={h.status} /> },
        { key: 'action', header: 'Action', sortable: false, render: (h) => h.status === 'verified'
          ? <ConfirmButton title={`Suspend ${h.name}?`} description="Its staff lose portal access and its requests leave priority matching until reinstated." confirmLabel={t('Suspend')} busyLabel="Suspending…" success={`${h.name} suspended.`} onConfirm={() => setHospital(h, 'suspended')}>{t('Suspend')}</ConfirmButton>
          : <ConfirmButton danger={false} title={`${h.status === 'suspended' ? 'Reinstate' : 'Verify'} ${h.name}?`} description="Its staff will be able to verify patient requests and propose matches. They’ll be notified." confirmLabel={h.status === 'suspended' ? t('Reinstate') : t('Verify')} success={`${h.name} is verified.`} onConfirm={() => setHospital(h, 'verified')}>{h.status === 'suspended' ? t('Reinstate') : t('Verify')}</ConfirmButton> },
      ]} initialSort={{ key: 'status', dir: 'asc' }} />}
      {tab === 'members' && <DataTable rows={find(data.users, 'first_name', 'last_name', 'email', 'role', 'hospital_name')} emptyTitle="No accounts" columns={[
        { key: 'first_name', header: 'Account', render: (u) => <><strong>{u.first_name} {u.last_name}</strong>{u.hospital_name && <small>{u.hospital_name}</small>}</> },
        { key: 'email', header: 'Email' },
        { key: 'role', header: 'Role' },
        { key: 'blood_group', header: 'Blood group', render: (u) => u.blood_group || '—' },
        { key: 'created_at', header: 'Joined', render: (u) => formatDate(u.created_at) },
        { key: 'action', header: 'Action', sortable: false, render: (u) => u.role === 'admin' ? '—' : <ConfirmButton title={`Delete ${u.first_name}’s account?`} description="This also deletes their requests, pledges, and records." confirmLabel={t('Delete')} busyLabel="Deleting…" success="Account deleted." onConfirm={async () => { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); resource.refresh(); }}>{t('Delete')}</ConfirmButton> },
      ]} />}
      {tab === 'requests' && <DataTable rows={find(data.requests, 'first_name', 'last_name', 'organ', 'hospital_name')} emptyTitle="No requests" columns={[
        { key: 'first_name', header: 'Member', render: (r) => <>{r.first_name} {r.last_name}<small>#{r.id}</small></> },
        { key: 'organ', header: 'Organ', render: (r) => <strong>{r.organ}</strong> },
        { key: 'blood_group', header: 'Blood group' },
        { key: 'hospital_name', header: 'Hospital', render: (r) => r.hospital_name || '—' },
        { key: 'verification', header: 'Verification', render: (r) => <Status value={r.verification} /> },
        { key: 'priority', header: 'Priority', render: (r) => r.priority ? <Status value={r.priority} /> : '—' },
        { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
        { key: 'action', header: 'Action', sortable: false, render: (r) => <Link className="text-link" to={`/requests/${r.id}`}>{t('Review')}</Link> },
      ]} />}
      {tab === 'pledges' && <DataTable rows={find(data.pledges, 'first_name', 'last_name', 'organ', 'city', 'state')} emptyTitle="No pledges" columns={[
        { key: 'first_name', header: 'Donor', render: (p) => <>{p.first_name} {p.last_name}<small>Pledge #{p.id} · {p.blood_group}</small></> },
        { key: 'organ', header: 'Organ', render: (p) => <strong>{p.organ}</strong> },
        { key: 'donor_type', header: 'Donation', render: (p) => <Status value={p.donor_type} /> },
        { key: 'state', header: 'Location', render: (p) => `${p.city}, ${p.state}` },
        { key: 'status', header: 'Status', render: (p) => <><Status value={p.status} />{p.available_at && <small>Available at {p.available_hospital_name}</small>}</> },
        { key: 'created_at', header: 'Pledged', render: (p) => formatDate(p.created_at) },
        { key: 'ranking', header: 'Ranking', sortable: false, render: (p) => <button type="button" className="text-button" aria-expanded={ranking === p.id} onClick={() => setRanking(ranking === p.id ? null : p.id)}>{ranking === p.id ? 'Hide' : 'Recipients'}</button> },
      ]} renderAfterRow={(p, span) => ranking === p.id && <tr className="ranking-row"><td colSpan={span}><RecipientRanking pledgeId={p.id} /></td></tr>} />}
      {tab === 'matches' && <DataTable rows={find(data.matches, 'organ', 'hospital_name', 'requester_first_name', 'requester_last_name', 'donor_first_name', 'donor_last_name')} emptyTitle="No matches yet" initialSort={{ key: 'id', dir: 'desc' }} columns={[
        { key: 'id', header: 'Match', render: (m) => <>#{m.id}<small>{formatDate(m.created_at)}</small></> },
        { key: 'organ', header: 'Organ', render: (m) => <strong>{m.organ}</strong> },
        { key: 'hospital_name', header: 'Hospital' },
        { key: 'requester_first_name', header: 'Recipient', render: (m) => `${m.requester_first_name} ${m.requester_last_name}` },
        { key: 'donor_first_name', header: 'Donor', render: (m) => `${m.donor_first_name} ${m.donor_last_name}` },
        { key: 'score', header: 'Score', render: (m) => <>{m.score}<small>rank #{m.recipient_rank}{m.override_reason ? ' · override' : ''}</small></> },
        { key: 'donor_response', header: 'Donor response', render: (m) => <Status value={m.donor_response} /> },
        { key: 'status', header: 'Status', render: (m) => <><Status value={m.status} />{m.decision_reason && <small>{m.decision_reason}</small>}</> },
      ]} />}
      {tab === 'records' && <DataTable rows={find(data.records, 'first_name', 'last_name', 'organ')} emptyTitle="No donation records yet" columns={[
        { key: 'first_name', header: 'Member', render: (r) => `${r.first_name} ${r.last_name}` },
        { key: 'organ', header: 'Organ', render: (r) => <strong>{r.organ}</strong> },
        { key: 'blood_group', header: 'Blood group' },
        { key: 'quantity', header: 'Quantity' },
        { key: 'donated_on', header: 'Donation date', render: (r) => formatDate(r.donated_on) },
        { key: 'note', header: 'Note', sortable: false, render: (r) => r.note || '—' },
      ]} />}
      {tab === 'audit' && <AuditLog events={data.events} />}
    </div>}
  </div>;
}

function Overview({ data, analytics, onTab }) {
  const pending = data.hospitals.filter((h) => h.status === 'pending');
  const a = analytics.data;
  return <>
    {pending.length
      ? <NextStep icon={Hospital} title={`${pending.length} ${pending.length === 1 ? 'hospital awaits' : 'hospitals await'} verification`} body={pending.slice(0, 3).map((h) => h.name).join(', ')} action="Review hospitals" onClick={() => onTab('hospitals')} />
      : <NextStep calm icon={CheckCircle} title="No hospitals are waiting for verification" body="New registrations appear here and in your notifications." />}
    <Stats items={[['Hospitals awaiting verification', pending.length, Hospital], ['Verified open requests', data.requests.filter((r) => r.status === 'open' && r.verification === 'verified').length, Heartbeat], ['Active pledges', data.pledges.filter((p) => p.status === 'active').length, HandHeart], ['Active matches', data.matches.filter((m) => ['proposed', 'confirmed'].includes(m.status)).length, Handshake]]} />
    <Notice>{analytics.error}</Notice>
    {!a ? <Loading variant="cards" /> : <div className="chart-grid">
      <BarChart title="Open requests by organ" subtitle="All open requests" data={a.requestsByOrgan.map((r) => ({ label: r.organ, value: r.open, detail: `${r.verified} verified` }))} emptyText="No open requests." />
      <BarChart title="Average days on the verified list" subtitle="Open, verified requests by organ" data={a.waitingByOrgan.map((r) => ({ label: r.organ, value: r.days, detail: `${r.requests} ${r.requests === 1 ? 'request' : 'requests'}` }))} format={(v) => `${v} d`} emptyText="No verified open requests." />
      <BarChart title="Confirmed matches by state" subtitle="Where the treating hospital is located" data={a.matchesByState.filter((r) => r.confirmed > 0).map((r) => ({ label: r.state, value: r.confirmed, detail: `${r.proposed} still proposed` }))} emptyText="No confirmed matches yet." />
      <BarChart title="Hospitals awaiting verification" subtitle="Pending registrations by state" data={Object.entries(pending.reduce((counts, h) => ({ ...counts, [h.state]: (counts[h.state] || 0) + 1 }), {})).map(([label, value]) => ({ label, value }))} emptyText="No hospitals awaiting verification." />
    </div>}
  </>;
}

function RecipientRanking({ pledgeId }) {
  const resource = useResource(`/admin/pledges/${pledgeId}/recipients`);
  if (!resource.data) return resource.error ? <Notice>{resource.error}</Notice> : <Loading />;
  const { recipients, notice, flags } = resource.data;
  return <div className="ranking">{notice && <p className="rank-note warn">{notice}</p>}<FlagList flags={flags} />{recipients.length ? <ol className="ranking-list">{recipients.map((r) => <li key={r.request_id} className="candidate"><div><span className="eyebrow">#{r.rank} · Request #{r.request_id}</span><h3>{r.organ} · {r.blood_group} <span className="muted">({r.blood_match.replace('-', ' ')})</span></h3><div className="candidate-meta"><span>{r.hospital_name}, {r.city}</span><span>Priority <Status value={r.priority} /></span><span>Patient age {r.patient_age ?? '—'}</span><span>Verified {formatDate(r.verified_at)}</span></div></div><ScoreBreakdown score={r.score} breakdown={r.breakdown} /></li>)}</ol> : !notice && <Empty title="No eligible recipients">No verified open request can receive this pledge right now.</Empty>}</div>;
}

const DANGER = ['rejected', 'declined', 'status_suspended', 'deleted', 'withdrawn', 'donor_declined'];
const WARN = ['donor_lookup', 'status_pending', 'updated'];
function describeEvent(e) {
  const who = e.first_name ? `${e.first_name} ${e.last_name}` : e.actor_id ? 'A deleted account' : 'The system';
  const d = e.detail || {};
  const id = `#${e.entity_id}`;
  const text = {
    registered: `${who} registered ${d.name || `hospital ${id}`}`,
    status_verified: `${who} verified hospital ${id}`,
    status_suspended: `${who} suspended hospital ${id}`,
    status_pending: `${who} moved hospital ${id} back to pending`,
    created: e.entity === 'pledge' ? `${who} pledged ${d.organ || 'an organ'} (${d.donor_type === 'deceased' ? 'after death' : 'living'})` : `${who} created ${d.organ ? `a ${d.organ.toLowerCase()} ` : ''}request ${id}`,
    updated: `${who} updated request ${id}${d.verification_reset ? ', sending it back for verification' : ''}`,
    verified: `${who} verified request ${id} as ${d.priority}${d.clinical_score ? ` (clinical score ${d.clinical_score})` : ''}`,
    rejected: `${who} rejected request ${id}${d.note ? `: “${d.note}”` : ''}`,
    withdrawn: `${who} withdrew pledge ${id}`,
    reactivated: `${who} reactivated pledge ${id}`,
    proposed: `${who} proposed match ${id} (score ${d.score}, rank #${d.rank} of ${d.competing_recipients})${d.override_reason ? ` with override: “${d.override_reason}”` : ''}`,
    donor_accepted: `The donor accepted match ${id}`,
    donor_declined: `The donor declined match ${id}${d.reason ? `: “${d.reason}”` : ''}`,
    confirmed: `${who} confirmed match ${id}${d.request_closed ? ', fulfilling the request' : ''}`,
    declined: `${who} declined match ${id}${d.reason ? `: “${d.reason}”` : ''}`,
    reported_available: `${who} reported after-death pledge ${id} available`,
    donor_lookup: `${who} searched the donor registry for ${d.email} (${d.results} found)`,
    deleted: `${who} deleted the ${d.role} account ${d.email}`,
    promoted_admin: `Account ${id} was made an administrator`,
  }[e.action] || `${who} ${e.action.replaceAll('_', ' ')} ${e.entity} ${id}`;
  return { text, tone: DANGER.includes(e.action) ? 'danger' : WARN.includes(e.action) || d.override_reason ? 'warn' : '' };
}
function AuditLog({ events }) {
  const [entity, setEntity] = useState('');
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(25);
  const rows = events.map((e) => ({ ...e, described: describeEvent(e) })).filter((e) => (!entity || e.entity === entity) && (!role || e.role === role) && e.described.text.toLowerCase().includes(search.toLowerCase()));
  return <>
    <div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search the audit log" /><select aria-label="Filter by record type" value={entity} onChange={(e) => setEntity(e.target.value)}><option value="">All records</option>{['hospital', 'request', 'pledge', 'match', 'user'].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}s</option>)}</select><select aria-label="Filter by who acted" value={role} onChange={(e) => setRole(e.target.value)}><option value="">Everyone</option><option value="admin">Administrators</option><option value="hospital">Hospital staff</option><option value="member">Members</option></select></div>
    {rows.length ? <ol className="timeline">{rows.slice(0, limit).map((e) => <li key={e.id}><span className={`timeline-icon ${e.described.tone}`} aria-hidden="true">{e.described.tone === 'danger' ? <XCircle size={17} /> : e.described.tone === 'warn' ? <WarningCircle size={17} /> : <CheckCircle size={17} />}</span><div><small>{formatDateTime(e.created_at)} · {e.entity} #{e.entity_id}{e.role ? ` · ${e.role}` : ''}</small><p>{e.described.text}</p></div></li>)}</ol> : <Empty title="No matching events">Try a different filter.</Empty>}
    {rows.length > limit && <button type="button" className="button secondary" onClick={() => setLimit(limit + 25)}>Show more</button>}
    <p className="quiet-note">Showing the most recent 200 events.</p>
  </>;
}
