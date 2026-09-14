import { randomUUID, timingSafeEqual } from 'node:crypto';

export function emailConfigured(env = process.env) {
  try { return Boolean(env.RESEND_API_KEY && env.ALERT_EMAIL_FROM && new URL(env.APP_URL).protocol === 'https:'); }
  catch { return false; }
}

export function validCronToken(header, secret) {
  if (!secret) return false;
  const actual = Buffer.from(header || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Claims survive serverless shutdowns. Retries reuse the exact payload and provider key.
// Messages omit names, organs and clinical details; recipients sign in to read them.
export async function deliverEmailQueue(db, { env = process.env, fetcher = fetch, batchSize = 10 } = {}) {
  if (!emailConfigured(env)) return { configured: false, sent: 0, failed: 0 };
  let sent = 0; let failed = 0;
  for (let i = 0; i < batchSize; i++) {
    const job = await db.transaction(async (tx) => {
      await tx.prepare(`UPDATE email_outbox SET status='failed', last_error='Retry window expired'
        WHERE status IN ('pending','sending') AND first_attempt_at < now() - interval '23 hours'`).run();
      const row = await tx.prepare(`SELECT o.*, u.email, u.email_alerts, n.kind FROM email_outbox o
        JOIN users u ON u.id=o.user_id JOIN notifications n ON n.id=o.notification_id
        WHERE o.status IN ('pending','sending') AND o.next_attempt_at<=now()
        ORDER BY o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`).get();
      if (!row) return null;
      if (!row.email_alerts) {
        await tx.prepare("UPDATE email_outbox SET status='cancelled' WHERE id=?").run(row.id);
        return { cancelled: true };
      }
      const payload = row.payload || {
        from: env.ALERT_EMAIL_FROM, to: [row.email],
        subject: row.kind === 'match_confirmed' ? 'Your OrganoTale match is confirmed' : 'A new match update on OrganoTale',
        text: `There is an update to your donation or request journey. Sign in to review it: ${new URL('/matches', env.APP_URL).href}\n\nManage email alerts in Settings.`,
        // Stable per queued event, including across app migrations and installations.
        key: `organotale-${randomUUID()}`,
      };
      await tx.prepare(`UPDATE email_outbox SET status='sending', attempts=attempts+1,
        first_attempt_at=COALESCE(first_attempt_at,now()), next_attempt_at=now() + interval '2 minutes', payload=?::jsonb WHERE id=?`).run(JSON.stringify(payload), row.id);
      return { ...row, payload, attempts: row.attempts + 1 };
    });
    if (!job) break;
    if (job.cancelled) continue;
    try {
      // JSONB can reorder keys. Serialize in a fixed order for identical retries.
      const { key, from, to, subject, text } = job.payload;
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ from, to, subject, text }),
      });
      if (!response.ok) throw new Error(`Email provider HTTP ${response.status}`);
      const result = await response.json();
      if (!result.id) throw new Error('Email provider did not acknowledge the message');
      await db.prepare("UPDATE email_outbox SET status='sent', sent_at=now(), last_error=NULL WHERE id=?").run(job.id);
      sent++;
    } catch (error) {
      // Do not persist provider response bodies, credentials or recipient addresses in logs.
      const reason = error.message.startsWith('Email provider') ? error.message : 'Email delivery unavailable';
      await db.prepare(`UPDATE email_outbox SET status=?, last_error=?, next_attempt_at=now() + (? * interval '1 minute') WHERE id=?`)
        .run(job.attempts >= 5 ? 'failed' : 'pending', reason, Math.min(60, 2 ** job.attempts), job.id);
      failed++;
    }
  }
  return { configured: true, sent, failed };
}
