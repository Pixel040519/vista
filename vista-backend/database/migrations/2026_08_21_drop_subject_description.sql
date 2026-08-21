-- ============================================================
-- VISTA Migration: drop subjects.description
-- Run once:  psql vista_db -f database/migrations/2026_08_21_drop_subject_description.sql
-- ============================================================
--
-- The subject add/edit forms in Curriculum Management carried an optional
-- "Description" field that nobody used — every one of the 155 subjects in the
-- database had it NULL. The field is gone from both forms and from the subject
-- routes, so the column has no reader and no writer left.
--
-- Not to be confused with `competency_skills.description`, which is the ECE
-- skill text and stays exactly as it is.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE subjects DROP COLUMN IF EXISTS description;

COMMIT;
