-- Conditional Access Controller flag for the parent mobile app.
-- When a student's tuition standing is flagged by the school, admin can suspend
-- academic visibility (grades + ECE competency) for linked parents. Safety
-- surfaces (attendance, behavior, dismissal, risk) remain visible at all times.

BEGIN;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS academic_access_suspended BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS academic_access_suspended_reason TEXT;

COMMIT;
