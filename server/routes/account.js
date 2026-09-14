import express from 'express';
import { publicUser, hashPassword, verifyPassword, createSession, readSession, tokenHash, sessionCookie, cookieOptions } from '../auth.js';
import { registerSchema, loginSchema } from '../validation.js';
import { HttpError } from '../util.js';

// The signed-in account as the browser sees it; hospital staff also get their hospital.
export async function accountView(db, user) {
  if (user.role !== 'hospital') return publicUser(user);
  const hospital = await db.prepare('SELECT id, name, city, state, status FROM hospitals WHERE id=?').get(user.hospital_id);
  return { ...publicUser(user), hospital };
}

// /api/auth — member registration and login for every role.
export function accountRoutes(db) {
  const router = express.Router();
  router.get('/me', async (req, res) => res.json({ user: req.user ? await accountView(db, req.user) : null }));

  router.post('/register', async (req, res) => {
    const data = registerSchema.parse(req.body);
    if (await db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(data.email)) throw new HttpError(409, 'This email is already registered.');
    const passwordHash = await hashPassword(data.password);
    const user = await db.prepare(`INSERT INTO users(first_name,last_name,dob,blood_group,gender,email,password_hash,phone,address,zip) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING *`).get(data.first_name, data.last_name, data.dob, data.blood_group, data.gender, data.email, passwordHash, data.phone, data.address, data.zip);
    await createSession(db, res, user.id);
    res.status(201).json({ user: publicUser(user) });
  });

  // A fixed valid scrypt encoding also performs password work for unknown accounts.
  const dummyHash = '00000000000000000000000000000000:' + '00'.repeat(64);
  router.post('/login', async (req, res) => {
    const data = loginSchema.parse(req.body);
    const user = await db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(data.email);
    const matches = await verifyPassword(data.password, user?.password_hash || dummyHash);
    if (!user || !matches) throw new HttpError(401, 'Email or password is incorrect.');
    const old = readSession(req);
    if (old) await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(old));
    await createSession(db, res, user.id);
    res.json({ user: await accountView(db, user) });
  });

  router.post('/logout', async (req, res) => {
    const token = readSession(req);
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
    res.clearCookie(sessionCookie, cookieOptions).json({ success: true });
  });
  return router;
}
