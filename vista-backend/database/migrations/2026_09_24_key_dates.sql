-- Key dates — the admissions calendar the landing page shows
--
-- The site's "Key dates" block was a hardcoded list in TWO places (Home.jsx and
-- Admissions.jsx) that had already drifted apart, under a hardcoded "School Year
-- 2026-2027" heading. The rows carried no year of their own ("15 May"), so they
-- could never be compared against today: a stale date did not look stale, it just
-- quietly became wrong.
--
-- A key date belongs to a school year, so filling in the next year's calendar is
-- the natural rollover rather than a code change. is_public is the same idiom as
-- announcements: publishing is a deliberate act by the super admin, and it is ALSO
-- what tells the website which school year to name (see routes/public.routes.js).
--
-- Deliberately no seed. The five dates that were on the site were placeholders
-- nobody confirmed, and an invented date is worse than none.
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS key_dates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_year_id  UUID NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  -- "Regular enrollment opens", "Parents' orientation"
  label           VARCHAR(120) NOT NULL,
  -- starts_on/ends_on rather than date/end_date: "date" is a type name and reads
  -- badly in every query that touches it. ends_on is NULL for a single day.
  starts_on       DATE NOT NULL,
  ends_on         DATE,
  kind            VARCHAR(20) NOT NULL DEFAULT 'Admissions',
  -- Shown on the school website. Super admin only, like announcements.is_public.
  is_public       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

-- A subset of the vocabulary announcements_category_check already uses, so the
-- two surfaces name the same kinds of thing the same way.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'key_dates_kind_check') THEN
    ALTER TABLE key_dates ADD CONSTRAINT key_dates_kind_check
      CHECK (kind IN ('Admissions', 'Event', 'Academic', 'Holiday'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'key_dates_range_check') THEN
    ALTER TABLE key_dates ADD CONSTRAINT key_dates_range_check
      CHECK (ends_on IS NULL OR ends_on >= starts_on);
  END IF;
END $$;

-- The public read asks for published rows that have not passed, ordered by date.
CREATE INDEX IF NOT EXISTS idx_key_dates_public
  ON key_dates (starts_on) WHERE is_public = TRUE;

CREATE INDEX IF NOT EXISTS idx_key_dates_sy
  ON key_dates (school_year_id, starts_on);

COMMIT;
