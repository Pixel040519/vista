-- ============================================================
-- VISTA Migration: give behavior logs a school year
-- Run once:  psql vista_db -f database/migrations/2026_08_31_behavior_school_year.sql
-- ============================================================
--
-- `behavior_logs` carried only `observed_at`, so nothing could say which school
-- year an observation belonged to. Student Detail's Behavior tab groups a
-- learner's history by year, and a learner who has been in the school for two
-- years has two years of observations with no way to tell them apart.
--
-- Deriving the year from the date is the wrong answer, for the same reason
-- `2026_08_23_attendance_school_year.sql` rejected it: consecutive school years
-- can leave months uncovered between one year's end and the next one's start,
-- and -- as this database shows -- their ranges can also overlap, so a date can
-- match two years at once. The date is evidence, not an answer.
--
-- Unlike attendance there is no subject to ask instead, so the two are split:
--
--   * New rows are stamped by `POST /api/behavior` with the year that is
--     **active when the observation is recorded**. That is not a guess -- a
--     teacher writes an observation while working inside a school year, and the
--     optional `observed_at` in the request only moves the timestamp within it.
--
--   * Existing rows are backfilled below, best evidence first, and anything the
--     passes cannot resolve is left NULL rather than forced into a year. The
--     column is nullable for exactly that reason; the UI shows such rows under
--     "No school year recorded" instead of filing them under someone else's year.
--
-- Safe to re-run: every pass is limited to `school_year_id IS NULL`.

BEGIN;

ALTER TABLE behavior_logs ADD COLUMN IF NOT EXISTS school_year_id UUID REFERENCES school_years(id);

-- Pass 1 -- via the learner's attendance that same day. Attendance knows its
-- year authoritatively (it derives it from the subject), and a learner cannot be
-- in two school years on one day, which is what makes this evidence rather than
-- a guess. Mirrors pass 2 of the attendance migration.
UPDATE behavior_logs b
   SET school_year_id = peer.school_year_id
  FROM (
    SELECT DISTINCT ON (student_id, date) student_id, date, school_year_id
      FROM attendance
     WHERE school_year_id IS NOT NULL
  ) peer
 WHERE peer.student_id = b.student_id
   AND peer.date       = b.observed_at::date
   AND b.school_year_id IS NULL;

-- Pass 2 -- via the date, for rows with no attendance to lean on. Overlapping
-- ranges make this ambiguous, so it takes the earliest match and skips years
-- with no dates set; same rule, and same caveat, as attendance pass 3.
UPDATE behavior_logs b
   SET school_year_id = sy.id
  FROM (
    SELECT id, start_date, end_date FROM school_years
     WHERE start_date IS NOT NULL AND end_date IS NOT NULL
  ) sy
 WHERE b.observed_at::date BETWEEN sy.start_date AND sy.end_date
   AND b.school_year_id IS NULL;

-- Year-scoped lookups per learner, leading on the same two columns as
-- `idx_attendance_student_sy`.
CREATE INDEX IF NOT EXISTS idx_behavior_logs_student_sy
    ON behavior_logs(student_id, school_year_id, observed_at);

COMMIT;

-- What could not be attributed, if anything:
--   SELECT COUNT(*) FROM behavior_logs WHERE school_year_id IS NULL;
