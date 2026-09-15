import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle, Handshake, HandHeart, Heartbeat, Hospital, WarningCircle, XCircle } from '@phosphor-icons/react';
import { api } from '../api';
import { describeEvent } from '../audit-text';
import { MatchPdfButton } from '../ExportPdf';
import { useResource, Notice, Loading, Status, SearchBox, ConfirmButton, ScoreBreakdown, FlagList, DataTable, BarChart, AppHeader, StatStrip, Box, InlineEmpty, formatDate, formatDateTime } from '../components';

const SECTIONS = { overview: 'Overview', hospitals: 'Hospitals', members: 'Members', requests: 'Requests', pledges: 'Pledges', matches: 'Matches', records: 'Records', audit: 'Audit log' };

export function Admin() {
  const [params] = useSearchParams();
  const tab = SECTIONS[params.get('tab')] ? params.get('tab') : 'overview';
  const resource = useResource('/admin/dashboard');
  const analytics = useResource(tab === 'overview' ? '/admin/analytics' : null);
  const [search, setSearch] = useState('');
  const [ranking, setRanking] = useState(null);
  useEffect(() => { setSearch(''); setRanking(null); }, [tab]);
  const data = resource.data;
  const find = (rows, ...fields) => rows.filter((row) => fields.map((field) => row[field] ?? '').join(' ').toLowerCase().includes(search.toLowerCase()));
  const setHospital = async (hospital, status) => { await resource.mutate((d) => ({ ...d, hospitals: d.hospitals.map((h) => h.id === hospital.id ? { ...h, status } : h) }), () => api(`/admin/hospitals/${hospital.id}`, { method: 'PATCH', body: { status } })); analytics.refresh(); };
  const pendingCount = data ? data.hospitals.filter((h) => h.status === 'pending').length : 0;
  const totals = data && { hospitals: data.hospitals.length, members: data.users.length, requests: data.requests.length, pledges: data.pledges.length, matches: data.matches.length, records: data.records.length };
  const subtitle = !data ? '' : tab === 'overview' ? 'Hospitals, requests, pledges, and matches across OrganoTale' : tab === 'audit' ? 'Every verification, proposal, override, and decision' : `${totals[tab]} total`;
  const headerAction = tab === 'overview' && pendingCount > 0 ? <Link className="button" to="/admin?tab=hospitals">{pendingCount} {pendingCount === 1 ? 'hospital' : 'hospitals'} to verify <ArrowRight size={18} /></Link> : null;
  // A searchable list that fills the screen; its table scrolls inside the panel.
  const list = (rows, table) => <Box scroll className="grow" head={<><SearchBox value={search} onChange={setSearch} placeholder={`Search ${SECTIONS[tab].toLowerCase()}`} /><span className="results">{rows.length} shown</span></>} bodyClass="flush">{table(rows)}</Box>;
  return <div className="screen">
    <AppHeader title={SECTIONS[tab]} subtitle={subtitle} actions={headerAction} />
    <Notice>{resource.error}</Notice>
    {!data ? <Loading variant="cards" /> : <>
      {tab === 'overview' && <Overview data={data} analytics={analytics} />}
      {tab === 'hospitals' && list(find(data.hospitals, 'name', 'registration_number', 'city', 'state', 'email'), (rows) => <DataTable rows={rows} emptyTitle="No hospitals match." initialSort={{ key: 'status', dir: 'asc' }} columns={[
        { key: 'name', header: 'Hospital', render: (h) => <><strong>{h.name}</strong><small>{h.registration_number}</small></> },
        { key: 'state', header: 'Location', render: (h) => `${h.city}, ${h.state} ${h.pincode}` },
        { key: 'email', header: 'Contact', render: (h) => <>{h.email}<small>{h.phone}</small></> },
        { key: 'request_count', header: 'Requests' },
        { key: 'created_at', header: 'Joined', render: (h) => formatDate(h.created_at) },
        { key: 'status', header: 'Status', render: (h) => <Status value={h.status} /> },
        { key: 'action', header: 'Action', sortable: false, render: (h) => h.status === 'verified'
          ? <ConfirmButton title={`Suspend ${h.name}?`} description="Its staff lose portal access and its requests leave priority matching until reinstated." confirmLabel="Suspend" busyLabel="Suspending…" success={`${h.name} suspended.`} onConfirm={() => setHospital(h, 'suspended')}>Suspend</ConfirmButton>
          : <ConfirmButton danger={false} title={`${h.status === 'suspended' ? 'Reinstate' : 'Verify'} ${h.name}?`} description="Its staff will be able to verify patient requests and propose matches. They’ll be notified." confirmLabel={h.status === 'suspended' ? 'Reinstate' : 'Verify'} success={`${h.name} is verified.`} onConfirm={() => setHospital(h, 'verified')}>{h.status === 'suspended' ? 'Reinstate' : 'Verify'}</ConfirmButton> },
      ]} />)}
      {tab === 'members' && list(find(data.users, 'first_name', 'last_name', 'email', 'role', 'hospital_name'), (rows) => <DataTable rows={rows} emptyTitle="No accounts match." columns={[
        { key: 'first_name', header: 'Account', render: (u) => <><strong>{u.first_name} {u.last_name}</strong>{u.hospital_name && <small>{u.hospital_name}</small>}</> },
        { key: 'email', header: 'Email' },
        { key: 'role', header: 'Role' },
        { key: 'blood_group', header: 'Blood group', render: (u) => u.blood_group || '—' },
        { key: 'created_at', header: 'Joined', render: (u) => formatDate(u.created_at) },
        { key: 'action', header: 'Action', sortable: false, render: (u) => u.role === 'admin' ? '—' : <ConfirmButton title={`Delete ${u.first_name}’s account?`} description="This also deletes their requests, pledges, and records." confirmLabel="Delete" busyLabel="Deleting…" success="Account deleted." onConfirm={async () => { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); resource.refresh(); }}>Delete</ConfirmButton> },
      ]} />)}
      {tab === 'requests' && list(find(data.requests, 'first_name', 'last_name', 'organ', 'hospital_name'), (rows) => <DataTable rows={rows} emptyTitle="No requests match." columns={[
        { key: 'first_name', header: 'Member', render: (r) => <>{r.first_name} {r.last_name}<small>#{r.id}</small></> },
        { key: 'organ', header: 'Organ', render: (r) => <strong>{r.organ}</strong> },
        { key: 'blood_group', header: 'Blood group' },
        { key: 'hospital_name', header: 'Hospital', render: (r) => r.hospital_name || '—' },
        { key: 'verification', header: 'Verification', render: (r) => <Status value={r.verification} /> },
        { key: 'priority', header: 'Priority', render: (r) => r.priority ? <Status value={r.priority} /> : '—' },
        { key: 'status', header: 'Status', render: (r) => <Status value={r.status} /> },
        { key: 'action', header: 'Action', sortable: false, render: (r) => <Link className="text-link" to={`/requests/${r.id}`}>Open</Link> },
      ]} />)}
      {tab === 'pledges' && list(find(data.pledges, 'first_name', 'last_name', 'organ', 'city', 'state'), (rows) => <DataTable rows={rows} emptyTitle="No pledges match." columns={[
        { key: 'first_name', header: 'Donor', render: (p) => <>{p.first_name} {p.last_name}<small>Pledge #{p.id} · {p.blood_group}</small></> },
        { key: 'organ', header: 'Organ', render: (p) => <strong>{p.organ}</strong> },
        { key: 'donor_type', header: 'Donation', render: (p) => <Status value={p.donor_type} /> },
        { key: 'state', header: 'Location', render: (p) => `${p.city}, ${p.state}` },
        { key: 'status', header: 'Status', render: (p) => <><Status value={p.status} />{p.available_at && <small>Available at {p.available_hospital_name}</small>}</> },
        { key: 'created_at', header: 'Pledged', render: (p) => formatDate(p.created_at) },
        { key: 'ranking', header: 'Ranking', sortable: false, render: (p) => <button type="button" className="text-button" aria-expanded={ranking === p.id} onClick={() => setRanking(ranking === p.id ? null : p.id)}>{ranking === p.id ? 'Hide' : 'Recipients'}</button> },
      ]} renderAfterRow={(p, span) => ranking === p.id && <tr className="ranking-row"><td colSpan={span}><RecipientRanking pledgeId={p.id} /></td></tr>} />)}
      {tab === 'matches' && list(find(data.matches, 'organ', 'hospital_name', 'requester_first_name', 'requester_last_name', 'donor_first_name', 'donor_last_name'), (rows) => <DataTable rows={rows} emptyTitle="No matches yet." initialSort={{ key: 'id', dir: 'desc' }} columns={[
        { key: 'id', header: 'Match', render: (m) => <>#{m.id}<small>{formatDate(m.created_at)}</small></> },
        { key: 'organ', header: 'Organ', render: (m) => <strong>{m.organ}</strong> },
        { key: 'hospital_name', header: 'Hospital' },
        { key: 'requester_first_name', header: 'Recipient', render: (m) => `${m.requester_first_name} ${m.requester_last_name}` },
        { key: 'donor_first_name', header: 'Donor', render: (m) => `${m.donor_first_name} ${m.donor_last_name}` },
        { key: 'score', header: 'Score', render: (m) => <>{m.score}<small>rank #{m.recipient_rank}{m.override_reason ? ' · override' : ''}</small></> },
        { key: 'donor_response', header: 'Donor response', render: (m) => <Status value={m.donor_response} /> },
        { key: 'status', header: 'Status', render: (m) => <><Status value={m.status} />{m.decision_reason && <small>{m.decision_reason}</small>}</> },
        { key: 'report', header: 'Report', sortable: false, render: (m) => m.status === 'confirmed' ? <MatchPdfButton id={m.id} compact /> : '—' },
      ]} />)}
      {tab === 'records' && list(find(data.records, 'first_name', 'last_name', 'organ'), (rows) => <DataTable rows={rows} emptyTitle="No donation records yet." columns={[
        { key: 'first_name', header: 'Member', render: (r) => `${r.first_name} ${r.last_name}` },
        { key: 'organ', header: 'Organ', render: (r) => <strong>{r.organ}</strong> },
        { key: 'blood_group', header: 'Blood group' },
        { key: 'quantity', header: 'Quantity' },
        { key: 'donated_on', header: 'Donation date', render: (r) => formatDate(r.donated_on) },
        { key: 'note', header: 'Note', sortable: false, render: (r) => r.note || '—' },
      ]} />)}
      {tab === 'audit' && <AuditLog events={data.events} />}
    </>}
  </div>;
}

function Overview({ data, analytics }) {
  const pending = data.hospitals.filter((h) => h.status === 'pending');
  const a = analytics.data;
  return <>
    <StatStrip items={[
      { label: 'Hospitals awaiting verification', value: pending.length, icon: Hospital, to: '/admin?tab=hospitals' },
      { label: 'Verified open requests', value: data.requests.filter((r) => r.status === 'open' && r.verification === 'verified').length, icon: Heartbeat, to: '/admin?tab=requests' },
      { label: 'Active pledges', value: data.pledges.filter((p) => p.status === 'active').length, icon: HandHeart, to: '/admin?tab=pledges' },
      { label: 'Active matches', value: data.matches.filter((m) => ['proposed', 'confirmed'].includes(m.status)).length, icon: Handshake, to: '/admin?tab=matches' },
    ]} />
    <Notice>{analytics.error}</Notice>
    <div className="overview-grid grow">
      {!a ? <Loading variant="cards" /> : <div className="chart-row">
        <BarChart title="Open requests by organ" subtitle="All open requests" data={a.requestsByOrgan.map((r) => ({ label: r.organ, value: r.open, detail: `${r.verified} verified` }))} emptyText="No open requests." />
        <BarChart title="Days on the verified list" subtitle="Average for open, verified requests" data={a.waitingByOrgan.map((r) => ({ label: r.organ, value: r.days, detail: `${r.requests} ${r.requests === 1 ? 'request' : 'requests'}` }))} format={(v) => `${v} d`} emptyText="No verified open requests." />
        <BarChart title="Confirmed matches by state" subtitle="Where the treating hospital is" data={a.matchesByState.filter((r) => r.confirmed > 0).map((r) => ({ label: r.state, value: r.confirmed, detail: `${r.proposed} still proposed` }))} emptyText="No confirmed matches yet." />
        <BarChart title="Hospitals awaiting verification" subtitle="Pending registrations by state" data={Object.entries(pending.reduce((counts, h) => ({ ...counts, [h.state]: (counts[h.state] || 0) + 1 }), {})).map(([label, value]) => ({ label, value }))} emptyText="No hospitals awaiting verification." />
      </div>}
      <Box scroll title="Recent activity" actions={<Link className="text-link" to="/admin?tab=audit">View all <ArrowRight size={15} /></Link>} bodyClass="flush">
        {data.events.length ? <ol className="timeline">{data.events.slice(0, 8).map((e) => <TimelineItem key={e.id} event={e} />)}</ol> : <InlineEmpty>No activity yet.</InlineEmpty>}
      </Box>
    </div>
  </>;
}

function RecipientRanking({ pledgeId }) {
  const resource = useResource(`/admin/pledges/${pledgeId}/recipients`);
  if (!resource.data) return resource.error ? <Notice>{resource.error}</Notice> : <Loading />;
  const { recipients, notice, flags } = resource.data;
  return <div className="ranking">{notice && <p className="rank-note warn">{notice}</p>}<FlagList flags={flags} />{recipients.length ? <ol className="ranking-list">{recipients.map((r) => <li key={r.request_id} className="candidate"><div><span className="eyebrow">#{r.rank} · Request #{r.request_id}</span><h3>{r.organ} · {r.blood_group} <span className="muted">({r.blood_match.replace('-', ' ')})</span></h3><div className="candidate-meta"><span>{r.hospital_name}, {r.city}</span><span>Priority <Status value={r.priority} /></span><span>Patient age {r.patient_age ?? '—'}</span><span>Verified {formatDate(r.verified_at)}</span></div></div><ScoreBreakdown score={r.score} breakdown={r.breakdown} /></li>)}</ol> : !notice && <InlineEmpty>No verified open request can receive this pledge right now.</InlineEmpty>}</div>;
}

function TimelineItem({ event }) {
  const { text, tone } = describeEvent(event);
  return <li><span className={`timeline-icon ${tone}`} aria-hidden="true">{tone === 'danger' ? <XCircle size={17} /> : tone === 'warn' ? <WarningCircle size={17} /> : <CheckCircle size={17} />}</span><div><small>{formatDateTime(event.created_at)} · {event.entity} #{event.entity_id}{event.role ? ` · ${event.role}` : ''}</small><p>{text}</p></div></li>;
}
function AuditLog({ events }) {
  const [entity, setEntity] = useState('');
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(30);
  const rows = events.filter((e) => (!entity || e.entity === entity) && (!role || e.role === role) && describeEvent(e).text.toLowerCase().includes(search.toLowerCase()));
  return <Box scroll className="grow" head={<>
    <SearchBox value={search} onChange={setSearch} placeholder="Search the audit log" />
    <select aria-label="Filter by record type" value={entity} onChange={(e) => setEntity(e.target.value)}><option value="">All records</option>{['hospital', 'request', 'pledge', 'match', 'user'].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}s</option>)}</select>
    <select aria-label="Filter by who acted" value={role} onChange={(e) => setRole(e.target.value)}><option value="">Everyone</option><option value="admin">Administrators</option><option value="hospital">Hospital staff</option><option value="member">Members</option></select>
    <span className="results">{rows.length} of the latest {events.length}</span>
  </>} bodyClass="flush">
    {rows.length ? <ol className="timeline">{rows.slice(0, limit).map((e) => <TimelineItem key={e.id} event={e} />)}</ol> : <InlineEmpty>No matching events.</InlineEmpty>}
    {rows.length > limit && <div className="load-more"><button type="button" className="button secondary" onClick={() => setLimit(limit + 30)}>Show more</button></div>}
  </Box>;
}
