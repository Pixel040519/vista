// Key dates — the admissions calendar the public website shows ("Regular
// enrollment opens", "First day of classes").
//
// Super admin only, for the same reason as the facility gallery and a public
// announcement: the website speaks for the whole school, so one office owns it.
// The public read is routes/public.routes.js; this router is the management side.
//
// A key date belongs to a school year, so next year's calendar is entered rather
// than coded. is_public does double duty: it puts the row on the website AND is
// what tells the website which school year to name — see the public read.

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { query } = require('../config/database');
const { authenticate, authorizeSuperAdmin } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');

router.use(authenticate, authorizeSuperAdmin);

// A subset of the announcement categories, so the two surfaces name the same
// kinds of thing the same way. Mirrored by key_dates_kind_check.
const KINDS = ['Admissions', 'Event', 'Academic', 'Holiday'];

// The dates are rendered as text, never arithmetic, so they are cast in SQL.
// node-pg hands a DATE back as a JS Date at LOCAL midnight, which JSON.stringify
// then writes in UTC -- on a UTC+8 machine 2026-06-08 goes out as
// "2026-06-07T16:00:00.000Z" and the website prints the 7th.
const SELECT_SQL = `
  SELECT k.id, k.school_year_id, k.label, k.kind,
         to_char(k.starts_on, 'YYYY-MM-DD') AS starts_on,
         to_char(k.ends_on,   'YYYY-MM-DD') AS ends_on,
         k.is_public, k.created_at, k.updated_at,
         sy.label AS school_year_label
    FROM key_dates k
    JOIN school_years sy ON sy.id = k.school_year_id`;

// Every key date, every year. A school keeps a handful per year, so the page
// groups them client-side rather than paying for a request per school year.
async function loadDates() {
  const r = await query(`${SELECT_SQL} ORDER BY sy.label DESC, k.starts_on, k.label`);
  return r.rows;
}

async function loadOne(id) {
  const r = await query(`${SELECT_SQL} WHERE k.id = $1`, [id]);
  if (!r.rowCount) throw new AppError('Key date not found.', 404);
  return r.rows[0];
}

// A date is NOT required to fall inside its school year's start_date/end_date:
// enrollment opens months before the year it is for. And a date already in the
// past may still be published — the dashboard marks such a row "Past" and says
// it will not appear, which is more use than a refusal that would also block
// correcting a typo.
const dateSchema = Joi.object({
  school_year_id: Joi.string().uuid().required(),
  label:          Joi.string().trim().min(1).max(120).required(),
  starts_on:      Joi.date().iso().required(),
  ends_on:        Joi.date().iso().min(Joi.ref('starts_on')).allow(null)
                    .messages({ 'date.min': 'The end date cannot be before the start date.' }),
  kind:           Joi.string().valid(...KINDS).default('Admissions'),
  is_public:      Joi.boolean().default(false),
});

// Written out rather than forked from dateSchema, for two reasons that both bite
// silently: fork() keeps the .default()s, so a PUT of nothing but a label would
// reset kind to 'Admissions' and quietly UNPUBLISH the row; and Joi.ref('starts_on')
// cannot resolve when starts_on was not resubmitted, which turns an edit of the end
// date alone into an error about a ref. The range is checked below, after merging
// the submitted fields over the stored ones.
const patchSchema = Joi.object({
  school_year_id: Joi.string().uuid(),
  label:          Joi.string().trim().min(1).max(120),
  starts_on:      Joi.date().iso(),
  ends_on:        Joi.date().iso().allow(null),
  kind:           Joi.string().valid(...KINDS),
  is_public:      Joi.boolean(),
}).min(1).messages({ 'object.min': 'Nothing to update.' });

const asDay = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

router.get('/', async (req, res, next) => {
  try {
    res.json({ key_dates: await loadDates() });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { error, value } = dateSchema.validate(req.body, { stripUnknown: true });
    if (error) throw new AppError(error.details[0].message, 422);

    const sy = await query('SELECT id FROM school_years WHERE id = $1', [value.school_year_id]);
    if (!sy.rowCount) throw new AppError('School year not found.', 404);

    const r = await query(
      `INSERT INTO key_dates (school_year_id, label, starts_on, ends_on, kind, is_public, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [value.school_year_id, value.label, asDay(value.starts_on), asDay(value.ends_on) || null,
       value.kind, value.is_public, req.user.id]
    );
    res.status(201).json({
      key_date: await loadOne(r.rows[0].id),
      key_dates: await loadDates(),
      message: 'Key date added.',
    });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { error, value } = patchSchema.validate(req.body, { stripUnknown: true });
    if (error) throw new AppError(error.details[0].message, 422);

    const existing = await loadOne(req.params.id);

    // Joi's ref only sees what was submitted. An edit that moves starts_on past
    // an ends_on it did not resubmit would otherwise reach the CHECK as a 500.
    const starts = asDay(value.starts_on) ?? asDay(existing.starts_on);
    const ends = 'ends_on' in value ? asDay(value.ends_on) : asDay(existing.ends_on);
    if (ends && starts && ends < starts) {
      throw new AppError('The end date cannot be before the start date.', 422);
    }

    const sets = [];
    const params = [];
    for (const key of ['school_year_id', 'label', 'kind', 'is_public']) {
      if (key in value) { params.push(value[key]); sets.push(`${key} = $${params.length}`); }
    }
    if ('starts_on' in value) { params.push(starts); sets.push(`starts_on = $${params.length}`); }
    if ('ends_on' in value) { params.push(ends || null); sets.push(`ends_on = $${params.length}`); }
    sets.push('updated_at = NOW()');
    params.push(req.params.id);

    await query(`UPDATE key_dates SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    res.json({
      key_date: await loadOne(req.params.id),
      key_dates: await loadDates(),
      message: 'Key date updated.',
    });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const r = await query('DELETE FROM key_dates WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rowCount) throw new AppError('Key date not found.', 404);
    res.json({ key_dates: await loadDates(), message: 'Key date removed.' });
  } catch (err) { next(err); }
});

module.exports = router;
