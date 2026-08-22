-- ============================================================
-- VISTA Migration: split enrolment status from year-end outcome
-- Run once:  psql vista_db -f database/migrations/2026_08_22_split_enrollment_outcome.sql
-- ============================================================
--
-- `student_enrollments.status` was carrying seven values that answer two
-- different questions:
--
--   is this learner attending this school year?
--       pending / enrolled / transferred_out / dropped
--   how did the school year end for them?
--       promoted / retained / graduated
--
-- They are orthogonal -- a learner is *enrolled* in 2025-2026 AND *promoted* at
-- the end of it -- so one column could not hold both. Writing an outcome
-- destroyed the enrolment fact: once the promotion wizard set status='promoted',
-- the record no longer said the learner had ever been enrolled that year. And
-- the Enrollment page's status dropdown offered all seven, so tagging someone as
-- enrolled for the current year meant picking from a list of year-end verdicts.
--
-- After this migration:
--   student_enrollments.status   -- attendance this year   (the Enrollment page)
--   student_enrollments.outcome  -- how the year ended     (the promotion wizard)
--
-- `students.enrollment_status` is deliberately NOT changed. It stays the
-- five-value mirror of the active year's standing, so the nine Node roster
-- filters and three FastAPI ones that read `enrollment_status = 'enrolled'`
-- need no edit.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS outcome         VARCHAR(20);
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS outcome_remarks TEXT;

-- Rows whose status is really an outcome: the learner *was* enrolled that year,
-- and the year ended that way. Move the verdict into its own column and restore
-- the fact the verdict overwrote.
--
-- `remarks` moves with it. That column was serving both "reason they left" (set
-- on the Enrollment page) and "reason I promoted against the recommendation"
-- (set by the wizard), so the two surfaces were overwriting each other.
UPDATE student_enrollments
   SET outcome         = status,
       outcome_remarks = remarks,
       remarks         = NULL,
       status          = 'enrolled',
       updated_at      = NOW()
 WHERE status IN ('promoted', 'retained', 'graduated');

-- The old CHECK was declared inline and unnamed, so Postgres auto-named it
-- `student_enrollments_status_check`. Drop it by that name before narrowing.
ALTER TABLE student_enrollments DROP CONSTRAINT IF EXISTS student_enrollments_status_check;
ALTER TABLE student_enrollments ADD CONSTRAINT student_enrollments_status_check
    CHECK (status IN ('pending', 'enrolled', 'transferred_out', 'dropped'));

ALTER TABLE student_enrollments DROP CONSTRAINT IF EXISTS student_enrollments_outcome_check;
ALTER TABLE student_enrollments ADD CONSTRAINT student_enrollments_outcome_check
    CHECK (outcome IS NULL OR outcome IN ('promoted', 'retained', 'graduated'));

-- Partial: most rows have no outcome until their year is closed.
CREATE INDEX IF NOT EXISTS idx_student_enrollments_outcome
    ON student_enrollments(school_year_id, outcome) WHERE outcome IS NOT NULL;

COMMIT;
