// Promote an existing member account to administrator.
//   Local database:       npm run make-admin -- you@example.com
//   Production database: npm run make-admin -- you@example.com --production
// --production reads DATABASE_URL from .env.local (create it with `npx vercel env pull .env.local`).
// Access to the database credentials is what authorizes this, so it is never exposed over HTTP.
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const email = args.find((arg) => !arg.startsWith('--'));
if (!email) {
  console.error('Usage: npm run make-admin -- you@example.com [--production]');
  process.exit(1);
}
if (existsSync('.env')) process.loadEnvFile('.env');
if (args.includes('--production')) {
  if (!existsSync('.env.local')) {
    console.error('No .env.local found. Run `npx vercel env pull .env.local` first.');
    process.exit(1);
  }
  process.loadEnvFile('.env.local');
}

const { openDatabase } = await import('./db.js');
const db = await openDatabase();
try {
  const user = await db.prepare('SELECT id, email, role FROM users WHERE lower(email)=lower(?)').get(email);
  if (!user) throw new Error(`No account uses ${email}. Register it on the site first.`);
  if (user.role === 'hospital') throw new Error('Hospital staff accounts cannot be administrators. Register a separate member account.');
  if (user.role === 'admin') {
    console.log(`${user.email} is already an administrator.`);
  } else {
    await db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
    await db.prepare('INSERT INTO audit_events(actor_id,entity,entity_id,action,detail) VALUES(NULL,?,?,?,?::jsonb)').run('user', user.id, 'promoted_admin', JSON.stringify({ via: 'make-admin script' }));
    console.log(`${user.email} is now an administrator. Log out and back in to see the Admin page.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
