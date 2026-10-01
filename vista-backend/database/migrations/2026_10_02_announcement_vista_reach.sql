-- Let an announcement reach the public website without reaching VISTA.
--
-- is_public (2026_09_22_public_content.sql) answered "is it on the website?",
-- but nothing answered "is it in VISTA?" — every post was a VISTA post first,
-- and the website was only something one could ALSO be shown on. So the super
-- admin could not post to the website alone: an open-house invitation meant for
-- the public also landed in every parent's app and on every admin's list.
--
-- in_vista is the matching flag. The two are independent reaches of one post,
-- which is what keeps announcements ONE system rather than two tables: a post
-- can be in VISTA, on the website, or deliberately both ("Classes suspended
-- tomorrow"). While in_vista is FALSE, target_audience is ignored; the API keeps
-- it at 'all' or 'parents', so announcements_public_audience_check still holds
-- and switching VISTA back on restores the audience it had.
--
-- Every existing post was a VISTA post, so the column's default is also the
-- correct backfill.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS in_vista BOOLEAN NOT NULL DEFAULT TRUE;

-- A post has to appear somewhere.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_reach_check') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_reach_check
      CHECK (in_vista OR is_public);
  END IF;
END $$;

COMMIT;
