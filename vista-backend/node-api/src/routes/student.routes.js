const express = require('express')
const router  = express.Router()
const QRCode  = require('qrcode')
const { v4: uuidv4 } = require('uuid')
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const { authenticate, authorize } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')

router.use(authenticate)

// ── Validation ───────────────────────────────────────────────
const studentSchema = Joi.object({
  lrn: Joi.string().length(12).pattern(/^\d+$/).required()
    .messages({ 'string.length': 'LRN must be exactly 12 digits', 'string.pattern.base': 'LRN must contain digits only' }),
  full_name:         Joi.string().min(2).required(),
  date_of_birth:     Joi.date().required(),
  gender:            Joi.string().valid('Male', 'Female', 'Other').required(),
  grade_level:       Joi.string().required(),
  section:           Joi.string().optional().allow(''),
  profile_photo_url: Joi.string().uri().optional().allow(''),
  guardians: Joi.array().items(Joi.object({
    full_name:            Joi.string().min(2).required(),
    relationship:         Joi.string().required(),
    email:                Joi.string().email().optional().allow(''),
    phone:                Joi.string().optional().allow(''),
    is_authorized_pickup: Joi.boolean().default(true),
    create_account:       Joi.boolean().default(false),
    password:             Joi.string().min(8).optional().allow(''),
  })).optional()
})

const updateStudentSchema = Joi.object({
  full_name:         Joi.string().min(2).optional(),
  date_of_birth:     Joi.date().optional(),
  gender:            Joi.string().valid('Male', 'Female', 'Other').optional(),
  grade_level:       Joi.string().optional(),
  section:           Joi.string().optional().allow(''),
  profile_photo_url: Joi.string().uri().optional().allow(''),
})

const guardianSchema = Joi.object({
  full_name:            Joi.string().min(2).required(),
  relationship:         Joi.string().required(),
  email:                Joi.string().email().optional().allow(''),
  phone:                Joi.string().optional().allow(''),
  is_authorized_pickup: Joi.boolean().default(true),
  create_account:       Joi.boolean().default(false),
  password:             Joi.string().min(8).optional().allow(''),
})

const updateGuardianSchema = Joi.object({
  full_name:            Joi.string().min(2).optional(),
  relationship:         Joi.string().optional(),
  email:                Joi.string().email().optional().allow(''),
  phone:                Joi.string().optional().allow(''),
  is_authorized_pickup: Joi.boolean().optional(),
})

// ── Helper: get student with guardians from parent_student ────
// Guardian info is now stored directly on parent_student — no user join needed
const getStudentWithGuardians = async (id) => {
  const result = await query(
    `SELECT s.*,
       COALESCE(
         json_agg(json_build_object(
           'id',                   ps.id,
           'full_name',            ps.full_name,
           'email',                ps.email,
           'phone',                ps.phone,
           'relationship',         ps.relationship,
           'is_authorized_pickup', ps.is_authorized_pickup,
           'has_account',          (ps.parent_id IS NOT NULL)
         ) ORDER BY ps.created_at ASC) FILTER (WHERE ps.id IS NOT NULL),
         '[]'
       ) AS guardians
     FROM students s
     LEFT JOIN parent_student ps ON ps.student_id = s.id
     WHERE s.id = $1 AND s.is_active = TRUE
     GROUP BY s.id`,
    [id]
  )
  return result.rows[0] || null
}

// ── Helper: insert guardian row ───────────────────────────────
const insertGuardian = async (client, studentId, g) => {
  let parentId = null

  // Optionally create/link a user account
  if (g.create_account && g.email && g.password) {
    const bcrypt = require('bcryptjs')
    const hash   = await bcrypt.hash(g.password, await bcrypt.genSalt(12))
    const exist  = await client.query('SELECT id FROM users WHERE email=$1', [g.email])
    parentId = exist.rows.length
      ? exist.rows[0].id
      : (await client.query(
          `INSERT INTO users (email, password_hash, full_name, role, phone)
           VALUES ($1,$2,$3,'parent',$4) RETURNING id`,
          [g.email, hash, g.full_name, g.phone || null]
        )).rows[0].id
  } else if (g.email) {
    // Link existing parent account if email matches a parent user — optional
    const found = await client.query(
      'SELECT id FROM users WHERE email=$1 AND role=$2', [g.email, 'parent']
    )
    if (found.rows.length) parentId = found.rows[0].id
  }

  await client.query(
    `INSERT INTO parent_student
       (parent_id, student_id, full_name, email, phone, relationship, is_authorized_pickup)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [parentId, studentId, g.full_name, g.email || null,
     g.phone || null, g.relationship, g.is_authorized_pickup ?? true]
  )
}

// ── GET /api/students ────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { grade_level, section, search, page = 1, limit = 20 } = req.query
    const offset = (page - 1) * limit
    const conditions = ['s.is_active = TRUE']
    const params = []

    if (grade_level) { params.push(grade_level); conditions.push(`s.grade_level = $${params.length}`) }
    if (section)     { params.push(section);      conditions.push(`s.section = $${params.length}`) }
    if (search) {
      params.push(`%${search}%`)
      conditions.push(`(s.full_name ILIKE $${params.length} OR s.lrn ILIKE $${params.length})`)
    }
    if (req.user.role === 'parent') {
      params.push(req.user.id)
      conditions.push(`ps.parent_id = $${params.length}`)
    }

    const join  = req.user.role === 'parent' ? 'INNER JOIN parent_student ps ON ps.student_id = s.id' : ''
    const where = `WHERE ${conditions.join(' AND ')}`
    params.push(limit, offset)

    const [rows, count] = await Promise.all([
      query(
        `SELECT s.id, s.lrn, s.full_name, s.date_of_birth, s.gender,
                s.grade_level, s.section, s.profile_photo_url, s.created_at
         FROM students s ${join} ${where}
         ORDER BY s.grade_level, s.full_name
         LIMIT $${params.length-1} OFFSET $${params.length}`, params),
      query(`SELECT COUNT(*) FROM students s ${join} ${where}`, params.slice(0,-2))
    ])

    res.json({
      students: rows.rows,
      pagination: {
        total:      parseInt(count.rows[0].count),
        page:       parseInt(page),
        limit:      parseInt(limit),
        totalPages: Math.ceil(count.rows[0].count / limit)
      }
    })
  } catch (err) { next(err) }
})

// ── GET /api/students/:id ────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const student = await getStudentWithGuardians(req.params.id)
    if (!student) throw new AppError('Student not found.', 404)
    res.json({ student })
  } catch (err) { next(err) }
})

// ── POST /api/students ── admin only ─────────────────────────
router.post('/', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = studentSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)
    const { guardians = [], ...data } = value

    const dup = await query('SELECT id FROM students WHERE lrn = $1', [data.lrn])
    if (dup.rows.length) throw new AppError('A student with this LRN already exists.', 409)

    const student = await withTransaction(async (client) => {
      const sRes = await client.query(
        `INSERT INTO students (lrn, full_name, date_of_birth, gender, grade_level, section, profile_photo_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [data.lrn, data.full_name, data.date_of_birth, data.gender,
         data.grade_level, data.section || null, data.profile_photo_url || null]
      )
      for (const g of guardians) await insertGuardian(client, sRes.rows[0].id, g)
      return await getStudentWithGuardians(sRes.rows[0].id)
    })

    res.status(201).json({ message: 'Student added successfully.', student })
  } catch (err) { next(err) }
})

// ── PUT /api/students/:id ── admin only ──────────────────────
router.put('/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = updateStudentSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const sets=[]; const params=[]
    for (const f of ['full_name','date_of_birth','gender','grade_level','section','profile_photo_url']) {
      if (value[f] !== undefined) { params.push(value[f]); sets.push(`${f}=$${params.length}`) }
    }
    if (!sets.length) throw new AppError('No fields to update.', 400)
    sets.push('updated_at=NOW()')
    params.push(req.params.id)

    const r = await query(
      `UPDATE students SET ${sets.join(',')} WHERE id=$${params.length} AND is_active=TRUE RETURNING id`, params
    )
    if (!r.rows.length) throw new AppError('Student not found.', 404)
    res.json({ message: 'Student updated.', student: await getStudentWithGuardians(req.params.id) })
  } catch (err) { next(err) }
})

// ── DELETE /api/students/:id ── admin only ───────────────────
router.delete('/:id', authorize('admin'), async (req, res, next) => {
  try {
    const r = await query(
      'UPDATE students SET is_active=FALSE, updated_at=NOW() WHERE id=$1 RETURNING full_name', [req.params.id]
    )
    if (!r.rows.length) throw new AppError('Student not found.', 404)
    res.json({ message: `${r.rows[0].full_name} removed successfully.` })
  } catch (err) { next(err) }
})

// ── POST /api/students/:id/guardians ─────────────────────────
router.post('/:id/guardians', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = guardianSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    await withTransaction(async (client) => {
      await insertGuardian(client, req.params.id, value)
    })

    res.json({ message: 'Guardian added.', student: await getStudentWithGuardians(req.params.id) })
  } catch (err) { next(err) }
})

// ── PUT /api/students/:id/guardians/:guardianId ───────────────
// guardianId here is parent_student.id (not user id)
router.put('/:id/guardians/:guardianId', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = updateGuardianSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const sets=[]; const params=[]
    for (const f of ['full_name','email','phone','relationship','is_authorized_pickup']) {
      if (value[f] !== undefined) { params.push(value[f]); sets.push(`${f}=$${params.length}`) }
    }
    if (!sets.length) throw new AppError('No fields to update.', 400)

    sets.push('updated_at=NOW()')
    params.push(req.params.guardianId, req.params.id)

    const r = await query(
      `UPDATE parent_student SET ${sets.join(',')}
       WHERE id=$${params.length-1} AND student_id=$${params.length}
       RETURNING id`,
      params
    )
    if (!r.rows.length) throw new AppError('Guardian not found.', 404)

    res.json({ message: 'Guardian updated.', student: await getStudentWithGuardians(req.params.id) })
  } catch (err) { next(err) }
})

// ── DELETE /api/students/:id/guardians/:guardianId ────────────
router.delete('/:id/guardians/:guardianId', authorize('admin'), async (req, res, next) => {
  try {
    await query(
      'DELETE FROM parent_student WHERE id=$1 AND student_id=$2',
      [req.params.guardianId, req.params.id]
    )
    res.json({ message: 'Guardian removed.' })
  } catch (err) { next(err) }
})

// ── POST /api/students/:id/generate-qr ──────────────────────
router.post('/:id/generate-qr', authorize('admin','teacher'), async (req, res, next) => {
  try {
    const { expiresInMinutes = 30 } = req.body
    const token     = uuidv4()
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60000)
    const qrImage   = await QRCode.toDataURL(
      JSON.stringify({ studentId: req.params.id, token, expiresAt, type: 'VISTA_SECUREPASS' }),
      { errorCorrectionLevel: 'H', width: 300, margin: 2 }
    )
    await query('UPDATE students SET qr_code=$1, qr_expires_at=$2 WHERE id=$3', [token, expiresAt, req.params.id])
    res.json({ message: 'QR code generated.', qrImage, token, expiresAt })
  } catch (err) { next(err) }
})

module.exports = router
