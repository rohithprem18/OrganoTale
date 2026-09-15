// The PDF record of a confirmed match. jsPDF loads only when someone exports,
// so it stays out of the main bundle.
import { api } from './api.js';

const C = {
  brand: [244, 190, 80], brandSoft: [251, 240, 210], brandInk: [92, 68, 18], strong: [184, 128, 15],
  ink: [44, 48, 41], muted: [119, 122, 113], line: [233, 233, 223], zebra: [255, 253, 247], tile: [255, 252, 243], white: [255, 255, 255],
};
const M = 44;

// The built-in PDF fonts cover Windows-1252; anything else is simplified or replaced.
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function clean(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[  -​  ]/g, ' ').replace(/→/g, '->')
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, (ch) => CP1252_EXTRA.includes(ch) ? ch : '?');
}
const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const toDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
const date = (value) => value ? dateFormat.format(toDate(value)) : '—';
const dateTime = (value) => value ? dateTimeFormat.format(toDate(value)) : '—';
const label = (value) => value ? String(value).replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()) : '—';
const donation = (type) => type === 'deceased' ? 'After death' : 'Living';
const urgency = (value) => value === 'Not Emergency' ? 'Standard' : value;

async function createReport({ kind, title, subtitle, compress = false }) {
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
        font('bold', 16); ink(C.ink); doc.text(clean(item.value), x + 14, y + 27);
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
    table(head, rows, { empty = 'Nothing recorded yet.', columnStyles = {}, foot } = {}) {
      if (!rows.length) return report.empty(empty);
      autoTable(doc, {
        ...tableBase,
        startY: y,
        head: [head.map(clean)],
        body: rows.map((row) => row.map(clean)),
        ...(foot ? { foot: [foot.map(clean)], showFoot: 'lastPage' } : {}),
        theme: 'grid',
        rowPageBreak: 'avoid',
        showHead: 'everyPage',
        styles: { font: 'helvetica', fontSize: 8.5, textColor: C.ink, lineColor: C.line, lineWidth: 0.5, cellPadding: { top: 6, right: 7, bottom: 6, left: 7 }, overflow: 'linebreak', valign: 'middle' },
        headStyles: { fillColor: C.brandSoft, textColor: C.brandInk, fontStyle: 'bold', fontSize: 8 },
        footStyles: { fillColor: C.brandSoft, textColor: C.ink, fontStyle: 'bold' },
        bodyStyles: { fillColor: C.white },
        alternateRowStyles: { fillColor: C.zebra },
        columnStyles,
      });
      y = doc.lastAutoTable.finalY + 22;
    },
    details(pairs) {
      const rows = [];
      for (let i = 0; i < pairs.length; i += 2) rows.push([...pairs[i], ...(pairs[i + 1] || [' ', ' '])]);
      const labelStyle = { fontStyle: 'bold', textColor: C.muted, fontSize: 7.5, cellWidth: 96 };
      autoTable(doc, {
        ...tableBase,
        startY: y,
        body: rows.map((row) => row.map(clean)),
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 9.5, textColor: C.ink, cellPadding: { top: 4.5, right: 10, bottom: 4.5, left: 0 }, overflow: 'linebreak' },
        columnStyles: { 0: labelStyle, 2: labelStyle },
      });
      y = doc.lastAutoTable.finalY + 20;
    },
    signatures(names) {
      room(96);
      const gap = 28; const w = (inner - gap * (names.length - 1)) / names.length;
      names.forEach((name, i) => {
        const x = M + i * (w + gap);
        stroke(C.ink); doc.setLineWidth(0.7); doc.line(x, y + 46, x + w, y + 46);
        font('bold', 8.5); ink(C.ink); doc.text(clean(name), x, y + 60);
        font('normal', 7.5); ink(C.muted); doc.text('Name, signature, and date', x, y + 72);
      });
      y += 92;
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

const COPY = { admin: 'Administrator copy', hospital: 'Treating hospital copy', donor: 'Donor copy', recipient: 'Recipient copy' };
const FACTORS = { urgency: 'Medical priority', clinical: 'Clinical severity', waiting: 'Time on the verified list', blood: 'Blood group', proximity: 'Distance', pediatric: 'Child patient', prior_donor: 'Past donor' };
const EVENTS = { proposed: 'Match proposed', donor_accepted: 'Donor accepted the match', donor_declined: 'Donor declined the match', confirmed: 'Match confirmed after medical tests', declined: 'Match declined' };

export async function matchReport({ viewer, match: m, hospital: h, recipient: q, donor: d, timeline }, { compress } = {}) {
  const r = await createReport({
    kind: 'Confirmed match',
    title: `${q.organ} match #${m.id}`,
    subtitle: `Confirmed on ${date(m.confirmed_at)} at ${h.name}, ${h.city}, ${h.state}. ${COPY[viewer] || 'Match record'}.`,
    compress,
  });
  const breakdown = Array.isArray(m.breakdown) ? m.breakdown : [];
  r.tiles([
    { value: 'Confirmed', label: `Match status since ${date(m.confirmed_at)}` },
    { value: `${m.score} / 100`, label: 'Priority score' },
    { value: m.competing_recipients ? `#${m.recipient_rank} of ${m.competing_recipients}` : `#${m.recipient_rank}`, label: 'Recipient rank for this donor' },
    { value: label(q.priority), label: 'Verified medical priority' },
  ]);
  r.contents(8);

  r.section('Match summary');
  r.details([
    ['Match no.', `#${m.id}`], ['Status', 'Confirmed'],
    ['Proposed on', dateTime(m.proposed_at)], ['Donor consent', m.accepted_at ? `Accepted ${dateTime(m.accepted_at)}` : d.donor_type === 'deceased' ? 'Documented when the after-death pledge was reported available' : '—'],
    ['Confirmed on', dateTime(m.confirmed_at)], ['Confirmed by', m.confirmed_by],
    ['Override reason', m.override_reason || 'None: the highest-priority eligible recipient'], ['Hospital note', m.decision_reason || 'None'],
  ]);

  r.section('Recipient', viewer === 'donor' ? 'The recipient’s identity is kept confidential in the donor copy.' : null);
  r.details([
    ...(q.name ? [['Recipient', q.name]] : []), ['Request no.', `#${q.request_id}`],
    ['Organ', q.organ], ['Blood group', q.blood_group],
    ['Quantity', q.quantity], ...(q.patient_age !== undefined ? [['Patient age', q.patient_age]] : []),
    ['Reported urgency', urgency(q.urgency)], ['Medical priority', label(q.priority)],
    ['Clinical score', `${q.clinical_score ?? 0} of 40`], ['On verified list since', date(q.verified_at)],
  ]);

  r.section('Donor', viewer === 'recipient' ? 'The donor’s identity, contact details, and screening answers are kept confidential in the recipient copy.' : null);
  r.details([
    ...(d.name ? [['Donor', d.name]] : []), ['Pledge no.', `#${d.pledge_id}`],
    ['Donation', donation(d.donor_type)], ['Blood group', d.blood_group],
    ['Blood match', breakdown.find((b) => b.factor === 'blood')?.label], ...(d.age !== undefined ? [['Age', d.age]] : []),
    ...(d.location ? [['Location', d.location]] : []), ...(d.phone ? [['Phone', d.phone]] : []),
    ...(d.email ? [['Email', d.email]] : []),
  ]);
  if (d.flags) {
    if (d.flags.length) r.table(['Screening flags for clinical review'], d.flags.map((flag) => [flag]));
    else r.note('No screening flags were raised for this donor.');
  }

  r.section('Treating hospital');
  r.details([['Hospital', h.name], ['Registration no.', h.registration_number], ['Location', `${h.city}, ${h.state}`], ['Phone', h.phone], ['Email', h.email]]);

  r.section('Priority score breakdown', 'How the recipient was ranked for this donor. The score is a suggestion; the transplant team makes the clinical decision.');
  r.table(['Factor', 'Detail', 'Points'], breakdown.map((b) => [FACTORS[b.factor] || label(b.factor), b.label, `${b.points} / ${b.max}`]), {
    empty: 'No score breakdown was recorded.', foot: ['Total', '', `${m.score} / 100`], columnStyles: { 0: { cellWidth: 150 }, 2: { cellWidth: 80, halign: 'right' } },
  });

  r.section('Decision timeline');
  r.table(['When', 'Event', 'By'], timeline.map((e) => [dateTime(e.at), EVENTS[e.action] || label(e.action), e.by]), { empty: 'No decisions recorded.', columnStyles: { 0: { cellWidth: 140 } } });

  r.section('Sign-off', 'For the treating hospital’s records.');
  r.signatures(['Transplant coordinator', 'Treating physician']);

  r.section('About this report');
  r.note('This PDF records a match confirmed in OrganoTale. Rankings and scores are suggestions based on the information supplied; crossmatching, tissue typing, and medical eligibility are decided by the transplant team at the treating hospital.');
  return r.finish();
}

// ---- In the browser ----
export async function loadMatchReport(id) {
  return matchReport(await api(`/reports/matches/${id}`), { compress: true });
}
export function savePdf(doc, filename) {
  doc.save(filename);
}
