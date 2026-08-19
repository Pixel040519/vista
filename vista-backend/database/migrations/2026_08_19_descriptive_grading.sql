-- ============================================================
-- VISTA Migration: configurable assessment mode + rating scales
-- DepEd DO 015, s. 2026 — descriptive grading for KS1
--
-- Run once: psql vista_db -f database/migrations/2026_08_19_descriptive_grading.sql
--
-- Additive. With zero rows in the new table the system behaves exactly as it
-- does today (Kinder descriptive on E/G/F/NA, Grades 1-6 numeric),
-- so this is safe to apply with the app live.
--
-- DO 015 Table 12 phases KS1 off numeric grading one level per year:
--   SY 2026-2027  Grade 1 descriptive, Grades 2-3 numeric
--   SY 2027-2028  Grades 1-2 descriptive, Grade 3 numeric
--   SY 2028-2029  Grades 1-3 all descriptive
-- ...but the schedule is DATA here, not code. The school configures each
-- (school year, grade level) itself — NRYS is private, so DO 015 only
-- "encourages" adoption and can set its own pace.
-- ============================================================

-- ── 1. Per (school year, grade level) assessment configuration ──
--
-- assessment_mode:
--   'numeric'     -> `grades` table, weighted average + transmutation
--   'descriptive' -> `ece_competency_records`, rated on `rating_scale`
--
-- rating_scale (required for descriptive, NULL for numeric):
--   'EGFNA'  Excellent / Good / Fair / Needs Assistance   (VISTA's existing ECE scale)
--   'CODVBG' Consistent / Developing / Beginning          (DO 015 Table 7, Kindergarten)
--   'ABCDE'  Advancing / Benchmarking / Connecting /
--            Developing / Emerging                        (DO 015 Table 8, Grades 1-3)
CREATE TABLE IF NOT EXISTS grade_level_assessment (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_year_id  UUID NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    grade_level     VARCHAR(20) NOT NULL,
    assessment_mode VARCHAR(12) NOT NULL
                    CHECK (assessment_mode IN ('numeric','descriptive')),
    rating_scale    VARCHAR(8)
                    CHECK (rating_scale IN ('EGFNA','CODVBG','ABCDE')),
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE (school_year_id, grade_level),
    -- descriptive levels must name a scale; numeric ones must not
    CONSTRAINT grade_level_assessment_scale_check CHECK (
      (assessment_mode = 'descriptive' AND rating_scale IS NOT NULL) OR
      (assessment_mode = 'numeric'     AND rating_scale IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_grade_level_assessment_sy
  ON grade_level_assessment(school_year_id);

-- ── 2. Records carry the scale they were rated on ──────────────
--
-- This is not redundant with the config table. 'E' means **Excellent** under
-- EGFNA but **Emerging** (the lowest level) under ABCDE. If the scale were only
-- derivable from the current configuration, re-configuring a grade level would
-- silently reinterpret every historical rating — turning a top mark into a
-- failing one. Stamping the scale on the row makes each record self-describing
-- and immune to later configuration changes.
ALTER TABLE ece_competency_records
  ADD COLUMN IF NOT EXISTS rating_scale VARCHAR(8) NOT NULL DEFAULT 'EGFNA';

-- Replace the fixed E/G/F/NA constraint with a pairwise one, so a rating is
-- only ever valid for the scale it claims to belong to.
ALTER TABLE ece_competency_records
  DROP CONSTRAINT IF EXISTS ece_competency_records_rating_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ece_records_rating_scale_pair_check'
  ) THEN
    ALTER TABLE ece_competency_records
      ADD CONSTRAINT ece_records_rating_scale_pair_check CHECK (
        (rating_scale = 'EGFNA'  AND rating IN ('E','G','F','NA'))    OR
        (rating_scale = 'CODVBG' AND rating IN ('CO','DV','BG'))      OR
        (rating_scale = 'ABCDE'  AND rating IN ('A','B','C','D','E'))
      );
  END IF;
END $$;
