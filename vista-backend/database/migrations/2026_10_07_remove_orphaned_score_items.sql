-- Remove score items stranded under a removed grading component.
--
-- Removing a component from a subject's grading structure (or its category, or
-- clearing the whole structure) soft-deleted the component and left the score
-- items a teacher had set up under it in Score Entry. Every reader builds from
-- the active components, so those items vanished from Score Entry, the grade
-- calculation, the Grade Summary and the export, while still:
--   * blocking the subject's delete ("N score items are recorded under it",
--     with nothing anyone could see to remove);
--   * counting in the teacher dashboard's score-entry progress;
--   * blocking a section's delete or grade move;
--   * making ensureMapehAreas() treat a MAPEH as already holding work.
-- Adding a component of the same name back did not recover them, because that
-- is a new row.
--
-- The grading save and clear now delete those items with their component
-- (`deleteEmptyScoreItems` in curriculum.routes.js). This clears the ones left
-- from before.
--
-- Only items with no recorded scores are removed. Removing a component was
-- always refused while any item under it had a score, so that should be all of
-- them; an item that somehow has scores is kept rather than taking a learner's
-- marks with it.
--
-- Safe to re-run.

DELETE FROM score_items si
 USING grading_structure gs
 WHERE gs.id = si.component_id
   AND gs.is_active = FALSE
   AND NOT EXISTS (SELECT 1 FROM student_scores ss WHERE ss.score_item_id = si.id);
