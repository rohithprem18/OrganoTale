import express from 'express';
import { z } from 'zod';
import { hashPassword, createSession } from '../auth.js';
import { hospitalRegisterSchema, verificationSchema, proposalSchema, matchDecisionSchema } from '../validation.js';
import { HttpError, idOf, audit, loadMatching } from '../util.js';
import { evaluate, rankRecipients, rankDonors } from '../matching.js';
import { accountView } from './account.js';

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
    try {
      const match = await db.transaction(async (tx) => {
        const created = await tx.prepare('INSERT INTO matches(request_id,pledge_id,hospital_id,proposed_by,score,recipient_rank,breakdown,flags,override_reason) VALUES(?,?,?,?,?,?,?::jsonb,?::jsonb,?) RETURNING id')
          .get(request.id, pledge.id, req.hospital.id, req.user.id, result.score, rank, JSON.stringify(result.breakdown), JSON.stringify(result.flags), overrideReason);
        await audit(tx, req.user.id, 'match', created.id, 'proposed', { request_id: request.id, pledge_id: pledge.id, score: result.score, rank, competing_recipients: ranking.length, override_reason: overrideReason });
        return created;
      });
      res.status(201).json({ id: match.id, status: 'proposed', score: result.score, recipient_rank: rank });
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
      const updated = await tx.prepare(`UPDATE matches SET status=?, decision_reason=?, updated_at=now() WHERE id=? AND status='proposed'${d.status === 'confirmed' ? " AND donor_response='accepted'" : ''}`).run(d.status, d.reason, match.id);
      if (!updated.changes) throw new HttpError(409, 'This match has changed. Refresh and try again.');
      let requestClosed = false;
      if (d.status === 'confirmed') {
        await tx.prepare("UPDATE pledges SET status='matched' WHERE id=?").run(match.pledge_id);
        const request = await tx.prepare("SELECT quantity, (SELECT COUNT(*)::int FROM matches WHERE request_id=? AND status='confirmed') AS confirmed FROM requests WHERE id=?").get(match.request_id, match.request_id);
        if (request.confirmed >= request.quantity) {
          requestClosed = true;
          await tx.prepare("UPDATE requests SET status='closed' WHERE id=?").run(match.request_id);
          await tx.prepare("UPDATE matches SET status='declined', decision_reason='Request fulfilled by another match', updated_at=now() WHERE request_id=? AND status='proposed'").run(match.request_id);
        }
      }
      await audit(tx, req.user.id, 'match', match.id, d.status, { reason: d.reason, request_closed: requestClosed });
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
      const updated = await tx.prepare('UPDATE pledges SET available_hospital_id=?, available_at=now() WHERE id=? AND available_at IS NULL').run(req.hospital.id, pledge.id);
      if (!updated.changes) throw new HttpError(409, 'This pledge has already been reported available.');
      await audit(tx, req.user.id, 'pledge', pledge.id, 'reported_available', { hospital_id: req.hospital.id, organ: pledge.organ });
    });
    res.json({ success: true });
  });
  return router;
}
