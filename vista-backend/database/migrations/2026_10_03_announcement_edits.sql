-- Keep what another admin changed in a post, so its author can see it.
--
-- The super admin may edit any announcement, including an ECE or Elementary
-- admin's, and the post goes on naming its author. updated_by already says
-- WHO saved it last, but not WHAT changed — and the author, whose name is on
-- the post, had no way to find out what was said in it on their behalf.
--
-- One row per save by someone other than the author, holding the post as it
-- was before and after (title, message, category, audience, places, pin,
-- status, schedule, take-down, photo path). The author's own edits are not
-- recorded: they are not the question this answers. A save that changed
-- nothing records nothing.
--
-- Read through GET /api/announcements/:id/edits, which shows a row only to the
-- post's author and to the admin who made that edit.
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS announcement_edits (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  edited_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  edited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  before          JSONB NOT NULL,
  after           JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_announcement_edits_post
  ON announcement_edits (announcement_id, edited_at DESC);

COMMIT;
