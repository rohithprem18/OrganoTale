// Vercel Function entry point: every /api/* request is rewritten here (see vercel.json).
// The database pool and Express app are created once per warm instance and reused.
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';

let appPromise;
function getApp() {
  appPromise ??= openDatabase().then((db) => createApp(db)).catch((error) => {
    appPromise = undefined; // Let the next request retry instead of caching the failure.
    throw error;
  });
  return appPromise;
}

export default async function handler(req, res) {
  const app = await getApp();
  app(req, res);
}
