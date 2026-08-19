-- ============================================================
-- VISTA Migration: per-school-year grading policy
-- DepEd DO 009, s. 2026 (three-term calendar) +
--        DO 015, s. 2026 (revised classroom assessment)
--
-- Run once: psql vista_db -f database/migrations/2026_08_19_grading_policy.sql
--
-- Purely additive. Both columns carry defaults that reproduce the
-- system's existing behaviour exactly, so this is safe to apply with
-- the app live and is trivially reversible.
--
-- NOTE: the CHECK (quarter BETWEEN 1 AND 4) constraints on grades,
-- score_items and ece_competency_records are intentionally NOT touched.
-- Three terms use periods 1-3, a strict subset of 1-4, so the existing
-- constraints already admit the new model. The per-year period bound is
-- enforced in the application layer, which is the only place that can
-- express "1-4 for archived years, 1-3 for current ones".
-- ============================================================

-- How many grading periods this school year has, and what they are called.
--   '4Q' - four quarters   (DO 8, s. 2015 calendar)
--   '3T' - three terms     (DO 009, s. 2026, effective SY 2026-2027)
ALTER TABLE school_years
  ADD COLUMN IF NOT EXISTS period_model VARCHAR(4) NOT NULL DEFAULT '4Q';

-- How an initial grade (weighted average) becomes the reported grade.
--   'DO8_2015'   - DO 8, s. 2015 transmutation; remarks are Passed/Failed
--   'DO15_2026'  - DO 015, s. 2026 adjusted transmutation table (IG 70.00 -> 75);
--                  remarks are the new descriptors (Advancing..Emerging).
--                  Transitional - applies to SY 2026-2027 only.
--   'ZERO_BASED' - no transmutation at all; the initial grade is rounded to a
--                  whole number. DO 015 s.50, effective SY 2027-2028.
ALTER TABLE school_years
  ADD COLUMN IF NOT EXISTS grading_policy VARCHAR(16) NOT NULL DEFAULT 'DO8_2015';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_years_period_model_check'
  ) THEN
    ALTER TABLE school_years
      ADD CONSTRAINT school_years_period_model_check
      CHECK (period_model IN ('4Q','3T'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_years_grading_policy_check'
  ) THEN
    ALTER TABLE school_years
      ADD CONSTRAINT school_years_grading_policy_check
      CHECK (grading_policy IN ('DO8_2015','DO15_2026','ZERO_BASED'));
  END IF;
END $$;
