import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Append-only: never edit a migration that has shipped; add a new one instead.
const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        first_name TEXT NOT NULL, last_name TEXT NOT NULL, dob TEXT NOT NULL,
        blood_group TEXT NOT NULL, gender TEXT NOT NULL, email TEXT NOT NULL,
        password_hash TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, zip TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organ TEXT NOT NULL, blood_group TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 7),
        urgency TEXT NOT NULL, address TEXT NOT NULL, zip TEXT NOT NULL, phone TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        height DOUBLE PRECISION NOT NULL, weight DOUBLE PRECISION NOT NULL, bmi DOUBLE PRECISION NOT NULL, last_donation TEXT,
        operation_type TEXT NOT NULL, operation_desc TEXT NOT NULL DEFAULT '',
        disease_type TEXT NOT NULL, disease_desc TEXT NOT NULL DEFAULT '',
        accident_type TEXT NOT NULL, accident_desc TEXT NOT NULL DEFAULT '',
        pregnant TEXT NOT NULL, menstruation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'declined')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS records (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organ TEXT NOT NULL, blood_group TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 7),
        donated_on TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);
      CREATE INDEX IF NOT EXISTS requests_user ON requests (user_id);
      CREATE INDEX IF NOT EXISTS applications_request ON applications (request_id);
      CREATE INDEX IF NOT EXISTS records_user ON records (user_id);
    `,
  },
  {
    version: 2,
    // Hospitals, donor pledges, priority matching and an audit trail. Direct
    // "apply to a request" applications are replaced by pledges + matches.
    sql: `
      CREATE TABLE hospitals (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name TEXT NOT NULL, registration_number TEXT NOT NULL,
        city TEXT NOT NULL, state TEXT NOT NULL, pincode TEXT NOT NULL,
        phone TEXT NOT NULL, email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'suspended')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX hospitals_registration_key ON hospitals (lower(registration_number));

      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('member', 'hospital', 'admin'));
      ALTER TABLE users ADD COLUMN hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE;
      ALTER TABLE users ALTER COLUMN dob DROP NOT NULL, ALTER COLUMN blood_group DROP NOT NULL, ALTER COLUMN gender DROP NOT NULL;
      ALTER TABLE users ADD CONSTRAINT users_profile_check CHECK (
        (role = 'hospital' AND hospital_id IS NOT NULL)
        OR (role <> 'hospital' AND hospital_id IS NULL AND dob IS NOT NULL AND blood_group IS NOT NULL AND gender IS NOT NULL)
      );

      ALTER TABLE requests
        ADD COLUMN patient_dob TEXT,
        ADD COLUMN hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
        ADD COLUMN verification TEXT NOT NULL DEFAULT 'pending' CHECK (verification IN ('pending', 'verified', 'rejected')),
        ADD COLUMN priority TEXT CHECK (priority IN ('critical', 'urgent', 'stable')),
        ADD COLUMN clinical_score INTEGER NOT NULL DEFAULT 0 CHECK (clinical_score BETWEEN 0 AND 40),
        ADD COLUMN hospital_note TEXT NOT NULL DEFAULT '',
        ADD COLUMN verified_at TIMESTAMPTZ;
      CREATE INDEX requests_hospital ON requests (hospital_id);

      CREATE TABLE pledges (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organ TEXT NOT NULL,
        donor_type TEXT NOT NULL CHECK (donor_type IN ('living', 'deceased')),
        city TEXT NOT NULL, state TEXT NOT NULL,
        height DOUBLE PRECISION NOT NULL, weight DOUBLE PRECISION NOT NULL, bmi DOUBLE PRECISION NOT NULL, last_donation TEXT,
        operation_type TEXT NOT NULL, operation_desc TEXT NOT NULL DEFAULT '',
        disease_type TEXT NOT NULL, disease_desc TEXT NOT NULL DEFAULT '',
        accident_type TEXT NOT NULL, accident_desc TEXT NOT NULL DEFAULT '',
        pregnant TEXT NOT NULL, menstruation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matched', 'withdrawn')),
        available_hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
        available_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX pledges_one_active_per_organ ON pledges (user_id, organ, donor_type) WHERE status <> 'withdrawn';

      CREATE TABLE matches (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        pledge_id INTEGER NOT NULL REFERENCES pledges(id) ON DELETE CASCADE,
        hospital_id INTEGER NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
        proposed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'declined')),
        donor_response TEXT NOT NULL DEFAULT 'pending' CHECK (donor_response IN ('pending', 'accepted', 'declined')),
        score DOUBLE PRECISION NOT NULL, recipient_rank INTEGER NOT NULL,
        breakdown JSONB NOT NULL, flags JSONB NOT NULL DEFAULT '[]',
        override_reason TEXT NOT NULL DEFAULT '', decision_reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      -- A donor can be in at most one active match; this also settles concurrent proposals.
      CREATE UNIQUE INDEX matches_one_active_per_pledge ON matches (pledge_id) WHERE status IN ('proposed', 'confirmed');
      CREATE INDEX matches_request ON matches (request_id);
      CREATE INDEX matches_hospital ON matches (hospital_id);

      CREATE TABLE audit_events (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        entity TEXT NOT NULL, entity_id INTEGER NOT NULL, action TEXT NOT NULL,
        detail JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX audit_events_entity ON audit_events (entity, entity_id);

      DROP TABLE IF EXISTS applications;
    `,
  },
  {
    version: 3,
    // In-app notifications for verification and match events.
    sql: `
      CREATE TABLE notifications (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX notifications_user ON notifications (user_id, id DESC);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE users ADD COLUMN email_alerts BOOLEAN NOT NULL DEFAULT false;
      CREATE TABLE email_outbox (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        notification_id INTEGER NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        first_attempt_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        last_error TEXT,
        payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX email_outbox_pending ON email_outbox(status, next_attempt_at);
    `,
  },
];

// Runs inside one transaction, so a failed migration leaves the schema untouched.
async function migrate(exec, rows) {
  await exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied = new Set((await rows('SELECT version FROM schema_migrations', [])).map((row) => row.version));
  for (const { version, sql } of MIGRATIONS) {
    if (applied.has(version)) continue;
    await exec(sql);
    await rows('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
  }
}

// Routes write `?` placeholders; Postgres expects `$1, $2, …`.
const numbered = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

function statements(query) {
  return {
    prepare(sql) {
      const text = numbered(sql);
      return {
        get: async (...args) => (await query(text, args)).rows[0],
        all: async (...args) => (await query(text, args)).rows,
        run: async (...args) => ({ changes: (await query(text, args)).changes }),
      };
    },
  };
}

// db.transaction(async (tx) => …) commits when the callback resolves and rolls back when it throws.
// Inside the callback, use only `tx` — never the outer `db`.
function wrap(query, transaction, close) {
  return { ...statements(query), transaction: (fn) => transaction((txQuery) => fn(statements(txQuery))), close };
}

async function openPostgres(connectionString) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, Number); // BIGINT: session expiry timestamps, which fit safely in a JS number.
  const pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 5000 });
  if (process.env.VERCEL) {
    const { attachDatabasePool } = await import('@vercel/functions');
    attachDatabasePool(pool);
  }
  const toResult = (result) => ({ rows: result.rows, changes: result.rowCount });
  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(async (text, params) => toResult(await client.query(text, params)));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  await transaction(async (query) => {
    // A transaction-scoped lock stays correct behind Neon's transaction-mode pooler and
    // serializes migrations when several serverless instances cold-start at once.
    await query('SELECT pg_advisory_xact_lock(4747001)');
    await migrate((sql) => query(sql), async (text, params) => (await query(text, params)).rows);
  });
  return wrap(async (text, params) => toResult(await pool.query(text, params)), transaction, () => pool.end());
}

async function openPGlite(location) {
  const { PGlite } = await import('@electric-sql/pglite');
  let dataDir;
  if (location !== ':memory:') {
    dataDir = resolve(location);
    mkdirSync(dataDir, { recursive: true });
  }
  const db = new PGlite(dataDir);
  const toResult = (result) => ({ rows: result.rows, changes: result.affectedRows });
  await db.transaction((tx) => migrate((sql) => tx.exec(sql), async (text, params) => (await tx.query(text, params)).rows));
  return wrap(
    async (text, params) => toResult(await db.query(text, params)),
    (fn) => db.transaction((tx) => fn(async (text, params) => toResult(await tx.query(text, params)))),
    () => db.close(),
  );
}

// Production (Vercel): DATABASE_URL from the Vercel Postgres (Neon) integration.
// Local development and tests: PGlite, an embedded Postgres stored in data/pglite
// (or in memory with ':memory:'), so no database server is needed.
export async function openDatabase(target = process.env.DATABASE_URL || process.env.POSTGRES_URL) {
  if (target && /^postgres(ql)?:\/\//i.test(target)) return openPostgres(target);
  if (process.env.VERCEL) throw new Error('DATABASE_URL is not set. Connect a Postgres database to this Vercel project.');
  return openPGlite(target || process.env.PGLITE_DATA_DIR || 'data/pglite');
}
