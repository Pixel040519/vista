-- One subject, and one section, per name per grade level per school year,
-- whatever the casing.
--
-- `subjects_sy_grade_name_unique` and `sections_sy_grade_name_unique` compare
-- names byte for byte, so "MAPEH" and "mapeH" — or "Mabini" and "mabini" — were
-- two different rows to them and the Curriculum page accepted both in the same
-- grade level.
--
-- * A second subject splits one learning area's grades, score items and
--   attendance across two rows, while teachers, report cards and every
--   `teacher_assignments` row treat them as one.
-- * A second section is worse: five tables hold a section by its name string,
--   and `assertSectionsExist()` resolves a typed name to the stored spelling
--   case-insensitively, so the batch upload would place a learner in whichever
--   of the two it happened to find.
--
-- The rule is "same name ignoring case and spacing": lower-cased, trimmed, and
-- with runs of whitespace collapsed to one space. The API normalises names on
-- write and compares with the same expression (`NAME_KEY` in `utils/names.js`);
-- these indexes are the backstop for a race between two saves.
--
-- Active rows only. Both tables are soft-deleted, and the original constraints
-- (left in place) already keep a dormant row's exact name; extending the
-- case-insensitive rule to dormant rows would let a deleted "MAPEh", which
-- nobody can see or restore, block a live "MAPEH".
--
-- Refuses to run while two active rows in one grade level and school year
-- differ only by case or spacing, rather than guessing which to keep: either
-- may carry grades, learners, score items or a teacher's assignment. Delete or
-- rename one on the Curriculum page, then re-run.
--
-- Safe to re-run.

DO $$
DECLARE
  clashes TEXT;
BEGIN
  SELECT string_agg(format('%s %s %s: %s', d.kind, sy.label, d.grade_level, d.names), '; ')
    INTO clashes
    FROM (
      SELECT 'subjects' AS kind, school_year_id, grade_level,
             string_agg(format('"%s"', name), ', ' ORDER BY name) AS names
        FROM subjects
       WHERE is_active = TRUE
       GROUP BY school_year_id, grade_level,
                lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
      HAVING COUNT(*) > 1
      UNION ALL
      SELECT 'sections', school_year_id, grade_level,
             string_agg(format('"%s"', name), ', ' ORDER BY name)
        FROM sections
       WHERE is_active = TRUE
       GROUP BY school_year_id, grade_level,
                lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
      HAVING COUNT(*) > 1
    ) d
    JOIN school_years sy ON sy.id = d.school_year_id;

  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate names differing only by case or spacing — %. Delete or rename one of each, then re-run.', clashes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS subjects_sy_grade_name_ci_unique
  ON subjects (school_year_id, grade_level, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))))
  WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS sections_sy_grade_name_ci_unique
  ON sections (school_year_id, grade_level, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))))
  WHERE is_active = TRUE;
