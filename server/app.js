import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { ZodError } from 'zod';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readSession, tokenHash } from './auth.js';
import { HttpError } from './util.js';
import { accountRoutes } from './routes/account.js';
import { memberRoutes } from './routes/member.js';
import { hospitalRoutes } from './routes/hospital.js';
import { adminRoutes } from './routes/admin.js';

function isAllowedOrigin(req, origin) {
  const extra = (process.env.APP_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (extra.includes(origin)) return true;
  try {
    return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host);
  } catch {
    return false;
  }
}

export function createApp(db, { limitAuth = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.VERCEL) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'upgrade-insecure-requests': null } } }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if ((origin && !isAllowedOrigin(req, origin)) || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Request origin is not allowed.' });
      if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Send application/json.' });
    }
    const token = readSession(req);
    if (token) req.user = await db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(tokenHash(token), Date.now());
    next();
  });
  // In-memory limiter: on Vercel each warm instance keeps its own window.
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Try again in 15 minutes.' } });
  if (limitAuth) app.use(['/api/auth/login', '/api/auth/register', '/api/hospital/register'], authLimit);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/hospitals', async (req, res) => res.json(await db.prepare("SELECT id, name, city, state FROM hospitals WHERE status='verified' ORDER BY state, city, name").all()));
  app.use('/api/auth', accountRoutes(db));
  app.use('/api/hospital', hospitalRoutes(db));
  app.use('/api/admin', adminRoutes(db));
  app.use('/api', memberRoutes(db));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

  // Self-hosted mode (`npm start`): serve the built frontend. On Vercel the CDN serves it.
  const build = resolve('dist');
  if (existsSync(build)) {
    app.use(express.static(build));
    app.get('/{*path}', (req, res) => res.sendFile(resolve(build, 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error instanceof ZodError) return res.status(400).json({ error: error.issues.map((issue) => `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`).join(' ') });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    if (error.code === '23505') return res.status(409).json({ error: 'This entry already exists.' });
    console.error(error);
    res.status(500).json({ error: 'The server could not complete this request.' });
  });
  return app;
}
