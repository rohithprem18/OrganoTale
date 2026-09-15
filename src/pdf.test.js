import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberReport, hospitalReport, adminReport, clean } from './pdf.js';

const text = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
const at = '2026-09-01T10:00:00Z';
const user = { first_name: 'Aarav', last_name: 'Demo', email: 'aarav@example.test', phone: '0000000000', blood_group: 'O+', dob: '1995-02-10', gender: 'Male', address: 'Pune', zip: '411001', donor_status: 'alive', role: 'member', created_at: at };

test('text is reduced to characters the built-in PDF fonts can draw', () => {
  assert.equal(clean(null), '—');
  assert.equal(clean(0), '0');
  assert.equal(clean('Zoë · O’Neil'), 'Zoe · O’Neil');
  assert.equal(clean('1 Sept 2026, 3:30\u202fpm'), '1 Sept 2026, 3:30 pm');
  assert.equal(clean('देव'), '???');
});

test('member report has a cover, contents, every section, and page numbers across many pages', async () => {
  const pledges = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, organ: 'Kidney', donor_type: i % 2 ? 'living' : 'deceased', city: 'Pune', state: 'Maharashtra', status: 'active', created_at: at }));
  const matches = [{ id: 7, is_donor: true, organ: 'Kidney', hospital_name: 'Demo City Hospital', hospital_city: 'Mumbai', donor_response: 'pending', status: 'proposed', created_at: at }];
  const doc = await memberReport({ user, pledges, requests: [], matches, records: [{ organ: 'Kidney', blood_group: 'O+', quantity: 1, donated_on: '2025-01-15', note: 'Blood drive' }] });
  const out = text(doc);
  assert.ok(out.startsWith('%PDF'));
  assert.ok(doc.getNumberOfPages() > 1);
  for (const expected of ['My OrganoTale report', 'Contents', 'Profile', 'Pledges', 'Organ requests', 'No organ requests yet.', 'Matches', 'Donation records', 'Blood drive', 'About this report', `Page ${doc.getNumberOfPages()} of ${doc.getNumberOfPages()}`, 'Confidential']) {
    assert.ok(out.includes(expected), `missing "${expected}"`);
  }
});

test('hospital and admin reports include rankings, matches, and the audit log', async () => {
  const request = { id: 1, first_name: 'Meera', last_name: 'Demo', patient_dob: '1978-03-02', organ: 'Kidney', blood_group: 'O+', urgency: 'Emergency', verification: 'verified', priority: 'critical', clinical_score: 12, status: 'open', active_matches: 0, created_at: at };
  const candidate = { donor_label: 'Donor #3', donor_type: 'living', blood_group: 'O+', blood_match: 'identical', age: 31, location: 'Pune, Maharashtra', score: 58, recipient_rank: 1, competing_recipients: 2, flags: [] };
  const hospital = { name: 'Demo City Hospital', registration_number: 'REG-1', status: 'verified', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', phone: '0000000000', email: 'staff@hospital.test', created_at: at };
  const hospitalOut = text(await hospitalReport({ user, hospital, requests: [request], matches: [], rankings: [{ request, candidates: [candidate] }] }));
  for (const expected of ['Demo City Hospital report', 'Patient requests', 'Ranked donors', 'Donor #3', '#1 of 2', 'No matches yet.']) assert.ok(hospitalOut.includes(expected), `missing "${expected}"`);

  const dashboard = {
    hospitals: [{ ...hospital, request_count: 1 }], users: [{ ...user, hospital_name: null }], requests: [{ ...request, hospital_name: hospital.name }], pledges: [], records: [],
    matches: [{ id: 4, organ: 'Kidney', hospital_name: hospital.name, requester_first_name: 'Meera', requester_last_name: 'Demo', donor_first_name: 'Aarav', donor_last_name: 'Demo', score: 58, recipient_rank: 1, donor_response: 'accepted', status: 'confirmed', created_at: at }],
    events: [{ id: 1, action: 'status_verified', entity: 'hospital', entity_id: 1, first_name: 'Admin', last_name: 'Demo', role: 'admin', detail: {}, created_at: at }],
  };
  const analytics = { requestsByOrgan: [{ organ: 'Kidney', open: 1, verified: 1 }], waitingByOrgan: [], matchesByState: [{ state: 'Maharashtra', confirmed: 1, proposed: 0 }] };
  const adminOut = text(await adminReport({ user, dashboard, analytics }));
  for (const expected of ['OrganoTale system report', 'Overview', 'Hospitals', 'Members and staff', 'Audit log', 'Admin Demo verified hospital #1', 'No verified open requests.']) assert.ok(adminOut.includes(expected), `missing "${expected}"`);
});
