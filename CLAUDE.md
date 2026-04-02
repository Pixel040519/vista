# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VISTA is a Student Monitoring System for elementary schools. It uses a monorepo structure with three services:

- **`vista-backend/node-api/`** — Express.js REST API (port 5000)
- **`vista-backend/fastapi-ai/`** — Python FastAPI AI microservice (port 8000)
- **`vista-dashboard/`** — React + Vite frontend (port 5173, proxies `/api` → port 5000)

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
> The venv must be created at `vista-backend/fastapi-ai/venv/` — if it was built at a different path, delete and recreate it with `python -m venv venv`. Always set `PYTHONIOENCODING=utf-8` on Windows to avoid emoji encoding errors in startup logs.

## Environment Setup

Copy `vista-backend/.env.example` to `vista-backend/node-api/.env`. Required vars:
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` — PostgreSQL connection
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN` — JWT auth
- `PORT` — API port (default 5000)

The Vite dev server proxies `/api/*` to `http://localhost:5000`, so the frontend always calls relative `/api/` paths.

## Architecture

### Request Flow
```
React Dashboard → Node.js API (/api/*) → PostgreSQL
                                        → FastAPI (/api/ai/* proxied to :8000)
```

### Node.js API Route Structure (`vista-backend/node-api/src/`)
- `server.js` — Entry point, middleware setup, route registration
- `routes/` — One file per feature domain (auth, students, attendance, grades, behavior, dismissal, notifications, announcements, accounts, curriculum, score)
- `config/database.js` — PostgreSQL pool (max 20 connections), query wrapper, transaction helpers
- `config/migrate.js` — DB migration runner
- `middleware/auth.js` — JWT verification middleware

### FastAPI AI Service (`vista-backend/fastapi-ai/`)
- `main.py` — Entry point, router registration
- Routers: `/analyze` (VADER sentiment), `/predict` (grade prediction via Linear Regression), `/classify` (risk assessment), `/dashboard` (aggregated stats — attendance counts use distinct students, not raw records, with priority Present > Late > Excused > Absent when a student has multiple subject records)

### React Dashboard (`vista-dashboard/src/`)
- `main.jsx` — Router setup, AuthContext provider
- `api/client.js` — Axios instance with JWT interceptors
- `pages/` — One component per route
- `components/` — Shared UI components (`GradingConfigModal.jsx` for per-subject grading structure config)
- Routes: `/login`, `/` (dashboard), `/students`, `/students/:id`, `/attendance`, `/grades`, `/score-entry`, `/behavior`, `/securepass`, `/risk`, `/announcements`

## Database

PostgreSQL database `vista_db`. Schema is in `vista-backend/database/vistaDB_query.sql`.

Key tables and relationships:
- `users` — All accounts (admin, teacher, parent roles); uses `surname`/`first_name`/`middle_name` fields (no `home_address` column — removed)
- `students` — Student profiles with LRN, grade_level, section, QR code for SecurePass
- `parent_student` — Many-to-many guardian↔student relationships
- `class_assignments` / `teacher_assignments` — Teacher to class/subject mappings scoped to a school year; each (grade_level, section, subject, school_year) combination can only be assigned to one teacher (enforced by backend validation on create/update). Assignments are created under the active school year label (resolved via `getActiveSYLabel()`). When editing a teacher, only assignments for the active SY are deleted and replaced — historical assignments from prior years are preserved. Teacher assignments are copied when creating a new school year with "copy from".
- `attendance` — Per-subject daily records per student (Present/Absent/Late/Excused); has `subject_id` FK to `subjects`; unique on `(student_id, date, subject_id)` so each teacher records attendance independently per subject
- `subjects` — Curriculum subjects scoped to grade level and school year
- `grades` — Per-subject, per-quarter grades (auto-computed from score entry); `score` column = initial grade (weighted average), `grade` column = DepEd transmuted grade, `remarks` = "Passed"/"Failed"
- `grading_structure` — Configurable grading categories and components per subject (self-referencing via `category_id`); top-level rows (`category_id IS NULL`) are categories (e.g., Written Tasks 30%), child rows are components (e.g., Quizzes 15%)
- `score_items` — Individual assessments (e.g., Quiz 1, Long Test 2) under a grading component, scoped to subject + quarter; has `highest_possible_score` (HPS) and `component_id` FK to `grading_structure`
- `student_scores` — Per-student raw scores for each score item; unique on `(score_item_id, student_id)`
- `behavior_logs` — Teacher observations with VADER sentiment compound score
- `risk_assessments` — AI risk classification (Stable/Moderate/High)
- `academic_predictions` — Grade forecasts with confidence scores
- `dismissal_logs` — SecurePass QR scan/authorization records
- `school_years` — School year management; status is controlled by `is_active` (one at a time) and `is_upcoming` (one at a time); no `is_current` column
- `sections` — Class sections scoped to a grade level and school year

Supported grade levels: Pre-Nursery, Nursery, Pre-Kinder, Kinder, Grades 1–6.

## Key Conventions

- Authentication uses JWT (access + refresh tokens); the Node API validates tokens before all protected routes.
- The AI service is called by Node.js internally — the frontend never calls FastAPI directly.
- Behavior logs store a `vader_compound` score (−1 to 1) alongside the teacher's raw observation text. Behavior logs support edit (PUT) and delete (DELETE) via `/api/behavior/:id`.
- SecurePass uses QR codes generated per-student; dismissal requires matching an authorized guardian.
- All name fields use `surname`, `first_name`, `middle_name` (not a single `full_name` field).
- School year status: exactly one may be `is_active` (enforced in a transaction); multiple may be `is_upcoming`; all others are archived. The backend enforces both constraints in transactions. Past years (end year ≤ current year) cannot be set to upcoming. The `resolveSYId` helper falls back to the active school year when no `sy_id` is provided.
- Account Management: the teacher list and assignment-related queries (`GET /api/accounts/teachers`, `GET /api/accounts/assignments`, `getAssignments()` helper) are scoped to the active school year. Each teacher row has a History button (clock icon) that opens a modal showing all assignments grouped by school year (via `GET /api/accounts/teachers/:id/assignment-history`). When editing a teacher, the Teaching Assignments section has a "Copy from..." dropdown that lists previous school years (excluding the active SY) with assignment counts; selecting a year replaces the current assignment rows with that year's assignments.
- Grading structure percentage fields reject negative values (clamped to 0). Category weight fields turn red when the total exceeds 100%; component weight fields turn red when their total exceeds the parent category's weight. The grading config modal has a "Copy from" button that lets you copy another subject's grading structure (filtered by grade level).
- Grading structure: each subject can have a configurable grading breakdown (categories + components with percentage weights). The `grading_structure` table uses `category_id` (self-referencing FK) where `NULL` = top-level category, non-NULL = component under that category. Category weights must sum to 100%; component weights must sum to their parent category's weight. Grading structures are copied when creating a new school year with "copy from". The curriculum management UI exposes a per-subject grading config modal (sliders icon). Editing grading structure preserves existing UUIDs (update in place, not delete-and-recreate) so `score_items.component_id` FK references remain valid. Categories/components with recorded student scores cannot be deleted — the backend blocks it and the frontend grays out delete buttons.
- Score entry: teachers can only access their own teaching assignments. The filter bar shows a "Class" dropdown (grade_level + section pairs derived from the teacher's active SY assignments) and a "Subject" dropdown filtered to subjects the teacher is assigned to for that class. The backend enforces assignment ownership via `verifyTeacherAssignment()` on all score endpoints (GET/POST scores, GET breakdown, POST/DELETE score items). Teachers create score items (e.g., Quiz 1, Quiz 2) under grading components via a modal, then enter raw student scores in a spreadsheet-like grid. The system auto-computes T (total) → PS (percentage score = T/HPS×100) → WS (weighted score = PS×weight/100) per component, rolls up to category totals, and saves the final quarterly grade to the `grades` table. Score items with recorded scores cannot be deleted; items without scores are hard-deleted from DB. Adding a score item requires both a name and a valid HPS (> 0) — the frontend validates before saving. Filter selections (class, subject, quarter) and expanded component state persist in `sessionStorage` across navigation and refresh. The school year filter is locked to the active school year (displayed as read-only "SY 2025-2026").
- DepEd transmutation (DO 8, s. 2015): initial grades (weighted averages) are transmuted to a 60–100 scale before saving as the final grade. The `transmuteGrade()` function exists in both backend (`score.routes.js`) and frontend (`ScoreEntry.jsx`). Formula: initial ≥ 100 → 100; initial ≥ 60 → 75 + floor((initial−60)/1.6) capped at 99; initial > 0 → 60 + floor(initial/4) capped at 74; else 60. Passing = transmuted ≥ 75.
- Excel export: the Score Entry page has an "Export Excel" button (uses `xlsx-js-style`) that generates a DepEd-format grading sheet with colored category/component headers, HPS row, students grouped by gender (Male/Female), and T/PS/WS/IN/F/Remark columns. T, PS, WS, IN, F, and Remark cells use Excel formulas so the spreadsheet auto-recalculates when scores are edited. PS, WS, and IN values are rounded to 2 decimal places via `ROUND()` formulas. Export is blocked if any component has no score items.

## Role-Based Access

- **Admin**: Full access to all pages except Attendance and Score Entry (teacher-only). Can manage accounts, curriculum, students, and view student details.
- **Teacher**: The `/api/auth/me` and `/api/auth/login` endpoints return `assignments` (grade_level, section, subject, school_year) and `active_school_year` (label of the active SY) for teachers. The `AuthContext` exposes `activeAssignments` — assignments filtered to the active school year. Teacher-facing pages (Students, Attendance, Score Entry) use `activeAssignments` to show a "Class" dropdown filtered to their assigned sections instead of open grade/section filters. Attendance and Score Entry are teacher-only in both sidebar and route guards. Attendance backend: GET is open to admin+teacher (student detail page uses it), POST is teacher-only and requires `subject_id`.
- **Parent**: Limited access; students endpoint filters to linked students via `parent_student` table.
- Teacher assignments are unique per (grade_level, section, subject, school_year) — the backend rejects duplicates on create/update scoped to the active school year, and the frontend disables already-taken subjects in the assignment dropdown (showing the assigned teacher's name). In the subject dropdown, available subjects use normal color; taken subjects are red with inline `style` to override the parent `<select>` color.

## Frontend UI Patterns

### Sidebar Navigation
- The sidebar groups nav items into 4 sections: **Overview** (Dashboard), **Student Management** (Students, Attendance, Grades, Score Entry, Behavior), **Tools** (SecurePass, Risk Overview, Announcements), **Administration** (Accounts, Curriculum). Groups with no visible items for the user's role are auto-hidden. Score Entry and Attendance are visible to teacher role only.
- The Grade Summary table in Score Entry groups students by gender (Male/Female) with separator rows, shows category weighted scores, initial grade, transmuted final grade (color-coded: teal ≥ 75, red < 75), and a Passed/Failed remarks pill. Category header columns use `truncate` with `max-w-[160px]` to handle long names.

### Responsive Layout
- The sidebar (`Sidebar.jsx`) is hidden on mobile (`-translate-x-full`) and slides in via a hamburger menu in the Topbar; it is always visible on `lg:` (1024px+) screens.
- `Layout.jsx` applies `lg:ml-64` so main content is full-width on mobile and offset on desktop. The main content wrapper uses `min-w-0` to prevent flex children with long text from overflowing the viewport. The sidebar open/close state is managed in Layout and passed as props (`open`, `onClose`) to Sidebar.
- The Topbar shows a `Menu` hamburger icon on mobile (`lg:hidden`) and triggers `onMenuToggle` to open the sidebar.

### Modal (Portal)
- The shared `Modal` component (`components/UI/index.jsx`) renders via `createPortal` into `document.body` so it always sits above the sidebar and layout regardless of stacking context.
- On mobile, modals slide up from the bottom (`items-end`, `rounded-b-none`); on `sm:` and above, they center on screen.

### Tables
- All `table-base` tables must be wrapped in a `<div className="overflow-x-auto">` container to enable horizontal scrolling on narrow screens.
- Table header cells use `whitespace-nowrap` to prevent awkward column header wrapping.

### Responsive Breakpoints
- Use mobile-first Tailwind: base styles for mobile, then `sm:` (640px), `md:` (768px), `lg:` (1024px) for larger screens.
- Page titles: `text-xl sm:text-2xl`. Page subtitles: `text-xs sm:text-sm`.
- Page headers should use `flex-wrap gap-3` so action buttons wrap below the title on small screens.
- Form grids inside modals: prefer `grid-cols-1 sm:grid-cols-2` over a hard `grid-cols-2`.
- The `BrowserRouter` in both `App.jsx` and `main.jsx` has `v7_startTransition` and `v7_relativeSplatPath` future flags enabled.
- The body has `select-none` and `cursor-default` globally; `user-select: text` and `cursor: text` are re-enabled on text-type `input` and `textarea` elements; `checkbox` and `radio` inputs use `cursor: pointer`; `select` elements use `cursor: pointer`. This prevents the text caret from appearing on non-interactive elements like titles, headers, and hints.
- All input fields use `onKeyDown` to blur on Enter key press for consistent UX across the app.
- Drag-and-drop reordering (via HTML5 DnD API + grip handle) is used in the grading config modal for categories and in the score items modal for items.
- Attendance page: teacher sees a "Class" dropdown (assigned sections), a "Subject" dropdown (filtered to the teacher's assignments for that class, auto-selected if only one), and a date picker. Attendance is scoped per subject — each teacher records attendance independently for their assigned subject. The subject dropdown resolves subject names to UUIDs via `curriculumApi.getSubjects`. Changing the date or subject loads existing attendance records via `GET /api/attendance/bulk` (with `subject_id` filter) and auto-selects the saved statuses. Clicking an already-selected status deselects it. The `POST /api/attendance` endpoint requires `subject_id` in each record and upserts on `(student_id, date, subject_id)` so re-saving updates existing records without overwriting other teachers' records.
- Students page: teachers see a "Class" dropdown and search with labels; Grade Level and Section columns are hidden (redundant). Admin sees full grade/section filter dropdowns.
