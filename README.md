<div align="center">

<img src="public/favicon.svg" width="80" alt="OrganoTale logo" />

# OrganoTale

**Priority-based organ donor and recipient matching for donors, patients, and hospitals.**

[![Live demo](https://img.shields.io/badge/demo-organotale.vercel.app-000000?logo=vercel&logoColor=white)](https://organotale.vercel.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql&logoColor=white)](https://neon.tech)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.13-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-38%20passing-2ea44f?logo=checkmarx&logoColor=white)](#scripts)

[Live demo](https://organotale.vercel.app) · [Quick start](#quick-start) · [How matching works](#how-matching-works)

</div>

---

## Features

- **Pledge once** – living or after-death pledges through a guided form with draft autosave
- **Hospital verification** – treating hospitals verify each request and set its medical priority
- **Priority matching** – strict compatibility rules plus a transparent 100-point score
- **Consent first** – donors accept before their contact details are shared; hospitals confirm after medical tests
- **After-death donation** – hospitals record a death and choose which pledged organs to donate
- **Match PDF** – a structured record of every confirmed match, with each party's privacy protected
- **Alerts and audit log** – in-app notifications, optional email, and every decision on the record

## Roles

| Role | Portal | Responsibilities |
|---|---|---|
| Member | `/dashboard` | Pledge organs, request an organ for a patient, accept or decline proposed matches |
| Hospital | `/hospital` | Verify requests, set priority, review ranked donors, propose and confirm matches, report deaths |
| Admin | `/admin` | Verify or suspend hospitals, oversee pledges and matches, review the audit log |

## How matching works

**Hard rules**: a pairing is suggested only when the organ matches, blood groups are compatible, living donors are 18+ and pledge an organ a living person can give, after-death organs have been reported available by a hospital (heart and lungs within the same state), and the donor is not already in an active match.

**Priority score** (out of 100):

| Factor | Points |
|---|---|
| Verified priority: critical / urgent / stable | 40 / 25 / 10 |
| Clinical score set by the hospital (0–40) | up to 15 |
| Time on the verified list | 1 per 30 days, up to 15 |
| Blood group: identical / compatible | 10 / 5 |
| Distance: same city / same state / other | 10 / 6 / 2 |
| Child patient · requester is a past donor | 5 · 5 |

**Lifecycle**: hospital proposes → donor accepts → hospital confirms after tests. Skipping a higher-ranked recipient requires a recorded override reason.

> [!NOTE]
> Rankings are suggestions for qualified hospital staff. Crossmatching, tissue typing, and eligibility are decided by the transplant team.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · React Router 7 · Vite 8 · Phosphor Icons · jsPDF |
| API | Express 5 on Vercel Functions · Zod validation · Helmet |
| Database | PostgreSQL (Neon) in production · PGlite locally and in tests |
| Auth | scrypt password hashing · HttpOnly, SameSite=Strict session cookies |
| Hosting | Vercel |

## Quick start

Requires **Node.js 22.13+**. No database server is needed locally.

```bash
git clone https://github.com/rohithprem18/OrganoTale.git
cd OrganoTale
npm install
cp .env.example .env
npm run seed    # fictional demo data
npm run dev     # web http://127.0.0.1:5178 · api http://127.0.0.1:3008
```

**Demo accounts** (local seed only):

| Role | Email | Password |
|---|---|---|
| Member (donor) | `demo@organdonation.local` | `DemoDonor123!` |
| Member (requester) | `meera@example.test` | `DemoMember123!` |
| Hospital | `hospital@organdonation.local` | `DemoHospital123!` |
| Admin | `admin@organdonation.local` | `DemoAdmin123!` |

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Production | Postgres connection string (added by the Vercel Neon integration) |
| `RESEND_API_KEY` · `ALERT_EMAIL_FROM` · `APP_URL` | Optional | Email alerts through Resend |
| `CRON_SECRET` | Optional | Protects the email queue job at `GET /api/jobs/email` |
| `APP_ORIGIN` | Optional | Extra allowed browser origins |

See [`.env.example`](.env.example) for details.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | API and web app with hot reload |
| `npm test` | Matching, API, component, and PDF tests |
| `npm run check` | Type check |
| `npm run build` | Production build |
| `npm run make-admin -- <email>` | Promote an account to administrator (`--production` for the live database) |

## Deploy

Pushing to `main` deploys to Vercel. For a new setup, connect a **Postgres (Neon)** database in Vercel Storage; migrations run automatically. Production starts empty, so create the first administrator:

```bash
npx vercel env pull .env.local
npm run make-admin -- you@example.com --production
```

## Project structure

```text
api/            Vercel Function entry
server/         Express app, routes, matching engine, migrations
shared/         Organs, blood groups, priorities, states
src/            React app: pages, components, PDF export
```

## Legal

Buying or selling organs is illegal under India's Transplantation of Human Organs and Tissues Act, 1994. OrganoTale never arranges payment and does not replace statutory approval or allocation processes.
