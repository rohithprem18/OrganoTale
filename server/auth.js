import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, value] = stored.split(':');
  const actual = await derive(password, salt, 64);
  const expected = Buffer.from(value, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function publicUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}
export const sessionCookie = 'organ_session';
export const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' };
export async function createSession(db, res, userId) {
  const token = randomBytes(32).toString('hex');
  const age = 1000 * 60 * 60 * 24 * 7;
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash(token), userId, Date.now() + age);
  res.cookie(sessionCookie, token, { ...cookieOptions, maxAge: age });
}
export function readSession(req) {
  const cookies = (req.headers.cookie || '').split(';').map((part) => part.trim());
  return cookies.find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
}
