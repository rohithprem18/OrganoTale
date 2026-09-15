import express from 'express';
import { HttpError, idOf } from '../util.js';
import { ageOn } from '../matching.js';

// /api/reports — the record of a confirmed match for the people involved in it:
// the donor, the recipient, staff of the treating hospital, and administrators.
export function reportRoutes(db) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!req.user) throw new HttpError(401, 'Please log in to continue.');
    next();
  });

  router.get('/matches/:id', async (req, res) => {
    const id = idOf(req.params.id);
    const m = id && await db.prepare(`SELECT m.*, r.user_id AS requester_id, r.organ, r.blood_group AS recipient_blood_group, r.quantity, r.urgency, r.priority, r.clinical_score, r.verified_at, r.patient_dob,
        ru.first_name AS requester_first_name, ru.last_name AS requester_last_name,
        p.user_id AS donor_id, p.donor_type, p.city AS donor_city, p.state AS donor_state, ah.name AS available_hospital_name, ah.city AS available_city,
        du.first_name AS donor_first_name, du.last_name AS donor_last_name, du.blood_group AS donor_blood_group, du.dob AS donor_dob, du.phone AS donor_phone, du.email AS donor_email,
        h.name AS hospital_name, h.registration_number, h.city AS hospital_city, h.state AS hospital_state, h.phone AS hospital_phone, h.email AS hospital_email
      FROM matches m JOIN requests r ON r.id=m.request_id JOIN users ru ON ru.id=r.user_id JOIN pledges p ON p.id=m.pledge_id JOIN users du ON du.id=p.user_id
        JOIN hospitals h ON h.id=m.hospital_id LEFT JOIN hospitals ah ON ah.id=p.available_hospital_id
      WHERE m.id=?`).get(id);
    const viewer = !m ? null
      : req.user.role === 'admin' ? 'admin'
        : req.user.role === 'hospital' ? (req.user.hospital_id === m.hospital_id ? 'hospital' : null)
          : m.donor_id === req.user.id ? 'donor' : m.requester_id === req.user.id ? 'recipient' : null;
    if (!viewer) throw new HttpError(404, 'Match not found.');
    if (m.status !== 'confirmed') throw new HttpError(409, 'The PDF is available once the match is confirmed.');

    const events = await db.prepare(`SELECT e.action, e.detail, e.created_at, u.first_name, u.last_name, u.role
      FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.entity='match' AND e.entity_id=? ORDER BY e.id`).all(m.id);
    // Hospital staff are named only to staff and administrators; members see the hospital.
    const staff = viewer === 'hospital' || viewer === 'admin';
    const by = (e) => e.role === 'hospital' ? (staff ? `${e.first_name} ${e.last_name}` : m.hospital_name) : e.role === 'member' ? 'Donor' : e.role === 'admin' ? 'Administrator' : 'System';
    const find = (action) => events.find((e) => e.action === action);
    const proposal = find('proposed');
    const confirmation = find('confirmed');
    const now = Date.now();
    // The donor and recipient never see each other's identity.
    const seesDonor = viewer !== 'recipient';
    const seesRecipient = viewer !== 'donor';
    res.json({
      viewer,
      match: {
        id: m.id, status: m.status, score: m.score, recipient_rank: m.recipient_rank, competing_recipients: proposal?.detail?.competing_recipients ?? null,
        breakdown: m.breakdown, override_reason: m.override_reason, decision_reason: m.decision_reason,
        proposed_at: m.created_at, accepted_at: find('donor_accepted')?.created_at ?? null, confirmed_at: confirmation?.created_at ?? m.updated_at, confirmed_by: confirmation ? by(confirmation) : m.hospital_name,
      },
      hospital: { name: m.hospital_name, registration_number: m.registration_number, city: m.hospital_city, state: m.hospital_state, phone: m.hospital_phone, email: m.hospital_email },
      recipient: {
        request_id: m.request_id, organ: m.organ, blood_group: m.recipient_blood_group, quantity: m.quantity, urgency: m.urgency, priority: m.priority, clinical_score: m.clinical_score, verified_at: m.verified_at,
        ...(seesRecipient ? { name: `${m.requester_first_name} ${m.requester_last_name}`, patient_age: ageOn(m.patient_dob, now) } : {}),
      },
      donor: {
        pledge_id: m.pledge_id, donor_type: m.donor_type, blood_group: m.donor_blood_group,
        ...(seesDonor ? {
          name: `${m.donor_first_name} ${m.donor_last_name}`, age: ageOn(m.donor_dob, now), phone: m.donor_phone, email: m.donor_email, flags: m.flags,
          location: m.donor_type === 'deceased' && m.available_hospital_name ? `${m.available_hospital_name}, ${m.available_city}` : `${m.donor_city}, ${m.donor_state}`,
        } : {}),
      },
      timeline: events.map((e) => ({ at: e.created_at, action: e.action, by: by(e) })),
    });
  });
  return router;
}
