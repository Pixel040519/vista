-- ============================================================
-- VISTA Migration: give attendance a real school year
-- Run once:  psql vista_db -f database/migrations/2026_08_23_attendance_school_year.sql
-- ============================================================
--
-- `attendance` carried a date and nothing else, so anything that needed to know
-- which school year a record belonged to had to infer it by testing the date
-- against `school_years.start_date`/`end_date`. That inference is wrong whenever
-- the school year's dates do not cover the day attendance was taken -- and in
-- practice they often do not: consecutive years leave months unaccounted for
-- between one year's end date and the next one's start date, and every record
-- falling in such a gap belongs to no year at all. It is then invisible to every
-- year-scoped query, including the guard in `enrollment.routes.js` that refuses
-- to delete an enrolment record when the learner has work recorded that year.
--
-- The subject already knew. `subjects` is scoped per school year, and attendance
-- is recorded per subject, so `attendance -> subjects -> school_years` is the
-- authoritative answer. This migration writes that answer down instead of
-- re-deriving a worse one from the clock.
--
-- The column is left **nullable** on purpose. `attendance.subject_id` is itself
-- nullable and was added without a migration, so a database provisioned before
-- April 2026 holds rows with no subject and no backfill; passes 2 and 3 exist for
-- exactly those, and anything still unresolved is honestly unattributed rather
-- than forced into a guess. New rows always get one -- `POST /api/attendance`
-- derives it from the subject it already requires.
--
-- Safe to re-run: every backfill pass is limited to `school_year_id IS NULL`.

BEGIN;

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS school_year_id UUID REFERENCES school_years(id);

-- Pass 1 -- via the subject. Authoritative: `subjects.school_year_id` is NOT NULL,
-- so every row that has a subject is resolved here and none of the fallbacks
-- below can overrule it.
UPDATE attendance a
   SET school_year_id = sub.school_year_id
  FROM subjects sub
 WHERE sub.id = a.subject_id
   AND a.school_year_id IS NULL;

-- Pass 2 -- via a sibling row. Attendance is unique per (student, date, subject),
-- so a learner with no subject on one row often has another row the same day that
-- pass 1 already resolved. A learner cannot be in two school years on one day,
-- which is what makes this safe rather than a guess.
UPDATE attendance a
   SET school_year_id = peer.school_year_id
  FROM (
    SELECT DISTINCT ON (student_id, date) student_id, date, school_year_id
      FROM attendance
     WHERE school_year_id IS NOT NULL
  ) peer
 WHERE peer.student_id = a.student_id
   AND peer.date       = a.date
   AND a.school_year_id IS NULL;

-- Pass 3 -- via the date, the old heuristic, kept only for rows with neither a
-- subject nor a sibling. Years whose dates overlap would make this ambiguous, so
-- it takes the earliest match and skips years with no dates set at all.
UPDATE attendance a
   SET school_year_id = sy.id
  FROM (
    SELECT id, start_date, end_date FROM school_years
     WHERE start_date IS NOT NULL AND end_date IS NOT NULL
  ) sy
 WHERE a.date BETWEEN sy.start_date AND sy.end_date
   AND a.school_year_id IS NULL;

-- Year-scoped lookups per learner: the guard above, and any per-year attendance
-- report. Mirrors `idx_ece_records_student`, which leads on the same two columns.
CREATE INDEX IF NOT EXISTS idx_attendance_student_sy
    ON attendance(student_id, school_year_id, date);

-- `UNIQUE(student_id, date, subject_id)` is deliberately left alone: the upsert in
-- `POST /api/attendance` targets it by exactly that column list, and widening it
-- would break the ON CONFLICT clause at runtime.

COMMIT;

-- What could not be attributed, if anything:
--   SELECT COUNT(*) FROM attendance WHERE school_year_id IS NULL;
