const express = require('express')
const router  = express.Router()
const QRCode  = require('qrcode')
const { v4: uuidv4 } = require('uuid')
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const { authenticate, authorize } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { normaliseName } = require('../utils/nameHelper')

router.use(authenticate)

const guardianNameShape = {
  surname:     Joi.string().min(1).required(),
  first_name:  Joi.string().min(1).required(),
  middle_name: Joi.string().optional().allow(''),
}

const studentSchema = Joi.object({
  lrn:               Joi.string().length(12).pattern(/^\d+$/).required()
    .messages({ 'string.length': 'LRN must be exactly 12 digits', 'string.pattern.base': 'LRN must contain digits only' }),
  surname:           Joi.string().min(1).required(),
  first_name:        Joi.string().min(1).required(),
  middle_name:       Joi.string().optional().allow(''),
  date_of_birth:     Joi.date().required(),
  gender:            Joi.string().valid('Male','Female','Other').required(),
  grade_level:       Joi.string().required(),
  section:           Joi.string().optional().allow(''),
  profile_photo_url: Joi.string().uri().optional().allow(''),
  home_address:      Joi.string().trim().min(1).required(),
  guardians: Joi.array().items(Joi.object({
    ...guardianNameShape,
    relationship:         Joi.string().required(),
    email:                Joi.string().email().optional().allow(''),
    phone:                Joi.string().optional().allow(''),
    is_authorized_pickup:  Joi.boolean().default(true),
    is_emergency_contact:  Joi.boolean().default(false),
    create_account:        Joi.boolean().default(false),
    password:              Joi.string().min(8).optional().allow(''),
    home_address:          Joi.string().trim().optional().allow(''),
    link_parent_id:        Joi.string().uuid().optional().allow(null),
  })).optional()
})

const updateStudentSchema = Joi.object({
  lrn:               Joi.string().length(12).pattern(/^\d+$/).optional()
    .messages({ 'string.length': 'LRN must be exactly 12 digits', 'string.pattern.base': 'LRN must contain digits only' }),
  surname:           Joi.string().min(1).optional(),
  first_name:        Joi.string().min(1).optional(),
  middle_name:       Joi.string().optional().allow(''),
  date_of_birth:     Joi.date().optional(),
  gender:            Joi.string().valid('Male','Female','Other').optional(),
  grade_level:       Joi.string().optional(),
  section:           Joi.string().optional().allow(''),
  profile_photo_url: Joi.string().uri().optional().allow(''),
  home_address:      Joi.string().optional().allow(''),
})

const guardianSchema = Joi.object({
  ...guardianNameShape,
  relationship:         Joi.string().required(),
  email:                Joi.string().email().optional().allow(''),
  phone:                Joi.string().optional().allow(''),
  is_authorized_pickup:  Joi.boolean().default(true),
  is_emergency_contact:  Joi.boolean().default(false),
  create_account:        Joi.boolean().default(false),
  password:              Joi.string().min(8).optional().allow(''),
  home_address:          Joi.string().trim().min(1).required(),
})

const updateGuardianSchema = Joi.object({
  surname:               Joi.string().min(1).optional(),
  first_name:            Joi.string().min(1).optional(),
  middle_name:           Joi.string().optional().allow(''),
  relationship:          Joi.string().optional(),
  email:                 Joi.string().email().optional().allow(''),
  phone:                 Joi.string().optional().allow(''),
  is_authorized_pickup:  Joi.boolean().optional(),
  is_emergency_contact:  Joi.boolean().optional(),
  home_address:          Joi.string().optional().allow(''),
})

// ── Helper: get student with guardians ───────────────────────
const getStudentWithGuardians = async (id) => {
  const result = await query(
    `SELECT s.*,
       COALESCE(json_agg(json_build_object(
         'id',                   ps.id,
         'surname',              ps.surname,
         'first_name',           ps.first_name,
         'middle_name',          ps.middle_name,
         'full_name',            ps.full_name,
         'email',                ps.email,
         'phone',                ps.phone,
         'relationship',         ps.relationship,
         'is_authorized_pickup', ps.is_authorized_pickup,
         'is_emergency_contact', ps.is_emergency_contact,
         'has_account',          (ps.parent_id IS NOT NULL),
         'home_address',         ps.home_address
       ) ORDER BY ps.is_emergency_contact DESC, ps.created_at ASC) FILTER (WHERE ps.id IS NOT NULL), '[]') AS guardians
     FROM students s
     LEFT JOIN parent_student ps ON ps.student_id=s.id
     WHERE s.id=$1 AND s.is_active=TRUE
     GROUP BY s.id`,
    [id]
  )
  return result.rows[0] || null
}

// ── Helper: insert guardian row ───────────────────────────────
const insertGuardian = async (client, studentId, g) => {
  const { surname, first_name, middle_name } = normaliseName(g)
  let parentId = null

  // Priority 1: link to existing parent account directly
  if (g.link_parent_id) {
    parentId = g.link_parent_id
    // Pull contact info from the existing user account
    const existing = await client.query(
      'SELECT surname, first_name, middle_name, email, phone FROM users WHERE id=$1',
      [g.link_parent_id]
    )
    if (existing.rows.length) {
      const u = existing.rows[0]
      await client.query(
        `INSERT INTO parent_student
           (parent_id, student_id, surname, first_name, middle_name, email, phone, relationship, is_authorized_pickup, is_emergency_contact, home_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING`,
        [parentId, studentId, u.surname, u.first_name, u.middle_name,
         u.email, u.phone, g.relationship,
         g.is_authorized_pickup ?? true, g.is_emergency_contact ?? false, g.home_address || null]
      )
      return
    }
  }

  if (g.create_account && g.email && g.password) {
    const bcrypt = require('bcryptjs')
    const hash   = await bcrypt.hash(g.password, await bcrypt.genSalt(12))
    const exist  = await client.query('SELECT id FROM users WHERE email=$1', [g.email])
    parentId = exist.rows.length
      ? exist.rows[0].id
      : (await client.query(
          `INSERT INTO users (email, password_hash, surname, first_name, middle_name, role, phone)
           VALUES ($1,$2,$3,$4,$5,'parent',$6) RETURNING id`,
          [g.email, hash, surname, first_name, middle_name || null, g.phone || null]
        )).rows[0].id
  } else if (g.email) {
    const found = await client.query('SELECT id FROM users WHERE email=$1 AND role=$2', [g.email,'parent'])
    if (found.rows.length) parentId = found.rows[0].id
  }

  await client.query(
    `INSERT INTO parent_student
       (parent_id, student_id, surname, first_name, middle_name, email, phone, relationship, is_authorized_pickup, is_emergency_contact, home_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [parentId, studentId, surname, first_name, middle_name || null,
     g.email || null, g.phone || null, g.relationship,
     g.is_authorized_pickup ?? true, g.is_emergency_contact ?? false, g.home_address || null]
  )
}

// GET /api/students/parents/search?q=juan — search existing parent accounts
router.get('/parents/search', authorize('admin'), async (req, res, next) => {
  try {
    const { q = '' } = req.query
    if (!q.trim()) return res.json({ parents: [] })

    const result = await query(
      `SELECT u.id, u.surname, u.first_name, u.middle_name, u.full_name,
              u.email, u.phone,
              MAX(ps.home_address) AS home_address,
              COUNT(ps.student_id) AS linked_students
       FROM users u
       LEFT JOIN parent_student ps ON ps.parent_id = u.id
       WHERE u.role = 'parent'
         AND (u.full_name ILIKE $1 OR u.email ILIKE $1 OR u.surname ILIKE $1 OR u.first_name ILIKE $1)
       GROUP BY u.id
       ORDER BY u.surname, u.first_name
       LIMIT 10`,
      [`%${q.trim()}%`]
    )
    res.json({ parents: result.rows })
  } catch (err) { next(err) }
})

// GET /api/students
router.get('/', async (req, res, next) => {
  try {
    const { grade_level, section, search, page=1, limit=20 } = req.query
    const offset = (page-1)*limit
    const conditions = ['s.is_active=TRUE']
    const params = []

    if (grade_level) { params.push(grade_level); conditions.push(`s.grade_level=$${params.length}`) }
    if (section)     { params.push(section);      conditions.push(`s.section=$${params.length}`) }
    if (search) {
      params.push(`%${search}%`)
      conditions.push(`(s.surname ILIKE $${params.length} OR s.first_name ILIKE $${params.length} OR s.full_name ILIKE $${params.length} OR s.lrn ILIKE $${params.length})`)
    }
    if (req.user.role === 'parent') {
      params.push(req.user.id)
      conditions.push(`ps.parent_id=$${params.length}`)
    }

    const join  = req.user.role === 'parent' ? 'INNER JOIN parent_student ps ON ps.student_id=s.id' : ''
    const where = `WHERE ${conditions.join(' AND ')}`
    params.push(limit, offset)

    const [rows, count] = await Promise.all([
      query(
        `SELECT s.id, s.lrn, s.surname, s.first_name, s.middle_name, s.full_name,
                s.date_of_birth, s.gender, s.grade_level, s.section, s.profile_photo_url, s.home_address, s.created_at
         FROM students s ${join} ${where}
         ORDER BY s.surname, s.first_name
         LIMIT $${params.length-1} OFFSET $${params.length}`, params),
      query(`SELECT COUNT(*) FROM students s ${join} ${where}`, params.slice(0,-2))
    ])

    res.json({
      students: rows.rows,
      pagination: { total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(count.rows[0].count/limit) }
    })
  } catch (err) { next(err) }
})

// GET /api/students/:id
router.get('/:id', async (req, res, next) => {
  try {
    const student = await getStudentWithGuardians(req.params.id)
    if (!student) throw new AppError('Student not found.', 404)

    if (req.user.role === 'teacher') {
      delete student.home_address
      for (const g of student.guardians || []) {
        delete g.email
        delete g.phone
        delete g.home_address
      }
    }

    res.json({ student })
  } catch (err) { next(err) }
})

// POST /api/students
router.post('/', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = studentSchema.validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    const { guardians=[], ...data } = value
    const { surname, first_name, middle_name } = normaliseName(data)

    const dup = await query('SELECT id FROM students WHERE lrn=$1', [data.lrn])
    if (dup.rows.length) throw new AppError('A student with this LRN already exists.', 409)

    const student = await withTransaction(async (client) => {
      const sRes = await client.query(
        `INSERT INTO students (lrn, surname, first_name, middle_name, date_of_birth, gender, grade_level, section, profile_photo_url, home_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [data.lrn, surname, first_name, middle_name||null, data.date_of_birth,
         data.gender, data.grade_level, data.section||null, data.profile_photo_url||null, data.home_address||null]
      )
      for (const g of guardians) await insertGuardian(client, sRes.rows[0].id, g)
      return await getStudentWithGuardians(sRes.rows[0].id)
    })

    res.status(201).json({ message: 'Student added successfully.', student })
  } catch (err) { next(err) }
})

// PUT /api/students/:id
router.put('/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = updateStudentSchema.validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    const normed = normaliseName(value)
    const sets=[]; const params=[]

    // Check duplicate LRN excluding this student
    if (normed.lrn) {
      const dup = await query(
        'SELECT id FROM students WHERE lrn=$1 AND id<>$2 AND is_active=TRUE',
        [normed.lrn, req.params.id]
      )
      if (dup.rows.length) throw new AppError('A student with this LRN already exists.', 409)
    }

    for (const f of ['lrn','surname','first_name','middle_name','date_of_birth','gender','grade_level','section','profile_photo_url','home_address']) {
      if (normed[f] !== undefined) { params.push(normed[f] ?? null); sets.push(`${f}=$${params.length}`) }
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

// DELETE /api/students/:id
router.delete('/:id', authorize('admin'), async (req, res, next) => {
  try {
    const r = await query(
      'UPDATE students SET is_active=FALSE, updated_at=NOW() WHERE id=$1 RETURNING full_name', [req.params.id]
    )
    if (!r.rows.length) throw new AppError('Student not found.', 404)
    res.json({ message: `${r.rows[0].full_name} removed successfully.` })
  } catch (err) { next(err) }
})

// POST /api/students/:id/guardians
router.post('/:id/guardians', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = guardianSchema.validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)
    await withTransaction(async (client) => { await insertGuardian(client, req.params.id, value) })
    res.json({ message: 'Guardian added.', student: await getStudentWithGuardians(req.params.id) })
  } catch (err) { next(err) }
})

// PUT /api/students/:id/guardians/:guardianId
router.put('/:id/guardians/:guardianId', authorize('admin'), async (req, res, next) => {
  try {
    const { error, value } = updateGuardianSchema.validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    const normed = normaliseName(value)
    const sets=[]; const params=[]
    for (const f of ['surname','first_name','middle_name','email','phone','relationship','is_authorized_pickup','is_emergency_contact','home_address']) {
      if (normed[f] !== undefined) { params.push(normed[f] ?? null); sets.push(`${f}=$${params.length}`) }
    }
    if (!sets.length) throw new AppError('Nothing to update.', 400)
    sets.push('updated_at=NOW()')
    params.push(req.params.guardianId, req.params.id)

    const r = await query(
      `UPDATE parent_student SET ${sets.join(',')} WHERE id=$${params.length-1} AND student_id=$${params.length} RETURNING id`, params
    )
    if (!r.rows.length) throw new AppError('Guardian not found.', 404)
    res.json({ message: 'Guardian updated.', student: await getStudentWithGuardians(req.params.id) })
  } catch (err) { next(err) }
})

// DELETE /api/students/:id/guardians/:guardianId
router.delete('/:id/guardians/:guardianId', authorize('admin'), async (req, res, next) => {
  try {
    // Get the parent_id (portal account) before deleting the row
    const row = await query(
      'SELECT parent_id FROM parent_student WHERE id=$1 AND student_id=$2',
      [req.params.guardianId, req.params.id]
    )
    if (!row.rows.length) throw new AppError('Guardian not found.', 404)

    const parentId = row.rows[0].parent_id

    // Remove the guardian link
    await query('DELETE FROM parent_student WHERE id=$1', [req.params.guardianId])

    // If they had a portal account, delete it only if not linked to any other student
    if (parentId) {
      const stillLinked = await query(
        'SELECT COUNT(*) FROM parent_student WHERE parent_id=$1', [parentId]
      )
      if (parseInt(stillLinked.rows[0].count) === 0) {
        await query('DELETE FROM users WHERE id=$1 AND role=$2', [parentId, 'parent'])
      }
    }

    res.json({ message: 'Guardian removed.' })
  } catch (err) { next(err) }
})

// POST /api/students/:id/generate-qr
router.post('/:id/generate-qr', authorize('admin'), async (req, res, next) => {
  try {
    const { expiresInMinutes=30 } = req.body
    const token     = uuidv4()
    const expiresAt = new Date(Date.now() + expiresInMinutes*60000)
    const qrImage   = await QRCode.toDataURL(
      JSON.stringify({ studentId: req.params.id, token, expiresAt, type: 'VISTA_SECUREPASS' }),
      { errorCorrectionLevel: 'H', width: 300, margin: 2 }
    )
    await query('UPDATE students SET qr_code=$1, qr_expires_at=$2 WHERE id=$3', [token, expiresAt, req.params.id])
    res.json({ message: 'QR code generated.', qrImage, token, expiresAt })
  } catch (err) { next(err) }
})

module.exports = router