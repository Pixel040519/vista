const express = require('express')
const router  = express.Router()
const Joi     = require('joi')
const { query } = require('../config/database')
const { authenticate, authorize } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')

router.use(authenticate)

const ECE_GRADES = ['Pre-Nursery', 'Nursery', 'Pre-Kinder', 'Kinder']

const getActiveSYId = async () => {
  const res = await query('SELECT id, label FROM school_years WHERE is_active=TRUE LIMIT 1')
  if (!res.rows.length) throw new AppError('No active school year set.', 400)
  return res.rows[0]
}

// Resolve SY: use provided sy_id if valid, else active
const resolveSY = async (syId) => {
  if (syId) {
    const r = await query('SELECT id, label FROM school_years WHERE id=$1', [syId])
    if (r.rows.length) return r.rows[0]
  }
  return await getActiveSYId()
}

// Verify teacher is assigned to this (grade_level, section) for an ECE grade in the active SY
const verifyEceAssignment = async (req, gradeLevel, section) => {
  if (req.user.role === 'admin') return
  if (!ECE_GRADES.includes(gradeLevel)) {
    throw new AppError('ECE features are only available for Pre-Nursery to Kinder.', 403)
  }
  const sy = await getActiveSYId()
  const res = await query(
    `SELECT 1 FROM teacher_assignments
     WHERE teacher_id=$1 AND grade_level=$2 AND section=$3 AND school_year=$4
     LIMIT 1`,
    [req.user.id, gradeLevel, section, sy.label]
  )
  if (!res.rows.length) {
    throw new AppError('You are not assigned to this class.', 403)
  }
}

// ─── Catalog: Skills (grouped by subject) ────────────────────
router.get('/skills', async (req, res, next) => {
  try {
    const { subject_id } = req.query
    const params = []
    let where = 'WHERE s.is_active = TRUE'
    if (subject_id) {
      params.push(subject_id)
      where += ` AND s.subject_id = $${params.length}`
    }
    const r = await query(
      `SELECT s.id, s.subject_id, s.name, s.description, s.display_order, s.is_active
       FROM competency_skills s
       ${where}
       ORDER BY s.display_order, s.name`,
      params
    )
    res.json({ skills: r.rows })
  } catch (e) { next(e) }
})

router.post('/skills', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const schema = Joi.object({
      subject_id: Joi.string().uuid().required(),
      name: Joi.string().min(1).max(255).required(),
      description: Joi.string().allow('').optional(),
      display_order: Joi.number().integer().min(0).default(0),
    })
    const { value, error } = schema.validate(req.body)
    if (error) throw new AppError(error.message, 400)
    const r = await query(
      `INSERT INTO competency_skills (subject_id, name, description, display_order)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [value.subject_id, value.name, value.description || null, value.display_order]
    )
    res.status(201).json({ skill: r.rows[0] })
  } catch (e) { next(e) }
})

router.put('/skills/:id', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const schema = Joi.object({
      name: Joi.string().min(1).max(255).optional(),
      description: Joi.string().allow('').optional(),
      display_order: Joi.number().integer().min(0).optional(),
      is_active: Joi.boolean().optional(),
    })
    const { value, error } = schema.validate(req.body)
    if (error) throw new AppError(error.message, 400)
    const sets = []
    const params = []
    let i = 1
    for (const [k, v] of Object.entries(value)) {
      sets.push(`${k}=$${i++}`)
      params.push(v)
    }
    if (!sets.length) throw new AppError('No fields to update.', 400)
    sets.push(`updated_at=NOW()`)
    params.push(req.params.id)
    const r = await query(
      `UPDATE competency_skills SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`,
      params
    )
    if (!r.rows.length) throw new AppError('Skill not found.', 404)
    res.json({ skill: r.rows[0] })
  } catch (e) { next(e) }
})

router.delete('/skills/:id', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const used = await query(
      `SELECT 1 FROM ece_competency_records WHERE skill_id=$1 LIMIT 1`, [req.params.id]
    )
    if (used.rows.length) {
      await query(`UPDATE competency_skills SET is_active=FALSE, updated_at=NOW() WHERE id=$1`, [req.params.id])
      return res.json({ message: 'Skill archived (has existing records).' })
    }
    await query(`DELETE FROM competency_skills WHERE id=$1`, [req.params.id])
    res.json({ message: 'Skill deleted.' })
  } catch (e) { next(e) }
})

// ─── Records: teacher entry ──────────────────────────────────
// GET /records?grade_level=...&section=...&quarter=1&sy_id=
// Returns roster + existing records for that class+quarter.
router.get('/records', async (req, res, next) => {
  try {
    const { grade_level, section, quarter, sy_id } = req.query
    if (!grade_level || !section || !quarter) {
      throw new AppError('grade_level, section, and quarter are required.', 400)
    }
    if (!ECE_GRADES.includes(grade_level)) {
      throw new AppError('Only ECE grade levels are supported.', 400)
    }
    await verifyEceAssignment(req, grade_level, section)
    const sy = await resolveSY(sy_id)

    const students = await query(
      `SELECT id, full_name, gender FROM students
       WHERE is_active=TRUE AND grade_level=$1 AND section=$2
       ORDER BY full_name`,
      [grade_level, section]
    )

    const records = await query(
      `SELECT r.student_id, r.skill_id, r.rating, r.notes
       FROM ece_competency_records r
       JOIN students s ON s.id = r.student_id
       WHERE s.grade_level=$1 AND s.section=$2
         AND r.school_year_id=$3 AND r.quarter=$4`,
      [grade_level, section, sy.id, quarter]
    )

    res.json({
      school_year: sy,
      students: students.rows,
      records: records.rows,
    })
  } catch (e) { next(e) }
})

// POST /records — bulk upsert for a class
// { grade_level, section, quarter, sy_id?, entries: [{ student_id, skill_id, rating, notes? }] }
router.post('/records', async (req, res, next) => {
  try {
    const schema = Joi.object({
      grade_level: Joi.string().valid(...ECE_GRADES).required(),
      section: Joi.string().required(),
      quarter: Joi.number().integer().min(1).max(4).required(),
      sy_id: Joi.string().uuid().optional(),
      entries: Joi.array().items(Joi.object({
        student_id: Joi.string().uuid().required(),
        skill_id: Joi.string().uuid().required(),
        rating: Joi.string().valid('E','G','F','NA').required(),
        notes: Joi.string().allow('').optional(),
      })).required(),
    })
    const { value, error } = schema.validate(req.body)
    if (error) throw new AppError(error.message, 400)

    await verifyEceAssignment(req, value.grade_level, value.section)
    const sy = await resolveSY(value.sy_id)

    // Upsert each entry
    for (const e of value.entries) {
      await query(
        `INSERT INTO ece_competency_records
           (student_id, skill_id, school_year_id, quarter, rating, notes, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (student_id, skill_id, school_year_id, quarter)
         DO UPDATE SET rating = EXCLUDED.rating,
                       notes = EXCLUDED.notes,
                       recorded_by = EXCLUDED.recorded_by,
                       updated_at = NOW()`,
        [e.student_id, e.skill_id, sy.id, value.quarter, e.rating, e.notes || null, req.user.id]
      )
    }

    res.json({ message: `Saved ${value.entries.length} competency record(s).` })
  } catch (e) { next(e) }
})

module.exports = router
