-- ============================================================
-- VISTA Migration: composite learning areas (MAPEH)
-- 2026-09-06
-- ============================================================
--
-- MAPEH is one DepEd learning area whose grade is built from four separately
-- graded areas: Music, Arts, Physical Education, Health. DO 8, s. 2015 --
-- "individual grades are given to each area ... the quarterly grade for MAPEH
-- is the average of the quarterly grades in the four areas."
--
-- Each area needs its own Written Work / Performance Task / Quarterly
-- Assessment tree and its own score items, and both of those already hang off
-- `subject_id`. So an area is a subject row that points at its parent, rather
-- than a third level inside `grading_structure` -- which would have broken the
-- two-level assumption baked into both tree builders, both weight validators
-- and the category->component->item fold in POST /api/scores.
--
-- NULL parent_id = a learning area (every subject that exists today).
-- Non-NULL      = an area of one. ON DELETE CASCADE because an area has no
--                 meaning without its learning area.
--
-- The MAPEH grade itself is a DERIVED, STORED row in `grades`, recomputed by
-- utils/subjectAreas.js whenever one of its areas is written. It is stored
-- rather than computed on read so that the seven AVG(grade) sites across Node
-- and FastAPI, the promotion wizard's DO 8 Table 10 count, and the parent app
-- all keep seeing exactly one row per learning area.

ALTER TABLE subjects
    ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES subjects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_subjects_parent
    ON subjects(parent_id) WHERE parent_id IS NOT NULL;
