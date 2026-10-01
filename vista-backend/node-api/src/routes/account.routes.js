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
const {
  invitationJsonSql, issueInvitation, revokeLiveInvitation, changeInvitationEmail,
} = require('../utils/invitations')
const { resolveStaffAccess } = require('../utils/staffAccess')

router.use(authenticate, authorizeAnyAdmin)

/* ──────────────────────────────────────────────────────────────────────────
 * Staff accounts are invitations.
 *
 * An admin authorizes an email address; they never set, see or can recover a
 * teacher's or admin's password. The account is born `account_status =
 * 'pending'` with no password, and the staff member activates it themselves
 * from "Activate your account" on the dashboard's sign-in page — the same
 * endpoints, codes and anti-enumeration rules a parent uses from the app.
 * Creating one sends nothing, which is what stops a mistyped address from
 * mailing a stranger.
 *
 * A staff account is switched off by deactivating it (`is_active = FALSE`),
 * which keeps its assignments and history. For one that never activated,
 * "cancel the invitation" is the same act, and reactivating it reopens the
 * invitation — it has no password to go back to.
 * ────────────────────────────────────────────────────────────────────────── */

// Refused outright rather than stripped: a client still posting a password
// should be told the field is gone, not have it silently ignored.
const NO_PASSWORD = Joi.forbidden().messages({
  'any.unknown': 'Passwords are not set here. The account holder chooses their own when they activate, and can reset it from the sign-in page.',
})

const assignmentShape = Joi.object({
  grade_level: Joi.string().required(),
  section:     Joi.string().required(),
  subject:     Joi.string().required(),
})

const createSchema = Joi.object({
  email:       Joi.string().email().required(),
  surname:     Joi.string().min(1).required(),
  first_name:  Joi.string().min(1).required(),
  middle_name: Joi.string().optional().allow(''),
  phone:       Joi.string().allow('', null).optional(),
  assignments: Joi.array().items(assignmentShape).optional(),
  password:    NO_PASSWORD,
})

const updateSchema = Joi.object({
  email:       Joi.string().email().optional(),
  surname:     Joi.string().min(1).optional(),
  first_name:  Joi.string().min(1).optional(),
  middle_name: Joi.string().optional().allow(''),
  phone:       Joi.string().allow('', null).optional(),
  is_active:   Joi.boolean().optional(),
  assignments: Joi.array().items(assignmentShape).optional(),
  password:    NO_PASSWORD,
})

// Admin-accounts CRUD (super_admin only) uses a separate create shape.
//
// Super Admin can be granted here, behind two guards: the creating super admin
// re-enters their own password (`confirm_password`), and nothing can deactivate
// the last active one. The role is everything in VISTA, so a session left open
// on a shared computer must not be enough to hand it out.
const adminCreateSchema = Joi.object({
  email:       Joi.string().email().required(),
  surname:     Joi.string().min(1).required(),
  first_name:  Joi.string().min(1).required(),
  middle_name: Joi.string().optional().allow(''),
  phone:       Joi.string().allow('', null).optional(),
  role:        Joi.string().valid(ROLES.ADMIN_ECE, ROLES.ADMIN_ELEM, ROLES.SUPER_ADMIN).required(),
  confirm_password: Joi.when('role', {
    is: ROLES.SUPER_ADMIN,
    then: Joi.string().required().messages({
      'any.required': 'Enter your password to confirm giving Super Admin access.',
      'string.empty': 'Enter your password to confirm giving Super Admin access.',
    }),
    otherwise: Joi.any().strip(),
  }),
  password:    NO_PASSWORD,
})

const adminUpdateSchema = Joi.object({
  email:       Joi.string().email().optional(),
  surname:     Joi.string().min(1).optional(),
  first_name:  Joi.string().min(1).optional(),
  middle_name: Joi.string().optional().allow(''),
  phone:       Joi.string().allow('', null).optional(),
  is_active:   Joi.boolean().optional(),
  // Moving between the two scoped tiers only. Granting Super Admin is a
  // creation-time act behind a password confirmation, never an edit.
  role:        Joi.string().valid(ROLES.ADMIN_ECE, ROLES.ADMIN_ELEM).optional(),
  password:    NO_PASSWORD,
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

// ─── Staff access helpers ─────────────────────────────────────────────────

const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN_ECE, ROLES.ADMIN_ELEM]

/**
 * The columns every staff row carries for its access state. `has_password` is
 * the test for "has ever activated" — the same one the parent side uses — and
 * never the hash itself.
 */
const STAFF_ACCESS_COLUMNS = (a = 'u') => `
  ${a}.account_status, ${a}.last_login_at,
  (${a}.password_hash IS NOT NULL) AS has_password,
  ${invitationJsonSql(`${a}.id`)} AS invitation`

const STAFF_BASE_COLUMNS = (a = 'u') => `
  ${a}.id, ${a}.email, ${a}.surname, ${a}.first_name, ${a}.middle_name, ${a}.full_name,
  ${a}.role, ${a}.phone, ${a}.is_active, ${a}.created_at`

/** Attach the derived `access` state. */
const presentStaff = (row) => {
  if (!row) return row
  row.access = resolveStaffAccess({
    isActive: row.is_active,
    accountStatus: row.account_status,
    invitation: row.invitation,
  })
  return row
}

const displayName = (u) => `${u.surname}, ${u.first_name}`

/** The account as the write helpers below need it, or a 404 naming the kind. */
const loadStaff = async (client, id, roles, noun) => {
  const r = await client.query(
    `SELECT id, email, role, surname, first_name, is_active, account_status,
            (password_hash IS NOT NULL) AS has_password
       FROM users WHERE id=$1 AND role = ANY($2::text[])`,
    [id, roles]
  )
  if (!r.rows.length) throw new AppError(`${noun} not found.`, 404)
  return r.rows[0]
}

/** One row with its access state, read after a write so the client can replace its copy. */
const readStaff = async (id) => {
  const r = await query(
    `SELECT ${STAFF_BASE_COLUMNS()}, ${STAFF_ACCESS_COLUMNS()} FROM users u WHERE u.id=$1`,
    [id]
  )
  return presentStaff(r.rows[0])
}

const assertEmailFree = async (client, email, exceptId = null) => {
  const r = await client.query(
    'SELECT 1 FROM users WHERE LOWER(email)=LOWER($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1',
    [email, exceptId]
  )
  if (r.rows.length) throw new AppError('Email already registered.', 409)
}

/** A new account with no password, waiting for its holder to activate it. */
const createInvitedAccount = async (client, { email, surname, first_name, middle_name, phone, role, actorId }) => {
  const r = await client.query(
    `INSERT INTO users (email, password_hash, surname, first_name, middle_name, role, phone, account_status)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, 'pending') RETURNING id`,
    [email, surname, first_name, middle_name || null, role, phone || null]
  )
  const id = r.rows[0].id
  await issueInvitation(client, { userId: id, email, invitedBy: actorId })
  return id
}

/**
 * Reopen the invitation for 30 days, cancelling any unused code. Switches the
 * account back on if it was off — for an account that never activated,
 * reactivating and reissuing are the same act.
 */
const reissueStaffInvitation = async (client, { user, actorId }) => {
  if (user.has_password) {
    throw new AppError(
      `${displayName(user)} has already activated their account, so there is no invitation to reissue. If they've forgotten their password, they can reset it from the sign-in page.`,
      409
    )
  }
  await client.query(
    "UPDATE users SET is_active=TRUE, account_status='pending', updated_at=NOW() WHERE id=$1",
    [user.id]
  )
  await issueInvitation(client, { userId: user.id, email: user.email, invitedBy: actorId })
}

/**
 * Switch an account off or on. Off also closes any open invitation, so a
 * deactivated account cannot be activated by someone holding a code. On
 * reopens the invitation when the account never activated — there is no
 * password for it to go back to.
 */
const setStaffActive = async (client, { user, active, actorId }) => {
  if (!active) {
    await client.query('UPDATE users SET is_active=FALSE, updated_at=NOW() WHERE id=$1', [user.id])
    await revokeLiveInvitation(client, { userId: user.id, revokedBy: actorId })
    return
  }
  if (user.has_password) {
    await client.query('UPDATE users SET is_active=TRUE, updated_at=NOW() WHERE id=$1', [user.id])
    return
  }
  await reissueStaffInvitation(client, { user, actorId })
}

/**
 * The sign-in email stays correctable until the account holder activates — a
 * mistyped address is the likeliest reason an invitation goes unused. After
 * that it is how they sign in, and changing it under them is not an admin's
 * call.
 */
const changeStaffEmail = async (client, { user, email }) => {
  if (!email || email.trim().toLowerCase() === user.email.toLowerCase()) return false
  if (user.has_password) {
    throw new AppError(
      `The sign-in email can't be changed after ${displayName(user)} has activated their account.`,
      409
    )
  }
  await assertEmailFree(client, email, user.id)
  await changeInvitationEmail(client, { userId: user.id, email: email.trim() })
  return true
}

/** The re-entered password behind granting Super Admin. */
const assertCallerPassword = async (req, password) => {
  const r = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id])
  const hash = r.rows[0]?.password_hash
  if (!hash || !await bcrypt.compare(password || '', hash)) {
    throw new AppError('That password is incorrect. Enter your own password to confirm.', 403)
  }
}

/**
 * VISTA must always have a Super Admin who can sign in — only one can create
 * school years, manage admins or recover from a locked-out admin, and nothing
 * outside the database could put one back.
 */
const assertNotLastSuperAdmin = async (client, targetId) => {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM users
      WHERE role=$1 AND is_active=TRUE AND account_status='active' AND id <> $2`,
    [ROLES.SUPER_ADMIN, targetId]
  )
  if (!r.rows[0].n) {
    throw new AppError('VISTA needs at least one active Super Admin, so this account cannot be deactivated.', 409)
  }
}

const invitedNote = (email) =>
  ` ${email} can now activate the account from "Activate your account" on the VISTA sign-in page. Nothing has been emailed.`

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
              u.phone, u.is_active, u.created_at, ${STAFF_ACCESS_COLUMNS()},
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
    res.json({ teachers: result.rows.map(presentStaff) })
  } catch (err) { next(err) }
})

// GET /api/accounts/teachers/:id
router.get('/teachers/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ${STAFF_BASE_COLUMNS()}, ${STAFF_ACCESS_COLUMNS()}
       FROM users u WHERE u.id=$1 AND u.role='teacher'`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Teacher not found.', 404)
    const teacher = presentStaff(result.rows[0])
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

// POST /api/accounts/teachers — invite a teacher
router.post('/teachers', async (req, res, next) => {
  try {
    const { error, value } = createSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { email, phone, assignments = [], ...nameFields } = value
    const { surname, first_name, middle_name } = normaliseName(nameFields)

    assertAssignmentsInScope(req, assignments)
    await assertEmailFree({ query }, email)

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

    const id = await withTransaction(async (client) => {
      const userId = await createInvitedAccount(client, {
        email, surname, first_name, middle_name, phone, role: ROLES.TEACHER, actorId: req.user.id,
      })
      for (const a of assignments) {
        await client.query(
          `INSERT INTO teacher_assignments (teacher_id, grade_level, section, subject, school_year)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [userId, a.grade_level, a.section, a.subject, syLabel]
        )
      }
      return userId
    })

    // Read after the commit — the assignment rows are not visible to the pool
    // until then.
    const teacher = await readStaff(id)
    teacher.assignments = await getAssignments(id)
    res.status(201).json({ message: `Invitation created for ${surname}, ${first_name}.${invitedNote(email)}`, teacher })
  } catch (err) { next(err) }
})

// PUT /api/accounts/teachers/:id
router.put('/teachers/:id', async (req, res, next) => {
  try {
    const { error, value } = updateSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { email, phone, is_active, assignments, ...nameFields } = value
    const normed = normaliseName(nameFields)

    if (assignments !== undefined) assertAssignmentsInScope(req, assignments)

    let note = ''
    await withTransaction(async (client) => {
      const user = await loadStaff(client, req.params.id, [ROLES.TEACHER], 'Teacher')

      const sets = []; const params = []
      if (normed.surname)               { params.push(normed.surname);     sets.push(`surname=$${params.length}`) }
      if (normed.first_name)            { params.push(normed.first_name);  sets.push(`first_name=$${params.length}`) }
      if (normed.middle_name !== undefined) { params.push(normed.middle_name || null); sets.push(`middle_name=$${params.length}`) }
      if (phone        !== undefined)   { params.push(phone || null);      sets.push(`phone=$${params.length}`) }

      if (sets.length) {
        sets.push('updated_at=NOW()')
        params.push(req.params.id)
        await client.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${params.length}`, params)
      }

      if (await changeStaffEmail(client, { user, email })) {
        note = ' The invitation now points at the new address, and any code already sent to the old one was cancelled.'
        user.email = email.trim()
      }

      if (is_active !== undefined && is_active !== user.is_active) {
        await setStaffActive(client, { user, active: is_active, actorId: req.user.id })
        if (is_active && !user.has_password) note += ' Their invitation is open again for 30 days.'
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
    })

    const teacher = await readStaff(req.params.id)
    teacher.assignments = await getAssignments(teacher.id)
    res.json({ message: `Teacher account updated.${note}`, teacher })
  } catch (err) { next(err) }
})

// POST /api/accounts/teachers/:id/invitation — reissue (also reopens a cancelled one)
router.post('/teachers/:id/invitation', async (req, res, next) => {
  try {
    const user = await withTransaction(async (client) => {
      const u = await loadStaff(client, req.params.id, [ROLES.TEACHER], 'Teacher')
      await reissueStaffInvitation(client, { user: u, actorId: req.user.id })
      return u
    })
    res.json({
      message: `${displayName(user)}'s invitation is open for another 30 days. Any unused code was cancelled.`,
      teacher: await readStaff(user.id),
    })
  } catch (err) { next(err) }
})

// DELETE /api/accounts/teachers/:id/invitation — cancel an invitation nobody used
router.delete('/teachers/:id/invitation', async (req, res, next) => {
  try {
    const user = await withTransaction(async (client) => {
      const u = await loadStaff(client, req.params.id, [ROLES.TEACHER], 'Teacher')
      if (u.has_password) {
        throw new AppError(`${displayName(u)} has already activated their account. Deactivate it instead.`, 409)
      }
      await setStaffActive(client, { user: u, active: false, actorId: req.user.id })
      return u
    })
    res.json({
      message: `${displayName(user)}'s invitation was cancelled and the account deactivated. Reactivate it to invite them again.`,
      teacher: await readStaff(user.id),
    })
  } catch (err) { next(err) }
})

// DELETE /api/accounts/teachers/:id  (soft delete)
router.delete('/teachers/:id', async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) throw new AppError('Cannot delete your own account.', 400)
    const user = await withTransaction(async (client) => {
      const u = await loadStaff(client, req.params.id, [ROLES.TEACHER], 'Teacher')
      await setStaffActive(client, { user: u, active: false, actorId: req.user.id })
      return u
    })
    res.json({ message: `${displayName(user)}'s account has been deactivated.` })
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
      `SELECT ${STAFF_BASE_COLUMNS()}, ${STAFF_ACCESS_COLUMNS()}
         FROM users u
        WHERE ${conditions.join(' AND ')}
        ORDER BY u.role, u.surname, u.first_name`,
      params
    )
    res.json({ admins: result.rows.map(presentStaff) })
  } catch (err) { next(err) }
})

// GET /api/accounts/admins/:id
router.get('/admins/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ${STAFF_BASE_COLUMNS()}, ${STAFF_ACCESS_COLUMNS()}
         FROM users u WHERE u.id=$1 AND u.role = ANY($2::text[])`,
      [req.params.id, ADMIN_ROLES]
    )
    if (!result.rows.length) throw new AppError('Admin not found.', 404)
    res.json({ admin: presentStaff(result.rows[0]) })
  } catch (err) { next(err) }
})

// POST /api/accounts/admins — invite an ECE Admin, Elementary Admin or Super Admin
router.post('/admins', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = adminCreateSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { email, phone, role, confirm_password, ...nameFields } = value
    const { surname, first_name, middle_name } = normaliseName(nameFields)

    if (role === ROLES.SUPER_ADMIN) await assertCallerPassword(req, confirm_password)
    await assertEmailFree({ query }, email)

    const id = await withTransaction((client) => createInvitedAccount(client, {
      email, surname, first_name, middle_name, phone, role, actorId: req.user.id,
    }))

    res.status(201).json({
      message: `Invitation created for ${surname}, ${first_name}.${invitedNote(email)}`,
      admin: await readStaff(id),
    })
  } catch (err) { next(err) }
})

// PUT /api/accounts/admins/:id
router.put('/admins/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = adminUpdateSchema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const { email, phone, is_active, role, ...nameFields } = value
    const normed = normaliseName(nameFields)

    let note = ''
    await withTransaction(async (client) => {
      const user = await loadStaff(client, req.params.id, ADMIN_ROLES, 'Admin')

      // Never change a super_admin's role: no self-demotion, and no promotion
      // to super_admin through an edit (the schema already refuses that value).
      if (user.role === ROLES.SUPER_ADMIN && role && role !== ROLES.SUPER_ADMIN) {
        throw new AppError('Cannot change a super_admin’s role.', 400)
      }

      const sets = []; const params = []
      if (normed.surname)                    { params.push(normed.surname);                sets.push(`surname=$${params.length}`) }
      if (normed.first_name)                 { params.push(normed.first_name);             sets.push(`first_name=$${params.length}`) }
      if (normed.middle_name !== undefined)  { params.push(normed.middle_name || null);    sets.push(`middle_name=$${params.length}`) }
      if (phone      !== undefined)          { params.push(phone || null);                 sets.push(`phone=$${params.length}`) }
      if (role       !== undefined && user.role !== ROLES.SUPER_ADMIN) {
        params.push(role); sets.push(`role=$${params.length}`)
      }
      if (sets.length) {
        sets.push('updated_at=NOW()')
        params.push(req.params.id)
        await client.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${params.length}`, params)
      }

      if (await changeStaffEmail(client, { user, email })) {
        note = ' The invitation now points at the new address, and any code already sent to the old one was cancelled.'
        user.email = email.trim()
      }

      if (is_active !== undefined && is_active !== user.is_active) {
        if (!is_active) {
          if (req.params.id === req.user.id) throw new AppError('You can’t deactivate your own account.', 400)
          if (user.role === ROLES.SUPER_ADMIN) await assertNotLastSuperAdmin(client, user.id)
        }
        await setStaffActive(client, { user, active: is_active, actorId: req.user.id })
        if (is_active && !user.has_password) note += ' Their invitation is open again for 30 days.'
      }
    })

    res.json({ message: `Admin account updated.${note}`, admin: await readStaff(req.params.id) })
  } catch (err) { next(err) }
})

// POST /api/accounts/admins/:id/invitation — reissue (also reopens a cancelled one)
router.post('/admins/:id/invitation', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const user = await withTransaction(async (client) => {
      const u = await loadStaff(client, req.params.id, ADMIN_ROLES, 'Admin')
      await reissueStaffInvitation(client, { user: u, actorId: req.user.id })
      return u
    })
    res.json({
      message: `${displayName(user)}'s invitation is open for another 30 days. Any unused code was cancelled.`,
      admin: await readStaff(user.id),
    })
  } catch (err) { next(err) }
})

// DELETE /api/accounts/admins/:id/invitation — cancel an invitation nobody used
router.delete('/admins/:id/invitation', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const user = await withTransaction(async (client) => {
      const u = await loadStaff(client, req.params.id, ADMIN_ROLES, 'Admin')
      if (u.has_password) {
        throw new AppError(`${displayName(u)} has already activated their account. Deactivate it instead.`, 409)
      }
      await setStaffActive(client, { user: u, active: false, actorId: req.user.id })
      return u
    })
    res.json({
      message: `${displayName(user)}'s invitation was cancelled and the account deactivated. Reactivate it to invite them again.`,
      admin: await readStaff(user.id),
    })
  } catch (err) { next(err) }
})

// DELETE /api/accounts/admins/:id (soft delete)
//
// Another Super Admin can be deactivated too, now that there can be more than
// one — but never yourself, and never the last one who can sign in.
router.delete('/admins/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) throw new AppError('You can’t deactivate your own account.', 400)
    const user = await withTransaction(async (client) => {
      const u = await loadStaff(client, req.params.id, ADMIN_ROLES, 'Admin')
      if (u.role === ROLES.SUPER_ADMIN) await assertNotLastSuperAdmin(client, u.id)
      await setStaffActive(client, { user: u, active: false, actorId: req.user.id })
      return u
    })
    res.json({ message: `${displayName(user)}'s admin account has been deactivated.` })
  } catch (err) { next(err) }
})

module.exports = router
