// Structured PDF reports for members, hospitals, and administrators.
// jsPDF loads only when someone exports, so it stays out of the main bundle.
import { api } from './api.js';
import { describeEvent } from './audit-text.js';

const C = {
  brand: [244, 190, 80], brandSoft: [251, 240, 210], brandInk: [92, 68, 18], strong: [184, 128, 15],
  ink: [44, 48, 41], muted: [119, 122, 113], line: [233, 233, 223], zebra: [255, 253, 247], tile: [255, 252, 243], white: [255, 255, 255],
};
const M = 44;

// The built-in PDF fonts cover Windows-1252; anything else is simplified or replaced.
const CP1252_EXTRA = '\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178';
export function clean(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u00a0\u2000-\u200b\u202f\u205f]/g, ' ').replace(/\u2192/g, '->')
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, (ch) => CP1252_EXTRA.includes(ch) ? ch : '?');
}
const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const toDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
const date = (value) => value ? dateFormat.format(toDate(value)) : '—';
const dateTime = (value) => value ? dateTimeFormat.format(toDate(value)) : '—';
function age(dob) {
  if (!dob) return '—';
  const birth = toDate(dob); const now = new Date();
  return now.getFullYear() - birth.getFullYear() - (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
}
const label = (value) => value ? String(value).replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()) : '—';
const donation = (type) => type === 'deceased' ? 'After death' : 'Living';
const urgency = (value) => value === 'Not Emergency' ? 'Standard' : value;
const person = (first, last) => [first, last].filter(Boolean).join(' ') || '—';
const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

async function createReport({ kind, title, subtitle, preparedBy, compress = false }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const inner = W - M * 2;
  const generated = new Date();
  const sections = [];
  let contents = null;
  const fill = (rgb) => doc.setFillColor(...rgb);
  const stroke = (rgb) => doc.setDrawColor(...rgb);
  const ink = (rgb) => doc.setTextColor(...rgb);
  const font = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
  const pageNumber = () => doc.getCurrentPageInfo().pageNumber;
  const tableBase = { margin: { left: M, right: M, top: 64, bottom: 60 } };
  let y;
  const room = (needed) => { if (y + needed > H - 64) { doc.addPage(); y = 76; } };

  // Cover band with the OrganoTale mark.
  fill(C.brand); doc.rect(0, 0, W, 104, 'F');
  fill(C.ink); doc.roundedRect(M, 30, 42, 42, 10, 10, 'F');
  fill(C.brand); doc.circle(M + 15.5, 46, 6.5, 'F'); doc.circle(M + 26.5, 46, 6.5, 'F'); doc.triangle(M + 9.2, 48.6, M + 32.8, 48.6, M + 21, 62, 'F');
  font('bold', 20); ink(C.ink); doc.text('OrganoTale', M + 56, 50);
  font('normal', 9); ink(C.brandInk); doc.text('A little of you. A life for someone.', M + 56, 65);
  font('bold', 8); doc.text(clean(kind).toUpperCase(), W - M, 46, { align: 'right', charSpace: 0.6 });
  font('normal', 8); doc.text(clean(`Generated ${dateTime(generated)}`), W - M, 60, { align: 'right' });

  y = 148;
  font('bold', 22); ink(C.ink); doc.text(clean(title), M, y);
  y += 20;
  font('normal', 10.5); ink(C.muted);
  const lines = doc.splitTextToSize(clean(subtitle), inner);
  doc.text(lines, M, y); y += lines.length * 14;
  if (preparedBy) { doc.text(clean(`Prepared by ${preparedBy}`), M, y); y += 14; }
  y += 16;

  const report = {
    tiles(items) {
      const cols = Math.min(4, items.length); const gap = 10; const h = 60;
      const w = (inner - gap * (cols - 1)) / cols;
      items.forEach((item, i) => {
        if (i % cols === 0) { if (i) y += h + gap; room(h); }
        const x = M + (i % cols) * (w + gap);
        fill(C.tile); stroke(C.line); doc.setLineWidth(0.6); doc.roundedRect(x, y, w, h, 8, 8, 'FD');
        fill(C.strong); doc.rect(x, y + 13, 3, h - 26, 'F');
        font('bold', 18); ink(C.ink); doc.text(clean(item.value), x + 14, y + 27);
        font('normal', 8); ink(C.muted); doc.text(doc.splitTextToSize(clean(item.label), w - 24).slice(0, 2), x + 14, y + 42);
      });
      y += h + 24;
    },
    // Reserves space for a table of contents that is filled in once page numbers are known.
    contents(count) {
      room(40 + count * 17);
      contents = { page: pageNumber(), y };
      y += 34 + count * 17 + 10;
    },
    section(name, caption) {
      room(150);
      if (y > 90) y += 6;
      fill(C.brand); doc.rect(M, y - 12, 4, 17, 'F');
      font('bold', 13.5); ink(C.ink); doc.text(clean(name), M + 12, y + 1);
      sections.push({ name, page: pageNumber() });
      y += 12;
      if (caption) {
        font('normal', 8.5); ink(C.muted);
        const text = doc.splitTextToSize(clean(caption), inner);
        doc.text(text, M, y + 4); y += text.length * 11.5 + 2;
      }
      y += 8;
    },
    subheading(name, detail) {
      room(96);
      font('bold', 10); ink(C.ink); doc.text(clean(name), M, y);
      if (detail) { font('normal', 8.5); ink(C.muted); doc.text(clean(detail), W - M, y, { align: 'right' }); }
      y += 8;
    },
    note(text) {
      font('normal', 8.5);
      const wrapped = doc.splitTextToSize(clean(text), inner);
      room(wrapped.length * 12 + 8);
      ink(C.muted); doc.text(wrapped, M, y + 4);
      y += wrapped.length * 12 + 12;
    },
    empty(text) {
      room(30);
      fill(C.zebra); stroke(C.line); doc.setLineWidth(0.6); doc.roundedRect(M, y - 2, inner, 26, 5, 5, 'FD');
      font('italic', 8.5); ink(C.muted); doc.text(clean(text), M + 10, y + 14);
      y += 40;
    },
    table(head, rows, { empty = 'Nothing recorded yet.', columnStyles = {} } = {}) {
      if (!rows.length) return report.empty(empty);
      autoTable(doc, {
        ...tableBase,
        startY: y,
        head: [head.map(clean)],
        body: rows.map((row) => row.map(clean)),
        theme: 'grid',
        rowPageBreak: 'avoid',
        showHead: 'everyPage',
        styles: { font: 'helvetica', fontSize: 8, textColor: C.ink, lineColor: C.line, lineWidth: 0.5, cellPadding: { top: 5, right: 6, bottom: 5, left: 6 }, overflow: 'linebreak', valign: 'middle' },
        headStyles: { fillColor: C.brandSoft, textColor: C.brandInk, fontStyle: 'bold', fontSize: 7.5 },
        bodyStyles: { fillColor: C.white },
        alternateRowStyles: { fillColor: C.zebra },
        columnStyles,
      });
      y = doc.lastAutoTable.finalY + 22;
    },
    details(pairs) {
      const rows = [];
      for (let i = 0; i < pairs.length; i += 2) rows.push([...pairs[i], ...(pairs[i + 1] || [' ', ' '])]);
      const labelStyle = { fontStyle: 'bold', textColor: C.muted, fontSize: 7.5, cellWidth: 92 };
      autoTable(doc, {
        ...tableBase,
        startY: y,
        body: rows.map((row) => row.map(clean)),
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 9, textColor: C.ink, cellPadding: { top: 4, right: 10, bottom: 4, left: 0 }, overflow: 'linebreak' },
        columnStyles: { 0: labelStyle, 2: labelStyle },
      });
      y = doc.lastAutoTable.finalY + 20;
    },
    finish() {
      if (contents) {
        doc.setPage(contents.page);
        let cy = contents.y;
        font('bold', 10); ink(C.ink); doc.text('Contents', M, cy);
        stroke(C.line); doc.setLineWidth(0.6); doc.line(M, cy + 7, W - M, cy + 7);
        cy += 24;
        sections.forEach((section, i) => {
          font('normal', 9.5); ink(C.ink); doc.text(clean(`${i + 1}.   ${section.name}`), M, cy);
          ink(C.muted); doc.text(`Page ${section.page}`, W - M, cy, { align: 'right' });
          cy += 17;
        });
      }
      const total = doc.getNumberOfPages();
      for (let p = 1; p <= total; p += 1) {
        doc.setPage(p);
        if (p > 1) {
          fill(C.brand); doc.rect(0, 0, W, 5, 'F');
          font('bold', 9); ink(C.ink); doc.text('OrganoTale', M, 34);
          font('normal', 8.5); ink(C.muted); doc.text(clean(title), W - M, 34, { align: 'right' });
          stroke(C.line); doc.setLineWidth(0.6); doc.line(M, 44, W - M, 44);
        }
        stroke(C.line); doc.setLineWidth(0.6); doc.line(M, H - 42, W - M, H - 42);
        font('normal', 7.5); ink(C.muted);
        doc.text('Confidential: contains personal and medical information. Share only with authorised people.', M, H - 28);
        doc.text(`Page ${p} of ${total}`, W - M, H - 28, { align: 'right' });
      }
      doc.setProperties({ title: clean(title), subject: clean(kind), author: 'OrganoTale', creator: 'OrganoTale' });
      return doc;
    },
  };
  return report;
}

const DISCLAIMER = 'Rankings and matches in OrganoTale are suggestions based on the information supplied. Crossmatching, tissue typing, and medical eligibility are decided by the transplant team at the treating hospital.';
const isActiveMatch = (m) => ['proposed', 'confirmed'].includes(m.status);

export async function memberReport({ user, pledges, requests, matches, records }, { compress } = {}) {
  const name = person(user.first_name, user.last_name);
  const r = await createReport({ kind: 'Member report', title: 'My OrganoTale report', subtitle: `${name} · ${user.email}. Pledges, organ requests, matches, and donation records.`, compress });
  r.tiles([
    { value: pledges.filter((p) => p.status === 'active').length, label: 'Active pledges' },
    { value: requests.filter((q) => q.status === 'open').length, label: 'Open organ requests' },
    { value: matches.filter(isActiveMatch).length, label: 'Active matches' },
    { value: records.length, label: 'Donation records' },
  ]);
  r.contents(6);
  r.section('Profile');
  r.details([
    ['Name', name], ['Email', user.email], ['Phone', user.phone], ['Blood group', user.blood_group],
    ['Date of birth', user.dob ? `${date(user.dob)} (age ${age(user.dob)})` : '—'], ['Gender', user.gender],
    ['Address', [user.address, user.zip].filter(Boolean).join(' ')], ['Donor status', user.donor_status === 'deceased' ? 'Deceased' : 'Alive'],
    ['Member since', date(user.created_at)], ['Account type', label(user.role)],
  ]);
  r.section('Pledges', 'Organs offered for donation and where each pledge stands.');
  r.table(['Pledge', 'Organ', 'Donation', 'Location', 'Status', 'Pledged on'], pledges.map((p) => [
    `#${p.id}`, p.organ, donation(p.donor_type), `${p.city}, ${p.state}`, p.available_at ? `${label(p.status)} · available at ${p.available_hospital_name}` : label(p.status), date(p.created_at),
  ]), { empty: 'No pledges yet.' });
  r.section('Organ requests', 'Requests created for patients. The treating hospital verifies each request and sets its medical priority.');
  r.table(['Request', 'Organ', 'Blood group', 'Qty', 'Hospital', 'Verification', 'Priority', 'Status', 'Created'], requests.map((q) => [
    `#${q.id}`, q.organ, q.blood_group, q.quantity, q.hospital_name, label(q.verification), label(q.priority), label(q.status), date(q.created_at),
  ]), { empty: 'No organ requests yet.' });
  r.section('Matches', 'Donor and recipient pairings proposed by hospitals that involve this account.');
  r.table(['Match', 'Role', 'Organ', 'Hospital', 'Donor response', 'Status', 'Notes', 'Updated'], matches.map((m) => [
    `#${m.id}`, m.is_donor ? 'Donor' : 'Recipient', m.organ, `${m.hospital_name}, ${m.hospital_city}`, label(m.donor_response), label(m.status), m.decision_reason, date(m.updated_at || m.created_at),
  ]), { empty: 'No matches yet.' });
  r.section('Donation records', 'Self-reported donation history.');
  r.table(['Organ', 'Blood group', 'Quantity', 'Donation date', 'Note'], records.map((d) => [d.organ, d.blood_group, d.quantity, date(d.donated_on), d.note]), { empty: 'No donation records yet.' });
  r.section('About this report');
  r.note(DISCLAIMER);
  return r.finish();
}

export async function hospitalReport({ user, hospital, requests, matches, rankings }, { compress } = {}) {
  const r = await createReport({ kind: 'Hospital report', title: `${hospital.name} report`, subtitle: `${hospital.city}, ${hospital.state}. Patient requests, ranked donors, and matches.`, preparedBy: person(user.first_name, user.last_name), compress });
  const open = requests.filter((q) => q.status === 'open');
  r.tiles([
    { value: open.filter((q) => q.verification === 'pending').length, label: 'Requests needing verification' },
    { value: open.filter((q) => q.verification === 'verified').length, label: 'Verified open requests' },
    { value: matches.filter((m) => m.status === 'proposed' && m.donor_response === 'accepted').length, label: 'Donor accepted, to confirm' },
    { value: matches.filter((m) => m.status === 'confirmed').length, label: 'Confirmed matches' },
  ]);
  r.contents(5);
  r.section('Hospital profile');
  r.details([
    ['Hospital', hospital.name], ['Registration no.', hospital.registration_number], ['Status', label(hospital.status)], ['Location', `${hospital.city}, ${hospital.state} ${hospital.pincode || ''}`.trim()],
    ['Phone', hospital.phone], ['Email', hospital.email], ['Joined', date(hospital.created_at)], ['Total requests', requests.length],
  ]);
  r.section('Patient requests', 'Every request that names this hospital as the treating hospital.');
  r.table(['Req.', 'Patient', 'Age', 'Organ', 'Blood', 'Urgency', 'Verification', 'Priority', 'Clinical score', 'Status', 'Active matches', 'Received'], requests.map((q) => [
    `#${q.id}`, person(q.first_name, q.last_name), age(q.patient_dob), q.organ, q.blood_group, urgency(q.urgency), label(q.verification), label(q.priority),
    q.verification === 'verified' ? `${q.clinical_score} / 40` : '—', label(q.status), q.active_matches, date(q.created_at),
  ]), { empty: 'No patient requests yet.' });
  r.section('Ranked donors', 'For each open, verified request: eligible donors in priority order. A recipient rank above #1 means another patient has higher priority for that donor.');
  if (!rankings.length) r.empty('No open, verified requests to rank.');
  for (const { request: q, candidates = [], notice } of rankings) {
    r.subheading(`${q.organ} for ${person(q.first_name, q.last_name)} · request #${q.id}`, `Priority ${label(q.priority)} · blood group ${q.blood_group}`);
    if (notice) r.note(notice);
    else r.table(['#', 'Donor', 'Donation', 'Blood match', 'Age', 'Location', 'Score', 'Recipient rank', 'Flags'], candidates.map((c, i) => [
      i + 1, c.donor_label, donation(c.donor_type), `${c.blood_group} (${String(c.blood_match).replace('-', ' ')})`, c.age, c.location, `${c.score} / 100`, `#${c.recipient_rank} of ${c.competing_recipients}`, c.flags?.length ? c.flags.join('; ') : 'None',
    ]), { empty: 'No eligible donors right now.' });
  }
  r.section('Matches', 'Donor identities appear only after the donor accepts.');
  r.table(['Match', 'Organ', 'Recipient', 'Donor', 'Score', 'Donor response', 'Status', 'Notes', 'Proposed'], matches.map((m) => [
    `#${m.id}`, m.organ, person(m.requester_first_name, m.requester_last_name), m.donor_first_name ? `${person(m.donor_first_name, m.donor_last_name)} (${donation(m.donor_type).toLowerCase()})` : `${m.donor_label} (${donation(m.donor_type).toLowerCase()})`,
    `${m.score} · rank #${m.recipient_rank}`, label(m.donor_response), label(m.status), [m.override_reason && `Override: ${m.override_reason}`, m.decision_reason].filter(Boolean).join(' · '), date(m.created_at),
  ]), { empty: 'No matches yet.' });
  r.section('About this report');
  r.note(DISCLAIMER);
  return r.finish();
}

export async function adminReport({ user, dashboard: d, analytics: a }, { compress } = {}) {
  const r = await createReport({ kind: 'System report', title: 'OrganoTale system report', subtitle: 'Hospitals, members, organ requests, pledges, matches, donation records, and the audit log.', preparedBy: person(user.first_name, user.last_name), compress });
  r.tiles([
    { value: d.hospitals.filter((h) => h.status === 'pending').length, label: 'Hospitals awaiting verification' },
    { value: d.requests.filter((q) => q.status === 'open' && q.verification === 'verified').length, label: 'Verified open requests' },
    { value: d.pledges.filter((p) => p.status === 'active').length, label: 'Active pledges' },
    { value: d.matches.filter(isActiveMatch).length, label: 'Active matches' },
    { value: d.hospitals.length, label: 'Hospitals' },
    { value: d.users.length, label: 'Accounts' },
    { value: d.requests.length, label: 'Organ requests' },
    { value: d.matches.filter((m) => m.status === 'confirmed').length, label: 'Confirmed matches' },
  ]);
  r.contents(8);
  r.section('Overview', 'Where demand is, how long patients wait, and where matches happen.');
  r.subheading('Open requests by organ');
  r.table(['Organ', 'Open requests', 'Verified'], a.requestsByOrgan.map((row) => [row.organ, row.open, row.verified]), { empty: 'No open requests.' });
  r.subheading('Average days on the verified list');
  r.table(['Organ', 'Average days', 'Requests'], a.waitingByOrgan.map((row) => [row.organ, row.days, row.requests]), { empty: 'No verified open requests.' });
  r.subheading('Matches by state of the treating hospital');
  r.table(['State', 'Confirmed', 'Proposed'], a.matchesByState.map((row) => [row.state, row.confirmed, row.proposed]), { empty: 'No matches yet.' });
  r.section('Hospitals', plural(d.hospitals.length, 'hospital'));
  r.table(['Hospital', 'Registration no.', 'Location', 'Contact', 'Requests', 'Status', 'Joined'], d.hospitals.map((h) => [
    h.name, h.registration_number, `${h.city}, ${h.state} ${h.pincode || ''}`.trim(), `${h.email}\n${h.phone}`, h.request_count, label(h.status), date(h.created_at),
  ]), { empty: 'No hospitals yet.' });
  r.section('Members and staff', plural(d.users.length, 'account'));
  r.table(['Name', 'Email', 'Role', 'Blood group', 'Donor status', 'Hospital', 'Joined'], d.users.map((u) => [
    person(u.first_name, u.last_name), u.email, label(u.role), u.blood_group, u.role === 'hospital' ? '—' : u.donor_status === 'deceased' ? 'Deceased' : 'Alive', u.hospital_name, date(u.created_at),
  ]), { empty: 'No accounts yet.' });
  r.section('Organ requests', plural(d.requests.length, 'request'));
  r.table(['Req.', 'Member', 'Organ', 'Blood', 'Hospital', 'Verification', 'Priority', 'Status', 'Created'], d.requests.map((q) => [
    `#${q.id}`, person(q.first_name, q.last_name), q.organ, q.blood_group, q.hospital_name, label(q.verification), label(q.priority), label(q.status), date(q.created_at),
  ]), { empty: 'No organ requests yet.' });
  r.section('Pledges', plural(d.pledges.length, 'pledge'));
  r.table(['Pledge', 'Donor', 'Organ', 'Donation', 'Blood', 'Location', 'Status', 'Pledged'], d.pledges.map((p) => [
    `#${p.id}`, person(p.first_name, p.last_name), p.organ, donation(p.donor_type), p.blood_group, `${p.city}, ${p.state}`, p.available_at ? `${label(p.status)} · available at ${p.available_hospital_name}` : label(p.status), date(p.created_at),
  ]), { empty: 'No pledges yet.' });
  r.section('Matches', plural(d.matches.length, 'match').replace('matchs', 'matches'));
  r.table(['Match', 'Organ', 'Hospital', 'Recipient', 'Donor', 'Score', 'Donor response', 'Status', 'Notes'], d.matches.map((m) => [
    `#${m.id}`, m.organ, m.hospital_name, person(m.requester_first_name, m.requester_last_name), person(m.donor_first_name, m.donor_last_name),
    `${m.score} · rank #${m.recipient_rank}`, label(m.donor_response), label(m.status), [m.override_reason && `Override: ${m.override_reason}`, m.decision_reason].filter(Boolean).join(' · '),
  ]), { empty: 'No matches yet.' });
  r.section('Donation records', plural(d.records.length, 'record'));
  r.table(['Member', 'Organ', 'Blood group', 'Quantity', 'Donation date', 'Note'], d.records.map((row) => [person(row.first_name, row.last_name), row.organ, row.blood_group, row.quantity, date(row.donated_on), row.note]), { empty: 'No donation records yet.' });
  r.section('Audit log', `The latest ${plural(d.events.length, 'event')}: every verification, proposal, override, and decision.`);
  r.table(['When', 'Record', 'Role', 'Event'], d.events.map((e) => [dateTime(e.created_at), `${label(e.entity)} #${e.entity_id}`, label(e.role), describeEvent(e).text]), { empty: 'No activity yet.', columnStyles: { 0: { cellWidth: 92 }, 1: { cellWidth: 72 }, 2: { cellWidth: 56 } } });
  return r.finish();
}

// ---- Loading and saving in the browser ----
export async function loadMemberReport() {
  const [{ user }, pledges, requests, matches, records] = await Promise.all([api('/auth/me'), api('/pledges'), api('/requests?mine=true'), api('/matches'), api('/records')]);
  return memberReport({ user, pledges, requests, matches, records }, { compress: true });
}
export async function loadHospitalReport() {
  const [{ user }, { hospital }, requests, matches] = await Promise.all([api('/auth/me'), api('/hospital/me'), api('/hospital/requests'), api('/hospital/matches')]);
  const verified = requests.filter((q) => q.status === 'open' && q.verification === 'verified').slice(0, 25);
  const rankings = await Promise.all(verified.map(async (request) => ({ request, ...(await api(`/hospital/requests/${request.id}/candidates`)) })));
  return hospitalReport({ user, hospital, requests, matches, rankings }, { compress: true });
}
export async function loadAdminReport() {
  const [{ user }, dashboard, analytics] = await Promise.all([api('/auth/me'), api('/admin/dashboard'), api('/admin/analytics')]);
  return adminReport({ user, dashboard, analytics }, { compress: true });
}
export function savePdf(doc, kind) {
  doc.save(`organotale-${kind}-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}
