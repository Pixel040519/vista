# React Dashboard — CLAUDE.md

Vite + React on port 5173. Dev server proxies `/api/*` to `http://localhost:5000`, so the frontend always calls relative `/api/` paths.

## File layout (`src/`)

- `main.jsx` — Router setup, AuthContext provider.
- `api/client.js` — Axios instance with JWT interceptors. Exports `aiApi` (`teacherDashboard`, `classHealth`, `classHealthAll`, `eceClassHealth`), `studentApi`, `behaviorApi`, `curriculumApi`, `scoreApi`, `eceApi` (skill CRUD, record flows, `getSummary`), `profileApi` (`updateMe`, `changePassword`).
- `pages/` — one component per route. `Dashboard.jsx` is a thin role router (~10 lines) that branches on `user.role` and renders `pages/dashboard/AdminDashboard.jsx` or `pages/dashboard/TeacherDashboard.jsx`.
- `components/` — shared UI (`GradingConfigModal.jsx` for per-subject grading structure, `AttendanceDetailModal.jsx` for dashboard drill-down, etc.).
- Routes: `/login`, `/` (dashboard), `/students`, `/students/:id`, `/attendance`, `/grades`, `/score-entry`, `/behavior`, `/securepass`, `/risk`, `/announcements`, `/profile`, `/ece-competency`.

The `BrowserRouter` in both `App.jsx` and `main.jsx` has `v7_startTransition` and `v7_relativeSplatPath` future flags enabled.

## AuthContext

`/api/auth/me` and `/api/auth/login` return `assignments` (grade_level, section, subject, school_year) and `active_school_year` for teachers. `AuthContext` exposes `activeAssignments` — assignments filtered to the active SY — and `updateUser(patch)` which the Profile page calls after save so the sidebar name/initials update immediately without a reload.

`AuthContext` also exposes **`refreshUser()`** (re-fetches `/me` and replaces the cached user)
and **`syncActiveSchoolYear(label)`**, which calls it only when the label handed to it differs
from the cached `active_school_year`. The auth payload snapshots the active year — its label,
`period_model` and `grading_policy` — and nothing in a session invalidated that, so activating
a different year (or renaming the active one) left every reader stale until a browser reload.
`CurriculumManagement`'s `fetchSchoolYears()` hands it the active label; that page is the only
place the active year can change and it re-fetches after every one of its mutations, so one call
site covers the lot. The comparison reads a `userRef`, not a closure — a closure would compare
against whichever user was captured when the callback was made, so switching A→B→A would stop
refreshing on the second switch. The stale-payload bug this fixes was visible in Accounts → Edit
Teacher, whose "Copy assignments from a previous school year" list filters out the active year
and so hid the very year the admin had just closed.

For teachers `AuthContext` also exposes **`advisory`** — the sections they are class
adviser of. Unlike `activeAssignments` it needs no filtering memo: `/login` and `/me`
already scope it to the active school year, because an advisory is a now-fact and no
surface asks for last year's.

`AuthContext` also exposes role helpers derived from `utils/roles.js`: `isSuperAdmin`, `isAnyAdmin`, `isScopedAdmin`, `isTeacher`, `isParent`, and `gradeScope` (array of grade levels the current user may touch — sourced from `user.grade_scope` which the `/login` and `/me` responses include).

## Roles (`utils/roles.js`)

Mirror of the backend module — same constants and helpers (`ROLES`, `ANY_ADMIN`, `SCOPED_ADMINS`, `gradeScopeForRole`, `isAnyAdmin`, `isSuperAdmin`, `isScopedAdmin`, `canManageGrade`) plus `ROLE_LABELS` for UI display ("Super Admin", "ECE Admin", "Elementary Admin", "Teacher", "Parent / Guardian"). Role routes via `PrivateRoute roles={...}` in `App.jsx` use these constants, e.g. `roles={ANY_ADMIN}`, `roles={[ROLES.SUPER_ADMIN, ROLES.ADMIN_ECE, ROLES.TEACHER]}` for ECE Competency.

## Branding

School logo `src/assets/NRYS_logo.png` imported as `nrysLogo`. Used in the Sidebar header and the Login page. Sidebar logo uses explicit `width`/`height` attrs + inline `objectFit`/`display` styles (Chrome rendering fix). The brand accent palette is `brand` (Tailwind) — a muted navy-blue scale (`#2b4f9e` at 500) matching the school colors; the deeper `navy` scale remains the chrome (sidebar + login background). Login page (`pages/Login.jsx`) is a single centered card on the navy-950 background (dot grid + brand-blue radial glow + soft gradient overlay) — the previous two-column split was retired. Same layout serves desktop and mobile (no `lg:hidden` mobile branch). Card contains: bare 120×120 NRYS logo (no white wrapper/ring — image renders directly with `object-contain`), "Northern Rizal Yorklin School" heading, brand-blue "VISTA" wordmark with accent rules, then the email/password form. Failed logins surface as inline red helper text above the Sign In button (cleared on next keystroke); the toast on `catch` was removed to avoid duplicating the inline message. Successful logins still toast.

## Sidebar (`Sidebar.jsx`)

Two parallel `navGroups` arrays — `adminNavGroups` and `teacherNavGroups` — selected via `user?.role === ROLES.TEACHER ? teacherNavGroups : adminNavGroups`. Per-item `roles` filter still runs on top so cross-role items (SecurePass QR) keep working. Groups with no visible items auto-hide via `visibleItems.length === 0`.

- **Admin** (all three admin roles, 4 groups): Overview · Student Management (Students, Grades, ECE Competency, Behavior) · Tools (SecurePass, Risk Overview, Announcements) · Administration (Accounts, Curriculum). ECE Competency is hidden from `admin_elem` via per-item `roles: [ROLES.SUPER_ADMIN, ROLES.ADMIN_ECE]`; **Grades** is hidden from `admin_ece` via `roles: [ROLES.SUPER_ADMIN, ROLES.ADMIN_ELEM]` (the mirror — ECE tracks learning via ECE Competency, not the grades table). `/grades` route in `App.jsx` is also wrapped in a `PrivateRoute` excluding `admin_ece`. Lists within each page (Students, Risk Overview, etc.) are server-filtered by the caller's `gradeScopeForRole`, so scoped admins never see out-of-scope rows.
- **Teacher** (4 groups): Overview (Dashboard) · Today's Work (Attendance, Score Entry, ECE Competency — promoted to the top group so daily surfaces are one click away) · My Students (Students, Behavior, Risk Overview) · Communication (Announcements). Grades is admin-only (teachers view/enter grades via Score Entry). ECE Competency is safe for all teachers — the page renders an empty state if no Kinder assignments.

**Super-admin-only gates** (not enforced at sidebar level, gated inside the page): the Curriculum page hides "Create New School Year" inside `SYSelector` and the SY edit pencil for non-super-admins, and the Subjects + Sections tabs only render grade-level cards for grades in the caller's `gradeScope` (super_admin sees all seven; `admin_ece` sees Kinder; `admin_elem` sees Grade 1–6). The Accounts page shows a `Teachers`/`Admins` tab bar only to super_admin (scoped admins see the teacher table directly with no tabs); the Admins tab mirrors the Teachers tab — search-by-name/email + All/Active/Inactive pill filter + `accountApi.listAdmins({ search, is_active })` with a 300 ms debounce. Each inactive (non-super_admin) admin row shows a Reactivate (`ShieldCheck`) button that PUTs `is_active: true`; the Deactivate (`Trash2`) button hides while the row is inactive so the two actions don't overlap.

**User footer**: avatar + name/role is a `NavLink` to `/profile` (active state `bg-white/10`; mobile triggers `onClose` via `handleNavClick`). `LogOut` icon opens a confirmation `Modal` (`title="Sign out?"`, size `sm`); "Sign out" button is red (`!bg-red-600 hover:!bg-red-700`) to override `btn-primary`. Reason: prevent accidental logouts from the always-visible sidebar button.

## Responsive layout

- Sidebar hidden on mobile (`-translate-x-full`); slides in via Topbar hamburger; always visible on `lg:` (1024px+).
- `Layout.jsx` applies `lg:ml-64`. Main content wrapper uses `min-w-0` to prevent long text from overflowing. Sidebar open/close state lives in Layout and is passed as `open` / `onClose` props.
- Topbar `Menu` icon is `lg:hidden` and triggers `onMenuToggle`.
- Mobile-first Tailwind: base for mobile, then `sm:` (640), `md:` (768), `lg:` (1024). Page titles `text-xl sm:text-2xl`; subtitles `text-xs sm:text-sm`. Page headers use `flex-wrap gap-3` so actions wrap below the title on small screens. Form grids in modals prefer `grid-cols-1 sm:grid-cols-2` over hard `grid-cols-2`.

## Modal (Portal)

`Modal` (`components/UI/index.jsx`) renders via `createPortal` into `document.body` — always above the sidebar regardless of stacking context. On mobile slides up from the bottom (`items-end`, `rounded-b-none`); on `sm:` and above it centers.

## Tables

All `table-base` tables must be wrapped in `<div className="overflow-x-auto">` for horizontal scroll on narrow screens. Header cells use `whitespace-nowrap` to prevent awkward wrapping.

## Input / cursor conventions

- Body has `select-none` and `cursor-default` globally. Text-type `input`/`textarea` re-enable `user-select: text` and `cursor: text`. `checkbox`/`radio` use `cursor: pointer`; `select` uses `cursor: pointer`. Reason: prevents the text caret on non-interactive elements like titles, headers, hints.
- All input fields blur on Enter (`onKeyDown`) for consistent UX.
- Drag-and-drop reordering (HTML5 DnD + grip handle) is used in the grading config modal (categories), score items modal (items), and ECE Competency (subject cards).

## Per-page notes

### Attendance
**Save is a sticky bar at the bottom of the page**, not a header button — `fixed bottom-0 left-0
lg:left-64 right-0`, the same pattern as Enrollment and the promotion wizard, with the page root
carrying `pb-24` so the last row clears it. It appears only when marks differ from what was
loaded and names the context ("7 unsaved marks · Grade 3 — Mabini · Math · 2026-08-30"), with a
Discard beside Save. The count comes from diffing `records` against a `loaded` baseline that
`resetRecords()` moves in step at every load or clear, so only a teacher's click can separate
them; a successful save re-baselines on what was submitted. The date picker stays in the header —
it filters rather than acts. Note `POST /api/attendance` only upserts, so *clearing* a mark
counts as an unsaved change but does not delete the server row.

Teacher sees Class dropdown (assigned sections) + Subject dropdown (filtered to the teacher's assignments for that class, auto-selected if only one) + date picker. Attendance is scoped per subject. Subject names → UUIDs via `curriculumApi.getSubjects`. Changing date/subject loads existing records via `GET /api/attendance/bulk` with `subject_id` and auto-selects saved statuses. Clicking an already-selected status deselects it.

### Dashboard attendance stats
"Present Today" counts students whose best status is Present or Late (attended at least one subject). "Absent Today" counts students absent in all logged subjects. Both cards are clickable — `StatCard` accepts an optional `onClick` — and open `AttendanceDetailModal` with Present/Absent tabs. Modal fetches `GET /api/attendance/daily-detail?date=`, groups students by Grade Level → Section (both collapsible, sections collapsed by default). Each row shows per-subject status badges (P/L/E/A). Students present in some subjects but absent in others get a "Possible skipping class" amber badge.

### Students page
Teachers: Class dropdown + search with labels; Grade Level and Section columns hidden (redundant). Admin: grade/section filter dropdowns — the grade list is scoped to the caller's `gradeScope` (super_admin sees all seven; `admin_ece` sees Kinder; `admin_elem` sees Grade 1–6). The Add/Edit Student modal's grade `<select>` uses the same scoped list so scoped admins can't pick an out-of-scope grade (the backend would reject it anyway via `enforceGradeScope`).

**Batch Upload** (admin-only, `components/BatchUploadModal.jsx`) — secondary button in the header next to "Add Student". Opens a modal with a "Download template" action and a drag-and-drop file zone. Template is `.xlsx` (not `.csv`) because Excel coerces 12-digit LRNs to scientific notation in CSVs; the LRN column is pre-seeded as Text format (`z: '@'`, `s: { numFmt: '@' }`) for rows 2–201 so typed LRNs stay as strings. Uploads accept both `.xlsx` (parsed via `xlsx-js-style`, dynamically imported) and `.csv` (parsed via `papaparse`). Preview table validates each row client-side: LRN shape (12 digits), required fields, gender/grade whitelist, in-file duplicate LRNs, and `(grade_level, section)` existence via `curriculumApi.getSections()` fetched on modal open. `expandSciNotation()` expands any `1.23457E+11` values for display, but those rows are still blocked with a red error because Excel has already lost precision (zeros are real, not a display bug); an amber banner explains why. Before enabling submit, the modal calls `studentApi.checkLrns()` to merge DB-existing LRNs into the per-row error map. Submit posts to `studentApi.bulk()`; on success toasts `N students added.` and calls `onSuccess` to refetch the list.

### Risk Overview (`pages.jsx` `RiskOverview`)
Open to admin + teacher (route `roles={['admin','teacher']}`).

- **Admin** — calls `/api/ai/risk-all`. The FastAPI `/classify/risk/all` behind it is now **live** (aggregates attendance/grades/behavior/ECE competency on each request instead of reading persisted `risk_assessments`), so every active student surfaces immediately without anyone having to trigger `POST /classify/risk`. Filter tabs (All / High Risk / Moderate Risk / Stable) sorted by `risk_score` desc. Columns: Student (linked to `/students/:id`), Grade & Section, Risk Level pill (color-coded), Risk Score (progress bar), Top Factor (ranked server-side by deficit across four factors: attendance / academic / behavioral / competency — competency populated for descriptively-assessed learners), Last Assessed (stamped per request, since the computation is live).
- **Teacher** — branches into `TeacherRiskOverview`, calls `aiApi.classHealthAll()`, renders a class-health-banded table (Urgent / Watch / On track / Not enough data) with per-row overall band pill, top-concern column, and three numeric mini-chips: **Academic / Competency** (non-ECE students show `avg_grade.toFixed(1)`; ECE students show `{completion*100}%` from `metrics.competency`), Attendance `%`, Behavior signed `avg_sentiment.toFixed(2)` — each tinted by its per-metric band. Reason: the legacy school-wide High/Moderate/Stable pills had misled teachers by mixing in other teachers' subjects/sessions/logs. ECE teachers previously saw every student as "Not enough data" because academic was always insufficient and attendance/behavior can be sparse — the competency tile fixes that.

Title/subtitle adapts for teachers ("...students in your assigned classes"). Empty state distinguishes "no data at all" from "no matches for current filter".

### Student Detail (`pages/StudentDetail.jsx`)
Teacher-aware. Teachers do **not** see the Home Address card or per-guardian email/phone/home_address rows (guardian names, relationship, emergency/pickup chips stay so teachers still know who can fetch a student). There is no Generate QR button on this page — SecurePass QR generation lives in the `vista_parent` mobile app (the web page previously exposed it to admins, but the flow is parent-initiated). **Attendance and Behavior are grouped School Year → Month → records**, both collapsible, most
recent first, with the latest year and its latest month open by default. The year comes from each
record's own `school_year` (the API resolves it from `school_year_id`), never from the date:
consecutive years can leave months uncovered between them and their ranges can overlap, so a date
names two years or none. Records with no year land in a `UNASSIGNED_SY` bucket ("No school year
recorded") pinned last, since sorting it by label would float it to the top. Attendance shows
P/L/E/A tallies on both header levels via the shared `AttendanceCounts`. On Behavior the sentiment
filter sits above the years and re-seeds the open year/month when a filter change leaves everything
collapsed. Attendance tab columns: Date · Status · **Subject** (`subject_name` from the GET join) · Recorded By (renders "You" when `isTeacher && a.recorded_by === user.id`; else `recorded_by_name`). Behavior tab applies the same self-identity pattern: teacher's own logs render with a teal `Pencil` avatar + "Logged by you"; other teachers' logs show the teacher's initial + full name.

**ECE branch** (`isECE` = student's grade_level ∈ {Kinder}):
- The **Grades** tab label renders as "Competencies" and swaps its body to an ECE view: a collapsible SY card (label from `eceApi.getRecords` response), a period selector from the school year's period model, and per-subject expandable rows that list each skill with its rating badge on the class's configured scale (or italic "Not rated"). **Not yet migrated to `ratingUi.js`** — this tab still renders E/G/F/NA colours directly, so it needs updating before a non-EGFNA level goes live. Skills come from `eceApi.getSkills({grade_level})` joined to `curriculumApi.getSubjects({grade_level})` by `subject_id`; the student's ratings come from `eceApi.getRecords({grade_level, section, quarter})` filtered client-side to the current student. SY header shows `{grading.abbr(n)} · {rated}/{total} rated` (`T2`, not `Q2`, on a three-term year); no overall distribution bar/legend.
- The **AI Insights** tab fetches `aiApi.eceClassHealth(id)` (both roles) and renders a three-tile card — **Competency** (latest-quarter rated/total label + E/G/F/NA distribution bar) with a **By subject** breakdown underneath: urgent/watch subjects render individually (rated/total + inline E/G/F/NA counters + band chip); insufficient and ok subjects each collapse into one expandable aggregate row (start collapsed; header shows count + comma-joined subject names + band chip; expanding reveals per-subject rated/total lines). **Attendance** (last-30-days) and **Behavior** (this-month) tiles each show just the label + band chip — the raw numeric values (rate %, avg sentiment, compPct) were removed from every metric row because the band chip alone communicates the state and the overall card header chip ("Competency & Class Signals" / "Competency Snapshot") already carries the overall band. For the same reason the Competency header has no row-level band chip (would duplicate the card header). DSS `suggestions[]` names the struggling subject per line. Grade-based `aiApi.predict` / `aiApi.risk` / `aiApi.classHealth` are skipped. DSS action type `'ece'` deep-links to `/ece-competency` via `runSuggestionAction`.

  The non-ECE teacher **In Your Class** card follows the same "band chip only" pattern — the previous `fmtGrade` / `fmtRate` / `fmtSent` big-number displays on the Academic/Attendance/Behavior rows were removed; each row ends with just its band chip.

### AdminDashboard (`pages/dashboard/AdminDashboard.jsx`)
Fetches `aiApi.dashboard()` for the bulk of its widgets (stat cards, attendance trend, risk pie, SecurePass oversight, behavioral sentiment bar, academic decline alerts, enrollment-by-grade bar).

**ECE Competency Overview card** (`AdminEceOverviewCard.jsx`) — school-wide ECE rollup, rendered as a full-width row between the Academic Decline row and Enrollment by Grade. Self-contained: fetches `eceApi.getSummary()` on mount (same Node endpoint as the teacher widget, admin branch returns `by_grade_level[]` aggregated across every ECE class in the active SY). Renders one row per **configured descriptive grade level** (resolved from config, not a fixed list) with completion %, progress bar (emerald ≥100 / amber >0 / slate 0), and a "{class_count} classes · {student_count} students · {rated_cells}/{total_cells} rated" sub-label (or "Not started" / "No classes assigned" variants). Below: **one stacked bar per rating scale** from `distributions[]`, each with its own legend — a year can mix scales. Empty state when no records exist yet. Its header line counts the levels it is actually rendering (`byGradeLevel.length`) rather than the literal "4 ECE levels" it used to claim — three of the four early-childhood levels were retired in Aug 2026, leaving only Kinder — and labels the period through `gradingFromAuth(user)`. `View` link goes to `/ece-competency`, which for admin is read-only (see that section).

### TeacherDashboard (`pages/dashboard/TeacherDashboard.jsx`)
Action-oriented. Fetches `aiApi.teacherDashboard()` AND `aiApi.classHealthAll()` in parallel via `Promise.allSettled`.

- **Needs Attention** stat card (was "At-Risk Students"), **My Classes** grid, and **Students to Watch** list all derive from the class-health payload. Band counts come from `chSummary.urgent/watch/ok/insufficient`. `mySectionsHealth` groups `classHealth.students` by `(grade_level, section)` and merges with `classHealth.scope.sections` for subject lists. `studentsToWatch` filters to urgent + watch and caps at 5 (rows link to Student Detail).
- Everything else (attendance rollup, today's action items, score-entry progress, recent behavior, sentiment mini) still comes from FastAPI `/teacher-dashboard/summary` proxy.
- **ECE Competency Tracker card** (`EceCompetencyCard.jsx`) — rendered when the teacher has any assignment in a grade level configured as descriptive. Self-contained: fetches `eceApi.getSummary()` (`GET /ece/summary`, Node API — not FastAPI) independently on mount. Shows per-class completion progress (rated cells / total cells with progress bar; emerald=100%, amber=partial, slate=0%) with "X / Y skills rated across N students" label, plus **one rating-distribution stacked bar per scale** in play (from `distributions[]`). The period auto-detects as the latest one with records and falls back to period 1; its label comes from `gradingFromAuth(user)`, so it reads `T1` on a three-term year. Links to `/ece-competency` via a View button.
- **Score Entry Progress widget** shows **one row per (subject, section)** — and for MAPEH, one row per **area** (`MAPEH — Music`), because that is where the score items live. Each row has its own Resume button calling `goToScoreEntry(sp.grade_level, sp.section, sp.subject_id, sp.latest_quarter)`. Handler writes `selectedClass`, `subjectId`, `quarter` into the `vista_score_entry_filters` sessionStorage blob (same key `ScoreEntry.jsx` reads via `usePersistedFilter`) so Score Entry mounts with class + subject + quarter preselected (falls back to Q1 if `latest_quarter` is null). It writes an **area** id into `subjectId` for MAPEH and does not set `areaId`; that is deliberate, since Score Entry promotes such an id to (learning area, area) on load — one place knows the mapping. Do not "fix" it here. React keys use `${subject_id}-${section}` to stay stable across multi-section duplicates. Refetches on `window` focus so adding items in another tab updates the count when the user tabs back.
- **Today's Action Items** "Take attendance" / "Review" buttons use `goToAttendance(gradeLevel, section, subjectId)` which passes the deep-link through **React Router location state** (`navigate('/attendance', { state: { deepLink: { selectedSection, selectedSubject, ts: Date.now() } } })`), **not** sessionStorage. The Attendance page reads `location.state.deepLink` in `useEffect([location.state])` and re-applies selection whenever a fresh `ts` arrives. Reason: React Router may keep Attendance mounted across repeat trips, so a mount-only read would miss the second click. `appliedDeepLinkTs` ensures each timestamp is applied once; the target subject is stashed in a `useRef` and consumed by the subject-load effect once the subject list arrives.

Split rationale: class-health is the single source of truth for teacher-scoped band numbers across Student Detail → Risk Overview → TeacherDashboard.

### Grading periods

Every page that shows grading periods (Score Entry, Grades, Student Detail, ECE Competency) derives them from the school year via `resolveGradingPolicy()` in `src/utils/grading.js` rather than a hardcoded `[1,2,3,4]`. Student Detail resolves the policy **per school year** because it renders several years at once and each can use a different model. Pages clear a persisted period that the selected year does not have.

**The label is as much a per-year fact as the count.** A `3T` year has terms, so it reads
`T1`/`T2`/`T3` and "this term" — never `Q1` and never "quarter". Render period names through
`grading.abbr(p)` / `grading.label(p)` / `grading.periodNoun`, never a literal `Q`, including
inside template literals and prose. Six places had the count right and the letter wrong, so a
three-term year showed "Q1 Q2 Q3" beside sheet columns correctly headed 1st/2nd/3rd: the Grade
Summary chips and empty state, both ECE dashboard cards, and two labels on Student Detail's ECE
insight card. Grep for `` Q{ ``, `` Q${ `` and the word "quarter" — the first pattern alone
misses the template-literal half.

**`gradingFromAuth(user)`** resolves the **active** year's policy with no request. `/auth/me`
and `/login` already snapshot that year's `period_model` and `grading_policy` onto the user, so
a surface that only ever shows the active year — the two ECE dashboard cards, a teacher's own
class-health signals — needs no `getSchoolYears()` call of its own. Anything that lets the user
*pick* a year must keep passing that year's row to `resolveGradingPolicy()` instead. The helper
exists so callers stop handing the whole `user` object to `resolveGradingPolicy` and relying on
it happening to read two matching keys.

### Assessment mode & rating scales

Whether a grade level is graded numerically or descriptively — and on which rating scale — is per (school year, grade level) configuration, fetched from `curriculumApi.getAssessmentConfig()`. `src/utils/grading.js` (the backend mirror) exports `resolveAssessment(gradeLevel, configRow)` and `RATING_SCALES`: `EGFNA`, `CODVBG` (DO 015 Kindergarten), `ABCDE` (DO 015 Grades 1-3).

- **`src/utils/ratingUi.js`** holds the colour mapping (`ratingOptions(scaleId)`, `RATING_COLOR_CLASSES`, `RATING_TINT_CLASSES`, `RATING_BAR_CLASSES`). It is deliberately **not** in `grading.js`, which tracks the backend module: the two keep the same policy logic and the same names for it, so a rule fixed on one side can be copied straight across. They are **not byte-identical** — one is CommonJS and one ESM, and the frontend copy carries UI-only additions the backend has no use for (`PERIOD_MODEL_OPTIONS`, `GRADING_POLICY_OPTIONS`, `gradingFromAuth`). Adding one of those is fine; changing a band table, a weight or a resolver on one side only is not. Class strings are written out in full rather than composed (`bg-${color}-500`) because Tailwind's JIT scans source text literally.
- **Never assume a rating's meaning from its letter.** `'E'` is Excellent on E/G/F/NA but Emerging — the *worst* level — on A-E. Always resolve through the scale.
- **Curriculum → Assessment tab** (`CurriculumManagement.jsx`, `AssessmentCard`) is where an admin sets the mode + scale per grade level, scoped to their `gradeScope`. Each card shows a `configured`/`default` chip and a "Reset to default" action. The grading-weights (sliders) button on the Subjects tab is hidden for descriptive grade levels — previously keyed on a hardcoded ECE list, now on the resolved config.
- **ECE Competency page** derives its rating buttons, legend and filter pills from the **selected class's** scale, so a Kindergarten class on CO/DV/BG and a Grade 1 class on A-E coexist. The rating filter resets when the scale changes, since a pill from one scale is meaningless on another. The class list itself is filtered by `isDescriptive()` rather than a fixed grade list.
- **Dashboard cards** (`EceCompetencyCard`, `AdminEceOverviewCard`) render **one stacked bar per scale** from the API's `distributions[]` array. The old flat `rating_distribution {E,G,F,NA}` field is gone — it could not represent a year that mixes scales.

**Ordering trap**: these pages resolve config into a `useMemo`/`useCallback` that later hooks depend on. Declare the config state, its memo and any derived helper **above** the first `useMemo` that consumes them — a temporal dead zone here is a runtime crash the build will not catch (this bit `EceCompetency.jsx` once).

### Curriculum Management (`pages/CurriculumManagement.jsx`)

**School year modals.** `CreateSYModal` and `EditSYModal` both derive status from
`is_active` / `is_upcoming` (`active` → `upcoming` → else `archived`). Create carries
its own Status select — without it every new year was POSTed with both flags false and
was born **archived**. The Upcoming option is disabled when the typed label's end year
has already passed, mirroring the API rule, and the effective status falls back to
`archived` so the select and the payload cannot disagree; a half-typed label still
counts as allowed so the select does not jump mid-keystroke. Default is `upcoming`, or
`active` when no school year exists yet.

The Grading model panel is the same in both, with different copy: Create states plainly
what the two selects do, Edit warns that changing them affects how grades are computed.
On an **archived** year Edit shows a `Lock` pill, swaps in the "cannot be changed"
sentence and disables both selects — matching the 409 the API raises.

The school-year dropdown is `components/SchoolYearPicker.jsx` (was an inline
`SYSelector`), shared with the Enrollment page; it also exports `SYStatusPill` for the
three-way active/upcoming/archived badge, plus `syStatus(sy)` and `isArchivedYear(sy)`
— the derivation behind it, mirrored from the backend's `utils/schoolYear.js`, so
callers that need the status as a value do not re-derive `!is_active && !is_upcoming`. There is **no school-year context** in the
app — each page fetches `curriculumApi.getSchoolYears()` and owns its own selection.

Selecting **Active** in `EditSYModal` reveals a pre-flight panel fed by
`curriculumApi.enrollmentReadiness(sy.id)`, rendered as a **ledger, not prose**: one row per
effect, each a count, a short label, and one link where there is something to go and fix.
The rows are built as an `effects` array beside the state that feeds them, so a row appears
only when its count is non-zero and the panel turns amber if any carries `warn`.

It reports only the effects worth stopping for — learners **restored** to the roll,
learners **archived** off it, and those **left in the closing year with no outcome**, the
last linking to Year-End Promotion since that year closes the instant this one starts and
nothing decides them on its own. It deliberately does *not* report how many learners are
adopted or marked pending: that is what activating a school year **is**, so reporting it
back told the admin what they had just asked for and pushed the three consequential rows
below the fold. When none of the three apply the panel says so, rather than showing a
heading over an empty list.

`will_restore`'s label changes when `readiness.rewinding` is set — reopening an *earlier*
year archives nobody and brings back every learner that year's roster lists, so the number
would otherwise look wrong against the roster about to appear.

Activation is never blocked, so `handleUpdateSY` reports the same thing again afterwards:
the success toast carries `adopted / pending / restored / archived`, plus a **separate**
warning toast when `rollover.undecided_outcomes` is non-zero — a loose end to go back to,
not a report of what just happened, which is why it is not folded into the first.

**Subjects & Sections tabs** share `GradeCard` → `EditableItem` / `AddItemForm`. Both
item forms are a single name field; subjects have no description (column dropped).
The grade cards sit in a plain CSS grid, so **grid stretch** gives every card in a row
the height of the tallest card in that row, each row measured on its own. `GradeCard`
is therefore `bg-white flex flex-col` with a `flex-1` body, so a collapsed card fills
its stretched cell as an empty white card instead of leaving a hole inside its border.

**A section row also carries its class adviser.** `EditableItem` renders it as a
**second line** under the name rather than a chip beside it — it is a person's name, so
it needs the width, and a muted italic "No adviser" has to be as visible as a filled one
because an unadvised section is the state an admin is looking for. A deactivated adviser
gets an amber `Inactive` chip (teacher accounts are soft-deleted, so a section can hold
one, and blanking the name would read as "no adviser"). The `GraduationCap` hover button
sits in the same slot the subjects' `SlidersHorizontal` occupies — the two `type`s are
mutually exclusive, so the row keeps one shape.

`AdviserModal` is the picker: `curriculumApi.adviserCandidates(id)` on open, a search
box, and a radio list split **Teaching this class** / **Other teachers** off the API's
`teaches_this_class`. A teacher who already advises another section this year comes back
with `advises` set and renders **disabled with the reason on the row** (the same idiom as
the wizard's `Graduated — Grade 6 only`) — the API 409s on it either way, so the disabled
row is the affordance, not the guard.

**Remove is a complete action, not a pick.** When the section has an adviser the footer
grows a red **Remove**, which swaps the modal body for a confirmation naming the teacher
and section, and confirming writes and closes. It replaces the body rather than opening a
second `Modal` over this one — one surface, no stacked backdrops for a one-line question.
The confirmation says what does *not* change (their teaching assignments, and every grade,
attendance mark and observation they recorded), because "remove adviser" reads as more
destructive than it is. It used to clear the radio and wait for Save: two clicks for one
intent, with a middle state showing an adviser still selected while the button offered to
remove them. Assigning and clearing now share one writer (`commit(teacherId)`) — the same
request with a different payload, so the two paths cannot drift.

**Save is live whenever a teacher is selected, including the one already stored.**
Re-saving the same adviser is idempotent server-side (the clash check excludes this
section), and gating on "changed" left the button dead in the state an admin most often
clicks from — opening the modal to check who the adviser is and pressing Save. The only
disabled case is nothing selected at all.

Every section-returning endpoint now carries `adviser`, including the `POST` and `PUT`
responses, so `handleSetAdviser` merges the returned row exactly like
`handleUpdateSection` and a rename cannot blank the adviser on screen.

The adviser is **read-only everywhere else**. On **Student Detail** it is a single chip in
the header meta row, immediately after `Grade 2 · Magiting` — that is what it is a fact
about, the class this learner sits in. One slot, two forms:

| Viewer | Chip |
|---|---|
| the adviser (`isAdvisee`) | **Your advisee**, brand-tinted |
| anyone else | **Adviser: Surname, First**, neutral slate |
| section has no adviser | nothing |

Brand vs slate is deliberate: the first is a relationship to *you* and explains why the
tabs below carry the whole record rather than only the subjects you teach; the second is
reference information and must not compete with the `RiskBadge` beside it. A deactivated
adviser gets an amber `(inactive)` — teacher accounts are soft-deleted, so a section can
still point at one, and rendering the name plainly would hide that. `isAdvisee` is compared
off `advisory` in `useAuth()`, so it costs no request.

It is **not** also a row in the Student Information card. It was, briefly, and that said
the same thing twice while burying it under the learner's own details — the header is
where it belongs. Nothing renders anywhere when a section has no adviser.

For the teacher themself, `advisory` off `useAuth()` also drives a header chip on
`TeacherDashboard` and, in Profile's `TeacherAssignmentsCard`, an `Adviser` mark on the
matching assignment chip **plus** a banner above the list. The banner is the point: a
teacher can advise a class they teach no subject in, and then no chip would match.

On **Account Management → Teachers** the advisory is **merged into the assignment chip**
rather than listed beside it — an advisory is a property *of a class*, so one class gets
one chip reading `Grade 1 · Makabayan · English · Adviser`, amber instead of brand. The
same merge runs per school year in the Assignment History modal, so a teacher who taught
that class last year without advising it gets the marker only on the year they held it.

Two shapes the merge cannot cover, both handled beside it:

- **An advisory with no assignment for that class** stands alone as its own chip — there
  is nothing to append the marker to, and it is the case the whole feature exists for.
  `unattachedAdvisory()` / `advisoryKeys()` are shared by the tag row and the history
  modal so the two mark the same thing the same way.
- **Advised classes sort first**, because the chip column collapses after two behind
  `+N more` and the marker must not be what gets hidden.

The Edit Teacher form carries a read-only note naming the advisory and pointing at the
Curriculum page. Deliberately read-only: a control here would be a second write surface
for one rule. The note exists so an admin does not hunt for a control that is missing on
purpose.

### My Class (`pages/MyClass.jsx`)

Route `/my-class`, `roles={[ROLES.TEACHER]}`. The class adviser's **read-only**
cross-subject view of the section they advise — class list, grades (or competency),
attendance and behaviour, over `advisoryApi`. `advisoryApi` has no write methods
because the API exposes none.

Its source is **`advisory` from `useAuth()`**, not `activeAssignments`: an adviser
may teach no subject in the class they advise, which is exactly the case the page
exists for. Shape is `{ id, grade_level, section, school_year, school_year_id }` —
`sections.name` is aliased to **`section`** on the way out, matching every other
table that holds one, so `v.section === student.section` reads straight. The
uniqueness index caps an adviser at one section per year, so the page selects
`advisory[0]` rather than offering the `|||` class dropdown every other teacher
page uses; that idiom only becomes necessary if the rule is relaxed.

Grades vs Competency is chosen from `assessment.is_descriptive` on the class-list
response, never from a grade-level list — Grade 1 becomes descriptive under DO 015
with no code change here.

The Grades tab warns when a column is `off_level`: a grade recorded this school
year against a subject outside the class's grade level, which happens when a
learner is moved mid-year. Named rather than dropped.

**The Behavior tab groups by learner, not chronologically.** A flat feed answers
"what happened most recently", which is the wrong question for an adviser looking
at a whole class over a whole year: a term's logs become a shapeless scroll and one
learner's pattern is spread across dozens of cards. One collapsed row per learner
carries the count, the sentiment mix and the latest date — what decides who needs
attention — with the observations behind an expand. Thirty logs across three
learners fit on one screen.

Three rules the tab turns on:

- **Sorted most-negative first**, then most-logged, then surname. Triage order, not
  alphabetical, and the caption says so — a non-obvious sort has to be stated.
- **Filtering is client-side over one load** (the API's 300 cap), so the sentiment
  chips are instant and their counts stay stable. A count that changes when you
  select it cannot be compared against the others.
- **Learners with no observations are counted, not listed** ("3 of 3 learners have
  observations · N with none"). An empty row each would be most of a class and none
  of the information.

Own logs read `Logged by you`, others the teacher's name — the same asymmetry
Student Detail's Behavior tab already uses.

**Sidebar** — the item lives in `My Students` and carries a `when` predicate
(`({ advisory }) => advisory.length > 0`), a new hook in `Sidebar.jsx` beside the
existing `roles` filter. A role list cannot express this: every teacher has the
role and only some hold an adviser row. The group auto-hides as before if nothing
survives, and a teacher who advises nothing gets a plain empty state if they reach
`/my-class` directly.

**Student Detail** gains `isAdvisee` (compared off `advisory`, no request). It
appends a clause to the teacher "Scoped view" banner saying the Grades, Attendance
and Behavior tabs now show the full record — the banner otherwise reads as if it
bounded the whole page, when it only describes the AI card.

### Enrollment (`pages/Enrollment.jsx`)

Admin-only, route `/enrollment`, sidebar under Administration. One school year's
roster at a time: who is studying, at what grade level and section.

**Open to every admin, but scoped admins place learners without setting status.** The page
reads `isSuperAdmin` off `useAuth()` (it previously destructured only `gradeScope`, so the
tiers differed nowhere but the grade dropdowns).

The **Status cell is read-only** for `admin_ece` / `admin_elem` — a plain `StatusBadge`
with a `title` saying who sets it, taking the same branch the page already uses for a
locked archived year. A dirty row shows the **draft's** status rather than the stored one,
so placing a learner who has no record yet reads "Pending" — what will actually be
written — instead of the "Not enrolled" they still are. Grade level and section stay fully
editable; that is the roster work a scoped admin owns.

Also hidden from scoped admins: the archived-year **unlock** button and the row
checkboxes plus the whole bulk bar. The **Year-End Promotion** link is *not* — every
admin closes out their own grade levels.

Every one of those has a matching server guard (`authorizeSuperAdmin` on `DELETE /`
and both promotion endpoints; a `removals.length` check and a
status-comparison check inside `PUT /`) — **except the bulk bar, which cannot have one**:
`PUT /` always posts the array of dirty rows, so nothing distinguishes "used the bulk bar"
from "edited eleven rows by hand". Hiding it is a guardrail against an accidental mass
edit, not a boundary — treat it as UI, and do not add an `entries.length` cap to make it
look like enforcement.

The Students page goes further: its Status badge is a read-only `<span>` for **every** role,
`super_admin` included, and the `StatusChange` modal is gone. Status is a per-year fact and
that page carries no year, so it belongs here instead. The status **filter** there is
untouched — reading by status is how an admin finds pending learners.

Defaults to the **active** year: it is the one whose roster the rest of the app
reads, so landing there matches what the user sees everywhere else.

**Two locks, different worries.** `locked = archived && !unlocked` is the archived-year
one below — about rewriting history, so it is `super_admin`'s. `placementLocked =
isActiveYear && !placementUnlocked` is new and much narrower: on the **active** year,
grade level and section open **read-only**, because saving there moves learners
immediately and those two fields are what move them. They sit in a table of selects
beside a status column that is edited far more often, so a mis-click lands on a
learner's placement with no undo but another edit.

It guards a slip, not a permission: **any admin** can toggle it, from a
`Unlock grade & section` / `Lock grade & section` button in the banner, which also
states which way it currently is. `placementUnlocked` resets in the same `prevSY` effect
as `unlocked`, so it never carries into another year. Status is deliberately **not**
covered — it is what this page is mostly used for, and locking it would put a click in
front of the common case.

Both placement writers respect it: the per-row grade and section selects and the bulk
"Set grade level". A status-only edit still posts the learner's unchanged grade and
section, so nothing moves. Upcoming and archived years are unaffected — an
upcoming year only records a plan, and an archived one has its own lock.

An **archived** year opens **read-only** — grade level, section, status, the row
checkboxes and the bulk bar are all inert, and the save bar cannot
appear because no draft can be started. The banner carries an **Edit historical
records** button that unlocks the page for that year — **rendered for `super_admin`
only**, with the locked copy telling everyone else who can; `unlocked` is reset in the
same `prevSY` effect that clears drafts, so it never carries across years. Once
unlocked, `save()` sends `allow_archived: true` and `PUT /api/enrollment` accepts
the write — without the flag it answers 409, so a stray call cannot rewrite a
closed year. `DELETE /api/enrollment` takes the same flag.

This is a **soft** lock on purpose. It is not the grading-model freeze, which
protects the *interpretation* of grades already issued to parents and is absolute;
an enrolment record is a plain fact that can simply be wrong, and a year archives
the moment the next one is activated — exactly when corrections are still coming
in. The risk being guarded is a mis-picked year from a dropdown that lists closed
years like any other, so an explicit step is enough. `isArchivedYear` /
`syStatus` come from `components/SchoolYearPicker.jsx` (mirror of the backend's
`utils/schoolYear.js`), which already owned the three-way derivation for
`SYStatusPill`.

**This page owns *status* only** — is the learner attending this year: Pending,
Enrolled, Transferred out, Dropped. Promoted / Retained / Graduated are *outcomes*
and belong to the wizard; the **Outcome** column here is a read-only badge. Mixing
the two in one dropdown was the original design and it made the page unusable:
an admin tagging someone as enrolled was picking from a list of year-end verdicts.

The **Last attended** column replaced a "Currently" column that showed
`students.grade_level` — redundant when editing the active year, misleading when
not. It shows the most recent year the learner actually has a record for (gaps
skipped), with the outcome on the second line, or `— first year`.

A learner who was `enrolled` in that year with **no outcome** gets an amber
**No outcome** chip. That state used to render as a bare "SY 2025-2026" with no note at
all, indistinguishable from a year that had been properly closed — so once the next year
was activated, a learner nobody had judged simply blended in. Only `enrolled` qualifies,
matching the wizard: someone who left did not finish the year, so no verdict is missing.
The whole check is client-side — `last_status` and `last_outcome` already come off the
`prev` LATERAL.

Learners who have **left** are hidden, with a **Show learners who left (N)**
toggle; otherwise every future year's roster accumulates every ex-student. Once
shown they are **tinted grey** (`bg-slate-100/70`, name muted to `text-slate-500`)
off the API's `has_left` flag — they used to read exactly like everyone else, so
the roster simply looked like it had grown. Grey rather than a warning colour:
they are history, not a problem. A **dirty row still wins the tint**, since
marking a learner grey while the admin is re-enrolling them contradicts the draft.

**Graduates are not in that group and the toggle cannot reveal them.** The API filters
them out of every later year unconditionally (`COMPLETED_SQL`), so they never arrive and
`has_left` never describes one — the count on the toggle excludes them too, or it would
promise rows that never come back. Nothing on this page needs to know: the year they
graduated in still lists them with their Outcome badge, and un-graduating someone is done
in the Year-End Promotion wizard by blanking the decision, not here.

**Archived learners are shown here, marked, not hidden.** The roster does not filter
`students.is_active` at all — it is one global flag meaning "not on the roll *today*",
carries no year, and cannot answer this page's per-year question. Rows carry `is_archived`
and `archived_reason`, rendered as a small grey **Archived** chip beside the name whose
tooltip gives the reason and points at Students → Archived. Without it a learner listed for
a past year they really did attend is indistinguishable from one still studying here. The
per-year exclusions (`has_left`, graduated) do all the filtering, so someone who dropped in
SY 2025-2026 appears on that year with their `dropped` status and not on SY 2026-2027.

Rows come from `GET /api/enrollment`, which LEFT JOINs, so learners with no record for
the year show as "Not enrolled" rather than disappearing. Edits are held in a `drafts`
map keyed by `student_id` and only the dirty rows are sent, so touching three learners
does not rewrite the year. Changing grade level clears the section, because sections
belong to a grade. A sticky bottom bar shows the unsaved count with Discard / Save.

**A draft seeds its grade level from three things in order**: the year's own record,
then `outcomeGrade(row)` — where the *previous* year's outcome says they belong, promoted
one rung up and retained on the same rung — then the learner's current position. The
middle step is the one that is easy to leave out, and its absence was a real bug: set a
promoted learner to "Not enrolled" and save, and their record is gone, so the seed fell
through to `current_grade_level` — the grade they had just **finished**. The page then
proposed undoing the promotion, and flagged its own suggestion with the mismatch warning
below, which does read the outcome. `outcomeGrade()` is now shared by the seed and that
warning, so the two cannot disagree, and it walks the same ladder as the wizard's
`placementFor()`.

**Section seeds separately, and against the grade the seed just picked.** It mirrors the
API's `ROW_SECTION` — the year's own record if it has one, else the learner's current
section — but that fallback is where they stand *now*, and the grade above may already
have moved them a rung up, so it is kept only when `sectionsFor(grade_level)` actually
lists it and dropped to `''` otherwise. Without that check, filling an upcoming year by
selecting the "Not enrolled" rows and setting them Pending drafted a Grade 1 section onto
a Grade 2 placement — a value absent from the row's own `secOptions` and rejected by
`assertSectionsExist`, so the whole batch failed on something nobody typed. The removed
Carry over button did this check itself, which is what kept the gap hidden.

Both this bar and the wizard's footer are `fixed bottom-0 left-0 lg:left-64` —
the sidebar is a fixed `w-64` panel at `z-40` and the content area is offset by
`lg:ml-64`, so a bar pinned to plain `left-0` runs underneath it. They use
`px-4 sm:px-6` rather than a centred `max-w-*`, because `<main>` has no
max-width and centring misaligns the bar from the content above it.

**Filling an upcoming year in bulk is the status chip plus the bulk bar**: click the
**Not enrolled** chip, select all, set status to Pending, save. Each untouched row is
already seeded by `draftFor` at the grade `outcomeGrade(row)` implies, so the saved
placements come out per-learner correct — promoted a rung up, retained or unjudged on the
same rung — without anything having to re-derive the ladder.

That replaced a **"Carry over from &lt;previous SY&gt;"** button, which called
`GET /api/enrollment/previous` and prefilled the same rows from the preceding year. It was
removed as redundant: the promotion wizard writes the forward `pending` record for
everyone it decides, so all the button could still reach were the undecided learners, and
for those the API proposed the grade they were already in — what `rolloverStudents()` does
at activation anyway. It was also `super_admin`-only, so the scoped admins who actually
keep rosters never had it, and inert on both the active year (`placementLocked`) and
archived ones. Chiefly it was a **fourth** surface for one placement rule, beside
`placementForOutcome`, `outcomeGrade` and the wizard's `placementFor` — two of which had
already drifted apart once over the no-outcome case. Do not bring it back.

Row checkboxes plus a bulk bar (Set status / Set grade level) are **new for this
codebase** — nothing else has multi-select. Both selects hold what was applied
(`bulkStatus` / `bulkGrade`); they were pinned at `value=""`, so choosing an option
changed every selected row but left the control still reading "Set status...", and the
table was the only feedback that anything had happened. An effect on `selected.size`
clears them when the bar retires, so the next batch starts fresh.

The bar also shows **what is in the batch** (`selectionGrades`, counted off the grade
each row is currently *showing*, so a pending edit is reflected) — neutral for a single
grade, amber as `Grade 1 × 5, Grade 2 × 7` once it spans more. That is the part that
prevents the mistake rather than interrupting it: "Set grade level" is an absolute
assignment, so a mixed batch is flattened into one grade **and every selected learner's
section is cleared** (`setDraft` drops the section whenever the grade changes — sections
belong to a grade). Picking a grade for a mixed batch therefore opens a confirm
(`pendingBulkGrade` + the shared `Modal`, `size="sm"`) listing each grade collapsing and
naming the section wipe; Cancel resets `bulkGrade` so the select never shows a value that
was not applied. A single-grade batch applies immediately, as before. Status chips across the top double as
filters and keep their counts while one is selected, because the API's `summary` is
computed over the caller's whole scope.

**`gradeMismatch(row, draft)` warns when a drafted grade level disagrees with an outcome
already on record**, and Save routes through a confirmation when any row does. Two outcomes
can bear on one row and at most one of them does, so the check is ordered:

| | Expected grade | Message |
|---|---|---|
| the row's **own** `outcome` (year already closed) | the grade level stored on the record | "This year ended as **Promoted** from **Grade 1**." |
| otherwise the **previous** year's `last_outcome` | `nextGradeLevel(last_grade_level)` promoted, `last_grade_level` retained | "Promoted from Grade 1, so **Grade 2** is expected." |

It is the promotion wizard's `placementMismatch()` rule applied where that placement can
later be edited by hand — the wizard warns when writing a placement, this warns when
changing one. Surfaced as an amber select plus an inline note on the row, an amber clause
in the save bar, and a **confirmation modal** on Save listing up to eight learners
("Grade 5 instead of Grade 2") with Go back / Save anyway.

**Confirmed, not blocked.** An outcome is a verdict about a year and the grade level can
simply have been entered wrong — correcting that is what this page is for. What it must
not be is silent: nothing downstream re-derives a placement once the wizard has written
one, and the modal says plainly that the outcome itself is unchanged (only Year-End
Promotion writes that column). Removals (`status: 'none'`) are exempt — there is no grade
level left to disagree with anything. Shown to every admin, since editing a grade level is
not `super_admin`-only and the mistake is not role-specific.

**`activeMove(row, draft, isActiveYear)` covers the case `gradeMismatch` cannot see.**
That function only fires when there is an outcome to disagree with, so a learner nobody
has judged yet — no verdict this year, none last year — had nothing checking the edit
that moves them. On the **active** year that is the most consequential edit on the page:
`PUT /api/enrollment` writes `students.grade_level` immediately, so they leave their class
lists, attendance sheets and score-entry rosters the moment the request returns, with no
later activation to review it and no undo but another edit. It is deliberately narrow —
active year only (an upcoming year records a plan, an archived one is behind its own
unlock), grade level only (section is a smaller move inside the same grade), only when
`gradeMismatch` is silent so a row never argues both ways, and measured against
`row.grade_level || row.current_grade_level`, the same order `draftFor` seeds from, so an
untouched row cannot trip it.

Same three surfaces as a mismatch — amber select plus an inline note ("Moves out of
Grade 1 as soon as this saves"), a clause in the save bar, and a named list on Save — and
**one confirmation dialog carries both groups**, because a batch can contain each and
chaining two modals in front of one save would be worse than either mistake. `confirmSave`
(not `confirmMismatch`) is therefore the state behind it, and the Save button opens it on
`mismatches.length + moves.length`. This is the second guard on the same worry as
`placementLocked`: that lock stops the slip, and once an admin lifts it for the year the
warning is what still names who is about to move.

**"Not enrolled" and "Dropped" are different facts, and the vocabulary says so.**
`NO_RECORD` in `utils/enrollment.js` carries "never enrolled for this school year —
either a new learner who has not enrolled yet, or a previous learner who did not return",
and `dropped` reads "was enrolled, then stopped attending or withdrew before completing
the school year". Both render as `title` tooltips on the status chips and on every option
in the two status selects, via `statusMeta(id).description` — the chips are where the two
sit side by side, so that is where the difference has to be legible. The distinction is
not cosmetic: "not enrolled" is a **reason a learner counts as having left** once the year
closes (see the has-left rule in the backend notes).

The status select offers **"Not enrolled"** alongside the four stored values.
It is not a stored value — it means *remove this year's record* — so choosing it
greys out the grade and section (nothing will read them) and the save posts
`status: 'none'`, which `PUT /api/enrollment` turns into a DELETE inside the same
transaction as the other edits. It is available on **every** year including the
active one — the API reconciles the `students` mirror to `pending` when the active year's
record goes — but **disabled wherever something is attached to the record**: a year-end
`outcome` (`row.outcome`), or academic work in that year (`row.has_academic_records`, a
flag the roster computes). Per-row the option says which of the two is blocking it; the
bulk select reports the count and, when the selection mixes both reasons, says "have an
outcome or recorded work". A mixed selection blocks rather than silently removing the safe
subset. The reason rides in the option label the way the wizard's `Graduated — Grade 6
only` does.

Removing a record drops one row and nothing else — grades, scores, attendance and
behaviour logs all hang off `students`, and nothing references `student_enrollments`. That
is precisely why both guards exist: the outcome is the one column no surface but the
promotion wizard can write, and orphaned work would stay attached to a learner the year no
longer says was ever there. `PUT` and `DELETE /api/enrollment` enforce both absolutely —
no `allow_archived`-style override. Setting a learner who
has no record to "Not enrolled" is filtered out client-side as a no-op, and the
save bar counts removals separately.

A **section** filter sits beside the grade-level one and renders only once a grade is
chosen — sections belong to a grade, so it means nothing before then, and changing the
grade clears it (in `updateParams` and on the grade select itself). Its **Unassigned**
option posts `section=none` and is the point of the control: after the promotion wizard
runs, every learner it placed arrives in the next year with no section, and finding them
is most of the work of filling that year in.

`draftFor` seeds `section` as `(row.enrollment_id ? row.section : row.current_section) ?? ''`
— a mirror of the API's `ROW_SECTION`. It used to be `row.section ?? row.current_section`,
which seeded a Grade 2 placement with the learner's Grade 1 section: a value absent from
that row's own `secOptions`, and one `assertSectionsExist` would have rejected on save.

Status chips and the **Outcome** filter select are deliberately separate controls.
Both are per-year and both are dropped when the year changes.

**The status filter is per-year and is dropped when the year changes.** It has to
be: statuses that exist in one year often have zero rows in another, and a chip
with a zero count used to not render at all — so filtering "Not enrolled" on an
upcoming year and switching back to the active one left an empty roster with no
chip to click, which reads as "this year has no learners". The first render is
exempt so a bookmarked URL still opens on the filter it names. Two backstops on
top: the **selected** chip always renders (showing `· 0` when empty) so a filter
is never invisible and clicking it always clears it, and the empty state
distinguishes "no learners match these filters", naming them, from "no learners
yet", with a Clear filters button.

The banner carries the thing that is easy to get wrong, in **three** cases, not
two: editing the **active** year moves learners immediately; an **upcoming** year
only records the plan; an **archived** year is history and is read-only (amber
once unlocked, saying plainly that saving rewrites the record). The two-way version
told an archived year it "is not active yet … learners move when this year is
activated", which is the opposite of true.

A separate banner warns about **missing sections, per grade level** — not per year.
`gradesMissingSections` intersects the grade levels the roster actually contains with the
grade levels that have a `sections` row for the selected year, and names the difference
("SY 2027-2028 has no sections for **Kinder, Grade 2, Grade 3**"). Asking it per year was
the bug: a single stray `Grade 1 / Sample` row satisfied `sections.length === 0` and
silenced the warning while every other grade's dropdown sat empty, indistinguishable from
the ones `placementLocked` disables. The row's own select says it too — `No Grade 2
sections` rather than a bare `No sections`, so the row names what is absent instead of only
that something is.

### Year-End Promotion (`pages/PromotionWizard.jsx`)

**A closed handover is read-only.** `locked = isArchivedYear(target) && !unlocked`,
with the same idiom as the Enrollment page: in-banner `Edit historical records` button,
`unlocked` reset in the effect that already runs on `sourceId`/`targetId` change, and
`allow_archived: historical && unlocked` on the request. It keys on the **target**, not
the closing year — closing an already-archived year into the freshly activated one is
the normal sequence, while the writes that rewrite history (the placement upsert and the
graduated-row delete) both land on the target. `locked` is threaded through the Decision
selects, reason inputs, `acceptAll`, `goStep2`, every step-2 placement select and the
Confirm button.

The **Closing school year** select now labels each option with its status and disables
`upcoming` years, matching the API's 422 — the derived target beside it already carried
a `SYStatusPill`, so an unlabelled source made a closed year look like any other.

**Graduated is offered only at the final grade level.** The Decision select disables
it whenever `!s.is_exit_grade`, labelling it "Graduated — Grade 6 only"; `EXIT_GRADE`
comes off `ALL_GRADES` so retiring or adding a level moves it. It is the one outcome
that writes `students.enrollment_status` and drops the learner off every later
roster, so a mis-click there ends someone's schooling. `POST /enrollment/promotion`
refuses it too (422) — the select is the affordance, not the guard.

**The placement always follows the decision.** `placementFor(s, outcome)` is the
single rule — retained keeps `retained_grade_level`, promoted takes
`promoted_grade_level`, a graduate gets none — and it feeds all three writers: the
seed in `load()`, `setOutcome()` and `acceptAll()`. Step 1 shows the result in a
**Moves into** column beside the Decision select, so the grade level visibly changes
as the decision does; the "Class" column next to it is the level being *left* and
never moves. Seeding used to take the API's `next_grade_level` verbatim, which was
the advance regardless of what was recommended — so a learner recommended
**retained** who had never been committed arrived pre-placed in the next grade, and
accepting the recommendation without reopening the dropdown promoted them anyway.
A committed placement (`already_placed`) still wins, since it may have been
hand-picked in step 2.

**"Learners move into" is derived, not chosen.** `nextYearAfter()` resolves it from
the closing year (next label in sequence) and it renders as a read-only field, not a
select. It was a free choice defaulting to the earliest **upcoming** year, which is a
different year once one has been activated — so re-running the wizard on an older
year committed it into the year after next, leaving the placements the first run
wrote behind, still holding the superseded grade level. The API enforces the same
rule (409), so a re-run now always corrects the record it wrote first.

Route `/enrollment/promotion`, **admin-only** (`roles={ANY_ADMIN}`), reached from a button
in the Enrollment page header. Reach is bounded by **grade scope**, not by the route: the
API returns only in-scope learners, so a scoped admin sees their own grade levels and
nothing else.

`gradeOptionsFor(scoped, s, outcome)` is why step 2 works for them. The placement select
normally offers the caller's scope, but a scoped admin closing out their **last** grade
level must place learners one rung above it — Kinder promotes into Grade 1, which
`admin_ece` does not otherwise touch — so the grade `placementFor()` derives for *that*
learner is added when it falls outside. Only that one extra level appears, and
`POST /promotion` enforces the same rule, so it is not a hole.

The archived-handover **unlock** button is `super_admin`-only (`locked && isSuperAdmin`),
with the locked copy telling everyone else who can — matching the 403 the API raises.

**`placementMismatch(s, d)` warns when the placement contradicts the decision beside it.**
Step 2 lets the grade level be overridden by hand, so it can drift away from what
`placementFor()` derives — a **retained** learner sent up a grade is the case that matters,
because the record then says "retained" while the placement behaves like a promotion.
`admin_ece` trips the API's scope check instead (Grade 1 is outside their range, and the
403 now names the contradiction rather than just the scope), but for `admin_elem` both
grades are in scope, so Grade 3 retained → Grade 4 used to commit silently.

Surfaced three ways, none of them blocking: an amber row tint plus an inline note under
the offending select, a count banner at the top of step 2, and a named list on the Confirm
step — the last point at which it can still be caught. The copy states the **rule**, not
the conflict ("Retained means staying in Grade 3", not "records an outcome the placement
contradicts") — the admin already sees the grade they picked, so the only thing missing is
what the outcome implies. **Warned, not refused**: the
placement may be a deliberate exception, and the wizard's job here is to make sure it was
not an accident. Shown to every role, `super_admin` included; the mistake is not
role-specific even though scoped admins are the ones doing this work now.

Three steps held in one `step` state — **Review results → Place learners → Confirm** — over
a single `decisions` map keyed by `student_id`.

Only learners whose status is `enrolled` are reviewable; the API returns everyone
else as `excluded` counts, rendered as a note ("1 learner dropped in SY 2025-2026,
so they are not part of promotion"). The decision select offers **three** outcomes,
never a status.

**Decisions seed from `decided_outcome` only — never from `recommendation`.** They used
to fall back to it, which made the wizard's advice look like a decision that had already
been taken: an admin could page through and commit a year of outcomes without ever having
agreed to one. The recommendation has its own column (a status pill, plus `s.reason` when
the row is expanded), so it stays fully visible — it is read there rather than acted on by
default, and **"Accept all recommendations"** is how it becomes a decision. One deliberate
click instead of none.

A learner with no results gets no recommendation from the API at all, so those rows have
nothing to accept and must be decided by hand. Rows the API marks `needs_review` get an
amber left border and can be isolated with a toggle. The Decision select carries an amber
border while blank, so on a year nothing has been committed for yet, every row starts
amber — that is accurate, they do all need a decision, and the "Not yet decided" count
tracks the same thing.

`acceptAll` overwrites **every** row that has a recommendation, including one already
decided by hand or by an earlier commit. That predates the seeding change but matters more
now that it is the main way decisions get filled.

**A blank no longer blocks the wizard.** Closing a year is not one sitting — teachers
finish grading at different times, so the roster is normally a mix of learners who can be
judged and learners whose results are not in yet. `goStep2` used to refuse while any row
was blank; it now only enforces the API's own floor (`decisions` is `min(1)`), so an admin
decides whoever is ready, commits, and comes back. That is safe because the wizard was
always resumable: `GET /promotion-review` returns `decided_outcome` and `POST /promotion`
upserts, so a re-run updates the same rows rather than duplicating them.

**Blank means two things, and only the row's history tells them apart.** Never decided →
leave it for a later run. Decided in an earlier run and blanked now → an explicit "that was
wrong", which posts `outcome: null` and clears the verdict. `cleared` and `untouched` are
the two lists; `undecided` (their union) drives only the filter count. Without that split
the second case was silently indistinguishable from the first — the row was dropped from
the payload and the wizard reloaded showing the very decision the admin had just removed.
The row says what Save will do to it, the Confirm step names each learner being cleared,
and the footer stops promising a close for a run that only undoes one.

**The change that makes it work is in `commit()`, not the guard.** It used to map every
learner in `students`; an undecided row would post `outcome: undefined` against a Joi
`.required()` and **422 the whole batch** — failing on a field the admin was never shown.
It now maps `decided` only. Relaxing the guard without this produces a wizard that lets
you through step 2 and then dies at Confirm.

`undecided` drives a **Not yet decided** toggle beside "Needs review", stacking with the
grade filter and search. (The API also returns `summary.no_data` — learners with nothing
recorded to judge at all — but nothing renders it; the Evidence column already says
"No grades recorded" per row.) Step 2's banner names the count being left out; the Confirm step
spells out that those learners keep no outcome, that their closing-year records are
untouched, and that if the target year is activated first `rolloverStudents()` marks them
Pending on their current grade rather than losing them. The footer stops claiming
"Ready to close SY X" for a partial run and names the count instead.

Every row expands to show the evidence the recommendation came from — per-subject
final grades with failures in red, or the rating distribution by code. That is the
answer to "how does an admin know this learner qualifies", so it lives one click
away, not in a separate report.

Two guards before step 2: nobody undecided, and **promoting a learner the data
says to retain requires a written reason** (the remarks input appears as soon as
the decision differs from the recommendation, and turns red when required).

**Placement is derived from the grade level being left, never from the placement
on file.** The review returns `promoted_grade_level` (always
`nextGradeLevel(closing grade)`) and `retained_grade_level` separately from
`next_grade_level`, which is only a seed. They diverge the moment a retention is
committed: the target-year record then holds the *unchanged* grade, so reusing it
as "where promotion goes" left a re-promoted learner stuck one level down —
flipping Promoted &rarr; Retained &rarr; Promoted never advanced them.
`placementFor()` is the single rule, used by both the decision select and Accept
all; changing the target grade also clears the section, since sections belong to
a grade.

Step 2 lists only `promoted`/`retained` learners, grouped by target grade level
with a per-group "assign all to section". Each row also carries its own grade-level
select, and learners with no target grade get their own amber group — overriding
"Graduated" to "Promoted" at the final level leaves nowhere to move up to, and that
must not fall through silently. Section stays optional; a grade level does not.

`statusLabel` / `statusClasses` / `PROMOTION_OUTCOMES` all come from
`utils/enrollment.js`, so the wizard and the Enrollment page speak the same
vocabulary.

### Students page — enrolment status

The table gains a **Status** badge column and a status filter (admins only; teachers
only ever receive enrolled learners from the API). The badge is **read-only for every role** — there is no status editor on this page. It used
to open `StatusChange` for a super admin, which posted to `studentApi.setEnrollmentStatus`;
the component, the API wrapper and the `isSuperAdmin` read that gated them are all removed,
and the badge's tooltip points at the Enrollment page. The **filter** uses `STUDENT_STATUSES` (five) plus
`NO_RECORD` so graduates and learners with no record for the active year stay findable —
readable, not settable. Appended rather than folded into `STUDENT_STATUSES`, which models
the values the mirror column can actually hold; `'none'` is not one of them, and the badge
gets it from the API's derived `status_display` (see the root CLAUDE.md).

**The filter's options differ by tab** (`statusOptions`), because the two tabs are different
kinds of list. **Active** is a worklist: every status on it is one a learner can be *put into*
from this page, so an empty one is an answer ("nobody is dropped") rather than a dead option
and they all stay listed — except `graduated`, which the wizard earns and this page cannot
set, and which archives the learner, so it appears only while `by_status.graduated` is
non-zero (the window between the wizard recording a graduation and the next activation filing
them away). **Archived** is a record: nothing on it is settable — the row shows the Archived
badge and its reason in place of a status — so only statuses archived learners actually hold
are offered. That is what keeps Enrolled and Pending off that tab in the ordinary case, while
still finding the learner an admin archived by hand mid-year with their Enrolled standing
intact. `graduated` is excluded from that tab outright — not pruned when empty but never
offered, even though the archive is where graduates end up; those rows are found by their
archive reason instead. On both tabs the currently selected filter is never dropped, or the
select would go blank while still filtering on it (the one path that can still surface
Graduated on Archived, and only from a hand-written URL). `by_status` already respects the
tab, so one rule reads both. A learner already recorded as
graduated gets a note saying the wizard set it and that choosing a status here
would put them back on the books. The header count no longer claims everyone is
enrolled — it reads "N enrolled · M pending · K left · J archived" from the API's
`by_status` and `archived_count`.

### Students page — Active / Archived

There is no delete on this page. The red `Trash2` is now an amber `Archive`, and the
confirm is `ArchiveConfirm` — one component for both directions, since restoring is the
same act read backwards. It says what archiving actually does (off the roll, gone from
class lists, dashboards and risk scoring; record and history untouched) and carries an
optional reason. It also points at **enrolment status** for a learner who merely left
mid-year: that is the fact status exists to record, and letting the archive absorb it is
how the two got confused in the first place.

**Active / Archived is a pill tab pair above the filter card**, admin-only, held in the
URL as `?archived=1`. It is deliberately *not* an option inside the status select: an
archived learner still carries the status they had when they came off the roll, so
merging the axes would leave each unable to filter the other. Only the Archived tab shows
a count — "Active 9" would restate the number already under the page title.

**Switching tabs clears the status filter** (`setShowArchived` blanks `status`). The tabs do
not offer the same statuses, so a selection carried across lands on a filter the new tab would
never have offered and the list comes up short for a reason that is off screen. Grade, section
and search mean the same thing on both tabs and carry over as before.

On the Archived tab the row is tinted (`bg-slate-50/70`), the Status column becomes an
**Archived** chip over the reason and `archived_at · archived_by_name` (falling back to
"automatic" for the NULL `archived_by` the school-year activation writes, and "Date
unknown" for rows predating the migration), and the four actions collapse to one
**Restore**. Editing a learner or their guardians while they are off the roll invites
changes nobody will see, so restoring comes first. The empty state is its own thing too —
an empty archive is a good state, and offering "Add First Student" there answers a
question nobody asked.

The list also **re-reads on window focus**, the pattern `TeacherDashboard.jsx` uses for its
score-entry widget. Grade level, section and status here are the *active school year's*
snapshot, and three things outside this page rewrite them — activating a school year, saving
the active year on the Enrollment page, and the promotion wizard. None is reachable from
here, so a tab left open showed what was true when it loaded, which reads exactly like the
change not having taken effect. `fetchStudents` already carries the current filters, so the
refresh keeps the tab, grade, section and status selection.

`BatchUploadModal.jsx` distinguishes an LRN held by an archived learner ("restore them
from Students → Archived instead") from a live duplicate, off the `archived` array
`check-lrns` now returns.

### Student Detail — archived learners

An archived learner's page is reachable on purpose: keeping the record is what archiving is
for, so `GET /api/students/:id` serves them to admins. `StudentDetail.jsx` opens with a grey
banner naming the archive reason and date, with the same **Restore** button as the list —
an admin following a link from the Archived tab lands here, and sending them back to another
page to press the same button is a detour, not a safeguard.

**History yes, live signals no.** Grades, Attendance, Behaviour, Competencies and Enrolment
History all load — they are recorded facts, and for an archived learner this page is often
the only place left to read them. The **AI Insights** tab does not: risk, class health and
predictions are computed from rosters that deliberately exclude archived learners, so there
is nothing to compute. `fetchAI` returns early with "This learner is archived, so live
insights are not computed" rather than firing calls that 404 — which previously also raised
a "Student not found" toast on a page that had already loaded the student.

Student Detail's Overview tab gains an **Enrolment History** table
(`enrollmentApi.history`) — the grade/section shown in Student Information is only the
current year, so the history is where the learner's actual path lives. Admin-only; the
endpoint is admin-scoped.

Vocabulary lives in `src/utils/enrollment.js`, a mirror of the backend's
`utils/enrollment.js` (same convention as `utils/roles.js`). `statusClasses()` returns
complete Tailwind class strings rather than interpolating a tone, because Tailwind's
scanner only sees whole class names in source.

### Grades (`pages.jsx` `Grades`)

Two tabs over one filter set (school year, class, subject): **Grading Sheet** (period
grades + average from `gradesApi.getBySubject`) and **Grade Summary** (weighted category
breakdown for one period from `scoreApi.getBreakdown`).

**A composite learning area adds a third control**, between the filters and the tabs:
the **area tab strip** — `MAPEH (average)` plus one tab per area. The Subject filter
lists learning areas only; the strip picks which of the five sheets underneath it is on
screen. It is the same idiom Score Entry uses (see that section) with **one difference:
here the roll-up is a tab, and the default one.** Score Entry cannot offer MAPEH itself —
a learning area with areas is not gradeable and `POST /api/scores` refuses it — but this
page reads, and the roll-up is the grade that reaches the report card, so it leads the
strip and `areaId: ''` means it. A stale `areaId` falls back to the roll-up rather than
to nothing, and there is no unsaved-work confirm: the page only reads.

**`viewingRollup` replaced `isComposite`** — the distinction is *the roll-up is on
screen*, not *the subject has areas*, because an individual area is an ordinary gradeable
subject and behaves exactly like Math. It drives the averages banner and which **Grade
Summary** the tab renders:

| Selected | Grade Summary shows |
|---|---|
| an ordinary subject, or one area | weighted categories → Initial → Final (`scoreApi.getBreakdown`) |
| the roll-up (`MAPEH (average)`) | one column per **area** → Final → Remarks, for the selected period |

The second is the answer to "what is this grade made of" one level up: MAPEH has no
Written Work of its own, its grade for a period *is* the average of the four areas'
grades for that period. Its numbers come from **`area_grades` on the sheet response**
(see the node-api notes) rather than a request of its own, so the roll-up fetches no
breakdown at all — that effect returns early on `viewingRollup`. A blank area column
beside a blank Final is the withheld case the banner explains: MAPEH has no grade for a
period until all four areas have one.

Everything else in this section describes an ordinary subject, which an individual area
also is.

The **sheet header** — Learning Area, Grade & Section, Subject Teacher — sits above the tab
switch, not inside a branch, so both tabs carry it. It used to live in the Grading Sheet
branch only, which left Grade Summary as the one view with no caption saying whose marks
these are, and it is the view that needs it most: its columns are weighted category names
(Written Work, Performance Task…) that read identically for every subject in the school.
Both values come from `data`, i.e. `/grades/by-subject`, which is fetched whenever the
filters are complete regardless of the open tab — so the summary needs no request of its
own. `subject_name` is looked up from the subject id; `teacher_name` is resolved from
`teacher_assignments` on `(grade_level, section, subject, school_year)` and renders `—`
when the class has no teacher assigned for that subject.

**Period labels come from the school year, never a literal `Q`.** The Grade Summary's
period chips render `grading.abbr(q)` — `Q1`..`Q4` on a `4Q` year, `T1`..`T3` on a `3T`
one — and its empty state says "this quarter" or "this term" off `grading.periodNoun`.
Both were hardcoded to `Q`, which made the tab the only period label on the page that did
not ask the year what its periods are called: a three-term year read "Q1 Q2 Q3" beside a
Grading Sheet correctly headed 1st/2nd/3rd, on the same screen. The Grading Sheet's own
column heads were already `grading.ordinals`. Every other period selector in the app
(Score Entry, ECE Competency, Student Detail) was already routed through `label()`/`abbr()`.

### Composite learning areas — MAPEH, across the grade surfaces

MAPEH is one learning area graded through four **areas** (Music, Arts, Physical
Education, Health), modelled as `subjects.parent_id` — see the root `CLAUDE.md`.
The frontend rule follows the backend's: **everything that reports counts learning
areas.** Showing the areas *under* the learning area is a different thing and is
what several pages do — Score Entry and Grades through a tab strip, Student Detail
and the parent app through an expandable row. What none of them may do is count an
area beside its learning area in an average, a subject count or a band.

`GET /curriculum/subjects` returns learning areas by default and needs
`include_areas: true` to return the level below. Every row carries `parent_id`,
`parent_name`, `area_count` and `school_year_id`. `area_count > 0` means "graded
through its areas", which is the same thing as "not gradeable".
`/curriculum/subjects/grouped` nests the tree: each learning area carries its
`areas`, which is where the grading modal gets its picker without a second request.

`school_year_id` was added to that projection for this work and fixes an older bug
along the way: the grading modal's "Copy from" reached for `subject.school_year_id`,
the tree never carried it, so `getSubjects({ sy_id: undefined })` fell back to the
active year and offered the wrong year's subjects whenever another was selected.

| Surface | What it does |
|---|---|
| **Curriculum → Subjects** | MAPEH is **one ordinary row** — the areas are not listed here. `EditableItem` shows an "N areas" pill off `area_count` and keeps its grading-config button, which is the way into them (see below). The configured dot means "ready for Score Entry", so on a composite it lights only when *every* area has a structure, never off `has_grading` (a learning area has none of its own). There is **no authoring UI for areas at all** — no Split, no Add, no Delete, no rename: the four are created server-side by `ensureMapehAreas()` whenever a MAPEH exists. A create or rename whose response carries `area_count` refetches rather than patching state, since the server may have just split the subject and the optimistic path cannot invent the areas. |
| **Grading config modal** (`GradingConfigModal.jsx`) | For a composite subject it opens on an **area picker** instead of an editor: one row per area with a Configured / Not set up chip, because MAPEH has no weights of its own. Choosing one points `target` at that area and renders the normal editor with an `ArrowLeft` **back** control top-left ("All MAPEH areas"). Every read and write follows `target`, not `subject`. Saving an area returns to the picker rather than closing — MAPEH needs all four before it produces a grade, so finishing one is the middle of the job. `areaConfigured` is tracked in the modal so a chip updates the moment an area is saved, without waiting on a refetch. An ordinary subject is completely unaffected: no picker, no back control. |
| **Score Entry** | the page that *writes* one level down. Asks for `include_areas` and keeps both levels: the **learning areas** fill the Subject dropdown, the areas fill a **tab strip** under the filters (see that page's section below). An area qualifies through its **parent** being in `allowedSubjects` — mirroring `verifyTeacherAssignment()`. The sheet header and the export filename still read "MAPEH — Music". |
| **Grades** | the Subject filter lists **learning areas only**; a composite one's areas are a **tab strip** under the filters whose **first tab is the roll-up itself** — MAPEH's average is the grade that reaches the report card, so it is a view in its own right and stays the default. The roll-up sheet keeps its banner naming the areas and explaining that a blank cell means one of them has no grade yet. Both inner tabs work on it: **Grading Sheet** is the roll-up per period, and **Grade Summary** becomes an *area* breakdown — one column per area, then Final and Remarks — since MAPEH has no weighted categories of its own (`viewingRollup` picks which summary to render). |
| **Student Detail → Grades** | groups by `parent_subject_name ?? subject_name`. MAPEH is one row, marked "avg. of 4", that expands to show the areas indented. `expandedAreas` is keyed `"SY|||MAPEH"` so the same learning area opens independently per school year. The subject count in the school-year header still counts learning areas. |
| **My Class** | unchanged — `/advisory/grades` returns learning-area columns, so MAPEH is one column and `general_average` is right without any client work. |
| **Attendance**, **Accounts → teacher assignments** | unchanged, and deliberately: both take the default (learning areas only). One teacher handles MAPEH, so it stays one assignment row, and attendance is one roll for the whole learning area. |
| **Grading config "Copy from"** | asks for `include_areas` and excludes subjects that *have* areas. Copying Music's structure to Arts is the most useful thing the picker does once a subject is split; the list labels an area "MAPEH — Music". |

### Score Entry (`ScoreEntry.jsx`)
Teachers only. Class dropdown = `(grade_level, section)` pairs from active-SY assignments. Subject dropdown filtered to the **learning areas** the teacher is assigned to for that class (a composite one's areas are the tab strip below it — see below). Passes `grade_level` + `section` to `scoreApi.getItems` / `scoreApi.saveItems` (items are section-scoped).

Teachers create score items (Quiz 1, etc.) under grading components via a modal, then enter raw scores in a spreadsheet-like grid. Auto-computes T (total) → PS (`T/HPS×100`) → WS (`PS×weight/100`) per component, rolls up to category totals, and saves the final quarterly grade. Adding an item requires a name AND a valid HPS (>0) — validated on frontend before save.

Filter selections (class, subject, area, quarter) and expanded component state persist in `sessionStorage` under `vista_score_entry_filters` via `usePersistedFilter`. School year is locked to active SY. The **period dropdown and the transmutation table both come from the selected school year** via `resolveGradingPolicy()` in `src/utils/grading.js` (mirror of the backend module) — there is no local `QUARTERS` array or `transmuteGrade()` any more.

**The Subject filter picks a learning area; a composite one's areas are tabs.** MAPEH
is assigned, timetabled and attended as one subject, so that is what the dropdown
offers — listing Music, Arts, Physical Education and Health there put four entries in
front of the teacher for one thing they teach, and made switching between them a trip
back through a select. It is *graded* through the four, each with its own weights,
score items and class record, so a **tab strip between the filter card and the sheet**
switches which one is on screen: one filter selection, four sheets, one click apart.
An ordinary subject renders no strip at all.

The split in state is `subjectId` (always a learning area) + `areaId` (an area of a
composite one), with **`activeSubjectId` the one thing the sheet reads** — every
`scoreApi` call, the sheet header, the export and the item modal go through it. It
resolves to `''` when an `areaId` names no area of the current subject, so a stale
selection leaves the page waiting rather than loading another class's scores.

Three rules the strip turns on:

- **A composite subject always lands on an area** (the first, if the stored one does
  not belong to it), so the strip never renders with no active tab. The effect that
  does this returns early until `subjects` has loaded — clearing a persisted area on
  the first render would undo the selection the page was reopened on.
- **A stored `subjectId` naming an area is promoted to (learning area, area)** rather
  than dropped. That covers a filter blob persisted before this change *and* both deep
  links into the page: TeacherDashboard's Resume reports score progress per area (the
  FastAPI `gradeable` list expands MAPEH into four), while Student Detail's DSS action
  can carry the learning area's own id. Neither writes `areaId`, and neither needs to —
  the mapping lives in one place here.
- **Switching tabs with unsaved scores confirms first.** The class, subject and period
  above the strip do not change, so the sheet swapping underneath is the only sign
  anything happened; scores belong to the area they were typed in and cannot follow.

Each tab carries an amber dot when that area has no grading structure (`has_grading`
off the subjects read), because MAPEH has no grade for a period until all four are set
up and the tab is where a missing one is visible without opening it.

The **Grades page** has a strip of its own, shaped differently — see its section above.

Grading config button (sliders icon) shows for Grade 1–6 subjects only — Kinder hides it since it uses competency tracking. The modal has a "Copy from" button that copies another subject's grading structure (filtered by grade level).

**Grade Summary table** groups students by gender (Male/Female) with separator rows. Shows category weighted scores, initial grade, transmuted final grade (color-coded: teal ≥ 75, red < 75), Passed/Failed remarks pill. Category header columns `truncate` with `max-w-[160px]` to handle long names.

**Excel export**: the F column's formula is built from the resolved grading policy — a nested `IF` for `DO8_2015` (a closed form), `ROUND(IN,0)` for `ZERO_BASED`, and a `LOOKUP` against a hidden `_TRANSMUTE` sheet for `DO15_2026`, whose 41 bands no nested `IF` can express. The workbook still recalculates when a teacher edits a score. The button uses `xlsx-js-style` (dynamically imported to avoid Node polyfill warnings). Generates a DepEd-format grading sheet: colored category/component headers, HPS row, students grouped by gender, T/PS/WS/IN/F/Remark columns using Excel formulas so the workbook auto-recalculates when scores are edited. PS/WS/IN rounded via `ROUND()` to 2 decimals. Export is blocked if any component has no score items. Vite config aliases `xlsx-js-style` to its browser bundle (`dist/xlsx.bundle.js`) to avoid Node `stream`/`events`/`buffer` externalization warnings.

### Behavior (`pages.jsx` `Behavior`)
Thin role router over `TeacherBehavior` and `AdminBehavior`.

**TeacherBehavior** — Class dropdown scoped to `activeAssignments`, then Student search (admin-style autocomplete by name or LRN via `studentApi.list({grade_level, section, search})`) plus log cards + modal. Log card avatars show a teal `Pencil` icon + "Logged by you" (teachers only see their own logs).

**AdminBehavior** — read-only school-wide browser. 4-card stat strip (Total/Positive/Neutral/Negative via `behaviorApi.summary`). Filter card is 5 fields (3 columns on `lg:`, one row on `xl:`): Student (autocomplete by name/LRN), **Grade Level**, **Section**, Category, Sentiment. Grade level and section are two dropdowns rather than one combined "Class" — the useful question is usually a whole grade level, which the paired list could not ask. Both read `curriculumApi.getSections()`, which the API already orders by grade level and scopes to the caller, so the grade options need no constant of their own; Section is disabled until a grade level is picked and re-filters to it, and changing grade level clears the section. Picking a student auto-fills both from the student's grade/section and **disables** them; typing in Student or clicking top-of-card Clear unlocks them by clearing `student_id` + `grade_level` + `section` together. Table: Student (linked to `/students/:id`) · Class · Category · Sentiment · Teacher · Details. Details opens a Modal with Student/Teacher/Date & Time/Subject/Category/Sentiment (with score) + full observation text — **no** Log/Edit/Delete actions. Paginated 50/page.

### SecurePass (`pages.jsx` `SecurePass`)
`/securepass` is **oversight-only** — admins and teachers monitor dismissal activity, they do not scan. Page renders: stat strip (dismissed / failed / total today) + today's dismissal log table (Student · Guardian · Status · Time). No "Open Scanner" button, no manual-verify fallback.

Actual gate scanning lives in the **`vista_guard` Flutter app** (`vista-mobile/vista_guard/`) which opens the device camera, requires the guard to type the authorized guardian's name per scan, and posts to `POST /api/dismissal/verify`. The web-based scanner and paste-JSON fallback were removed because they duplicated the guard app while bypassing the guardian-name capture. The `/securepass/scan` route is gone; the `dismissalApi.verify` wrapper in `api/client.js` was removed too (nothing on the web frontend calls the verify endpoint anymore — the backend endpoint stays for the guard app).

### ECE Competency (`pages/EceCompetency.jsx`)
Route is `roles={['admin', 'teacher']}`. Teacher reaches it from the "Today's Work" sidebar group (Baby icon); admin reaches it from the *Student Management* sidebar group (Baby icon, placed right after Grades as the ECE counterpart) **or** the ECE Competency Overview card's `View` link on the dashboard. Fetches subjects for the selected class's grade level via `curriculumApi.getSubjects` and uses them as domain cards. Skills (descriptions) are grouped by `subject_id`.

Subject cards are drag-and-drop reorderable (HTML5 DnD with `GripVertical` grip); order persists per class in `localStorage` as `vista_ece_subject_order_${grade_level}||${section}` and restores on load. Auto-scroll triggers near top (below Topbar) / bottom viewport edges during drag.

**Save is a sticky bottom bar** (same pattern and classes as Attendance above), shown only when
ratings differ from what was loaded, with the class and period named and a Discard beside Save.
The count diffs `grid` against a `loaded` **state** — state rather than a ref on purpose, since a
ref would not re-render after a save and the bar would go on claiming unsaved ratings that had
already reached the server.

Each subject card expands to student rows; each student row shows a rated count badge and expands to skill rows with solid-colour rating buttons **derived from the selected class's configured scale** via `ratingOptions(scaleId)` (clicking a rating twice clears it). The legend and the admin rating-filter pills come from the same source, and the filter resets when the scale changes. Teachers manage skills per subject via "Manage" and "+ Add" buttons in the card header — inline add/edit/delete with a single description field. Per-subject "Expand All / Collapse All" toggle. Save is a single bulk POST.

**Admin read-only mode** (`isReadOnly = user.role === 'admin'`):
- Class source branches by role: teachers use `activeAssignments` filtered to ECE grades; admin fetches all school sections via `curriculumApi.getSections()` and filters to ECE grade levels on mount.
- Page header shows a review-oriented subtitle; no badge/chip (the previous "Read-only · Admin view" chip was removed — the subtitle carries the intent).
- Save button, Manage / + Add subject controls, skill-management list, inline add/edit/delete forms are all hidden.
- Rating buttons replaced: the existing rating renders as a single non-interactive colored badge; unrated cells show an italic "Not rated" placeholder. Drag-and-drop reorder stays enabled when no rating filter is active (localStorage-only, non-destructive).
- **Rating filter** (admin-only, in the filter card next to Class + Quarter): pills `All` / `E` / `G` / `F` / `NA`; click a pill to show only students with at least one skill at that rating; click the same pill (or `All`) to clear. When a filter is active: (1) subjects with zero matches are hidden entirely, (2) students with zero matches in a visible subject are hidden, (3) in the expanded skill list only skills at the selected rating render, (4) the student-row pill swaps from `rated/total` (emerald/amber/slate) to a filter-colored `{count} {rating}` badge, (5) the subject-header `{N} student{s}` label becomes `{visible} of {total} students with {rating} rating`, (6) drag-and-drop subject reorder is disabled (and the `GripVertical` grip is hidden) because hidden subjects would make indices inconsistent, (7) `Expand All / Collapse All` operates only on the currently visible students. Expand/collapse per student is preserved so long lists stay manageable — rows do **not** auto-expand on filter change.
- Filter is intentionally not exposed to teachers — teachers need to see unrated students in order to rate them, and filtering would hide them.
- No backend guard changes needed — `verifyEceAssignment()` in `ece.routes.js` already short-circuits for admin on GET `/records`, and the admin UI never calls POST `/records`.

ECE Catalog tab was removed from `CurriculumManagement.jsx` — subjects are managed in the existing Subjects tab.

### Announcements (`pages.jsx` `Announcements`)
Admin-only write, everyone reads (filtered server-side by audience — see `announcement.routes.js`). Admins get a **Post Announcement** button plus an `All / My Posts` pill toggle in the header; `My Posts` filters client-side to `a.posted_by === user.id` and the empty state flips to "You haven't posted anything yet." Each card shows pencil + trash action buttons only when the current user is the poster (`a.posted_by === user.id`); the pencil reuses the same Modal prefilled with title/content/audience (submit label flips to "Save Changes"), and the trash opens a small confirm modal with a red Delete button. Audience dropdown has four options: **Everyone** (brand pill), **Admins Only** (amber pill — internal-only, invisible to teachers/parents), **Parents Only**, **Teachers Only** (both blue pill).

### Profile (`pages/Profile.jsx`)
Any authenticated role at `/profile`. Account summary card (avatar, full_name, role pill, email, phone, "Member since"). Editable **Personal Information** form (surname/first_name/middle_name/phone; email is disabled with helper text). **Change Password** form (current + new + confirm with individual show/hide toggles); 401 surfaces inline as "Current password is incorrect" rather than a toast. Teacher-only **My Teaching Assignments** read-only card rendered from `activeAssignments`. Calls `updateUser(patch)` from AuthContext after save so the sidebar updates immediately.

### Teacher-assignment dropdown (Accounts → Edit Teacher)
Subjects already taken by another teacher for that `(grade_level, section)` are disabled in the dropdown and shown with the assigned teacher's name. Taken subjects render in red via inline `style` to override the parent `<select>` color; available subjects use normal color.

Scoped admins (`admin_ece`, `admin_elem`) see **all** teachers in the list (both admin tiers share the same roster). Inside `TeacherForm` the grade-level `<select>` options are filtered to `gradeScope`; existing assignment rows whose `grade_level` sits outside the caller's scope render as `locked` — all three `<select>` are disabled, the remove (`X`) button is replaced with a "Locked" badge, and the row's current grade/section/subject values render as synthetic `<option>`s so the display stays readable. Locked rows are passed through to the backend untouched and preserved by the scope-aware DELETE in `PUT /api/accounts/teachers/:id`. The "Copy from previous SY" flow filters copied rows to in-scope grades and prepends existing locked rows so out-of-scope assignments aren't wiped.

### Grading config modal (`GradingConfigModal.jsx`)
Category weight fields turn red when total > 100%; component weight fields turn red when their total exceeds the parent category's weight. Negative percentage values are clamped to 0. Delete buttons gray out for categories/components with recorded student scores.
