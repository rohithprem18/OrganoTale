import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchReport, clean } from './pdf.js';

const text = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
const at = '2026-09-01T10:00:00Z';
const record = (viewer) => ({
  viewer,
  match: {
    id: 12, status: 'confirmed', score: 58, recipient_rank: 1, competing_recipients: 2, override_reason: '', decision_reason: '',
    proposed_at: at, accepted_at: at, confirmed_at: at, confirmed_by: 'Staff Member',
    breakdown: [{ factor: 'urgency', label: 'Verified critical', points: 40, max: 40 }, { factor: 'blood', label: 'Identical blood group', points: 10, max: 10 }],
  },
  hospital: { name: 'Demo City Hospital', registration_number: 'REG-1', city: 'Mumbai', state: 'Maharashtra', phone: '0000000000', email: 'staff@hospital.test' },
  recipient: { request_id: 3, organ: 'Kidney', blood_group: 'O+', quantity: 1, urgency: 'Emergency', priority: 'critical', clinical_score: 12, verified_at: at, name: 'Meera Demo', patient_age: 48 },
  donor: { pledge_id: 5, donor_type: 'living', blood_group: 'O+', name: 'Aarav Demo', age: 31, location: 'Pune, Maharashtra', phone: '0000000000', email: 'aarav@example.test', flags: ['BMI 36 is outside 18.5-35'] },
  timeline: [{ at, action: 'proposed', by: 'Staff Member' }, { at, action: 'donor_accepted', by: 'Donor' }, { at, action: 'confirmed', by: 'Staff Member' }],
});

test('text is reduced to characters the built-in PDF fonts can draw', () => {
  assert.equal(clean(null), '—');
  assert.equal(clean(0), '0');
  assert.equal(clean('Zoë · O’Neil'), 'Zoe · O’Neil');
  assert.equal(clean('1 Sept 2026, 3:30 pm'), '1 Sept 2026, 3:30 pm');
  assert.equal(clean('देव'), '???');
});

test('the hospital copy of a confirmed match includes every section, both parties, and page numbers', async () => {
  const doc = await matchReport(record('hospital'));
  const out = text(doc);
  assert.ok(out.startsWith('%PDF'));
  for (const expected of ['Kidney match #12', 'Treating hospital copy', 'Contents', 'Match summary', 'Recipient', 'Meera Demo', 'Donor', 'Aarav Demo', 'aarav@example.test', 'Screening flags',
    'Priority score breakdown', 'Medical priority', '58 / 100', '#1 of 2', 'Decision timeline', 'Match confirmed after medical tests', 'Sign-off', 'Transplant coordinator', `Page 1 of ${doc.getNumberOfPages()}`, 'Confidential']) {
    assert.ok(out.includes(expected), `missing "${expected}"`);
  }
});

test('the recipient copy leaves out the donor identity and screening answers', async () => {
  const data = record('recipient');
  data.donor = { pledge_id: 5, donor_type: 'living', blood_group: 'O+' };
  const out = text(await matchReport(data));
  assert.ok(out.includes('Recipient copy'));
  assert.ok(out.includes('Meera Demo'));
  for (const hidden of ['Aarav Demo', 'aarav@example.test', 'Screening flags']) assert.ok(!out.includes(hidden), `should not include "${hidden}"`);
});
