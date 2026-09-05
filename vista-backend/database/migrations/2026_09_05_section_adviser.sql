-- ============================================================
-- VISTA Migration: a teacher adviser on every section
-- Run once:  psql vista_db -f database/migrations/2026_09_05_section_adviser.sql
-- ============================================================
--
-- Until now a teacher was linked to a class only through `teacher_assignments`,
-- which is keyed per **subject** -- (teacher_id, grade_level, section, subject,
-- school_year). That answers "who teaches Math to Grade 3 Mabini". It cannot
-- answer "who is responsible for Grade 3 Mabini", which is the question a class
-- adviser exists to answer, and which the DSS suggestion copy in ai.routes.js
-- has been assuming an answer to ("Flag to the homeroom adviser...").
--
-- The adviser lands on `sections` rather than in a table of its own because
-- `sections` is already uniquely keyed (school_year_id, grade_level, name) --
-- which is *exactly* the scope of an advisory. One nullable column there is
-- automatically per-year and automatically one-adviser-per-section, with no new
-- join and no new invariant to keep.
--
-- The tempting alternative was `class_assignments`, which is already
-- adviser-shaped: UNIQUE(grade_level, section, school_year), no subject column,
-- and completely dormant -- no route inserts, selects or exposes it. It was
-- rejected because it keys on the school-year **label string** and holds the
-- section by name, so it is a sixth entry in the name fan-out that
-- `renameSectionEverywhere()` has to keep in step. `sections.adviser_id` is
-- keyed by the section's own id, so renaming a section or moving it between
-- grade levels carries the adviser for free.
--
-- ON DELETE SET NULL, not CASCADE: hard-deleting a teacher account must not take
-- the section with it. The section stays and simply has no adviser.
--
-- Safe to re-run: the column is added IF NOT EXISTS, the index is created
-- IF NOT EXISTS, and there is no backfill -- the column is new, so nothing
-- exists that could already violate the uniqueness rule.

BEGIN;

ALTER TABLE sections
    ADD COLUMN IF NOT EXISTS adviser_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- One advisory class per teacher per school year.
--
--   * `adviser_id IS NOT NULL` -- unassigned sections must not collide with
--     each other, and there will always be many of them.
--   * `is_active = TRUE` -- sections are soft-deleted (DELETE /sections/:id sets
--     the flag). Without this clause a deleted section would go on holding its
--     teacher hostage, and the admin could not assign them anywhere else.
--   * `adviser_id` leads deliberately: the same index then serves the
--     "which section do I advise" lookup in /auth/login and /auth/me, which
--     filters on adviser_id and joins school_years for the active one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_adviser_sy_unique
    ON sections(adviser_id, school_year_id)
    WHERE adviser_id IS NOT NULL AND is_active = TRUE;

COMMIT;

-- Sections that have an adviser, per school year:
--   SELECT sy.label, COUNT(*) FILTER (WHERE s.adviser_id IS NOT NULL) AS advised,
--          COUNT(*) AS sections
--     FROM sections s JOIN school_years sy ON sy.id = s.school_year_id
--    WHERE s.is_active = TRUE
--    GROUP BY sy.label ORDER BY sy.label DESC;
