// /api/public — the ONLY unauthenticated reads in the API.
//
// Everything else is JWT-gated. These exist so the landing page (a separate,
// static site) can show what admins publish without a login. That makes this
// file a boundary, so it is kept deliberately small:
//   - GET only, and only rows an admin explicitly made public.
//   - Every column is listed by name. A SELECT * here would publish whatever the
//     next migration adds to the table; posted_by, and anything about a user or
//     a learner, must never appear.
//   - Rate limited per IP in every environment.
// The landing page must still render when this is unreachable, so nothing it
// returns may be load-bearing for that site.

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { publicReadPerIp } = require('../middleware/rateLimit');
const { photoUrlFromPath } = require('../middleware/upload.middleware');

router.use(publicReadPerIp);
router.use((req, res, next) => {
  // Short: an urgent notice ("classes suspended") should not sit behind a cache.
  res.set('Cache-Control', 'public, max-age=60');
  next();
});

// What makes an announcement visible on the website — shared by the page and its count.
const LIVE_PUBLIC = `a.is_active = TRUE AND a.is_public = TRUE
          AND a.published_at IS NOT NULL AND a.published_at <= NOW()
          AND (a.expires_at IS NULL OR a.expires_at > NOW())`;

// GET /api/public/announcements?limit=20&offset=0
//
// Paged for the Announcements page's "Load more". `total` counts every live
// public post so the page can say "Showing 6 of 23". a.id is the last sort key
// only so that pages are deterministic when two posts share a published_at.
router.get('/announcements', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const [r, c] = await Promise.all([
      query(
        `SELECT a.id, a.title, a.summary, a.content, a.category, a.is_pinned,
                a.published_at, a.image_path
           FROM announcements a
          WHERE ${LIVE_PUBLIC}
          ORDER BY a.is_pinned DESC, a.published_at DESC, a.id
          LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      query(`SELECT COUNT(*)::int AS total FROM announcements a WHERE ${LIVE_PUBLIC}`),
    ]);
    res.json({
      announcements: r.rows.map(({ image_path, ...row }) => ({
        ...row,
        image_url: photoUrlFromPath(req, image_path),
      })),
      total: c.rows[0].total,
    });
  } catch (err) { next(err); }
});

// GET /api/public/facilities — active facilities that have at least one photo.
router.get('/facilities', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT f.id, f.name, f.slug,
              json_agg(json_build_object(
                'image_path', p.image_path, 'thumb_path', p.thumb_path, 'caption', p.caption
              ) ORDER BY p.sort_order, p.created_at) AS photos
         FROM facilities f
         JOIN facility_photos p ON p.facility_id = f.id
        WHERE f.is_active = TRUE
        GROUP BY f.id
        ORDER BY f.sort_order, f.name`
    );
    res.json({
      facilities: r.rows.map(f => ({
        id: f.id,
        name: f.name,
        slug: f.slug,
        photos: f.photos.map(p => ({
          url: photoUrlFromPath(req, p.image_path),
          thumb_url: photoUrlFromPath(req, p.thumb_path || p.image_path),
          caption: p.caption,
        })),
      })),
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/public/key-dates
 *
 * The admissions calendar, plus the school year the website should name.
 *
 * The advertised year is NOT derived from is_active or is_upcoming. While
 * SY 2025-2026 is running the site advertises enrollment INTO SY 2026-2027, so
 * the active year is the wrong answer for the half of the year that matters
 * most; and is_upcoming is set months early just to plan curriculum, which would
 * flip the whole site to a year nobody is enrolling in yet. Publishing a key date
 * is the deliberate act, so the published dates decide: the year owning the
 * EARLIEST upcoming one is the year the site names, and only that year's dates
 * come back, so two years can never mix into one list during the handover.
 *
 * COALESCE(ends_on, starts_on) rather than starts_on keeps a range that has
 * already begun ("Enrollment: 8 June - 31 July") on the site while it is running.
 *
 * With nothing published, or nothing upcoming left, school_year is null and dates
 * is empty -- the signal the landing page uses to drop the year from its headings
 * and show the registrar's details instead.
 */
router.get('/key-dates', async (req, res, next) => {
  try {
    const r = await query(
      `WITH advertised AS (
         SELECT school_year_id FROM key_dates
          WHERE is_public = TRUE AND COALESCE(ends_on, starts_on) >= CURRENT_DATE
          ORDER BY starts_on, label
          LIMIT 1
       )
       SELECT k.id, k.label, k.kind,
              to_char(k.starts_on, 'YYYY-MM-DD') AS starts_on,
              to_char(k.ends_on,   'YYYY-MM-DD') AS ends_on,
              sy.label                              AS school_year_label,
              to_char(sy.start_date, 'YYYY-MM-DD')  AS school_year_start,
              to_char(sy.end_date,   'YYYY-MM-DD')  AS school_year_end
         FROM key_dates k
         JOIN advertised  a ON a.school_year_id = k.school_year_id
         JOIN school_years sy ON sy.id = k.school_year_id
        WHERE k.is_public = TRUE AND COALESCE(k.ends_on, k.starts_on) >= CURRENT_DATE
        ORDER BY k.starts_on, k.label
        LIMIT 12`
    );
    const first = r.rows[0];
    res.json({
      school_year: first
        ? { label: first.school_year_label, start_date: first.school_year_start, end_date: first.school_year_end }
        : null,
      dates: r.rows.map(({ school_year_label, school_year_start, school_year_end, ...d }) => d),
    });
  } catch (err) { next(err); }
});

module.exports = router;
