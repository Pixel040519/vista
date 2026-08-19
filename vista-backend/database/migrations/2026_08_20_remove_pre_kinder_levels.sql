-- ============================================================
-- VISTA Migration: retire Pre-Nursery / Nursery / Pre-Kinder
-- Run once:  psql vista_db -f database/migrations/2026_08_20_remove_pre_kinder_levels.sql
-- ============================================================
--
-- These three levels sit outside DepEd's K-12 scope entirely (DO 015, s. 2026
-- defines Key Stage 1 as Kindergarten to Grade 3) and are no longer part of
-- VISTA's scope. The supported grade levels are now Kinder and Grades 1-6, and
-- `admin_ece` is scoped to Kinder alone.
--
-- The application-layer lists (utils/roles.js, curriculum.routes.js
-- GRADE_LEVELS, and their dashboard mirrors) are the enforcement point — there
-- is no CHECK constraint on `grade_level` anywhere in the schema, so this
-- migration only clears the curriculum rows that were seeded for the retired
-- levels. It is safe to re-run.

BEGIN;

-- ── Guard: never silently orphan a learner ────────────────────
-- Students are the one thing that cannot be re-seeded. If any exist at a
-- retired level, stop and let a human re-enrol them into Kinder first.
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
    FROM students
   WHERE grade_level IN ('Pre-Nursery', 'Nursery', 'Pre-Kinder');
  IF n > 0 THEN
    RAISE EXCEPTION
      'Aborting: % student(s) are still enrolled in Pre-Nursery/Nursery/Pre-Kinder. Move them to Kinder (or archive them) before running this migration.', n;
  END IF;
END $$;

-- ── Assessment configuration ──────────────────────────────────
DELETE FROM grade_level_assessment
 WHERE grade_level IN ('Pre-Nursery', 'Nursery', 'Pre-Kinder');

-- ── Teacher / class assignments ───────────────────────────────
DELETE FROM class_assignments
 WHERE grade_level IN ('Pre-Nursery', 'Nursery', 'Pre-Kinder');

DELETE FROM teacher_assignments
 WHERE grade_level IN ('Pre-Nursery', 'Nursery', 'Pre-Kinder');

-- ── Sections ──────────────────────────────────────────────────
DELETE FROM sections
 WHERE grade_level IN ('Pre-Nursery', 'Nursery', 'Pre-Kinder');

-- ── Subjects ──────────────────────────────────────────────────
-- grading_structure, score_items and competency_skills all cascade from
-- subjects. attendance / grades / academic_predictions do NOT cascade, but
-- they can only exist for a student, and the guard above proved there are
-- none — so the delete below cannot hit those FKs.
DELETE FROM subjects
 WHERE grade_level IN ('Pre-Nursery', 'Nursery', 'Pre-Kinder');

COMMIT;
