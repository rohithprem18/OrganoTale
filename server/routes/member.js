import express from 'express';
import { requestSchema, requestUpdateSchema, recordSchema, pledgeSchema, pledgeStatusSchema, donorResponseSchema } from '../validation.js';
import { HttpError, idOf, audit } from '../util.js';

// Changing any of these after verification sends the request back to its hospital.
const CLINICAL_FIELDS = ['organ', 'blood_group', 'hospital_id', 'patient_dob'];
// Visible only to the requester and administrators.
const PRIVATE_FIELDS = ['phone', 'zip', 'patient_dob', 'hospital_note'];
const HEALTH_FIELDS = ['height', 'weight', 'operation_type', 'operation_desc', 'disease_type', 'disease_desc', 'accident_type', 'accident_desc', 'pregnant', 'menstruation'];

// /api — members (and administrators acting as members). Hospital staff use /api/hospital.
export function memberRoutes(db) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!req.user) throw new HttpError(401, 'Please log in to continue.');
    if (req.user.role === 'hospital') throw new HttpError(403, 'Hospital accounts use the hospital portal.');
    next();
  });

  const count = async (sql, ...args) => (await db.prepare(sql).get(...args)).n;
  router.get('/overview', async (req, res) => {
    const id = req.user.id;
    res.json({
      requests: await count('SELECT COUNT(*)::int AS n FROM requests WHERE user_id=?', id),
      pledges: await count("SELECT COUNT(*)::int AS n FROM pledges WHERE user_id=? AND status<>'withdrawn'", id),
      matches: await count("SELECT COUNT(*)::int AS n FROM matches m JOIN pledges p ON p.id=m.pledge_id JOIN requests r ON r.id=m.request_id WHERE (p.user_id=? OR r.user_id=?) AND m.status IN ('proposed','confirmed')", id, id),
      records: await count('SELECT COUNT(*)::int AS n FROM records WHERE user_id=?', id),
      open_requests: await count("SELECT COUNT(*)::int AS n FROM requests WHERE status='open'"),
    });
  });

  // ---- Organ requests (recipients) ----
  const requestSelect = `SELECT r.*, u.first_name, u.last_name, h.name AS hospital_name, h.city AS hospital_city, h.state AS hospital_state
    FROM requests r JOIN users u ON u.id=r.user_id LEFT JOIN hospitals h ON h.id=r.hospital_id`;
  const forViewer = (row, user) => row.user_id === user.id || user.role === 'admin' ? row : Object.fromEntries(Object.entries(row).filter(([key]) => !PRIVATE_FIELDS.includes(key)));
  const verifiedHospital = async (id) => Boolean(await db.prepare("SELECT id FROM hospitals WHERE id=? AND status='verified'").get(id));
  async function ownedRequest(req, action) {
    const id = idOf(req.params.id);
    const row = id && await db.prepare('SELECT * FROM requests WHERE id=?').get(id);
    if (!row) throw new HttpError(404, 'Request not found.');
    if (row.user_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, `You can only ${action} your own requests.`);
    return row;
  }

  router.get('/requests', async (req, res) => {
    // Directory entries expose the hospital and city supplied for the request, never account contact details.
    const rows = await db.prepare(requestSelect + ' ORDER BY r.created_at DESC, r.id DESC').all();
    const f = req.query;
    const visible = rows.filter((r) => (f.mine === 'true' ? r.user_id === req.user.id : r.status === 'open')
      && (!f.organ || r.organ === f.organ) && (!f.blood_group || r.blood_group === f.blood_group) && (!f.urgency || r.urgency === f.urgency)
      && (!f.search || `${r.organ} ${r.address} ${r.first_name} ${r.last_name} ${r.hospital_name || ''}`.toLowerCase().includes(String(f.search).toLowerCase())));
    res.json(visible.map((r) => forViewer(r, req.user)));
  });
  router.get('/requests/:id', async (req, res) => {
    const id = idOf(req.params.id);
    const row = id && await db.prepare(requestSelect + ' WHERE r.id=?').get(id);
    if (!row) throw new HttpError(404, 'Request not found.');
    res.json(forViewer(row, req.user));
  });
  router.post('/requests', async (req, res) => {
    const d = requestSchema.parse(req.body);
    if (!await verifiedHospital(d.hospital_id)) throw new HttpError(400, 'Choose a verified hospital for this request.');
    const created = await db.prepare('INSERT INTO requests(user_id,organ,blood_group,quantity,urgency,address,zip,phone,note,patient_dob,hospital_id) VALUES(?,?,?,?,?,?,?,?,?,?,?) RETURNING id').get(req.user.id, d.organ, d.blood_group, d.quantity, d.urgency, d.address, d.zip, d.phone, d.note, d.patient_dob, d.hospital_id);
    await audit(db, req.user.id, 'request', created.id, 'created', { organ: d.organ, hospital_id: d.hospital_id });
    res.status(201).json({ id: created.id });
  });
  router.patch('/requests/:id', async (req, res) => {
    const row = await ownedRequest(req, 'edit');
    const data = requestUpdateSchema.parse(req.body);
    const entries = Object.entries(data);
    if (!entries.length) throw new HttpError(400, 'No changes supplied.');
    if (data.hospital_id !== undefined && data.hospital_id !== row.hospital_id && !await verifiedHospital(data.hospital_id)) throw new HttpError(400, 'Choose a verified hospital for this request.');
    const clinicalChange = CLINICAL_FIELDS.some((key) => key in data && data[key] !== row[key]);
    const active = await count("SELECT COUNT(*)::int AS n FROM matches WHERE request_id=? AND status IN ('proposed','confirmed')", row.id);
    if (clinicalChange && active) throw new HttpError(409, 'This request has an active match. Ask the hospital to decline it before changing clinical details.');
    const resetVerification = clinicalChange && row.verification !== 'pending';
    await db.transaction(async (tx) => {
      // Column names come from the strict schema's keys, never from raw input.
      const sets = entries.map(([key]) => `${key}=?`);
      if (resetVerification) sets.push("verification='pending'", 'priority=NULL', 'clinical_score=0', 'verified_at=NULL');
      await tx.prepare(`UPDATE requests SET ${sets.join(',')} WHERE id=?`).run(...entries.map(([, value]) => value), row.id);
      if (data.status === 'closed' && row.status !== 'closed') {
        await tx.prepare("UPDATE matches SET status='declined', decision_reason='Request closed by the requester', updated_at=now() WHERE request_id=? AND status='proposed'").run(row.id);
      }
      await audit(tx, req.user.id, 'request', row.id, 'updated', { fields: Object.keys(data), verification_reset: resetVerification });
    });
    res.json({ success: true, verification_reset: resetVerification });
  });
  router.delete('/requests/:id', async (req, res) => {
    const row = await ownedRequest(req, 'delete');
    if (await db.prepare('SELECT id FROM matches WHERE request_id=? LIMIT 1').get(row.id)) throw new HttpError(409, 'This request has match history. Close it to preserve that history.');
    await db.prepare('DELETE FROM requests WHERE id=?').run(row.id);
    res.json({ success: true });
  });

  // ---- Donor pledges ----
  router.get('/pledges', async (req, res) => {
    res.json(await db.prepare('SELECT p.*, h.name AS available_hospital_name FROM pledges p LEFT JOIN hospitals h ON h.id=p.available_hospital_id WHERE p.user_id=? ORDER BY p.id DESC').all(req.user.id));
  });
  router.post('/pledges', async (req, res) => {
    const d = pledgeSchema.parse(req.body);
    const bmi = Number((d.weight / ((d.height / 100) ** 2)).toFixed(2));
    try {
      const created = await db.prepare(`INSERT INTO pledges(user_id,organ,donor_type,city,state,height,weight,bmi,last_donation,operation_type,operation_desc,disease_type,disease_desc,accident_type,accident_desc,pregnant,menstruation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).get(req.user.id, d.organ, d.donor_type, d.city, d.state, d.height, d.weight, bmi, d.last_donation || null, ...HEALTH_FIELDS.slice(2).map((key) => d[key]));
      await audit(db, req.user.id, 'pledge', created.id, 'created', { organ: d.organ, donor_type: d.donor_type });
      res.status(201).json({ id: created.id });
    } catch (error) {
      if (error.code === '23505') throw new HttpError(409, `You already have an active ${d.donor_type} pledge for ${d.organ}.`);
      throw error;
    }
  });
  router.patch('/pledges/:id', async (req, res) => {
    const { status } = pledgeStatusSchema.parse(req.body);
    const id = idOf(req.params.id);
    const row = id && await db.prepare('SELECT * FROM pledges WHERE id=?').get(id);
    if (!row) throw new HttpError(404, 'Pledge not found.');
    if (row.user_id !== req.user.id) throw new HttpError(403, 'You can only change your own pledges.');
    if (row.status === 'matched') throw new HttpError(409, 'This pledge is part of a confirmed match. Contact the hospital to make changes.');
    if (row.status === status) return res.json({ success: true });
    try {
      await db.transaction(async (tx) => {
        if (status === 'withdrawn') {
          await tx.prepare("UPDATE matches SET status='declined', donor_response='declined', decision_reason='Donor withdrew the pledge', updated_at=now() WHERE pledge_id=? AND status='proposed'").run(row.id);
        }
        await tx.prepare('UPDATE pledges SET status=? WHERE id=?').run(status, row.id);
        await audit(tx, req.user.id, 'pledge', row.id, status === 'withdrawn' ? 'withdrawn' : 'reactivated');
      });
    } catch (error) {
      if (error.code === '23505') throw new HttpError(409, `You already have an active pledge for ${row.organ}.`);
      throw error;
    }
    res.json({ success: true });
  });

  // ---- Matches, as the donor or the requester ----
  router.get('/matches', async (req, res) => {
    const rows = await db.prepare(`SELECT m.id, m.status, m.donor_response, m.decision_reason, m.created_at, m.updated_at, m.request_id, m.pledge_id,
        r.organ, r.blood_group AS recipient_blood_group, p.donor_type, (p.user_id=?) AS is_donor,
        h.name AS hospital_name, h.city AS hospital_city, h.state AS hospital_state, h.phone AS hospital_phone
      FROM matches m JOIN pledges p ON p.id=m.pledge_id JOIN requests r ON r.id=m.request_id JOIN hospitals h ON h.id=m.hospital_id
      WHERE p.user_id=? OR r.user_id=? ORDER BY m.id DESC`).all(req.user.id, req.user.id, req.user.id);
    res.json(rows);
  });
  router.patch('/matches/:id/response', async (req, res) => {
    const d = donorResponseSchema.parse(req.body);
    const id = idOf(req.params.id);
    const match = id && await db.prepare('SELECT m.*, p.user_id AS donor_id FROM matches m JOIN pledges p ON p.id=m.pledge_id WHERE m.id=?').get(id);
    if (!match) throw new HttpError(404, 'Match not found.');
    if (match.donor_id !== req.user.id) throw new HttpError(403, 'Only the donor can respond to this match.');
    if (match.status !== 'proposed' || match.donor_response !== 'pending') throw new HttpError(409, 'This match is no longer waiting for your response.');
    await db.transaction(async (tx) => {
      const updated = d.response === 'accepted'
        ? await tx.prepare("UPDATE matches SET donor_response='accepted', updated_at=now() WHERE id=? AND status='proposed' AND donor_response='pending'").run(match.id)
        : await tx.prepare("UPDATE matches SET donor_response='declined', status='declined', decision_reason=?, updated_at=now() WHERE id=? AND status='proposed' AND donor_response='pending'").run(d.reason || 'Declined by the donor', match.id);
      if (!updated.changes) throw new HttpError(409, 'This match is no longer waiting for your response.');
      await audit(tx, req.user.id, 'match', match.id, `donor_${d.response}`, { reason: d.reason });
    });
    res.json({ success: true });
  });

  // ---- Personal donation records ----
  router.get('/records', async (req, res) => res.json(await db.prepare('SELECT * FROM records WHERE user_id=? ORDER BY donated_on DESC, id DESC').all(req.user.id)));
  router.post('/records', async (req, res) => {
    const d = recordSchema.parse(req.body);
    const created = await db.prepare('INSERT INTO records(user_id,organ,blood_group,quantity,donated_on,note) VALUES(?,?,?,?,?,?) RETURNING id').get(req.user.id, d.organ, d.blood_group, d.quantity, d.donated_on, d.note);
    res.status(201).json({ id: created.id });
  });
  router.delete('/records/:id', async (req, res) => {
    const id = idOf(req.params.id);
    const row = id && await db.prepare('SELECT * FROM records WHERE id=?').get(id);
    if (!row) throw new HttpError(404, 'Record not found.');
    if (row.user_id !== req.user.id) throw new HttpError(403, 'You can only delete your own records.');
    await db.prepare('DELETE FROM records WHERE id=?').run(row.id);
    res.json({ success: true });
  });
  return router;
}
