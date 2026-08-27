-- ============================================================
-- VISTA Migration: archive students instead of deleting them
-- Run once:  psql vista_db -f database/migrations/2026_08_27_student_archive.sql
-- ============================================================
--
-- `students.is_active` was a soft-delete tombstone with no way back. The Students
-- page's Remove button set it FALSE, and nothing anywhere set it TRUE again: the
-- roster query hardcoded `is_active = TRUE`, `GET /students/:id` 404'd, and the
-- LRN -- UNIQUE across the whole table via `students_lrn_key` -- stayed taken, so
-- the learner could be neither found nor re-added.
--
-- The column stays, and stops being a tombstone. `is_active = FALSE` now means
-- **archived**: off the school's roll, record intact, restorable. That is already
-- how every reader treats it (class lists, dashboards, risk scoring and the
-- enrolment roster all filter `s.is_active = TRUE`), so nothing downstream has to
-- learn a new rule -- an archived learner simply stops appearing where a departed
-- learner should not appear.
--
-- These three columns are what makes it an archive rather than a disappearance:
-- an archived row can say when it was filed, by whom, and why. That matters more
-- now than it did, because archiving is no longer only something an admin does by
-- hand -- activating a school year archives whoever ended the closing year
-- dropped, transferred out, graduated, or never enrolled at all.
--
--   archived_by IS NULL  ->  the system archived it, at school-year activation
--   archived_by IS NOT NULL -> that admin archived it from the Students page
--
-- All three are nullable and there is no backfill. Rows already inactive when this
-- runs keep NULLs and read as "Archived, date unknown", which is the honest answer:
-- nothing recorded when they were removed, and inventing a timestamp would be worse
-- than admitting the gap.
--
-- Safe to re-run: every statement is IF NOT EXISTS.

BEGIN;

ALTER TABLE students ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMP;
ALTER TABLE students ADD COLUMN IF NOT EXISTS archived_by     UUID REFERENCES users(id);
ALTER TABLE students ADD COLUMN IF NOT EXISTS archived_reason TEXT;

-- The Archived tab is a filtered list ordered by name, and the auto-archive pass
-- at activation scans for active learners. Both lead on `is_active`, which had no
-- index at all -- every roster query in the system filters on it.
CREATE INDEX IF NOT EXISTS idx_students_is_active
    ON students(is_active, surname, first_name);

COMMIT;

-- Rows that predate this migration, if any -- they will render as
-- "Archived, date unknown" until someone restores them:
--   SELECT COUNT(*) FROM students WHERE is_active = FALSE AND archived_at IS NULL;
