-- Remove SecurePass: the dismissal QR, the gate guard, and pickup authorization.
--
-- The school no longer runs pickup through VISTA. This drops everything that
-- existed only for it:
--
--   dismissal_logs              every gate scan (history is lost — back up first)
--   authorized_pickup_persons   the non-account fetchers a parent registered
--   students.qr_*               the live QR token and its fetcher binding
--   parent_student.is_authorized_pickup
--   users with role 'security_guard', and the role itself
--   notifications of type 'pickup' / 'dismissal', whose deep link has no target
--
-- Photos stored under uploads/authorized-pickup/ are files, not rows; delete
-- that directory by hand once this has run.
--
-- Guard accounts only ever wrote dismissal_logs, so nothing else should hold
-- a reference to one. If something does, the DELETE fails on its foreign key
-- and the whole transaction rolls back with nothing changed.
--
-- Safe to re-run: every statement is IF EXISTS or matches nothing the second
-- time, and the role constraint is dropped and recreated.

BEGIN;

-- dismissal_logs references authorized_pickup_persons, so it goes first.
DROP TABLE IF EXISTS dismissal_logs;
DROP TABLE IF EXISTS authorized_pickup_persons;

ALTER TABLE students
  DROP COLUMN IF EXISTS qr_code,
  DROP COLUMN IF EXISTS qr_expires_at,
  DROP COLUMN IF EXISTS qr_generated_by,
  DROP COLUMN IF EXISTS qr_fetcher_type,
  DROP COLUMN IF EXISTS qr_fetcher_id;

ALTER TABLE parent_student DROP COLUMN IF EXISTS is_authorized_pickup;

DELETE FROM notifications WHERE type IN ('pickup', 'dismissal');

-- device_tokens, notifications and the like cascade from users.
DELETE FROM users WHERE role = 'security_guard';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'admin_ece', 'admin_elem', 'teacher', 'parent'));

COMMIT;
