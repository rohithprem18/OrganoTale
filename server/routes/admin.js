import express from 'express';
import { publicUser } from '../auth.js';
import { hospitalStatusSchema } from '../validation.js';
import { HttpError, idOf, audit, notify, loadMatching } from '../util.js';
import { rankRecipients, screeningFlags, ageOn } from '../matching.js';

// /api/admin — national coordination: hospital verification, oversight, and the audit trail.
export function adminRoutes(db) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!req.user) throw new HttpError(401, 'Please log in to continue.');
    if (req.user.role !== 'admin') throw new HttpError(403, 'Administrator access is required.');
    next();
  });

  router.get('/dashboard', async (req, res) => {
    const all = (sql) => db.prepare(sql).all();
    const [users, hospitals, requests, pledges, matches, records, events] = await Promise.all([
      all('SELECT u.*, h.name AS hospital_name FROM users u LEFT JOIN hospitals h ON h.id=u.hospital_id ORDER BY u.id DESC'),
      all(`SELECT h.*, (SELECT COUNT(*)::int FROM requests r WHERE r.hospital_id=h.id) AS request_count
        FROM hospitals h ORDER BY (h.status='pending') DESC, h.id DESC`),
      all('SELECT r.*, u.first_name, u.last_name, h.name AS hospital_name FROM requests r JOIN users u ON u.id=r.user_id LEFT JOIN hospitals h ON h.id=r.hospital_id ORDER BY r.id DESC'),
      all('SELECT p.*, u.first_name, u.last_name, u.blood_group, h.name AS available_hospital_name FROM pledges p JOIN users u ON u.id=p.user_id LEFT JOIN hospitals h ON h.id=p.available_hospital_id ORDER BY p.id DESC'),
      all(`SELECT m.id, m.status, m.donor_response, m.score, m.recipient_rank, m.override_reason, m.decision_reason, m.created_at, m.request_id, m.pledge_id,
          r.organ, h.name AS hospital_name, ru.first_name AS requester_first_name, ru.last_name AS requester_last_name,
          du.first_name AS donor_first_name, du.last_name AS donor_last_name
        FROM matches m JOIN requests r ON r.id=m.request_id JOIN hospitals h ON h.id=m.hospital_id JOIN users ru ON ru.id=r.user_id
          JOIN pledges p ON p.id=m.pledge_id JOIN users du ON du.id=p.user_id
        ORDER BY m.id DESC`),
      all('SELECT r.*, u.first_name, u.last_name FROM records r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC'),
      all('SELECT e.*, u.first_name, u.last_name, u.role FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id ORDER BY e.id DESC LIMIT 200'),
    ]);
    res.json({ users: users.map(publicUser), hospitals, requests, pledges, matches, records, events });
  });

  router.patch('/hospitals/:id', async (req, res) => {
    const { status } = hospitalStatusSchema.parse(req.body);
    const id = idOf(req.params.id);
    const hospital = id && await db.prepare('SELECT * FROM hospitals WHERE id=?').get(id);
    if (!hospital) throw new HttpError(404, 'Hospital not found.');
    await db.transaction(async (tx) => {
      await tx.prepare('UPDATE hospitals SET status=? WHERE id=?').run(status, hospital.id);
      await audit(tx, req.user.id, 'hospital', hospital.id, `status_${status}`, { previous: hospital.status });
      if (status !== hospital.status && status !== 'pending') {
        await notify(tx, { hospitalId: hospital.id }, status === 'verified'
          ? { kind: 'hospital_verified', title: `${hospital.name} is verified`, body: 'You can now verify patient requests and propose matches.', link: '/hospital' }
          : { kind: 'hospital_suspended', title: `${hospital.name} has been suspended`, body: 'Contact an administrator to restore access.', link: '/hospital' });
      }
    });
    res.json({ success: true });
  });

  // Figures behind the admin overview charts.
  router.get('/analytics', async (req, res) => {
    const all = (sql) => db.prepare(sql).all();
    const [requestsByOrgan, waitingByOrgan, matchesByState] = await Promise.all([
      all(`SELECT organ, COUNT(*)::int AS open, (COUNT(*) FILTER (WHERE verification='verified'))::int AS verified
        FROM requests WHERE status='open' GROUP BY organ ORDER BY open DESC, organ`),
      all(`SELECT organ, ROUND(AVG(EXTRACT(EPOCH FROM (now() - verified_at)) / 86400))::int AS days, COUNT(*)::int AS requests
        FROM requests WHERE status='open' AND verification='verified' AND verified_at IS NOT NULL GROUP BY organ ORDER BY days DESC, organ`),
      all(`SELECT h.state, (COUNT(*) FILTER (WHERE m.status='confirmed'))::int AS confirmed, (COUNT(*) FILTER (WHERE m.status='proposed'))::int AS proposed
        FROM matches m JOIN hospitals h ON h.id=m.hospital_id GROUP BY h.state ORDER BY confirmed DESC, proposed DESC, h.state`),
    ]);
    res.json({ requestsByOrgan, waitingByOrgan, matchesByState });
  });

  // Every recipient this donor could help, in priority order across all hospitals.
  router.get('/pledges/:id/recipients', async (req, res) => {
    const id = idOf(req.params.id);
    const pledgeRow = id && await db.prepare('SELECT id FROM pledges WHERE id=?').get(id);
    if (!pledgeRow) throw new HttpError(404, 'Pledge not found.');
    const { pledges, requests, ctx } = await loadMatching(db);
    const pledge = pledges.find((p) => p.id === id);
    if (!pledge) return res.json({ recipients: [], flags: [], notice: 'This pledge is withdrawn or already matched.' });
    const notice = ctx.activePledgeIds.has(pledge.id) ? 'This donor is already in an active match.'
      : pledge.donor_type === 'deceased' && !pledge.available_at ? 'Registry pledge: not yet reported available by a hospital.' : undefined;
    res.json({
      notice,
      flags: screeningFlags(pledge, ageOn(pledge.donor_dob, ctx.now), ctx.now),
      recipients: rankRecipients(pledge, requests, ctx).map((r) => ({
        rank: r.rank, request_id: r.request.id, organ: r.request.organ, blood_group: r.request.blood_group, blood_match: r.blood,
        priority: r.request.priority, clinical_score: r.request.clinical_score, verified_at: r.request.verified_at,
        hospital_name: r.request.hospital_name, city: r.request.city, state: r.request.state, patient_age: r.patientAge,
        score: r.score, breakdown: r.breakdown,
      })),
    });
  });

  router.delete('/users/:id', async (req, res) => {
    const id = idOf(req.params.id);
    const row = id && await db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!row) throw new HttpError(404, 'Member not found.');
    if (row.role === 'admin') throw new HttpError(403, 'Administrator accounts cannot be deleted here.');
    await db.prepare('DELETE FROM users WHERE id=?').run(row.id);
    await audit(db, req.user.id, 'user', row.id, 'deleted', { role: row.role, email: row.email });
    res.json({ success: true });
  });
  return router;
}
