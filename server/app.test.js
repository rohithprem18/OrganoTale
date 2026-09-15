import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notify } from './util.js';
import { deliverEmailQueue, validCronToken } from './email.js';
import { ORGANS } from '../shared/options.js';

const registration = (email = 'member@example.test', extra = {}) => ({ first_name: 'Test', last_name: 'Member', dob: '1995-02-10', blood_group: 'O+', gender: 'Other', email, password: 'MemberPass123!', confirm_password: 'MemberPass123!', phone: '0000000000', address: 'Test City', zip: '000000', consent: true, ...extra });
const hospitalRegistration = (email = 'staff@hospital.test', extra = {}) => ({ hospital_name: 'Test Hospital', registration_number: `REG-${email}`, city: 'Mumbai', state: 'Maharashtra', pincode: '400001', hospital_phone: '0000000000', first_name: 'Staff', last_name: 'Member', phone: '0000000000', email, password: 'HospitalPass123!', confirm_password: 'HospitalPass123!', consent: true, ...extra });
const organRequest = (hospital_id, extra = {}) => ({ organ: 'Kidney', blood_group: 'O+', quantity: 1, urgency: 'Emergency', patient_dob: '1980-01-01', hospital_id, address: 'Test City', zip: '000000', phone: '0000000000', note: 'Fictional test request', ...extra });
const pledge = (extra = {}) => ({ organ: 'Kidney', donor_type: 'living', city: 'Pune', state: 'Maharashtra', height: 170, weight: 65, last_donation: '', operation_type: 'None', operation_desc: '', disease_type: 'None', disease_desc: '', accident_type: 'None', accident_desc: '', pregnant: 'Not applicable', menstruation: 'Not applicable', consent: true, ...extra });
const OVERRIDE = 'Clinical team documented a time-critical exception.';

async function fixture(t, options = {}) { const db = await openDatabase(':memory:'); const app = createApp(db, { limitAuth: false, ...options }); t.after(() => db.close()); return { db, app }; }
async function member(app, email, extra) { const client = request.agent(app); const result = await client.post('/api/auth/register').send(registration(email, extra)).expect(201); return { client, user: result.body.user }; }
async function hospital(app, db, email = 'staff@hospital.test', extra = {}) {
  const client = request.agent(app);
  const result = await client.post('/api/hospital/register').send(hospitalRegistration(email, extra)).expect(201);
  const id = result.body.user.hospital.id;
  await db.prepare("UPDATE hospitals SET status='verified' WHERE id=?").run(id);
  return { client, id, user: result.body.user };
}
async function verify(h, requestId, priority = 'urgent', extra = {}) {
  await h.client.patch(`/api/hospital/requests/${requestId}/verification`).send({ decision: 'verified', priority, clinical_score: 0, note: '', ...extra }).expect(200);
}

test('registration hashes passwords, sets secure session attributes, and persists identity', async (t) => {
  const { app, db } = await fixture(t); const client = request.agent(app);
  const res = await client.post('/api/auth/register').send({ ...registration(), role: 'admin' }).expect(201);
  assert.equal(res.body.user.role, 'member'); assert.equal(res.body.user.password_hash, undefined);
  assert.match(res.headers['set-cookie'][0], /HttpOnly/); assert.match(res.headers['set-cookie'][0], /SameSite=Strict/);
  assert.notEqual((await db.prepare('SELECT password_hash FROM users').get()).password_hash, registration().password);
  assert.equal((await client.get('/api/auth/me')).body.user.email, registration().email);
  await client.post('/api/auth/logout').send({}).expect(200);
  await client.get('/api/requests').expect(401);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).n, 0);
  await client.post('/api/auth/login').send({ email: registration().email, password: 'wrong' }).expect(401);
  await client.post('/api/auth/login').send({ email: registration().email, password: registration().password }).expect(200);
});
test('duplicate email, malformed dates, mismatched passwords, and missing consent are rejected', async (t) => {
  const { app } = await fixture(t); await member(app);
  await request(app).post('/api/auth/register').send(registration('MEMBER@example.test')).expect(409);
  for (const changes of [{ dob: '2020-02-31' }, { dob: '2099-01-01' }, { confirm_password: 'different' }, { consent: false }, { password: 'tiny' }]) {
    await request(app).post('/api/auth/register').send({ ...registration('new@example.test'), ...changes }).expect(400);
  }
});
test('requests need a verified hospital, stay owner-editable, and reset verification on clinical edits', async (t) => {
  const { app, db } = await fixture(t); const h = await hospital(app, db);
  const owner = await member(app, 'owner@example.test'); const other = await member(app, 'other@example.test');
  await owner.client.post('/api/requests').send(organRequest(9999)).expect(400);
  const pending = await request(app).post('/api/hospital/register').send(hospitalRegistration('pending@hospital.test')).expect(201);
  await owner.client.post('/api/requests').send(organRequest(pending.body.user.hospital.id)).expect(400);
  assert.deepEqual((await request(app).get('/api/hospitals')).body.map((row) => row.id), [h.id]);
  const id = (await owner.client.post('/api/requests').send({ ...organRequest(h.id), user_id: other.user.id }).expect(201)).body.id;
  await other.client.patch(`/api/requests/${id}`).send({ quantity: 2 }).expect(403);
  await other.client.delete(`/api/requests/${id}`).expect(403);
  await owner.client.patch(`/api/requests/${id}`).send({ quantity: 0 }).expect(400);
  await owner.client.patch(`/api/requests/${id}`).send({ verification: 'verified' }).expect(400);
  await verify(h, id, 'critical');
  await owner.client.patch(`/api/requests/${id}`).send({ quantity: 2 }).expect(200);
  assert.equal((await owner.client.get(`/api/requests/${id}`)).body.verification, 'verified');
  await owner.client.patch(`/api/requests/${id}`).send({ organ: 'Liver' }).expect(200);
  const edited = (await owner.client.get(`/api/requests/${id}`)).body;
  assert.equal(edited.verification, 'pending'); assert.equal(edited.priority, null); assert.equal(edited.verified_at, null);
  assert.equal((await owner.client.get('/api/requests?organ=Kidney')).body.length, 0);
  assert.equal((await owner.client.get('/api/requests?organ=Liver&blood_group=O%2B')).body.length, 1);
  const publicRow = (await other.client.get('/api/requests')).body[0];
  assert.equal(publicRow.phone, undefined); assert.equal(publicRow.zip, undefined); assert.equal(publicRow.patient_dob, undefined);
  assert.equal(publicRow.user_id, owner.user.id); assert.equal(publicRow.hospital_name, 'Test Hospital');
  await owner.client.patch(`/api/requests/${id}`).send({ status: 'closed' }).expect(200);
  assert.equal((await other.client.get('/api/requests')).body.length, 0);
  assert.equal((await owner.client.get('/api/requests?mine=true')).body.length, 1);
  await owner.client.delete(`/api/requests/${id}`).expect(200);
  await owner.client.get(`/api/requests/${id}`).expect(404);
});
test('hospital portal is separate: pending hospitals wait, other hospitals and members are kept out', async (t) => {
  const { app, db } = await fixture(t);
  const staff = request.agent(app);
  const registered = (await staff.post('/api/hospital/register').send(hospitalRegistration()).expect(201)).body.user;
  const hospitalId = registered.hospital.id;
  assert.equal(registered.role, 'hospital'); assert.equal(registered.hospital.status, 'pending');
  await request(app).post('/api/hospital/register').send(hospitalRegistration('second@hospital.test', { registration_number: 'reg-STAFF@hospital.test' })).expect(409);
  assert.equal((await staff.get('/api/hospital/me')).body.hospital.status, 'pending');
  await staff.get('/api/hospital/requests').expect(403);
  await staff.get('/api/requests').expect(403);
  await staff.post('/api/pledges').send(pledge()).expect(403);
  await request(app).get('/api/hospital/requests').expect(401);

  const admin = await member(app, 'admin@example.test'); await db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.user.id);
  const patient = await member(app, 'patient@example.test');
  await patient.client.get('/api/hospital/requests').expect(403);
  await patient.client.patch(`/api/admin/hospitals/${hospitalId}`).send({ status: 'verified' }).expect(403);
  await admin.client.patch(`/api/admin/hospitals/${hospitalId}`).send({ status: 'verified' }).expect(200);
  await staff.get('/api/hospital/requests').expect(200);

  const requestId = (await patient.client.post('/api/requests').send(organRequest(hospitalId)).expect(201)).body.id;
  const other = await hospital(app, db, 'other@hospital.test');
  await other.client.patch(`/api/hospital/requests/${requestId}/verification`).send({ decision: 'verified', priority: 'critical' }).expect(404);
  await other.client.get(`/api/hospital/requests/${requestId}/candidates`).expect(404);
  await staff.patch(`/api/hospital/requests/${requestId}/verification`).send({ decision: 'verified' }).expect(400);
  await staff.patch(`/api/hospital/requests/${requestId}/verification`).send({ decision: 'rejected', note: '' }).expect(400);
  await staff.patch(`/api/hospital/requests/${requestId}/verification`).send({ decision: 'verified', priority: 'urgent', clinical_score: 41 }).expect(400);
  await staff.patch(`/api/hospital/requests/${requestId}/verification`).send({ decision: 'verified', priority: 'urgent', clinical_score: 12 }).expect(200);
  const verified = (await staff.get(`/api/hospital/requests/${requestId}`)).body;
  assert.equal(verified.priority, 'urgent'); assert.equal(verified.clinical_score, 12); assert.ok(verified.verified_at);

  await admin.client.patch(`/api/admin/hospitals/${hospitalId}`).send({ status: 'suspended' }).expect(200);
  await staff.get('/api/hospital/requests').expect(403);
  const actions = (await admin.client.get('/api/admin/dashboard')).body.events.map((e) => e.action);
  for (const action of ['registered', 'status_verified', 'verified', 'status_suspended']) assert.ok(actions.includes(action), action);
});
test('priority ranking, override rule, donor consent, and confirmation', async (t) => {
  const { app, db } = await fixture(t);
  const mumbai = await hospital(app, db, 'mumbai@hospital.test');
  const pune = await hospital(app, db, 'pune@hospital.test', { city: 'Pune' });
  const donor = await member(app, 'donor@example.test');
  const adult = await member(app, 'adult@example.test');
  const child = await member(app, 'child@example.test', { blood_group: 'B+' });
  const pledgeId = (await donor.client.post('/api/pledges').send(pledge()).expect(201)).body.id;
  await donor.client.post('/api/pledges').send(pledge()).expect(409);
  await donor.client.post('/api/pledges').send(pledge({ organ: 'Heart' })).expect(400);
  const adultRequest = (await adult.client.post('/api/requests').send(organRequest(mumbai.id))).body.id;
  const childRequest = (await child.client.post('/api/requests').send(organRequest(pune.id, { blood_group: 'B+', patient_dob: '2014-01-01' }))).body.id;
  assert.equal((await mumbai.client.get(`/api/hospital/requests/${adultRequest}/candidates`)).body.candidates.length, 0);
  await verify(mumbai, adultRequest, 'critical');
  await verify(pune, childRequest, 'urgent');

  // Adult: critical 40 + identical blood 10 + same state 6 = 56. Child: urgent 25 + compatible 5 + same city 10 + child 5 = 45.
  const [forAdult] = (await mumbai.client.get(`/api/hospital/requests/${adultRequest}/candidates`)).body.candidates;
  assert.equal(forAdult.score, 56); assert.equal(forAdult.recipient_rank, 1); assert.equal(forAdult.donor_label, `Donor #${pledgeId}`);
  assert.equal(forAdult.first_name, undefined); assert.equal(forAdult.email, undefined);
  const [forChild] = (await pune.client.get(`/api/hospital/requests/${childRequest}/candidates`)).body.candidates;
  assert.equal(forChild.score, 45); assert.equal(forChild.recipient_rank, 2); assert.equal(forChild.requires_override, true);

  await pune.client.post('/api/hospital/matches').send({ request_id: childRequest, pledge_id: pledgeId }).expect(400);
  await pune.client.post('/api/hospital/matches').send({ request_id: adultRequest, pledge_id: pledgeId }).expect(404);
  const matchId = (await mumbai.client.post('/api/hospital/matches').send({ request_id: adultRequest, pledge_id: pledgeId }).expect(201)).body.id;
  await pune.client.post('/api/hospital/matches').send({ request_id: childRequest, pledge_id: pledgeId, override_reason: OVERRIDE }).expect(409);
  assert.equal((await pune.client.get(`/api/hospital/requests/${childRequest}/candidates`)).body.candidates.length, 0);
  await adult.client.patch(`/api/requests/${adultRequest}`).send({ blood_group: 'A+' }).expect(409);

  let proposed = (await mumbai.client.get('/api/hospital/matches')).body[0];
  assert.equal(proposed.donor_phone, undefined); assert.equal(proposed.donor_email, undefined); assert.equal(proposed.recipient_rank, 1);
  await mumbai.client.patch(`/api/hospital/matches/${matchId}`).send({ status: 'confirmed' }).expect(409);
  await adult.client.patch(`/api/matches/${matchId}/response`).send({ response: 'accepted' }).expect(403);
  assert.equal((await donor.client.get('/api/matches')).body[0].hospital_name, 'Test Hospital');
  await donor.client.patch(`/api/matches/${matchId}/response`).send({ response: 'accepted' }).expect(200);
  await donor.client.patch(`/api/matches/${matchId}/response`).send({ response: 'declined' }).expect(409);
  proposed = (await mumbai.client.get('/api/hospital/matches')).body[0];
  assert.equal(proposed.donor_email, 'donor@example.test');
  await pune.client.patch(`/api/hospital/matches/${matchId}`).send({ status: 'confirmed' }).expect(404);
  await mumbai.client.patch(`/api/hospital/matches/${matchId}`).send({ status: 'confirmed' }).expect(200);

  assert.equal((await adult.client.get(`/api/requests/${adultRequest}`)).body.status, 'closed');
  assert.equal((await donor.client.get('/api/pledges')).body[0].status, 'matched');
  assert.equal((await adult.client.get('/api/matches')).body[0].status, 'confirmed');
  await donor.client.patch(`/api/pledges/${pledgeId}`).send({ status: 'withdrawn' }).expect(409);
  const events = await db.prepare("SELECT action FROM audit_events WHERE entity='match' AND entity_id=? ORDER BY id").all(matchId);
  assert.deepEqual(events.map((e) => e.action), ['proposed', 'donor_accepted', 'confirmed']);
});
test('concurrent proposals for the same donor create only one active match', async (t) => {
  const { app, db } = await fixture(t);
  const h = await hospital(app, db);
  const donor = await member(app, 'donor@example.test');
  const first = await member(app, 'first@example.test'); const second = await member(app, 'second@example.test');
  const pledgeId = (await donor.client.post('/api/pledges').send(pledge())).body.id;
  const ids = [];
  for (const account of [first, second]) {
    const id = (await account.client.post('/api/requests').send(organRequest(h.id))).body.id;
    await verify(h, id, 'critical'); ids.push(id);
  }
  const results = await Promise.all(ids.map((id) => h.client.post('/api/hospital/matches').send({ request_id: id, pledge_id: pledgeId, override_reason: OVERRIDE })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await db.prepare("SELECT COUNT(*)::int AS n FROM matches WHERE status='proposed'").get()).n, 1);
});
test('deceased pledges match only after a hospital reports them available, within preservation limits', async (t) => {
  const { app, db } = await fixture(t);
  const mumbai = await hospital(app, db, 'mumbai@hospital.test');
  const bengaluru = await hospital(app, db, 'blr@hospital.test', { city: 'Bengaluru', state: 'Karnataka' });
  const donor = await member(app, 'donor@example.test');
  const near = await member(app, 'near@example.test'); const far = await member(app, 'far@example.test');
  const pledgeId = (await donor.client.post('/api/pledges').send(pledge({ organ: 'Heart', donor_type: 'deceased', city: 'Mumbai' })).expect(201)).body.id;
  const livingId = (await donor.client.post('/api/pledges').send(pledge()).expect(201)).body.id;
  const nearRequest = (await near.client.post('/api/requests').send(organRequest(mumbai.id, { organ: 'Heart' }))).body.id;
  const farRequest = (await far.client.post('/api/requests').send(organRequest(bengaluru.id, { organ: 'Heart' }))).body.id;
  await verify(mumbai, nearRequest, 'critical'); await verify(bengaluru, farRequest, 'critical');
  assert.equal((await mumbai.client.get(`/api/hospital/requests/${nearRequest}/candidates`)).body.candidates.length, 0);

  const found = (await mumbai.client.get('/api/hospital/donors?email=DONOR@example.test').expect(200)).body;
  assert.deepEqual(found.map((p) => p.id), [pledgeId]);
  await mumbai.client.get('/api/hospital/donors?email=not-an-email').expect(400);
  await mumbai.client.post(`/api/hospital/pledges/${livingId}/availability`).send({}).expect(404);
  await mumbai.client.post(`/api/hospital/pledges/${pledgeId}/availability`).send({}).expect(200);
  await bengaluru.client.post(`/api/hospital/pledges/${pledgeId}/availability`).send({}).expect(409);

  const [candidate] = (await mumbai.client.get(`/api/hospital/requests/${nearRequest}/candidates`)).body.candidates;
  assert.equal(candidate.pledge_id, pledgeId); assert.equal(candidate.location, 'Test Hospital, Mumbai');
  assert.equal((await bengaluru.client.get(`/api/hospital/requests/${farRequest}/candidates`)).body.candidates.length, 0);

  // An after-death donor cannot respond, so the match starts accepted and can be confirmed.
  const deceasedMatch = (await mumbai.client.post('/api/hospital/matches').send({ request_id: nearRequest, pledge_id: pledgeId }).expect(201)).body;
  assert.equal(deceasedMatch.donor_response, 'accepted');
  await mumbai.client.patch(`/api/hospital/matches/${deceasedMatch.id}`).send({ status: 'confirmed', reason: '' }).expect(200);
  assert.equal((await donor.client.get('/api/notifications')).body.items.filter((n) => n.kind.startsWith('match_')).length, 0);
});
test('withdrawing a pledge or closing a request declines proposed matches', async (t) => {
  const { app, db } = await fixture(t);
  const h = await hospital(app, db);
  const donor = await member(app, 'donor@example.test'); const owner = await member(app, 'owner@example.test');
  const pledgeId = (await donor.client.post('/api/pledges').send(pledge())).body.id;
  const requestId = (await owner.client.post('/api/requests').send(organRequest(h.id))).body.id;
  await verify(h, requestId);
  const first = (await h.client.post('/api/hospital/matches').send({ request_id: requestId, pledge_id: pledgeId }).expect(201)).body.id;
  await donor.client.patch(`/api/pledges/${pledgeId}`).send({ status: 'withdrawn' }).expect(200);
  const withdrawn = await db.prepare('SELECT status, donor_response FROM matches WHERE id=?').get(first);
  assert.deepEqual({ ...withdrawn }, { status: 'declined', donor_response: 'declined' });
  await donor.client.patch(`/api/pledges/${pledgeId}`).send({ status: 'active' }).expect(200);
  // The declined pairing is not offered again.
  assert.equal((await h.client.get(`/api/hospital/requests/${requestId}/candidates`)).body.candidates.length, 0);

  const secondPledge = (await (await member(app, 'second@example.test')).client.post('/api/pledges').send(pledge())).body.id;
  const second = (await h.client.post('/api/hospital/matches').send({ request_id: requestId, pledge_id: secondPledge }).expect(201)).body.id;
  await h.client.patch(`/api/hospital/matches/${second}`).send({ status: 'declined', reason: '' }).expect(400);
  await owner.client.delete(`/api/requests/${requestId}`).expect(409);
  await owner.client.patch(`/api/requests/${requestId}`).send({ status: 'closed' }).expect(200);
  assert.equal((await db.prepare('SELECT status FROM matches WHERE id=?').get(second)).status, 'declined');
});
test('records are private and only their owner can delete them', async (t) => {
  const { app } = await fixture(t); const owner = await member(app, 'owner@example.test'); const other = await member(app, 'other@example.test');
  const data = { organ: 'Kidney', blood_group: 'O+', quantity: 1, donated_on: '2024-10-10', note: 'Test record' };
  await owner.client.post('/api/records').send({ ...data, donated_on: '2099-01-01' }).expect(400);
  const id = (await owner.client.post('/api/records').send(data).expect(201)).body.id;
  assert.equal((await other.client.get('/api/records')).body.length, 0);
  await other.client.delete(`/api/records/${id}`).expect(403);
  assert.equal((await owner.client.get('/api/overview')).body.records, 1);
  await owner.client.delete(`/api/records/${id}`).expect(200);
});
test('admin sees national rankings and oversight data; member deletion cascades', async (t) => {
  const { app, db } = await fixture(t);
  const admin = await member(app, 'admin@example.test'); await db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.user.id);
  const h = await hospital(app, db);
  const donor = await member(app, 'donor@example.test'); const owner = await member(app, 'owner@example.test');
  await donor.client.get('/api/admin/dashboard').expect(403);
  const pledgeId = (await donor.client.post('/api/pledges').send(pledge())).body.id;
  const requestId = (await owner.client.post('/api/requests').send(organRequest(h.id))).body.id;
  await verify(h, requestId, 'stable');
  const ranking = (await admin.client.get(`/api/admin/pledges/${pledgeId}/recipients`).expect(200)).body;
  assert.deepEqual(ranking.recipients.map((r) => [r.request_id, r.rank]), [[requestId, 1]]);
  await donor.client.get(`/api/admin/pledges/${pledgeId}/recipients`).expect(403);
  await admin.client.get('/api/admin/pledges/999/recipients').expect(404);
  const dashboard = (await admin.client.get('/api/admin/dashboard')).body;
  assert.equal(dashboard.users.some((u) => 'password_hash' in u), false);
  assert.equal(dashboard.hospitals.length, 1); assert.equal(dashboard.pledges.length, 1);
  await admin.client.patch(`/api/admin/hospitals/${h.id}`).send({ status: 'bogus' }).expect(400);
  await admin.client.delete(`/api/admin/users/${admin.user.id}`).expect(403);
  await admin.client.delete(`/api/admin/users/${donor.user.id}`).expect(200);
  await donor.client.get('/api/records').expect(401);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM pledges').get()).n, 0);
});
test('notifications reach the right people across the match lifecycle; admin analytics add up', async (t) => {
  const { app, db } = await fixture(t);
  const admin = await member(app, 'admin@example.test'); await db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.user.id);
  const staff = request.agent(app);
  const hospitalId = (await staff.post('/api/hospital/register').send(hospitalRegistration()).expect(201)).body.user.hospital.id;
  const adminInbox = (await admin.client.get('/api/notifications')).body;
  assert.equal(adminInbox.unread, 1); assert.match(adminInbox.items[0].title, /Test Hospital/); assert.equal(adminInbox.items[0].link, '/admin?tab=hospitals');
  await admin.client.patch(`/api/admin/hospitals/${hospitalId}`).send({ status: 'verified' }).expect(200);
  assert.equal((await staff.get('/api/notifications')).body.items[0].kind, 'hospital_verified');

  const donor = await member(app, 'donor@example.test'); const owner = await member(app, 'owner@example.test');
  const pledgeId = (await donor.client.post('/api/pledges').send(pledge())).body.id;
  const requestId = (await owner.client.post('/api/requests').send(organRequest(hospitalId))).body.id;
  assert.ok((await staff.get('/api/notifications')).body.items.some((n) => n.link === `/hospital?request=${requestId}`));
  await verify({ client: staff }, requestId, 'critical');
  assert.equal((await owner.client.get('/api/notifications')).body.items[0].kind, 'request_verified');
  const matchId = (await staff.post('/api/hospital/matches').send({ request_id: requestId, pledge_id: pledgeId })).body.id;
  const donorInbox = (await donor.client.get('/api/notifications')).body;
  assert.equal(donorInbox.unread, 1); assert.equal(donorInbox.items[0].kind, 'match_proposed');
  await donor.client.patch(`/api/matches/${matchId}/response`).send({ response: 'accepted' }).expect(200);
  assert.ok((await staff.get('/api/notifications')).body.items.some((n) => n.kind === 'donor_accepted'));
  await staff.patch(`/api/hospital/matches/${matchId}`).send({ status: 'confirmed', reason: '' }).expect(200);
  assert.ok((await donor.client.get('/api/notifications')).body.items.some((n) => n.kind === 'match_confirmed'));

  const ownerInbox = (await owner.client.get('/api/notifications')).body;
  assert.deepEqual(ownerInbox.items.map((n) => n.kind), ['match_confirmed', 'donor_proposed', 'request_verified']);
  await donor.client.post('/api/notifications/read').send({ ids: [ownerInbox.items[0].id] }).expect(200);
  assert.equal((await owner.client.get('/api/notifications')).body.unread, 3, "another account's read does not touch these");
  await owner.client.post('/api/notifications/read').send({ ids: [ownerInbox.items[0].id] }).expect(200);
  assert.equal((await owner.client.get('/api/notifications')).body.unread, 2);
  await owner.client.post('/api/notifications/read').send({}).expect(200);
  assert.equal((await owner.client.get('/api/notifications')).body.unread, 0);
  await request(app).get('/api/notifications').expect(401);

  const analytics = (await admin.client.get('/api/admin/analytics').expect(200)).body;
  assert.deepEqual(analytics.matchesByState, [{ state: 'Maharashtra', confirmed: 1, proposed: 0 }]);
  assert.deepEqual(analytics.requestsByOrgan, []);
  await donor.client.get('/api/admin/analytics').expect(403);
});
test('cross-origin writes, form posts, invalid JSON, and expired sessions are rejected', async (t) => {
  const { app, db } = await fixture(t);
  await request(app).post('/api/auth/register').set('Origin', 'https://untrusted.example').send(registration()).expect(403);
  await request(app).post('/api/hospital/register').set('Origin', 'https://untrusted.example').send(hospitalRegistration()).expect(403);
  await request(app).post('/api/auth/login').type('form').send({ email: 'a@example.test' }).expect(415);
  await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{broken').expect(400);
  const account = await member(app);
  await db.prepare('UPDATE sessions SET expires_at=0').run();
  await account.client.get('/api/records').expect(401);
});
test('SQL-like content stays literal and API errors do not expose database internals', async (t) => {
  const { app, db } = await fixture(t); const h = await hospital(app, db); const account = await member(app);
  await account.client.post('/api/requests').send({ ...organRequest(h.id), note: "'); DROP TABLE users; --" }).expect(201);
  assert.equal((await account.client.get('/api/requests')).body[0].note, "'); DROP TABLE users; --");
  const result = await account.client.get('/api/requests/1%20OR%201=1').expect(404);
  assert.equal(result.body.error, 'Request not found.');
  await h.client.get('/api/hospital/requests/1%20OR%201=1/candidates').expect(404);
  assert.ok((await account.client.get('/api/auth/me')).body.user);
});
test('database data survives closing and reopening the local store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'organotale-test-'));
  try {
    const store = join(dir, 'pgdata'); let db = await openDatabase(store);
    await db.prepare('INSERT INTO users(first_name,last_name,dob,blood_group,gender,email,password_hash,phone,address,zip) VALUES(?,?,?,?,?,?,?,?,?,?)').run('Test','Persistence','1990-01-01','O+','Other','test@example.test','unused','0000000000','Test City','000000');
    await db.close(); db = await openDatabase(store);
    assert.equal((await db.prepare('SELECT first_name FROM users').get()).first_name, 'Test');
    assert.deepEqual((await db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).map((row) => row.version), [1, 2, 3, 4, 5]);
    await db.close();
  } finally {
    // Windows can hold file handles briefly after close; retry cleanup instead of flaking.
    for (let attempt = 1; ; attempt++) {
      try { rmSync(dir, { recursive: true, force: true }); break; }
      catch (error) { if (attempt >= 5) throw error; await new Promise((r) => setTimeout(r, 50 * attempt)); }
    }
  }
});


test('postal lookup validates input and reports unavailable service without guessing a city', async (t) => {
  const { app } = await fixture(t, { lookupPostal: async (pin) => {
    if (pin === '400001') return [{ city: 'Mumbai', state: 'Maharashtra' }];
    if (pin === '999999') return [];
    throw new Error('provider unavailable');
  } });
  await request(app).get('/api/pincodes/40000').expect(400);
  const found = await request(app).get('/api/pincodes/400001').expect(200);
  assert.equal(found.body.locations[0].city, 'Mumbai');
  assert.deepEqual((await request(app).get('/api/pincodes/999999')).body.locations, []);
  await request(app).get('/api/pincodes/110001').expect(503);
});

test('email preferences are private; alert jobs are transactional, retryable, and respect opt-out', async (t) => {
  const { app, db } = await fixture(t);
  const owner = await member(app, 'alerts@example.test');
  const other = await member(app, 'other-alerts@example.test');
  await request(app).get('/api/notifications/preferences').expect(401);
  await request(app).get('/api/jobs/email').expect(401);
  assert.equal(validCronToken('Bearer test-secret', 'test-secret'), true);
  assert.equal(validCronToken('Bearer wrong', 'test-secret'), false);
  assert.equal(validCronToken('Bearer undefined', undefined), false);
  assert.equal((await owner.client.get('/api/notifications/preferences')).body.email_alerts, false);
  await owner.client.patch('/api/notifications/preferences').send({ email_alerts: true, user_id: other.user.id }).expect(400);
  await owner.client.patch('/api/notifications/preferences').send({ email_alerts: true }).expect(200);
  assert.equal((await other.client.get('/api/notifications/preferences')).body.email_alerts, false);
  const alert = { kind: 'match_proposed', title: 'Sensitive organ and patient details', body: 'Private medical history', link: '/dashboard' };
  await assert.rejects(db.transaction(async (tx) => { await notify(tx, { userIds: [owner.user.id] }, alert); throw new Error('rollback'); }));
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM email_outbox').get()).n, 0);
  await notify(db, { userIds: [owner.user.id, other.user.id, owner.user.id] }, alert);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM email_outbox').get()).n, 1);
  assert.equal((await deliverEmailQueue(db, { env: {} })).configured, false);
  const env = { RESEND_API_KEY: 'test-key', ALERT_EMAIL_FROM: 'OrganoTale <alerts@example.test>', APP_URL: 'https://organotale.example.test' };
  const calls = [];
  const failOnce = async (url, options) => { calls.push(options); return new Response('{}', { status: 503 }); };
  const failed = await deliverEmailQueue(db, { env, fetcher: failOnce });
  assert.equal(failed.failed, 1);
  assert.equal((await db.prepare('SELECT status FROM email_outbox').get()).status, 'pending');
  await db.prepare("UPDATE email_outbox SET next_attempt_at=now() - interval '1 second'").run();
  const success = async (url, options) => { calls.push(options); return new Response('{"id":"email-test"}', { status: 200 }); };
  const results = await Promise.all([deliverEmailQueue(db, { env, fetcher: success }), deliverEmailQueue(db, { env, fetcher: success })]);
  assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.ok(!calls[1].body.includes('Sensitive') && !calls[1].body.includes('Private medical'));
  assert.deepEqual(JSON.parse(calls[1].body).to, [owner.user.email]);
  await notify(db, { userIds: [owner.user.id] }, { ...alert, kind: 'match_confirmed' });
  await owner.client.patch('/api/notifications/preferences').send({ email_alerts: false }).expect(200);
  assert.equal((await deliverEmailQueue(db, { env, fetcher: success })).sent, 0);
  assert.equal((await db.prepare("SELECT COUNT(*)::int AS n FROM email_outbox WHERE status='cancelled'").get()).n, 1);
});


test('donor status controls living donation and requires hospital verification for every after-death organ', async (t) => {
  const { app, db } = await fixture(t);
  const h = await hospital(app, db);
  const donor = await member(app, 'status-donor@example.test');
  const recipient = await member(app, 'status-recipient@example.test');
  await request(app).get('/api/auth/donor-settings').expect(401);
  await h.client.patch('/api/auth/donor-settings').send({ donor_status: 'deceased', acknowledged: true }).expect(403);
  assert.equal((await donor.client.get('/api/auth/donor-settings')).body.donor_status, 'alive');
  await donor.client.patch('/api/auth/donor-settings').send({ donor_status: 'deceased' }).expect(400);
  await donor.client.patch('/api/auth/donor-settings').send({ donor_status: 'deceased', acknowledged: true, user_id: recipient.user.id }).expect(400);
  await donor.client.post('/api/pledges').send(pledge({ organ: 'Heart' })).expect(400);
  const livingId = (await donor.client.post('/api/pledges').send(pledge()).expect(201)).body.id;
  const requestId = (await recipient.client.post('/api/requests').send(organRequest(h.id)).expect(201)).body.id;
  await verify(h, requestId);
  const matchId = (await h.client.post('/api/hospital/matches').send({ request_id: requestId, pledge_id: livingId }).expect(201)).body.id;
  const changed = await donor.client.patch('/api/auth/donor-settings').send({ donor_status: 'deceased', acknowledged: true }).expect(200);
  assert.equal(changed.body.user.donor_status, 'deceased');
  assert.equal(changed.body.user.password_hash, undefined);
  assert.equal((await donor.client.get('/api/auth/me')).body.user.donor_status, 'deceased');
  assert.equal((await db.prepare('SELECT status FROM pledges WHERE id=?').get(livingId)).status, 'withdrawn');
  assert.equal((await db.prepare('SELECT status FROM matches WHERE id=?').get(matchId)).status, 'declined');
  assert.equal((await db.prepare('SELECT status FROM requests WHERE id=?').get(requestId)).status, 'open');
  await donor.client.patch(`/api/matches/${matchId}/response`).send({ response: 'accepted' }).expect(409);
  await h.client.patch(`/api/hospital/matches/${matchId}`).send({ status: 'confirmed' }).expect(409);
  await donor.client.post('/api/pledges').send(pledge()).expect(409);
  await donor.client.patch(`/api/pledges/${livingId}`).send({ status: 'active' }).expect(409);
  const deceasedIds = [];
  for (const organ of ORGANS) deceasedIds.push((await donor.client.post('/api/pledges').send(pledge({ organ, donor_type: 'deceased' })).expect(201)).body.id);
  assert.equal((await h.client.get(`/api/hospital/requests/${requestId}/candidates`)).body.candidates.length, 0);
  assert.equal((await donor.client.get('/api/auth/donor-settings')).body.hospital_verified, false);
  // A mistaken self-report is reversible, but it does not reactivate old pledges.
  await donor.client.patch('/api/auth/donor-settings').send({ donor_status: 'alive', acknowledged: true }).expect(200);
  assert.equal((await db.prepare('SELECT status FROM pledges WHERE id=?').get(livingId)).status, 'withdrawn');
  const kidneyId = deceasedIds[ORGANS.indexOf('Kidney')];
  await h.client.post(`/api/hospital/pledges/${kidneyId}/availability`).send({}).expect(200);
  const settings = (await donor.client.get('/api/auth/donor-settings')).body;
  assert.equal(settings.donor_status, 'deceased'); assert.equal(settings.hospital_verified, true);
  await donor.client.patch('/api/auth/donor-settings').send({ donor_status: 'alive', acknowledged: true }).expect(409);
  assert.equal((await h.client.get(`/api/hospital/requests/${requestId}/candidates`)).body.candidates[0].pledge_id, kidneyId);
  const deceasedMatch = (await h.client.post('/api/hospital/matches').send({ request_id: requestId, pledge_id: kidneyId }).expect(201)).body;
  assert.equal(deceasedMatch.donor_response, 'accepted');
  await h.client.patch(`/api/hospital/matches/${deceasedMatch.id}`).send({ status: 'confirmed' }).expect(200);
  const history = await db.prepare("SELECT detail FROM audit_events WHERE entity='user' AND entity_id=? AND action='donor_status_changed'").all(donor.user.id);
  assert.equal(history.length, 3);
  assert.equal((await recipient.client.get('/api/auth/me')).body.user.donor_status, 'alive');
});
