# VISTA Backend — Setup Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  React.js (Web)                  │
│               Flutter (Mobile App)               │
└───────────────────┬─────────────────────────────┘
                    │ HTTP / REST
          ┌─────────▼──────────┐
          │  Node.js API :5000 │  ← Auth, CRUD, Notifications
          │  (Express.js)      │
          └─────────┬──────────┘
                    │ Internal HTTP
          ┌─────────▼──────────┐
          │  FastAPI AI :8000  │  ← Sentiment, Predictions, Risk
          │  (Python)          │
          └─────────┬──────────┘
                    │
          ┌─────────▼──────────┐
          │  PostgreSQL        │  ← Shared database
          └────────────────────┘
```

## Quick Start

### 1. Setup PostgreSQL
```bash
createdb vista_db
psql vista_db < database/schema.sql
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your DB credentials and JWT secrets
```

### 2b. Apply migrations
There is no migration runner. Apply each file in `database/migrations/` by hand, oldest
first — each one is safe to re-run — and always before starting code that needs it:
```bash
psql vista_db -f database/migrations/<file>.sql
```
`2026_10_04_staff_invitations.sql` (renames `parent_invitations` to `account_invitations`,
adds `users.last_login_at`) must be applied before running the staff-invitation code;
until it is, every sign-in fails with `column "last_login_at" of relation "users" does not exist`.

Two migrations belong to the curriculum changes. Apply them in this order:
- `2026_10_05_curriculum_names_case_insensitive.sql` makes subject and section names unique
  per grade level and school year **ignoring case and spacing**, so "mapeH" cannot be added
  beside "MAPEH". It stops and lists the names if duplicates already exist. Delete or rename
  one of each, then re-run it.
- `2026_10_06_purge_soft_deleted_curriculum.sql` removes subjects and sections that were
  soft-deleted before deletes became real deletes. It keeps any that still carry recorded work.

### 3. Start Node.js API
```bash
cd node-api
npm install
npm run dev
# → Running on http://localhost:5000
```

### 4. Start FastAPI AI Service
```bash
cd fastapi-ai
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# → Running on http://localhost:8000
# → Docs at http://localhost:8000/docs
```

---

## API Reference

### Auth Endpoints (Node.js)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/auth/register | Bootstrap an account with a password (scripts only — staff are invited through `/api/accounts`) | Super Admin |
| POST | /api/auth/login | Login | None |
| POST | /api/auth/refresh | Refresh token | None |
| GET | /api/auth/me | Get current user | Bearer |
| POST | /api/auth/activation/request | Ask for an activation code (parents and staff alike) | None |
| POST | /api/auth/activation/verify | Verify the code → activation token | None |
| POST | /api/auth/activation/complete | Set password, activate, sign in | None |
| POST | /api/auth/password-reset/request | Ask for a reset code | None |
| POST | /api/auth/password-reset/verify | Verify the code → reset token | None |
| POST | /api/auth/password-reset/complete | Set a new password (no sign-in) | None |

**Every account is an invitation.** An admin authorizes an email address and never
sets, sees or can recover the password: parents through
`POST /api/students/:id/guardians/:guardianId/invitation` or `POST /api/students/parents`,
teachers and admins through `POST /api/accounts/teachers` and `POST /api/accounts/admins`.
Creating one sends nothing; the holder asks for a code — a parent in the VISTA Parent app,
staff from "Activate your account" on the dashboard's sign-in page — and chooses their own
password.

`register` was unauthenticated and took `role` from the request body, so anyone
who could reach the API could mint a `super_admin`. It is now super-admin only, has
no `parent` role, and is kept for bootstrapping and scripts — the one path that
still takes a password.

**Every chosen password must be strong**: 8–72 characters with an uppercase letter, a
lowercase letter, a number and a symbol. `activation/complete`, `password-reset/complete`,
`PATCH /api/profile/me/password` and `register` all validate through
`strongPassword(Joi)` in `src/utils/passwordPolicy.js` and answer 422 naming what is
missing. The 72 is bcrypt's byte limit — anything longer would be silently truncated.
Signing in is not affected, so an older, weaker password keeps working until it is next
changed. A Profile change also refuses the current password as the new one.

The six unauthenticated activation and reset routes answer **identically whether
or not the email has an account** — same message, same status, same timing — so
they cannot be used to discover which addresses are registered. They are rate
limited per IP and per email in every environment. See "Parent portal accounts
are invitations" and "Staff accounts are invitations too" in the root `CLAUDE.md`
before changing any of them.

### Account Endpoints
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/accounts/teachers | Teachers with assignments, advisory and account access state | Admin |
| POST | /api/accounts/teachers | Invite a teacher (no password; a `password` field is refused) | Admin |
| PUT | /api/accounts/teachers/:id | Edit details and assignments; email only until they activate | Admin |
| POST / DELETE | /api/accounts/teachers/:id/invitation | Reissue (30 days) / cancel an unused invitation | Admin |
| DELETE | /api/accounts/teachers/:id | Deactivate (closes any open invitation) | Admin |
| GET | /api/accounts/admins | Admin accounts with access state | Super Admin |
| POST | /api/accounts/admins | Invite an ECE, Elementary or Super Admin — Super Admin needs `confirm_password` (your own) | Super Admin |
| PUT | /api/accounts/admins/:id | Edit; role moves only between ECE and Elementary | Super Admin |
| POST / DELETE | /api/accounts/admins/:id/invitation | Reissue / cancel an unused invitation | Super Admin |
| DELETE | /api/accounts/admins/:id | Deactivate — never yourself, never the last active Super Admin | Super Admin |
| GET / POST | /api/students/parents | Parent accounts with their children / invite a parent with at least one child | Admin |

### Student Endpoints
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/students | List students | All |
| GET | /api/students/:id | Get student detail | All |
| POST | /api/students | Create student | Admin/Teacher |
| PUT | /api/students/:id | Update student | Admin/Teacher |
| DELETE | /api/students/:id | Deactivate student | Admin |

### Attendance Endpoints
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/attendance?student_id= | Get attendance records | All |
| POST | /api/attendance | Log attendance (batch) | Admin/Teacher |

### Grade Endpoints
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/grades?student_id= | Get grades | All |
| POST | /api/grades | Submit grades (batch) | Admin/Teacher |

### Behavior Endpoints
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/behavior | Get behavior logs (teachers/parents pass `student_id`; admins may filter by grade level, section, category, sentiment, date range, `school_year_id`) | All |
| GET | /api/behavior/summary | Positive / neutral / negative counts for the same filters | Admin |
| GET | /api/behavior/class-roster?grade_level=&section= | Class roster with each learner's observation counts | Teacher |
| POST | /api/behavior | Log observation (auto-sentiment) | Teacher |
| PUT | /api/behavior/:id | Edit own observation | Teacher |
| DELETE | /api/behavior/:id | Delete own observation | Teacher |

### Curriculum Endpoints (subjects and sections)

Names are unique per grade level and school year **ignoring case and spacing**. A clash is
a 409 that names the existing subject or section. A delete **removes the row**. It is refused
(409, with counts) while anything recorded depends on the row. For a subject that means
grades, attendance, competency ratings or score items. For a section it means learners,
enrolment records, teacher assignments or score items. A subject's grading structure and
competency skills are deleted with it. A MAPEH's four areas go with it too.

An **archived** school year's curriculum is read-only. Every write below, plus grading
structure and assessment config, is refused for a scoped admin (403) and for a super admin
who did not pass `?allow_archived=true` (409). The Curriculum page sends that only after a
super admin presses "Edit historical records".

| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/curriculum/subjects/grouped?sy_id= | Subjects per grade level, MAPEH with its areas | All |
| POST | /api/curriculum/subjects | Add a subject (a MAPEH gets its four areas automatically) | Admin |
| PUT | /api/curriculum/subjects/:id | Rename (or move grade level) | Admin |
| GET | /api/curriculum/subjects/:id/usage | What a delete would be refused for, or take with it | Admin |
| DELETE | /api/curriculum/subjects/:id | Delete a subject with its setup | Admin |
| GET | /api/curriculum/sections/grouped?sy_id= | Sections per grade level, with advisers | All |
| POST | /api/curriculum/sections | Add a section | Admin |
| PUT | /api/curriculum/sections/:id | Rename (carried to every table holding the name) | Admin |
| GET | /api/curriculum/sections/:id/usage | What a delete would be refused for | Admin |
| DELETE | /api/curriculum/sections/:id | Delete a section | Admin |

### Public content Endpoints

What the school's landing page shows, managed from the dashboard. Publishing to the website
is **`super_admin` only** — the website speaks for the whole school, so one office owns it.

| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET/POST/PUT/DELETE | /api/announcements | Notices in VISTA (`in_vista`, to staff and/or parents) and/or on the website (`is_public`) — at least one | Read: all (website-only posts: super admin, plus live ones for scoped admins); write: admin (`is_public`: super admin) |
| GET/POST/PUT/DELETE | /api/facilities | The facility gallery and its photos | Super admin |

### Public Endpoints (NO AUTH)

The **only** unauthenticated reads in the API. Kept deliberately narrow: GET only, every
column listed by name, only rows an admin explicitly made public, `publicReadPerIp`
(300 / 15 min) in every environment, and `Cache-Control: public, max-age=60`. The landing
page's origin must appear in `ALLOWED_ORIGINS`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/public/announcements?limit=&offset= | Public, live, non-expired posts (≤50 per page), pinned first, as `{ announcements, total }` — `total` drives the website's "Load more". Never returns `posted_by`. |
| GET | /api/public/facilities | Active facilities with at least one photo, photos in order |

### AI Endpoints (via Node.js proxy → FastAPI)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/ai/predict-performance | Academic grade prediction |
| POST | /api/ai/risk-assessment | Student risk classification |
| POST | /api/ai/sentiment | Behavior text analysis |
| GET | /api/ai/dashboard-summary | Full admin dashboard data |

---

## Project Structure

```
vista-backend/
├── database/
│   └── schema.sql              ← PostgreSQL schema
├── node-api/
│   ├── package.json
│   └── src/
│       ├── server.js           ← Entry point
│       ├── config/
│       │   └── database.js     ← PG connection pool
│       ├── middleware/
│       │   ├── auth.middleware.js
│       │   └── error.middleware.js
│       └── routes/
│           ├── auth.routes.js
│           ├── student.routes.js
│           ├── crud.routes.js  ← Attendance, Grades, Behavior
│           └── ai.routes.js    ← Proxy to FastAPI
└── fastapi-ai/
    ├── main.py                 ← Entry point
    ├── requirements.txt
    ├── services/
    │   └── db.py               ← SQLAlchemy async session
    └── routers/
        ├── sentiment.py        ← VADER sentiment analysis
        ├── prediction.py       ← Linear Regression grade forecast
        ├── risk.py             ← Risk classification
        └── dashboard.py        ← Admin dashboard aggregation
```

---

## Next Steps
1. ✅ Backend & API — **Done**
2. ⬜ React.js Web Dashboard
3. ⬜ Flutter Mobile App
4. ⬜ Firebase Push Notifications
5. ⬜ Cloud Deployment (AWS/GCP)
