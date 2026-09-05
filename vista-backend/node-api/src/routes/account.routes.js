const express = require('express')
const router  = express.Router()
const bcrypt  = require('bcryptjs')
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const {
  authenticate,
  authorizeAnyAdmin,
  authorizeSuperAdmin,
} = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { normaliseName } = require('../utils/nameHelper')
const {
  ROLES,
  gradeScopeForRole,
  canManageGrade,
  isSuperAdmin,
} = require('../utils/roles')
// Advisories are read-only here. `sections.adviser_id` is written on the
// Curriculum page's Sections tab and nowhere else — one rule, one write surface.
const { advisorySections, advisoryHistory } = require('../utils/advisory')

router.use(authenticate, authorizeAnyAdmin)

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
  assignments: Joi.array().items(assignmentShape).optional(),
})

const updateSchema = Joi.object({
  surname:     Joi.string().min(1).optional(),
  first_name:  Joi.string().min(1).optional(),
  middle_name: Joi.string().optional().allow(''),
  phone:       Joi.string().optional().allow(''),
  password:    Joi.string().min(8).optional().allow(''),
  is_active:   Joi.boolean().optional(),
  assignments: Joi.array().items(assignmentShape).optional(),
})

// Admin-accounts CRUD (super_admin only) uses a separate create shape.
const adminCreateSchema = Joi.object({
  email:       Joi.string().email().required(),
  password:    Joi.string().min(8).required(),
  surname:     Joi.string().min(1).required(),
  first_name:  Joi.string().min(1).required(),
  middle_name: Joi.string().optional().allow(''),
  phone:       Joi.string().allow('', null).optional(),
  role:        Joi.string().valid(ROLES.ADMIN_ECE, ROLES.ADMIN_ELEM).required(),
})

const adminUpdateSchema = Joi.object({
  surname:     Joi.string().min(1).optional(),
  first_name:  Joi.string().min(1).optional(),
  middle_name: Joi.string().optional().allow(''),
  phone:       Joi.string().allow('', null).optional(),
  password:    Joi.string().min(8).optional().allow(''),
  is_active:   Joi.boolean().optional(),
  role:        Joi.string().valid(ROLES.ADMIN_ECE, ROLES.ADMIN_ELEM).optional(),
})

const getActiveSYLabel = async () => {
  const res = await query('SELECT label FROM school_years WHERE is_active=TRUE LIMIT 1')
  if (!res.rows.length) throw new AppError('No active school year set.', 400)
  return res.rows[0].label
}

const getAssignments = async (teacher_id, schoolYear) => {
  const syLabel = schoolYear || await getActiveSYLabel()
  const res = await query(
    `SELECT id, grade_level, section, subject, school_year
     FROM teacher_assignments WHERE teacher_id=$1 AND school_year=$2
     ORDER BY grade_level, section, subject`,
    [teacher_id, syLabel]
  )
  return res.rows
}

const assertAssignmentsInScope = (req, assignments = []) => {
  for (const a of assignments) {
    if (!a.grade_level) continue
    if (!canManageGrade(req.user.role, a.grade_level)) {
      throw new AppError(`Assignment grade '${a.grade_level}' is outside your scope.`, 403)
    }
  }
}

// GET /api/accounts/assignments — All taken teacher assignments for the active SY
router.get('/assignments', async (req, res, next) => {
  try {
    const syLabel = await getActiveSYLabel()
    const scope = gradeScopeForRole(req.user.role)
    const params = [syLabel, scope]
    const result = await query(
      `SELECT ta.grade_level, ta.section, ta.subject, ta.teacher_id, u.full_name as teacher_name
       FROM teacher_assignments ta
       JOIN users u ON u.id = ta.teacher_id
       WHERE ta.school_year=$1 AND ta.grade_level = ANY($2::text[])
       ORDER BY ta.grade_level, ta.section, ta.subject`,
      params
    )
    res.json({ assignments: result.rows })
  } catch (err) { next(err) }
})

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

    const syLabel = await getActiveSYLabel()
    params.push(syLabel)
    const syIdx = params.length

    const result = await query(
      `SELECT u.id, u.email, u.surname, u.first_name, u.middle_name, u.full_name,
              u.phone, u.is_active, u.created_at,
         COALESCE(json_agg(json_build_object(
           'id',ta.id,'grade_level',ta.grade_level,'section',ta.section,
           'subject',ta.subject,'school_year',ta.school_year
         )) FILTER (WHERE ta.id IS NOT NULL),'[]') AS assignments,
         -- The advisory alongside the assignments: a teacher_assignments row
         -- says which subject they teach, sections.adviser_id says which class
         -- they are responsible for, and a teacher can have either without the
         -- other. A correlated subquery rather than a second LEFT JOIN so it
         -- cannot multiply the assignment rows being aggregated above.
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id', sec.id, 'grade_level', sec.grade_level,
                    'section', sec.name, 'school_year', asy.label
                  ) ORDER BY sec.grade_level, sec.name)
             FROM sections sec
             JOIN school_years asy ON asy.id = sec.school_year_id
            WHERE sec.adviser_id = u.id AND sec.is_active = TRUE AND asy.is_active = TRUE
         ), '[]') AS advisory
       FROM users u
       LEFT JOIN teacher_assignments ta ON ta.teacher_id=u.id AND ta.school_year=$${syIdx}
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
    // Active-year advisory, matching the scope `getAssignments()` uses. Purely
    // informational here — the adviser is set on the Curriculum page's Sections
    // tab, and this endpoint's PUT does not write it.
    teacher.advisory = await advisorySections(teacher.id)
    res.json({ teacher })
  } catch (err) { next(err) }
})

// GET /api/accounts/teachers/:id/assignment-history — All assignments across school years
//
// `advisory` rides alongside, across every year rather than just the active one:
// this is the record of what a teacher has held, and a year they advised a class
// belongs in it as much as a year they taught a subject. The two are independent
// — a teacher can advise a class they teach nothing in, and vice versa — so the
// client has to union the years, not assume advisory is a subset.
router.get('/teachers/:id/assignment-history', async (req, res, next) => {
  try {
    const [result, advisory] = await Promise.all([
      query(
        `SELECT id, grade_level, section, subject, school_year
         FROM teacher_assignments WHERE teacher_id=$1
         ORDER BY school_year DESC, grade_level, section, subject`,
        [req.params.id]
      ),
      advisoryHistory(req.params.id),
    ])
    res.json({ assignments: result.rows, advisory })
  } catch (err) { next(err) }
})

// POST /api/accounts/teachers
router.post('/teachers', async (req, res, next) => {
  try {
    const { error, value } = createSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { email, password, phone, assignments = [], ...nameFields } = value
    const { surname, first_name, middle_name } = normaliseName(nameFields)

    assertAssignmentsInScope(req, assignments)

    const existing = await query('SELECT id FROM users WHERE email=$1', [email])
    if (existing.rows.length) throw new AppError('Email already registered.', 409)

    // Check for conflicts before creating (scoped to active SY)
    const syLabel = await getActiveSYLabel()
    for (const a of assignments) {
      if (!a.grade_level || !a.section || !a.subject) continue
      const conflict = await query(
        `SELECT u.full_name FROM teacher_assignments ta JOIN users u ON u.id = ta.teacher_id
         WHERE ta.grade_level=$1 AND ta.section=$2 AND ta.subject=$3 AND ta.school_year=$4`,
        [a.grade_level, a.section, a.subject, syLabel]
      )
      if (conflict.rows.length) {
        throw new AppError(`${a.grade_level} — ${a.section} — ${a.subject} is already assigned to ${conflict.rows[0].full_name}.`, 409)
      }
    }

    const teacher = await withTransaction(async (client) => {
      const hash = await bcrypt.hash(password, await bcrypt.genSalt(12))

      const uRes = await client.query(
        `INSERT INTO users (email, password_hash, surname, first_name, middle_name, role, phone)
         VALUES ($1,$2,$3,$4,$5,'teacher',$6)
         RETURNING id, email, surname, first_name, middle_name, full_name, phone, is_active, created_at`,
        [email, hash, surname, first_name, middle_name || null, phone || null]
      )
      const user = uRes.rows[0]

      for (const a of assignments) {
        await client.query(
          `INSERT INTO teacher_assignments (teacher_id, grade_level, section, subject, school_year)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [user.id, a.grade_level, a.section, a.subject, syLabel]
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

    if (assignments !== undefined) assertAssignmentsInScope(req, assignments)

    const teacher = await withTransaction(async (client) => {
      const sets = []; const params = []

      if (normed.surname)               { params.push(normed.surname);     sets.push(`surname=$${params.length}`) }
      if (normed.first_name)            { params.push(normed.first_name);  sets.push(`first_name=$${params.length}`) }
      if (normed.middle_name !== undefined) { params.push(normed.middle_name || null); sets.push(`middle_name=$${params.length}`) }
      if (phone        !== undefined)   { params.push(phone);                    sets.push(`phone=$${params.length}`) }
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
        const syLabel = await getActiveSYLabel()
        // Check for conflicts with other teachers (scoped to active SY)
        for (const a of assignments) {
          if (!a.grade_level || !a.section || !a.subject) continue
          const conflict = await client.query(
            `SELECT u.full_name FROM teacher_assignments ta JOIN users u ON u.id = ta.teacher_id
             WHERE ta.grade_level=$1 AND ta.section=$2 AND ta.subject=$3 AND ta.school_year=$4 AND ta.teacher_id != $5`,
            [a.grade_level, a.section, a.subject, syLabel, req.params.id]
          )
          if (conflict.rows.length) {
            throw new AppError(`${a.grade_level} — ${a.section} — ${a.subject} is already assigned to ${conflict.rows[0].full_name}.`, 409)
          }
        }
        // Only delete assignments for the active SY (preserve historical).
        // For scoped admins: only delete/recreate rows within their scope so
        // out-of-scope historical assignments in the active SY are preserved.
        if (isSuperAdmin(req.user.role)) {
          await client.query('DELETE FROM teacher_assignments WHERE teacher_id=$1 AND school_year=$2', [req.params.id, syLabel])
        } else {
          const scope = gradeScopeForRole(req.user.role)
          await client.query(
            `DELETE FROM teacher_assignments
              WHERE teacher_id=$1 AND school_year=$2 AND grade_level = ANY($3::text[])`,
            [req.params.id, syLabel, scope]
          )
        }
        for (const a of assignments) {
          await client.query(
            `INSERT INTO teacher_assignments (teacher_id, grade_level, section, subject, school_year)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
            [req.params.id, a.grade_level, a.section, a.subject, syLabel]
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
       WHERE id=$1 AND role='teacher' RETURNING full_name, surname, first_name`,
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
      `DELETE FROM users WHERE id=$1 AND role='teacher' RETURNING full_name, surname, first_name`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Teacher not found.', 404)
    res.json({ message: `${result.rows[0].surname}, ${result.rows[0].first_name} permanently deleted.` })
  } catch (err) { next(err) }
})

// ─── Admin account management (super_admin only) ──────────────────────────

const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN_ECE, ROLES.ADMIN_ELEM]

// GET /api/accounts/admins — list admin-tier accounts
router.get('/admins', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { search, is_active } = req.query
    const conditions = ['u.role = ANY($1::text[])']
    const params = [ADMIN_ROLES]

    if (search) {
      params.push(`%${search}%`)
      conditions.push(`(u.surname ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`)
    }
    if (is_active !== undefined) {
      params.push(is_active === 'true')
      conditions.push(`u.is_active=$${params.length}`)
    }

    const result = await query(
      `SELECT id, email, surname, first_name, middle_name, full_name, role, phone, is_active, created_at
         FROM users u
        WHERE ${conditions.join(' AND ')}
        ORDER BY role, surname, first_name`,
      params
    )
    res.json({ admins: result.rows })
  } catch (err) { next(err) }
})

// GET /api/accounts/admins/:id
router.get('/admins/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, email, surname, first_name, middle_name, full_name, role, phone, is_active, created_at
         FROM users WHERE id=$1 AND role = ANY($2::text[])`,
      [req.params.id, ADMIN_ROLES]
    )
    if (!result.rows.length) throw new AppError('Admin not found.', 404)
    res.json({ admin: result.rows[0] })
  } catch (err) { next(err) }
})

// POST /api/accounts/admins — create admin_ece or admin_elem (never super_admin via UI)
router.post('/admins', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = adminCreateSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { email, password, phone, role, ...nameFields } = value
    const { surname, first_name, middle_name } = normaliseName(nameFields)

    const existing = await query('SELECT id FROM users WHERE email=$1', [email])
    if (existing.rows.length) throw new AppError('Email already registered.', 409)

    const hash = await bcrypt.hash(password, await bcrypt.genSalt(12))
    const result = await query(
      `INSERT INTO users (email, password_hash, surname, first_name, middle_name, role, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, email, surname, first_name, middle_name, full_name, role, phone, is_active, created_at`,
      [email, hash, surname, first_name, middle_name || null, role, phone || null]
    )
    res.status(201).json({ message: 'Admin account created.', admin: result.rows[0] })
  } catch (err) { next(err) }
})

// PUT /api/accounts/admins/:id
router.put('/admins/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = adminUpdateSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    // Safety: never allow editing a super_admin's role (block self-demotion and
    // prevent promoting a scoped admin to super_admin via this endpoint).
    const current = await query('SELECT role FROM users WHERE id=$1', [req.params.id])
    if (!current.rows.length) throw new AppError('Admin not found.', 404)
    if (current.rows[0].role === ROLES.SUPER_ADMIN && value.role && value.role !== ROLES.SUPER_ADMIN) {
      throw new AppError('Cannot change a super_admin\u2019s role.', 400)
    }

    const { phone, password, is_active, role, ...nameFields } = value
    const normed = normaliseName(nameFields)

    const sets = []; const params = []
    if (normed.surname)                    { params.push(normed.surname);                sets.push(`surname=$${params.length}`) }
    if (normed.first_name)                 { params.push(normed.first_name);             sets.push(`first_name=$${params.length}`) }
    if (normed.middle_name !== undefined)  { params.push(normed.middle_name || null);    sets.push(`middle_name=$${params.length}`) }
    if (phone      !== undefined)          { params.push(phone || null);                 sets.push(`phone=$${params.length}`) }
    if (is_active  !== undefined)          { params.push(is_active);                     sets.push(`is_active=$${params.length}`) }
    if (role       !== undefined && current.rows[0].role !== ROLES.SUPER_ADMIN) {
      params.push(role); sets.push(`role=$${params.length}`)
    }
    if (password) {
      params.push(await bcrypt.hash(password, await bcrypt.genSalt(12)))
      sets.push(`password_hash=$${params.length}`)
    }

    if (!sets.length) {
      const row = await query(
        `SELECT id, email, surname, first_name, middle_name, full_name, role, phone, is_active, created_at
           FROM users WHERE id=$1`, [req.params.id])
      return res.json({ message: 'No changes.', admin: row.rows[0] })
    }

    sets.push('updated_at=NOW()')
    params.push(req.params.id)
    const updated = await query(
      `UPDATE users SET ${sets.join(',')}
        WHERE id=$${params.length} AND role = ANY($${params.length + 1}::text[])
        RETURNING id, email, surname, first_name, middle_name, full_name, role, phone, is_active, created_at`,
      [...params, ADMIN_ROLES]
    )
    if (!updated.rows.length) throw new AppError('Admin not found.', 404)
    res.json({ message: 'Admin account updated.', admin: updated.rows[0] })
  } catch (err) { next(err) }
})

// DELETE /api/accounts/admins/:id (soft delete)
router.delete('/admins/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) throw new AppError('Cannot delete your own account.', 400)
    const result = await query(
      `UPDATE users SET is_active=FALSE, updated_at=NOW()
        WHERE id=$1 AND role IN ('${ROLES.ADMIN_ECE}','${ROLES.ADMIN_ELEM}')
        RETURNING full_name, surname, first_name`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Admin not found or cannot be deleted.', 404)
    res.json({ message: `${result.rows[0].surname}, ${result.rows[0].first_name}'s admin account has been deactivated.` })
  } catch (err) { next(err) }
})

// ─── Security guard account management (super_admin only) ────────────────
// Used by vista_guard gate personnel. No teacher_assignments — school-wide read.

const guardCreateSchema = Joi.object({
  email:       Joi.string().email().required(),
  password:    Joi.string().min(8).required(),
  surname:     Joi.string().min(1).required(),
  first_name:  Joi.string().min(1).required(),
  middle_name: Joi.string().optional().allow(''),
  phone:       Joi.string().allow('', null).optional(),
})

const guardUpdateSchema = Joi.object({
  surname:     Joi.string().min(1).optional(),
  first_name:  Joi.string().min(1).optional(),
  middle_name: Joi.string().optional().allow(''),
  phone:       Joi.string().allow('', null).optional(),
  password:    Joi.string().min(8).optional().allow(''),
  is_active:   Joi.boolean().optional(),
})

// GET /api/accounts/guards
router.get('/guards', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { search, is_active } = req.query
    const conditions = [`u.role = '${ROLES.SECURITY_GUARD}'`]
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
      `SELECT id, email, surname, first_name, middle_name, full_name, role, phone, is_active, created_at
         FROM users u
        WHERE ${conditions.join(' AND ')}
        ORDER BY surname, first_name`,
      params
    )
    res.json({ guards: result.rows })
  } catch (err) { next(err) }
})

// GET /api/accounts/guards/:id
router.get('/guards/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, email, surname, first_name, middle_name, full_name, role, phone, is_active, created_at
         FROM users WHERE id=$1 AND role=$2`,
      [req.params.id, ROLES.SECURITY_GUARD]
    )
    if (!result.rows.length) throw new AppError('Guard not found.', 404)
    res.json({ guard: result.rows[0] })
  } catch (err) { next(err) }
})

// POST /api/accounts/guards
router.post('/guards', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = guardCreateSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { email, password, phone, ...nameFields } = value
    const { surname, first_name, middle_name } = normaliseName(nameFields)

    const existing = await query('SELECT id FROM users WHERE email=$1', [email])
    if (existing.rows.length) throw new AppError('Email already registered.', 409)

    const hash = await bcrypt.hash(password, await bcrypt.genSalt(12))
    const result = await query(
      `INSERT INTO users (email, password_hash, surname, first_name, middle_name, role, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, email, surname, first_name, middle_name, full_name, role, phone, is_active, created_at`,
      [email, hash, surname, first_name, middle_name || null, ROLES.SECURITY_GUARD, phone || null]
    )
    res.status(201).json({ message: 'Guard account created.', guard: result.rows[0] })
  } catch (err) { next(err) }
})

// PUT /api/accounts/guards/:id
router.put('/guards/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = guardUpdateSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { phone, password, is_active, ...nameFields } = value
    const normed = normaliseName(nameFields)

    const sets = []; const params = []
    if (normed.surname)                   { params.push(normed.surname);            sets.push(`surname=$${params.length}`) }
    if (normed.first_name)                { params.push(normed.first_name);         sets.push(`first_name=$${params.length}`) }
    if (normed.middle_name !== undefined) { params.push(normed.middle_name || null); sets.push(`middle_name=$${params.length}`) }
    if (phone     !== undefined)          { params.push(phone || null);             sets.push(`phone=$${params.length}`) }
    if (is_active !== undefined)          { params.push(is_active);                 sets.push(`is_active=$${params.length}`) }
    if (password) {
      params.push(await bcrypt.hash(password, await bcrypt.genSalt(12)))
      sets.push(`password_hash=$${params.length}`)
    }

    if (!sets.length) {
      const row = await query(
        `SELECT id, email, surname, first_name, middle_name, full_name, role, phone, is_active, created_at
           FROM users WHERE id=$1`, [req.params.id])
      return res.json({ message: 'No changes.', guard: row.rows[0] })
    }

    sets.push('updated_at=NOW()')
    params.push(req.params.id)
    const updated = await query(
      `UPDATE users SET ${sets.join(',')}
        WHERE id=$${params.length} AND role=$${params.length + 1}
        RETURNING id, email, surname, first_name, middle_name, full_name, role, phone, is_active, created_at`,
      [...params, ROLES.SECURITY_GUARD]
    )
    if (!updated.rows.length) throw new AppError('Guard not found.', 404)
    res.json({ message: 'Guard account updated.', guard: updated.rows[0] })
  } catch (err) { next(err) }
})

// DELETE /api/accounts/guards/:id (soft delete)
router.delete('/guards/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) throw new AppError('Cannot delete your own account.', 400)
    const result = await query(
      `UPDATE users SET is_active=FALSE, updated_at=NOW()
        WHERE id=$1 AND role=$2
        RETURNING surname, first_name`,
      [req.params.id, ROLES.SECURITY_GUARD]
    )
    if (!result.rows.length) throw new AppError('Guard not found.', 404)
    res.json({ message: `${result.rows[0].surname}, ${result.rows[0].first_name}'s guard account has been deactivated.` })
  } catch (err) { next(err) }
})

module.exports = router
