-- Remove subjects and sections that were soft-deleted, now that deleting either
-- removes the row for real (`DELETE /api/curriculum/subjects/:id` and
-- `/sections/:id`).
--
-- Both used to set `is_active = FALSE` and leave the row behind. Nothing could
-- see or restore it, and it kept owning its name, so an admin who removed a
-- subject or section by mistake could not add it back under the same name.
-- Deletes are now refused while recorded work depends on the row, which makes
-- keeping it pointless; this clears the rows left from before.
--
-- **Only rows nothing recorded depends on are removed.** A soft-deleted
-- subject was only checked for grades, so an older one can still carry
-- attendance, competency ratings or scores. Those stay exactly as they are —
-- deleting them would cascade the ratings and scores away, and attendance
-- would refuse the delete anyway. A learning area is judged with its areas,
-- since removing it cascades them, and is never removed while it still has an
-- active area.
--
-- Sections are never referenced by id, so a soft-deleted section is removed
-- unless one of the five tables holding sections by name still names it for
-- that grade level and school year (see `utils/sections.js`).
--
-- Safe to re-run.

BEGIN;

-- Subjects with recorded work of their own.
CREATE TEMP TABLE _subject_work ON COMMIT DROP AS
SELECT s.id
  FROM subjects s
 WHERE EXISTS (SELECT 1 FROM grades g     WHERE g.subject_id = s.id)
    OR EXISTS (SELECT 1 FROM attendance a WHERE a.subject_id = s.id)
    OR EXISTS (SELECT 1 FROM ece_competency_records rec
                 JOIN competency_skills k ON k.id = rec.skill_id
                WHERE k.subject_id = s.id)
    OR EXISTS (SELECT 1 FROM student_scores ss
                 JOIN score_items si ON si.id = ss.score_item_id
                WHERE si.subject_id = s.id);

-- Soft-deleted subjects that can go: no work of their own, none under any of
-- their areas, and no active area that the cascade would take with them.
CREATE TEMP TABLE _subject_purge ON COMMIT DROP AS
SELECT s.id
  FROM subjects s
 WHERE s.is_active = FALSE
   AND s.id NOT IN (SELECT id FROM _subject_work)
   AND NOT EXISTS (SELECT 1 FROM subjects c
                    WHERE c.parent_id = s.id
                      AND (c.is_active OR c.id IN (SELECT id FROM _subject_work)));

-- Derived, and the one reference without ON DELETE CASCADE.
DELETE FROM academic_predictions
 WHERE subject_id IN (SELECT id FROM _subject_purge);

DELETE FROM subjects WHERE id IN (SELECT id FROM _subject_purge);

DELETE FROM sections sec
 USING school_years sy
 WHERE sy.id = sec.school_year_id
   AND sec.is_active = FALSE
   AND NOT EXISTS (SELECT 1 FROM student_enrollments e
                    WHERE e.school_year_id = sec.school_year_id
                      AND e.grade_level = sec.grade_level AND e.section = sec.name)
   AND NOT EXISTS (SELECT 1 FROM students st
                    WHERE sy.is_active AND st.grade_level = sec.grade_level AND st.section = sec.name)
   AND NOT EXISTS (SELECT 1 FROM teacher_assignments ta
                    WHERE ta.school_year = sy.label
                      AND ta.grade_level = sec.grade_level AND ta.section = sec.name)
   AND NOT EXISTS (SELECT 1 FROM class_assignments ca
                    WHERE ca.school_year = sy.label
                      AND ca.grade_level = sec.grade_level AND ca.section = sec.name)
   AND NOT EXISTS (SELECT 1 FROM score_items si
                     JOIN subjects sub ON sub.id = si.subject_id
                    WHERE sub.school_year_id = sec.school_year_id
                      AND sub.grade_level = sec.grade_level AND si.section = sec.name);

COMMIT;
