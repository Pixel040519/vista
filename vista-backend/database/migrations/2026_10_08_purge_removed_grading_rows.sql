-- Delete grading-structure rows that were removed but left in the table.
--
-- Removing a category or component in the grading modal (or Clear All) used to
-- set `is_active = FALSE` and keep the row. Nothing ever read those rows again:
-- every reader, the grading modal's Copy-from and the school-year copy all
-- filter `is_active = TRUE`, and nothing restores one. The grading save and
-- clear now delete removed rows outright (`retireStructureRows` in
-- curriculum.routes.js). This clears the ones left from before.
--
-- **A row that still holds scores is kept**, under itself or, for a category,
-- under any of its components. A teacher who removes a score item in Score
-- Entry after scores were entered only hides it, and keeps the scores.
-- Deleting the component would cascade them away (score_items.component_id and
-- student_scores.score_item_id are both ON DELETE CASCADE), so such a row stays
-- hidden, exactly as the API now leaves it.
--
-- A removed category that somehow still has an active component is also kept,
-- since deleting it would cascade that live component away.
--
-- Safe to re-run.

DELETE FROM grading_structure gs
 WHERE gs.is_active = FALSE
   -- no scores under it, or under any of its components
   AND NOT EXISTS (
     SELECT 1 FROM score_items si
       JOIN student_scores ss ON ss.score_item_id = si.id
      WHERE si.component_id = gs.id
         OR si.component_id IN (SELECT c.id FROM grading_structure c WHERE c.category_id = gs.id))
   -- no live component hanging off it
   AND NOT EXISTS (
     SELECT 1 FROM grading_structure c WHERE c.category_id = gs.id AND c.is_active = TRUE);
