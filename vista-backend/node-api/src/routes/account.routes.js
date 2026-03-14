const express = require('express')
const router  = express.Router()
const bcrypt  = require('bcryptjs')
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const { authenticate, authorize } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')

// ── All routes: admin only ───────────────────────────────────
router.use(authenticate, authorize('admin'))

// ── Validation schemas ───────────────────────────────────────
const assignmentShape = Joi.object({
  grade_level: Joi.string().required(),
  section:     Joi.string().required(),
  subject:     Joi.string().required(),
})

const createSchema = Joi.object({
  email:       Joi.string().email().required(),
  password:    Joi.string().min(8).required(),
  full_name:   Joi.string().min(2).required(),
  phone:       Joi.string().optional().allow(''),
  assignments: Joi.array().items(assignmentShape).optional(),
})

const updateSchema = Joi.object({
  full_name:   Joi.string().min(2).optional(),
  phone:       Joi.string().optional().allow(''),
  password:    Joi.string().min(8).optional().allow(''),
  is_active:   Joi.boolean().optional(),
  assignments: Joi.array().items(assignmentShape).optional(),
})

// ── Helper: get assignments for a teacher ────────────────────
const getAssignments = async (teacher_id) => {
  const res = await query(
    `SELECT id, grade_level, section, subject, school_year
     FROM teacher_assignments
     WHERE teacher_id = $1
     ORDER BY grade_level, section, subject`,
    [teacher_id]
  )
  return res.rows
}

// ── GET /api/accounts/teachers ───────────────────────────────
router.get('/teachers', async (req, res, next) => {
  try {
    const { search, is_active } = req.query
    const conditions = ["u.role = 'teacher'"]
    const params = []

    if (search) {
      params.push(`%${search}%`)
      conditions.push(
        `(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`
      )
    }
    if (is_active !== undefined) {
      params.push(is_active === 'true')
      conditions.push(`u.is_active = $${params.length}`)
    }

    const result = await query(
      `SELECT
         u.id, u.email, u.full_name, u.phone, u.is_active, u.created_at,
         COALESCE(
           json_agg(
             json_build_object(
               'id',          ta.id,
               'grade_level', ta.grade_level,
               'section',     ta.section,
               'subject',     ta.subject,
               'school_year', ta.school_year
             )
           ) FILTER (WHERE ta.id IS NOT NULL),
           '[]'
         ) AS assignments
       FROM users u
       LEFT JOIN teacher_assignments ta ON ta.teacher_id = u.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY u.id
       ORDER BY u.full_name`,
      params
    )

    res.json({ teachers: result.rows })
  } catch (err) { next(err) }
})

// ── GET /api/accounts/teachers/:id ──────────────────────────
router.get('/teachers/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, email, full_name, phone, is_active, created_at
       FROM users WHERE id = $1 AND role = 'teacher'`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Teacher not found.', 404)
    const teacher = result.rows[0]
    teacher.assignments = await getAssignments(teacher.id)
    res.json({ teacher })
  } catch (err) { next(err) }
})

// ── POST /api/accounts/teachers ─────────────────────────────
router.post('/teachers', async (req, res, next) => {
  try {
    const { error, value } = createSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { email, password, full_name, phone, assignments = [] } = value

    // Check duplicate email
    const existing = await query('SELECT id FROM users WHERE email = $1', [email])
    if (existing.rows.length) throw new AppError('Email already registered.', 409)

    const teacher = await withTransaction(async (client) => {
      // Create user
      const salt = await bcrypt.genSalt(12)
      const password_hash = await bcrypt.hash(password, salt)

      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, phone)
         VALUES ($1, $2, $3, 'teacher', $4)
         RETURNING id, email, full_name, phone, is_active, created_at`,
        [email, password_hash, full_name, phone || null]
      )
      const user = userRes.rows[0]

      // Insert assignments
      for (const a of assignments) {
        await client.query(
          `INSERT INTO teacher_assignments (teacher_id, grade_level, section, subject)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [user.id, a.grade_level, a.section, a.subject]
        )
      }

      user.assignments = await getAssignments(user.id)
      return user
    })

    res.status(201).json({ message: 'Teacher account created.', teacher })
  } catch (err) { next(err) }
})

// ── PUT /api/accounts/teachers/:id ──────────────────────────
router.put('/teachers/:id', async (req, res, next) => {
  try {
    const { error, value } = updateSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { full_name, phone, password, is_active, assignments } = value

    const teacher = await withTransaction(async (client) => {
      // Build dynamic SET clause
      const sets = []
      const params = []

      if (full_name  !== undefined) { params.push(full_name);  sets.push(`full_name  = $${params.length}`) }
      if (phone      !== undefined) { params.push(phone);      sets.push(`phone      = $${params.length}`) }
      if (is_active  !== undefined) { params.push(is_active);  sets.push(`is_active  = $${params.length}`) }
      if (password) {
        const salt = await bcrypt.genSalt(12)
        const hash = await bcrypt.hash(password, salt)
        params.push(hash)
        sets.push(`password_hash = $${params.length}`)
      }

      if (sets.length) {
        params.push(req.params.id)
        sets.push(`updated_at = NOW()`)
        const res = await client.query(
          `UPDATE users SET ${sets.join(', ')}
           WHERE id = $${params.length} AND role = 'teacher'
           RETURNING id, email, full_name, phone, is_active, created_at`,
          params
        )
        if (!res.rows.length) throw new AppError('Teacher not found.', 404)
      }

      // Replace assignments if provided
      if (assignments !== undefined) {
        await client.query(
          'DELETE FROM teacher_assignments WHERE teacher_id = $1',
          [req.params.id]
        )
        for (const a of assignments) {
          await client.query(
            `INSERT INTO teacher_assignments (teacher_id, grade_level, section, subject)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [req.params.id, a.grade_level, a.section, a.subject]
          )
        }
      }

      const updated = await client.query(
        'SELECT id, email, full_name, phone, is_active, created_at FROM users WHERE id = $1',
        [req.params.id]
      )
      const teacher = updated.rows[0]
      teacher.assignments = await getAssignments(teacher.id)
      return teacher
    })

    res.json({ message: 'Teacher account updated.', teacher })
  } catch (err) { next(err) }
})

// ── DELETE /api/accounts/teachers/:id ───────────────────────
// Soft delete — sets is_active = false
router.delete('/teachers/:id', async (req, res, next) => {
  try {
    // Prevent admin from deleting themselves
    if (req.params.id === req.user.id) {
      throw new AppError('You cannot delete your own account.', 400)
    }
    const result = await query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND role = 'teacher'
       RETURNING id, full_name`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Teacher not found.', 404)
    res.json({ message: `${result.rows[0].full_name}'s account has been deactivated.` })
  } catch (err) { next(err) }
})

// ── DELETE /api/accounts/teachers/:id/permanent ─────────────
// Hard delete — removes from DB entirely (use with caution)
router.delete('/teachers/:id/permanent', async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      throw new AppError('You cannot delete your own account.', 400)
    }
    const result = await query(
      `DELETE FROM users WHERE id = $1 AND role = 'teacher' RETURNING full_name`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Teacher not found.', 404)
    res.json({ message: `${result.rows[0].full_name} permanently deleted.` })
  } catch (err) { next(err) }
})

module.exports = router