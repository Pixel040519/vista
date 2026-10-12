-- ============================================================
-- VISTA Migration: let a teacher correct a behavior log's tone
-- Run once:  psql vista_db -f database/migrations/2026_10_12_behavior_sentiment_override.sql
-- ============================================================
--
-- A behavior log's tone (Positive / Neutral / Negative) is suggested by VADER
-- from the teacher's wording. VADER reads words, not situations, so it can be
-- wrong in ways only the teacher can see -- "Helped a classmate who was crying"
-- scores negative because the crying belongs to the other child. The teacher
-- may now pick the tone themselves when they log or edit an observation.
--
-- `sentiment` / `sentiment_score` keep their meaning: the tone that COUNTS.
-- Risk scoring, class health and every summary read them, so none of those had
-- to change. What VADER said is kept beside it, so an override never destroys
-- the suggestion it replaced:
--
--   ai_sentiment / ai_sentiment_score
--       VADER's label and compound score for the text as saved. NULL means the
--       text was never analysed -- the analyzer was unreachable when it was
--       saved. A re-score can find exactly those rows.
--
--   sentiment_overridden
--       TRUE when the teacher chose a tone that differs from VADER's (or chose
--       one while VADER was unreachable). The score then comes from the label
--       (Positive +0.5, Neutral 0, Negative -0.5, set by the Node API), because
--       risk averages the score, not the label: leaving VADER's number in place
--       would change what the log says and nothing that the log does.
--
-- Existing rows were all scored by VADER (or by the API's Neutral fallback,
-- which cannot be told apart now), so they are backfilled as not overridden,
-- with the AI columns copied from the current values. The backfill runs only in
-- the same transaction that adds the columns, so re-running this file never
-- relabels a row written since -- in particular one saved while the analyzer was
-- down, whose NULL AI columns are the only record that it was never analysed.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'behavior_logs' AND column_name = 'ai_sentiment'
  ) THEN
    ALTER TABLE behavior_logs
      ADD COLUMN ai_sentiment         VARCHAR(20),
      ADD COLUMN ai_sentiment_score   DECIMAL(5,4),
      ADD COLUMN sentiment_overridden BOOLEAN NOT NULL DEFAULT FALSE;

    UPDATE behavior_logs
       SET ai_sentiment = sentiment,
           ai_sentiment_score = sentiment_score;
  END IF;
END $$;

-- A teacher's choice is always one of the three labels, so an overridden row
-- can never be left without one.
ALTER TABLE behavior_logs DROP CONSTRAINT IF EXISTS behavior_logs_override_has_label;
ALTER TABLE behavior_logs ADD CONSTRAINT behavior_logs_override_has_label
  CHECK (NOT sentiment_overridden OR sentiment IN ('Positive', 'Neutral', 'Negative'));

COMMIT;
