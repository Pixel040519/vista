-- Remove 'Other' from students.gender.
--
-- The school records a learner's gender as Male or Female, matching the sex
-- field on DepEd school forms (SF1, SF9), which is also how Score Entry and
-- the Grades page group a class. 'Other' was offered by the Add Student form
-- and the batch upload but had no place in either grouping.
--
-- Refuses to run while any learner still holds 'Other', rather than guessing a
-- replacement: that is a correction someone has to make on the record.
--
-- Safe to re-run: the constraint is dropped and recreated each time.

DO $$
DECLARE
  n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM students WHERE gender = 'Other';
  IF n > 0 THEN
    RAISE EXCEPTION '% student(s) have gender ''Other''. Set each to Male or Female, then re-run.', n;
  END IF;
END $$;

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_gender_check;
ALTER TABLE students ADD CONSTRAINT students_gender_check
  CHECK (gender IN ('Male', 'Female'));
