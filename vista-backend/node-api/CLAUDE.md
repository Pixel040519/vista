# Node API — CLAUDE.md

Express.js REST API on port 5000. Entry point `src/server.js`; one route file per feature domain in `src/routes/`; PostgreSQL pool (max 20) in `config/database.js`; JWT middleware in `middleware/auth.middleware.js`. **There is no migration runner** — the `migrate` npm script points at a `config/migrate.js` that does not exist; migrations in `database/migrations/` are applied by hand with `psql` and are each written to be safe to re-run.

## Roles & authorization (`utils/roles.js`, `middleware/auth.middleware.js`)

Five roles: `super_admin`, `admin_ece`, `admin_elem`, `teacher`, `parent`. `utils/roles.js` is the single source of truth for role constants and grade-scope derivation. Helpers:

- `ROLES` — canonical string enum.
- `ANY_ADMIN` — `[super_admin, admin_ece, admin_elem]`.
- `gradeScopeForRole(role)` — returns the grade list the role may touch. `admin_ece` → ECE grades, `admin_elem` → elem grades, everyone else → all grades.
- `canManageGrade(role, grade_level)` — boolean guard used by route handlers.
- `isAnyAdmin` / `isSuperAdmin` / `isScopedAdmin`.

Middleware exports (`auth.middleware.js`): `authenticate`, `authorize(...roles)`, `authorizeAnyAdmin`, `authorizeSuperAdmin`, `authorizeAdminOrTeacher`, and `enforceGradeScope(req, gradeLevel)` which throws 403 if the caller cannot manage that grade.

**Error contract**: `errorHandler` reads **`err.statusCode`**, not `err.status`. An error that sets only `status` falls through to a 500 — `enforceGradeScope` did exactly that, so every out-of-scope rejection surfaced as a 500 rather than a 403 until it was fixed. Prefer `AppError(message, statusCode)`; if you hand-roll an error, set `statusCode`.

**401 vs 403 is load-bearing.** 401 means *not authenticated* — no token, an invalid or **expired** access token (`authenticate`), or an invalid or expired refresh token (`POST /api/auth/refresh`). 403 means *authenticated but not allowed* — `authorize()`, `enforceGradeScope`, assignment checks. Both clients (the dashboard's axios interceptor and `vista_api`'s `ApiClient`) refresh the access token **only on 401**, so an expired token answered with 403 is never refreshed: that was the bug behind parents seeing `VistaApiException(403): Invalid or expired token.` on every request once their 1-day access token lapsed. An expired refresh token used to reach the client as a 500 (`TokenExpiredError` was not caught); it is now a 401 too. Never return 403 for a token problem.

**Route conventions:**
- School year writes (`POST/PUT/DELETE /api/curriculum/school-years`), admin-account CRUD (`/api/accounts/admins`) and the enrolment actions that are school-wide or rewrite history (`DELETE /api/enrollment`, both promotion endpoints) → `authorizeSuperAdmin`.
- All other "admin" operations → `authorizeAnyAdmin`, plus `enforceGradeScope` on the target row's `grade_level`.
- Competency routes (`/api/ece/*`, `/api/ai/ece-class-health`) → allow **all three admin tiers** + `teacher`. `admin_elem` is no longer rejected outright: DO 015 moves Grade 1 to descriptive grading while it stays an elementary responsibility. Reach is bounded per request by `enforceGradeScope` / `gradeScopeForRole` instead, so `admin_ece` still only sees Kinder.
- Grade routes (`/api/grades/*` in `crud.routes.js`) → allow `super_admin` + `admin_elem` + `teacher`; reject `admin_ece`. Descriptively-assessed grade levels use `ece_competency_records`, not `grades`. Gated at router level via `gradeRouter.use(authorize(...GRADE_ROLES))`.
- Scoped GETs filter lists by `gradeScopeForRole(req.user.role)` so scoped admins never see out-of-scope rows.
- `/api/ai/risk-all`: super_admin pass-through; scoped admins filter students by grade scope + recompute `summary`; teacher branch (legacy) filters by `teacher_assignments`.

**Auth payload**: `POST /api/auth/login` and `GET /api/auth/me` both include `grade_scope = gradeScopeForRole(user.role)` so the frontend doesn't duplicate the mapping.

## AI proxy (`ai.routes.js`)

All AI endpoints proxy to FastAPI (`:8000`). The frontend only ever hits these Node routes — access control lives here (FastAPI is role-agnostic).

- `POST /api/ai/predict-performance`
- `POST /api/ai/risk-assessment`
- `GET /api/ai/risk-all` — admin + teacher. For teachers the proxy looks up `teacher_assignments` for the active SY, filters FastAPI's result to the teacher's `(grade_level, section)` set, and recomputes `summary` counts. Legacy for teachers — no UI consumes it; the Risk Overview teacher view uses `/class-health/all` instead.
- `POST /api/ai/sentiment`
- `GET /api/ai/dashboard-summary`
- `GET /api/ai/teacher-dashboard` — resolves teacher from JWT (`req.user.id`) + active SY label, forwards both as query params to FastAPI `/teacher-dashboard/summary`. Frontend never sends `teacher_id`.
- `GET /api/ai/class-health` (single student, teacher-only) — returns DSS `suggestions[]` with deep-link actions (`score-entry` / `attendance` / `behavior`).
- `GET /api/ai/class-health/all` (bulk, teacher-only).

### Class-health rules

Teacher-scoped rule-based signals computed entirely in Node. Metrics:

- **Academic** — latest-quarter grade per subject, averaged. <75 urgent, 75–79.9 watch, ≥80 ok; `insufficient` when no rows. Non-ECE students only.
- **Competency** — descriptively-assessed students only, replaces Academic. Latest-quarter rating distribution via `bandCompetency(dist, totalSkills, scaleId)`, which delegates to `bandDistribution()` in `utils/grading.js`. The rules are **banded by rank, not by letter**: what was hardcoded as "NA" is the scale's *worst* level and "F" its *second worst* — `insufficient` when completion <30% or no ratings, `urgent` when worst% >30%, `watch` when any worst or second-worst% >40%, else `ok`. For E/G/F/NA this is byte-identical to the previous implementation (verified across 14,406 combinations).
- **Attendance** — last 30 days in teacher's subjects. <0.70 urgent, 0.70–0.849 watch, ≥0.85 ok; `insufficient` when total <5.
- **Behavior** — teacher's own `behavior_logs` this month. avg_sentiment <-0.30 urgent, -0.30–-0.001 watch, ≥0 ok; `insufficient` when log_count <2.

Overall band = worst of non-insufficient metrics. For ECE students competency is included in the overall-band calc instead of academic (academic stays `insufficient`). `top_concern` skips the non-applicable metric per student (`academic` for ECE, `competency` for non-ECE). Shared band helpers `bandAcademic` / `bandCompetency` / `bandAttendance` / `bandBehavior` / `overallBand` live at file scope in `ai.routes.js` so single-student, bulk, and ECE endpoints stay in sync.

Bulk response per student: `overall_band`, `top_concern` (tie-break: academic > competency > attendance > behavior, excluding the non-applicable metric), `is_ece` (**retained wire name — it now means "assessed descriptively", which is what it always implied**; `is_descriptive` and `rating_scale` are emitted alongside it), and four `metrics.{academic,competency,attendance,behavior}` objects (`metrics.competency` is `null` for non-ECE students; `metrics.academic.band = 'insufficient'` for ECE students). Sorted urgent → watch → ok → insufficient with worst metric value breaking ties within a band. Query strategy: one roster query + three per-section-group metric queries + one bulk ECE competency load (totals by grade-level + latest-quarter distribution by student) when any ECE students are in scope. Roster uses `WHERE is_active = TRUE` — the `students` table has no `status` column.

### ECE variant — `GET /api/ai/ece-class-health`

Competency-based equivalent of `/class-health`. Replaces the academic tile with a **competency** tile banded on the rating mix for the student's latest quarter with records. Shared by admin + teacher: teacher scope is resolved from `teacher_assignments` for the student's `(grade_level, section)` under the active SY (404s on no match); admin runs school-wide. **Rejects numerically-assessed students with 400** — membership is resolved from `grade_level_assessment`, not a hardcoded ECE list, so Grade 1 lands here once configured descriptive. The response carries `rating_scale` + `scale`, and all distributions are keyed by that scale's codes. Attendance tile is last-30-days (teacher-filtered by subject name) and behavior is this-month (teacher-filtered by `teacher_id`) — same rules as `/class-health`. Response shape: `{ scope, overall_band, suggestions, metrics: { competency, attendance, behavior } }`. `competency` also includes `per_subject[]` — one `{ subject_id, subject_name, rated, total_skills, distribution, band }` entry per ECE subject for this student's grade level (subjects with zero skills defined are omitted), sorted urgent → watch → insufficient → ok then by `subject_name`. DSS competency suggestions are emitted per-subject (capped at 3 urgent + 2 watch, with an overflow "+N more subjects" line) so each line names the struggling subject; suggestions include an `{ type: 'ece' }` action that the frontend routes to `/ece-competency`.

## Behavior logs (`crud.routes.js`)

Writes are **teacher-only**: `POST/PUT/DELETE /api/behavior[/:id]` use `authorize('teacher')`. PUT/DELETE WHERE clauses include `teacher_id = req.user.id`. POST validates that `student_id` is in one of the teacher's active-SY `teacher_assignments` sections via the file-scope `teacherOwnsStudent` helper — 403s otherwise.

`GET /api/behavior` branches by role:
- Teachers pass `student_id` and see their own logs — plus every teacher's logs for the active year when they advise the learner (see "The three widened reads"). If the student isn't in their classes, returns `{logs:[], total:0}` so `StudentDetail` doesn't break.
- Admins may omit `student_id` and pass any combination of `student_id`, `teacher_id`, `grade_level`, `section`, `category`, `sentiment`, `date_from`, `date_to`, `school_year_id`, `limit`, `offset`. `school_year_id` matches the year a log was **stamped with** on write (`bl.school_year_id`), never a date range — it is what the admin page's "This school year" tab sends. Response `{logs, total}` — logs join `students` for name/grade/section/`lrn` plus a correlated `subject` field from `STRING_AGG(DISTINCT ta.subject)` on `teacher_assignments` joined via `(teacher_id, s.grade_level, s.section)`. Both list AND count queries JOIN `students s` so grade/section filters resolve.

Both write and read carry a **school year**. `POST` stamps `school_year_id` from the year that is
`is_active` when the log is recorded — there is no subject to derive it from as attendance has, and
a teacher writes an observation while working inside a year, so the active year is the answer and
the optional `observed_at` only moves the timestamp within it. `GET` joins `school_years` and
returns the label as `school_year`, which is what lets Student Detail group a learner's history by
year. `2026_08_31_behavior_school_year.sql` added the column and backfilled history — first from
the learner's attendance that same day (authoritative: attendance derives its year from the
subject), then from the date — leaving NULL where neither could answer.

`GET /api/behavior/class-roster?grade_level=&section=` (teacher-only) feeds the teacher Behavior page's roster: every learner in the class (the `advisoryClassList` predicate — `is_active` + `enrolled`) with `total` / `positive` / `neutral` / `negative` / `last_observed_at`. It 403s unless the caller holds an active-SY `teacher_assignments` row for the class or advises it, and it tallies exactly the logs `GET /api/behavior` shows per learner — their own from any year, plus every teacher's for the active year when they advise the section — so a roster count never disagrees with the timeline it opens. Change the two visibility rules together.

`GET /api/behavior/summary` (any admin) takes the same filter set (including `school_year_id`) and returns `{total, positive, neutral, negative, this_week}`. Scoped admins filter by their `gradeScopeForRole` on `students.grade_level`.

## Competency tracking (`ece.routes.js` — `/api/ece`)

Manuscript pillars 2b + 3c. Quarterly competency tracker for **descriptively-assessed**
grade levels. Despite the route prefix this is no longer ECE-only: which grade levels
land here is per (school year, grade level) configuration — see "Assessment mode" below.
Skills use `subject_id` FK to `subjects` (migration `2026_04_16_ece_skills_subject.sql`;
legacy `domain_id` still nullable).

**Access**: `eceAllowed = authorize(...ANY_ADMIN, TEACHER)`. `admin_elem` used to be
rejected outright; that would have locked the elementary admin out of Grade 1 once DO 015
moves it to descriptive grading. Which grade levels each admin may touch is enforced per
request by grade scope instead, so `admin_ece` still keeps Kinder.

- `GET/POST/PUT/DELETE /skills` — admin + teacher.
- `GET /records?grade_level=&section=&quarter=` — roster + existing ratings. Also returns
  `rating_scale` + the full `scale` object so the client renders the right buttons
  without guessing which codes are legal.
- `POST /records` — bulk upsert. Validates each `rating` against the grade level's
  configured scale (422 with a readable message otherwise) and stamps `rating_scale` on
  every row. Rejects a grade level that is configured numeric.
- `GET /student-records` — same guards; also returns `rating_scale` + `scale`. Its student
  lookup **does not filter `is_active`**, for the same reason as
  `GET /api/enrollment/student/:id`: recorded ratings are history, and an archived learner's
  Competencies tab is often the only place their work can still be read.
- `GET /summary?quarter=` — admin + teacher, scoped by `gradeScopeForRole`. Per-class
  `classes[]` now carry `rating_scale` + their own `distribution`; `by_grade_level[]` is
  built from the **configured descriptive levels**, not a fixed four.
  **`rating_distribution` was replaced by `distributions[]`** — one self-describing entry
  per scale in play (`{scale_id, label, short, levels[], counts, total}`), because a
  single flat `{E,G,F,NA}` is meaningless once Kindergarten is on CO/DV/BG and Grade 1 on
  A-E in the same year.

`verifyEceAssignment()` checks `teacher_assignments` for the active SY and rejects grade
levels that are not descriptive this year. Skills with existing records are soft-deleted
via `is_active=FALSE`; hard-delete only when unused. Seeded in
`2026_04_14_ece_competencies.sql`.

## Assessment mode & rating scales

Migration `2026_08_19_descriptive_grading.sql`. DO 015, s. 2026 moves KS1 off numeric
grading one grade level per year, but the schedule is **data, not code** — NRYS is private
(DO 015 only "encourages" adoption), so the school sets its own pace. Pre-Nursery,
Nursery and Pre-Kinder were retired in Aug 2026 and no longer exist anywhere in the
system; Kinder is the only remaining early-childhood level.

`grade_level_assessment` holds one row per `(school_year_id, grade_level)`:
`assessment_mode` (`'numeric'` | `'descriptive'`) + `rating_scale` (required for
descriptive, NULL for numeric — enforced by a CHECK). **Zero rows means the built-in
defaults**: Kinder descriptive on E/G/F/NA, Grades 1-6 numeric, i.e. exactly
the behaviour that existed before.

- `utils/grading.js` — `RATING_SCALES` (`EGFNA`, `CODVBG`, `ABCDE`),
  `resolveAssessment(gradeLevel, configRow)`, `bandDistribution(dist, totalSkills, scaleId)`,
  `competencyValue()`, `isValidRating()`. Levels are ordered best-first and everything
  derives from that order, so adding a scale needs no downstream changes. Level `weight`
  is `(levels - index) / levels`, which reproduces E=1.0 / G=0.75 / F=0.5 / NA=0.25
  exactly — AI risk scores did not move.
- `utils/assessmentConfig.js` — DB loaders (`loadAssessmentRows`, `loadAssessment`,
  `descriptiveGradeLevels`). Separate from `grading.js` because that module is pure so it
  can be mirrored verbatim into the dashboard bundle.
- `GET /api/curriculum/assessment-config?sy_id=` — every grade level in the caller's
  scope with its resolved mode, a `configured` flag, and the available `scales`.
- `PUT /api/curriculum/assessment-config` — `authorizeAnyAdmin` + `enforceGradeScope` per
  entry. **409s** if the grade level already has ratings recorded on a different scale.
- `DELETE /api/curriculum/assessment-config/:grade_level` — reverts to the default.

Two traps worth stating explicitly:

1. **`roles.ECE_GRADES` is not the descriptive-grade list.** It answers "which grade
   levels may an `admin_ece` manage" — an org-chart question DO 015 does not change.
   Assessment mode is a separate curriculum question. Grade 1 can be descriptive while
   remaining `admin_elem`'s responsibility. Use `utils/assessmentConfig.js` for the second.
2. **`'E'` is Excellent on EGFNA but Emerging — the *worst* level — on ABCDE.** That is why
   `ece_competency_records.rating_scale` exists, with a pairwise CHECK tying the code to
   its scale. Records are self-describing so re-configuring a grade level cannot silently
   turn top marks into failing ones. Anything reading ratings must read the row's scale.

**Known gap:** the numeric paths (Score Entry, `POST /api/scores`) do not yet refuse a
grade level configured as descriptive. Add that guard before configuring one in production.

## Account Management (`account.routes.js`)

Teacher list + assignment queries (`GET /api/accounts/teachers`, `GET /api/accounts/assignments`, `getAssignments()` helper) are scoped to the active SY.

- `GET /api/accounts/teachers/:id/assignment-history` — all assignments grouped by SY (History modal).
- On edit, only active-SY assignments are deleted + replaced; historical assignments are preserved.
- "Copy from..." dropdown lists prior SYs with assignment counts; selecting replaces the current assignment rows.

**Advisories ride alongside, read-only.** Three endpoints carry an `advisory`
array from `utils/advisory.js`: `GET /teachers` and `GET /teachers/:id` (active
year, matching `getAssignments()`), and `GET /teachers/:id/assignment-history`
(**every** year — a year a teacher advised a class belongs in the record as much
as a year they taught a subject). On the list query it is a correlated subquery
rather than a second `LEFT JOIN`, so it cannot multiply the assignment rows being
`json_agg`'d beside it.

Nothing here writes it. `sections.adviser_id` is set on the Curriculum page's
Sections tab and nowhere else — one rule, one write surface, which is the mistake
this codebase has made before (the removed "Carry over" button). `PUT /teachers/:id`
does not touch the column.

The two facts are **independent**: a teacher can advise a class they teach no
subject in, and teach subjects in a class they do not advise. So a client must
union the school years rather than assume advisory is a subset of assignments —
otherwise a year with an advisory and no assignments vanishes from the history.

**Scoped admins** (`admin_ece`, `admin_elem`) see **all** teachers (the teacher list is not filtered by scope — both admin tiers share the same roster, so a teacher handling both ECE and elementary subjects appears under either admin). Scope is enforced at the assignment level only: `assertAssignmentsInScope` gates each assignment row on POST/PUT so scoped admins cannot create/save assignments outside their grade scope. On edit, the scope-aware DELETE in PUT only removes active-SY assignments whose `grade_level` is in the caller's scope, so out-of-scope active-SY assignments (edited by the other admin tier) remain intact. Historical assignments across past SYs are always preserved.

**Admin account CRUD** (super_admin only): `GET/POST/PUT/DELETE /api/accounts/admins`. Create accepts `admin_ece`, `admin_elem` or `super_admin`; the last requires `confirm_password`, the caller's own password, checked with bcrypt (403 when wrong). `PUT` moves a role only between the two scoped tiers and never changes a super admin's. Delete is soft (`is_active=FALSE`) and now reaches another super admin too, but never the caller (`PUT is_active:false` and `DELETE` both 400) and never the last super admin who can sign in (`assertNotLastSuperAdmin`, 409).

**Staff accounts are invitations** (see the root `CLAUDE.md`). Both create routes insert `password_hash NULL`, `account_status 'pending'` and an `account_invitations` row via `issueInvitation()` from `utils/invitations.js`, and send nothing. All four create/update schemas refuse `password` with `Joi.forbidden()` rather than stripping it, so an old client is told the field is gone. Every list and single read carries `account_status`, `last_login_at`, `has_password`, the newest `invitation` (a correlated `invitationJsonSql()` subquery, so it sits beside the teacher list's `json_agg` without widening `GROUP BY`) and a derived `access` from `utils/staffAccess.js`. The helpers in the router are the only writers of staff access:

| Helper | Does |
|---|---|
| `reissueStaffInvitation` | `POST /teachers|admins/:id/invitation` — reopens for 30 days, cancels any unused code, switches the account back on; 409 once a password exists |
| `setStaffActive` | off: `is_active=FALSE` **and** closes the live invitation; on: back on if they have a password, otherwise a reissue |
| `changeStaffEmail` | email edits on `PUT`, only while `has_password` is false (409 after), via `changeInvitationEmail()` |

`DELETE /teachers|admins/:id/invitation` (**cancel**) is `setStaffActive(false)` on an account that never activated, 409 on one that did. Reads after a write use the pool *after* the transaction commits — the old create read its assignments inside the transaction through the pool and so always returned none.

Teacher assignments are unique per `(grade_level, section, subject, school_year)`. Backend rejects duplicates on create/update scoped to the active SY. Teacher assignments are copied when creating a new SY with "copy from".

## Curriculum (`curriculum.routes.js` — `/api/curriculum`)

**School years.** Status is the pair of booleans `is_active` / `is_upcoming`; "archived"
is simply neither. `POST /school-years` accepts both (defaulting to `false`), so the
Create modal sets the status at creation instead of leaving every new year archived.
`is_upcoming` is refused for a year whose end year has already passed.

The grading model (`period_model`, `grading_policy`) is **frozen once a year is
archived**: `PUT /school-years/:id` throws 409 if either column would actually change
on an archived row. The comparison is against the stored value (NULL reads as the
`4Q`/`DO8_2015` default), so the Edit modal resubmitting the current values verbatim
stays a no-op and label/date/status edits keep working. Pick the model when the year
is created — including for a back-dated year, which is archived from the start.

**Subjects** carry `name` + `grade_level` only. The unused `description` column was
dropped (`2026_08_21_drop_subject_description.sql`, all 155 rows were NULL) along with
the field on `POST`/`PUT /subjects`, both subject selects, and the copy-from-SY INSERT.
`competency_skills.description` is a different column and is untouched.

## Enrollment (`enrollment.routes.js` — /api/enrollment)

Admin-only (`authorizeAnyAdmin` at router level), with a second axis on top: **scoped
admins place learners, `super_admin` decides status.** A scoped admin may write
`grade_level` and `section` for anyone in their grade scope — that is the roster they
keep — but `status` is not theirs: `PUT /` **403s** if a submitted status differs from
what is stored, or is anything but `pending` for a record that does not exist yet
(`pending` is what the rollover gives anyone unconfirmed). It compares rather than
silently substituting, because the page posts the whole draft row and a quiet overwrite
would answer 200 to a save that did not do what it said.

Also `super_admin`-only: `DELETE /` and a `status:'none'` removal inside `PUT /`.

`GET /previous` used to sit beside them — the prefill behind the page's "Carry over"
button, returning the preceding year's records with a `proposed_grade_level` derived from
each learner's outcome. It is **gone**, along with the button. `POST /promotion` already
upserts the forward `pending` record for every learner it decides, so the only rows the
prefill could still fill were the undecided ones, and for those `placementForOutcome`
returns the grade they are already in — the same standing `rolloverStudents()` gives them
at activation, minus a `student_enrollments` row that reads like a decision nobody made.
`placementForOutcome` stays; `GET /promotion-review` is now its only caller.

**Scope is judged per year, not from the snapshot.** Every scoped-admin filter in this
router keys on the grade level the learner held **in the year being read or written** —
`ROW_GRADE` (`COALESCE(e.grade_level, s.grade_level)`) for the roster, its three summary
queries and `PUT /`'s source check; bare `e.grade_level` for `GET /promotion-review`
and `DELETE /`, which always have a record. `students.grade_level` is the
*active* year's snapshot, so using it made ownership of a past year follow the learner:
after a Kinder cohort was promoted and the next year activated, their Kinder records
vanished from `admin_ece`'s roster and appeared on `admin_elem`'s. `GET /promotion-review`
was the sharper version — it disagreed with `POST /promotion`, which has always scoped on
the closing year's `e.grade_level`, so the wizard changed hands mid-close and the commit
then refused the rows the review had handed over. The COALESCE fallback fires only where
the year has no record, the one case where nothing else says where the learner sits; the
per-learner `GET /student/:id` deliberately stays on the snapshot, since a whole history
belongs to whoever owns the learner today.

**The promotion endpoints are not** — a scoped admin closes out the grade levels they own,
bounded per request rather than at the router. `GET /promotion-review` filters the roster
by `gradeScopeForRole`, and `POST /promotion` checks the grade being left *and* the one
being entered. The target check has one deliberate exception, or the admin who owns a
range's **last** grade level could never close it: promotion out of the top necessarily
lands outside. An out-of-scope target passes **only where the ladder derives it** for that
learner — `nextGradeLevel(from)` for a promotion, the same grade for a retention — so
`admin_ece` moves Kinder into Grade 1 but cannot place a Kinder learner into Grade 4.
The archived-handover unlock stays `super_admin`'s via `assertArchivedWritable`.

**`PATCH /api/students/:id/enrollment-status` moved with it** — it is `authorizeSuperAdmin`
too. It is the single-learner path to the same column, so leaving it on `authorizeAnyAdmin`
would have made the rule above a speed bump: one page over is not a boundary. Grade scope
still applies on top of the role via `assertStudentInScope`.

One record per `(student_id, school_year_id)`; `students.grade_level`/`section`/`enrollment_status`
stay the denormalised snapshot of the **active** year because every roster query
in Node and FastAPI reads them directly.

**Two columns, two vocabularies** (`2026_08_22_split_enrollment_outcome.sql`):
`status` = attending this year (`pending`/`enrolled`/`transferred_out`/`dropped`,
owned by `PUT /`), `outcome` = how the year ended (`promoted`/`retained`/
`graduated`, NULL until closed, owned by `POST /promotion`). `remarks` /
`outcome_remarks` split the same way. `PUT /` **refuses an outcome before Joi
runs**, so the error names the wizard rather than emitting a generic enum message.

A learner who has **left** is excluded from later years' rosters — judged from
`prev`, a `LEFT JOIN LATERAL` onto their most recent *earlier* record (gaps
skipped), shared by the roster query, both summaries and the hidden-count so all
four agree (`LEFT_SQL`). `?include_left=true` overrides. That same `prev` feeds
the `last_*` fields behind the page's "Last attended" column.

`LEFT_SQL` recognises three ways to leave. One is a recorded fact —
`transferred_out`/`dropped`. Two are about a year
**beginning**: **no record for a school year that has started** — archived *or* active,
i.e. `NOT gap.is_upcoming` ("not enrolled" is the absence of a record, not a status, and
is a different thing from `dropped`) — and **`pending` when that year closed**. The test
is that the year has begun, not that it has ended: a learner with no record in the year
the school is running is not attending it, and an upcoming year's roster must not carry
them forward. `PREV_JOIN` exposes
`(NOT psy.is_active AND NOT psy.is_upcoming) AS closed` for the second; the first is a
`NOT EXISTS` over `school_years` strictly between `prev.label` and `$2` — the year on
screen never judges itself, or opening an archived year would empty its own roster.

**`COMPLETED_SQL` is separate, and stronger.** An `outcome` of `graduated` on `prev` also
drops a learner from later years, but it is not one of the ways above and is not part of
`has_left` or `left_count`. Graduating is not leaving — the learner finished — so
grouping the two put graduates under a toggle reading "Show learners who left", greyed
like a dropout. More to the point, `?include_left=true` exists so a returning learner can
be re-enrolled and there is nothing to re-enrol a graduate into, so the exclusion holds
**whatever that flag says**: `notCompleted` is pushed onto the roster's conditions
unconditionally, and both the status summary and `left_count` carry it too, or the badge
would promise rows the toggle cannot produce. It keeps the same `e.id IS NOT NULL` escape
as `notLeft` — a record for the year on screen always wins, because a learner invisible
here while still on class lists is worse than an odd-looking row — and it cannot reach
the graduation year itself, since `prev` is the most recent *earlier* record. Undoing a
mistaken graduation is `POST /promotion` with `outcome: null`, not a roster edit.

**`s.is_active` is not a condition on this roster.** It is a single global flag — "not on
the roll today" — and the roster asks a per-year question it cannot answer, since it
carries no year and is written by whichever activation last ran. Filtering on it let the
flag overrule the records it was derived from: a learner declared "Not enrolled" for a year
has no record for it, gets archived by the next activation as *"No enrolment record — SY
2025-2026"*, and was then hidden from SY 2025-2026 itself. Rows carry `is_archived` +
`archived_reason` instead, so the page marks them rather than dropping them.

**`JOINED_SQL` is the mirror image of `LEFT_SQL`**, and closes the same hole at the other
end of time. A roster that only asks who **left** lists everyone on every year the school
has ever run: a learner added today has one record, for the active year, and nothing
earlier — which `LEFT_SQL` correctly reads as "new, not absent" — but the same reasoning
ran backwards and put them on the roster of a year that closed before they existed, marked
**Not enrolled** as though someone had forgotten to enrol them. `prev` answers it too: a
record from an earlier year means they were already here. Its absence means either **no
records at all** (a learner from before enrolment history began — never hidden, exactly as
`LEFT_SQL` never hides them) or **records, but none earlier**, which is a joiner. Like
`COMPLETED_SQL` it is not lifted by `include_left`: that toggle exists to find someone who
left so they can be re-enrolled, and a learner added last week did not leave SY 2024-2025.

`LEFT_SQL`, `COMPLETED_SQL` and `JOINED_SQL` are the entire filter. All three are escaped by
`e.id IS NOT NULL`, so a record for the year on screen always wins, and all three judge from
the most recent record *earlier* than that year — which is what separates "was here, then a
gap" (listed, Not enrolled) from "had already left" or "was not here yet" (absent).

Because the fragments are written against the `s` alias and the activation's `UPDATE
students s … FROM (SELECT s2.id …)` cannot use it, `withStudentAlias(sql, alias)` re-points
them. It replaces **globally**; the call site used to fix up `PREV_JOIN` with a bare
`.replace()`, which rewrites only the first match, and `JOINED_SQL` is the second fragment
to mention `s.id`.

Because nothing else constrains the roster, `scopeConditions` starts empty and stays that
way for a super_admin — the outcome-summary query has no predicate at all — so every WHERE
is built through the `clause()` helper, which yields `''` rather than a bare `WHERE`.

Two boundaries, both easy to break: `prev.status IS NULL` short-circuits first so a
learner with **no earlier record at all** is never hidden — they are new, not absent —
and the gap window starts at `prev.label`, never at the beginning of time, or anyone
who joined after the school's first year would be branded as having left. Label
comparison is lexicographic on `'YYYY-YYYY'`, as everywhere else here.

Note the first of those is what makes `JOINED_SQL` a **separate** predicate rather than a
tweak to `LEFT_SQL`: "no earlier record" has to keep meaning "not absent" there, so the
distinction between a pre-history learner and a joiner is drawn by asking whether they have
**any** records at all, not by loosening the short-circuit.

- `GET /?sy_id=&grade_level=&section=&status=&q=` — the roster for one year.
  `section=none` means **unassigned**, the same sentinel `status` and `outcome` use.
  Both the filter and the sort go through `ROW_SECTION`, which is
  `CASE WHEN e.id IS NOT NULL THEN e.section ELSE s.section END` — **not**
  `COALESCE(e.section, s.section)`. NULL on an existing record is a fact, not a gap:
  it means "no section for this year", which is what every learner the promotion
  wizard places looks like. Coalescing hid them from the filter *and* reported them
  as being in a section belonging to the grade level they are leaving (a Grade 2
  placement showing "Makabayan", a Grade 1 section). The fallback is only sound with
  no record at all. `grade_level` needs no such care — a record cannot exist without
  one, so its COALESCE never actually falls back.
  **LEFT JOIN** on purpose: a learner with no record comes back `status: null`
  (filter with `status=none`) instead of vanishing — those are the rows the admin
  is there to fill. Rows carry both `current_*` (where the learner stands now) and
  the year's `grade_level`/`section`, which differ whenever enrolment runs ahead
  of activation. `summary` counts the caller's **whole scope**, not the filtered
  view, so status chips keep their numbers while one is selected. Each row also
  carries **`has_academic_records`** — whether the learner has grades, scores,
  competency ratings or attendance in this year — so the UI can grey out "Not
  enrolled" for the same rows the API would refuse to remove — and **`has_left`**,
  `NOT notLeft` (the exact expression `?include_left=true` suspends and `left_count`
  counts), so the rows the toggle reveals, the number on it and the rows the table
  greys out are one set. The client cannot derive it: two of the three ways to have
  left are about a *year closing* without the learner in it, which needs the gap
  check inside `LEFT_SQL`, not anything visible on the row. Graduates never reach
  the client at all on a later year, so no flag describes them.
- `GET /student/:id` — one learner's history, newest first. **Does not filter
  `is_active`**: preserving the record is the point of archiving rather than deleting, and
  this endpoint *is* that record, so refusing it for an archived learner denied the history
  exactly when it is the only thing left to read. Student Detail calls it on mount, so the
  404 also surfaced as a "Student not found" toast on a page that had already loaded the
  student. Grade scope is still enforced, on `students.grade_level` — for an archived
  learner the last grade they held, which is the right owner either way.
- `PUT /` — bulk upsert, `{ sy_id, entries[] }`, all-or-nothing. Grade scope is
  checked on **both** the target grade and the learner's current one, so a scoped
  admin can neither promote someone out of their scope nor reach into another's.
  Sections are validated with `utils/sections.js`. **If the target year is active
  it also writes the `students` row immediately** — there is no later activation
  to pick the change up.
- `DELETE /?sy_id=&student_id=` — the single-learner path (wired to no UI yet).

**What blocks a removal is what is attached to it, not the year's status.** The active
year used to refuse removals outright, on the grounds that the record is what holds the
learner in their class. It no longer does: the mirror is reconciled instead — deleting the
**active** year's record sets `students.enrollment_status='pending'`, the same answer
`rolloverStudents()` gives anyone without a record, so the learner cannot keep an
`enrolled` standing with nothing behind it. Both `PUT /` and `DELETE /` do this.

Two guards took its place, both **absolute** — unlike the archived gate there is no flag
to override either. They run **after** the role check: a scoped admin is refused for being
a scoped admin, before the record is even inspected, because a data reason they could not
act on either way would only mislead.

- `assertNoOutcome()` — a record carrying a year-end verdict cannot be deleted. `outcome`
  is written by `POST /promotion` and by nothing else, so a deleted verdict only comes
  back by re-running the wizard for that year, itself gated once the year is archived.
- `assertNoAcademicRecords()` — nor can one whose learner has work recorded in that year.
  Deleting the row drops one row and nothing else (nothing in the schema references
  `student_enrollments`; `grades`, `student_scores`, `attendance` and `behavior_logs` all
  hang off `students`), which is exactly the problem: the work would stay attached to a
  learner the year no longer says was ever there.

`ACADEMIC_SQL` is the single definition of "has work in this year", used both by the
roster's `has_academic_records` flag and by the refusal, so the option the UI greys out
and the record the API protects cannot disagree. The four sources reach a school year by
four different routes — `grades.school_year` is a VARCHAR **label**; scores go
`student_scores → score_items → subjects.school_year_id`; and `ece_competency_records` and
`attendance` each carry a real `school_year_id`.

Attendance only got one in `2026_08_23_attendance_school_year.sql`. Before that it was
bounded by the year's `start_date`/`end_date`, which attributed **nothing**: consecutive
school years leave months uncovered between one year's end and the next one's start, and
every record in such a gap belonged to no year. `POST /api/attendance` now derives the
column from the subject it already requires — subjects are per-school-year, so the subject
is authoritative and the clock is not. A NULL means genuinely unattributable and counts
for no year. `behavior_logs` is deliberately excluded — an observation about a learner,
not work produced inside a year. It now carries a `school_year_id` of its own
(`2026_08_31_behavior_school_year.sql`, stamped from the active year on write, since it has
no subject to derive one from), but that is for reading a learner's history by year; it
still does not make an observation into work that blocks removing an enrolment record.

**Archived years are read-only unless the caller says otherwise.** `assertArchivedWritable()`
is the one gate, shared by `PUT /`, `DELETE /` and the promotion commit, and it has **two**
refusals because it has two kinds of caller. A scoped admin gets **403** — the unlock is a
`super_admin` capability, and telling them to "unlock the school year" would name a button
their page does not render. A super_admin who did not send `allow_archived: true` gets the
old **409**, which is still the real guard: the risk is a mis-picked year from a dropdown
that lists closed years like any other. `isArchivedYear` lives in `utils/schoolYear.js`,
mirrored in the dashboard's `components/SchoolYearPicker.jsx`; the flag is sent only by the
Enrollment page and the wizard after an admin has explicitly unlocked that year. What lives
in a closed year is the record of who actually attended, which is why both refusals exist.

This is deliberately **weaker** than the grading-model freeze in
`curriculum.routes.js`, which has no override: that one protects the
*interpretation* of grades already issued to parents, while an enrolment record is
a plain fact that can simply be wrong. A year also archives the instant the next
one is activated — exactly when year-end corrections are still arriving — so an
absolute lock would leave raw SQL as the only fix.

`POST /promotion` is gated too, but **on the year learners move into, not the closing
year** — `isArchivedYear(target) && !allow_archived` → 409. Writing an outcome onto an
already-archived closing year *is* the normal sequence: that is what closing last year
after activating this one does, and gating the source would break it. What rewrites
history is the other two writes, and both land on the target — the placement upsert
rewrites a closed year's `grade_level`/`section` (leaving `status` alone, so an archived
`enrolled` learner keeps that status under a changed grade), and a `graduated` decision
deletes the target row outright, the same act `DELETE /api/enrollment` already puts
behind the flag. In practice this fires exactly when both years are closed.

It also refuses an **upcoming** closing year (422, `syStatus(source) === 'upcoming'` —
the first backend consumer of `syStatus`). That one is not behind the unlock: a year
that has not started has no results to judge, so it is a category error rather than a
correction.

**`outcome: null` clears a decision.** Setting a verdict was the only thing the wizard
could originally do, so a wrong one could be overwritten but never taken back — and no
other surface can touch the column (`PUT /` 422s on an outcome, `DELETE /` 409s via
`assertNoOutcome`), which left an admin with no way out of a mis-click. A `null` outcome
now nulls `outcome`/`outcome_remarks` on the closing year, deletes the placement in the
target year (the `next_grade_level`-less branch already did this for graduates), and, when
the cleared verdict was `graduated` on the **active** closing year, restores
`students.enrollment_status` from the record's own `status` via `clampToManual()` — undoing
a graduation has to undo its mirror or the learner stays off every roster with nothing on
record saying why. `status` is otherwise untouched, as everywhere else here.

Two things guard it. `outcome` stays `.required()` and merely `.allow(null)`, so an
**absent** outcome is still a validation error rather than a silent erasure — that
distinction matters because a client bug once sent `undefined`. And `assertNoAcademicRecords`
runs against the **target** year first: deleting a placement for a learner who already has
work recorded there would orphan it, the same reason `DELETE /api/enrollment` carries that
guard. The response splits `closed` / `carried` / `cleared` and builds its message from
whichever are non-zero, so a run that only undoes a mistake does not claim to have closed
anything.

`POST /promotion` refuses `outcome: 'graduated'` for any learner whose source grade
level is not the exit grade (422, naming the levels involved). Graduating is the one
outcome that writes `students.enrollment_status` and removes the learner from every
later roster, so it is only available to someone finishing the last level the school
offers; the wizard disables the option as well. `isExitGrade` reads the same
`ALL_GRADES` ladder as the UI.

`GET /promotion-review` seeds `next_grade_level` from `placementForOutcome(rec.outcome,
grade_level)` when the learner has no committed placement — **not** from
`nextGradeLevel()` unconditionally, which is what it did before and which handed the
wizard a retained learner already placed in the next grade. `promoted_grade_level` /
`retained_grade_level` are sent alongside so the client can re-derive on every change
without another round trip; `already_placed` says whether `next_grade_level` is a
real decision or just this seed.

**The handover year is derived, never chosen.** `loadNextSchoolYear(source)` returns
the next `school_years` row by label, and `assertAdjacentYears()` makes both
`GET /promotion-review` and `POST /promotion` **409** on anything else. The wizard
used to default its target to the earliest *upcoming* year regardless of the source,
which stops being the next year the moment one is activated: re-running the wizard on
an older year then closed it into the year after next, so the outcome changed, a
fresh placement appeared two years out, and the placement in the year actually being
handed to was left behind still holding the superseded grade level. Skipping a year
is never legitimate — if the next year in sequence does not exist as a row, the year
after it *is* the adjacent row and passes.

`PATCH /api/students/:id/enrollment-status` (in `student.routes.js`) was the
single-learner path used by the Students page. **Nothing in the web app calls it any
more** — that page's badge is read-only for every role, because status is a per-year
fact and the page carries no year. The route is left in place, unchanged. It writes the mirror **and** the
active year's record in one transaction so they cannot drift. `POST /students`
and `POST /students/bulk` stamp an `enrolled` record for the active year, and
`PUT /students/:id` updates the active year's record whenever `grade_level` or
`section` changes — otherwise the record would still name the old class and the
next rollover would quietly undo the edit.

### Rollover on activation (`curriculum.routes.js`)

`rolloverStudents(client, schoolYearId)` runs inside the existing transaction in
`PUT /school-years/:id` when `is_active` goes true **and the row was not already
active**. Two statements: learners with a record adopt its grade/section/status;
everyone else is marked `'pending'` and keeps their grade so the admin can see
where they left off.

Two more statements bracket it, and the order inside the transaction is the design:

```
restoreReturningStudents(incomingId)   -- un-archive: has a record in the incoming year
rolloverStudents(incomingId)           -- backfill record sections, adopt, mark the rest pending
archiveDepartedStudents(incomingId, closing)
```

`rolloverStudents()` gained a statement in front of the adopt. The adopt does
`section = e.section`, NULL included, so a record that never got a section overwrote a
snapshot that had one — and re-activating an earlier year turned that into visible data
loss, wiping the section off every learner whose record for that year had none. The
backfill fills `student_enrollments.section` from `students.section` **only** where the
name matches a real `sections` row for that grade level and school year. Filling the record
rather than guarding the adopt is deliberate: the Enrollment page reads `e.section` through
`ROW_SECTION`, so a snapshot-only fix would have had Students and Enrollment disagreeing.
The `sections` check is what stops a Grade 1 section riding a promotion into Grade 2, so
"NULL on an existing record is a fact" still holds everywhere the wizard has just placed
someone.

The **pending** statement applies the same check in reverse: a learner with no record for
the incoming year keeps their grade level but has `students.section` **cleared unless it is
a real section of that year for that grade**. Otherwise a stale name survived into a year
that has no such section, and the Students page showed a class that does not exist. The
history is untouched — the section stays on the enrolment record for the year it belonged
to.

**Who gets restored is `BELONGS_TO_YEAR` from `utils/rosterSql.js`** — the very predicate
`GET /api/enrollment` filters its roster with, evaluated as of the incoming year. Sharing
one definition is the fix for the worst bug in this area: the restore used to take a
`rewinding` flag and bring back *every* system archive when reopening an earlier year, which
resurrected learners who had left in a year **before** it (reopening SY 2026-2027 revived
someone who dropped in SY 2025-2026, whom that year's roster correctly refuses to list). The
archive reason is never parsed; the records decide, and the roll matches the roster by
construction.

`restoreReturningStudents()` runs **first** because the adopt statement is gated on
`s.is_active = TRUE` — a learner still archived at that point would be restored holding a
stale grade level from whenever they left. `archiveDepartedStudents()` runs **last** so it
can overrule the `'pending'` the rollover just wrote for someone who has gone.

The restore is what makes activation reconcile in both directions. Without it the roll
could only ever shrink, so activating an **earlier** school year left everyone that later
years had filed away still archived — learners who plainly attended the year being
activated. `IN_INCOMING_YEAR` is the shared predicate: the archive requires it false, the
restore requires it true, so the two cannot fight. **Any** record satisfies it, not just
`pending`/`enrolled` — someone who dropped *during* the year now being activated is a fact
of that year and belongs on the Students page with a Dropped badge. It said
`status IN ('pending','enrolled')` for exactly that mistake.

The restore lifts **only system archives** (`archived_by IS NULL`). An admin who archived a
duplicate by hand judged the record, not which year is running, so activation must not
overturn it — that is what the NULL convention is for.

**`rewinding` (`closing.label > existing.label`) governs the archive only.** `closing` is
merely the previously-active year, so reopening an earlier one makes it a *later* year, and
archiving by it is backwards, so `archiveDepartedStudents()` is skipped entirely. The
restore needs no such flag — `BELONGS_TO_YEAR` already answers the question per year, in
both directions. `countDepartedStudents()` follows the same rule for the pre-flight, and the
readiness response carries `rewinding` so the panel can say which case it is describing.

`archiveDepartedStudents()` sets `is_active=FALSE` on every learner whose record in the
**closing** year was `dropped`, `transferred_out` or still `pending`, carried
`outcome='graduated'`, or **did not exist**, stamping `archived_at`, `archived_reason` naming
the cause and the year, and `archived_by = NULL`.

`pending` is on that list because `LEFT_SQL` already put it there: the roster counts a learner
left `pending` when their year closed as having left, so later years refuse to list them, and the
archive disagreeing left such a learner on the active roll for good — on the Students page, on no
roster that could explain it. Its reason reads *"Enrolment never confirmed — SY 2025-2026"*. It
reaches only learners nobody confirmed all year, since the incoming-year guard below spares anyone
the wizard has placed forward.

Two guards on it, both load-bearing. A learner with a record in the **incoming** year is
never archived — the promotion wizard writes exactly such a row for everyone it places, so
without this, activation would empty the roster the wizard had just filled. And the
**no-record** branch is skipped when the closing year holds no `student_enrollments` rows
at all: enrolment history starts at the year active when `2026_08_21_student_enrollments.sql`
ran, and on an earlier year that branch matches everybody.

`DEPARTED_FROM` is the archive predicate, written once and shared with
`countDepartedStudents()` so the pre-flight number and the write are the same set;
`countReturningStudents()` does the same for the restore. Response gains
`rollover: { adopted, pending, restored, archived }`.

Activation is **never blocked** — `GET /school-years/:id/enrollment-readiness`
(any admin) feeds the pre-flight panel instead. It answers **two** questions, not one:
is the incoming year ready to receive learners (`with_record` / `without_record`), and is
the outgoing one finished with (`closing_school_year` + `undecided_outcomes`), plus
`will_archive` / `will_restore` — how many learners come off the roll and how many come
back onto it, the biggest single effect of the click and the one the enrolment counts
cannot show. The second
matters because activating strands an undecided learner in a year that closes the moment
the new one starts, and only the promotion wizard can still judge them.

`countUndecidedOutcomes(syId, role)` counts records that are `status='enrolled'` with
`outcome IS NULL` — **enrolled only**, matching the wizard's own rule: a learner who
transferred out, dropped, or was never confirmed did not finish the year, so there is no
verdict for them to be missing. `loadClosingYear(incomingId)` is whichever year is active
now, excluding the incoming one. `PUT /school-years/:id` reads both **before** the
transaction — its first statement clears `is_active` everywhere else, after which nothing
identifies the year being closed — and returns them on `rollover`. The three separate
`SELECT … FROM school_years WHERE id=$1` reads in `PUT` were consolidated into one
`existing` fetch, which the rollover needs regardless of which fields were sent.

### Roster filtering

Only `enrollment_status = 'enrolled'` appears on a teacher's class list. Added to:
`score.routes.js` (both rosters), `crud.routes.js` (grades roster +
`teacherOwnsStudent`, which also gained the missing `is_active` check),
`ece.routes.js` (headcount + rating roster), `ai.routes.js` (bulk class-health
roster + scoped headcount), and FastAPI `dashboard.py` / `risk.py` /
`teacher_dashboard.py`. `GET /api/students` adds the predicate for the `teacher`
and `parent` roles and exposes `?enrollment_status=` plus a `by_status` breakdown
computed **before** that filter is applied.

`utils/enrollment.js` is pure (statuses, `mirrorStatus`, `nextGradeLevel`,
`isExitGrade`) and mirrored in `vista-dashboard/src/utils/enrollment.js`. It also carries
`NO_RECORD_STATUS` — "Not enrolled" as a described concept rather than an unlabelled
fallback in `statusLabel` — because it is a **different fact from `dropped`** (never
enrolled for the year at all, whether new or not returning, versus enrolled and then
stopped) and because that difference is what the has-left rule turns on.
`utils/sections.js` holds `assertSectionsExist`, extracted from the batch-upload
handler so both callers share one check.

### Year-end promotion

- `GET /promotion-review?sy_id=&target_sy_id=` — every learner **whose `status`
  is `enrolled`** in the closing year, the evidence behind them, and a recommended
  outcome. Everyone else is returned as `excluded` counts: they did not finish the
  year, so there is no outcome for them to have. Numeric
  grade levels are judged on `finalGradeFrom()` per subject against
  `resolveGradingPolicy().passingGrade`; descriptive ones on the latest period's
  rating distribution through `bandDistribution()` (by **rank**, never by letter —
  each record carries its own `rating_scale`). Which branch applies comes from
  `grade_level_assessment` for the **closing** year, not a hardcoded list.
  Rows already decided come back with their decision, so the wizard is resumable.
- `POST /promotion` — `{ sy_id, target_sy_id, decisions[] }`, one transaction.
  Per learner: write **`outcome`** on the closing year's record — its `status` is
  deliberately untouched, so the record keeps saying the learner was enrolled —
  and upsert a **`pending`** record in the target year for `promoted`/`retained`
  only. A graduate gets their target-year record **deleted**, so reversing an
  earlier decision cannot leave a stale placement behind. Scope is checked on the
  grade level being left and the one being entered. Only `graduated` mirrors to
  `students.enrollment_status`, and only while the closing year is active.

`recommendNumeric()` / `recommendDescriptive()` live in `utils/enrollment.js` and
are pure. They return `{ outcome, needsReview, reason }`, and **`outcome: null`
when there is nothing to judge** — a recommendation invented from no grades would
be worse than none. `needsReview` covers the DO 8 Table 10 middle case (1-2
learning areas below the passing grade requires passing remedial classes, which
VISTA does not record) and an `urgent` competency band.

`rolloverStudents()` copies `e.status` straight across now — it used to
re-implement `mirrorStatus()` in raw SQL, a second copy of a rule that had to stay
in step with the JS one. It also **skips learners who have left**: marking a
graduate or a transferred-out learner `pending` would quietly put them back on the
school's books every time a year is activated.

`PUT /students/:id` copies `students.enrollment_status` into a record, and that
column is one value wider — `clampToManual()` maps `graduated` back to `enrolled`,
which is what the learner was during the year itself.

## Sections (`curriculum.routes.js` + `utils/sections.js`)

**Nothing references a section by id.** Five tables hold it as a bare name string,
each scoped differently:

| Table | Scoped by |
|---|---|
| `students.section` | the active year only (it is the active year's snapshot) |
| `student_enrollments.section` | `school_year_id` |
| `teacher_assignments.section` | `school_year` **label** |
| `class_assignments.section` | `school_year` **label** (legacy, nothing reads it) |
| `score_items.section` | `subject_id` → `subjects.school_year_id` |

So a section is only meaningful alongside its grade level **and** its school year,
and renaming one is a fan-out write. `renameSectionEverywhere()` does it inside
the caller's transaction and reports what moved; `PUT /sections/:id` reports the
counts in its message. It also gained the duplicate check it never had.

**`assertSectionsExist()` matches without regard to case or inner spacing, and
rewrites the row in place to the stored spelling.** Validating and canonicalising
have to be one step here, not two: a section lives in five tables as a bare name
string, so "mabini" accepted leniently and then saved verbatim puts the learner
in a section no roster joins to and no rename will ever reach — worse than a
refusal. `loadSectionNames()` (was `loadSectionKeys`) therefore maps the
normalised `"<grade>|<name>"` to the **real** name rather than to a presence
flag. The batch upload is what needs this, its values being typed into Excel by
hand; the two `enrollment.routes.js` callers pass dropdown values, where it is a
no-op. The same reasoning covers `grade_level`: `canonicalGrade()` in
`student.routes.js` corrects it for every `/bulk` row **before** the scoped-admin
check, because an uncorrected "grade 1" told a scoped admin their own grade was
outside their scope, and for a super admin — whose scope is the whole ladder and
who is therefore refused by nothing — stored a grade level no query lists.
`gender` gets there through Joi instead: `.valid('Male','Female').insensitive()`
matches any casing and **converts** the value, so the schema stays the one place
the two legal values are written.

`sectionUsage()` counts dependents per table, scoped by grade level and year.
`DELETE /sections/:id` uses it and names what is blocking. The old guard counted
`students` **by name alone** — a Grade 6 "Mabuhay" could not be deleted while a
Kinder learner sat in a different section that happened to share the name.

Changing a section's `grade_level` is **refused** (409) once anything depends on
it. That is not a rename: the learners, teacher assignments and score items in it
belong to the old grade level and would become nonsense under a new one.

### Class adviser (`sections.adviser_id`)

The teacher responsible for a section as a whole, as opposed to the per-subject
rows in `teacher_assignments`. Two endpoints, both `authorizeAnyAdmin` +
`assertCurriculumRowInScope`:

- `PUT /sections/:id/adviser` — body `{ teacher_id }`, `null` clears it. 422 if the
  account is not an active teacher; **409 if that teacher already advises another
  section in the same school year**.
- `GET /sections/:id/adviser-candidates` — active teachers, each with
  `teaches_this_class` (a `teacher_assignments` row for this grade level + section
  + the year's **label**) and `advises` (the section they already hold, or null).

They are separate from `PUT /sections/:id` on purpose: that handler's contract is
name + grade level, with a rename fan-out, a usage-blocked grade move and a
`Nothing to update.` 400, and an orthogonal field tangles all three.

`idx_sections_adviser_sy_unique` is the actual guarantee — a partial unique index
on `(adviser_id, school_year_id) WHERE adviser_id IS NOT NULL AND is_active=TRUE`.
The pre-check exists only so the refusal can *name* the section holding the
teacher; it races, so a `23505` is mapped onto the same 409.

**The 409 and the candidates list both redact out-of-scope sections.** They name
the other section only when `canManageGrade` passes, else "another section" /
`{grade_level: null, name: null}` — an `admin_ece` refused on their own Kinder card
must not learn that the teacher advises Grade 5 — Sampaguita.

Three things that do **not** change, each of which looks like an omission:

- `sectionUsage()` does not count the adviser. It counts what a delete would
  *orphan*; the adviser is a pointer on the row being deleted. This is also why
  the index carries `is_active=TRUE` — a soft-deleted section must release its
  teacher, or they could never be reassigned.
- `renameSectionEverywhere()` gains no statement — the adviser is keyed by the
  section's id, not its name. `PUT /sections/:id` does re-read through
  `loadSectionRow()` so the response still carries it, because the Sections tab
  replaces its cached row wholesale.
- **Archived school years are not gated.** Renaming and deleting a section on a
  closed year are already ungated, unlike enrolment writes and the grading-model
  freeze, so the adviser follows the surface it lives on.

`POST /school-years` with `copy_from_id` copies sections **without** the adviser,
which is where this departs from the teacher-assignment copy alongside it. A
subject assignment is a timetable that repeats; an advisory is a fresh decision
each year, and a copied stale adviser would make the index block the correct one.

`loadAdvisory()` in `auth.routes.js` puts the teacher's own advisory on the
`/login` and `/me` payloads as `advisory`, scoped server-side to the **active**
year (unlike `assignments`, which returns every year and is filtered client-side).
It delegates to `advisorySections()` rather than repeating the query, so what the
client is told it advises and what the API will serve cannot drift.
`getStudentWithGuardians()` carries `adviser` too, as a correlated subquery rather
than a lateral — `json` has no equality operator, so a lateral's output cannot go
in that query's `GROUP BY s.id`.

## Advisory scope (`utils/advisory.js` + `advisory.routes.js`)

**The second source of teacher scope.** `teacher_assignments` answers "which
subjects does this teacher teach"; `sections.adviser_id` answers "which class is
this teacher responsible for". `utils/advisory.js` is the **only** place the
second is consulted — the first already exists in five inline shapes across five
routers and has drifted; do not add a sixth.

| Export | Use |
|---|---|
| `advisedStudentSql(p)` | an `EXISTS` fragment to OR into an existing WHERE; expects the students table aliased **`st`** |
| `advisorySections(id)` | the **active year's** sections a teacher advises (also backs the auth payload) |
| `advisoryHistory(id)` | **every** year they have advised, newest first — the record, for the Accounts page's assignment history |
| `assertAdvisorySection(req, id)` | 403 unless the caller advises that section in the active year — the guard on every advisory endpoint |
| `isAdviserOfStudent(t, s)` | boolean, for the behaviour branch |
| `activeSchoolYear()` / `advisoryClassList(sec)` | the year as id+label; the class list on the same predicate every other class list uses |

The active-year/all-years split is load-bearing. `advisorySections()` is pinned to
the active year because that is the only year an advisory **grants** anything;
`advisoryHistory()` grants nothing and is the one place the active-year scope must
not be reused, because history is exactly the thing it would hide.

**Both expose `sections.name` as `section`.** Every other table holding a section
spells it that way (`students.section`, `teacher_assignments.section`,
`student_enrollments.section`); `sections.name` is the outlier because it is the
row's own name column. Letting that spelling reach the payload meant an advisory
row and an assignment row beside it named the same thing two ways, and
comparisons read `v.name === student.section` — exactly where a reader trips.

**Keyed on `section_id`, not `(grade_level, section)`.** A `sections` row carries
its year as a UUID, so the guard is one lookup. The assignment-based filters
cannot: they join on `students.grade_level`/`section` — the *active-year
snapshot* — while narrowing records that span years, and
`teacher_assignments.school_year` is a label string.

### `/api/advisory` — read-only by construction

`authenticate` + `authorize(ROLES.TEACHER)`, and the router defines **no POST,
PUT or DELETE**. That is what makes read-only structural rather than a
convention. `GET /class-list` (section + assessment + subjects + learners),
`/grades` (cross-subject sheet), `/competency` (the descriptive equivalent),
`/attendance` (all subjects, with a per-subject breakdown), `/behavior` (every
teacher's logs).

`/competency` is its own endpoint rather than an adviser branch inside
`verifyEceAssignment()` — that helper gates `POST /records` as well as the two
reads, so widening it would hand the adviser a write.

`/grades` columns are the grade level's subjects **plus any subject the learners
actually hold a grade in this year**, the extras flagged `off_level`. A learner
moved mid-year has grades against another level's subjects within the same school
year; listing only the current level's silently drops them.

### The three widened reads (`crud.routes.js`)

Each ORs `advisedStudentSql` into an existing teacher filter, **bounded to the
active year** while the subject-teacher side stays unbounded — an advisory is a
one-year responsibility, not a claim on a learner's whole history.

- `GET /grades` — bounded by `g.school_year = <active label>` (that column is a label).
- `GET /attendance` — bounded by `a.school_year_id = <active id>`.
- `GET /behavior` — computes `owns` and `advises`; empty when neither. When
  `advises`, the clause becomes `(bl.teacher_id = $n OR bl.school_year_id = $m)`:
  their own logs from any year plus **every teacher's** for this year. The only
  read where a teacher sees another teacher's writing.

`GET /ai/class-health` keeps its 404 for a non-teaching adviser — that card is
explicitly "your signals across the subjects you teach", so there is nothing to
compute. `aiApi.classHealth` is marked `silent` on the client because that 404 is
now a routine state rather than an error.

## Grading structure

`grading_structure` uses self-ref `category_id` (NULL = category, non-NULL = component under that category).

- Category weights must sum to **100%**; component weights must sum to their parent category's weight.
- Negative percentage values are clamped to 0.
- Edits preserve existing UUIDs (update in place, not delete-and-recreate) so `score_items.component_id` FKs stay valid.
- Categories/components with recorded student scores cannot be deleted — backend blocks, frontend grays out.
- Grading structures are copied when creating a new SY with "copy from".

## Composite learning areas — MAPEH (`utils/subjectAreas.js`)

`subjects.parent_id` (`2026_09_06_subject_areas.sql`) makes a subject an **area** of
another (Music under MAPEH). NULL on every learning area, which is every subject
that existed before this. See the root `CLAUDE.md` for the model and why it lives
on `subjects` rather than as a third level in `grading_structure`.

`utils/subjectAreas.js` is the **only** place `parent_id` is consulted for the
roll-up. Do not re-inline it — subject scope is already written in five shapes
across five routers and has drifted more than once.

| Export | What it does |
|---|---|
| `MAPEH_AREAS` / `isMapeh(name)` | the fixed four, and the whole-word case-insensitive test |
| `ensureMapehAreas(client, subject)` | **the only writer of an area row** — see below |
| `areasOf(id)` / `parentOf(id)` | the two directions of the link |
| `assertGradeable(id)` | 409 naming the areas when a learning area has them |
| `rollUp(client, {...})` | recompute one learner's learning-area grade for one period |
| `rollUpAfterGradeWrite(client, {...})` | the same, resolved from the subject just written; a no-op for an ordinary subject |

**`ensureMapehAreas()` runs wherever a MAPEH can come into existence**:
`POST /subjects` (inside the insert's transaction, so a MAPEH is never briefly
flat), `PUT /subjects/:id` (a rename *to* MAPEH), and the copy-from-school-year
block (so a new year is right even if the year it copied from was not).
`2026_09_07_mapeh_areas.sql` is the same rule as a backfill. There is no endpoint
that accepts an area list — `POST /subjects` does not take `parent_id` — and none
that deletes one: `DELETE /subjects/:id` refuses an area outright and cascades the
whole family when given the learning area, with the grade check covering every
member (a mark under Music blocks deleting MAPEH).

It is idempotent and safe to call on any subject, and skips silently rather than
throwing, because a subject write must not fail on account of it. It fills in only
a MAPEH that has **no areas at all** — which is what keeps a rename safe: the next
call sees four and does nothing rather than deciding "Physical Education" is
missing and adding a fifth. It skips a MAPEH holding grades, score items or a
grading structure of its own, and skips entirely if any of the four names is taken
(by an active subject, or by a dormant one that still holds work).

`PUT /subjects/:id` therefore still accepts a rename of an area, though nothing in
the web app offers one — the Subjects tab lists MAPEH as a single row and the
grading modal's area picker only selects.

**Soft deletes are the subtle part.** `subjects_sy_grade_name_unique` does not
filter `is_active`, so a deleted MAPEH's areas keep owning their names and a plain
INSERT for the next one raises a 23505 that reaches the admin as "Record already
exists." A dormant row with no work behind it is revived and repointed instead of
duplicated. One that *does* carry work counts as taken — a deleted standalone
"Music" with grades must not be quietly adopted into MAPEH's average. The same
trap on the ordinary subject create now answers with a sentence naming it rather
than the raw constraint error.

There is deliberately **no** "the set of areas changed, re-roll everything"
helper. The set cannot change while grades exist, so the only roll-up that ever
runs is the one after a grade write.

**The roll-up is stored, not computed on read.** Both writers of `grades` call it:
`POST /api/scores` (after its own upsert) and `POST /api/grades`. A real row is
what lets everything that averages or counts learning areas keep working — what
each of those had to gain is `parent_id IS NULL`, so the areas are not counted
beside the parent. The sweep, in full:

- `enrollment.routes.js` promotion review — **the load-bearing one.** DO 8 Table 10
  counts learning areas below 75, so without it a learner weak in Music, Arts and
  PE reads as three failed learning areas and is auto-retained, when DepEd counts
  one — and passes, if the MAPEH average clears 75.
- `advisory.routes.js` `/grades` (both the rows and the column union) and
  `/class-list` — one MAPEH column, and a correct `general_average`.
- `ai.routes.js` class health (single + bulk) and the student-summary `AVG(grade)`
  that feeds the parent app's Overview card.
- FastAPI: `risk.py` (both academic-factor queries), `prediction.py`,
  `dashboard.py` decline alerts.
- `teacher_dashboard.py` goes the **other** way: score items live on the areas, so
  its `subj_lookup` expands a learning area into one `gradeable` entry per area for
  the score-entry progress widget. `assignments` stays on learning areas, because
  attendance is one roll for the whole of MAPEH.

`GET /api/grades` returns every row with `parent_subject_id` / `parent_subject_name`
so Student Detail and the parent app can nest the areas under their learning area
**and** average only the learning areas, without a second request.

`GET /api/grades/by-subject` does the same one level down. Asked for a learning
area that has areas it already returned `areas`; it now also returns
**`area_grades`** — `{ student_id: { area_id: { quarter: grade } } }` — so the
Grades page can show what the roll-up was averaged from beside the roll-up itself.
It is one extra query on a request that has already resolved the area ids and the
class's students; the alternative was four more round trips from the client, one
per area. Empty for every ordinary subject, so nothing else pays for it.

`GET /api/grades/class-record?grade_level=&section=&school_year=` is the whole class
at once — the Grades page's **All subjects** view. `authorize(SUPER_ADMIN, ADMIN_ELEM)`
plus `enforceGradeScope`, and a 400 for a grade level assessed descriptively that year.
It returns the same roster as `/by-subject` (so both views list the same learners),
`subjects` = the level's learning areas plus any learning area the learners hold a grade
in that year (`off_level`, the `/advisory/grades` rule; an off-level area whose MAPEH has
no roll-up yet still names its learning area), each carrying its `areas`, then
`grades` as `{ student_id: { subject_id: { period: grade } } }` for learning areas **and**
areas, and the section's `adviser_name`. Per-period grades rather than finals, so the
client derives finals and the general average with `finalGradeFrom()` and switches periods
without a request. Only learning-area columns feed that average; areas are for the
learner record's nested rows.

Two frontend surfaces read `/by-subject`'s `area_grades`, and both are read-only views of a **stored** grade:
the Grades page's roll-up Grade Summary, and Score Entry's roll-up tab — which is
also why Score Entry can show a MAPEH overview without a second endpoint. The
teacher check on this route resolves `COALESCE(p.name, s.name)`, so asking it for
MAPEH itself matches the single `MAPEH` row in `teacher_assignments` that the
teacher already holds.

**The refusals**, each a 409. Four reject a *learning area that has areas*, because
its grade is derived and it has no weights of its own: `POST /api/grades`,
`POST /api/scores`, `POST /api/scores/items` and
`PUT /api/curriculum/subjects/:id/grading` — all naming the areas to record under
instead. `POST /api/attendance` rejects the mirror image, an **area**, because the
roll is taken for MAPEH as a whole. And `DELETE /subjects/:id` rejects an area on
its own while cascading the whole family when given the learning area.

Residual, worth knowing: a hand-written `psql` UPDATE of `grades` will not roll up.
A trigger would be airtight, but `remarksFor` would need reimplementing in
PL/pgSQL — a third copy of a policy that already lives in two hand-synced files.

## Score entry (`score.routes.js`)

`verifyTeacherAssignment()` enforces assignment ownership on all score endpoints: GET/POST `/api/scores`, GET `/api/scores/breakdown`, GET/POST `/api/scores/items`.

**One teacher handles a whole learning area**, so an assignment names MAPEH and
never its areas. `verifyTeacherAssignment()` resolves `COALESCE(p.name, s.name)` —
when the subject being gated is an area, it matches on its parent's name. Holding
the MAPEH assignment therefore gates Music, Arts, PE and Health, with no extra
`teacher_assignments` rows. `GET /api/grades/by-subject` resolves the same way,
both for its own teacher check and for the "Subject Teacher" name it returns.

**Score items are scoped per section** — `score_items` has a `section` column; unique index `(component_id, quarter, section, name) WHERE is_active=TRUE`. All queries filter by `section`. A teacher with the same subject in two sections maintains fully independent items per section — adding/removing an item in one section does not affect the other.

- Items with recorded scores cannot be deleted; items without scores are hard-deleted.
- "Save items" accepts an empty list (removing the last item and saving is valid — the backend deletes items not in the payload).
- Migration: `vista-backend/database/migrations/2026_04_11_score_items_section.sql` adds the column and backfills from `student_scores → students.section`, with `teacher_assignments` fallback.

### Grading policy — per school year (`utils/grading.js`)

DepEd changed both the number of grading periods and the transmutation table, and
the transmutation table is **transitional**, so nothing here can be hardcoded:

| School year | `period_model` | `grading_policy` | Final grade |
|---|---|---|---|
| 2025-2026 and earlier | `4Q` | `DO8_2015` | DO 8, s. 2015 transmutation; remarks Passed/Failed |
| 2026-2027 | `3T` | `DO15_2026` | DO 015, s. 2026 adjusted table (IG 70.00 -> 75) |
| 2027-2028 onward | `3T` | `ZERO_BASED` | none — initial grade rounded to a whole number |

Both settings are columns on `school_years` (migration `2026_08_19_grading_policy.sql`,
defaults `4Q`/`DO8_2015` so archived years reproduce exactly what was issued).

`src/utils/grading.js` is canonical and is mirrored in
`vista-dashboard/src/utils/grading.js` — same convention as `utils/roles.js`. Every
call site goes through **`resolveGradingPolicy(schoolYearRow, gradeLevel)`**, which
returns `periods`, `periodCount`, `periodNoun`, `ordinals`, `sheetLabels`,
`transmute()`, `remarksFor()`, `descriptorFor()`, `passingGrade`, plus `label(p)` /
`abbr(p)` helpers. It also takes `gradeLevel` and a `grade_level_assessment` row and
returns `mode` / `isNumeric` / `isDescriptive` / `ratingScale` — see "Assessment mode"
below. A descriptive grade level never transmutes.

- `DO15_2026` is encoded as **41 explicit bands** (Annex D Table 4), not a closed
  form, so it can be diffed against the order. Anchors: `99.50-100.00 -> 100`,
  `70.00-71.17 -> 75`, `0.00-4.67 -> 60`.
- `grades.remarks` holds Passed/Failed under `DO8_2015` but the **DO 015 Table 11
  descriptors** (Advancing / Benchmarking / Connecting / Developing / Emerging) under
  the newer policies. Passing is still 75 in all of them.
- `finalGradeFrom(periodGrades)` averages the period grades and rounds to a whole
  number (DO 015 §52). Missing periods are skipped.
- `grades.score` = initial weighted average; `grades.grade` = final grade.

**The `quarter` columns are deliberately not renamed.** Three terms use periods 1-3,
a strict subset of 1-4, so the existing `CHECK (quarter BETWEEN 1 AND 4)` constraints
on `grades`, `score_items` and `ece_competency_records` still hold and were left
untouched. The per-year bound is enforced in the app (`assertPeriodInRange`), because
no single DB constraint can say "1-4 for archived years, 1-3 for current ones".

`POST /api/grades` derives `grade` and `remarks` server-side from the submitted
`score`; a client cannot supply a final grade directly. It previously wrote `grade`
verbatim with no validation, which bypassed transmutation entirely.

## Self-service Profile (`profile.routes.js` — `/api/profile`)

Any authenticated role. No token rotation after password change (existing JWTs stay valid). A parent who has forgotten their password uses the unauthenticated `/api/auth/password-reset/*` trio instead, which takes no current password and deliberately does **not** sign them in afterwards.

- `PUT /me` — updates `surname`, `first_name`, `middle_name`, `phone` (all required except middle_name; names run through `normaliseName()`). Returns the same shape as `GET /api/auth/me` including teacher `assignments` + `active_school_year`, plus the resolved `photo_url`.
- `PATCH /me/password` — `{currentPassword, newPassword}`. Verifies with `bcrypt.compare`, re-hashes with `bcrypt.genSalt(12)`. 401 `"Current password is incorrect."` on mismatch.
- `POST /me/photo` — multipart, single field `photo`. Uses `uploadProfilePhoto` (multer, 4 MB cap, jpeg/png/webp). Persists `users.photo_path` and unlinks the prior file. Response mirrors `PUT /me`. Returned `photo_url` is built by `photoUrlFromPath(req, photo_path)` so it resolves correctly from localhost, the LAN IP, and the Android emulator loopback (10.0.2.2). `GET /api/auth/me` and the login payload also expose `photo_url` so the parent app's session reflects the avatar without a refetch.

`email`, `role`, `is_active` are intentionally not editable here — email changes stay admin-only via `account.routes.js`.

## File uploads (`middleware/upload.middleware.js`)

`buildUploader(bucket)` returns a configured multer instance (disk storage, `<uuid>.<ext>` filenames, 4 MB cap, `image/jpeg|png|webp` MIME whitelist). Pre-built helpers: `uploadProfilePhoto`, and — for public content — `uploadAnnouncementImage` and `uploadFacilityPhotos`, which write to a staging `incoming/` bucket.

**Anything that will be published goes through `utils/imageProcess.js`** (`processImage(file, bucket, { maxWidth, thumbWidth })`). The multer file is the client's bytes under the client's claimed MIME type and still carries its EXIF, GPS included; sharp decoding it is the real type check (a renamed `.txt` is a 400), `.rotate()` applies EXIF orientation (phone photos otherwise render sideways), and re-encoding to JPEG writes no metadata at all. It always deletes its input. Profile photos predate it and are stored as uploaded. A `MulterError` (too large, too many files) now maps to a 400 in `errorHandler` rather than a 500. `/uploads` sends `Cross-Origin-Resource-Policy: cross-origin` so the landing page, a different origin, can display these photos past helmet's same-origin default.

Also exported: `photoUrlFromPath(req, relPath)` derives a public URL from a stored path; `unlinkUploadedFile(relPath)` is a best-effort cleanup that swallows `ENOENT` so a missing-on-disk record never blocks the user-facing operation. Everything under `uploads/` is gitignored — production deploys must mount a persistent volume there or migrate to object storage.

## Announcements (`announcement.routes.js` — `/api/announcements`)

All endpoints require auth. Writes are admin-only; create and update are **multipart**
(optional `image` field) and validated with Joi.

- `GET /` — admins see every live post plus drafts and scheduled ones (their own; everyone's
  for `super_admin`) so they can manage from it. Teachers and parents see only **live** posts
  (`published_at <= NOW()`, not expired) for their audience via `audiencesForRole()`. Pinned
  live posts first. Each row carries a derived `state` (`draft`/`scheduled`/`published`/
  `expired`, `STATE_SQL`), `image_url` and `posted_by_name`.
- `POST /`, `PUT /:id` — `status` is `draft` | `publish` | `schedule` (+ `publish_at`).
  Re-saving a live post keeps its `published_at`, so a typo fix does not float it back to the
  top as new. An image needs `image_consent: true`; `remove_image` clears one.
- `DELETE /:id` — soft (`is_active = FALSE`); notification rows still reference it.

**Who may do what** (`assertCanEdit`): `super_admin` edits or deletes any post, including one
left by an admin who has gone. Because the post goes on naming its author, every save stamps
`updated_by` (and `updated_at`), and **a save by anyone other than the author is recorded in
`announcement_edits`** (`2026_10_03_announcement_edits.sql`) by `recordEdit()`: the post's
editable fields before and after (`snapshotOf()` — title, content, category, audience, both
reaches, pin, derived state, published/expiry times, photo path), skipped when nothing
changed. The author's own saves are not recorded; they are not what the table answers.

`SELECT_SQL` carries the latest such edit (`last_edit_by_name`, `last_edit_at`) through a
lateral, so "Edited by …" survives the author re-saving afterwards, plus `updated_by` /
`updated_by_name` for edits made before the table existed. **Who** edited is shown to everyone
who can read the post; **what** changed is not. `present()` turns the lateral's editor ids into
**`can_view_edits`** (the caller is the author or one of the editors) and drops the list.

**Staff in the audience are notified automatically** (`syncStaffNotifications()`, run after
every create and update in the same transaction): `all` → teachers and every admin tier,
`teachers` → teachers, `admins` → admins, `parents` → nobody — parents are reached only by the
opt-in `notify_parents`, which also pushes. Type `announcement_posted`, once per post, never to
the actor or the author, and only for a post live or scheduled **in VISTA** (a website-only
post or a draft notifies nobody). A scheduled post has no moment at which code could run, so
its rows are written at save time with `sent_at` = the go-live time and **`GET
/api/notifications` hides rows whose `sent_at` is still ahead**. Pending rows are rewritten on
every save (a reschedule moves them; back to draft, out of VISTA or narrowed to parents removes
them) and deleted with the post; once any row has been delivered the post is never announced
again. `sent_at` is a `TIMESTAMP` without zone, so the comparisons are `LOCALTIMESTAMP` and
`::timestamp` in SQL — a JS `Date` bound into it is stored as UTC wall-clock and lands hours
off against the session's local time.

**The author is notified** (`notifyAuthor()`, a `notifications` row in the same transaction)
when someone else edits or deletes their post — type `announcement_edited` (only when
`recordEdit()` found a change; the body names what moved, via `changeSummary()`) or
`announcement_deleted` (the body says where it was removed from). `reference_id` is the post.
These types are deliberately distinct from `'announcement'`, which is what parents receive for
a new post, and the author's own edits and deletes notify nobody. There is no push: the
recipients are admins, who read the dashboard bell.

`GET /:id/edits` returns the diffs, newest first, **only to the post's author (every edit)
and to an editor (their own edits)** — anyone else gets an empty list, not a 403, so the
route cannot be used to learn whether a post was edited. `presentEdit()` reduces the photo
to `has_photo` + `photo_replaced`, since a replaced file is deleted and the path means
nothing to a client. Scoped admins edit only their own, and never a public one.
Only `super_admin` may set **`is_public`** (403), and never on an `admins`/`teachers` post
(422, and a table CHECK) — a staff-only notice must not reach the internet. **And only on their
own post** (`assertCanPublish`, 403): the super admin may correct an ECE or Elementary admin's
post inside VISTA but may not put it on the website, because that publishes someone else's
writing to the public under the school's name, to an audience its author never chose. Only the
false → true move is refused — a post already public stays editable, and taking one off the
website is allowed.

**Two places, one post.** `in_vista` (default `true`, so a client that never sends it behaves as
before) and `is_public` are independent reaches; `validate()` 422s a post with neither, matching
`announcements_reach_check`. A website-only post is public by definition, so the `is_public` 403
already keeps it the super admin's. When `in_vista` is false, `validate()` coerces a staff
audience to `'all'` (the public CHECK must still hold, and turning VISTA back on restores a
parent audience) and forces `notify_parents` off; `notifyParents()` also refuses a row with
`in_vista` false, so no other caller can notify about a post parents cannot open. `GET /`
filters by reach per role: `super_admin` gets everything; **scoped admins** get VISTA posts as
before **plus public posts that are live** (`is_public AND LIVE_SQL`) — read-only, since
`assertCanEdit()` already refuses them any public post, and never the super admin's website
drafts or scheduled posts; **teachers and parents** get `a.in_vista = TRUE` only, which is what
keeps a website-only post out of the parent app.
`messageFor()` names where the post went ("posted to the website", "updated on VISTA and the
website").

**`notify_parents`** (`notifyParents()`) inserts one `notifications` row
(`type 'announcement'`, `reference_id` = the post) per `role='parent'` user with
`account_status='active'`, and stamps `notified_at` in the same transaction; the FCM push
(`pushService.sendAnnouncement`, Android channel `vista_announcements`) runs **after** the
commit. It is a no-op unless the post reaches parents, is live now, and has never notified —
a scheduled post has no moment at which it could run, and notifying before a post is visible
would send parents to something they cannot open. So re-saving never pushes twice.

The notification and push body is `previewOf(content)` — the post's first 180 characters,
whitespace collapsed and cut at a word. There is no separate summary field:
`2026_10_01_remove_announcement_summary.sql` dropped it, because every reader already fell
back to the content and, where one was written, showed it again above the content.

## Facility gallery (`facility.routes.js` — `/api/facilities`)

`authenticate` + `authorizeSuperAdmin` on every route — the website is one office's voice.
`GET /` (hidden ones included), `POST /`, `PUT /order` (`{ ids }`), `PUT /:id` (name,
`is_active`; the slug is kept on rename), `DELETE /:id` (rows first, then files). Photos:
`POST /:id/photos` (multipart `photos`, up to 10, `consent: true` required — every file is
re-encoded before any row is written, so one bad file refuses the batch),
`PUT /:id/photos/order` (the first is the cover), `PUT /photos/:photoId` (caption),
`DELETE /photos/:photoId`. `scripts/seedFacilities.js` imports the landing page's bundled
gallery once (idempotent, skips existing slugs).

## Public content (`public.routes.js` — `/api/public`, NO AUTH)

**The only unauthenticated reads in the API.** `GET /announcements?limit=&offset=` (≤50; public,
live, active only; answers `{ announcements, total }` — `total` counts every live public post, so
the landing page's Announcements page can page with "Load more" and say "Showing 6 of 23", and
`a.id` ends the sort so pages are deterministic when two posts share a `published_at`)
and `GET /facilities` (active facilities with at least one photo). Kept narrow
on purpose: every column is listed by name — never `SELECT *`, which would publish whatever
the next migration adds — `posted_by` and anything about a user or learner never appear,
`publicReadPerIp` (300 / 15 min) runs in every environment, and responses carry
`Cache-Control: public, max-age=60`. The landing page's origin must be in `ALLOWED_ORIGINS`
(unset = any origin, which is only acceptable in development).

## Students (`crud.routes.js`, `student.routes.js`)

### "Not enrolled" on the list (`student.routes.js`)

`GET /api/students` returns **`status_display`** beside the stored `enrollment_status`:
`'none'` where the snapshot says `pending` and the learner has no `student_enrollments` row for
the **active** year, the stored value otherwise (`ACTIVE_SY_JOIN` + `STATUS_DISPLAY`, self-contained
so they need no bound params and can be dropped into all four queries). Only `pending` is
reinterpreted, because it is the only value `rolloverStudents()` invents — it writes `pending` both
for a learner with a pending record and for one with no record at all, so the Students page showed
the two as one badge. The status filter and `by_status` read the same expression, so badge, filter
and counts agree; with no active school year nothing is reinterpreted. The stored column is returned
untouched because `PATCH /:id/enrollment-status` writes it, though nothing calls that route any
more; a not-enrolled learner becomes a real Pending or Enrolled by being given a record on the
Enrollment page.

### Archive, not delete (`student.routes.js`)

There is no hard delete. `PATCH /:id/archive` `{ archived, reason? }` (`authorizeAnyAdmin`)
sets `is_active` either way, stamping `archived_at` / `archived_by` / `archived_reason` on
the way out and clearing all three on the way back — a restored row must not keep claiming
it was archived. `DELETE /:id` is kept as a thin alias delegating to the same handler,
since it always set the same flag; what it lacked was the return trip.

Everything that made removal a trap had to move at the same time:

- `GET /` takes `archived=false` (default) | `true` | `all` in place of the hardcoded
  `s.is_active=TRUE`, and returns `archived_count`. Teachers and parents are pinned to
  `false` regardless of what they send. Active/Archived is **its own axis**, not a status —
  an archived learner still carries the status they had — so the two filters stack, and
  `archived_count` is counted over the shared filters only while `by_status` is counted
  over the shared filters *plus* the archived clause. Both must survive being on the tab
  or filter they describe. `archived=all` can leave an admin with no clauses at all, hence
  the `clause()` helper — before this the hardcoded predicate guaranteed a non-empty WHERE.
- `getStudentWithGuardians(id, { includeArchived })` and
  `assertStudentInScope(req, id, { includeArchived })` both grew the flag for the same
  reason: they filtered on `is_active`, which is exactly the set the archive endpoints act
  on, so restoring 404'd on the scope check before reaching the handler. `GET /:id` passes
  it for admins only — the Archived tab links straight there, and an archived learner's
  grades have to stay readable or the archive preserves nothing.
- **Three LRN dead ends.** `students_lrn_key` is UNIQUE across the whole table, archived
  rows included, so an archived learner's LRN stays taken — correct, but "already exists"
  sent admins hunting for someone no list showed. `POST /` now names the holder and returns
  `archived_student_id` (via `AppError`'s new third `meta` argument, merged into the JSON
  body by `errorHandler`) so the client can offer Restore; `PUT /:id` drops its
  `AND is_active=TRUE`, which had only meant the clash surfaced as a raw 23505 instead of a
  message; and `POST /check-lrns` drops it too, so it stops disagreeing with `POST /bulk` —
  the preview used to pass an LRN the submit then rejected. It returns `{ existing, archived }`
  and `/bulk` splits its message the same way.

**History yes, live signals no.** Once a learner is archived, every endpoint splits on which
of the two it serves. Recorded facts stay readable — `GET /students/:id` (admins only;
teachers and parents still get 404), `GET /api/enrollment/student/:id`,
`GET /api/ece/student-records`, and grades / attendance / behaviour, which never filtered
`is_active`. **Live** signals are not served and are not meant to be: `/api/ai/class-health`,
`/api/ai/ece-class-health` and the FastAPI risk and prediction routes all compute from
rosters that deliberately exclude archived learners, so there is nothing to compute. Student
Detail skips those requests for an archived learner rather than firing calls that 404.

Defense-in-depth for teacher role:
- `GET /api/students/:id` strips `home_address` and per-guardian `email`/`phone`/`home_address` when `req.user.role === 'teacher'`.

### Batch upload (admin-only)

- `POST /api/students/check-lrns` — `authorize('admin')`. Body `{ lrns: string[] }`. Returns `{ existing: string[], archived: string[] }` — LRNs already in the `students` table (active or archived, matching `students_lrn_key`), and the archived subset of them. Used by the `BatchUploadModal` preview and by Add New Student's first step (`AddStudentWizard`) to catch a taken LRN before submit, telling an archived holder, who should be restored, apart from a live one.
- `POST /api/students/bulk` — `authorize('admin')`. Body `{ students: [...] }`, max 200 rows. All-or-nothing: checks in-payload LRN dedup, DB-wide LRN existence (`lrn = ANY($1::text[])`), and `(grade_level, section)` existence against active-SY `sections`; then inserts every row inside a single `withTransaction`. Names run through `normaliseName()`. Any validation failure throws `AppError` before insert; any mid-loop DB error triggers `ROLLBACK`.
  - Each student may carry **`guardians[]`** (max 10), built by the client from the template's Guardians sheet. `bulkGuardianSchema` has no `password` and no `link_parent_id` (the server resolves the account itself), and `stripUnknown` drops them if sent. It **does** have `invite`: a spreadsheet could never create a login while that meant carrying a password, and an invitation has none — so the sheet authorizes an address and the guardian still proves they control it before anything activates.
  - **The sheet may introduce a parent once and then refer to them by email alone.** A guardian row carrying the full set (`surname`, `first_name`, `phone`) claims that address for the file; any other row with only that email inherits name, middle name, phone and home address from it. `fileParents` is built **file-wide and order-independent**, so the detailed row may sit under any learner, and an address with a real account is never collected — the account outranks anything typed. `relationship` and `is_emergency_contact` are **never** inherited: they are facts about the learner, not the parent, exactly as on the linked-account path. The point is that a parent with three children is typed once instead of three times, with two of the three copies free to disagree. **The fill runs after the name-conflict check, never before** — and that check compares what each row *typed*, skipping rows that named nobody, because a sparse row inherits the very name it would be compared against and would therefore always agree with itself, silently swallowing a mistyped email.
  - **A row whose email belongs to a `parent` account is linked to it and needs only `relationship` and the emergency flag.** `findParentAccountsByEmail()` (case-insensitive; `home_address` is the latest one on any of that parent's `parent_student` rows, since `users` has none) resolves every email before the transaction, and the insert passes the account's id as `link_parent_id`, so `insertGuardian()` copies name, email and phone from the account. The server resolves the account itself and never trusts filled-in fields from the browser. A name typed beside a matched email must agree with the account (`guardianAccountMismatch()`), or the upload is refused with 422: a mistyped email that matches another family would otherwise give a stranger this learner in their parent app. Any other row needs `surname`, `first_name` and `phone` (PhoneInput's `+63 9XX XXXXXXX`). `is_emergency_contact` is required on every row. Blank `home_address` → the linked parent's address on file → the learner's.
  - `POST /api/students/check-parent-emails` (`authorizeAnyAdmin`) — `{ emails }` → `{ parents: [{ email, surname, first_name, middle_name, phone, home_address }] }`, the same lookup, so the preview can fill linked rows in. It exposes nothing `GET /parents/search` does not already show admins. One email twice on one learner is refused up front, since a matched account would otherwise trip `UNIQUE(parent_id, student_id)` as an anonymous 23505. The response message counts guardians and how many linked to an existing account; `insertGuardian()` returns the `parent_id` for exactly that.
- **Parent portal access goes through `grantParentAccess()`** in `utils/parentInvitations.js`, from Add Student, Manage Guardians → Add, Manage Guardians → Edit (on `invite`) and `POST /guardians/:guardianId/invitation`. It replaced `ensureParentAccount()`, which bcrypt-hashed a password the admin had typed; what it no longer does is accept a password from anyone but the parent. The email is looked up case-insensitively and a **non-parent** user is refused with 409 (the lookup once had no role filter, so a teacher's email made that teacher a parent of the learner). It does **not** reuse another guardian's parent account any more: every caller runs `refuseParentAccountEmail()` first (below), so from Add and Edit it only ever creates a new account, and from the invitation route it only ever acts on the guardian's **own** account. The sibling case is explicit linking (`link_parent_id`). `accessNote()` puts the outcome in the response message:

  | outcome | when |
  |---|---|
  | `invited` | new account, `password_hash NULL`, `account_status 'pending'`, fresh invitation |
  | `reissued` | the guardian's own pending (or revoked, never-activated) account; new invitation, any unused code cancelled |
  | `restored` | the guardian's own revoked account that still holds a password — switched back on, not re-invited, since they already proved they own the address |
  | `linked` | the guardian's own account is already **active**. Unreachable from the UI, which offers no grant on an active account; kept so a direct call answers truthfully |

- **`POST` / `DELETE /students/:id/guardians/:guardianId/invitation` are the only access writers**, deliberately separate from `PUT /guardians/:guardianId`, whose contract is the guardian's own details. Re-issuing or revoking is an access decision, not an edit to the person; folding them together is the mistake this router already made once, when the edit form silently dropped `create_account`. `DELETE` also counts the parent's **other** learners and says so — an account is one login for every child, so revoking is never scoped to the learner on screen.
- **The email stays editable only until the parent activates.** `PUT /guardians/:guardianId` refuses any change — clearing included — once the linked account **has a `password_hash`**, reading `(u.password_hash IS NOT NULL) AS has_password` beside the row. It used to test `account_status = 'active'`, which let an admin rewrite a revoked account's login the moment access was withdrawn, although that parent had already proved the address. Before activation it allows the change, cascading through `changeInvitationEmail()` to `users.email` and the live invitation and clearing any unused code: a mistyped address is the likeliest reason an invitation is never used.
- **`refuseParentAccountEmail(client, email)` is the one rule for a typed guardian email**: an address that belongs to a parent account is refused with a 409 ("This email already has a parent account. Link that account instead…", naming no one) on a separate guardian entry. It runs in `insertGuardian()`'s non-link path, `PUT /:id/guardians/:guardianId` (a contact-only row whose email changed, or on `invite`) and `POST /:id/guardians/:guardianId/invitation` (any parent account other than the row's own). Linking an account is **only** ever explicit — `link_parent_id`. An earlier version linked automatically when the typed surname and first name matched; that stored whatever phone and address were typed on this learner's entry while the account and its other learners kept theirs, forking the parent's record the moment a number differed. A real change to a parent's details goes through Edit, which reaches every learner on the account. `guardianAccountMismatch()` survives for the batch upload only, whose email column is its documented way to link. A linked row changing its email to one held by any other user is a 409 rather than a raw unique violation, and the staff refusal in `grantParentAccess()` reads "can't be used for parent portal access", not "belongs to a staff account".
- **`assertGuardianEmailFree(client, { studentId, email, surname, first_name, exceptRowId })`** is the other half of the rule, for an address with no account yet: a 409 when another guardian **of this learner** holds it, and a 409 when **any** guardian holds it under a different name (`sameName()`, trimmed and case-insensitive). The same address under the same name on another learner is one parent on each of their children and is allowed. It runs beside `refuseParentAccountEmail()` in `insertGuardian()`'s non-link path — which covers a create-student payload for free, since its guardians insert one after another in the same transaction — on any email change in `PUT /:id/guardians/:guardianId`, and on the `link_parent_id` path of `POST /:id/guardians`, where the account's address may already sit on a contact-only entry of that learner. Neither refusal names anyone.
- **`linkContactEntriesForAccount(client, userId)`** (`utils/parentInvitations.js`) runs at the end of every `grantParentAccess()` outcome: contact-only rows whose email and name match the account, on learners it does not already cover, are linked and **take the account's name, email and phone** — the same copy the explicit link path makes. The `NOT IN (SELECT student_id … WHERE parent_id = $1)` is load-bearing against `UNIQUE(parent_id, student_id)`. The count rides back on the outcome and `alsoLinkedNote()` puts it in the message, so a replaced phone number is never silent.
- **Bulk groups guardian rows by email.** Rows sharing an address under a different name **or a different phone number** are refused up front (422 naming both rows). The phone follows the name because the consequence is the same and quieter: the account is created from whichever row the loop reaches first, every later row of that address then takes the `link_parent_id` path — which copies the account's number — so a second, different number was discarded while the preview still displayed it. Each field is compared on what the rows **typed**, only where both sides said something (a sparse row inherits these very values, so comparing resolved ones would have it agree with itself), and the reference is tracked **per field**: a first row giving a name but no phone would otherwise leave two later, conflicting phones unchecked. `samePhone()` compares digits, so `0917 123 4567` and `+63 917 1234567` are one number. `invite` is read **per person, not per row**: a `Yes` anywhere in that email's rows invites once (`inviteFor()`), and the `accounts` map from `findParentAccountsByEmail()` is **extended with each account the file creates**, so every later row of that person takes the `link_parent_id` path. Before this, a sheet with one person on two learners and `invite` on either row failed the whole import on the address the row before it had just claimed.
- **`GET /students/parents`** (`authorizeAnyAdmin`) — the roster behind Account Management's **Parents** tab: every parent account with its `children` (each carrying `guardian_id`, the `parent_student` row the invitation routes are keyed on), its newest `invitation`, its resolved `access`, and **`has_password`** — which is what the panel's edit form keys `canChangeEmail()` on, the same test `PUT /guardians/:gid` applies (never `account_status`: a revoked account has still proved it owns its address). `/parents/search` beside it is a *picker* — it needs a query and caps at 10 — so the two are deliberately separate. **The state cannot be a WHERE clause**: it is derived (`utils/parentAccess.js`), so rows are resolved in JS and filtered after, which is also why paging is applied there. A school's parents number in the hundreds; if that stops being one cheap query the fix is *not* a cleverer filter but a stored state column, and that would mean two facts that can disagree — exactly what deriving avoids. `summary` is counted over the caller's whole scope **before** search and state narrow it, so the chips keep their numbers while one is selected. Grade scope: a parent is listed when **at least one** child is in scope, and the rest are reduced to an `other_children` count — the same redaction `presentStudent()` makes, and necessary for the same reason, since revoking is per account and reaches children the caller cannot see.
- **`POST /students/parents`** (`authorizeAnyAdmin`) — creates the account **and its children together**. `children` is `.min(1)` and the whole thing is one transaction: a `users` row with no `parent_student` row is a state nothing else in the app can express — the parent would sign in to an empty app, appear on no learner's record, and be hard-deleted by `DELETE /guardians/:guardianId`, which removes a parent left with no learners (`student.routes.js`, the remaining-children count). `enforceGradeScope` runs **per child**, since attaching one is a write on that learner. The first child goes down `insertGuardian()`'s non-link path — which runs `refuseParentAccountEmail()` and `assertGuardianEmailFree()` first, so a taken address is refused here with the same wording every other surface uses — and the rest pass `link_parent_id` so the account supplies their name, email and phone. **`invite` is not a parameter**: an account exists only because an email was authorized, so creating one without inviting would ask for a row the model has no state for.
- **`POST /guardian-email-check`** (`authorizeAnyAdmin`) — `{ email, surname, first_name, student_id? }` → `{ status }`: `available`, `restricted`, `parent_account` (with `account`, for the form's **Link that account instead**), `already_guardian` (nothing left to link), `duplicate_on_learner` or `name_conflict` — the last two mirroring `assertGuardianEmailFree()`. The early check behind the email field in Manage Guardians and the Add Student wizard; it mirrors `refuseParentAccountEmail()`, so names are not compared and do not change the answer. Returning `account` discloses nothing an admin could not already get by searching the email under "Already has a parent account". `GET /parents/search` and `POST /check-parent-emails` return names by design — the explicit account lookup, and the batch-upload fill-in.
- **A linked guardian's details are the parent's, not the learner's.** `PUT /:id/guardians/:guardianId` splits the fields: `SHARED` (surname, first_name, middle_name, phone, home_address, plus email when `changeInvitationEmail()` moved it) is written to every `parent_student` row with that `parent_id` and, for the name parts and phone, to `users`; `PER_LEARNER` (relationship, is_emergency_contact) stays on the one row. A contact-only guardian (no `parent_id`) is one row and behaves as before. The response counts the other learners reached. This deliberately crosses grade scope: a scoped admin's correction to a parent's number reaches that parent's sibling in another grade level, because it is the same person — what they may *not* see is that sibling's name. `profile.routes.js` `PUT /me` does the same for a parent editing themself.
- **`other_learners` on each guardian** (from `getStudentWithGuardians()`) lists the account's other learners, so the edit form can say whose records a save reaches. `presentStudent(student, role)` removes it for teachers and parents — a parent must not learn the names of the other parent's children — and reduces out-of-scope siblings to `{ out_of_scope: true }` for scoped admins. Every route that returns the guardian payload goes through it.
- **`POST /:id/guardians` accepts `link_parent_id`**, for Manage Guardians' "Already has a parent account". The route refuses a parent who is already a guardian of this learner with a 409 naming the email — the link insert is `ON CONFLICT DO NOTHING`, so without the check a duplicate answered "Guardian added." while adding nothing — and appends what the link means for that account's `account_status`. `GET /parents/search` now returns `account_status`, and with `?student_id=` an `already_linked` flag, so the picker can disable that row instead of offering it.
- **`insertGuardian()` links only a `role='parent'` account, and refuses anything else with 422.** It used to look the id up without a role filter and, when nothing matched, fall through to the plain insert with `parentId` still set to the supplied id — so any user's id, a teacher's or an admin's, could be attached as a learner's parent. That reached every caller that passes `link_parent_id`: Add Student, Manage Guardians, and the bulk upload (which only ever passes resolved parent ids, so it was never exercised there).
- **Nothing detaches an account from a guardian row.** `parent_student.parent_id` is set by linking and cleared only by `DELETE /guardians/:guardianId`, which removes the row (and hard-deletes an unlinked parent). A `DELETE /:id/guardians/:guardianId/account` existed briefly as "Remove app account link" and was removed: it left a contact-only row still holding the account's email, which `refuseParentAccountEmail()` forbids everywhere else, so that row could not be saved again until the email was cleared. Withdrawing app access is `DELETE /guardians/:guardianId/invitation`; a wrong person is removed and re-added. `utils/parentAccess.js` has `canChangeEmail({ hasAccount, hasPassword })`, and `canInvite()` is everything but `active` (re-issuing a pending invitation restarts its 30 days).
- **`bulkGuardianSchema` gained `invite`.** The sheet could never create logins before because that meant plain-text passwords in a file that gets emailed around; an invitation has no password, so this is now the one path where a spreadsheet may grant access. `create_account` and `password` are explicitly `Joi.any().strip()` on every guardian schema, so an older client that still posts a password has it discarded in one visible place rather than silently by `stripUnknown`.
- **Edit used to lose the account request.** `updateGuardianSchema` had no `create_account` or `password`, so `stripUnknown` dropped them: the edit saved, answered "Guardian updated.", and never created a login. `PUT /:id/guardians/:guardianId` runs in a transaction. The flag is now `invite`; when set it refuses a row that already has a `parent_id` (pointing at Reissue / Revoke instead), checks the email the row will hold after this save, refuses an account already linked to another guardian row of the same learner (`UNIQUE(parent_id, student_id)`), then sets `parent_id`.
- `portalAccountShape()` / `portalEmail` are shared by all three guardian schemas: a ticked `invite` **requires** an email, and that is the whole of it — there is no password to validate. `insertGuardian()` takes a fourth argument, the acting admin's id, stamped on the invitation so the UI can say who authorized the address.

Attendance: `GET /api/attendance` joins `subjects` so `subject_name` is available and `school_years` so `school_year` (the label) is too — the row carried `school_year_id` but never its label, so anything grouping by year had to resolve it separately; Student Detail's Attendance tab groups on it. It takes optional `start_date`/`end_date` and an optional **`sy_id`**; with none of them it returns every record the learner ever had, which is what Student Detail and the parent app rely on — the filters are opt-in, so adding `sy_id` changed no existing caller. `POST /api/attendance` is teacher-only, requires `subject_id`, and upserts on `(student_id, date, subject_id)` — re-saving only updates this teacher's records. It stamps **`school_year_id` from the subject** (`(SELECT school_year_id FROM subjects WHERE id = $6)`, inline so the upsert stays one statement): subjects are per-school-year, so the subject is authoritative and the date is not. `GET /api/attendance` is open to admin + teacher (student detail page uses it).
