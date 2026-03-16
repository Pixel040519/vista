const express = require('express')
const router  = express.Router()
const bcrypt  = require('bcryptjs')
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const { authenticate, authorize } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { normaliseName } = require('../utils/nameHelper')

router.use(authenticate, authorize('admin'))

const assignmentShape = Joi.object({
  grade_level: Joi.string().required(),
  section:     Joi.string().required(),
  subject:     Joi.string().required(),
})

const createSchema = Joi.object({
  email:       Joi.string().email().required(),
  password:    Joi.string().min(8).required(),
  surname:     Joi.string().min(1).required(),
  first_name:  Joi.string().min(1).required(),
  middle_name: Joi.string().optional().allow(''),
  phone:       Joi.string().min(7).required(),
  home_address: Joi.string().trim().min(1).required(),
  assignments: Joi.array().items(assignmentShape).optional(),
})

const updateSchema = Joi.object({
  surname:     Joi.string().min(1).optional(),
  first_name:  Joi.string().min(1).optional(),
  middle_name: Joi.string().optional().allow(''),
  phone:       Joi.string().optional().allow(''),
  home_address: Joi.string().trim().optional().allow(''),
  password:    Joi.string().min(8).optional().allow(''),
  is_active:   Joi.boolean().optional(),
  assignments: Joi.array().items(assignmentShape).optional(),
})

const getAssignments = async (teacher_id) => {
  const res = await query(
    `SELECT id, grade_level, section, subject, school_year
     FROM teacher_assignments WHERE teacher_id=$1
     ORDER BY grade_level, section, subject`,
    [teacher_id]
  )
  return res.rows
}

// GET /api/accounts/teachers
router.get('/teachers', async (req, res, next) => {
  try {
    const { search, is_active } = req.query
    const conditions = ["u.role='teacher'"]
    const params = []

    if (search) {
      params.push(`%${search}%`)
      conditions.push(`(u.surname ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`)
    }
    if (is_active !== undefined) {
      params.push(is_active === 'true')
      conditions.push(`u.is_active=$${params.length}`)
    }

    const result = await query(
      `SELECT u.id, u.email, u.surname, u.first_name, u.middle_name, u.full_name, u.home_address,
              u.phone, u.is_active, u.created_at,
         COALESCE(json_agg(json_build_object(
           'id',ta.id,'grade_level',ta.grade_level,'section',ta.section,
           'subject',ta.subject,'school_year',ta.school_year
         )) FILTER (WHERE ta.id IS NOT NULL),'[]') AS assignments
       FROM users u
       LEFT JOIN teacher_assignments ta ON ta.teacher_id=u.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY u.id ORDER BY u.surname, u.first_name`,
      params
    )
    res.json({ teachers: result.rows })
  } catch (err) { next(err) }
})

// GET /api/accounts/teachers/:id
router.get('/teachers/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, email, surname, first_name, middle_name, full_name, phone, is_active, created_at
       FROM users WHERE id=$1 AND role='teacher'`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Teacher not found.', 404)
    const teacher = result.rows[0]
    teacher.assignments = await getAssignments(teacher.id)
    res.json({ teacher })
  } catch (err) { next(err) }
})

// POST /api/accounts/teachers
router.post('/teachers', async (req, res, next) => {
  try {
    const { error, value } = createSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { email, password, phone, assignments = [], ...nameFields } = value
    const { surname, first_name, middle_name } = normaliseName(nameFields)

    const existing = await query('SELECT id FROM users WHERE email=$1', [email])
    if (existing.rows.length) throw new AppError('Email already registered.', 409)

    const teacher = await withTransaction(async (client) => {
      const hash = await bcrypt.hash(password, await bcrypt.genSalt(12))

      const uRes = await client.query(
        `INSERT INTO users (email, password_hash, surname, first_name, middle_name, role, phone, home_address)
         VALUES ($1,$2,$3,$4,$5,'teacher',$6,$7)
         RETURNING id, email, surname, first_name, middle_name, full_name, phone, home_address, is_active, created_at`,
        [email, hash, surname, first_name, middle_name || null, phone || null, value.home_address || null]
      )
      const user = uRes.rows[0]

      for (const a of assignments) {
        await client.query(
          `INSERT INTO teacher_assignments (teacher_id, grade_level, section, subject)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [user.id, a.grade_level, a.section, a.subject]
        )
      }
      user.assignments = await getAssignments(user.id)
      return user
    })

    res.status(201).json({ message: 'Teacher account created.', teacher })
  } catch (err) { next(err) }
})

// PUT /api/accounts/teachers/:id
router.put('/teachers/:id', async (req, res, next) => {
  try {
    const { error, value } = updateSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { phone, password, is_active, assignments, ...nameFields } = value
    const normed = normaliseName(nameFields)

    const teacher = await withTransaction(async (client) => {
      const sets = []; const params = []

      if (normed.surname)               { params.push(normed.surname);     sets.push(`surname=$${params.length}`) }
      if (normed.first_name)            { params.push(normed.first_name);  sets.push(`first_name=$${params.length}`) }
      if (normed.middle_name !== undefined) { params.push(normed.middle_name || null); sets.push(`middle_name=$${params.length}`) }
      if (phone        !== undefined)   { params.push(phone);                    sets.push(`phone=$${params.length}`) }
      if (value.home_address !== undefined) { params.push(value.home_address||null); sets.push(`home_address=$${params.length}`) }
      if (is_active  !== undefined)     { params.push(is_active);  sets.push(`is_active=$${params.length}`) }
      if (password) {
        params.push(await bcrypt.hash(password, await bcrypt.genSalt(12)))
        sets.push(`password_hash=$${params.length}`)
      }

      if (sets.length) {
        sets.push('updated_at=NOW()')
        params.push(req.params.id)
        const r = await client.query(
          `UPDATE users SET ${sets.join(',')} WHERE id=$${params.length} AND role='teacher'
           RETURNING id`,
          params
        )
        if (!r.rows.length) throw new AppError('Teacher not found.', 404)
      }

      if (assignments !== undefined) {
        await client.query('DELETE FROM teacher_assignments WHERE teacher_id=$1', [req.params.id])
        for (const a of assignments) {
          await client.query(
            `INSERT INTO teacher_assignments (teacher_id, grade_level, section, subject)
             VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [req.params.id, a.grade_level, a.section, a.subject]
          )
        }
      }

      const updated = await client.query(
        `SELECT id, email, surname, first_name, middle_name, full_name, phone, is_active, created_at
         FROM users WHERE id=$1`,
        [req.params.id]
      )
      const teacher = updated.rows[0]
      teacher.assignments = await getAssignments(teacher.id)
      return teacher
    })

    res.json({ message: 'Teacher account updated.', teacher })
  } catch (err) { next(err) }
})

// DELETE /api/accounts/teachers/:id  (soft delete)
router.delete('/teachers/:id', async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) throw new AppError('Cannot delete your own account.', 400)
    const result = await query(
      `UPDATE users SET is_active=FALSE, updated_at=NOW()
       WHERE id=$1 AND role='teacher' RETURNING full_name`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Teacher not found.', 404)
    res.json({ message: `${result.rows[0].surname}, ${result.rows[0].first_name}'s account has been deactivated.` })
  } catch (err) { next(err) }
})

// DELETE /api/accounts/teachers/:id/permanent
router.delete('/teachers/:id/permanent', async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) throw new AppError('Cannot delete your own account.', 400)
    const result = await query(
      `DELETE FROM users WHERE id=$1 AND role='teacher' RETURNING full_name`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Teacher not found.', 404)
    res.json({ message: `${result.rows[0].surname}, ${result.rows[0].first_name} permanently deleted.` })
  } catch (err) { next(err) }
})

module.exports = router