-- Staff accounts are invitations too
--
-- Teacher and admin accounts used to be born with a password the creating
-- admin typed, which meant the school held a staff member's credential and had
-- to pass it on by some channel VISTA does not own. They now follow the parent
-- model: an admin authorizes an email, and the staff member proves they hold it
-- (Activate your account, on the dashboard's sign-in page) and chooses their own
-- password.
--
-- Nothing about the invitation itself is parent-specific — users.account_status
-- and the invitation row already describe any account — so the table is
-- renamed rather than duplicated. One table, one code discipline, one set of
-- anti-enumeration rules on the endpoints that read it.
--
-- Safe to re-run.

BEGIN;

-- ── parent_invitations → account_invitations ─────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.parent_invitations') IS NOT NULL
     AND to_regclass('public.account_invitations') IS NULL THEN
    ALTER TABLE parent_invitations RENAME TO account_invitations;
  END IF;

  IF to_regclass('public.parent_invitations_live_unique') IS NOT NULL THEN
    ALTER INDEX parent_invitations_live_unique RENAME TO account_invitations_live_unique;
  END IF;

  IF to_regclass('public.idx_parent_invitations_user') IS NOT NULL THEN
    ALTER INDEX idx_parent_invitations_user RENAME TO idx_account_invitations_user;
  END IF;

  IF to_regclass('public.parent_invitations_pkey') IS NOT NULL THEN
    ALTER INDEX parent_invitations_pkey RENAME TO account_invitations_pkey;
  END IF;
END $$;

-- ── users.last_login_at ───────────────────────────────────────────────────
--
-- The staff roster says when someone last signed in, which is what tells an
-- admin an Active account is actually in use. Stamped by /auth/login and by a
-- completed activation (which signs the holder in). NULL means never since
-- this column existed — not "never", so the UI says nothing rather than
-- claiming they have not signed in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;

COMMIT;
