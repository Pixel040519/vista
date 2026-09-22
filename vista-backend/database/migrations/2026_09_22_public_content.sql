-- Public content — announcements that reach the website, and a facility gallery
--
-- The landing page's announcements were a hardcoded placeholder array and its
-- facility gallery a hardcoded list of files, so every change needed a developer
-- and a rebuild. This lets VISTA's admins manage both. Announcements stay ONE
-- system: a post can reach staff, parents (in the vista_parent app) and — new —
-- the public website, instead of a second, public-only table drifting from it.
--
-- Safe to re-run.

BEGIN;

-- ── announcements ─────────────────────────────────────────────────────────
--
-- is_public is deliberately separate from target_audience rather than a new
-- value of it: one post commonly goes to the website AND the parent app
-- ("Classes suspended tomorrow"), which a single audience value cannot say.
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS is_public    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS category     VARCHAR(20) NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS summary      VARCHAR(300),
  ADD COLUMN IF NOT EXISTS image_path   TEXT,
  ADD COLUMN IF NOT EXISTS is_pinned    BOOLEAN     NOT NULL DEFAULT FALSE,
  -- NULL = draft; a future timestamp = scheduled.
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at   TIMESTAMPTZ,
  -- Set once parents have been notified, so an edit can never push twice.
  ADD COLUMN IF NOT EXISTS notified_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by   UUID REFERENCES users(id) ON DELETE SET NULL;

-- Every existing post was live the moment it was created. Without this they
-- would all read as drafts and vanish from teachers and parents.
--
-- It must run on the FIRST application only: after that, published_at IS NULL
-- means a real draft, and a re-run would publish every one of them. The public
-- audience constraint below is added in this same transaction, so its presence
-- is the marker that the backfill has already happened.
UPDATE announcements SET published_at = created_at
 WHERE published_at IS NULL AND created_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_public_audience_check');

UPDATE announcements SET target_audience = 'all' WHERE target_audience IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_audience_check') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_audience_check
      CHECK (target_audience IN ('all', 'admins', 'teachers', 'parents'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_category_check') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_category_check
      CHECK (category IN ('General', 'Enrollment', 'Event', 'Academic', 'Holiday', 'Suspension'));
  END IF;
END $$;

-- A post meant only for staff can never be published to the open internet.
-- ('all' reaches parents too, so it may be public.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_public_audience_check') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_public_audience_check
      CHECK (NOT is_public OR target_audience IN ('all', 'parents'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_expiry_check') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_expiry_check
      CHECK (expires_at IS NULL OR published_at IS NULL OR expires_at > published_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_announcements_public
  ON announcements (published_at DESC) WHERE is_active = TRUE AND is_public = TRUE;

-- ── facilities + facility_photos ──────────────────────────────────────────
--
-- The gallery's first photo by sort_order is the facility's cover, so there
-- is no separate cover column to keep in step with the photo list.
CREATE TABLE IF NOT EXISTS facilities (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(100) NOT NULL UNIQUE,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facility_photos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  facility_id  UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  image_path   TEXT NOT NULL,
  thumb_path   TEXT,
  caption      VARCHAR(200),
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facility_photos_facility
  ON facility_photos (facility_id, sort_order);

COMMIT;
