import express from 'express';
import { z } from 'zod';
import { HttpError } from '../util.js';
import { emailConfigured } from '../email.js';

// /api/notifications — the signed-in account's in-app notifications, for every role.
export function notificationRoutes(db) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!req.user) throw new HttpError(401, 'Please log in to continue.');
    next();
  });
  router.get('/', async (req, res) => {
    const items = await db.prepare('SELECT id, kind, title, body, link, read_at, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id);
    const { n } = await db.prepare('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id=? AND read_at IS NULL').get(req.user.id);
    res.json({ items, unread: n });
  });
  router.get('/preferences', async (req, res) => {
    const user = await db.prepare('SELECT email_alerts, email FROM users WHERE id=?').get(req.user.id);
    res.json({ ...user, email_available: emailConfigured() });
  });
  router.patch('/preferences', async (req, res) => {
    const { email_alerts } = z.object({ email_alerts: z.boolean() }).strict().parse(req.body);
    await db.transaction(async (tx) => {
      await tx.prepare('UPDATE users SET email_alerts=? WHERE id=?').run(email_alerts, req.user.id);
      if (!email_alerts) await tx.prepare("UPDATE email_outbox SET status='cancelled' WHERE user_id=? AND status='pending'").run(req.user.id);
    });
    res.json({ email_alerts });
  });
  // Mark the given ids read, or everything when no ids are sent.
  router.post('/read', async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.coerce.number().int().positive()).max(100).optional() }).parse(req.body);
    if (ids?.length) {
      await db.prepare(`UPDATE notifications SET read_at=now() WHERE user_id=? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(req.user.id, ...ids);
    } else {
      await db.prepare('UPDATE notifications SET read_at=now() WHERE user_id=? AND read_at IS NULL').run(req.user.id);
    }
    res.json({ success: true });
  });
  return router;
}
