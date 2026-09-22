// Facility gallery — the photos the public website shows under "Our facilities".
// Super admin only: the website speaks for the whole school, so one office owns
// it (the same reason only the super admin may make an announcement public).
// The public read is routes/public.routes.js; this router is the management side.

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { query, withTransaction } = require('../config/database');
const { authenticate, authorizeSuperAdmin } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const {
  uploadFacilityPhotos,
  photoUrlFromPath,
  unlinkUploadedFile,
} = require('../middleware/upload.middleware');
const { processImage, discard } = require('../utils/imageProcess');

router.use(authenticate, authorizeSuperAdmin);

const BUCKET = 'facilities';
const CONSENT_MESSAGE = 'Confirm the photos show no identifiable learners, or that parental consent is on file.';

function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'facility';
}

// Slugs only need to be unique, not pretty on collision — "library-2" is fine.
async function uniqueSlug(name) {
  const base = slugify(name);
  const taken = await query(
    `SELECT slug FROM facilities WHERE slug = $1 OR slug LIKE $1 || '-%'`,
    [base]
  );
  const set = new Set(taken.rows.map(r => r.slug));
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function presentPhoto(req, p) {
  return {
    id: p.id,
    caption: p.caption,
    sort_order: p.sort_order,
    url: photoUrlFromPath(req, p.image_path),
    thumb_url: photoUrlFromPath(req, p.thumb_path || p.image_path),
    created_at: p.created_at,
  };
}

async function loadFacilities(req, id = null) {
  const f = await query(
    `SELECT id, name, slug, sort_order, is_active, created_at
       FROM facilities WHERE ($1::uuid IS NULL OR id = $1)
      ORDER BY sort_order, name`,
    [id]
  );
  if (!f.rowCount) return [];
  const p = await query(
    `SELECT * FROM facility_photos WHERE facility_id = ANY($1::uuid[]) ORDER BY sort_order, created_at`,
    [f.rows.map(r => r.id)]
  );
  return f.rows.map(row => ({
    ...row,
    photos: p.rows.filter(x => x.facility_id === row.id).map(x => presentPhoto(req, x)),
  }));
}

async function loadOne(req, id) {
  const [row] = await loadFacilities(req, id);
  if (!row) throw new AppError('Facility not found.', 404);
  return row;
}

const facilitySchema = Joi.object({
  name:      Joi.string().trim().min(1).max(100).required(),
  is_active: Joi.boolean().default(true),
});

const orderSchema = Joi.object({
  ids: Joi.array().items(Joi.string().uuid()).min(1).required(),
});

// GET /api/facilities — every facility, hidden ones included, with photos.
router.get('/', async (req, res, next) => {
  try {
    res.json({ facilities: await loadFacilities(req) });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { error, value } = facilitySchema.validate(req.body, { stripUnknown: true });
    if (error) throw new AppError(error.details[0].message, 422);
    const r = await query(
      `INSERT INTO facilities (name, slug, is_active, sort_order)
       VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_order) + 1 FROM facilities), 0))
       RETURNING id`,
      [value.name, await uniqueSlug(value.name), value.is_active]
    );
    res.status(201).json({ facility: await loadOne(req, r.rows[0].id), message: 'Facility added.' });
  } catch (err) { next(err); }
});

// PUT /api/facilities/order — { ids: [...] } in display order.
// Declared before /:id so "order" is never read as an id.
router.put('/order', async (req, res, next) => {
  try {
    const { error, value } = orderSchema.validate(req.body);
    if (error) throw new AppError(error.details[0].message, 422);
    await withTransaction(async (client) => {
      for (const [i, id] of value.ids.entries()) {
        await client.query(`UPDATE facilities SET sort_order = $1 WHERE id = $2`, [i, id]);
      }
    });
    res.json({ facilities: await loadFacilities(req) });
  } catch (err) { next(err); }
});

// The slug is kept on rename: it is only an identifier, and nothing gains from
// it changing because "Library" became "Main Library".
router.put('/:id', async (req, res, next) => {
  try {
    const { error, value } = facilitySchema.validate(req.body, { stripUnknown: true });
    if (error) throw new AppError(error.details[0].message, 422);
    const r = await query(
      `UPDATE facilities SET name = $1, is_active = $2 WHERE id = $3 RETURNING id`,
      [value.name, value.is_active, req.params.id]
    );
    if (!r.rowCount) throw new AppError('Facility not found.', 404);
    res.json({ facility: await loadOne(req, req.params.id), message: 'Facility updated.' });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const photos = await withTransaction(async (client) => {
      const p = await client.query(
        `SELECT image_path, thumb_path FROM facility_photos WHERE facility_id = $1`, [req.params.id]);
      const d = await client.query(`DELETE FROM facilities WHERE id = $1`, [req.params.id]);
      if (!d.rowCount) throw new AppError('Facility not found.', 404);
      return p.rows;
    });
    // Files go only once the rows are gone for good.
    for (const p of photos) { unlinkUploadedFile(p.image_path); unlinkUploadedFile(p.thumb_path); }
    res.json({ message: 'Facility deleted.' });
  } catch (err) { next(err); }
});

// ── Photos ────────────────────────────────────────────────────────────────

// POST /api/facilities/:id/photos — multipart, field "photos" (up to 10), plus
// `consent`. Every file is decoded and re-encoded before any row is written, so
// one bad file refuses the batch rather than leaving half of it stored.
router.post('/:id/photos', uploadFacilityPhotos, async (req, res, next) => {
  const processed = [];
  try {
    const files = req.files || [];
    if (!files.length) throw new AppError('Choose at least one photo.', 400);
    const { error } = Joi.object({
      consent: Joi.boolean().valid(true).required()
        .messages({ 'any.only': CONSENT_MESSAGE, 'any.required': CONSENT_MESSAGE }),
    }).validate(req.body, { stripUnknown: true });
    if (error) throw new AppError(error.details[0].message, 422);

    const exists = await query(`SELECT 1 FROM facilities WHERE id = $1`, [req.params.id]);
    if (!exists.rowCount) throw new AppError('Facility not found.', 404);

    for (const f of files) {
      processed.push(await processImage(f, BUCKET, { maxWidth: 1600, thumbWidth: 640 }));
    }

    await withTransaction(async (client) => {
      const start = await client.query(
        `SELECT COALESCE(MAX(sort_order) + 1, 0) AS n FROM facility_photos WHERE facility_id = $1`,
        [req.params.id]
      );
      let n = start.rows[0].n;
      for (const p of processed) {
        await client.query(
          `INSERT INTO facility_photos (facility_id, image_path, thumb_path, sort_order, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.params.id, p.image_path, p.thumb_path, n++, req.user.id]
        );
      }
    });

    res.status(201).json({
      facility: await loadOne(req, req.params.id),
      message: `${processed.length} photo${processed.length === 1 ? '' : 's'} added.`,
    });
  } catch (err) {
    for (const f of req.files || []) discard(f);
    for (const p of processed) { unlinkUploadedFile(p.image_path); unlinkUploadedFile(p.thumb_path); }
    next(err);
  }
});

// PUT /api/facilities/:id/photos/order — { ids: [...] }; the first is the cover.
router.put('/:id/photos/order', async (req, res, next) => {
  try {
    const { error, value } = orderSchema.validate(req.body);
    if (error) throw new AppError(error.details[0].message, 422);
    await withTransaction(async (client) => {
      for (const [i, id] of value.ids.entries()) {
        await client.query(
          `UPDATE facility_photos SET sort_order = $1 WHERE id = $2 AND facility_id = $3`,
          [i, id, req.params.id]
        );
      }
    });
    res.json({ facility: await loadOne(req, req.params.id) });
  } catch (err) { next(err); }
});

router.put('/photos/:photoId', async (req, res, next) => {
  try {
    const { error, value } = Joi.object({ caption: Joi.string().trim().max(200).allow('', null) })
      .validate(req.body, { stripUnknown: true });
    if (error) throw new AppError(error.details[0].message, 422);
    const r = await query(
      `UPDATE facility_photos SET caption = $1 WHERE id = $2 RETURNING facility_id`,
      [value.caption || null, req.params.photoId]
    );
    if (!r.rowCount) throw new AppError('Photo not found.', 404);
    res.json({ facility: await loadOne(req, r.rows[0].facility_id), message: 'Caption saved.' });
  } catch (err) { next(err); }
});

router.delete('/photos/:photoId', async (req, res, next) => {
  try {
    const r = await query(
      `DELETE FROM facility_photos WHERE id = $1 RETURNING facility_id, image_path, thumb_path`,
      [req.params.photoId]
    );
    if (!r.rowCount) throw new AppError('Photo not found.', 404);
    unlinkUploadedFile(r.rows[0].image_path);
    unlinkUploadedFile(r.rows[0].thumb_path);
    res.json({ facility: await loadOne(req, r.rows[0].facility_id), message: 'Photo removed.' });
  } catch (err) { next(err); }
});

module.exports = router;
