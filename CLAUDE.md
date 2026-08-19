# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. Feature-specific details live in **nested `CLAUDE.md` files** under each service — those load automatically when Claude reads files in those subtrees, so the root file stays focused on cross-cutting concerns.

- `vista-backend/node-api/CLAUDE.md` — Node API conventions (AI proxy, class-health, behavior, ECE, grading, score entry, profile, student stripping).
- `vista-backend/fastapi-ai/CLAUDE.md` — FastAPI routers, `/teacher-dashboard` internals, SQLAlchemy caveats.
- `vista-dashboard/CLAUDE.md` — Frontend layout, sidebar, responsive patterns, per-page notes, TeacherDashboard data flow.

## Project Overview

VISTA is a Student Monitoring System for elementary schools. Monorepo with three services:

- **`vista-backend/node-api/`** — Express.js REST API (port 5000)
- **`vista-backend/fastapi-ai/`** — Python FastAPI AI microservice (port 8000)
- **`vista-dashboard/`** — React + Vite frontend (port 5173, proxies `/api` → 5000)

## Development Commands

### Node.js API
```bash
cd vista-backend/node-api
npm install
npm run dev        # nodemon watch mode
npm start          # production
npm run migrate    # run DB migrations
```

### React Dashboard
```bash
cd vista-dashboard
npm install
npm run dev        # Vite dev server on :5173
npm run build      # production build
npm run preview    # preview production build
```

### FastAPI AI Service
```bash
cd vista-backend/fastapi-ai
pip install -r requirements.txt
PYTHONIOENCODING=utf-8 venv/Scripts/uvicorn main:app --reload --port 8000
```
> The venv must be at `vista-backend/fastapi-ai/venv/` — recreate it at that path with `python -m venv venv` if it lives elsewhere. Always set `PYTHONIOENCODING=utf-8` on Windows to avoid emoji encoding errors in startup logs.

## Environment Setup

Copy `vista-backend/.env.example` to `vista-backend/node-api/.env`. Required vars:
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` — PostgreSQL connection
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN` — JWT auth
- `PORT` — API port (default 5000)

## Architecture

```
React Dashboard → Node.js API (/api/*) → PostgreSQL
                                        → FastAPI (/api/ai/* proxied to :8000)
```

The frontend **never calls FastAPI directly** — all AI endpoints go through Node's `ai.routes.js` where JWT + role checks live. The FastAPI service stays role-agnostic.

## Database

PostgreSQL database `vista_db`. Schema: `vista-backend/database/vistaDB_query.sql`. Migrations: `vista-backend/database/migrations/`.

Key tables:
- `users` — admin/teacher/parent accounts. Name fields are `surname`/`first_name`/`middle_name` (no `full_name`, no `home_address` on users). `photo_path` (TEXT, relative path under `/uploads/profile/`) is the parent's avatar shown to the guard on the SecurePass scan result; uploaded via `POST /api/profile/me/photo`.
- `students` — student profiles with LRN, grade_level, section, QR code for SecurePass. `qr_generated_by` (UUID, FK `users.id`) is stamped by `POST /api/students/:id/generate-qr` so the guard scan flow can identify the parent who pressed Generate and skip the guardian picker. `qr_fetcher_type` (`'self'` | `'auth'` | NULL) + `qr_fetcher_id` bind the active QR to a chosen fetcher: `'self'` → `users.id` of the parent themself, `'auth'` → `authorized_pickup_persons.id`, NULL → legacy/admin-generated path that falls back to the full authorized list. **Expiry policy depends on `qr_fetcher_type`**: `'self'` and NULL/admin QRs use time-based expiry (20 min parents, 30 min admins) AND one-time use; `'auth'` QRs are **single-use only with no time expiry** (the authorized fetcher has no account access to refresh, so a timer would strand them at the gate). Either way, a successful `/verify` clears `qr_code`, `qr_expires_at`, `qr_fetcher_type`, and `qr_fetcher_id`.
- `parent_student` — many-to-many guardian↔student link.
- `authorized_pickup_persons` — non-account fetchers (yaya, lola, driver, relative) a parent has authorized to pick up a specific child. Unlike `parent_student` rows these have **no portal account** — they're scoped to `(parent_id, student_id)`, hold their own `surname`/`first_name`/`middle_name`/`relationship`/`photo_path`, and are managed exclusively by the owning parent through `/api/pickup-persons` from the vista_parent app. The Pickup QR tab lets the parent pick one of these as the fetcher before generating the QR; the chosen row's `id` lands in `students.qr_fetcher_id` and the `vista_guard` scan result renders the photo verbatim.
- `teacher_assignments` / `class_assignments` — teacher↔class/subject mappings, scoped to a school year; unique per `(grade_level, section, subject, school_year)`.
- `attendance` — per-student, per-subject, per-day record (Present/Absent/Late/Excused); unique on `(student_id, date, subject_id)` so each teacher records independently per subject.
- `subjects` — curriculum subjects scoped to grade level + school year.
- `grades` — per-subject, per **grading period** (`score` = initial weighted avg; `grade` = final grade; `remarks` = "Passed"/"Failed" under the DO 8 policy, or a DO 015 descriptor under the newer ones). The column is still named `quarter` but means "period index" — see the grading-policy note below.
- `grading_structure` — configurable categories + components per subject (self-ref `category_id`; NULL = category, non-NULL = component).
- `score_items` — individual assessments under a component, scoped to **subject + section + quarter**.
- `student_scores` — per-student raw scores; unique on `(score_item_id, student_id)`.
- `behavior_logs` — teacher observations + VADER `vader_compound` score.
- `risk_assessments` — AI risk tier (Stable/Moderate/High). Factor columns `attendance_factor`/`academic_factor`/`behavioral_factor`/`ece_competency_factor` are `DECIMAL(5,4)`. Three are 0–1 (normalize before insert, e.g. avg_grade 92 → 0.92); **`behavioral_factor` is the signed raw VADER compound (−1 to +1)** — column is wide enough to hold negatives and FastAPI persists it verbatim from `behavioral_score`. `ece_competency_factor` is populated for **descriptively-assessed** learners from their latest-quarter rating average, weighted per the record's own `rating_scale` (E/G/F/NA still gives E=1.0 / G=0.75 / F=0.5 / NA=0.25). FastAPI follows the data rather than a grade list — a numeric learner has no competency records, so the factor stays NULL.
- `academic_predictions` — grade forecasts with confidence scores.
- `dismissal_logs` — SecurePass QR scan/authorization records. `gate_label VARCHAR(20)` records the entrance the guard set in the `vista_guard` Settings screen (e.g. "Gate 1"); nullable for admin/teacher-side scans that don't pass through the guard app. `fetcher_type` (`'self'` | `'auth'` | NULL legacy) + `fetcher_authorized_id` (FK `authorized_pickup_persons.id`, nullable, `ON DELETE SET NULL`) capture the actual fetcher: `authorized_by` always remains the responsible parent (FK `users.id`) so the existing JOIN and parent notifications keep working — the fetcher columns are an audit overlay, not a replacement.
- `school_years` — SY management via `is_active` (one) + `is_upcoming` (many). No `is_current` column. `period_model` (`'4Q'` | `'3T'`) and `grading_policy` (`'DO8_2015'` | `'DO15_2026'` | `'ZERO_BASED'`) declare **how that year is graded** — see "Grading periods & transmutation" below.
- `sections` — class sections per grade level + school year.
- `competency_domains` / `competency_skills` / `ece_competency_records` — competency tracker for **descriptively-assessed** grade levels. `rating_scale` (`'EGFNA'` | `'CODVBG'` | `'ABCDE'`) is stamped on every record and a pairwise CHECK ties it to the legal codes for that scale. Unique on `(student_id, skill_id, school_year_id, quarter)`.
- `grade_level_assessment` — per `(school_year_id, grade_level)`: `assessment_mode` (`'numeric'` | `'descriptive'`) + `rating_scale` (required for descriptive, NULL for numeric). Zero rows = built-in defaults, so it is additive. See "Assessment mode" below.

Supported grade levels: **Kinder, Grades 1–6**. Pre-Nursery, Nursery and Pre-Kinder
were retired in Aug 2026 — they sit outside DepEd's K-12 scope entirely and are no
longer offered. `2026_08_20_remove_pre_kinder_levels.sql` cleared their curriculum rows;
nothing in the codebase should reintroduce them.

## Cross-cutting Conventions

- **Name fields** are always `surname` / `first_name` / `middle_name`. Never a single `full_name`.
- **Frontend never calls FastAPI directly** — all AI traffic goes through the Node proxy in `ai.routes.js`.
- **JWT auth** on all protected routes (access + refresh tokens). The Node API validates tokens before every protected handler.
- **School year invariants** (enforced in DB transactions): exactly one row may be `is_active`; zero or more may be `is_upcoming`; all others are archived. Past years (end year ≤ current year) cannot be set to upcoming. The `resolveSYId` helper falls back to the active SY when no `sy_id` is provided. Teacher assignments and grading structures are copied when creating a new SY with "copy from".

## Grading periods & transmutation

DepEd replaced the four-quarter calendar with **three terms** (DO 009, s. 2026) and
changed the transmutation table (DO 015, s. 2026) — and the new table is transitional,
because SY 2027-2028 drops transmutation entirely for zero-based grading. The school
therefore runs three different grading models in three consecutive years, so **neither
the period count nor the transmutation table may be hardcoded**.

Both are columns on `school_years`, and every computation resolves them through
`resolveGradingPolicy(schoolYearRow, gradeLevel)` — canonical in
`vista-backend/node-api/src/utils/grading.js`, mirrored in
`vista-dashboard/src/utils/grading.js` (same convention as `utils/roles.js`).
Defaults are `4Q`/`DO8_2015`, so archived years keep reproducing the exact grades
that were issued to parents — **no historical data is re-transmuted**.

The `quarter` columns on `grades`, `score_items` and `ece_competency_records` keep
their name and their `CHECK (quarter BETWEEN 1 AND 4)` constraints: three terms use
periods 1-3, a strict subset, so the constraints already admit the new model. The
per-year bound is enforced in the application layer instead.

## Assessment mode & rating scales

DO 015 also moves KS1 **off numeric grading entirely**, one grade level per year
(Grade 1 in SY 2026-2027, Grade 2 in 2027-2028, Grade 3 in 2028-2029; Kindergarten
descriptive throughout). VISTA models this as configuration, not a schedule in code —
NRYS is private, so DO 015 only "encourages" adoption and the school sets its own pace.

`grade_level_assessment` holds one row per (school year, grade level):

| `assessment_mode` | Data lands in | Surface |
|---|---|---|
| `numeric` | `grades` (weighted average + transmutation) | Score Entry |
| `descriptive` | `ece_competency_records` (rated on `rating_scale`) | ECE Competency |

Three rating scales, all resolved through `resolveAssessment(gradeLevel, configRow)`:

| id | Levels (best first) | Source |
|---|---|---|
| `EGFNA` | E / G / F / NA | VISTA's existing early-childhood scale |
| `CODVBG` | CO / DV / BG | DO 015 Table 7 (Kindergarten) |
| `ABCDE` | A / B / C / D / E | DO 015 Table 8 (Grades 1-3) |

**With no configuration rows the behaviour is exactly what it was before**:
Kinder descriptive on E/G/F/NA, Grades 1-6 numeric.

Two things that are easy to get wrong:

1. **`roles.ECE_GRADES` is NOT the descriptive-grade list.** That constant answers
   "which grade levels may an `admin_ece` manage" — an org-chart question DO 015 does
   not change. Assessment mode is a separate, configurable curriculum question. Grade 1
   can be descriptive while remaining `admin_elem`'s responsibility. Never reuse one
   for the other; `utils/assessmentConfig.js` is the source for the second.
   **Since the Pre-Nursery/Nursery/Pre-Kinder removal both lists happen to read
   `['Kinder']`** — identical contents, still different questions. Do not merge them
   on the strength of that coincidence: the first grade level configured descriptive
   under DO 015 is Grade 1, which `admin_ece` must not gain access to.
2. **`'E'` means Excellent on EGFNA but Emerging (the *worst* level) on ABCDE.** That is
   why `ece_competency_records.rating_scale` exists: records are self-describing, so
   re-configuring a grade level cannot silently reinterpret history and turn top marks
   into failing ones. Changing a scale with existing ratings is **blocked** (409) rather
   than reinterpreted. Anything reading ratings must read the row's scale, never assume.

Scale-derived behaviour lives in `utils/grading.js` so adding a scale needs no
downstream changes: level `weight` is `(levels - index) / levels` (which reproduces
E=1.0 / G=0.75 / F=0.5 / NA=0.25 exactly, so AI risk scores did not move), and
`bandDistribution()` bands by **rank** — the old rules keyed on "NA" and "F" simply mean
the worst and second-worst level.

**Known gap:** the numeric paths (Score Entry, `POST /api/scores`) do not yet refuse a
grade level configured as descriptive. Add that guard before configuring one in production.

Still not implemented from DO 015: the new component weights (WW/PT/**Examinations**
20/50/30), the per-learning-area descriptive grade on the report card (SF9 Learner's
Progress Report), and the PACE form.

## Role-Based Access (summary)

Detailed per-feature role behavior lives in the backend/frontend nested `CLAUDE.md` files.

Roles stored in `users.role` (enum constraint: `super_admin`, `admin_ece`, `admin_elem`, `teacher`, `parent`). Grade scope is derived from role via `utils/roles.js` on both backend and frontend (`gradeScopeForRole`, `isAnyAdmin`, `isSuperAdmin`, `isScopedAdmin`, `canManageGrade`). No `grade_scope` column on `users` — the JWT carries only the role, and the auth payload (`/login`, `/me`) exposes a computed `grade_scope` array for convenience.

- **super_admin** — school-wide. Full access except Attendance and Score Entry (teacher-only). Manages other admins, school years, all curriculum, all students. ECE Competency is read-only. Only role that can hit `/api/accounts/admins` CRUD and `POST/PUT/DELETE /api/curriculum/school-years`.
- **admin_ece** — scoped to Kinder (the only remaining early-childhood level). Can manage teachers, students, subjects, sections, and grading structure for Kinder. Cannot manage school years, cannot manage other admins. Can open ECE Competency (read-only). Elementary routes and data are invisible. Grade routes (`/api/grades/*`, Grades page) are rejected — ECE grade levels track learning via the ECE Competency tool, not the grades table.
- **admin_elem** — scoped to Grade 1 – Grade 6. Mirror of `admin_ece` for elementary. ECE routes (`/api/ece/*`, `/api/ai/ece-class-health`, ECE Competency page) are rejected.
- **teacher** — scoped to `activeAssignments` (from `/api/auth/me`, filtered to the active SY). Teacher-facing pages (Students, Attendance, Score Entry, Behavior, ECE Competency) use a "Class" dropdown filtered to assigned sections. Risk Overview, the "In Your Class" card on Student Detail, and TeacherDashboard all draw teacher-scoped numbers from `/api/ai/class-health/all` — a single source of truth for teacher-scoped band numbers.
- **parent** — limited access; students endpoint filters to linked students via `parent_student`.

**Scoped-admin enforcement**: every GET that returns students or student-derived rows filters by `gradeScopeForRole(req.user.role)`. Mutations on grade-scoped rows (students, subjects, sections, grading, guardians, QR, behavior-admin queries) call `enforceGradeScope(req, grade_level)` which throws 403 out-of-scope. Account CRUD: scoped admins see only teachers whose active-SY assignments fall within their scope (or no active-SY assignments yet); historical out-of-scope assignments are preserved on edit/delete.
