-- ============================================================
-- VISTA Migration: give every MAPEH its four areas
-- 2026-09-07
-- ============================================================
--
-- Follows 2026_09_06_subject_areas.sql, which added `subjects.parent_id`.
--
-- MAPEH is graded through exactly four areas -- Music, Arts, Physical Education,
-- Health -- wherever it exists. That is a DepEd fact, not a per-school choice, so
-- there is no UI for composing the list and no endpoint that takes one: the four
-- are created by `ensureMapehAreas()` in utils/subjectAreas.js whenever a MAPEH
-- can come into existence (a new subject, a rename to MAPEH, a copied school
-- year). This backfill is that same rule applied to the rows that already exist.
--
-- Re-runnable: the `NOT EXISTS` on existing areas makes a second run a no-op.
--
-- Four conditions, each load-bearing:
--
--   1. The subject is a MAPEH and a learning area, not an area itself.
--      `~*` with \y word boundaries, so MAPEH / Mapeh / MaPeH and "MAPEH 4"
--      all qualify while "Mapehematics" does not.
--   2. It has no areas yet. Only a completely unsplit MAPEH is filled in, so a
--      school that has renamed "Physical Education" to "P.E." does not get a
--      fifth area on the next run.
--   3. It holds no grades, score items or grading structure OF ITS OWN. Adding
--      areas makes its grade derived, so marks recorded directly against it
--      would be stranded -- computed by rules that no longer apply. Such a MAPEH
--      is left flat and keeps working exactly as it did; splitting it is then a
--      deliberate act, not something a migration does behind an admin's back.
--   4. None of the four names is already taken in that (school year, grade
--      level). All-or-nothing: three of four would leave MAPEH quietly
--      averaging the wrong number of areas.

INSERT INTO subjects (name, grade_level, school_year_id, parent_id)
SELECT a.name, m.grade_level, m.school_year_id, m.id
  FROM subjects m
  CROSS JOIN (VALUES ('Music'), ('Arts'), ('Physical Education'), ('Health')) AS a(name)
 WHERE m.is_active = TRUE
   AND m.parent_id IS NULL
   AND m.name ~* '\ymapeh\y'
   AND NOT EXISTS (SELECT 1 FROM subjects c
                    WHERE c.parent_id = m.id AND c.is_active = TRUE)
   AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.subject_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM score_items si
                    WHERE si.subject_id = m.id AND si.is_active = TRUE)
   AND NOT EXISTS (SELECT 1 FROM grading_structure gs
                    WHERE gs.subject_id = m.id AND gs.is_active = TRUE)
   AND NOT EXISTS (SELECT 1 FROM subjects x
                    WHERE x.school_year_id = m.school_year_id
                      AND x.grade_level    = m.grade_level
                      AND x.is_active      = TRUE
                      AND x.name IN ('Music', 'Arts', 'Physical Education', 'Health'));

-- Any MAPEH still flat after this hit condition 3 or 4 and needs a look:
--
--   SELECT sy.label, m.grade_level, m.name
--     FROM subjects m JOIN school_years sy ON sy.id = m.school_year_id
--    WHERE m.is_active AND m.parent_id IS NULL AND m.name ~* '\ymapeh\y'
--      AND NOT EXISTS (SELECT 1 FROM subjects c WHERE c.parent_id = m.id AND c.is_active);
