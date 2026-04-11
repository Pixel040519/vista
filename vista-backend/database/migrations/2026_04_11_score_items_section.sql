-- ============================================================
-- Migration: add `section` to score_items so items are scoped
-- per teaching section (a teacher handling the same subject in
-- two sections should maintain independent score items).
-- ============================================================

BEGIN;

-- 1. Add column as nullable so existing rows stay valid during backfill.
ALTER TABLE score_items
    ADD COLUMN IF NOT EXISTS section VARCHAR(100);

-- 2. Backfill from recorded student_scores → students.section
--    (use the most common section among students who have scores on the item).
WITH item_section AS (
    SELECT si.id AS item_id,
           (
               SELECT st.section
               FROM student_scores ss
               JOIN students st ON st.id = ss.student_id
               WHERE ss.score_item_id = si.id
               GROUP BY st.section
               ORDER BY COUNT(*) DESC
               LIMIT 1
           ) AS inferred_section
    FROM score_items si
    WHERE si.section IS NULL
)
UPDATE score_items si
SET section = isec.inferred_section
FROM item_section isec
WHERE si.id = isec.item_id
  AND isec.inferred_section IS NOT NULL;

-- 3. For any remaining NULL rows (items with no scores yet), stamp them
--    with the first section from the teacher_assignments row that
--    matches the item's subject + grade_level. Otherwise soft-delete.
WITH fallback AS (
    SELECT si.id AS item_id,
           (
               SELECT ta.section
               FROM teacher_assignments ta
               JOIN subjects s ON s.name = ta.subject AND s.grade_level = ta.grade_level
               JOIN school_years sy ON sy.label = ta.school_year AND sy.id = s.school_year_id
               WHERE s.id = si.subject_id
               ORDER BY ta.created_at ASC NULLS LAST
               LIMIT 1
           ) AS fallback_section
    FROM score_items si
    WHERE si.section IS NULL
)
UPDATE score_items si
SET section = fb.fallback_section
FROM fallback fb
WHERE si.id = fb.item_id
  AND fb.fallback_section IS NOT NULL;

UPDATE score_items
SET is_active = FALSE, updated_at = NOW()
WHERE section IS NULL AND is_active = TRUE;

-- Safety: if any NULL rows remain (all inactive now), backfill with
-- an empty string so the NOT NULL constraint can be applied.
UPDATE score_items SET section = '' WHERE section IS NULL;

-- 4. Enforce NOT NULL and rebuild the unique/partial indexes.
ALTER TABLE score_items ALTER COLUMN section SET NOT NULL;

DROP INDEX IF EXISTS idx_score_items_unique_active;
DROP INDEX IF EXISTS idx_score_items_component;
DROP INDEX IF EXISTS idx_score_items_subject;

CREATE UNIQUE INDEX idx_score_items_unique_active
    ON score_items(component_id, quarter, section, name)
    WHERE is_active = TRUE;
CREATE INDEX idx_score_items_component
    ON score_items(component_id, quarter, section);
CREATE INDEX idx_score_items_subject
    ON score_items(subject_id, quarter, section);

COMMIT;
