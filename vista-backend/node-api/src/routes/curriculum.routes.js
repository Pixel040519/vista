const express = require('express')
const router  = express.Router()
const Joi     = require('joi')
const { query } = require('../config/database')
const { authenticate, authorize } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')

const GRADE_LEVELS = ['Pre-Nursery','Pre-Kinder','Nursery','Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6']

// ── Public: any authenticated user can read ───────────────────
router.use(authenticate)

// ════════════════════════════════════════════════════════════
// SUBJECTS
// ════════════════════════════════════════════════════════════

// GET /api/curriculum/subjects?grade_level=Grade 1
router.get('/subjects', async (req, res, next) => {
  try {
    const { grade_level } = req.query
    const conditions = ['is_active = TRUE']
    const params = []

    if (grade_level) {
      params.push(grade_level)
      conditions.push(`grade_level = $${params.length}`)
    }

    const result = await query(
      `SELECT id, name, grade_level, description, created_at
       FROM subjects
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE grade_level
           WHEN 'Pre-Nursery' THEN 1 WHEN 'Pre-Kinder' THEN 2
           WHEN 'Nursery' THEN 3 WHEN 'Kinder' THEN 4
           WHEN 'Grade 1' THEN 5 WHEN 'Grade 2' THEN 6
           WHEN 'Grade 3' THEN 7 WHEN 'Grade 4' THEN 8
           WHEN 'Grade 5' THEN 9 WHEN 'Grade 6' THEN 10
           ELSE 11
         END, name`,
      params
    )
    res.json({ subjects: result.rows })
  } catch (err) { next(err) }
})

// GET /api/curriculum/subjects/grouped  → { 'Grade 1': [...], ... }
router.get('/subjects/grouped', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, grade_level, description
       FROM subjects WHERE is_active = TRUE
       ORDER BY grade_level, name`
    )
    const grouped = {}
    for (const gl of GRADE_LEVELS) grouped[gl] = []
    for (const row of result.rows) {
      if (grouped[row.grade_level]) grouped[row.grade_level].push(row)
    }
    res.json({ grouped })
  } catch (err) { next(err) }
})

// POST /api/curriculum/subjects — admin only
router.post('/subjects', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().min(1).max(100).required(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).required(),
      description: Joi.string().optional().allow(''),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const dup = await query(
      'SELECT id FROM subjects WHERE grade_level=$1 AND name=$2 AND is_active=TRUE',
      [value.grade_level, value.name]
    )
    if (dup.rows.length) throw new AppError(`"${value.name}" already exists in ${value.grade_level}.`, 409)

    const result = await query(
      `INSERT INTO subjects (name, grade_level, description)
       VALUES ($1, $2, $3) RETURNING id, name, grade_level, description, created_at`,
      [value.name, value.grade_level, value.description || null]
    )
    res.status(201).json({ message: 'Subject added.', subject: result.rows[0] })
  } catch (err) { next(err) }
})

// PUT /api/curriculum/subjects/:id — admin only
router.put('/subjects/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().min(1).max(100).optional(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).optional(),
      description: Joi.string().optional().allow(''),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const sets = []; const params = []
    if (value.name)        { params.push(value.name);        sets.push(`name=$${params.length}`) }
    if (value.grade_level) { params.push(value.grade_level); sets.push(`grade_level=$${params.length}`) }
    if (value.description !== undefined) { params.push(value.description || null); sets.push(`description=$${params.length}`) }
    if (!sets.length) throw new AppError('Nothing to update.', 400)

    sets.push('updated_at=NOW()')
    params.push(req.params.id)

    const result = await query(
      `UPDATE subjects SET ${sets.join(',')}
       WHERE id=$${params.length} AND is_active=TRUE
       RETURNING id, name, grade_level, description, created_at`,
      params
    )
    if (!result.rows.length) throw new AppError('Subject not found.', 404)
    res.json({ message: 'Subject updated.', subject: result.rows[0] })
  } catch (err) { next(err) }
})

// DELETE /api/curriculum/subjects/:id — admin only (soft delete)
router.delete('/subjects/:id', authorize('admin'), async (req, res, next) => {
  try {
    // Check if subject is in use (has grade records)
    const inUse = await query(
      'SELECT COUNT(*) FROM grades WHERE subject_id=$1', [req.params.id]
    )
    if (parseInt(inUse.rows[0].count) > 0) {
      throw new AppError(
        'Cannot delete: this subject has existing grade records. Deactivate it instead.',
        409
      )
    }
    const result = await query(
      `UPDATE subjects SET is_active=FALSE, updated_at=NOW()
       WHERE id=$1 AND is_active=TRUE RETURNING name, grade_level`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Subject not found.', 404)
    res.json({ message: `"${result.rows[0].name}" removed from ${result.rows[0].grade_level}.` })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// SECTIONS
// ════════════════════════════════════════════════════════════

// GET /api/curriculum/sections?grade_level=Grade 1
router.get('/sections', async (req, res, next) => {
  try {
    const { grade_level } = req.query
    const conditions = ['is_active = TRUE']
    const params = []

    if (grade_level) {
      params.push(grade_level)
      conditions.push(`grade_level = $${params.length}`)
    }

    const result = await query(
      `SELECT id, name, grade_level, created_at
       FROM sections
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE grade_level
           WHEN 'Nursery' THEN 1 WHEN 'Kinder' THEN 2
           WHEN 'Grade 1' THEN 3 WHEN 'Grade 2' THEN 4
           WHEN 'Grade 3' THEN 5 WHEN 'Grade 4' THEN 6
           WHEN 'Grade 5' THEN 7 WHEN 'Grade 6' THEN 8
           ELSE 9
         END, name`,
      params
    )
    res.json({ sections: result.rows })
  } catch (err) { next(err) }
})

// GET /api/curriculum/sections/grouped → { 'Grade 1': [...], ... }
router.get('/sections/grouped', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, grade_level FROM sections
       WHERE is_active=TRUE ORDER BY grade_level, name`
    )
    const grouped = {}
    for (const gl of GRADE_LEVELS) grouped[gl] = []
    for (const row of result.rows) {
      if (grouped[row.grade_level]) grouped[row.grade_level].push(row)
    }
    res.json({ grouped })
  } catch (err) { next(err) }
})

// POST /api/curriculum/sections — admin only
router.post('/sections', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().min(1).max(100).required(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).required(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const dup = await query(
      'SELECT id FROM sections WHERE grade_level=$1 AND name=$2 AND is_active=TRUE',
      [value.grade_level, value.name]
    )
    if (dup.rows.length) throw new AppError(`Section "${value.name}" already exists in ${value.grade_level}.`, 409)

    const result = await query(
      `INSERT INTO sections (name, grade_level)
       VALUES ($1, $2) RETURNING id, name, grade_level, created_at`,
      [value.name, value.grade_level]
    )
    res.status(201).json({ message: 'Section added.', section: result.rows[0] })
  } catch (err) { next(err) }
})

// PUT /api/curriculum/sections/:id — admin only
router.put('/sections/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().min(1).max(100).optional(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).optional(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const sets = []; const params = []
    if (value.name)        { params.push(value.name);        sets.push(`name=$${params.length}`) }
    if (value.grade_level) { params.push(value.grade_level); sets.push(`grade_level=$${params.length}`) }
    if (!sets.length) throw new AppError('Nothing to update.', 400)

    sets.push('updated_at=NOW()')
    params.push(req.params.id)

    const result = await query(
      `UPDATE sections SET ${sets.join(',')}
       WHERE id=$${params.length} AND is_active=TRUE
       RETURNING id, name, grade_level, created_at`,
      params
    )
    if (!result.rows.length) throw new AppError('Section not found.', 404)
    res.json({ message: 'Section updated.', section: result.rows[0] })
  } catch (err) { next(err) }
})

// DELETE /api/curriculum/sections/:id — admin only
router.delete('/sections/:id', authorize('admin'), async (req, res, next) => {
  try {
    // Check if section is in use by any student
    const inUse = await query(
      `SELECT COUNT(*) FROM students
       WHERE section = (SELECT name FROM sections WHERE id=$1) AND is_active=TRUE`,
      [req.params.id]
    )
    if (parseInt(inUse.rows[0].count) > 0) {
      throw new AppError(
        'Cannot delete: students are currently enrolled in this section.',
        409
      )
    }
    const result = await query(
      `UPDATE sections SET is_active=FALSE, updated_at=NOW()
       WHERE id=$1 AND is_active=TRUE RETURNING name, grade_level`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Section not found.', 404)
    res.json({ message: `Section "${result.rows[0].name}" removed from ${result.rows[0].grade_level}.` })
  } catch (err) { next(err) }
})

module.exports = router