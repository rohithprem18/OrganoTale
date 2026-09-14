# OrganoTale 🫀

A priority-based organ donor and recipient matching platform. Donors pledge an organ once. Treating hospitals verify patients' requests and set their medical priority. OrganoTale then ranks compatible donors and recipients, and the hospital proposes a match that the donor accepts before it is confirmed. Every decision is recorded in an audit log.

Rankings are suggestions for qualified hospital staff. Crossmatching, tissue typing, and eligibility are decided by the transplant team.

## Roles

| Role | Portal | What they do |
|---|---|---|
| Member | `/dashboard` | Pledge organs (living or after death), request an organ for a patient, accept or decline proposed matches, keep donation records |
| Hospital | `/hospital` (separate accounts and API) | Verify their patients' requests, set priority and clinical score, review ranked donors, propose and confirm matches, report deceased donors available |
| Admin | `/admin` | Verify or suspend hospitals, view national recipient rankings for any pledge, oversee matches, read the audit log |

## How matching works

**Hard rules.** A donor and recipient are only paired when all of these pass:
- Same organ, and the request is open and verified by a verified hospital
- Blood group compatible (O → all, A → A/AB, B → B/AB, AB → AB; Rh ignored; eye and heart valves need no match)
- Living donors are 18 or older and pledge an organ a living person can give (kidney, or part of a liver, lung, pancreas, or intestine)
- Deceased-donor pledges count only after a hospital reports them available; heart and lungs must stay within the same state
- The donor is not already in an active match, and the pairing was not declined before

**Priority score (out of 100).**

| Factor | Points |
|---|---|
| Verified priority: critical / urgent / stable | 40 / 25 / 10 |
| Clinical score set by the hospital (0–40, e.g. MELD) | up to 15 |
| Time on the verified list | 1 per 30 days, up to 15 |
| Blood group: identical / compatible | 10 / 5 |
| Distance from donor: same city / same state / other | 10 / 6 / 2 |
| Child patient (under 18) | 5 |
| Requester is a confirmed past donor | 5 |

Ties go to whoever was verified first. If a hospital proposes a donor for a patient who is not that donor's top-ranked recipient, it must record an override reason.

**Match lifecycle.** Proposed by the hospital → donor accepts (their contact details are shared only now) → hospital confirms after medical tests, or declines with a reason. When confirmed matches reach the requested quantity, the request closes.

## API

All routes are under `/api` and use JSON with a session cookie.

| Area | Endpoints |
|---|---|
| Account | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Public | `GET /health`, `GET /hospitals` (verified hospitals) |
| Member | `GET /overview`, `GET\|POST /requests`, `GET\|PATCH\|DELETE /requests/:id`, `GET\|POST /pledges`, `PATCH /pledges/:id`, `GET /matches`, `PATCH /matches/:id/response`, `GET\|POST /records`, `DELETE /records/:id` |
| Hospital | `POST /hospital/register`, `GET /hospital/me`, `GET /hospital/requests`, `GET /hospital/requests/:id`, `PATCH /hospital/requests/:id/verification`, `GET /hospital/requests/:id/candidates`, `GET\|POST /hospital/matches`, `PATCH /hospital/matches/:id`, `GET /hospital/donors?email=`, `POST /hospital/pledges/:id/availability` |
| Admin | `GET /admin/dashboard`, `PATCH /admin/hospitals/:id`, `GET /admin/pledges/:id/recipients`, `DELETE /admin/users/:id` |

Hospital accounts cannot use member endpoints, and members cannot use hospital endpoints. A hospital only sees requests where it is the treating hospital.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router 7, Vite 8 |
| API | Express 5 as a Vercel Function, validated with Zod |
| Database | Postgres: Vercel Postgres (Neon) in production, [PGlite](https://pglite.dev) locally and in tests; versioned migrations run automatically |
| Auth | scrypt password hashing, HttpOnly SameSite=Strict session cookies, rate-limited sign-in |
| Hosting | Vercel (static frontend on the CDN plus the `/api` function) |

## Run locally

Requires Node.js 22.13 or later. No database server is needed; local data lives in `data/pglite`.

```bash
npm install
cp .env.example .env
npm run seed      # fictional demo data (stop the dev server first)
npm run dev       # web: http://127.0.0.1:5178  api: http://127.0.0.1:3008
```

Demo accounts from `npm run seed`:

| Role | Email | Password |
|---|---|---|
| Member (kidney donor) | `demo@organdonation.local` | `DemoDonor123!` |
| Hospital, Mumbai | `hospital@organdonation.local` | `DemoHospital123!` |
| Hospital, awaiting verification | `pending.hospital@example.test` | `DemoHospital123!` |
| Admin | `admin@organdonation.local` | `DemoAdmin123!` |

## App workspace and alerts

Signed-in members have separate **My pledges**, **My requests**, **Matches**, and **Records** views. Hospital staff use the request split view and matches board. Admin charts include pending hospitals by state. Public pages retain the marketing layout.

**Settings** saves the language, reduced-motion preference, and opt-in email alerts. Hindi, Tamil, and Telugu cover navigation, statuses, form labels, and preferences; some longer guidance remains in English. Pledge and request drafts are saved on the device, including when navigating away, and cleared on logout. Consent is never restored from a draft.

PIN lookup uses the [PostalPinCode directory](https://www.postalpincode.in/Api-Details) through the API, with a timeout, limited cache, and manual entry fallback. It suggests the postal district as the city; users should check and correct that suggestion. PIN codes spanning multiple districts offer a choice. No clinical information is sent to the lookup service.

### Enable email alerts

1. Set `RESEND_API_KEY`, `ALERT_EMAIL_FROM` (on a verified sending domain), and `APP_URL` (the HTTPS site URL). See `.env.example` and [Resend's email API](https://resend.com/docs/api-reference/emails/send-email).
2. Members enable **Settings → Email alerts**. Alerts are queued when a donor is proposed or a match is confirmed; emails contain a sign-in link without names or clinical information. Existing events are not backfilled.
3. `npm start` and the local dev server process the queue every minute. Vercel processes a small batch after successful writes. For dependable retries when the site is idle, configure a scheduler to call `GET /api/jobs/email` every minute with `Authorization: Bearer <CRON_SECRET>`. Configure `CRON_SECRET` on the server too; the job endpoint rejects unauthenticated calls.

The outbox is committed with match notifications, uses a claim lease for concurrent workers, and retries failed sends up to five times with the [same Resend idempotency key](https://resend.com/docs/dashboard/emails/idempotency-keys). Uncertain deliveries stop retrying after 23 hours. `email_outbox.status`, `attempts`, and `last_error` expose delivery failures for operations; `sent` means provider acceptance, not proof of inbox delivery. Turning alerts off cancels queued jobs, though an email already in flight may still arrive. Automated tests use a fake provider and never send emails.

Email is the implemented external channel; SMS and WhatsApp are not configured.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | API and Vite dev server with hot reload |
| `npm test` | Matching-engine unit tests and API integration tests (in-memory Postgres) |
| `npm run check` | TypeScript check |
| `npm run build` | Production build into `dist/` |
| `npm start` | Serve the API and built frontend from one Node process |
| `npm run make-admin -- <email>` | Promote an account to administrator (add `--production` for the live database) |
| `npm run deploy` | Production deploy with the Vercel CLI |

## Deploy to Vercel

The project deploys automatically when you push to `main`. For a new setup: link the repository in Vercel, then under **Storage** create a **Postgres (Neon)** database and connect it, which adds `DATABASE_URL`. Migrations run on the first request.

The demo seed is disabled in production, so a new deployment starts empty. Nobody can create requests until a hospital is verified, and only an administrator can verify hospitals. To create the first administrator, register a member account on the site, then run:

```bash
npx vercel env pull .env.local
npm run make-admin -- you@example.com --production
```

Then the administrator verifies each hospital from **Admin → Hospitals**.

Note: the Neon integration gives the Vercel development environment the same `DATABASE_URL` as production. `vercel env pull` therefore points local tools at production data; the seed script refuses to run against it.

## Project structure

```
api/index.js              Vercel Function entry point
server/app.js             Middleware and route mounting
server/routes/account.js  Sign-up, sign-in, session
server/routes/member.js   Requests, pledges, member match responses, records
server/routes/hospital.js Hospital portal API
server/routes/admin.js    Hospital verification, oversight, audit log
server/matching.js        Matching rules and priority scoring (pure functions)
server/db.js              Migrations and connection (pg or PGlite)
server/validation.js      Zod request schemas
shared/options.js         Organs, blood groups, priorities, states
src/pages/                React pages (Workspace, Hospital, Admin, Auth, Public)
```

## Legal

Buying or selling organs is illegal under India's Transplantation of Human Organs and Tissues Act, 1994. Living donation between people who are not near relatives requires approval from an authorization committee. OrganoTale never arranges payment and does not replace these processes.

## License

See [LICENSE](LICENSE).
