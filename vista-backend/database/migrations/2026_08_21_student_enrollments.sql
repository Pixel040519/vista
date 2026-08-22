-- ============================================================
-- VISTA Migration: per-school-year student enrollment
-- Run once:  psql vista_db -f database/migrations/2026_08_21_student_enrollments.sql
-- ============================================================
--
-- Until now `students` had no school-year dimension at all: `grade_level` and
-- `section` were two mutable strings holding the student's *current* position,
-- overwritten in place with no history. Activating a new school year touched
-- only the `school_years` table, so every student stayed in last year's grade
-- and section, still counted as enrolled -- there was no way to record "has not
-- enrolled yet", "transferred out", or "repeats the level".
--
-- `student_enrollments` gives each student one row per school year. `students`
-- keeps `grade_level`/`section` as the denormalised snapshot of the *active*
-- year (dozens of Node queries and four FastAPI routers read them directly) and
-- gains `enrollment_status` so roster filters stay a single-column predicate.
-- The two are kept in sync by the rollover that now runs inside
-- PUT /api/curriculum/school-years/:id when a year is activated.
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS student_enrollments (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id     UUID NOT NULL REFERENCES students(id)     ON DELETE CASCADE,
    school_year_id UUID NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    grade_level    VARCHAR(20) NOT NULL,
    section        VARCHAR(50),
    -- 'pending'  : rolled over / expected, not yet confirmed enrolled
    -- 'enrolled' : studying this year
    -- 'promoted' / 'retained' : year-end outcome, written by the promotion
    --              wizard (not yet built -- allowed here so it needs no migration)
    -- 'transferred_out' / 'dropped' / 'graduated' : left the school
    status         VARCHAR(20) NOT NULL DEFAULT 'enrolled'
                   CHECK (status IN ('pending','enrolled','promoted','retained',
                                     'transferred_out','dropped','graduated')),
    remarks        TEXT,
    decided_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at     TIMESTAMP,
    created_at     TIMESTAMP DEFAULT NOW(),
    updated_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE (student_id, school_year_id)
);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_sy
    ON student_enrollments(school_year_id, grade_level, section);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_student
    ON student_enrollments(student_id);

-- Current standing, mirrored from the active school year's enrollment row.
-- Narrower than student_enrollments.status on purpose: 'promoted'/'retained'
-- describe a year that has closed and are never a *current* standing.
ALTER TABLE students ADD COLUMN IF NOT EXISTS enrollment_status VARCHAR(20)
    NOT NULL DEFAULT 'enrolled';

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_enrollment_status_check;
ALTER TABLE students ADD CONSTRAINT students_enrollment_status_check
    CHECK (enrollment_status IN ('pending','enrolled','transferred_out','dropped','graduated'));

CREATE INDEX IF NOT EXISTS idx_students_enrollment_status
    ON students(enrollment_status) WHERE is_active = TRUE;

-- Backfill: every student currently on the books is enrolled in the active year
-- at the grade and section they already hold. After this the system behaves
-- exactly as it did before -- the records simply exist now.
INSERT INTO student_enrollments (student_id, school_year_id, grade_level, section, status)
SELECT s.id, sy.id, s.grade_level, s.section, 'enrolled'
  FROM students s
 CROSS JOIN (SELECT id FROM school_years WHERE is_active = TRUE LIMIT 1) sy
 WHERE s.is_active = TRUE
    ON CONFLICT (student_id, school_year_id) DO NOTHING;

COMMIT;
