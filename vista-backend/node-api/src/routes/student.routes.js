const express = require('express')
const router  = express.Router()
const QRCode  = require('qrcode')
const { v4: uuidv4 } = require('uuid')
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const { authenticate, authorizeAnyAdmin, authorizeSuperAdmin, enforceGradeScope } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { normaliseName } = require('../utils/nameHelper')
const { ROLES, gradeScopeForRole, canManageGrade, isScopedAdmin } = require('../utils/roles')
const { assertSectionsExist } = require('../utils/sections')
const { MANUAL_STATUS_IDS, clampToManual, statusLabel } = require('../utils/enrollment')

// The active school year, needed both to validate section names and to stamp
// the enrollment record a newly-added learner starts life with.
const requireActiveSYId = async () => {
  const r = await query('SELECT id FROM school_years WHERE is_active=TRUE LIMIT 1')
  if (!r.rows.length) throw new AppError('No active school year configured.', 500)
  return r.rows[0].id
}

// A student only exists inside a school year. Every create path stamps the
// active year's enrollment row so the roster and the year-by-year history agree
// from the moment the learner is added.
const enrollForActiveYear = async (client, syId, student) =>
  client.query(
    `INSERT INTO student_enrollments (student_id, school_year_id, grade_level, section, status)
     VALUES ($1,$2,$3,$4,'enrolled')
     ON CONFLICT (student_id, school_year_id) DO NOTHING`,
    [student.id, syId, student.grade_level, student.section || null]
  )

// Throws 403 if the targeted student's grade_level is outside the caller's scope.
// Super_admin, teachers, and parents are untouched (teachers/parents are scoped
// elsewhere; this helper enforces the ECE/Elem admin split on student rows).
const assertStudentInScope = async (req, studentId) => {
  if (!isScopedAdmin(req.user.role)) return
  const r = await query('SELECT grade_level FROM students WHERE id=$1 AND is_active=TRUE', [studentId])
  if (!r.rows.length) throw new AppError('Student not found.', 404)
  if (!canManageGrade(req.user.role, r.rows[0].grade_level)) {
    throw new AppError('Student is outside your grade scope.', 403)
  }
}

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
router.get('/parents/search', authorizeAnyAdmin, async (req, res, next) => {
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
    const { grade_level, section, search, enrollment_status, page=1, limit=20 } = req.query
    const offset = (page-1)*limit
    const conditions = ['s.is_active=TRUE']
    const params = []

    if (grade_level) { params.push(grade_level); conditions.push(`s.grade_level=$${params.length}`) }
    if (section)     { params.push(section);      conditions.push(`s.section=$${params.length}`) }
    // Teachers and parents only ever see learners actually studying this year --
    // a pending or withdrawn student must not appear on a class list. Admins
    // keep the full roster so nobody becomes invisible.
    if (req.user.role === ROLES.TEACHER || req.user.role === ROLES.PARENT) {
      conditions.push(`s.enrollment_status='enrolled'`)
    }
    if (search) {
      params.push(`%${search}%`)
      conditions.push(`(s.surname ILIKE $${params.length} OR s.first_name ILIKE $${params.length} OR s.full_name ILIKE $${params.length} OR s.lrn ILIKE $${params.length})`)
    }
    if (req.user.role === 'parent') {
      params.push(req.user.id)
      conditions.push(`ps.parent_id=$${params.length}`)
    }
    if (isScopedAdmin(req.user.role)) {
      params.push(gradeScopeForRole(req.user.role))
      conditions.push(`s.grade_level = ANY($${params.length}::text[])`)
    }

    const join  = req.user.role === 'parent' ? 'INNER JOIN parent_student ps ON ps.student_id=s.id' : ''

    // Snapshot the filters before the status filter is applied -- the breakdown
    // below has to count every status, including the ones filtered out.
    const unstatusedConditions = [...conditions]
    const unstatusedParams     = [...params]

    if (enrollment_status) { params.push(enrollment_status); conditions.push(`s.enrollment_status=$${params.length}`) }

    const where = `WHERE ${conditions.join(' AND ')}`
    params.push(limit, offset)

    const [rows, count] = await Promise.all([
      query(
        `SELECT s.id, s.lrn, s.surname, s.first_name, s.middle_name, s.full_name,
                s.date_of_birth, s.gender, s.grade_level, s.section, s.enrollment_status,
                s.profile_photo_url, s.home_address, s.created_at
         FROM students s ${join} ${where}
         ORDER BY s.surname, s.first_name
         LIMIT $${params.length-1} OFFSET $${params.length}`, params),
      query(`SELECT COUNT(*) FROM students s ${join} ${where}`, params.slice(0,-2))
    ])

    // Status breakdown over the same filters *except* the status filter itself,
    // so the header can report "N enrolled / M pending" and the status tabs keep
    // showing their counts while one of them is selected.
    const byStatus = await query(
      `SELECT s.enrollment_status, COUNT(*)::int AS count
       FROM students s ${join} WHERE ${unstatusedConditions.join(' AND ')} GROUP BY 1`,
      unstatusedParams
    )

    res.json({
      students: rows.rows,
      by_status: Object.fromEntries(byStatus.rows.map(r => [r.enrollment_status, r.count])),
      pagination: { total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(count.rows[0].count/limit) }
    })
  } catch (err) { next(err) }
})

// GET /api/students/:id
router.get('/:id', async (req, res, next) => {
  try {
    const student = await getStudentWithGuardians(req.params.id)
    if (!student) throw new AppError('Student not found.', 404)

    if (isScopedAdmin(req.user.role) && !canManageGrade(req.user.role, student.grade_level)) {
      throw new AppError('Student not found.', 404)
    }

    // Parents may only read their own linked children.
    if (req.user.role === ROLES.PARENT) {
      const link = await query(
        'SELECT 1 FROM parent_student WHERE parent_id=$1 AND student_id=$2 LIMIT 1',
        [req.user.id, req.params.id]
      )
      if (!link.rowCount) throw new AppError('Student not found.', 404)
    }

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

// PATCH /api/students/:id/academic-access — admin toggle for the Conditional
// Access Controller. When suspended, parent grade + ECE reads return 423 Locked.
// Safety surfaces (attendance, behavior, dismissal, risk) stay visible.
router.patch('/:id/academic-access', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const schema = Joi.object({
      suspended: Joi.boolean().required(),
      reason: Joi.string().allow('').max(500).optional(),
    })
    const { error, value } = schema.validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    await assertStudentInScope(req, req.params.id)

    const r = await query(
      `UPDATE students
         SET academic_access_suspended = $1,
             academic_access_suspended_reason = $2,
             updated_at = NOW()
       WHERE id = $3 AND is_active = TRUE
       RETURNING id, full_name, academic_access_suspended, academic_access_suspended_reason`,
      [value.suspended, value.suspended ? (value.reason || null) : null, req.params.id]
    )
    if (!r.rows.length) throw new AppError('Student not found.', 404)
    res.json({
      message: value.suspended ? 'Academic access suspended.' : 'Academic access restored.',
      student: r.rows[0],
    })
  } catch (err) { next(err) }
})

// PATCH /api/students/:id/enrollment-status — **super_admin only**.
// Confirms a pending learner, or records that one has left. Writes the mirror on
// `students` AND the active year's `student_enrollments` row together, so the
// roster and the year-by-year history can never disagree.
//
// Same rule as `PUT /api/enrollment`, which refuses a changed status from a scoped
// admin: placing a learner is theirs, deciding whether the learner is attending at
// all is not. This is the single-learner path to the same column, so leaving it on
// `authorizeAnyAdmin` would have made that restriction a speed bump — one page over
// is not a boundary. Grade scope still applies on top via `assertStudentInScope`.
//
// Attendance only. 'graduated' is a year-end outcome earned from results, so it
// is not on offer here — the promotion wizard is the only thing that sets one.
router.patch('/:id/enrollment-status', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const schema = Joi.object({
      status:  Joi.string().valid(...MANUAL_STATUS_IDS).required(),
      remarks: Joi.string().allow('').max(500).optional(),
    })
    const { error, value } = schema.validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    await assertStudentInScope(req, req.params.id)
    const activeSY = await requireActiveSYId()

    const student = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE students SET enrollment_status=$1, updated_at=NOW()
          WHERE id=$2 AND is_active=TRUE
          RETURNING id, full_name, grade_level, section, enrollment_status`,
        [value.status, req.params.id]
      )
      if (!r.rows.length) throw new AppError('Student not found.', 404)
      const row = r.rows[0]

      await client.query(
        `INSERT INTO student_enrollments
           (student_id, school_year_id, grade_level, section, status, remarks, decided_by, decided_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (student_id, school_year_id) DO UPDATE
           SET status=EXCLUDED.status, remarks=EXCLUDED.remarks,
               decided_by=EXCLUDED.decided_by, decided_at=NOW(), updated_at=NOW()`,
        [row.id, activeSY, row.grade_level, row.section || null,
         value.status, value.remarks || null, req.user.id]
      )
      return row
    })

    res.json({ message: `${student.full_name} marked ${statusLabel(value.status).toLowerCase()}.`, student })
  } catch (err) { next(err) }
})

// POST /api/students
router.post('/', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = studentSchema.validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    enforceGradeScope(req, value.grade_level)

    const { guardians=[], ...data } = value
    const { surname, first_name, middle_name } = normaliseName(data)

    const dup = await query('SELECT id FROM students WHERE lrn=$1', [data.lrn])
    if (dup.rows.length) throw new AppError('A student with this LRN already exists.', 409)

    const activeSY = await requireActiveSYId()

    const student = await withTransaction(async (client) => {
      const sRes = await client.query(
        `INSERT INTO students (lrn, surname, first_name, middle_name, date_of_birth, gender, grade_level, section, profile_photo_url, home_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, grade_level, section`,
        [data.lrn, surname, first_name, middle_name||null, data.date_of_birth,
         data.gender, data.grade_level, data.section||null, data.profile_photo_url||null, data.home_address||null]
      )
      await enrollForActiveYear(client, activeSY, sRes.rows[0])
      for (const g of guardians) await insertGuardian(client, sRes.rows[0].id, g)
      return await getStudentWithGuardians(sRes.rows[0].id)
    })

    res.status(201).json({ message: 'Student added successfully.', student })
  } catch (err) { next(err) }
})

// POST /api/students/check-lrns — admin-only. Given { lrns: [...] } returns
// { existing: [...] } for LRNs that already belong to an active student.
// Used by the batch-upload preview so duplicates surface before submit.
router.post('/check-lrns', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const lrns = Array.isArray(req.body?.lrns) ? req.body.lrns : []
    const clean = [...new Set(lrns.map(x => String(x).trim()).filter(x => /^\d{12}$/.test(x)))]
    if (!clean.length) return res.json({ existing: [] })
    const r = await query(
      'SELECT lrn FROM students WHERE lrn = ANY($1::text[]) AND is_active = TRUE',
      [clean]
    )
    res.json({ existing: r.rows.map(row => row.lrn) })
  } catch (err) { next(err) }
})

// POST /api/students/bulk — admin-only CSV batch upload (students only, no guardians)
const bulkStudentSchema = studentSchema.fork(['guardians'], s => s.forbidden())
const bulkSchema = Joi.object({
  students: Joi.array().items(bulkStudentSchema).min(1).max(200).required()
})

router.post('/bulk', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = bulkSchema.validate(req.body, { abortEarly: false, stripUnknown: true })
    if (error) {
      const msg = error.details.map(d => {
        const idx = d.path[1]
        const field = d.path.slice(2).join('.')
        return typeof idx === 'number' ? `Row ${idx + 1} ${field}: ${d.message}` : d.message
      }).join('; ')
      throw new AppError(msg, 422)
    }

    const rows = value.students

    if (isScopedAdmin(req.user.role)) {
      const offenders = []
      rows.forEach((r, i) => {
        if (!canManageGrade(req.user.role, r.grade_level)) {
          offenders.push(`Row ${i + 1}: grade "${r.grade_level}" is outside your scope`)
        }
      })
      if (offenders.length) throw new AppError(offenders.join('; '), 403)
    }

    const seen = new Set()
    for (let i = 0; i < rows.length; i++) {
      if (seen.has(rows[i].lrn)) {
        throw new AppError(`Duplicate LRN ${rows[i].lrn} at row ${i + 1} within the upload.`, 400)
      }
      seen.add(rows[i].lrn)
    }

    const existing = await query(
      'SELECT lrn FROM students WHERE lrn = ANY($1::text[])',
      [rows.map(r => r.lrn)]
    )
    if (existing.rows.length) {
      throw new AppError(
        `These LRNs already exist: ${existing.rows.map(r => r.lrn).join(', ')}`,
        409
      )
    }

    // Validate (grade_level, section) against sections defined for the active
    // school year. Empty section is allowed (mirrors single-student POST).
    const activeSY = await requireActiveSYId()
    await assertSectionsExist(activeSY, rows, (_r, i) => `Row ${i + 1}`)

    const inserted = await withTransaction(async (client) => {
      const out = []
      for (const r of rows) {
        const { surname, first_name, middle_name } = normaliseName(r)
        const res = await client.query(
          `INSERT INTO students (lrn, surname, first_name, middle_name, date_of_birth,
                                 gender, grade_level, section, home_address)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, lrn, grade_level, section`,
          [r.lrn, surname, first_name, middle_name || null, r.date_of_birth,
           r.gender, r.grade_level, r.section || null, r.home_address]
        )
        await enrollForActiveYear(client, activeSY, res.rows[0])
        out.push({ id: res.rows[0].id, lrn: res.rows[0].lrn })
      }
      return out
    })

    res.status(201).json({ message: `${inserted.length} students added.`, students: inserted })
  } catch (err) { next(err) }
})

// PUT /api/students/:id
router.put('/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = updateStudentSchema.validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    await assertStudentInScope(req, req.params.id)
    // Prevent scoped admin from moving a student into an out-of-scope grade.
    if (value.grade_level) enforceGradeScope(req, value.grade_level)

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

    // Moving a learner here has to move the active year's enrolment record with
    // them. Otherwise the record still names last month's class, and the next
    // rollover would quietly undo the edit.
    const movesClass = normed.grade_level !== undefined || normed.section !== undefined
    const activeSY = movesClass ? await requireActiveSYId() : null

    const updated = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE students SET ${sets.join(',')} WHERE id=$${params.length} AND is_active=TRUE
         RETURNING id, grade_level, section, enrollment_status`, params
      )
      if (!r.rows.length) throw new AppError('Student not found.', 404)

      if (movesClass) {
        const row = r.rows[0]
        await client.query(
          `INSERT INTO student_enrollments
             (student_id, school_year_id, grade_level, section, status, decided_by, decided_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT (student_id, school_year_id) DO UPDATE
             SET grade_level=EXCLUDED.grade_level, section=EXCLUDED.section,
                 decided_by=EXCLUDED.decided_by, decided_at=NOW(), updated_at=NOW()`,
                // The mirror can say 'graduated', which the record's CHECK refuses:
          // in the year itself the learner was enrolled, so clamp it.
          [row.id, activeSY, row.grade_level, row.section || null,
           clampToManual(row.enrollment_status), req.user.id]
        )
      }
      return r.rows[0]
    })

    res.json({ message: 'Student updated.', student: await getStudentWithGuardians(updated.id) })
  } catch (err) { next(err) }
})

// DELETE /api/students/:id
router.delete('/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    await assertStudentInScope(req, req.params.id)
    const r = await query(
      'UPDATE students SET is_active=FALSE, updated_at=NOW() WHERE id=$1 RETURNING full_name', [req.params.id]
    )
    if (!r.rows.length) throw new AppError('Student not found.', 404)
    res.json({ message: `${r.rows[0].full_name} removed successfully.` })
  } catch (err) { next(err) }
})

// POST /api/students/:id/guardians
router.post('/:id/guardians', authorizeAnyAdmin, async (req, res, next) => {
  try {
    await assertStudentInScope(req, req.params.id)
    const { error, value } = guardianSchema.validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)
    await withTransaction(async (client) => { await insertGuardian(client, req.params.id, value) })
    res.json({ message: 'Guardian added.', student: await getStudentWithGuardians(req.params.id) })
  } catch (err) { next(err) }
})

// PUT /api/students/:id/guardians/:guardianId
router.put('/:id/guardians/:guardianId', authorizeAnyAdmin, async (req, res, next) => {
  try {
    await assertStudentInScope(req, req.params.id)
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
router.delete('/:id/guardians/:guardianId', authorizeAnyAdmin, async (req, res, next) => {
  try {
    await assertStudentInScope(req, req.params.id)
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
// Admins (school web console) and linked authorized-pickup parents (vista_parent
// mobile app, "Pickup QR" tab) may both generate a SecurePass QR.
//
// Expiry policy depends on the chosen fetcher:
//   • fetcher_type='self' (default — parent themself, or admin path)
//       → time-based expiry (20 min parents, 30 min admins) PLUS one-time use.
//         The account holder is at the gate and can refresh on their phone.
//   • fetcher_type='auth' (an authorized_pickup_persons row, e.g. yaya/driver)
//       → ONE-TIME USE ONLY, no time expiry. The fetcher does not have access
//         to the parent's account, so they cannot regenerate if a timer ran out
//         while they were on the way. The QR is invalidated only by a
//         successful /verify (which clears `qr_code`).
router.post('/:id/generate-qr', async (req, res, next) => {
  try {
    const role = req.user?.role
    const isAdmin = role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN_ECE || role === ROLES.ADMIN_ELEM

    if (isAdmin) {
      await assertStudentInScope(req, req.params.id)
    } else if (role === ROLES.PARENT) {
      const link = await query(
        `SELECT 1 FROM parent_student
          WHERE parent_id=$1 AND student_id=$2 AND is_authorized_pickup=TRUE
          LIMIT 1`,
        [req.user.id, req.params.id]
      )
      if (!link.rowCount) {
        throw new AppError('You are not an authorized pickup guardian for this student.', 403)
      }
    } else {
      throw new AppError('Not authorized to generate a pickup QR.', 403)
    }

    // Optional fetcher binding: parent picks WHO is fetching today before
    // generating the QR. 'self' (default) → parent themself; 'auth' → an
    // authorized_pickup_persons row owned by this parent for this student.
    // Admins still default to 'self' with their own user id (used by the
    // admin-side generated QR fallback in /api/dismissal/scan).
    const rawFetcherType = (req.body?.fetcher_type || 'self').toString().trim()
    if (!['self', 'auth'].includes(rawFetcherType)) {
      throw new AppError("fetcher_type must be 'self' or 'auth'.", 400)
    }
    let fetcherType = rawFetcherType
    let fetcherId = req.user.id

    if (rawFetcherType === 'auth') {
      if (role !== ROLES.PARENT) {
        throw new AppError('Only parents may bind a QR to an authorized pickup person.', 403)
      }
      const candidate = (req.body?.fetcher_id || '').toString().trim()
      if (!candidate) throw new AppError('fetcher_id is required when fetcher_type is "auth".', 400)
      const owned = await query(
        `SELECT 1 FROM authorized_pickup_persons
          WHERE id=$1 AND parent_id=$2 AND student_id=$3
          LIMIT 1`,
        [candidate, req.user.id, req.params.id]
      )
      if (!owned.rowCount) {
        throw new AppError('Authorized person not found for this student.', 404)
      }
      fetcherId = candidate
    }

    const token = uuidv4()

    // 'auth' QRs never carry a timer; 'self' / admin QRs use the time-based
    // expiry the dashboard and parent app have always relied on.
    let expiresAt = null
    let qrPayloadObj = { studentId: req.params.id, token, type: 'VISTA_SECUREPASS' }
    if (fetcherType !== 'auth') {
      const defaultExpiry = role === ROLES.PARENT ? 20 : 30
      const expiresInMinutes = Number.parseInt(req.body?.expiresInMinutes, 10) || defaultExpiry
      expiresAt = new Date(Date.now() + expiresInMinutes * 60000)
      qrPayloadObj.expiresAt = expiresAt
    }
    const qrPayload = JSON.stringify(qrPayloadObj)
    const qrImage   = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'H', width: 300, margin: 2 })
    await query(
      `UPDATE students
         SET qr_code=$1, qr_expires_at=$2, qr_generated_by=$3,
             qr_fetcher_type=$4, qr_fetcher_id=$5
       WHERE id=$6`,
      [token, expiresAt, req.user.id, fetcherType, fetcherId, req.params.id]
    )
    res.json({
      message: 'QR code generated.',
      qrImage,
      qr_payload: qrPayload,
      token,
      expiresAt,
      fetcher_type: fetcherType,
      fetcher_id: fetcherId,
    })
  } catch (err) { next(err) }
})

module.exports = router