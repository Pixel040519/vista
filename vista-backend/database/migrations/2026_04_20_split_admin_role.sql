-- Split the single 'admin' role into super_admin / admin_ece / admin_elem.
-- Existing admin accounts are migrated to 'super_admin'.
-- 'admin_ece' is scoped to Pre-Nursery..Kinder; 'admin_elem' is scoped to Grades 1..6.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users SET role = 'super_admin' WHERE role = 'admin';

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'admin_ece', 'admin_elem', 'teacher', 'parent'));

COMMIT;
