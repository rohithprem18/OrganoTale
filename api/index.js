// Vercel Function entry point: every /api/* request is rewritten here (see vercel.json).
// The database pool and Express app are created once per warm instance and reused.
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { waitUntil } from '@vercel/functions';
import { deliverEmailQueue } from '../server/email.js';

let appPromise;
function getApp() {
  appPromise ??= openDatabase().then((db) => ({ app: createApp(db), db })).catch((error) => {
    appPromise = undefined; // Let the next request retry instead of caching the failure.
    throw error;
  });
  return appPromise;
}

export default async function handler(req, res) {
  const { app, db } = await getApp();
  if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
    // Start only after the route has committed its transaction and returned successfully.
    waitUntil(new Promise((resolve) => {
      let finished = false;
      res.once('finish', () => {
        finished = true;
        if (res.statusCode >= 400) return resolve();
        deliverEmailQueue(db, { batchSize: 4 }).catch(() => {}).finally(resolve);
      });
      res.once('close', () => { if (!finished) resolve(); });
    }));
  }
  app(req, res);
}
