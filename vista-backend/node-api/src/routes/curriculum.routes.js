const express = require('express')
const router  = express.Router()
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const { authenticate, authorizeAnyAdmin, authorizeSuperAdmin, enforceGradeScope } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { gradeScopeForRole, canManageGrade, isScopedAdmin, isSuperAdmin } = require('../utils/roles')
const { RATING_SCALES, resolveAssessment } = require('../utils/grading')
const { loadAssessmentRows } = require('../utils/assessmentConfig')

// Look up a row's grade_level from one of the curriculum tables and enforce scope.
const assertCurriculumRowInScope = async (req, table, id) => {
  if (!isScopedAdmin(req.user.role)) return
  const r = await query(`SELECT grade_level FROM ${table} WHERE id=$1`, [id])
  if (!r.rows.length) throw new AppError('Not found.', 404)
  if (!canManageGrade(req.user.role, r.rows[0].grade_level)) {
    throw new AppError('Resource is outside your grade scope.', 403)
  }
  return r.rows[0].grade_level
}

const GRADE_LEVELS = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6']

const GRADE_ORDER = `CASE grade_level
  WHEN 'Kinder'  THEN 1
  WHEN 'Grade 1' THEN 2     WHEN 'Grade 2' THEN 3
  WHEN 'Grade 3' THEN 4     WHEN 'Grade 4' THEN 5
  WHEN 'Grade 5' THEN 6     WHEN 'Grade 6' THEN 7
  ELSE 8 END`

router.use(authenticate)

// ── Validate school year label + date alignment ───────────────
const validateSchoolYear = (label, start_date, end_date) => {
  const match = label && label.match(/^(\d{4})-(\d{4})$/)
  if (!match) return 'Format must be YYYY-YYYY (e.g. 2025-2026)'

  const y1 = parseInt(match[1])
  const y2 = parseInt(match[2])
  if (y2 !== y1 + 1) return `Second year must be exactly one after the first (e.g. ${y1}-${y1+1})`

  if (start_date) {
    const startYear = new Date(start_date).getFullYear()
    if (startYear !== y1) return `Start date year (${startYear}) must match the first year of the school year (${y1})`
  }
  if (end_date) {
    const endYear = new Date(end_date).getFullYear()
    if (endYear !== y2) return `End date year (${endYear}) must match the second year of the school year (${y2})`
  }
  return null
}


// ── Helper: resolve school_year_id ────────────────────────────
// Accepts ?sy_id=uuid or falls back to the active school year
const resolveSYId = async (sy_id) => {
  if (sy_id) return sy_id
  const res = await query('SELECT id FROM school_years WHERE is_active=TRUE LIMIT 1')
  if (!res.rows.length) throw new AppError('No active school year set.', 400)
  return res.rows[0].id
}

// ════════════════════════════════════════════════════════════
// ASSESSMENT CONFIGURATION (per school year x grade level)
// ════════════════════════════════════════════════════════════
//
// DO 015, s. 2026 moves KS1 off numeric grading one grade level per year, but
// the schedule lives here as DATA, not code: NRYS is private (DO 015 only
// "encourages" adoption for private schools), so the school sets its own pace.

// GET /api/curriculum/assessment-config?sy_id=
// Returns every grade level with its resolved mode, flagging which ones are
// explicitly configured vs falling back to the default.
router.get('/assessment-config', async (req, res, next) => {
  try {
    const syId = await resolveSYId(req.query.sy_id)
    const rows = await loadAssessmentRows(syId)
    const scope = gradeScopeForRole(req.user.role)

    const config = GRADE_LEVELS
      .filter(gl => scope.includes(gl))
      .map(gl => {
        const a = resolveAssessment(gl, rows.get(gl) || null)
        return {
          grade_level: gl,
          assessment_mode: a.mode,
          rating_scale: a.scaleId,
          rating_scale_label: a.scale ? a.scale.label : null,
          levels: a.scale ? a.scale.levels : null,
          configured: a.configured,
        }
      })

    res.json({ sy_id: syId, config, scales: Object.values(RATING_SCALES).map(s => ({
      id: s.id, label: s.label, short: s.short, source: s.source, levels: s.levels,
    })) })
  } catch (err) { next(err) }
})

// PUT /api/curriculum/assessment-config
// { sy_id?, entries: [{ grade_level, assessment_mode, rating_scale? }] }
router.put('/assessment-config', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      sy_id: Joi.string().uuid().optional(),
      entries: Joi.array().items(Joi.object({
        grade_level:     Joi.string().valid(...GRADE_LEVELS).required(),
        assessment_mode: Joi.string().valid('numeric', 'descriptive').required(),
        rating_scale:    Joi.string().valid(...Object.keys(RATING_SCALES)).allow(null).optional(),
      })).min(1).required(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const syId = await resolveSYId(value.sy_id)

    for (const e of value.entries) {
      enforceGradeScope(req, e.grade_level)
      if (e.assessment_mode === 'descriptive' && !e.rating_scale) {
        throw new AppError(`${e.grade_level}: a rating scale is required for descriptive grading.`, 422)
      }
    }

    // Changing a scale would orphan ratings recorded on the old one — 'E' is
    // Excellent under EGFNA but Emerging under ABCDE, so reinterpreting them
    // silently would turn top marks into failing ones. Block instead.
    for (const e of value.entries) {
      const scale = e.assessment_mode === 'descriptive' ? e.rating_scale : null
      const conflict = await query(
        `SELECT r.rating_scale, COUNT(*)::int AS n
           FROM ece_competency_records r
           JOIN students s ON s.id = r.student_id
          WHERE r.school_year_id = $1
            AND s.grade_level = $2
            AND ($3::text IS NULL OR r.rating_scale <> $3)
          GROUP BY r.rating_scale`,
        [syId, e.grade_level, scale]
      )
      if (conflict.rows.length) {
        const detail = conflict.rows.map(c => `${c.n} on ${c.rating_scale}`).join(', ')
        throw new AppError(
          `${e.grade_level} already has competency ratings recorded for this school year (${detail}). ` +
          `Delete or re-rate them before changing the scale — the same letter can mean different things on different scales.`,
          409
        )
      }
    }

    const saved = await withTransaction(async (client) => {
      const out = []
      for (const e of value.entries) {
        const r = await client.query(
          `INSERT INTO grade_level_assessment (school_year_id, grade_level, assessment_mode, rating_scale)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (school_year_id, grade_level)
           DO UPDATE SET assessment_mode = EXCLUDED.assessment_mode,
                         rating_scale    = EXCLUDED.rating_scale,
                         updated_at      = NOW()
           RETURNING grade_level, assessment_mode, rating_scale`,
          [syId, e.grade_level, e.assessment_mode,
           e.assessment_mode === 'descriptive' ? e.rating_scale : null]
        )
        out.push(r.rows[0])
      }
      return out
    })

    res.json({ message: `Assessment configuration saved for ${saved.length} grade level(s).`, config: saved })
  } catch (err) { next(err) }
})

// DELETE /api/curriculum/assessment-config/:grade_level?sy_id=
// Reverts one grade level to the built-in default.
router.delete('/assessment-config/:grade_level', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const gradeLevel = req.params.grade_level
    if (!GRADE_LEVELS.includes(gradeLevel)) throw new AppError('Unknown grade level.', 422)
    enforceGradeScope(req, gradeLevel)
    const syId = await resolveSYId(req.query.sy_id)
    await query(
      'DELETE FROM grade_level_assessment WHERE school_year_id=$1 AND grade_level=$2',
      [syId, gradeLevel]
    )
    res.json({ message: `${gradeLevel} reverted to the default assessment mode.` })
  } catch (err) { next(err) }
})


// ════════════════════════════════════════════════════════════
// SCHOOL YEARS
// ════════════════════════════════════════════════════════════

router.get('/school-years', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, label, is_active, is_upcoming, start_date, end_date,
              period_model, grading_policy, created_at
       FROM school_years ORDER BY label DESC`
    )
    res.json({ school_years: result.rows })
  } catch (err) { next(err) }
})

router.post('/school-years', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      label:       Joi.string().pattern(/^\d{4}-\d{4}$/).required()
                     .messages({ 'string.pattern.base': 'Format must be YYYY-YYYY (e.g. 2025-2026)' }),
      is_active:   Joi.boolean().default(false),
      is_upcoming: Joi.boolean().default(false),
      start_date:  Joi.date().optional().allow(null),
      end_date:    Joi.date().optional().allow(null),
      // DepEd DO 009 / DO 015, s. 2026 — the grading model is per school year.
      period_model:   Joi.string().valid('4Q', '3T').default('4Q'),
      grading_policy: Joi.string().valid('DO8_2015', 'DO15_2026', 'ZERO_BASED').default('DO8_2015'),
      copy_from_id: Joi.string().uuid().optional().allow(null), // copy subjects+sections from this SY
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    if (value.is_active && value.is_upcoming) throw new AppError('A school year cannot be both active and upcoming.', 422)

    const syErr = validateSchoolYear(value.label, value.start_date, value.end_date)
    if (syErr) throw new AppError(syErr, 422)

    if (value.is_upcoming) {
      const endYear = parseInt(value.label.split('-')[1])
      if (endYear <= new Date().getFullYear()) throw new AppError('Past school years cannot be tagged as upcoming.', 422)
    }

    const dup = await query('SELECT id FROM school_years WHERE label=$1', [value.label])
    if (dup.rows.length) throw new AppError(`School year "${value.label}" already exists.`, 409)

    const sy = await withTransaction(async (client) => {
      if (value.is_active) await client.query(`UPDATE school_years SET is_active=FALSE, updated_at=NOW()`)
      const syRes = await client.query(
        `INSERT INTO school_years (label, is_active, is_upcoming, start_date, end_date, period_model, grading_policy)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, label, is_active, is_upcoming, start_date, end_date, period_model, grading_policy, created_at`,
        [value.label, value.is_active, value.is_upcoming, value.start_date || null, value.end_date || null,
         value.period_model, value.grading_policy]
      )
      const newSY = syRes.rows[0]

      // Copy subjects & sections from another school year
      if (value.copy_from_id) {
        await client.query(
          `INSERT INTO subjects (name, grade_level, school_year_id)
           SELECT name, grade_level, $1 FROM subjects
           WHERE school_year_id=$2 AND is_active=TRUE
           ON CONFLICT DO NOTHING`,
          [newSY.id, value.copy_from_id]
        )
        await client.query(
          `INSERT INTO sections (name, grade_level, school_year_id)
           SELECT name, grade_level, $1 FROM sections
           WHERE school_year_id=$2 AND is_active=TRUE
           ON CONFLICT DO NOTHING`,
          [newSY.id, value.copy_from_id]
        )

        // Copy grading structures: fetch old categories, insert as new, then copy children
        const oldCats = await client.query(
          `SELECT gs.id AS old_id, gs.name, gs.weight, gs.sort_order,
                  old_sub.name AS sub_name, old_sub.grade_level
           FROM grading_structure gs
           JOIN subjects old_sub ON old_sub.id = gs.subject_id
           WHERE old_sub.school_year_id = $1
             AND gs.category_id IS NULL AND gs.is_active = TRUE
           ORDER BY gs.sort_order`,
          [value.copy_from_id]
        )
        for (const cat of oldCats.rows) {
          // Find the matching new subject
          const newSub = await client.query(
            `SELECT id FROM subjects WHERE school_year_id=$1 AND name=$2 AND grade_level=$3 AND is_active=TRUE LIMIT 1`,
            [newSY.id, cat.sub_name, cat.grade_level]
          )
          if (!newSub.rows.length) continue
          const newSubId = newSub.rows[0].id

          // Insert the category
          const newCat = await client.query(
            `INSERT INTO grading_structure (subject_id, category_id, name, weight, sort_order)
             VALUES ($1, NULL, $2, $3, $4) RETURNING id`,
            [newSubId, cat.name, cat.weight, cat.sort_order]
          )
          // Copy child components
          await client.query(
            `INSERT INTO grading_structure (subject_id, category_id, name, weight, sort_order)
             SELECT $1, $2, gs.name, gs.weight, gs.sort_order
             FROM grading_structure gs
             WHERE gs.category_id = $3 AND gs.is_active = TRUE
             ORDER BY gs.sort_order`,
            [newSubId, newCat.rows[0].id, cat.old_id]
          )
        }

        // Copy teacher assignments from source school year
        const srcSY = await client.query('SELECT label FROM school_years WHERE id=$1', [value.copy_from_id])
        if (srcSY.rows.length) {
          await client.query(
            `INSERT INTO teacher_assignments (teacher_id, grade_level, section, subject, school_year)
             SELECT teacher_id, grade_level, section, subject, $1
             FROM teacher_assignments
             WHERE school_year=$2
             ON CONFLICT DO NOTHING`,
            [newSY.label, srcSY.rows[0].label]
          )
        }
      }

      return newSY
    })

    res.status(201).json({ message: 'School year created.', school_year: sy })
  } catch (err) { next(err) }
})

router.put('/school-years/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      label:       Joi.string().pattern(/^\d{4}-\d{4}$/).optional()
                     .messages({ 'string.pattern.base': 'Format must be YYYY-YYYY' }),
      is_active:   Joi.boolean().optional(),
      is_upcoming: Joi.boolean().optional(),
      start_date:  Joi.date().optional().allow(null),
      end_date:    Joi.date().optional().allow(null),
      period_model:   Joi.string().valid('4Q', '3T').optional(),
      grading_policy: Joi.string().valid('DO8_2015', 'DO15_2026', 'ZERO_BASED').optional(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    // An archived year is closed, so its grading model is frozen: changing it would
    // silently re-transmute grades that were already issued. Only a real change is
    // rejected -- the edit modal resubmits the current values verbatim, and that
    // no-op must keep working.
    if (value.period_model !== undefined || value.grading_policy !== undefined) {
      const cur = await query(
        'SELECT is_active, is_upcoming, period_model, grading_policy FROM school_years WHERE id=$1',
        [req.params.id]
      )
      if (cur.rows.length) {
        const row = cur.rows[0]
        const archived = !row.is_active && !row.is_upcoming
        const changed =
          (value.period_model   !== undefined && value.period_model   !== (row.period_model   || '4Q')) ||
          (value.grading_policy !== undefined && value.grading_policy !== (row.grading_policy || 'DO8_2015'))
        if (archived && changed) {
          throw new AppError(
            'The grading model of an archived school year cannot be changed. Its grades were already issued and must stay reproducible.',
            409
          )
        }
      }
    }

    // Validate label+dates alignment if any of them are being updated
    if (value.label || value.start_date || value.end_date) {
      // Fetch current values to fill in any missing fields
      const current = await query('SELECT label, start_date, end_date FROM school_years WHERE id=$1', [req.params.id])
      if (current.rows.length) {
        const cur = current.rows[0]
        const checkLabel = value.label || cur.label
        const checkStart = value.start_date !== undefined ? value.start_date : cur.start_date
        const checkEnd   = value.end_date   !== undefined ? value.end_date   : cur.end_date
        const syErr = validateSchoolYear(checkLabel, checkStart, checkEnd)
        if (syErr) throw new AppError(syErr, 422)
      }
    }

    if (value.is_active && value.is_upcoming) throw new AppError('A school year cannot be both active and upcoming.', 422)

    if (value.is_upcoming === true) {
      const cur = await query('SELECT label FROM school_years WHERE id=$1', [req.params.id])
      if (cur.rows.length) {
        const endYear = parseInt((value.label || cur.rows[0].label).split('-')[1])
        if (endYear <= new Date().getFullYear()) throw new AppError('Past school years cannot be tagged as upcoming.', 422)
      }
    }

    const sets=[]; const params=[]
    if (value.label      !== undefined) { params.push(value.label);       sets.push(`label=$${params.length}`) }
    if (value.is_active  !== undefined) { params.push(value.is_active);   sets.push(`is_active=$${params.length}`) }
    if (value.is_upcoming !== undefined){ params.push(value.is_upcoming);  sets.push(`is_upcoming=$${params.length}`) }
    if (value.start_date !== undefined) { params.push(value.start_date);  sets.push(`start_date=$${params.length}`) }
    if (value.end_date   !== undefined) { params.push(value.end_date);    sets.push(`end_date=$${params.length}`) }
    if (value.period_model   !== undefined) { params.push(value.period_model);   sets.push(`period_model=$${params.length}`) }
    if (value.grading_policy !== undefined) { params.push(value.grading_policy); sets.push(`grading_policy=$${params.length}`) }
    if (!sets.length) throw new AppError('Nothing to update.', 400)
    sets.push('updated_at=NOW()')
    params.push(req.params.id)

    const result = await withTransaction(async (client) => {
      // Enforce single-active across all school years
      if (value.is_active === true) await client.query(`UPDATE school_years SET is_active=FALSE, updated_at=NOW() WHERE id!=$1`, [req.params.id])
      // Mutual exclusivity on this row: activating clears upcoming and vice versa
      if (value.is_active   === true && value.is_upcoming === undefined) sets.push('is_upcoming=FALSE')
      if (value.is_upcoming === true && value.is_active   === undefined) sets.push('is_active=FALSE')
      const r = await client.query(
        `UPDATE school_years SET ${sets.join(',')}
         WHERE id=$${params.length}
         RETURNING id, label, is_active, is_upcoming, start_date, end_date,
                   period_model, grading_policy, created_at`,
        params
      )
      if (!r.rows.length) throw new AppError('School year not found.', 404)
      return r.rows[0]
    })
    res.json({ message: 'School year updated.', school_year: result })
  } catch (err) { next(err) }
})

router.delete('/school-years/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const sy = await query('SELECT label, is_active FROM school_years WHERE id=$1', [req.params.id])
    if (!sy.rows.length) throw new AppError('School year not found.', 404)
    if (sy.rows[0].is_active) throw new AppError('Cannot delete the active school year.', 409)

    const inUse = await query(
      `SELECT COUNT(*) FROM grades WHERE school_year=$1`, [sy.rows[0].label]
    )
    if (parseInt(inUse.rows[0].count) > 0) {
      throw new AppError('Cannot delete: this school year has existing grade records.', 409)
    }

    await query('DELETE FROM school_years WHERE id=$1', [req.params.id])
    res.json({ message: `School year "${sy.rows[0].label}" deleted.` })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// SUBJECTS  (all filtered by school_year_id)
// ════════════════════════════════════════════════════════════

router.get('/subjects', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const conditions = ['school_year_id=$1', 'is_active=TRUE']
    const params = [sy_id]
    if (req.query.grade_level) { params.push(req.query.grade_level); conditions.push(`grade_level=$${params.length}`) }
    if (isScopedAdmin(req.user.role)) {
      params.push(gradeScopeForRole(req.user.role))
      conditions.push(`grade_level = ANY($${params.length}::text[])`)
    }

    const result = await query(
      `SELECT id, name, grade_level, created_at,
              EXISTS(SELECT 1 FROM grading_structure gs WHERE gs.subject_id=subjects.id AND gs.is_active=TRUE) AS has_grading
       FROM subjects WHERE ${conditions.join(' AND ')}
       ORDER BY ${GRADE_ORDER}, name`, params
    )
    res.json({ subjects: result.rows })
  } catch (err) { next(err) }
})

router.get('/subjects/grouped', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const scope = gradeScopeForRole(req.user.role)
    const result = await query(
      `SELECT id, name, grade_level,
              EXISTS(SELECT 1 FROM grading_structure gs WHERE gs.subject_id=subjects.id AND gs.is_active=TRUE) AS has_grading
       FROM subjects WHERE school_year_id=$1 AND is_active=TRUE
         AND grade_level = ANY($2::text[])
       ORDER BY ${GRADE_ORDER}, name`, [sy_id, scope]
    )
    const grouped = {}
    for (const gl of scope) grouped[gl] = []
    for (const row of result.rows) { if (grouped[row.grade_level]) grouped[row.grade_level].push(row) }
    res.json({ grouped })
  } catch (err) { next(err) }
})

router.post('/subjects', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:         Joi.string().min(1).max(100).required(),
      grade_level:  Joi.string().valid(...GRADE_LEVELS).required(),
      sy_id:        Joi.string().uuid().optional(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    enforceGradeScope(req, value.grade_level)

    const sy_id = await resolveSYId(value.sy_id)
    const dup = await query(
      'SELECT id FROM subjects WHERE school_year_id=$1 AND grade_level=$2 AND name=$3 AND is_active=TRUE',
      [sy_id, value.grade_level, value.name]
    )
    if (dup.rows.length) throw new AppError(`"${value.name}" already exists in ${value.grade_level} for this school year.`, 409)

    const result = await query(
      `INSERT INTO subjects (name, grade_level, school_year_id)
       VALUES ($1,$2,$3) RETURNING id, name, grade_level, created_at`,
      [value.name, value.grade_level, sy_id]
    )
    res.status(201).json({ message: 'Subject added.', subject: result.rows[0] })
  } catch (err) { next(err) }
})

router.put('/subjects/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().min(1).max(100).optional(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).optional(),
    }).validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    await assertCurriculumRowInScope(req, 'subjects', req.params.id)
    if (value.grade_level) enforceGradeScope(req, value.grade_level)

    const sets=[]; const params=[]
    if (value.name)        { params.push(value.name);        sets.push(`name=$${params.length}`) }
    if (value.grade_level) { params.push(value.grade_level); sets.push(`grade_level=$${params.length}`) }
    if (!sets.length) throw new AppError('Nothing to update.', 400)
    sets.push('updated_at=NOW()')
    params.push(req.params.id)

    const result = await query(
      `UPDATE subjects SET ${sets.join(',')}
       WHERE id=$${params.length} AND is_active=TRUE
       RETURNING id, name, grade_level, created_at`, params
    )
    if (!result.rows.length) throw new AppError('Subject not found.', 404)
    res.json({ message: 'Subject updated.', subject: result.rows[0] })
  } catch (err) { next(err) }
})

router.delete('/subjects/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const sub = await query('SELECT name, grade_level FROM subjects WHERE id=$1', [req.params.id])
    if (!sub.rows.length) throw new AppError('Subject not found.', 404)
    if (isScopedAdmin(req.user.role) && !canManageGrade(req.user.role, sub.rows[0].grade_level)) {
      throw new AppError('Subject is outside your grade scope.', 403)
    }

    const inUse = await query('SELECT COUNT(*) FROM grades WHERE subject_id=$1', [req.params.id])
    if (parseInt(inUse.rows[0].count) > 0) {
      throw new AppError('Cannot delete: this subject has existing grade records.', 409)
    }
    await query('UPDATE subjects SET is_active=FALSE, updated_at=NOW() WHERE id=$1', [req.params.id])
    res.json({ message: `"${sub.rows[0].name}" removed from ${sub.rows[0].grade_level}.` })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// SECTIONS  (all filtered by school_year_id)
// ════════════════════════════════════════════════════════════

router.get('/sections', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const conditions = ['school_year_id=$1', 'is_active=TRUE']
    const params = [sy_id]
    if (req.query.grade_level) { params.push(req.query.grade_level); conditions.push(`grade_level=$${params.length}`) }
    if (isScopedAdmin(req.user.role)) {
      params.push(gradeScopeForRole(req.user.role))
      conditions.push(`grade_level = ANY($${params.length}::text[])`)
    }

    const result = await query(
      `SELECT id, name, grade_level, created_at
       FROM sections WHERE ${conditions.join(' AND ')}
       ORDER BY ${GRADE_ORDER}, name`, params
    )
    res.json({ sections: result.rows })
  } catch (err) { next(err) }
})

router.get('/sections/grouped', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const scope = gradeScopeForRole(req.user.role)
    const result = await query(
      `SELECT id, name, grade_level
       FROM sections WHERE school_year_id=$1 AND is_active=TRUE
         AND grade_level = ANY($2::text[])
       ORDER BY ${GRADE_ORDER}, name`, [sy_id, scope]
    )
    const grouped = {}
    for (const gl of scope) grouped[gl] = []
    for (const row of result.rows) { if (grouped[row.grade_level]) grouped[row.grade_level].push(row) }
    res.json({ grouped })
  } catch (err) { next(err) }
})

router.post('/sections', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().min(1).max(100).required(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).required(),
      sy_id:       Joi.string().uuid().optional(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    enforceGradeScope(req, value.grade_level)

    const sy_id = await resolveSYId(value.sy_id)
    const dup = await query(
      'SELECT id FROM sections WHERE school_year_id=$1 AND grade_level=$2 AND name=$3 AND is_active=TRUE',
      [sy_id, value.grade_level, value.name]
    )
    if (dup.rows.length) throw new AppError(`Section "${value.name}" already exists in ${value.grade_level} for this school year.`, 409)

    const result = await query(
      `INSERT INTO sections (name, grade_level, school_year_id)
       VALUES ($1,$2,$3) RETURNING id, name, grade_level, created_at`,
      [value.name, value.grade_level, sy_id]
    )
    res.status(201).json({ message: 'Section added.', section: result.rows[0] })
  } catch (err) { next(err) }
})

router.put('/sections/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().min(1).max(100).optional(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).optional(),
    }).validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    await assertCurriculumRowInScope(req, 'sections', req.params.id)
    if (value.grade_level) enforceGradeScope(req, value.grade_level)

    const sets=[]; const params=[]
    if (value.name)        { params.push(value.name);        sets.push(`name=$${params.length}`) }
    if (value.grade_level) { params.push(value.grade_level); sets.push(`grade_level=$${params.length}`) }
    if (!sets.length) throw new AppError('Nothing to update.', 400)
    sets.push('updated_at=NOW()')
    params.push(req.params.id)

    const result = await query(
      `UPDATE sections SET ${sets.join(',')}
       WHERE id=$${params.length} AND is_active=TRUE
       RETURNING id, name, grade_level, created_at`, params
    )
    if (!result.rows.length) throw new AppError('Section not found.', 404)
    res.json({ message: 'Section updated.', section: result.rows[0] })
  } catch (err) { next(err) }
})

router.delete('/sections/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const sec = await query('SELECT name, grade_level FROM sections WHERE id=$1', [req.params.id])
    if (!sec.rows.length) throw new AppError('Section not found.', 404)
    if (isScopedAdmin(req.user.role) && !canManageGrade(req.user.role, sec.rows[0].grade_level)) {
      throw new AppError('Section is outside your grade scope.', 403)
    }

    const inUse = await query(
      `SELECT COUNT(*) FROM students
       WHERE section=(SELECT name FROM sections WHERE id=$1) AND is_active=TRUE`,
      [req.params.id]
    )
    if (parseInt(inUse.rows[0].count) > 0) {
      throw new AppError('Cannot delete: students are currently enrolled in this section.', 409)
    }
    await query('UPDATE sections SET is_active=FALSE, updated_at=NOW() WHERE id=$1', [req.params.id])
    res.json({ message: `Section "${sec.rows[0].name}" removed from ${sec.rows[0].grade_level}.` })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// GRADING STRUCTURE  (per subject)
// ════════════════════════════════════════════════════════════

router.get('/subjects/:id/grading', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, category_id, name, weight, sort_order
       FROM grading_structure
       WHERE subject_id=$1 AND is_active=TRUE
       ORDER BY sort_order, name`,
      [req.params.id]
    )
    // Assemble tree: categories (category_id IS NULL) with nested components
    const categories = []
    const catMap = new Map()
    for (const row of result.rows) {
      if (!row.category_id) {
        const cat = { ...row, components: [] }
        categories.push(cat)
        catMap.set(row.id, cat)
      }
    }
    for (const row of result.rows) {
      if (row.category_id && catMap.has(row.category_id)) {
        const { category_id, ...comp } = row
        catMap.get(row.category_id).components.push(comp)
      }
    }
    res.json({ categories })
  } catch (err) { next(err) }
})

router.put('/subjects/:id/grading', authorizeAnyAdmin, async (req, res, next) => {
  try {
    // Validate subject exists
    const sub = await query('SELECT id, grade_level FROM subjects WHERE id=$1 AND is_active=TRUE', [req.params.id])
    if (!sub.rows.length) throw new AppError('Subject not found.', 404)
    if (isScopedAdmin(req.user.role) && !canManageGrade(req.user.role, sub.rows[0].grade_level)) {
      throw new AppError('Subject is outside your grade scope.', 403)
    }

    const catSchema = Joi.object({
      id:         Joi.string().uuid().optional(),
      name:       Joi.string().min(1).max(100).required(),
      weight:     Joi.number().precision(2).greater(0).max(100).required(),
      sort_order: Joi.number().integer().min(0).default(0),
      components: Joi.array().items(Joi.object({
        id:         Joi.string().uuid().optional(),
        name:       Joi.string().min(1).max(100).required(),
        weight:     Joi.number().precision(2).greater(0).max(100).required(),
        sort_order: Joi.number().integer().min(0).default(0),
      })).default([]),
    })
    const { error, value } = Joi.object({
      categories: Joi.array().items(catSchema).min(1).required(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    // Validate category weights sum to 100
    const catTotal = value.categories.reduce((s, c) => s + parseFloat(c.weight), 0)
    if (Math.abs(catTotal - 100) > 0.01) {
      throw new AppError(`Category weights must sum to 100% (currently ${catTotal.toFixed(2)}%).`, 422)
    }

    // Validate component weights within each category sum to category weight
    for (const cat of value.categories) {
      if (cat.components.length > 0) {
        const compTotal = cat.components.reduce((s, c) => s + parseFloat(c.weight), 0)
        if (Math.abs(compTotal - parseFloat(cat.weight)) > 0.01) {
          throw new AppError(
            `Components in "${cat.name}" must sum to ${cat.weight}% (currently ${compTotal.toFixed(2)}%).`, 422
          )
        }
      }
    }

    const categories = await withTransaction(async (client) => {
      // Collect IDs that should remain active
      const keepIds = []
      for (const cat of value.categories) {
        if (cat.id) keepIds.push(cat.id)
        for (const comp of cat.components) {
          if (comp.id) keepIds.push(comp.id)
        }
      }

      // Find rows being removed
      const removedRes = keepIds.length > 0
        ? await client.query(
            `SELECT id, name, category_id FROM grading_structure
             WHERE subject_id=$1 AND is_active=TRUE AND id != ALL($2)`,
            [req.params.id, keepIds]
          )
        : await client.query(
            `SELECT id, name, category_id FROM grading_structure
             WHERE subject_id=$1 AND is_active=TRUE`,
            [req.params.id]
          )

      // Block removal of components that have recorded scores
      if (removedRes.rows.length > 0) {
        const removedIds = removedRes.rows.map(r => r.id)
        const withScores = await client.query(
          `SELECT DISTINCT gs.id, gs.name
           FROM grading_structure gs
           JOIN score_items si ON si.component_id = gs.id AND si.is_active = TRUE
           JOIN student_scores ss ON ss.score_item_id = si.id
           WHERE gs.id = ANY($1)`,
          [removedIds]
        )
        if (withScores.rows.length > 0) {
          const names = withScores.rows.map(r => `"${r.name}"`).join(', ')
          throw new AppError(`Cannot remove ${names} — has recorded student scores. Clear scores in Score Entry first.`, 422)
        }
      }

      // Soft-delete rows that are no longer in the payload
      if (removedRes.rows.length > 0) {
        const removedIds = removedRes.rows.map(r => r.id)
        await client.query(
          `UPDATE grading_structure SET is_active=FALSE, updated_at=NOW()
           WHERE id = ANY($1)`,
          [removedIds]
        )
      }

      const result = []
      for (let i = 0; i < value.categories.length; i++) {
        const cat = value.categories[i]
        let catRow

        if (cat.id) {
          // Update existing category
          const catRes = await client.query(
            `UPDATE grading_structure SET name=$1, weight=$2, sort_order=$3, is_active=TRUE, updated_at=NOW()
             WHERE id=$4 AND subject_id=$5
             RETURNING id, name, weight, sort_order`,
            [cat.name, cat.weight, cat.sort_order ?? i, cat.id, req.params.id]
          )
          catRow = catRes.rows[0]
        }
        if (!catRow) {
          // Insert new category
          const catRes = await client.query(
            `INSERT INTO grading_structure (subject_id, category_id, name, weight, sort_order)
             VALUES ($1, NULL, $2, $3, $4) RETURNING id, name, weight, sort_order`,
            [req.params.id, cat.name, cat.weight, cat.sort_order ?? i]
          )
          catRow = catRes.rows[0]
        }

        const newCat = { ...catRow, components: [] }

        for (let j = 0; j < cat.components.length; j++) {
          const comp = cat.components[j]
          let compRow

          if (comp.id) {
            // Update existing component
            const compRes = await client.query(
              `UPDATE grading_structure SET name=$1, weight=$2, sort_order=$3, category_id=$4, is_active=TRUE, updated_at=NOW()
               WHERE id=$5 AND subject_id=$6
               RETURNING id, name, weight, sort_order`,
              [comp.name, comp.weight, comp.sort_order ?? j, newCat.id, comp.id, req.params.id]
            )
            compRow = compRes.rows[0]
          }
          if (!compRow) {
            // Insert new component
            const compRes = await client.query(
              `INSERT INTO grading_structure (subject_id, category_id, name, weight, sort_order)
               VALUES ($1, $2, $3, $4, $5) RETURNING id, name, weight, sort_order`,
              [req.params.id, newCat.id, comp.name, comp.weight, comp.sort_order ?? j]
            )
            compRow = compRes.rows[0]
          }
          newCat.components.push(compRow)
        }
        result.push(newCat)
      }
      return result
    })

    res.json({ message: 'Grading structure saved.', categories })
  } catch (err) { next(err) }
})

router.delete('/subjects/:id/grading', authorizeAnyAdmin, async (req, res, next) => {
  try {
    await assertCurriculumRowInScope(req, 'subjects', req.params.id)
    // Block if any component has recorded scores
    const withScores = await query(
      `SELECT DISTINCT gs.name
       FROM grading_structure gs
       JOIN score_items si ON si.component_id = gs.id AND si.is_active = TRUE
       JOIN student_scores ss ON ss.score_item_id = si.id
       WHERE gs.subject_id=$1 AND gs.is_active=TRUE`,
      [req.params.id]
    )
    if (withScores.rows.length > 0) {
      const names = withScores.rows.map(r => `"${r.name}"`).join(', ')
      throw new AppError(`Cannot clear — ${names} has recorded student scores. Clear scores in Score Entry first.`, 422)
    }

    const result = await query(
      `UPDATE grading_structure SET is_active=FALSE, updated_at=NOW()
       WHERE subject_id=$1 AND is_active=TRUE RETURNING id`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('No grading structure found for this subject.', 404)
    res.json({ message: 'Grading structure cleared.' })
  } catch (err) { next(err) }
})

// GET /api/curriculum/subjects/:id/grading/scores-check
// Returns component IDs that have recorded student scores
router.get('/subjects/:id/grading/scores-check', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT DISTINCT gs.id
       FROM grading_structure gs
       JOIN score_items si ON si.component_id = gs.id AND si.is_active = TRUE
       JOIN student_scores ss ON ss.score_item_id = si.id
       WHERE gs.subject_id=$1 AND gs.is_active=TRUE`,
      [req.params.id]
    )
    res.json({ components_with_scores: result.rows.map(r => r.id) })
  } catch (err) { next(err) }
})

module.exports = router