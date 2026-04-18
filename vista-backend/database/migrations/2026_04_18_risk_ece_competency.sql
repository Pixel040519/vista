-- ============================================================
-- Migration: Add ECE competency factor to risk assessments
-- Captures competency-based risk signal for Pre-Nursery–Kinder
-- students who have no numeric grades.
-- Rating average scale: E=1.0, G=0.75, F=0.5, NA=0.25
-- ============================================================

BEGIN;

ALTER TABLE risk_assessments
  ADD COLUMN IF NOT EXISTS ece_competency_factor DECIMAL(5,4);

-- Purge rows written by the old classifier when a student had NO data.
-- Old bug: empty attendance fell back to 0/1 → attendance_rate = 0.0 →
-- "critically low" (+2 points) → Moderate Risk with attendance top factor.
-- This pattern is the signature of "no signal at all": zeroed attendance,
-- no grades, zeroed behavior, no competency. Real students with 0% actual
-- attendance would also have behavior or academic signals.
DELETE FROM risk_assessments
WHERE attendance_factor = 0
  AND academic_factor IS NULL
  AND behavioral_factor = 0
  AND ece_competency_factor IS NULL;

COMMIT;
