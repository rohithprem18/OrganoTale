import express from 'express';
import { z } from 'zod';
import { hashPassword, createSession } from '../auth.js';
import { hospitalRegisterSchema, verificationSchema, proposalSchema, matchDecisionSchema } from '../validation.js';
import { HttpError, idOf, audit, notify, loadMatching } from '../util.js';
import { evaluate, rankRecipients, rankDonors } from '../matching.js';
import { accountView } from './account.js';
import { reportDeceased, DECEASED_REASON } from '../donor-status.js';

const HEALTH_FIELDS = ['operation_type', 'operation_desc', 'disease_type', 'disease_desc', 'accident_type', 'accident_desc', 'pregnant', 'menstruation'];
const DONOR_CONTACT = ['donor_first_name', 'donor_last_name', 'donor_phone', 'donor_email'];

// /api/hospital — the hospital portal, separate from member endpoints. Staff of a verified
// hospital verify their own patients' requests, review ranked donors, and manage matches.
export function hospitalRoutes(db) {
  const router = express.Router();

  router.post('/register', async (req, res) => {
    const d = hospitalRegisterSchema.parse(req.body);
    if (await db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(d.email)) throw new HttpError(409, 'This email is already registered.');
    if (await db.prepare('SELECT id FROM hospitals WHERE lower(registration_number)=lower(?)').get(d.registration_number)) throw new HttpError(409, 'A hospital with this registration number is already registered.');
    const passwordHash = await hashPassword(d.password);
    const staff = await db.transaction(async (tx) => {
      const hospital = await tx.prepare('INSERT INTO hospitals(name,registration_number,city,state,pincode,phone,email) VALUES(?,?,?,?,?,?,?) RETURNING id').get(d.hospital_name, d.registration_number, d.city, d.state, d.pincode, d.hospital_phone, d.email);
      const user = await tx.prepare(`INSERT INTO users(first_name,last_name,email,password_hash,phone,address,zip,role,hospital_id) VALUES(?,?,?,?,?,?,?,'hospital',?) RETURNING *`).get(d.first_name, d.last_name, d.email, passwordHash, d.phone, `${d.city}, ${d.state}`, d.pincode, hospital.id);
      await audit(tx, user.id, 'hospital', hospital.id, 'registered', { name: d.hospital_name, registration_number: d.registration_number });
      await notify(tx, { role: 'admin' }, { kind: 'hospital_registered', title: `New hospital registration: ${d.hospital_name}`, body: `${d.city}, ${d.state} · awaiting verification`, link: '/admin?tab=hospitals' });
      return user;
    });
    await createSession(db, res, staff.id);
    res.status(201).json({ user: await accountView(db, staff) });
  });

  router.use(async (req, res, next) => {
    if (!req.user) throw new HttpError(401, 'Please log in to continue.');
    if (req.user.role !== 'hospital') throw new HttpError(403, 'Hospital staff access is required.');
    req.hospital = await db.prepare('SELECT * FROM hospitals WHERE id=?').get(req.user.hospital_id);
    next();
  });
  router.get('/me', (req, res) => res.json({ hospital: req.hospital }));
  router.use((req, res, next) => {
    if (req.hospital.status === 'pending') throw new HttpError(403, 'Your hospital is awaiting verification by an administrator.');
    if (req.hospital.status !== 'verified') throw new HttpError(403, 'Your hospital account is suspended. Contact an administrator.');
    next();
  });

  async function ownRequest(req, value) {
    const id = idOf(value);
    const row = id && await db.prepare('SELECT * FROM requests WHERE id=?').get(id);
    if (!row || row.hospital_id !== req.hospital.id) throw new HttpError(404, 'Request not found at your hospital.');
    return row;
  }

  // ---- Requests from this hospital's patients ----
  router.get('/requests', async (req, res) => {
    res.json(await db.prepare(`SELECT r.*, u.first_name, u.last_name, u.email,
        (SELECT COUNT(*)::int FROM matches m WHERE m.request_id=r.id AND m.status IN ('proposed','confirmed')) AS active_matches
      FROM requests r JOIN users u ON u.id=r.user_id
      WHERE r.hospital_id=? ORDER BY (r.status='open') DESC, (r.verification='pending') DESC, r.created_at DESC`).all(req.hospital.id));
  });
  router.get('/requests/:id', async (req, res) => {
    const row = await ownRequest(req, req.params.id);
    const requester = await db.prepare('SELECT first_name, last_name, email FROM users WHERE id=?').get(row.user_id);
    res.json({ ...row, ...requester });
  });
  router.patch('/requests/:id/verification', async (req, res) => {
    const row = await ownRequest(req, req.params.id);
    const d = verificationSchema.parse(req.body);
    if (row.status !== 'open') throw new HttpError(409, 'Closed requests cannot be verified.');
    if (d.decision === 'rejected' && (await db.prepare("SELECT id FROM matches WHERE request_id=? AND status IN ('proposed','confirmed') LIMIT 1").get(row.id))) {
      throw new HttpError(409, 'Decline the active match before rejecting this request.');
    }
    await db.transaction(async (tx) => {
      if (d.decision === 'verified') {
        // Re-verifying (e.g. a changed priority) keeps the original waiting-time start.
        await tx.prepare("UPDATE requests SET verification='verified', priority=?, clinical_score=?, hospital_note=?, verified_at=COALESCE(verified_at, now()) WHERE id=?").run(d.priority, d.clinical_score, d.note, row.id);
      } else {
        await tx.prepare("UPDATE requests SET verification='rejected', priority=NULL, clinical_score=0, hospital_note=?, verified_at=NULL WHERE id=?").run(d.note, row.id);
      }
      const organ = row.organ.toLowerCase();
      await notify(tx, { userIds: [row.user_id] }, d.decision === 'verified'
        ? { kind: 'request_verified', title: `Your ${organ} request is verified`, body: `${req.hospital.name} set its priority to ${d.priority}. It is now in priority matching.`, link: `/requests/${row.id}` }
        : { kind: 'request_rejected', title: `Your ${organ} request could not be verified`, body: d.note, link: `/requests/${row.id}` });
      await audit(tx, req.user.id, 'request', row.id, d.decision, {
        previous: { verification: row.verification, priority: row.priority, clinical_score: row.clinical_score },
        priority: d.priority ?? null, clinical_score: d.clinical_score, note: d.note,
      });
    });
    res.json({ success: true });
  });

  // ---- Ranked donors for a request ----
  const candidateView = (c) => ({
    pledge_id: c.pledge.id,
    donor_label: `Donor #${c.pledge.id}`,
    donor_type: c.pledge.donor_type,
    organ: c.pledge.organ,
    blood_group: c.pledge.donor_blood_group,
    blood_match: c.blood,
    age: c.donorAge,
    location: c.pledge.donor_type === 'deceased' ? `${c.pledge.available_hospital_name}, ${c.pledge.available_city}` : `${c.pledge.city}, ${c.pledge.state}`,
    pledged_at: c.pledge.created_at,
    height: c.pledge.height, weight: c.pledge.weight, bmi: c.pledge.bmi, last_donation: c.pledge.last_donation,
    health: Object.fromEntries(HEALTH_FIELDS.map((key) => [key, c.pledge[key]])),
    score: c.score,
    breakdown: c.breakdown,
    flags: c.flags,
    recipient_rank: c.recipientRank,
    competing_recipients: c.competingRecipients,
    requires_override: c.recipientRank > 1,
  });
  router.get('/requests/:id/candidates', async (req, res) => {
    const row = await ownRequest(req, req.params.id);
    const { pledges, requests, ctx } = await loadMatching(db);
    const request = requests.find((r) => r.id === row.id);
    if (!request) return res.json({ candidates: [], notice: row.status !== 'open' ? 'This request is closed.' : 'Verify this request to see ranked donors.' });
    res.json({ candidates: rankDonors(request, pledges, requests, ctx).map(candidateView) });
  });

  // ---- Matches ----
  router.post('/matches', async (req, res) => {
    const d = proposalSchema.parse(req.body);
    const row = await ownRequest(req, d.request_id);
    const { pledges, requests, ctx } = await loadMatching(db);
    const request = requests.find((r) => r.id === row.id);
    const pledge = pledges.find((p) => p.id === d.pledge_id);
    if (!request) throw new HttpError(409, 'Only open, verified requests can be matched.');
    if (!pledge) throw new HttpError(409, 'This donor is not available for matching.');
    const result = evaluate(pledge, request, ctx);
    if (!result.eligible) throw new HttpError(409, `This pairing is not allowed: ${result.exclusions.join('; ')}.`);
    const ranking = rankRecipients(pledge, requests, ctx);
    const rank = ranking.findIndex((item) => item.request.id === request.id) + 1;
    // Fairness rule: skipping a higher-priority recipient must be justified on the record.
    if (rank > 1 && d.override_reason.length < 20) {
      throw new HttpError(400, `A higher-priority recipient exists for this donor (this request ranks #${rank} of ${ranking.length}). Give an override reason of at least 20 characters.`);
    }
    const overrideReason = rank > 1 ? d.override_reason : '';
    // An after-death donor cannot respond; consent was documented when the hospital reported them available.
    const deceased = pledge.donor_type === 'deceased';
    const donorResponse = deceased ? 'accepted' : 'pending';
    try {
      const match = await db.transaction(async (tx) => {
        const donor = await tx.prepare('SELECT donor_status FROM users WHERE id=? FOR UPDATE').get(pledge.user_id);
        const currentPledge = await tx.prepare('SELECT status FROM pledges WHERE id=? FOR UPDATE').get(pledge.id);
        if (currentPledge.status !== 'active' || (!deceased && donor.donor_status === 'deceased')) throw new HttpError(409, 'The donor is no longer available for this match. Refresh the ranking.');
        const created = await tx.prepare('INSERT INTO matches(request_id,pledge_id,hospital_id,proposed_by,score,recipient_rank,breakdown,flags,override_reason,donor_response) VALUES(?,?,?,?,?,?,?::jsonb,?::jsonb,?,?) RETURNING id, donor_response')
          .get(request.id, pledge.id, req.hospital.id, req.user.id, result.score, rank, JSON.stringify(result.breakdown), JSON.stringify(result.flags), overrideReason, donorResponse);
        await audit(tx, req.user.id, 'match', created.id, 'proposed', { request_id: request.id, pledge_id: pledge.id, score: result.score, rank, competing_recipients: ranking.length, override_reason: overrideReason });
        const organ = request.organ.toLowerCase();
        if (!deceased) await notify(tx, { userIds: [pledge.user_id] }, { kind: 'match_proposed', title: `You have been proposed as a ${organ} donor`, body: `${req.hospital.name} proposed a match. Review it on your dashboard.`, link: '/dashboard' });
        await notify(tx, { userIds: [request.user_id] }, { kind: 'donor_proposed', title: `A donor has been proposed for your ${organ} request`, body: `${req.hospital.name} is coordinating the next steps.`, link: `/requests/${request.id}` });
        return created;
      });
      res.status(201).json({ id: match.id, status: 'proposed', donor_response: match.donor_response, score: result.score, recipient_rank: rank });
    } catch (error) {
      if (error.code === '23505') throw new HttpError(409, 'This donor already has an active match.');
      throw error;
    }
  });
  router.get('/matches', async (req, res) => {
    const rows = await db.prepare(`SELECT m.*, r.organ, r.blood_group AS recipient_blood_group, r.quantity, r.status AS request_status,
        ru.first_name AS requester_first_name, ru.last_name AS requester_last_name,
        p.donor_type, du.blood_group AS donor_blood_group, du.first_name AS donor_first_name, du.last_name AS donor_last_name, du.phone AS donor_phone, du.email AS donor_email
      FROM matches m JOIN requests r ON r.id=m.request_id JOIN users ru ON ru.id=r.user_id JOIN pledges p ON p.id=m.pledge_id JOIN users du ON du.id=p.user_id
      WHERE m.hospital_id=? ORDER BY m.id DESC`).all(req.hospital.id);
    const events = await db.prepare(`SELECT e.entity_id, e.action, e.detail, e.created_at, u.first_name, u.last_name, u.role
      FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id
      WHERE e.entity='match' AND e.entity_id IN (SELECT id FROM matches WHERE hospital_id=?) ORDER BY e.id`).all(req.hospital.id);
    // The donor's identity reaches the hospital only once they accept the proposal,
    // so the history names hospital staff but never the member who acted.
    const actor = ({ role, first_name, last_name }) => role === 'hospital' ? `${first_name} ${last_name}` : role === 'member' ? 'Donor' : role === 'admin' ? 'Administrator' : 'System';
    res.json(rows.map((m) => ({
      ...(m.donor_response === 'accepted' ? m : Object.fromEntries(Object.entries(m).filter(([key]) => !DONOR_CONTACT.includes(key)))),
      donor_label: `Donor #${m.pledge_id}`,
      events: events.filter((event) => event.entity_id === m.id).map((event) => ({ action: event.action, created_at: event.created_at, actor: actor(event) })),
    })));
  });
  router.patch('/matches/:id', async (req, res) => {
    const d = matchDecisionSchema.parse(req.body);
    const id = idOf(req.params.id);
    const match = id && await db.prepare('SELECT * FROM matches WHERE id=?').get(id);
    if (!match || match.hospital_id !== req.hospital.id) throw new HttpError(404, 'Match not found at your hospital.');
    if (match.status !== 'proposed') throw new HttpError(409, 'Only proposed matches can be updated.');
    if (d.status === 'confirmed' && match.donor_response !== 'accepted') throw new HttpError(409, 'The donor has not accepted this match yet.');
    await db.transaction(async (tx) => {
      const donor = await tx.prepare('SELECT u.donor_status, p.donor_type FROM users u JOIN pledges p ON p.user_id=u.id WHERE p.id=? FOR UPDATE OF u').get(match.pledge_id);
      if (d.status === 'confirmed' && donor.donor_type === 'living' && donor.donor_status === 'deceased') throw new HttpError(409, 'The donor is deceased; a living match cannot be confirmed.');
      const updated = await tx.prepare(`UPDATE matches SET status=?, decision_reason=?, updated_at=now() WHERE id=? AND status='proposed'${d.status === 'confirmed' ? " AND donor_response='accepted'" : ''}`).run(d.status, d.reason, match.id);
      if (!updated.changes) throw new HttpError(409, 'This match has changed. Refresh and try again.');
      let requestClosed = false;
      if (d.status === 'confirmed') {
        await tx.prepare("UPDATE pledges SET status='matched' WHERE id=?").run(match.pledge_id);
        const request = await tx.prepare("SELECT quantity, (SELECT COUNT(*)::int FROM matches WHERE request_id=? AND status='confirmed') AS confirmed FROM requests WHERE id=?").get(match.request_id, match.request_id);
        if (request.confirmed >= request.quantity) {
          requestClosed = true;
          const others = await tx.prepare("SELECT p.user_id FROM matches m JOIN pledges p ON p.id=m.pledge_id WHERE m.request_id=? AND m.status='proposed' AND p.donor_type='living'").all(match.request_id);
          await tx.prepare("UPDATE requests SET status='closed' WHERE id=?").run(match.request_id);
          await tx.prepare("UPDATE matches SET status='declined', decision_reason='Request fulfilled by another match', updated_at=now() WHERE request_id=? AND status='proposed'").run(match.request_id);
          await notify(tx, { userIds: others.map((row) => row.user_id) }, { kind: 'match_declined', title: 'A proposed match was closed', body: 'The patient’s request was fulfilled by another donor. Thank you for offering to help.', link: '/dashboard' });
        }
      }
      await audit(tx, req.user.id, 'match', match.id, d.status, { reason: d.reason, request_closed: requestClosed });
      const parties = await tx.prepare('SELECT r.user_id AS requester_id, r.organ, p.user_id AS donor_id, p.donor_type FROM matches m JOIN requests r ON r.id=m.request_id JOIN pledges p ON p.id=m.pledge_id WHERE m.id=?').get(match.id);
      const organ = parties.organ.toLowerCase();
      const confirmed = d.status === 'confirmed';
      await notify(tx, { userIds: [parties.requester_id] }, { kind: `match_${d.status}`, title: confirmed ? `A donor match is confirmed for your ${organ} request` : `A proposed ${organ} match did not go ahead`, body: confirmed ? `${req.hospital.name} will contact you about next steps.` : d.reason, link: `/requests/${match.request_id}` });
      if (parties.donor_type === 'living') {
        await notify(tx, { userIds: [parties.donor_id] }, { kind: `match_${d.status}`, title: confirmed ? `Your ${organ} donation match is confirmed` : `Your proposed ${organ} match did not go ahead`, body: confirmed ? `${req.hospital.name} will guide you through the next steps.` : d.reason, link: '/dashboard' });
      }
    });
    res.json({ success: true });
  });

  // ---- Deceased-donor registry ----
  router.get('/donors', async (req, res) => {
    const email = z.email('Enter the donor’s email address.').parse(String(req.query.email || '').trim().toLowerCase());
    const pledges = await db.prepare(`SELECT p.id, p.organ, p.donor_type, p.status, p.available_at, p.created_at, u.first_name, u.last_name, u.blood_group, u.dob, h.name AS available_hospital_name
      FROM pledges p JOIN users u ON u.id=p.user_id LEFT JOIN hospitals h ON h.id=p.available_hospital_id
      WHERE lower(u.email)=lower(?) AND p.donor_type='deceased' AND p.status='active' ORDER BY p.id`).all(email);
    await audit(db, req.user.id, 'hospital', req.hospital.id, 'donor_lookup', { email, results: pledges.length });
    res.json(pledges);
  });
  router.post('/pledges/:id/availability', async (req, res) => {
    const id = idOf(req.params.id);
    const pledge = id && await db.prepare('SELECT * FROM pledges WHERE id=?').get(id);
    if (!pledge || pledge.donor_type !== 'deceased' || pledge.status !== 'active') throw new HttpError(404, 'No active deceased-donor pledge with this ID.');
    if (pledge.available_at) throw new HttpError(409, 'This pledge has already been reported available.');
    await db.transaction(async (tx) => {
      await reportDeceased(tx, pledge.user_id, req.user.id);
      const updated = await tx.prepare("UPDATE pledges SET available_hospital_id=?, available_at=now() WHERE id=? AND available_at IS NULL AND status='active'").run(req.hospital.id, pledge.id);
      if (!updated.changes) throw new HttpError(409, 'This pledge has already been reported available.');
      await audit(tx, req.user.id, 'pledge', pledge.id, 'reported_available', { hospital_id: req.hospital.id, organ: pledge.organ });
    });
    res.json({ success: true });
  });
  // ---- Report a death: find a donor by email, record the death, and donate the chosen pledged organs ----
  async function deathRecord(q, email) {
    const donor = await q.prepare("SELECT id, first_name, last_name, email, blood_group, dob, donor_status FROM users WHERE lower(email)=lower(?) AND role<>'hospital'").get(email);
    if (!donor) return null;
    // Active and matched pledges, plus living pledges that were closed only because the donor died.
    const pledges = await q.prepare(`SELECT p.id, p.organ, p.donor_type, p.status, p.available_at, h.name AS available_hospital_name
      FROM pledges p LEFT JOIN hospitals h ON h.id=p.available_hospital_id
      WHERE p.user_id=? AND (p.status IN ('active','matched') OR (p.status='withdrawn' AND p.donor_type='living'
        AND (SELECT e.detail->>'reason' FROM audit_events e WHERE e.entity='pledge' AND e.entity_id=p.id ORDER BY e.id DESC LIMIT 1) = ?))
      ORDER BY p.organ, p.id`).all(donor.id, DECEASED_REASON);
    // One choice per organ: an after-death pledge wins over a living one for the same organ.
    const byOrgan = new Map();
    for (const p of pledges) {
      const current = byOrgan.get(p.organ);
      if (!current || current.donor_type === p.donor_type || (current.donor_type === 'living' && p.donor_type === 'deceased')) byOrgan.set(p.organ, p);
    }
    const organs = [...byOrgan.values()].map((p) => ({ organ: p.organ, pledge_id: p.id, donor_type: p.donor_type, state: p.status === 'matched' ? 'matched' : p.available_at ? 'available' : 'ready', available_hospital_name: p.available_hospital_name }));
    return { donor, organs };
  }
  router.get('/deceased', async (req, res) => {
    const email = z.email('Enter the donor’s email address.').parse(String(req.query.email || '').trim().toLowerCase());
    const record = await deathRecord(db, email);
    await audit(db, req.user.id, 'hospital', req.hospital.id, 'donor_lookup', { email, results: record ? record.organs.length : 0 });
    if (!record) throw new HttpError(404, 'No registered donor has this email.');
    const { id, ...donor } = record.donor;
    res.json({ donor, organs: record.organs });
  });
  const deathReportSchema = z.object({
    email: z.email('Enter the donor’s email address.').transform((v) => v.toLowerCase()),
    pledge_ids: z.array(z.number().int().positive()).min(1, 'Choose at least one pledged organ to donate.').max(20),
    death_certified: z.literal(true, { message: 'Confirm that death has been certified.' }),
    consent_documented: z.literal(true, { message: 'Confirm that consent for donation is documented.' }),
  }).strict();
  router.post('/deceased', async (req, res) => {
    const d = deathReportSchema.parse(req.body);
    try {
      const donated = await db.transaction(async (tx) => {
        const locked = await tx.prepare("SELECT id FROM users WHERE lower(email)=lower(?) AND role<>'hospital' FOR UPDATE").get(d.email);
        if (!locked) throw new HttpError(404, 'No registered donor has this email.');
        const { donor, organs } = await deathRecord(tx, d.email);
        const chosen = organs.filter((o) => d.pledge_ids.includes(o.pledge_id));
        if (chosen.length !== new Set(d.pledge_ids).size || chosen.some((o) => o.state !== 'ready')) throw new HttpError(409, 'Some selected organs can no longer be donated. Search for the donor again.');
        await reportDeceased(tx, donor.id, req.user.id);
        for (const o of chosen) {
          // An organ pledged for living donation is donated after death, with consent confirmed above.
          await tx.prepare("UPDATE pledges SET donor_type='deceased', status='active', available_hospital_id=?, available_at=now() WHERE id=?").run(req.hospital.id, o.pledge_id);
          await audit(tx, req.user.id, 'pledge', o.pledge_id, 'reported_available', { hospital_id: req.hospital.id, organ: o.organ, converted_from_living: o.donor_type === 'living' });
        }
        const list = chosen.map((o) => o.organ.toLowerCase()).join(', ');
        await notify(tx, { userIds: [donor.id] }, { kind: 'donor_deceased', title: 'Donor recorded as deceased', body: `${req.hospital.name} recorded the donor’s death and made these pledged organs available for donation: ${list}.`, link: '/pledges' });
        return chosen;
      });
      res.json({ success: true, donated: donated.map((o) => o.organ) });
    } catch (error) {
      if (error.code === '23505') throw new HttpError(409, 'This donor already has an active after-death pledge for one of these organs. Search again.');
      throw error;
    }
  });
  return router;
}
