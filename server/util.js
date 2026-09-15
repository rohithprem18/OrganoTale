export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Route ids must be positive integers; anything else is simply "not found".
export const idOf = (value) => /^\d{1,9}$/.test(String(value)) && Number(value) > 0 ? Number(value) : null;

export async function audit(db, actorId, entity, entityId, action, detail = {}) {
  await db.prepare('INSERT INTO audit_events(actor_id,entity,entity_id,action,detail) VALUES(?,?,?,?,?::jsonb)').run(actorId, entity, entityId, action, JSON.stringify(detail));
}

// In-app notification. `to` is { userIds: [...] }, { hospitalId } (all its staff), or { role }.
export async function notify(db, to, { kind, title, body = '', link = '' }) {
  const values = [kind, title, body, link];
  let recipients;
  if (to.userIds) {
    recipients = [...new Set(to.userIds.filter(Boolean))];
  } else {
    const [column, value] = to.hospitalId ? ['hospital_id', to.hospitalId] : ['role', to.role];
    recipients = (await db.prepare(`SELECT id FROM users WHERE ${column}=?`).all(value)).map((u) => u.id);
  }
  for (const userId of recipients) {
    const notification = await db.prepare('INSERT INTO notifications(user_id,kind,title,body,link) VALUES(?,?,?,?,?) RETURNING id').get(userId, ...values);
    if (['match_proposed', 'donor_proposed', 'match_confirmed'].includes(kind)) {
      await db.prepare('INSERT INTO email_outbox(notification_id,user_id) SELECT ?, id FROM users WHERE id=? AND email_alerts=true').run(notification.id, userId);
    }
  }
}

// Everything the matching engine needs, loaded once per ranking.
export async function loadMatching(db) {
  const pledges = await db.prepare(`SELECT p.*, u.dob AS donor_dob, u.blood_group AS donor_blood_group, u.donor_status,
      h.name AS available_hospital_name, h.city AS available_city, h.state AS available_state
    FROM pledges p JOIN users u ON u.id=p.user_id LEFT JOIN hospitals h ON h.id=p.available_hospital_id
    WHERE p.status='active'`).all();
  // A recipient's location is their treating hospital, where the transplant happens.
  const requests = await db.prepare(`SELECT r.*, h.name AS hospital_name, h.city AS city, h.state AS state
    FROM requests r JOIN hospitals h ON h.id=r.hospital_id
    WHERE r.status='open' AND r.verification='verified' AND h.status='verified'`).all();
  const active = await db.prepare("SELECT pledge_id FROM matches WHERE status IN ('proposed','confirmed')").all();
  const declined = await db.prepare("SELECT request_id, pledge_id FROM matches WHERE status='declined'").all();
  const priorDonors = await db.prepare("SELECT DISTINCT p.user_id FROM matches m JOIN pledges p ON p.id=m.pledge_id WHERE m.status='confirmed'").all();
  return {
    pledges,
    requests,
    ctx: {
      now: Date.now(),
      activePledgeIds: new Set(active.map((row) => row.pledge_id)),
      declinedPairs: new Set(declined.map((row) => `${row.request_id}:${row.pledge_id}`)),
      priorDonorUserIds: new Set(priorDonors.map((row) => row.user_id)),
    },
  };
}
