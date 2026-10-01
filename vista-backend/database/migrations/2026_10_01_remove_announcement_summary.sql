-- Remove the announcement summary.
--
-- A post carried an optional one-line summary (2026_09_22_public_content.sql)
-- beside its content. Every reader already fell back to the content when it was
-- blank — the website's card teaser, the parent app's collapsed card, the push
-- body — and where it was filled in it was shown again as a lead paragraph above
-- the content, so readers saw the same sentence twice. Admins now write one text.
--
-- Existing summaries are dropped with the column, not folded into the content:
-- they restated it.
--
-- Safe to re-run: the second time there is nothing to drop.

BEGIN;

ALTER TABLE announcements DROP COLUMN IF EXISTS summary;

COMMIT;
