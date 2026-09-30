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

module.exports = router;
