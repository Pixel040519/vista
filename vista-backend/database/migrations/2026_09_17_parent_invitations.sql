-- Parent/Guardian Account Access — invitation-based activation
--
-- Replaces admin-typed parent passwords with an invitation the parent
-- activates themselves from the vista_parent app. The admin authorizes an
-- email address; nothing is sent until the parent asks for a code.
--
-- Safe to re-run.

BEGIN;

-- ── users: an invited parent has no password yet ──────────────────────────
--
-- password_hash was NOT NULL because every account was born with a password
-- typed by an admin. An invited parent has none until they set one, so the
-- column has to admit NULL. Nothing else in the schema reads it.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- account_status gates sign-in. It defaults to 'active' so every account that
-- already exists keeps working with no backfill — only rows created by the
-- invitation path are ever born 'pending'.
--
--   pending  — invited, no password set, cannot sign in
--   active   — normal account
--   revoked  — access withdrawn by an admin; row and history preserved
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_account_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_account_status_check
      CHECK (account_status IN ('pending', 'active', 'revoked'));
  END IF;
END $$;

-- A passwordless account must be 'pending'. Without this a bug elsewhere could
-- leave an 'active' row with no hash, which bcrypt.compare would reach.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_active_needs_password_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_active_needs_password_check
      CHECK (account_status <> 'active' OR password_hash IS NOT NULL);
  END IF;
END $$;

-- ── users.email: case-insensitive uniqueness ──────────────────────────────
--
-- The column is UNIQUE, but case-sensitively, so Rosa@x.com and rosa@x.com
-- could both exist. Only ensureParentAccount normalised case; login matched
-- email=$1 exactly. An invitation issued for one spelling would then not be
-- found by a parent who typed the other. Refuse to run rather than guess which
-- of a colliding pair to keep.
DO $$
DECLARE dupe TEXT;
BEGIN
  SELECT string_agg(DISTINCT LOWER(email), ', ') INTO dupe
    FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1;
  IF dupe IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add a case-insensitive unique index on users.email: these addresses exist more than once differing only by case: %. Merge or rename them, then re-run.', dupe;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email));

-- ── parent_invitations ────────────────────────────────────────────────────
--
-- One row per invitation. The live one-time code lives on the same row rather
-- than in a table of its own: that is what makes "issuing a new code
-- invalidates the previous unused one" automatic instead of a rule to enforce.
--
-- code_hash is NULL at invite time — an invitation is created with no code
-- because no message is sent until the parent asks for one.
--
-- ON DELETE CASCADE on user_id is load-bearing: removing the last guardian row
-- for a parent hard-deletes their users row (student.routes.js), which would
-- otherwise orphan invitations.
CREATE TABLE IF NOT EXISTS parent_invitations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    invited_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    invited_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMP NOT NULL,
    consumed_at     TIMESTAMP,
    revoked_at      TIMESTAMP,
    revoked_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    -- the live activation code, hashed; never stored or logged in the clear
    code_hash       VARCHAR(255),
    code_issued_at  TIMESTAMP,
    code_expires_at TIMESTAMP,
    code_attempts   SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One live invitation per account. Consumed and revoked rows stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS parent_invitations_live_unique
  ON parent_invitations (user_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parent_invitations_user ON parent_invitations (user_id);

-- ── password_reset_codes ──────────────────────────────────────────────────
--
-- Deliberately not folded into parent_invitations. An invitation is a thing an
-- admin creates, sees and revokes; a reset code is ephemeral and belongs to the
-- account holder. Same code discipline, different lifetime and owner.
CREATE TABLE IF NOT EXISTS password_reset_codes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash       VARCHAR(255) NOT NULL,
    code_issued_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    code_expires_at TIMESTAMP NOT NULL,
    code_attempts   SMALLINT NOT NULL DEFAULT 0,
    consumed_at     TIMESTAMP
);

-- One live reset code per account, for the same reason as above.
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_codes_live_unique
  ON password_reset_codes (user_id)
  WHERE consumed_at IS NULL;

COMMIT;
