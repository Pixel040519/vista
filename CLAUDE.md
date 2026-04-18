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
- `users` — admin/teacher/parent accounts. Name fields are `surname`/`first_name`/`middle_name` (no `full_name`, no `home_address` on users).
- `students` — student profiles with LRN, grade_level, section, QR code for SecurePass.
- `parent_student` — many-to-many guardian↔student link.
- `teacher_assignments` / `class_assignments` — teacher↔class/subject mappings, scoped to a school year; unique per `(grade_level, section, subject, school_year)`.
- `attendance` — per-student, per-subject, per-day record (Present/Absent/Late/Excused); unique on `(student_id, date, subject_id)` so each teacher records independently per subject.
- `subjects` — curriculum subjects scoped to grade level + school year.
- `grades` — per-subject, per-quarter (`score` = initial weighted avg; `grade` = DepEd transmuted; `remarks` = "Passed"/"Failed").
- `grading_structure` — configurable categories + components per subject (self-ref `category_id`; NULL = category, non-NULL = component).
- `score_items` — individual assessments under a component, scoped to **subject + section + quarter**.
- `student_scores` — per-student raw scores; unique on `(score_item_id, student_id)`.
- `behavior_logs` — teacher observations + VADER `vader_compound` score.
- `risk_assessments` — AI risk tier (Stable/Moderate/High). Factor columns `attendance_factor`/`academic_factor`/`behavioral_factor`/`ece_competency_factor` are `DECIMAL(5,4)` (0–1 scale — normalize before insert, e.g. avg_grade 92 → 0.92). `ece_competency_factor` is populated only for ECE grade levels (Pre-Nursery–Kinder) from the student's latest-quarter rating average (E=1.0 / G=0.75 / F=0.5 / NA=0.25); NULL for Grades 1–6.
- `academic_predictions` — grade forecasts with confidence scores.
- `dismissal_logs` — SecurePass QR scan/authorization records.
- `school_years` — SY management via `is_active` (one) + `is_upcoming` (many). No `is_current` column.
- `sections` — class sections per grade level + school year.
- `competency_domains` / `competency_skills` / `ece_competency_records` — ECE tracker. Records rated on E/G/F/NA scale (Excellent/Good/Fair/Needs Assistance); unique on `(student_id, skill_id, school_year_id, quarter)`.

Supported grade levels: **Pre-Nursery, Nursery, Pre-Kinder, Kinder, Grades 1–6**.

## Cross-cutting Conventions

- **Name fields** are always `surname` / `first_name` / `middle_name`. Never a single `full_name`.
- **Frontend never calls FastAPI directly** — all AI traffic goes through the Node proxy in `ai.routes.js`.
- **JWT auth** on all protected routes (access + refresh tokens). The Node API validates tokens before every protected handler.
- **School year invariants** (enforced in DB transactions): exactly one row may be `is_active`; zero or more may be `is_upcoming`; all others are archived. Past years (end year ≤ current year) cannot be set to upcoming. The `resolveSYId` helper falls back to the active SY when no `sy_id` is provided. Teacher assignments and grading structures are copied when creating a new SY with "copy from".

## Role-Based Access (summary)

Detailed per-feature role behavior lives in the backend/frontend nested `CLAUDE.md` files.

- **Admin** — full access except Attendance and Score Entry (teacher-only). ECE Competency is read-only for admin (entered via the ECE dashboard card's "View" link; Save / Manage / + Add and rating buttons are hidden). Can manage accounts, curriculum, students, and view student details. Risk Overview shows school-wide data via `/api/ai/risk-all`.
- **Teacher** — scoped to `activeAssignments` (from `/api/auth/me`, filtered to the active SY). Teacher-facing pages (Students, Attendance, Score Entry, Behavior, ECE Competency) use a "Class" dropdown filtered to assigned sections instead of open grade/section filters. Risk Overview, the "In Your Class" card on Student Detail, and TeacherDashboard all draw teacher-scoped numbers from `/api/ai/class-health/all` — a single source of truth for teacher-scoped band numbers.
- **Parent** — limited access; students endpoint filters to linked students via `parent_student`.
