-- Add 'security_guard' to the users.role enum.
-- Guards are school-wide, read-only on students, used by the vista_guard mobile app
-- to verify dismissal QR codes at the gate.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'admin_ece', 'admin_elem', 'teacher', 'parent', 'security_guard'));

COMMIT;
