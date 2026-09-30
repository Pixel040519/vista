-- Remove key dates: the admissions calendar the landing page showed.
--
-- The school no longer publishes a calendar through VISTA. This drops the one
-- table that existed only for it (2026_09_24_key_dates.sql):
--
--   key_dates   every date an admin entered, published or not (history is lost —
--               back up first if any of it is worth keeping)
--
-- Its two indexes and two CHECK constraints go with the table. Nothing else
-- references it: the rows pointed AT school_years and users, never the other way.
--
-- The landing page also took the school year it names from these rows. With the
-- table gone it names no year at all, which is what it already did whenever
-- nothing was published.
--
-- Safe to re-run: the second time there is nothing to drop.

BEGIN;

DROP TABLE IF EXISTS key_dates;

COMMIT;
