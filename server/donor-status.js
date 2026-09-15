import { audit, notify } from './util.js';

export const DECEASED_REASON = 'Donor reported deceased; living donation cannot proceed';

// Call within a transaction. All donor lifecycle writes lock the user first.
export async function reportDeceased(tx, userId, actorId) {
  const user = await tx.prepare('SELECT donor_status FROM users WHERE id=? FOR UPDATE').get(userId);
  await tx.prepare("UPDATE users SET donor_status='deceased' WHERE id=?").run(userId);
  const reason = DECEASED_REASON;
  const matches = await tx.prepare(`UPDATE matches SET status='declined', donor_response='declined', decision_reason=?, updated_at=now()
    WHERE status='proposed' AND pledge_id IN (SELECT id FROM pledges WHERE user_id=? AND donor_type='living')
    RETURNING id, hospital_id, request_id`).all(reason, userId);
  for (const match of matches) {
    await audit(tx, actorId, 'match', match.id, 'declined', { reason });
    await notify(tx, { hospitalId: match.hospital_id }, { kind: 'donor_deceased', title: `Living match #${match.id} closed`, body: reason, link: '/hospital?tab=matches' });
    const requester = await tx.prepare('SELECT user_id FROM requests WHERE id=?').get(match.request_id);
    await notify(tx, { userIds: [requester.user_id] }, { kind: 'match_declined', title: 'A proposed match cannot proceed', body: 'Your hospital can review other donors for this request.', link: `/requests/${match.request_id}` });
  }
  const withdrawn = await tx.prepare("UPDATE pledges SET status='withdrawn' WHERE user_id=? AND donor_type='living' AND status='active' RETURNING id").all(userId);
  for (const pledge of withdrawn) await audit(tx, actorId, 'pledge', pledge.id, 'withdrawn', { reason });
  if (user.donor_status !== 'deceased') await audit(tx, actorId, 'user', userId, 'donor_status_changed', { from: user.donor_status, to: 'deceased' });
}
