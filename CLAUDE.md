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
```
> There is **no migration runner**. `package.json` still declares a `migrate`
> script, but `src/config/migrate.js` does not exist and there is no ledger table.
> Migrations are applied by hand, newest last:
> `psql vista_db -f vista-backend/database/migrations/<file>.sql`. Every file is
> written to be safe to re-run — that idempotency is what stands in for a runner.

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
- `students` — student profiles with LRN, grade_level, section, QR code for SecurePass. `grade_level`/`section`/`enrollment_status` are the **denormalised snapshot of the active school year** — every roster query reads them directly; the year-by-year record lives in `student_enrollments`, and the two are reconciled by the rollover when a year is activated. `enrollment_status` (`'pending'` | `'enrolled'` | `'transferred_out'` | `'dropped'` | `'graduated'`) gates who appears on a teacher's class list: only `'enrolled'` does. `is_active` is a separate axis — **on the roll vs archived**, not an enrolment state. `FALSE` means the learner has been taken off the active roll: the record, its grades, attendance and behaviour logs all survive, but every roster query in Node and FastAPI filters `s.is_active = TRUE`, so they leave class lists, dashboards and risk scoring. `archived_at` / `archived_by` / `archived_reason` say when, by whom and why — **`archived_by IS NULL` means the system archived them** when a school year was activated, rather than an admin. See "Archiving a learner" below. `qr_generated_by` (UUID, FK `users.id`) is stamped by `POST /api/students/:id/generate-qr` so the guard scan flow can identify the parent who pressed Generate and skip the guardian picker. `qr_fetcher_type` (`'self'` | `'auth'` | NULL) + `qr_fetcher_id` bind the active QR to a chosen fetcher: `'self'` → `users.id` of the parent themself, `'auth'` → `authorized_pickup_persons.id`, NULL → legacy/admin-generated path that falls back to the full authorized list. **Expiry policy depends on `qr_fetcher_type`**: `'self'` and NULL/admin QRs use time-based expiry (20 min parents, 30 min admins) AND one-time use; `'auth'` QRs are **single-use only with no time expiry** (the authorized fetcher has no account access to refresh, so a timer would strand them at the gate). Either way, a successful `/verify` clears `qr_code`, `qr_expires_at`, `qr_fetcher_type`, and `qr_fetcher_id`.
- `student_enrollments` — one row per `(student_id, school_year_id)`, carrying **two independent facts**. `status` (`'pending'` | `'enrolled'` | `'transferred_out'` | `'dropped'`) answers *is this learner attending this school year* and is owned by the Enrollment page. `outcome` (`'promoted'` | `'retained'` | `'graduated'`, NULL until the year is closed) answers *how did the year end for them* and is owned by the Year-End Promotion wizard. They are orthogonal — a learner is enrolled in 2025-2026 **and** promoted at the end of it — so writing one must never overwrite the other. `remarks` and `outcome_remarks` split the same way. `decided_by`/`decided_at` record who made the call.
- `parent_student` — many-to-many guardian↔student link.
- `authorized_pickup_persons` — non-account fetchers (yaya, lola, driver, relative) a parent has authorized to pick up a specific child. Unlike `parent_student` rows these have **no portal account** — they're scoped to `(parent_id, student_id)`, hold their own `surname`/`first_name`/`middle_name`/`relationship`/`photo_path`, and are managed exclusively by the owning parent through `/api/pickup-persons` from the vista_parent app. The Pickup QR tab lets the parent pick one of these as the fetcher before generating the QR; the chosen row's `id` lands in `students.qr_fetcher_id` and the `vista_guard` scan result renders the photo verbatim.
- `teacher_assignments` / `class_assignments` — teacher↔class/subject mappings, scoped to a school year; unique per `(grade_level, section, subject, school_year)`.
- `attendance` — per-student, per-subject, per-day record (Present/Absent/Late/Excused); unique on `(student_id, date, subject_id)` so each teacher records independently per subject. `school_year_id` (nullable, FK `school_years.id`) records **which year the attendance belongs to**, derived from the subject on write — `subjects` is scoped per school year, so the subject is authoritative. It is deliberately **not** derived from the date: consecutive school years leave months uncovered between one year's `end_date` and the next one's `start_date`, and every record falling in such a gap used to belong to no year at all and was invisible to every year-scoped query. NULL means genuinely unattributable (a legacy row with no subject) and counts for no year.
- `subjects` — curriculum subjects scoped to grade level + school year.
- `grades` — per-subject, per **grading period** (`score` = initial weighted avg; `grade` = final grade; `remarks` = "Passed"/"Failed" under the DO 8 policy, or a DO 015 descriptor under the newer ones). The column is still named `quarter` but means "period index" — see the grading-policy note below.
- `grading_structure` — configurable categories + components per subject (self-ref `category_id`; NULL = category, non-NULL = component).
- `score_items` — individual assessments under a component, scoped to **subject + section + quarter**.
- `student_scores` — per-student raw scores; unique on `(score_item_id, student_id)`.
- `behavior_logs` — teacher observations + VADER `vader_compound` score. `school_year_id`
  (nullable, FK `school_years.id`) records which year the observation belongs to. There is no
  subject to derive it from, so it is stamped on write with **the year that is active when the
  log is recorded** — a teacher observes a learner while working inside a school year, and the
  optional `observed_at` only moves the timestamp within it. It is deliberately **not** read off
  the date: years can leave months uncovered between them and can also overlap, so a date can
  name two years or none. `2026_08_31_behavior_school_year.sql` backfilled history from the
  learner's attendance that same day (which knows its year authoritatively) and then, for the
  rest, from the date — leaving NULL where neither could answer. NULL counts for no year and
  Student Detail groups those logs under "No school year recorded".
- `risk_assessments` — AI risk tier (Stable/Moderate/High). Factor columns `attendance_factor`/`academic_factor`/`behavioral_factor`/`ece_competency_factor` are `DECIMAL(5,4)`. Three are 0–1 (normalize before insert, e.g. avg_grade 92 → 0.92); **`behavioral_factor` is the signed raw VADER compound (−1 to +1)** — column is wide enough to hold negatives and FastAPI persists it verbatim from `behavioral_score`. `ece_competency_factor` is populated for **descriptively-assessed** learners from their latest-quarter rating average, weighted per the record's own `rating_scale` (E/G/F/NA still gives E=1.0 / G=0.75 / F=0.5 / NA=0.25). FastAPI follows the data rather than a grade list — a numeric learner has no competency records, so the factor stays NULL.
- `academic_predictions` — grade forecasts with confidence scores.
- `dismissal_logs` — SecurePass QR scan/authorization records. `gate_label VARCHAR(20)` records the entrance the guard set in the `vista_guard` Settings screen (e.g. "Gate 1"); nullable for admin/teacher-side scans that don't pass through the guard app. `fetcher_type` (`'self'` | `'auth'` | NULL legacy) + `fetcher_authorized_id` (FK `authorized_pickup_persons.id`, nullable, `ON DELETE SET NULL`) capture the actual fetcher: `authorized_by` always remains the responsible parent (FK `users.id`) so the existing JOIN and parent notifications keep working — the fetcher columns are an audit overlay, not a replacement.
- `school_years` — SY management via `is_active` (one) + `is_upcoming` (many). No `is_current` column. `period_model` (`'4Q'` | `'3T'`) and `grading_policy` (`'DO8_2015'` | `'DO15_2026'` | `'ZERO_BASED'`) declare **how that year is graded** — see "Grading periods & transmutation" below.
- `sections` — class sections per grade level + school year. `adviser_id` (UUID, FK `users.id`, `ON DELETE SET NULL`) is the **class adviser** — the teacher responsible for the section as a whole, as distinct from the per-subject rows in `teacher_assignments`. See "Class advisers" below.
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

**The period's *name* is as much a per-year fact as the count.** A `3T` year has terms,
so every surface that names one reads `T1`/`T2`/`T3` and "this term" — never `Q1`, never
"quarter". `resolveGradingPolicy()` returns `periodNoun`, `ordinals`, `abbr(p)` and
`label(p)` for exactly this, and UI code must render through them rather than writing the
letter out. The failure mode is quiet: `periods` is resolved correctly, so the right
*number* of controls appears with the wrong letter on them, and a three-term year showed
"Q1 Q2 Q3" beside sheet columns correctly headed 1st/2nd/3rd. When auditing for it, grep
both `` Q{ `` and `` Q${ `` — half of the offenders were inside template literals.

Both settings are **frozen once a school year is archived** (neither `is_active` nor
`is_upcoming`): `PUT /api/curriculum/school-years/:id` rejects a real change with 409
and the Edit School Year modal disables the two selects. The model is therefore chosen
when the year is created — the Create School Year modal sets the status too, so a year
only lands archived when that is what was asked for. Resubmitting the current values is
still a no-op, so ordinary edits (label, dates, status) keep working.

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

## Class advisers

`teacher_assignments` links a teacher to a class **per subject**, so it answers
"who teaches Math to Grade 3 Mabini" but never "who is responsible for Grade 3
Mabini". `sections.adviser_id` answers the second.

It lives on `sections` because that table is already keyed
`(school_year_id, grade_level, name)` — **exactly** the scope of an advisory — so one
nullable column is automatically per-year and automatically one-adviser-per-section,
with no new join and no new invariant. It is also keyed by the section's own **id**,
which keeps it outside the name fan-out in `utils/sections.js`: a rename carries the
adviser for free and `renameSectionEverywhere()` needed no new statement.

The tempting alternative was `class_assignments`, which is already adviser-shaped
(`UNIQUE(grade_level, section, school_year)`, no `subject` column) and completely
dormant. It was rejected because it keys on the school-year **label string** and holds
the section by name, making it a sixth entry in that fan-out. Do not revive it for this.

**One advisory class per teacher per school year**, enforced by
`idx_sections_adviser_sy_unique` — a partial unique index on
`(adviser_id, school_year_id) WHERE adviser_id IS NOT NULL AND is_active = TRUE`.
Three things that clause is doing:

- `adviser_id IS NOT NULL` — unadvised sections are the common case and must not collide.
- `is_active = TRUE` — sections are **soft**-deleted, so without it a deleted section
  would go on holding its teacher and the admin could not reassign them.
- `adviser_id` leads so the same index serves the "which section do I advise" lookup
  in `/auth/login` and `/auth/me`.

`PUT /api/curriculum/sections/:id/adviser` (`authorizeAnyAdmin` + grade scope) sets or
clears it; `GET /api/curriculum/sections/:id/adviser-candidates` feeds the picker. Both
are separate from `PUT /sections/:id`, whose contract is name + grade level with a rename
fan-out and a usage-blocked grade move — an orthogonal field tangles all three. The 409
names the section already holding the teacher, but **only when that section is inside the
caller's grade scope**; otherwise it says "another section", so an `admin_ece` refused on
their own Kinder card does not learn that the teacher advises Grade 5 — Sampaguita. The
candidates endpoint redacts the same way.

**That endpoint is the only writer.** Several surfaces *display* the advisory — Student
Detail, the teacher's own dashboard and profile, and Account Management → Teachers, which
shows it on the assignment chips and in the assignment-history modal — and none of them
write it. Do not add a second control: one rule, one write surface, which is the mistake
this codebase has already made once (the removed "Carry over" button). Displaying it
beside teacher assignments is fine and useful; `PUT /api/accounts/teachers/:id` must keep
its hands off the column.

**The adviser is not part of `sectionUsage()`.** That guard counts what a delete would
*orphan* — learners, enrolment records, teacher assignments, score items, all of which
hold the section by name and outlive it. The adviser is a pointer on the row being
deleted and goes with it.

**"Copy from" does not carry it.** Subjects, sections and teacher assignments are all
copied when a school year is created from another; `adviser_id` deliberately is not. A
subject assignment is a timetable that mostly repeats, while an advisory is a fresh
decision each year about who is responsible for a cohort — and copying one forward would
carry a stale adviser into an unreviewed year, where the uniqueness index would then
block the correct assignment until someone found and cleared the copy.

**It grants reads, never writes.** See "The adviser's reach" below. Archived school years
are **not** gated: renaming and deleting a section on a closed year are already ungated,
unlike enrolment writes and the grading model freeze, so the adviser follows the surface
it lives on.

Teachers see their own advisory through `advisory` on the `/login` and `/me` payloads —
scoped server-side to the **active** year, unlike `assignments`, which returns every year
and is filtered client-side. It is an array although the index caps it at one.
`GET /api/students/:id` carries `adviser` too, resolved from the learner's snapshot
against the **active** year's sections (the snapshot describes no other year), so it is
NULL for an archived learner or one whose section that year does not have.

### The adviser's reach

`teacher_assignments` is a **per-subject** fact, so a subject teacher sees one column of a
learner's record. An adviser needs the whole row — they compile the SF9 report card across
every learning area, keep the SF2 register, and handle conduct. `sections.adviser_id` is
therefore the **second source of teacher scope**, and `utils/advisory.js` is the only place
it is consulted. Do not re-inline it: the assignment lookup already exists in five
different shapes across five routers and has drifted more than once.

**Reads widen; writes do not.** `/api/advisory` (teacher-only, `advisory.routes.js`) is the
adviser's cross-subject view of their own section — class list, a subjects×learners grade
sheet, attendance across every subject, and behaviour from every teacher. It defines **no
POST, PUT or DELETE**, so the read-only promise is structural rather than a convention:
there is no adviser-authorized write to reach. Entering grades, marking attendance and
recording scores stay with the subject teacher, gated by `verifyTeacherAssignment()`,
`verifyEceAssignment()` and `teacherOwnsStudent()` exactly as before.

Three existing per-student reads gained an `OR` so Student Detail works for an advisory
learner: `GET /api/grades`, `GET /api/attendance` (each ORs the subject-name narrowing with
`advisedStudentSql`) and `GET /api/behavior`, where an adviser sees **every teacher's** logs
rather than only their own — the one read in the app where a teacher sees another teacher's
writing, because a conduct record made of one teacher's observations would look complete
while missing what everyone else saw.

**The adviser's extra reach is bounded to the active school year**, while their
subject-teacher reach stays unbounded as before. An advisory is a now-fact; "you advise
this learner this year, so you see this year's whole record" is the rule. Widening it to
all years would hand a one-year responsibility a learner's entire history.

**Why a page and not a wider filter.** Every existing teacher surface is one subject at a
time and derives a class *and then a subject* from `activeAssignments`, so an adviser with
no subject in the class would select a class whose subject list is empty. There is also no
seam that widens those reads without widening the writes beside them. The adviser's
question is cross-subject and whole-class — a different screen.

**A grade sheet's columns are the grade level's subjects plus any subject the learners
actually hold a grade in.** `students.grade_level` is the active year's snapshot while a
grade row points at whatever subject it was recorded against, so a learner moved mid-year
has grades against another level's subjects *inside the same school year*. Listing only the
current level's subjects silently drops them and the sheet reads as ungraded. They are
surfaced with an `off_level` flag instead — marked, not hidden.

## Enrollment & school-year rollover

A learner's position is two separate facts, and conflating them is the trap:

| | Holds | Read by |
|---|---|---|
| `students.grade_level` / `section` / `enrollment_status` | the **current** standing — a snapshot of the active school year | every roster query, in Node and in FastAPI |
| `student_enrollments.status` | is the learner **attending** that year | the Enrollment page |
| `student_enrollments.outcome` | how that year **ended** for them | the Year-End Promotion wizard |

**Status and outcome are two questions, not one vocabulary.** They were a single
seven-value column at first, which broke both ways: the Enrollment page's status
dropdown offered year-end verdicts alongside "enrolled", and recording an outcome
destroyed the enrolment fact it overwrote. `2026_08_22_split_enrollment_outcome.sql`
separated them. Never offer both in one select, and never let one surface write
the other's column.

`students.enrollment_status` is one value wider than `student_enrollments.status`:
it also carries `'graduated'`, because graduating is an outcome that *also* ends
the learner's presence in the school and so has to be expressible as a current
standing. `clampToManual()` in `utils/enrollment.js` handles the one path that
copies the mirror back into a record.

The snapshot is denormalised on purpose. Dozens of Node queries and four FastAPI
routers read `students.grade_level`/`section` directly, and `section` is matched
by *name* against `sections.name`; converting all of them to join through the
enrolment table was not worth the blast radius.

**The two are reconciled at exactly one moment**: when `PUT /api/curriculum/school-years/:id`
switches a year to active. `rolloverStudents()` then copies each learner's record
for the incoming year onto their `students` row, and marks everyone **without** a
record `'pending'`. That is the whole point — before this existed, activating a
year left every learner sitting in last year's grade, still counted as enrolled,
with no way to say "has not enrolled yet", "transferred out" or "repeats the level".
Activation is never blocked; the Edit School Year modal shows a pre-flight count
(`GET /school-years/:id/enrollment-readiness`) so it is not a surprise, and the
response carries `rollover: { adopted, pending }` for the toast.

Removing a record ("Not enrolled") is refused when the record carries a year-end
`outcome`, or when the learner has grades, scores, competency ratings or
attendance in that year — the row itself is cheap to delete (nothing references
`student_enrollments`), which is exactly why the things hanging off the *learner*
have to be checked instead. Both refusals are absolute. The year's own status no
longer blocks it: removing the **active** year's record sets
`students.enrollment_status='pending'`, matching what the rollover gives anyone
without a record.

**Who may do what.** The split is **placement versus status**. A scoped admin owns the
roster inside their grade scope — which grade level and section a learner sits in — and
`PUT /api/enrollment` still writes both for them. **`status` is `super_admin`'s**: the
Enrollment page renders the Status cell as a read-only badge for `admin_ece` /
`admin_elem`, and the API 403s on any submitted status that differs from what is stored
(a record that does not exist yet may only be created `pending`). It compares rather
than quietly substituting, so a refused save says so instead of returning 200.

**Grade scope on a school year's roster is judged by the grade level the learner held
*in that year*, not by `students.grade_level`.** The snapshot only describes the active
year, so scoping on it hands every other year to whoever owns the learner *now*: once a
Kinder cohort is promoted and the next year activated, their Kinder records left
`admin_ece` — the admin who actually kept that roster — and turned up under `admin_elem`,
who may not manage Kinder at all. `ROW_GRADE` (`COALESCE(e.grade_level, s.grade_level)`)
is the predicate for the roster, its summaries and `PUT`; the promotion review and
`DELETE` read `e.grade_level` outright, since both always have a record. The COALESCE
falls back only where the year has no record yet, which is the one case where nothing but
the snapshot says where the learner would land. Writing an archived year is still
`super_admin`-only on top of this — visibility and the archived-year gate are separate
questions. `GET /enrollment/student/:id` stays on the snapshot on purpose: it is one
learner's whole history, owned by whoever owns the learner today.

Two more actions are `super_admin`-only because they rewrite history: **removing a
record** ("Not enrolled" / `DELETE /api/enrollment`) and **unlocking an archived year**
(on the Enrollment page and in the wizard alike). The multi-select and bulk bar are hidden
from scoped admins too, but that one is a **UI guardrail with no server counterpart** —
`PUT` always posts an array, so nothing tells a bulk edit from eleven hand edits.

There used to be a third, **Carry over** (`GET /api/enrollment/previous`), which prefilled
every learner without a record for the year from the preceding one. It was removed once
the promotion wizard and the page's own draft seeding had absorbed it: the wizard writes
the forward `pending` record for everyone it decides, so all Carry over could still reach
were the learners nobody judged — and for those it proposed the grade they were already
in, which is what `rolloverStudents()` does at activation anyway. Filling an upcoming year
by hand is the "Not enrolled" status chip plus the bulk bar, and `draftFor` seeds each row
from the same outcome ladder, so the grades come out identical. Do not reintroduce it: it
was a fourth surface for one placement rule, and the two had already drifted apart once.

**The Year-End Promotion wizard is open to every admin**, bounded by grade scope: a scoped
admin closes out the grade levels they own and sees no one else's learners.

Step 2's placement can be overridden by hand, so it can end up contradicting the outcome
recorded beside it — a **retained** learner placed a grade up reads as a retention on the
record while behaving as a promotion. The wizard **warns rather than refuses**
(`placementMismatch()`: amber row, inline note, count banner, and a named list on Confirm),
because the placement may be a deliberate exception. The API refuses only when that
placement is *also* out of the caller's grade scope, and its 403 names the contradiction
rather than just the scope, since that is almost always the real mistake. Its one subtlety
is that promotion out of the **top** of a scoped range necessarily lands outside it, so an
out-of-scope target is accepted only where the ladder derives it — `admin_ece` moves Kinder
into Grade 1, but cannot place a Kinder learner into Grade 4. Note this also means
`admin_elem` can graduate a Grade 6 learner, and `graduated` is the one outcome that writes
`students.enrollment_status`. That is a year-end verdict earned from results, not the
attendance question the status column answers, which is why it is not a contradiction of the
status rule above — but it is the one path by which a scoped admin still changes that column.

**The Students page does not write status at all any more.** Its badge is a plain
read-only chip for every role, `super_admin` included. Enrolment status is a fact
*about a school year*, and that page carries no year — it only ever showed the active
one's — so setting it there answered a per-year question on a page that cannot ask it.
Status is set on the Enrollment page, which is scoped to a year by construction. The
endpoint behind the old badge, `PATCH /api/students/:id/enrollment-status`
(`authorizeSuperAdmin`, writes the mirror and the active year's record in one
transaction), still exists but nothing in the web app calls it. Reading status is
unchanged and open to everyone: the badge, the filter and the `by_status` breakdown.

**A grade level that disagrees with an outcome is confirmed, not blocked.** The Enrollment
page checks a drafted grade level against whichever outcome bears on the row — the row's
own, if that year has been closed, otherwise the previous year's, which is what put the
learner in this year's grade — and routes Save through a confirmation naming the learners.
It is the promotion wizard's mismatch rule applied where that placement can later be edited
by hand. The outcome column itself is never touched by this page; only the wizard writes it.

**A learner with no outcome at all gets the same treatment on the active year**, since that
check has nothing to compare against for them — and on the year that is running, a grade
level change is the edit that costs the most: the save moves them out of their class lists
at once (see the paragraph below). So the page names those rows too, on Save and in the
row, and both groups share **one** confirmation — a batch can contain each, and two dialogs
in front of one save would be worse than either mistake. It is the second guard on the
same worry as the read-only placement fields: the lock stops the mis-click, and the warning
names who moves once an admin has lifted it. Both confirm rather than refuse — moving a
learner mid-year is legitimate, it just should not happen unnoticed.

Editing the **active** year through `PUT /api/enrollment` writes the `students`
row immediately, because there is no later activation to pick the change up. Which is
why the Enrollment page opens the active year's **grade level and section read-only**,
with an unlock toggle in the banner. That is a guard against a slip rather than a
permission — any admin can lift it, and it covers only the two fields that move a
learner, never status. It is a **client-side** guard: the API has no equivalent, because
there is nothing to distinguish an intended placement change from an accidental one.
Editing an **upcoming** year only records the plan. An **archived** year is
read-only: `PUT` and `DELETE /api/enrollment` answer 409 unless the request
carries `allow_archived: true`, which the Enrollment page sends only after a
super admin has explicitly unlocked that year — a scoped admin gets a 403 naming
who can, since pointing them at an unlock button their page does not render
would be worse than a plain refusal. A closed year's records are the history
of who actually attended, and the page's dropdown offers closed years like any
other, so an unmarked write there is far more likely to be a mis-picked year than
an intended correction. The override exists because a year archives the instant
the next is activated — exactly when year-end corrections are still arriving — so
unlike the grading-model freeze this cannot be absolute. `isArchivedYear` lives in
`utils/schoolYear.js`, mirrored in `components/SchoolYearPicker.jsx`; the three
writers that can reach a closed year share one helper, `assertArchivedWritable()`.
The wizard is **not** subject to *this* gate on its closing year: it writes
`outcome`, not status, and has its own gate on the year learners move into.

A learner who has **left** drops out of later years' rosters entirely, or every
future year would accumulate every ex-student the school ever had. Three ways to
have left, judged from their most recent earlier record:

| | |
|---|---|
| `transferred_out` / `dropped` | they were enrolled and then stopped — settled either way, open year or not |
| **not enrolled** | no record at all for a school year that has **started** — archived or active |
| **`pending` when that year closed** | expected, never confirmed, and the year is over |

**Joining late is the mirror of it**, and needs its own rule (`JOINED_SQL`). A learner
added today has one record, for the active year, and nothing earlier — which the rule above
correctly reads as "new, not absent" and so lists them on this year and every year to come.
Read backwards, though, the same reasoning put them on the roster of a year that closed
before they existed, marked **Not enrolled** as if someone had forgotten to enrol them.
`prev` answers this too: a record from an earlier year means they were already here, and its
absence means one of two things — **no records anywhere**, a learner from before enrolment
history began, who is never hidden for exactly the reason above; or **records, but none
earlier**, which is someone who joined in this year or a later one. A year a learner
predates is not a gap in their enrolment for an admin to fill in. Like graduating, this is
not lifted by `include_left`: that flag is for finding a learner who left so they can be
re-enrolled, and a learner added last week did not leave SY 2024-2025.

**Graduating is not one of them either.** `outcome = 'graduated'` drops a learner out of later
years too, but on its own rule (`COMPLETED_SQL`) and with a different strength. Two
reasons it is not folded in with the three above. A graduate did not leave, they
*finished* — the opposite of transferring out or not coming back — and grouping them
together put them under a toggle reading "Show learners who left", greyed like a dropout
and counted on the same badge. And the exclusion is **not toggleable**: `include_left`
exists so a returning learner can be found and re-enrolled, and there is nothing to
re-enrol a graduate into, so lifting it on them would offer the whole alumni roll as
candidates for every future year. A graduate is filtered out of later years whatever the
flag says.

It reaches only the years *after* the one they graduated in: `prev` is the most recent
**earlier** record, so the graduation year itself still lists them with their outcome
badge. Undoing a mistaken graduation is the promotion wizard's job — blank the decision,
which posts `outcome: null` — not a matter of finding the row on a later year's roster.

**"Not enrolled" is the absence of a record, not a status** — and it is a different
fact from `dropped`: a learner who simply did not come back never enrolled to begin
with. Without it, `prev` skipping gaps meant someone who attended 2024-2025, sat out
2025-2026 and was looked at from 2026-2027 still read as `enrolled` and stayed on
every future roster.

**The Students page shows it too, derived rather than stored.** `GET /api/students`
returns `status_display`: `'none'` where the learner's snapshot says `pending` and they
have no `student_enrollments` row for the **active** year, the stored value otherwise.
Only `pending` is reinterpreted, because it is the only value `rolloverStudents()`
invents — it writes `pending` both for a learner with a pending record and for one with
no record at all, so the page showed the two as one badge and the difference was
visible only on the Enrollment page. The badge, the status filter and `by_status` all
read the derived value, so they agree with each other; the stored
`students.enrollment_status` is returned untouched beside it for the status editor.
Nothing new is written, and nothing on that page writes it: the badge is read-only,
so a not-enrolled learner becomes a real Pending or Enrolled by being given a record
on the Enrollment page.

The principle behind the last two rows is that a year the learner did not attend means
they left — and the test for that is whether the year has **begun**, not whether it has
finished. The **active** year has begun: someone with no record in the year the school is
actually running is not attending it, so an upcoming year's roster must not carry them
forward. Only an **upcoming** year says nothing yet — it is a roster not yet filled in,
and hiding people from it would remove the very learners the page exists to enrol (every
placement the wizard writes is `pending` in a year that has not started). In SQL that is
simply `NOT gap.is_upcoming`.

This never empties the active year's own roster, because the window ends *before* the
year on screen — the active year is only ever consulted while looking at a later one. It
also does not bite in the normal sequence: a learner the wizard has placed has a record
in the upcoming year, and one it has not yet reached still has their record in the active
year. What it catches is exactly the learner who is absent from the year now running.

Three boundaries the rule must not cross: a learner with **no earlier record at all**
is never hidden (they are new, not absent); the gap window starts at their last
attended year rather than at the beginning of time, or anyone who joined late would be
branded as having left; and it ends **before** the year on screen, never at it. That
last one is why opening an archived year still lists the learners with no record for
it — reviewing and correcting who was in a closed year is what opening it is for, and
those rows are exactly the work. "Has left" is a verdict about the years *behind* the
one being looked at.

`GET /api/enrollment?include_left=true` brings them back so a returning learner can
be re-enrolled, and the rollover leaves their standing alone instead of resetting it
to `pending`.

**`students.is_active` is not part of this at all**, and that is the fix rather than an
oversight. It is one global flag meaning "not on the school's roll *today*". The roster asks
a per-year question — was this learner part of SY X — and the archive cannot answer it: it
carries no year, and it is set automatically by whichever activation last ran. Filtering on
it let the flag overrule the very records it was derived from.

The damage landed exactly where the page is most useful. A learner declared **"Not
enrolled"** for a year has no record for it, so the next activation archives them with the
reason *"No enrolment record — SY 2025-2026"* — and that flag then hid them from SY
2025-2026, the one year whose roster explains their state and where an admin would go to
correct it. Archived learners are **marked**, via `is_archived` / `archived_reason` on the
row, never hidden.

`LEFT_SQL`, `COMPLETED_SQL` and `JOINED_SQL` are the whole filter, and they already ask the
per-year question properly — from the learner's most recent record *earlier* than the year on
screen, with `e.id IS NOT NULL` overriding all three, so a record for the year always wins.
The results that matter sit either side of one year:

| | SY 2025-2026 | SY 2026-2027 |
|---|---|---|
| dropped in 2025-2026 | listed, `dropped` | absent — they had gone |
| graduated in 2025-2026 | listed, `graduated` | absent |
| declared "Not enrolled" in 2025-2026 | listed, **Not enrolled** | absent |
| enrolled in 2025-2026, no 2026-2027 record | listed, `enrolled` | listed, **Not enrolled** |
| added in 2026-2027 | absent — they were not here yet | listed, `enrolled` |

The fourth row is the distinction the whole rule turns on: a learner who was present and then
has a gap is a gap to fill in, while one who had already left stays gone. Neither is decided
by whether they happen to be archived now.

### Archiving a learner

`students.is_active = FALSE` means **archived** — off the active roll, record intact. It is
a third axis alongside status and outcome, and it answers a different question: not *are
they attending this year* or *how did their year end*, but **are they still one of this
school's learners at all**. It carries no year, which is why the Enrollment roster above
does not filter on it.

The Students page owns it: an **Active / Archived** tab pair, Archive on an active row and
Restore on an archived one. There is no delete anywhere — the old "Remove student" set this
same flag, and the bug was never the flag but the missing way back (`GET /students` had no
parameter to lift it, `GET /students/:id` 404'd, and `students_lrn_key` kept the LRN, so the
learner could be neither found nor re-added). All three are fixed, and every LRN clash
against an archived row now names the holder and points at Restore.

**Activation reconciles the roll in both directions**, in one transaction:

1. `restoreReturningStudents()` — un-archive whoever belongs to the incoming year
2. `rolloverStudents()` — backfill record sections, adopt the snapshot, mark the rest pending
3. `archiveDepartedStudents()` — archive whoever the closing year finished with

Restore runs first because the adopt statement is gated on `s.is_active = TRUE`; a learner
still archived would come back holding a stale grade level. Archive runs last so it can
overrule the `pending` the rollover just wrote for someone who is not coming back.

**Who is restored is `BELONGS_TO_YEAR`** — the Enrollment roster's own predicate from
`utils/rosterSql.js`, evaluated as of the incoming year, so the two cannot drift. That
shared definition is the fix for the sharpest bug here: the restore used to take a
direction flag and bring back *every* system archive when reopening an earlier year, which
resurrected learners who had left in a year **before** the one being reopened. Reopening SY
2026-2027 revived someone who dropped out in SY 2025-2026 — a learner that same year's
roster correctly refuses to list. Now the archive reason never has to be interpreted; the
records decide.

**Direction still governs the archive.** `closing` is only "whichever year was active before
this click", so reopening an *earlier* year makes it a **later** one, and judging who has
left by it is backwards — a learner who graduated in 2025-2026 did not leave before
2024-2025, they were sitting in it. When `closing.label > incoming.label` the activation is
**rewinding** and archives nobody.

`archiveDepartedStudents()` takes off the roll every learner whose record in the **closing**
year was `dropped`, `transferred_out` or still `pending`, carried an `outcome` of
`graduated`, or **did not exist at all**, leaving `archived_by` NULL so the UI can tell a
system archive from an admin's.

**`pending` is in that list because the roster already put it there.** `LEFT_SQL` counts a
learner left `pending` when their year closed as having left — expected, never confirmed,
and the year is over — so later years' rosters have always refused to list them. The archive
disagreeing is what left such a learner on the active roll permanently: on the Students page,
on no roster that could explain it, and reachable only by an admin who thought to look. The
two now answer alike, and the archive reason says which it was (*"Enrolment never confirmed —
SY 2025-2026"*). It reaches only learners nobody confirmed **all year**, since the first guard
below spares anyone with a record in the incoming year — so a cohort the wizard has placed
forward is safe, while a cohort left `pending` through a year and never placed again is
archived at the next activation, in the number the pre-flight shows before the click.

Two guards, both load-bearing: a learner with a record in the **incoming** year is
never archived (the promotion wizard writes exactly such a row for everyone it places, so
without this activation would empty the roster the wizard had just filled), and the
**no-record** branch is skipped when the closing year holds no `student_enrollments` rows at
all (enrolment history starts at the year active when `2026_08_21_student_enrollments.sql`
ran, and on an earlier year that branch matches the whole school).

**Manual archives are never lifted** (`archived_by IS NOT NULL`) in either direction: a
duplicate record is a judgement about the record, not about which year is running.

**An archived learner's record stays readable, and no single-learner lookup may filter
`is_active`.** Preserving the record is the whole point of archiving rather than deleting,
so `GET /api/students/:id` (admins), `GET /api/enrollment/student/:id` and
`GET /api/ece/student-records` all serve them — the last two had the filter and 404'd, which
on Student Detail also surfaced as a "Student not found" toast on a page that had already
loaded the student. Grades, attendance and behaviour never filtered it. What is *not* served
is the **live** analytics — risk, class health, predictions — computed from rosters that
deliberately exclude archived learners: there is nothing to compute, so Student Detail skips
those requests and says so rather than firing calls that 404. The rule is history yes,
live signals no.

`DEPARTED_FROM` is the archive predicate, shared with the pre-flight
`GET /school-years/:id/enrollment-readiness` returns as `will_archive` / `will_restore`, so
the numbers the Edit School Year modal shows before the click are the sets activation
actually writes.

### Year-end promotion

`/enrollment/promotion` is a three-step wizard — review results, place learners,
confirm — that closes one school year into another. It reads the evidence VISTA
already holds and **recommends** an outcome per learner; it never decides.

| Grade level assessed | Evidence | Rule |
|---|---|---|
| numeric | final grade per subject (`finalGradeFrom` over the period grades) | DO 8, s. 2015 Table 10: all areas ≥ 75 → promoted; 1-2 below → promoted **flagged for review** (remedial classes, which VISTA does not track); 3+ below → retained |
| descriptive | latest period's rating distribution, banded by `bandDistribution()` | never retains — DO 015 treats KS1 as developmental; an `urgent` band is flagged for review |

Two rules the UI enforces on top: a learner with **no** results gets no
recommendation at all (a guess from nothing would be worse than none), and
promoting someone the data says to retain **requires a written reason**.

**The recommendation is never pre-selected as the decision.** It renders in its own
column and only becomes a decision when the admin picks it or presses "Accept all
recommendations" — otherwise the advice would arrive already looking like a verdict, and
a year could be closed without anyone having agreed to one.

**A decision can be taken back.** Blanking a committed decision and saving posts
`outcome: null`, which clears the verdict and deletes the forward placement — refused if
the learner already has work in the target year. The wizard remains the only writer of
`outcome`; it is now also the only eraser of one.

**A partial batch is allowed**, and is the normal case: teachers finish grading at
different times, so the wizard commits whoever has been decided and leaves the rest
untouched — no outcome, closing-year record unchanged, and `pending` on their current
grade if the next year is activated first. The only floor is the API's own `min(1)` on
`decisions`. Re-running seeds from `decided_outcome` and upserts, so finishing later
updates the same rows rather than duplicating them.

Only learners whose `status` is `enrolled` are reviewed. Someone who transferred
out, dropped, or was never confirmed did not finish the year — their status
already says what happened, and the wizard reports them as a count instead of
asking for a verdict.

A close whose **handover year is archived** is refused (409) unless the wizard is
unlocked — the same `allow_archived` idiom the Enrollment page uses, and in practice it
fires exactly when both years are closed. It keys on the target because writing an
outcome onto an already-archived closing year is the normal sequence, while the two
writes that rewrite history — the placement upsert and the graduated-row delete — both
land on the target. An **upcoming** closing year is refused outright (422): a year that
has not started has no results to judge. The wizard is the only writer of `outcome`
anywhere, which is why this is an unlock rather than a freeze.

The year they move into is **derived from the closing year**, never picked: it is
the next `school_years` row by label, and both promotion endpoints 409 on anything
else. It was a free choice defaulting to the earliest *upcoming* year — not the
same year once one has been activated — so a re-run closed the year into the one
after next and orphaned the placements the first run had written.

Committing writes twice per learner in one transaction — the **outcome** onto the
closing year's record (its `status` is left alone, so the enrolment fact
survives), and a **`pending`** record in the year they move into. Pending, not
enrolled: a promotion says where they belong if they come back, not that they
have. A graduate gets no forward record at all, and reversing an earlier decision
deletes the stale placement. Re-running updates the same rows, so the wizard is
resumable, not duplicative.

Only `graduated` touches `students.enrollment_status`, and only while the closing
year is still active. Promotion and retention leave it alone — the learner is
still in their current class until the next year is activated.

**Sections are renamed, not orphaned.** Nothing references a section by id — five
tables hold it as a bare name string (`students`, `student_enrollments`,
`teacher_assignments`, `class_assignments`, `score_items`). `PUT
/api/curriculum/sections/:id` now cascades a rename across all of them, scoped to
the section's grade level *and* school year, and `DELETE` counts dependents the
same way instead of matching on the name alone. Moving a section to another grade
level is refused once anything depends on it — that is not a rename, and the
learners and score items in it belong to the old grade. See `utils/sections.js`.

**Still open:** `risk_assessments` and `dismissal_logs` carry only timestamps, no
year dimension, and neither has a `subject_id` to derive one from.
`attendance` gained a `school_year_id` in `2026_08_23_attendance_school_year.sql`
and `behavior_logs` in `2026_08_31_behavior_school_year.sql` — the latter stamped
on write from the active year rather than derived, since an observation has no
subject. Neither remaining table has an equivalent moment to stamp, so their
history would have to be guessed from the clock.
Enrolment history
starts at the school year that was active when
`2026_08_21_student_enrollments.sql` ran; earlier rosters cannot be reconstructed.
The wizard has no record of remedial classes, which is why the 1-2-failed case is
flagged for a human rather than decided.

## Role-Based Access (summary)

Detailed per-feature role behavior lives in the backend/frontend nested `CLAUDE.md` files.

Roles stored in `users.role` (enum constraint: `super_admin`, `admin_ece`, `admin_elem`, `teacher`, `parent`). Grade scope is derived from role via `utils/roles.js` on both backend and frontend (`gradeScopeForRole`, `isAnyAdmin`, `isSuperAdmin`, `isScopedAdmin`, `canManageGrade`). No `grade_scope` column on `users` — the JWT carries only the role, and the auth payload (`/login`, `/me`) exposes a computed `grade_scope` array for convenience.

- **super_admin** — school-wide. Full access except Attendance and Score Entry (teacher-only). Manages other admins, school years, all curriculum, all students. ECE Competency is read-only. Only role that can hit `/api/accounts/admins` CRUD, `POST/PUT/DELETE /api/curriculum/school-years`, and the enrolment actions that rewrite history or run across the whole school (setting a learner's enrolment status, record removal, and the archived-year unlock). The Year-End Promotion wizard is open to all three admin tiers, bounded by grade scope.
- **admin_ece** — scoped to Kinder (the only remaining early-childhood level). Can manage teachers, students, subjects, sections, and grading structure for Kinder. Cannot manage school years, cannot manage other admins. Can open ECE Competency (read-only). Elementary routes and data are invisible. Grade routes (`/api/grades/*`, Grades page) are rejected — ECE grade levels track learning via the ECE Competency tool, not the grades table.
- **admin_elem** — scoped to Grade 1 – Grade 6. Mirror of `admin_ece` for elementary. ECE routes (`/api/ece/*`, `/api/ai/ece-class-health`, ECE Competency page) are rejected.
- **teacher** — scoped to `activeAssignments` (from `/api/auth/me`, filtered to the active SY). Teacher-facing pages (Students, Attendance, Score Entry, Behavior, ECE Competency) use a "Class" dropdown filtered to assigned sections. Risk Overview, the "In Your Class" card on Student Detail, and TeacherDashboard all draw teacher-scoped numbers from `/api/ai/class-health/all` — a single source of truth for teacher-scoped band numbers.
- **parent** — limited access; students endpoint filters to linked students via `parent_student`.

Both scoped admins keep the **placement** half of enrolment work within their grade scope — which grade level and section a learner sits in. **Enrolment status is `super_admin`'s**, on both surfaces that write it: the Enrollment page's Status column is read-only and `PUT /api/enrollment` refuses a changed status, and the Students page no longer writes status at all — its badge is a read-only chip for every role, including `super_admin`, since that page carries no school year to set a per-year fact against. See "Enrollment & school-year rollover".

**Scoped-admin enforcement**: every GET that returns students or student-derived rows filters by `gradeScopeForRole(req.user.role)`. Mutations on grade-scoped rows (students, subjects, sections, grading, guardians, QR, behavior-admin queries) call `enforceGradeScope(req, grade_level)` which throws 403 out-of-scope. Account CRUD: scoped admins see only teachers whose active-SY assignments fall within their scope (or no active-SY assignments yet); historical out-of-scope assignments are preserved on edit/delete.
