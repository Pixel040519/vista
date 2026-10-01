const express = require('express')
const router  = express.Router()
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const { authenticate, authorizeAnyAdmin, authorizeSuperAdmin, enforceGradeScope } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { normaliseName } = require('../utils/nameHelper')
const { ROLES, ALL_GRADES, gradeScopeForRole, canManageGrade, isScopedAdmin, isAnyAdmin } = require('../utils/roles')
const { assertSectionsExist } = require('../utils/sections')
const { MANUAL_STATUS_IDS, clampToManual, statusLabel } = require('../utils/enrollment')
const { grantParentAccess, revokeParentAccess, changeInvitationEmail, latestInvitation, accessNote, alsoLinkedNote } = require('../utils/parentInvitations')
const { resolveParentAccess } = require('../utils/parentAccess')

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
//
// `includeArchived` exists because the default lookup filters `is_active=TRUE`,
// which is exactly the set the archive endpoints are there to act on: restoring a
// learner would 404 on the scope check before it ever reached the handler. Pass it
// wherever the target may legitimately be off the roll.
const assertStudentInScope = async (req, studentId, { includeArchived = false } = {}) => {
  if (!isScopedAdmin(req.user.role)) return
  const r = await query(
    `SELECT grade_level FROM students WHERE id=$1${includeArchived ? '' : ' AND is_active=TRUE'}`,
    [studentId]
  )
  if (!r.rows.length) throw new AppError('Student not found.', 404)
  if (!canManageGrade(req.user.role, r.rows[0].grade_level)) {
    throw new AppError('Student is outside your grade scope.', 403)
  }
}

router.use(authenticate)

// Inviting a guardian to the parent portal needs one thing from the admin: an
// address to authorize. There is deliberately no password field — the parent
// sets their own after proving they control the address, and an admin can
// neither choose nor read it.
//
// `create_account` and `password` are stripped rather than merely unrecognised.
// stripUnknown would drop them anyway, but saying so here means an older client
// that still posts a password gets it discarded loudly in one place instead of
// silently in Joi's defaults.
const PORTAL_EMAIL_MSG = 'A Registered Email Address is needed to invite this guardian to the parent portal.'
const portalAccountShape = (base = Joi.boolean()) => ({
  invite: base,
  create_account: Joi.any().strip(),
  password: Joi.any().strip(),
})
const portalEmail = Joi.when('invite', {
  is: true,
  then: Joi.string().email().required().messages({ 'any.required': PORTAL_EMAIL_MSG, 'string.empty': PORTAL_EMAIL_MSG }),
  otherwise: Joi.string().email().optional().allow(''),
})

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
  // `.insensitive()` accepts "male"/"FEMALE" from a hand-typed spreadsheet and
  // **converts** the value to the stored casing, the same canonicalise-don't-
  // merely-accept rule grade level and section follow: `students_gender_check`
  // and every surface that groups by gender compare the string exactly.
  gender:            Joi.string().trim().valid('Male','Female').insensitive().required(),
  grade_level:       Joi.string().required(),
  section:           Joi.string().optional().allow(''),
  profile_photo_url: Joi.string().uri().optional().allow(''),
  home_address:      Joi.string().trim().min(1).required(),
  guardians: Joi.array().items(Joi.object({
    ...guardianNameShape,
    relationship:         Joi.string().required(),
    email:                portalEmail,
    phone:                Joi.string().optional().allow(''),
    is_emergency_contact:  Joi.boolean().default(false),
    ...portalAccountShape(Joi.boolean().default(false)),
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
  gender:            Joi.string().trim().valid('Male','Female').insensitive().optional(),
  grade_level:       Joi.string().optional(),
  section:           Joi.string().optional().allow(''),
  profile_photo_url: Joi.string().uri().optional().allow(''),
  home_address:      Joi.string().optional().allow(''),
})

const guardianSchema = Joi.object({
  ...guardianNameShape,
  relationship:         Joi.string().required(),
  email:                portalEmail,
  phone:                Joi.string().optional().allow(''),
  is_emergency_contact:  Joi.boolean().default(false),
  ...portalAccountShape(Joi.boolean().default(false)),
  home_address:          Joi.string().trim().min(1).required(),
  // Link to a parent account that already exists instead of entering someone
  // new. The account supplies the name, email and phone; see insertGuardian.
  link_parent_id:        Joi.string().uuid().optional().allow(null),
})

const updateGuardianSchema = Joi.object({
  surname:               Joi.string().min(1).optional(),
  first_name:            Joi.string().min(1).optional(),
  middle_name:           Joi.string().optional().allow(''),
  relationship:          Joi.string().optional(),
  email:                 Joi.string().email().optional().allow(''),
  phone:                 Joi.string().optional().allow(''),
  is_emergency_contact:  Joi.boolean().optional(),
  home_address:          Joi.string().optional().allow(''),
  // Giving an existing guardian a parent portal login. Without these keys
  // stripUnknown dropped them, so the edit saved and answered "Guardian
  // updated." while no account was ever created.
  ...portalAccountShape(Joi.boolean().optional()),
})

// ── Helper: get student with guardians ───────────────────────
//
// `includeArchived` is for admins opening a learner from the Archived tab. An
// archived record keeps its grades, attendance and behaviour logs, so the detail
// page has to stay reachable — otherwise archiving a graduate would make the very
// history the archive exists to preserve unviewable. Teachers and parents never
// pass it: an archived learner is off the roll and off their lists.
const getStudentWithGuardians = async (id, { includeArchived = false } = {}) => {
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
         'is_emergency_contact', ps.is_emergency_contact,
         'has_account',          (ps.parent_id IS NOT NULL),
         'home_address',         ps.home_address,
         -- Parent/Guardian Account Access. The five display states are derived
         -- from these by resolveParentAccess() rather than stored, so the
         -- account's own status and its newest invitation cannot disagree.
         'account_status',       pu.account_status,
         'has_password',         (pu.password_hash IS NOT NULL),
         'invitation',           CASE WHEN inv.invited_at IS NULL THEN NULL ELSE json_build_object(
                                   'invited_at',      inv.invited_at,
                                   'invited_by_name', inv.invited_by_name,
                                   'expires_at',      inv.expires_at,
                                   'consumed_at',     inv.consumed_at,
                                   'revoked_at',      inv.revoked_at,
                                   'has_live_code',   inv.has_live_code,
                                   'code_expires_at', inv.code_expires_at
                                 ) END,
         -- The other learners this parent's account also covers. Name, contact
         -- details and address are shared across all of them, so an admin
         -- editing one entry has to be told whose records the save also changes.
         'other_learners',       (SELECT COALESCE(json_agg(json_build_object(
                                           'id', os.id,
                                           'name', os.surname || ', ' || os.first_name,
                                           'grade_level', os.grade_level
                                         ) ORDER BY os.surname, os.first_name), '[]'::json)
                                    FROM parent_student o
                                    JOIN students os ON os.id = o.student_id
                                   WHERE ps.parent_id IS NOT NULL
                                     AND o.parent_id = ps.parent_id
                                     AND o.student_id <> ps.student_id)
       ) ORDER BY ps.is_emergency_contact DESC, ps.created_at ASC) FILTER (WHERE ps.id IS NOT NULL), '[]') AS guardians,
       -- The class adviser, resolved from the learner's snapshot. grade_level
       -- and section on students ARE the active year's snapshot, so the section
       -- they name can only be looked up in the active year -- pairing them
       -- with any other year's sections would answer a different question.
       -- Comes back NULL for an archived learner, or one whose snapshot names a
       -- section the active year does not have; Student Detail renders that as
       -- an em dash rather than inventing an adviser.
       --
       -- A correlated subquery rather than a LEFT JOIN LATERAL: json has no
       -- equality operator, so a lateral's output cannot go in the GROUP BY
       -- below. Referencing s.grade_level/s.section ungrouped is legal because
       -- s.id is the primary key and every other s column is functionally
       -- dependent on it -- the same rule that lets SELECT s.* work here.
       (SELECT json_build_object(
                 'id',          u.id,
                 'surname',     u.surname,
                 'first_name',  u.first_name,
                 'middle_name', u.middle_name,
                 'is_active',   u.is_active
               )
          FROM sections sec
          JOIN school_years sy ON sy.id = sec.school_year_id AND sy.is_active = TRUE
          JOIN users u         ON u.id  = sec.adviser_id
         WHERE sec.is_active = TRUE
           AND sec.grade_level = s.grade_level
           AND sec.name        = s.section
         LIMIT 1) AS adviser
     FROM students s
     LEFT JOIN parent_student ps ON ps.student_id=s.id
     LEFT JOIN users pu          ON pu.id = ps.parent_id
     -- The newest invitation for that account, whatever became of it. A
     -- lateral rather than a join because only the latest row matters and
     -- consumed/revoked ones are kept as history.
     LEFT JOIN LATERAL (
       SELECT pi.invited_at, pi.expires_at, pi.consumed_at, pi.revoked_at, pi.code_expires_at,
              (pi.code_hash IS NOT NULL AND pi.code_expires_at > NOW()) AS has_live_code,
              ib.full_name AS invited_by_name
         FROM account_invitations pi
         LEFT JOIN users ib ON ib.id = pi.invited_by
        WHERE pi.user_id = ps.parent_id
        ORDER BY pi.invited_at DESC
        LIMIT 1
     ) inv ON TRUE
     WHERE s.id=$1${includeArchived ? '' : ' AND s.is_active=TRUE'}
     GROUP BY s.id`,
    [id]
  )
  return decorateGuardians(result.rows[0] || null)
}

/**
 * What a viewer may see of a learner's guardians.
 *
 * `other_learners` names every learner on a parent's account, so it is removed
 * for teachers and parents — a parent reading their own child's record must not
 * learn the names of the other parent's children from another relationship —
 * and a scoped admin sees only siblings inside their own grade scope, the rest
 * counted but not named (the same redaction the adviser conflict message uses).
 */
const presentStudent = (student, role) => {
  if (!student) return student
  for (const g of student.guardians || []) {
    if (!isAnyAdmin(role)) { delete g.other_learners; continue }
    if (isScopedAdmin(role)) {
      g.other_learners = (g.other_learners || []).map(o => canManageGrade(role, o.grade_level)
        ? o : { id: null, name: null, grade_level: null, out_of_scope: true })
    }
  }
  return student
}

/**
 * Attach the derived access state to each guardian.
 *
 * Done here, in JS, rather than in SQL: resolveParentAccess() is mirrored on
 * the frontend, and a second implementation in SQL would be a third place for
 * the same five states to drift apart.
 */
const decorateGuardians = (student) => {
  if (!student || !Array.isArray(student.guardians)) return student
  student.guardians = student.guardians.map((g) => ({
    ...g,
    access: resolveParentAccess({
      hasAccount: g.has_account,
      accountStatus: g.account_status,
      invitation: g.invitation,
    }),
  }))
  return student
}

// Portal accounts go through utils/parentInvitations.js — grantParentAccess()
// replaced the old ensureParentAccount(), which hashed a password the admin had
// typed. The rules it inherited are unchanged (an email is one login; a staff
// email is refused; the lookup is case-insensitive); what it no longer does is
// accept a password from anyone but the parent.

// ── Helper: refuse a parent account's email on a separate guardian ──
//
// One rule for every place an admin types a guardian's email: an address that
// belongs to a parent account can never be saved on a separate guardian entry.
// The only ways forward are to clear it or to link that account — "Already has
// a parent account", or the form's "Link that account instead" — where the
// account supplies the name, email and phone.
//
// It used to link automatically when the typed name matched. That kept the
// typed details on this learner's entry while the account and its other
// learners kept theirs, so a different phone number typed into "New guardian"
// quietly forked the parent's record. Linking is now always explicit, and a
// real change to the parent's details goes through Edit, which reaches every
// learner on the account.
//
// The refusal names no one. A staff address is left alone: it can be a plain
// contact email, and the invitation paths refuse it on their own.
const refuseParentAccountEmail = async (client, email) => {
  if (!email) return
  const r = await client.query(
    "SELECT 1 FROM users WHERE LOWER(email)=LOWER($1) AND role='parent' LIMIT 1", [email]
  )
  if (r.rows.length) throw new AppError('This email already has a parent account. Link that account instead of entering the guardian separately.', 409)
}

// ── Helper: one email means one person ────────────────────────
//
// refuseParentAccountEmail() above covers an address that already has an
// ACCOUNT. This covers the other half — an address already typed on a
// contact-only guardian, which lives on parent_student and was checked nowhere:
//
//   same learner   two entries claiming one address. Refused, which is what the
//                  batch upload has always done for a sheet ("listed twice for
//                  LRN …"); the three entry points simply disagreed.
//   any learner    the same address under a DIFFERENT name. Refused, because it
//                  is either a typo or two people sharing a mailbox, and the
//                  first invitation would mint an account under one of the two
//                  names and strand the other entry — with no way to tell later
//                  which learner the account's holder actually belongs to.
//
// The same address under the SAME name on another learner is exactly one parent
// entered on each of their children, and stays allowed; linkContactEntriesForAccount()
// gathers those the moment an account exists.
//
// Neither refusal names anyone: typing an address must not reveal whose it is.
const assertGuardianEmailFree = async (client, { studentId, email, surname, first_name, exceptRowId = null }) => {
  if (!email) return
  const r = await client.query(
    `SELECT student_id, surname, first_name
       FROM parent_student
      WHERE LOWER(email) = LOWER($1) AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [email, exceptRowId]
  )
  for (const row of r.rows) {
    if (studentId && row.student_id === studentId) {
      throw new AppError('Another guardian of this learner already uses this email.', 409)
    }
    if (!sameName(row.surname, surname) || !sameName(row.first_name, first_name)) {
      throw new AppError('This email is already used by a guardian with a different name. Check the email.', 409)
    }
  }
}

// ── Helper: insert guardian row ───────────────────────────────
// Returns { parentId, account }: `account` is grantParentAccess's answer
// ({id, outcome}) when portal access was asked for, null otherwise.
// `actorId` is the admin doing the inviting, stamped on the invitation so the
// UI can say who authorized the address.
const insertGuardian = async (client, studentId, g, actorId = null) => {
  const { surname, first_name, middle_name } = normaliseName(g)
  let parentId = null

  // Priority 1: link to existing parent account directly
  if (g.link_parent_id) {
    parentId = g.link_parent_id
    // Pull contact info from the existing user account. role='parent' is not
    // optional: without it an id that was not a parent account fell through to
    // the plain insert below with parentId still set, so any user id — a
    // teacher's, an admin's — could be attached as a learner's parent.
    const existing = await client.query(
      "SELECT surname, first_name, middle_name, email, phone FROM users WHERE id=$1 AND role='parent'",
      [g.link_parent_id]
    )
    if (!existing.rows.length) {
      throw new AppError('That parent account could not be found. Search for it again.', 422)
    }
    const u = existing.rows[0]
    await client.query(
      `INSERT INTO parent_student
         (parent_id, student_id, surname, first_name, middle_name, email, phone, relationship, is_emergency_contact, home_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING`,
      [parentId, studentId, u.surname, u.first_name, u.middle_name,
       u.email, u.phone, g.relationship,
       g.is_emergency_contact ?? false, g.home_address || null]
    )
    return { parentId, account: null }
  }

  let account = null
  // A parent account's email on a new guardian is refused, invited or not —
  // linking an existing account is link_parent_id above, and only that. The
  // second guard covers an address already typed on another guardian; inside a
  // create-student payload the rows insert one after another in this same
  // transaction, so the second one sees the first without any extra check.
  await refuseParentAccountEmail(client, g.email)
  await assertGuardianEmailFree(client, { studentId, email: g.email, surname, first_name })
  if (g.invite && g.email) {
    account = await grantParentAccess(client, {
      email: g.email, surname, first_name, middle_name, phone: g.phone, invitedBy: actorId,
    })
    parentId = account.id
  }

  await client.query(
    `INSERT INTO parent_student
       (parent_id, student_id, surname, first_name, middle_name, email, phone, relationship, is_emergency_contact, home_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [parentId, studentId, surname, first_name, middle_name || null,
     g.email || null, g.phone || null, g.relationship,
     g.is_emergency_contact ?? false, g.home_address || null]
  )
  return { parentId, account }
}

// GET /api/students/parents/search?q=juan — search existing parent accounts
router.get('/parents/search', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { q = '', student_id } = req.query
    if (!q.trim()) return res.json({ parents: [] })
    // Optional: the learner a guardian is being added to, so a parent who already
    // looks after them can be marked rather than offered and then refused.
    const forStudent = /^[0-9a-f-]{36}$/i.test(String(student_id || '')) ? student_id : null

    const result = await query(
      `SELECT u.id, u.surname, u.first_name, u.middle_name, u.full_name,
              u.email, u.phone, u.account_status,
              MAX(ps.home_address) AS home_address,
              COUNT(ps.student_id) AS linked_students,
              COALESCE(BOOL_OR(ps.student_id = $2::uuid), FALSE) AS already_linked
       FROM users u
       LEFT JOIN parent_student ps ON ps.parent_id = u.id
       WHERE u.role = 'parent'
         AND (u.full_name ILIKE $1 OR u.email ILIKE $1 OR u.surname ILIKE $1 OR u.first_name ILIKE $1)
       GROUP BY u.id
       ORDER BY u.surname, u.first_name
       LIMIT 10`,
      [`%${q.trim()}%`, forStudent]
    )
    res.json({ parents: result.rows })
  } catch (err) { next(err) }
})

// ── The Parents tab in Account Management ────────────────────────────────
//
// `/parents/search` above answers "which account is this?" for a picker and so
// needs a query and caps at 10. The tab needs the opposite: the whole roster,
// with each account's children and its derived access state, which is what the
// two routes below are for. They live here rather than in account.routes.js
// because everything they build on is here — `insertGuardian()`, the email
// guards, and the invitation lateral.
//
// Access state is DERIVED (utils/parentAccess.js), not stored, so it cannot be
// a WHERE clause: the rows are resolved in JS and filtered after. That is also
// why paging is applied here rather than in SQL. A school's parents number in
// the hundreds, so this is one cheap query; if it ever stops being one, the
// fix is a stored state column, not a cleverer filter — and that would mean two
// facts that can disagree, which is what deriving avoids.

// GET /api/students/parents?search=&state=&grade_level=&limit=&offset=
router.get('/parents', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { search = '', state = '', grade_level = '', limit = 25, offset = 0 } = req.query
    const scope = gradeScopeForRole(req.user.role)

    const result = await query(
      `SELECT u.id, u.surname, u.first_name, u.middle_name, u.full_name,
              u.email, u.phone, u.account_status, u.last_login_at,
              -- What canChangeEmail() keys on. The registered address stops
              -- being the school's to edit once the parent has set a password,
              -- and the test is that, never account_status -- a revoked account
              -- has still proved it owns the address.
              -- (No backticks in here: this is a JS template literal, and one
              -- would end the string mid-query.)
              (u.password_hash IS NOT NULL) AS has_password,
              MAX(ps.home_address) AS home_address,
              CASE WHEN inv.invited_at IS NULL THEN NULL ELSE json_build_object(
                'invited_at',      inv.invited_at,
                'expires_at',      inv.expires_at,
                'consumed_at',     inv.consumed_at,
                'revoked_at',      inv.revoked_at,
                'has_live_code',   inv.has_live_code,
                'invited_by',      inv.invited_by,
                'invited_by_name', inv.invited_by_name
              ) END AS invitation,
              COALESCE(json_agg(json_build_object(
                'student_id',           s.id,
                -- The parent_student row, which is what the invitation routes
                -- are keyed on. Access is per ACCOUNT, so any child's pair
                -- reaches it; a scoped admin only ever holds in-scope ones,
                -- which is what keeps assertStudentInScope satisfied.
                'guardian_id',          ps.id,
                'surname',              s.surname,
                'first_name',           s.first_name,
                'grade_level',          s.grade_level,
                'section',              s.section,
                'is_active',            s.is_active,
                'relationship',         ps.relationship,
                'is_emergency_contact', ps.is_emergency_contact
              ) ORDER BY s.grade_level, s.surname, s.first_name), '[]') AS children
         FROM users u
         JOIN parent_student ps ON ps.parent_id = u.id
         JOIN students s        ON s.id = ps.student_id
         LEFT JOIN LATERAL (
           SELECT pi.invited_at, pi.expires_at, pi.consumed_at, pi.revoked_at,
                  (pi.code_hash IS NOT NULL AND pi.code_expires_at > NOW()) AS has_live_code,
                  pi.invited_by, ib.full_name AS invited_by_name
             FROM account_invitations pi
             LEFT JOIN users ib ON ib.id = pi.invited_by
            WHERE pi.user_id = u.id
            ORDER BY pi.invited_at DESC, (pi.consumed_at IS NULL AND pi.revoked_at IS NULL) DESC
            LIMIT 1
         ) inv ON TRUE
        WHERE u.role = 'parent'
        GROUP BY u.id, inv.invited_at, inv.expires_at, inv.consumed_at,
                 inv.revoked_at, inv.has_live_code, inv.invited_by, inv.invited_by_name
        ORDER BY u.surname, u.first_name`
    )

    // A parent is in scope when at least ONE of their children is. The rest are
    // counted but not named — the same redaction `presentStudent()` makes, and
    // for the same reason: a scoped admin may act on the account (revoking is
    // per account, so it reaches every child) without learning who the other
    // learners are.
    const rows = []
    for (const r of result.rows) {
      const mine = r.children.filter(c => scope.includes(c.grade_level))
      if (!mine.length) continue
      rows.push({
        ...r,
        children: mine,
        other_children: r.children.length - mine.length,
        access: resolveParentAccess({
          hasAccount: true,
          accountStatus: r.account_status,
          invitation: r.invitation,
        }),
      })
    }

    // Counted over the caller's whole scope, before search and state narrow it,
    // so the chips keep their numbers while one of them is selected — the same
    // rule the Students and Enrollment pages follow.
    const summary = rows.reduce((acc, r) => {
      acc[r.access.id] = (acc[r.access.id] || 0) + 1
      return acc
    }, {})

    const q = String(search).trim().toLowerCase()
    const filtered = rows.filter((r) => {
      if (state && r.access.id !== state) return false
      if (grade_level && !r.children.some(c => c.grade_level === grade_level)) return false
      if (!q) return true
      return [r.full_name, r.email, r.phone].some(v => String(v || '').toLowerCase().includes(q))
        || r.children.some(c => `${c.surname}, ${c.first_name}`.toLowerCase().includes(q))
    })

    const from = Math.max(0, Number(offset) || 0)
    const size = Math.min(100, Math.max(1, Number(limit) || 25))
    res.json({
      parents: filtered.slice(from, from + size),
      total: filtered.length,
      all_total: rows.length,
      summary,
    })
  } catch (err) { next(err) }
})

// POST /api/students/parents — create an account and its children together.
//
// The children are part of the CREATE, never a step after it. A `users` row with
// no `parent_student` row is a state nothing else in the app can express: the
// parent would sign in to an empty app, appear on no learner's record, and be
// hard-deleted by `DELETE /guardians/:guardianId`, which removes a parent left
// with no learners. So `children` is `.min(1)` and the whole thing is one
// transaction — the account and every link land together or not at all.
//
// `invite` is not a choice here. An account exists only because an email was
// authorized, so creating one without inviting would ask for a row the model
// has no state for; the form says so rather than offering a switch.
const parentChildSchema = Joi.object({
  student_id:           Joi.string().uuid().required(),
  relationship:         Joi.string().max(50).required(),
  is_emergency_contact: Joi.boolean().default(false),
})
const createParentSchema = Joi.object({
  surname:     Joi.string().trim().required(),
  first_name:  Joi.string().trim().required(),
  middle_name: Joi.string().trim().optional().allow(''),
  phone:       Joi.string().pattern(/^\+63 9\d{2} \d{7}$/).required()
    .messages({ 'string.pattern.base': 'phone must be a PH mobile number (+63 9XX XXXXXXX)' }),
  email:       Joi.string().email().trim().required(),
  children:    Joi.array().items(parentChildSchema).min(1).max(10).required()
    .messages({ 'array.min': 'Add at least one child — an account with no learner cannot exist.' }),
})

router.post('/parents', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = createParentSchema.validate(req.body, { abortEarly: false, stripUnknown: true })
    if (error) throw new AppError(error.details.map(d => d.message).join('; '), 422)

    const ids = value.children.map(c => c.student_id)
    if (new Set(ids).size !== ids.length) {
      throw new AppError('The same learner is listed twice.', 422)
    }

    const learners = await query(
      `SELECT id, surname, first_name, grade_level, home_address
         FROM students WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
      [ids]
    )
    if (learners.rows.length !== ids.length) {
      throw new AppError('One of the learners no longer exists or has been archived.', 404)
    }
    // Per learner, not once: attaching a child is a write on that learner's
    // record, so each one has to be inside the caller's grade scope.
    for (const s of learners.rows) enforceGradeScope(req, s.grade_level)
    const byId = new Map(learners.rows.map(s => [s.id, s]))

    const out = await withTransaction(async (client) => {
      let parentId = null
      let account = null
      for (const [i, c] of value.children.entries()) {
        const learner = byId.get(c.student_id)
        const shared = {
          relationship:         c.relationship,
          is_emergency_contact: c.is_emergency_contact,
          home_address:         learner.home_address,
        }
        // The first child creates the account — `insertGuardian()`'s non-link
        // path runs refuseParentAccountEmail() and assertGuardianEmailFree()
        // first, so a taken address is refused here with the same wording every
        // other surface uses. The rest link to what it returned.
        const g = i === 0
          ? { ...shared, surname: value.surname, first_name: value.first_name,
              middle_name: value.middle_name, email: value.email, phone: value.phone, invite: true }
          : { ...shared, link_parent_id: parentId }
        const r = await insertGuardian(client, c.student_id, g, req.user.id)
        if (i === 0) { parentId = r.parentId; account = r.account }
      }
      return { parentId, account }
    })

    const names = learners.rows.map(s => `${s.surname}, ${s.first_name}`)
    // The invitation rides back so the dashboard can show the same "Invitation
    // created" confirmation a teacher or admin invite gets — status, open-until
    // date and the steps to hand over.
    const invitation = await latestInvitation({ query }, out.parentId)
    res.status(201).json({
      parent_id: out.parentId,
      parent: {
        id: out.parentId, surname: value.surname, first_name: value.first_name,
        email: value.email, role: 'parent', has_password: false,
        account_status: 'pending', invitation,
      },
      message: `${value.surname}, ${value.first_name} was added as a guardian of ${names.join(' and ')}. `
             + `${value.email} is authorized for the VISTA Parent app — they activate it themselves from the app.`,
    })
  } catch (err) { next(err) }
})

// "Not enrolled" as the Students page shows it.
//
// It is not a stored value and must not become one: a learner is not enrolled for
// a school year when they have **no `student_enrollments` row** for it, and the
// Enrollment page has always read it that way. The snapshot cannot say it on its
// own — `rolloverStudents()` writes 'pending' both for a learner who has a pending
// record and for one who has no record at all, so the Students page showed the two
// as the same Pending badge and the difference was invisible outside Enrollment.
//
// Deriving it keeps one source of truth. The rule is narrow on purpose: only a
// 'pending' snapshot can be reinterpreted, because that is the only value the
// rollover invents. Every other value was recorded about the learner and stays
// exactly what it says — and `PATCH /:id/enrollment-status` upserts the active
// year's record, so confirming a not-enrolled learner turns the badge into a real
// Pending or Enrolled rather than leaving the two out of step.
//
// With no active school year nothing is reinterpreted: the join would match
// nothing and every pending learner would read as not enrolled.
const ACTIVE_SY_JOIN = `
         LEFT JOIN student_enrollments act
                ON act.student_id = s.id
               AND act.school_year_id = (SELECT id FROM school_years WHERE is_active=TRUE LIMIT 1)`

const STATUS_DISPLAY = `
         CASE WHEN s.enrollment_status = 'pending'
                   AND act.id IS NULL
                   AND EXISTS (SELECT 1 FROM school_years WHERE is_active=TRUE)
              THEN 'none' ELSE s.enrollment_status END`

// GET /api/students
router.get('/', async (req, res, next) => {
  try {
    const { grade_level, section, search, enrollment_status, page=1, limit=20 } = req.query
    const offset = (page-1)*limit
    const params = []

    // Active / Archived is its own axis, not a status. An archived learner still
    // carries whatever enrolment status they had when they came off the roll — a
    // graduate reads "Graduated" in the Archived tab — so the two filters stack
    // rather than competing for one dropdown.
    //
    // Only admins may look at the archive: teachers and parents are pinned to the
    // active roll alongside the `enrolled` clause below, which is the same rule
    // stated twice about the same people.
    const archived = isAnyAdmin(req.user.role) ? (req.query.archived || 'false') : 'false'
    const conditions = []

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

    // Snapshot before *either* of the two view filters is applied. `archived_count`
    // has to survive being on the Archived tab and `by_status` has to survive a
    // status being selected, so each is counted over the shared filters plus only
    // the other one's clause.
    const sharedConditions = [...conditions]
    const sharedParams     = [...params]

    if (archived === 'true')     conditions.push('s.is_active=FALSE')
    else if (archived !== 'all') conditions.push('s.is_active=TRUE')

    // Status breakdown respects the tab: "9 enrolled" on the Active tab means
    // nine learners on the roll, not nine including archived graduates.
    const unstatusedConditions = [...conditions]
    const unstatusedParams     = [...params]

    // Filtered on the *displayed* status rather than the column, so picking
    // "Not enrolled" returns exactly the rows wearing that badge — and picking
    // "Pending" no longer returns them too.
    if (enrollment_status) { params.push(enrollment_status); conditions.push(`(${STATUS_DISPLAY}) = $${params.length}`) }

    // `archived=all` can leave an admin with no filters at all, and `WHERE` with
    // nothing after it is a syntax error — before this the hardcoded
    // `s.is_active=TRUE` guaranteed there was always at least one clause.
    const clause = (arr) => arr.length ? `WHERE ${arr.join(' AND ')}` : ''

    const where = clause(conditions)
    params.push(limit, offset)

    const [rows, count] = await Promise.all([
      query(
        `SELECT s.id, s.lrn, s.surname, s.first_name, s.middle_name, s.full_name,
                s.date_of_birth, s.gender, s.grade_level, s.section, s.enrollment_status,
                s.profile_photo_url, s.home_address, s.created_at,
                s.is_active, s.archived_at, s.archived_reason,
                arch.full_name AS archived_by_name,
                (${STATUS_DISPLAY}) AS status_display
         FROM students s ${join}
         LEFT JOIN users arch ON arch.id = s.archived_by
         ${ACTIVE_SY_JOIN}
         ${where}
         ORDER BY s.surname, s.first_name
         LIMIT $${params.length-1} OFFSET $${params.length}`, params),
      query(`SELECT COUNT(*) FROM students s ${join} ${ACTIVE_SY_JOIN} ${where}`, params.slice(0,-2))
    ])

    // Status breakdown over the same filters *except* the status filter itself,
    // so the header can report "N enrolled / M pending" and the status tabs keep
    // showing their counts while one of them is selected.
    const [byStatus, archivedCount] = await Promise.all([
      query(
        `SELECT (${STATUS_DISPLAY}) AS enrollment_status, COUNT(*)::int AS count
         FROM students s ${join} ${ACTIVE_SY_JOIN} ${clause(unstatusedConditions)} GROUP BY 1`,
        unstatusedParams
      ),
      // The number on the Archived tab, counted over the shared filters only, so
      // the tab keeps its count while it is the tab you are standing on.
      isAnyAdmin(req.user.role)
        ? query(
            `SELECT COUNT(*)::int AS n FROM students s ${join} ${ACTIVE_SY_JOIN}
             ${clause([...sharedConditions, 's.is_active=FALSE'])}`,
            sharedParams
          )
        : Promise.resolve({ rows: [{ n: 0 }] }),
    ])

    res.json({
      students: rows.rows,
      by_status: Object.fromEntries(byStatus.rows.map(r => [r.enrollment_status, r.count])),
      archived_count: archivedCount.rows[0].n,
      pagination: { total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(count.rows[0].count/limit) }
    })
  } catch (err) { next(err) }
})

// GET /api/students/:id
router.get('/:id', async (req, res, next) => {
  try {
    // Admins can open an archived learner — that is the whole point of an archive
    // rather than a deletion, and the Archived tab links straight here. Teachers
    // and parents still get a 404: an archived learner is off their lists.
    const student = await getStudentWithGuardians(req.params.id, {
      includeArchived: isAnyAdmin(req.user.role),
    })
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

    presentStudent(student, req.user.role)

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
// Safety surfaces (attendance, behavior, risk) stay visible.
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

    // `students_lrn_key` is UNIQUE across the whole table, archived rows included,
    // so this check is right to ignore `is_active` — but a bare "already exists"
    // was a dead end when the holder was archived and therefore invisible
    // everywhere. Name that case and hand back the id so the client can offer to
    // restore the record instead of asking for an LRN that cannot be freed.
    const dup = await query(
      'SELECT id, full_name, is_active FROM students WHERE lrn=$1', [data.lrn]
    )
    if (dup.rows.length) {
      const held = dup.rows[0]
      if (held.is_active) throw new AppError('A student with this LRN already exists.', 409)
      throw new AppError(
        `This LRN belongs to ${held.full_name}, whose record is archived. Restore that record instead of adding a new one.`,
        409,
        { archived_student_id: held.id, archived_student_name: held.full_name }
      )
    }

    const activeSY = await requireActiveSYId()

    const student = await withTransaction(async (client) => {
      const sRes = await client.query(
        `INSERT INTO students (lrn, surname, first_name, middle_name, date_of_birth, gender, grade_level, section, profile_photo_url, home_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, grade_level, section`,
        [data.lrn, surname, first_name, middle_name||null, data.date_of_birth,
         data.gender, data.grade_level, data.section||null, data.profile_photo_url||null, data.home_address||null]
      )
      await enrollForActiveYear(client, activeSY, sRes.rows[0])
      for (const g of guardians) await insertGuardian(client, sRes.rows[0].id, g, req.user.id)
      return await getStudentWithGuardians(sRes.rows[0].id)
    })

    res.status(201).json({ message: 'Student added successfully.', student: presentStudent(student, req.user.role) })
  } catch (err) { next(err) }
})

// POST /api/students/check-lrns — admin-only. Given { lrns: [...] } returns
// { existing: [...] } for LRNs already taken, and { archived: [...] } for the
// subset held by archived learners. Used by the batch-upload preview so clashes
// surface before submit.
//
// It used to filter `is_active = TRUE`, which made the preview disagree with the
// thing it previews: `POST /bulk` matches on `lrn = ANY(...)` with no such filter,
// because `students_lrn_key` is UNIQUE across the whole table. An LRN held by an
// archived learner therefore passed the preview and then failed the upload. The
// `archived` split is what the preview needs to say something useful about it —
// those rows are restorable, not duplicates to be renumbered.
// POST /api/students/guardian-email-check — { email, surname, first_name, student_id? }
//
// The early warning behind a guardian's email field (Manage Guardians and the
// Add Student wizard). It answers what SAVING would do, and says nothing about
// whose an address is:
//
//   available         nothing else uses it
//   restricted        not usable for app access (staff); fine as a contact email
//   parent_account    a parent account uses it — save refuses; `account` is
//                     returned so the form can offer "Link that account instead"
//   already_guardian  that account already looks after student_id — save refuses,
//                     and there is nothing left to link
//   duplicate_on_learner  another guardian of student_id already uses it
//   name_conflict     another guardian anywhere uses it under a different name
//
// Names are not compared: any parent account's email is refused on a separate
// guardian (refuseParentAccountEmail(), which the save enforces), so the answer
// does not depend on them. Returning `account` discloses nothing an admin could
// not already get by searching the email under "Already has a parent account";
// no reply puts an owner's name into a message.
router.post('/guardian-email-check', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      email:      Joi.string().email().required(),
      surname:    Joi.string().allow('').optional(),
      first_name: Joi.string().allow('').optional(),
      student_id: Joi.string().uuid().allow(null, '').optional(),
    }).validate(req.body || {}, { stripUnknown: true })
    if (error) return res.json({ status: 'available' })

    const r = await query(
      `SELECT u.id, u.role, u.surname, u.first_name, u.middle_name, u.full_name, u.email, u.phone,
              u.account_status,
              (SELECT COUNT(*)::int FROM parent_student WHERE parent_id=u.id) AS linked_students,
              (SELECT ps.home_address FROM parent_student ps
                WHERE ps.parent_id=u.id AND ps.home_address IS NOT NULL
                ORDER BY ps.created_at DESC LIMIT 1) AS home_address,
              ($2::uuid IS NOT NULL AND EXISTS (
                SELECT 1 FROM parent_student WHERE parent_id=u.id AND student_id=$2::uuid)) AS already_linked
         FROM users u
        WHERE LOWER(u.email)=LOWER($1)
        LIMIT 1`,
      [value.email.trim(), value.student_id || null]
    )
    const u = r.rows[0]
    if (u && u.role !== ROLES.PARENT) return res.json({ status: 'restricted' })
    if (u && u.already_linked) return res.json({ status: 'already_guardian' })
    if (u) {
      const { role, already_linked, ...account } = u
      return res.json({ status: 'parent_account', account })
    }

    // No account holds it; another guardian entry still might. Mirrors
    // assertGuardianEmailFree(), which is what the save enforces.
    const others = await query(
      `SELECT student_id, surname, first_name FROM parent_student WHERE LOWER(email) = LOWER($1)`,
      [value.email.trim()]
    )
    for (const row of others.rows) {
      if (value.student_id && row.student_id === value.student_id) {
        return res.json({ status: 'duplicate_on_learner' })
      }
      if (!sameName(row.surname, value.surname) || !sameName(row.first_name, value.first_name)) {
        return res.json({ status: 'name_conflict' })
      }
    }
    res.json({ status: 'available' })
  } catch (err) { next(err) }
})

router.post('/check-lrns', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const lrns = Array.isArray(req.body?.lrns) ? req.body.lrns : []
    const clean = [...new Set(lrns.map(x => String(x).trim()).filter(x => /^\d{12}$/.test(x)))]
    if (!clean.length) return res.json({ existing: [], archived: [] })
    const r = await query(
      'SELECT lrn, is_active FROM students WHERE lrn = ANY($1::text[])',
      [clean]
    )
    res.json({
      existing: r.rows.map(row => row.lrn),
      archived: r.rows.filter(row => !row.is_active).map(row => row.lrn),
    })
  } catch (err) { next(err) }
})

// Parent accounts by email, case-insensitively, keyed on the lowercased email.
// `home_address` is the most recent one recorded against any of their children,
// since users carries no address of its own.
const findParentAccountsByEmail = async (emails) => {
  const clean = [...new Set(emails.map(e => String(e ?? '').trim().toLowerCase()).filter(Boolean))]
  if (!clean.length) return new Map()
  const r = await query(
    `SELECT DISTINCT ON (LOWER(u.email))
            u.id, u.email, u.surname, u.first_name, u.middle_name, u.phone,
            (SELECT ps.home_address FROM parent_student ps
              WHERE ps.parent_id = u.id AND ps.home_address IS NOT NULL
              ORDER BY ps.created_at DESC LIMIT 1) AS home_address
       FROM users u
      WHERE u.role = 'parent' AND LOWER(u.email) = ANY($1::text[])
      ORDER BY LOWER(u.email), u.created_at`,
    [clean]
  )
  return new Map(r.rows.map(row => [row.email.toLowerCase(), row]))
}

const sameName = (a, b) =>
  String(a ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

// Phones reach here as `+63 9XX XXXXXXX`, but compared on digits alone so the
// rule is about the number rather than how it was punctuated.
const samePhone = (a, b) =>
  String(a ?? '').replace(/\D/g, '') === String(b ?? '').replace(/\D/g, '')

// The stored spelling of a grade level, from any casing or spacing, or null if
// it names none. Canonicalising rather than accepting loosely is the point:
// `students.grade_level` is matched as a plain string by every roster query in
// Node and FastAPI, so a row stored as "grade 1" belongs to no grade level at
// all. Used by the batch upload, whose values are typed into Excel by hand.
const canonicalGrade = (v) => {
  const k = String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  return ALL_GRADES.find(g => g.toLowerCase() === k) ?? null
}

// A guardian row naming a parent account takes its identity from the account.
// A name typed beside the email must agree with it: a mistyped email that
// happens to match another family would otherwise give a stranger this learner
// in their parent app.
const guardianAccountMismatch = (g, account) =>
  (g.surname && !sameName(g.surname, account.surname)) || (g.first_name && !sameName(g.first_name, account.first_name))

// POST /api/students/check-parent-emails — { emails } → { parents: [...] }.
// The batch-upload preview uses it to fill a guardian row in from the account
// its email belongs to. Same fields `GET /parents/search` already shows admins.
router.post('/check-parent-emails', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const emails = Array.isArray(req.body?.emails) ? req.body.emails.slice(0, 1000) : []
    const found = await findParentAccountsByEmail(emails)
    res.json({
      parents: [...found.values()].map(({ email, surname, first_name, middle_name, phone, home_address }) =>
        ({ email, surname, first_name, middle_name, phone, home_address })),
    })
  } catch (err) { next(err) }
})

// POST /api/students/bulk — admin-only batch upload. Guardians come from the
// template's second sheet, grouped under their learner by the client.
//
// No row can carry a password — there is no password key and never will be, so
// a spreadsheet never holds plain-text credentials for real families. That was
// the whole reason this path refused to grant portal access at all; an
// invitation has no password, so a row may now set `invite` to authorize its
// email, and the guardian still proves they control it before anything
// activates. A row whose email belongs to an existing *parent* account is
// linked to that account and takes its name and phone from it, so only
// relationship and the two flags are needed; any other row needs a name and
// phone of its own.
const bulkGuardianSchema = Joi.object({
  surname:              Joi.string().trim().optional().allow(''),
  first_name:           Joi.string().trim().optional().allow(''),
  middle_name:          Joi.string().trim().optional().allow(''),
  relationship:         Joi.string().max(50).required(),
  email:                Joi.string().email().optional().allow(''),
  phone:                Joi.string().pattern(/^\+63 9\d{2} \d{7}$/).optional().allow('')
    .messages({ 'string.pattern.base': 'phone must be a PH mobile number (+63 9XX XXXXXXX)' }),
  home_address:         Joi.string().trim().optional().allow(''),
  is_emergency_contact: Joi.boolean().required(),
  // A spreadsheet could never create logins before, and the reason was the
  // password: it would have meant plain-text family passwords in a file that
  // gets emailed around. An invitation carries no password, so the sheet can
  // authorize an address — and the guardian still has to prove they control it
  // before anything is activated. `create_account`/`password` stay absent, so
  // stripUnknown drops them from any client that still sends them.
  invite:               Joi.boolean().default(false),
})
const bulkStudentSchema = studentSchema.keys({
  guardians: Joi.array().items(bulkGuardianSchema).max(10).default([]),
})
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

    // A spreadsheet is typed by hand, so a grade level arrives in any case and
    // with any spacing. It is corrected here, before anything reads it: the
    // scope check below compares against the ladder, and `students.grade_level`
    // is a bare string every roster query matches on — so an uncorrected
    // "grade 1" tells a scoped admin their own grade is outside their scope,
    // and for a super admin stores a grade level nothing in the app lists.
    rows.forEach((r, i) => {
      const g = canonicalGrade(r.grade_level)
      if (!g) throw new AppError(`Row ${i + 1}: "${r.grade_level}" isn't a grade level. Use one of ${ALL_GRADES.join(', ')}.`, 422)
      r.grade_level = g
    })

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
      // One email twice on one learner is a typo, and if it matches a parent
      // account the second row would trip UNIQUE(parent_id, student_id) as a raw
      // "Record already exists." with nothing naming the learner.
      const emails = new Set()
      for (const g of rows[i].guardians) {
        const e = (g.email || '').trim().toLowerCase()
        if (!e) continue
        if (emails.has(e)) {
          throw new AppError(`Row ${i + 1}: guardian email ${g.email} is listed twice for LRN ${rows[i].lrn}.`, 422)
        }
        emails.add(e)
      }
    }

    const existing = await query(
      'SELECT lrn, is_active FROM students WHERE lrn = ANY($1::text[])',
      [rows.map(r => r.lrn)]
    )
    if (existing.rows.length) {
      // Split the message the same way `check-lrns` splits its response: an
      // archived holder is restorable, so telling an admin it "already exists"
      // sends them looking for a learner no list shows.
      const archived = existing.rows.filter(r => !r.is_active).map(r => r.lrn)
      const live     = existing.rows.filter(r =>  r.is_active).map(r => r.lrn)
      throw new AppError(
        [
          live.length     && `These LRNs already exist: ${live.join(', ')}`,
          archived.length && `These belong to archived students and can be restored instead: ${archived.join(', ')}`,
        ].filter(Boolean).join('. '),
        409
      )
    }

    // Validate (grade_level, section) against sections defined for the active
    // school year. Empty section is allowed (mirrors single-student POST).
    const activeSY = await requireActiveSYId()
    await assertSectionsExist(activeSY, rows, (_r, i) => `Row ${i + 1}`)

    const accounts = await findParentAccountsByEmail(rows.flatMap(r => r.guardians.map(g => g.email)))
    const accountFor = (g) => (g.email ? accounts.get(g.email.trim().toLowerCase()) : undefined)

    // The sheet may introduce a parent **once** and refer to them by email
    // alone on every other learner — the same courtesy it already extends to an
    // address that has an account. A row carrying the full set (surname, first
    // name, phone) claims that address for the file; rows with only the email
    // inherit from it. Collected file-wide rather than in sheet order, so the
    // detailed row can sit under any learner, not necessarily the first.
    const fileParents = new Map()
    rows.forEach(r => r.guardians.forEach((g) => {
      const key = String(g.email || '').trim().toLowerCase()
      if (!key || accountFor(g) || fileParents.has(key)) return
      if (g.surname && g.first_name && g.phone) fileParents.set(key, g)
    }))
    const fileParentFor = (g) => {
      const key = String(g.email || '').trim().toLowerCase()
      return key ? fileParents.get(key) : undefined
    }

    const guardianProblems = []
    rows.forEach((r, i) => r.guardians.forEach((g) => {
      const who = `Row ${i + 1} (LRN ${r.lrn}) guardian ${g.email || [g.surname, g.first_name].filter(Boolean).join(', ') || '(blank)'}`
      const account = accountFor(g)
      if (account) {
        if (guardianAccountMismatch(g, account)) {
          guardianProblems.push(`${who}: the email belongs to parent account ${account.surname}, ${account.first_name}, but the name does not match`)
        }
      } else if (fileParentFor(g)) {
        // Detailed on another row of this file; the fill below completes it.
      } else if (!g.surname || !g.first_name || !g.phone) {
        guardianProblems.push(`${who}: surname, first name and phone are required unless the email belongs to a parent account or is detailed on another row`)
      }
    }))

    // One email is one person, inside the file as well — so every row that says
    // who that person is has to agree. The same address under two names is a
    // typo or two people sharing a mailbox, and the first invitation would mint
    // an account under one of them and strand the other; **the phone follows
    // the same rule**, because the account is created from whichever row the
    // loop reaches first and every later row of that email then takes the link
    // path, which copies the account's number — so a second, different number
    // was silently discarded while the preview still showed it. The same
    // address under the same details on several learners is one parent entered
    // on each of their children, which is ordinary and stays allowed.
    //
    // Each field is compared on what the rows **typed** and only where both
    // sides said something: a sparse row inherits these very values below, so
    // comparing what it resolves to would have it agree with itself. The
    // reference is tracked per field, not per row, or a first row that gave a
    // name but no phone would leave two later, conflicting phones unchecked.
    const byEmail = new Map()
    rows.forEach((r, i) => r.guardians.forEach((g) => {
      const key = String(g.email || '').trim().toLowerCase()
      if (!key) return
      const at = { row: i + 1, lrn: r.lrn }
      let grp = byEmail.get(key)
      if (!grp) { grp = { invite: false, name: null, phone: null }; byEmail.set(key, grp) }
      // Access belongs to the account, not to one child: a Yes anywhere in the
      // person's rows invites them once, and every row of theirs links to it.
      if (g.invite) grp.invite = true

      if (g.surname && g.first_name) {
        if (!grp.name) grp.name = { ...at, surname: g.surname, first_name: g.first_name }
        else if (!sameName(grp.name.surname, g.surname) || !sameName(grp.name.first_name, g.first_name)) {
          guardianProblems.push(
            `Row ${at.row} (LRN ${at.lrn}) guardian ${g.email}: the same email is used on row ${grp.name.row} (LRN ${grp.name.lrn}) under a different name`
          )
        }
      }
      if (g.phone) {
        if (!grp.phone) grp.phone = { ...at, phone: g.phone }
        else if (!samePhone(grp.phone.phone, g.phone)) {
          guardianProblems.push(
            `Row ${at.row} (LRN ${at.lrn}) guardian ${g.email}: the same email is used on row ${grp.phone.row} (LRN ${grp.phone.lrn}) with a different phone number`
          )
        }
      }
    }))
    if (guardianProblems.length) throw new AppError(guardianProblems.join('; '), 422)

    // Only now, with the disagreements reported on the values as typed, does a
    // sparse row take the rest of its identity from the row that introduced it.
    // Relationship and the two flags are never filled: they are facts about this
    // learner, not about the parent, exactly as for a linked account.
    rows.forEach(r => r.guardians.forEach((g) => {
      const src = accountFor(g) ? undefined : fileParentFor(g)
      if (!src || src === g) return
      if (!g.surname) g.surname = src.surname
      if (!g.first_name) g.first_name = src.first_name
      if (!g.middle_name) g.middle_name = src.middle_name
      if (!g.phone) g.phone = src.phone
      if (!g.home_address) g.home_address = src.home_address
    }))

    // What the loop below actually sends per row: the group's answer, not the
    // row's own, so a blank beside a Yes does not leave that learner unlinked.
    const inviteFor = (g) => {
      const key = String(g.email || '').trim().toLowerCase()
      return key ? !!byEmail.get(key)?.invite : false
    }

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
        let guardians = 0, linked = 0, invited = 0
        for (const g of r.guardians) {
          const account = accountFor(g)
          // A blank address means "lives with the learner", which is the usual
          // case and saves retyping it on every guardian row. A linked parent
          // keeps the address already on file for them, if there is one.
          const home_address = g.home_address || account?.home_address || r.home_address
          // link_parent_id makes insertGuardian copy name, email and phone from
          // the account rather than from the sheet.
          const { parentId, account: granted } = await insertGuardian(client, res.rows[0].id, account
            ? { link_parent_id: account.id, relationship: g.relationship, home_address,
                is_emergency_contact: g.is_emergency_contact }
            : { ...g, home_address, invite: inviteFor(g) }, req.user.id)
          guardians++
          if (parentId) linked++
          // An account this file has just created is an existing account for
          // every later row of that person, so they take the link path — which
          // returns before the email guards — instead of failing on the address
          // the row before them had just claimed.
          if (granted?.id && g.email) {
            accounts.set(g.email.trim().toLowerCase(), {
              id: granted.id, surname: g.surname, first_name: g.first_name,
              middle_name: g.middle_name, phone: g.phone, home_address,
            })
          }
          // Only a row that actually produced a new invitation counts. A row
          // whose email already had an active account was linked, not invited.
          if (granted && (granted.outcome === 'invited' || granted.outcome === 'reissued')) invited++
        }
        out.push({ id: res.rows[0].id, lrn: res.rows[0].lrn, guardians, linked, invited })
      }
      return out
    })

    const guardianCount = inserted.reduce((n, s) => n + s.guardians, 0)
    const linkedCount   = inserted.reduce((n, s) => n + s.linked, 0)
    const invitedCount  = inserted.reduce((n, s) => n + s.invited, 0)
    const detail = [
      linkedCount && `${linkedCount} linked to existing parent accounts`,
      invitedCount && `${invitedCount} invited to the parent portal`,
    ].filter(Boolean).join(', ')
    const message = [
      `${inserted.length} student${inserted.length === 1 ? '' : 's'} added`,
      guardianCount && `${guardianCount} guardian${guardianCount === 1 ? '' : 's'}`
        + (detail ? ` (${detail})` : ''),
    ].filter(Boolean).join(' with ') + '.'
      + (invitedCount ? ' No messages were sent — each guardian activates from the VISTA Parent app.' : '')

    res.status(201).json({ message, students: inserted })
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

    // Check duplicate LRN excluding this student. No `is_active` filter: the
    // UNIQUE constraint does not have one either, so filtering here only meant
    // the clash surfaced as a raw 23505 "Record already exists." from the error
    // handler instead of a message naming who holds it.
    if (normed.lrn) {
      const dup = await query(
        'SELECT full_name, is_active FROM students WHERE lrn=$1 AND id<>$2',
        [normed.lrn, req.params.id]
      )
      if (dup.rows.length) {
        const held = dup.rows[0]
        throw new AppError(
          held.is_active
            ? 'A student with this LRN already exists.'
            : `This LRN belongs to ${held.full_name}, whose record is archived.`,
          409
        )
      }
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

    res.json({ message: 'Student updated.', student: presentStudent(await getStudentWithGuardians(updated.id), req.user.role) })
  } catch (err) { next(err) }
})

// DELETE /api/students/:id
// ── PATCH /api/students/:id/archive ──────────────────────────
//
// Archive a learner, or restore one. `is_active=FALSE` means **off the roll**:
// the record, its grades, attendance and behaviour logs all stay, and every
// roster in the system stops listing them because they all already filter
// `s.is_active = TRUE`.
//
// This used to be `DELETE /:id`, which set the same flag and then stranded the
// record — nothing lifted `is_active=TRUE` on the roster, `GET /:id` 404'd, and
// the LRN stayed taken by a row nobody could reach. The flag was never the
// problem; the missing way back was.
//
// The three stamped columns are what makes it an archive rather than a
// disappearance, and `archived_by` carries a second meaning: NULL means the
// system filed this row when a school year was activated, not an admin.
const archiveSchema = Joi.object({
  archived: Joi.boolean().required(),
  reason:   Joi.string().trim().max(500).optional().allow(''),
})

const setArchived = async (req, res) => {
  const { error, value } = archiveSchema.validate(req.body ?? {}, { stripUnknown: true })
  if (error) throw new AppError(error.details[0].message, 422)

  // The target is archived exactly half the time, so the scope check cannot
  // filter on `is_active` the way every other one here does.
  await assertStudentInScope(req, req.params.id, { includeArchived: true })

  const r = value.archived
    ? await query(
        `UPDATE students
            SET is_active=FALSE, archived_at=NOW(), archived_by=$2, archived_reason=$3,
                updated_at=NOW()
          WHERE id=$1 RETURNING full_name`,
        [req.params.id, req.user.id, value.reason || null]
      )
    : await query(
        // Restoring clears all three: a row back on the roll must not keep
        // claiming it was archived, or the next archive reads as the first one.
        `UPDATE students
            SET is_active=TRUE, archived_at=NULL, archived_by=NULL, archived_reason=NULL,
                updated_at=NOW()
          WHERE id=$1 RETURNING full_name`,
        [req.params.id]
      )

  if (!r.rows.length) throw new AppError('Student not found.', 404)
  res.json({
    message: value.archived
      ? `${r.rows[0].full_name} archived.`
      : `${r.rows[0].full_name} restored to the active roll.`,
  })
}

router.patch('/:id/archive', authorizeAnyAdmin, async (req, res, next) => {
  try { await setArchived(req, res) } catch (err) { next(err) }
})

// Kept as an alias so nothing calling the old endpoint breaks. It archives —
// there has never been a hard delete here, only a flag with no way back.
router.delete('/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    req.body = { archived: true, reason: req.body?.reason }
    await setArchived(req, res)
  } catch (err) { next(err) }
})

// POST /api/students/:id/guardians
router.post('/:id/guardians', authorizeAnyAdmin, async (req, res, next) => {
  try {
    await assertStudentInScope(req, req.params.id)
    const { error, value } = guardianSchema.validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    let linkNote = ''
    if (value.link_parent_id) {
      // An invitation is meaningless on an account that already exists, and the
      // link path returns before reaching it anyway — drop it so nothing reads it.
      value.invite = false
      const acct = await query(
        `SELECT u.email, u.account_status, u.first_name,
                EXISTS (SELECT 1 FROM parent_student WHERE parent_id=u.id AND student_id=$2) AS already_linked
           FROM users u WHERE u.id=$1 AND u.role='parent'`,
        [value.link_parent_id, req.params.id]
      )
      if (!acct.rows.length) throw new AppError('That parent account could not be found. Search for it again.', 422)
      const a = acct.rows[0]
      // UNIQUE(parent_id, student_id) with ON CONFLICT DO NOTHING in the link
      // insert would otherwise answer "Guardian added." while adding nothing.
      if (a.already_linked) throw new AppError(`${a.email} is already a guardian of this learner.`, 409)
      linkNote = ` Linked to the existing parent account of ${a.email}, so this learner now appears in that account.`
        + (a.account_status === 'revoked' ? ' That account’s app access is revoked, so they cannot sign in until it is restored.'
          : a.account_status === 'pending' ? ' That account has not been activated yet.' : '')
    }

    const { account } = await withTransaction((client) => insertGuardian(client, req.params.id, value, req.user.id))
    res.json({
      message: 'Guardian added.' + (linkNote || accessNote(account?.outcome, value.email)) + alsoLinkedNote(account?.alsoLinked),
      student: presentStudent(await getStudentWithGuardians(req.params.id), req.user.role),
    })
  } catch (err) { next(err) }
})

// PUT /api/students/:id/guardians/:guardianId
router.put('/:id/guardians/:guardianId', authorizeAnyAdmin, async (req, res, next) => {
  try {
    await assertStudentInScope(req, req.params.id)
    const { error, value } = updateGuardianSchema.validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    const { invite, ...fields } = value
    const normed = normaliseName(fields)

    const result = await withTransaction(async (client) => {
      const cur = await client.query(
        `SELECT ps.parent_id, ps.surname, ps.first_name, ps.middle_name, ps.email, ps.phone,
                u.account_status, (u.password_hash IS NOT NULL) AS has_password
           FROM parent_student ps
           LEFT JOIN users u ON u.id = ps.parent_id
          WHERE ps.id=$1 AND ps.student_id=$2
          FOR UPDATE OF ps`,
        [req.params.guardianId, req.params.id]
      )
      if (!cur.rows.length) throw new AppError('Guardian not found.', 404)
      const row = cur.rows[0]

      // A guardian with an account is one person across every learner on it, so
      // who they are and how to reach them is written to ALL of that account's
      // entries (and to the account itself), while what they are to THIS learner
      // stays on this entry. Before this split each learner held its own copy, an
      // edit changed one copy, and a sibling's record kept showing the old name
      // and number.
      const SHARED = ['surname', 'first_name', 'middle_name', 'phone', 'home_address']
      const PER_LEARNER = ['relationship', 'is_emergency_contact']
      const linked = !!row.parent_id

      const sets = []; const params = []
      for (const f of linked ? PER_LEARNER : [...SHARED, 'email', ...PER_LEARNER]) {
        if (normed[f] !== undefined) { params.push(normed[f] ?? null); sets.push(`${f}=$${params.length}`) }
      }

      // The values this save leaves on the row, not the ones it replaces.
      const merged = { ...row }
      for (const [k, v] of Object.entries(normed)) if (v !== undefined) merged[k] = v

      const emailChanged = normed.email !== undefined &&
        String(normed.email || '').toLowerCase() !== String(row.email || '').toLowerCase()

      // Once a parent has activated, this address is their sign-in identity and
      // stops being the school's to edit. While the invitation is unclaimed it
      // very much is the school's: a mistyped address is the likeliest reason an
      // invitation is never used, and refusing the correction would strand the
      // guardian with no way back.
      //
      // The test is "has this account ever set a password", NOT "is it active".
      // A revoked account that was once active still belongs to a parent who
      // proved the address; checking status let an admin rewrite that login
      // the moment access was revoked. Clearing it is refused below too.
      if (row.parent_id && emailChanged) {
        const taken = await client.query(
          'SELECT 1 FROM users WHERE LOWER(email)=LOWER($1) AND id<>$2', [merged.email || '', row.parent_id]
        )
        if (taken.rows.length) throw new AppError('This email is already used by another account. Use a different email.', 409)
        if (row.has_password) {
          throw new AppError('This guardian has already activated an account with this email, so it cannot be changed here.', 409)
        }
        if (!merged.email || Joi.string().email().validate(merged.email).error) {
          throw new AppError('A valid Registered Email Address is needed.', 422)
        }
        await changeInvitationEmail(client, { userId: row.parent_id, email: merged.email })
      }

      let acct = null

      // A contact-only guardian cannot take an email that already has a parent
      // account — whenever the email changes, and on Add Invitation even when it
      // did not. That entry stays a separate person; to make it the account,
      // remove it and link the account instead.
      if (!row.parent_id && (emailChanged || invite)) await refuseParentAccountEmail(client, merged.email)
      if (emailChanged) {
        await assertGuardianEmailFree(client, {
          studentId: req.params.id, email: merged.email,
          surname: merged.surname, first_name: merged.first_name, exceptRowId: req.params.guardianId,
        })
      }
      if (invite) {
        if (row.parent_id) {
          throw new AppError('This guardian already has parent portal access. Use Reissue Invitation or Revoke Access instead.', 409)
        }
        if (!merged.email || Joi.string().email().validate(merged.email).error) {
          throw new AppError(PORTAL_EMAIL_MSG, 422)
        }
        acct = await grantParentAccess(client, {
          email: merged.email,
          surname: merged.surname, first_name: merged.first_name, middle_name: merged.middle_name, phone: merged.phone,
          invitedBy: req.user.id,
        })
        // UNIQUE(parent_id, student_id): the account may already sit under this
        // learner through another guardian row. Say so instead of a raw 23505.
        const dup = await client.query(
          'SELECT 1 FROM parent_student WHERE parent_id=$1 AND student_id=$2 AND id<>$3',
          [acct.id, req.params.id, req.params.guardianId]
        )
        if (dup.rows.length) {
          throw new AppError(`${merged.email} already has portal access as another guardian of this student.`, 409)
        }
        params.push(acct.id); sets.push(`parent_id=$${params.length}`)
        acct.email = merged.email
      }

      let sharedWith = null
      if (linked) {
        const shared = SHARED.filter(f => normed[f] !== undefined)
        const values = shared.map(f => normed[f] ?? null)
        // The email was already moved on the account and its invitation by
        // changeInvitationEmail(); this carries it to the account's entries.
        if (emailChanged) { shared.push('email'); values.push(merged.email) }

        if (shared.length) {
          await client.query(
            `UPDATE parent_student SET ${shared.map((f, i) => `${f}=$${i + 1}`).join(', ')}, updated_at=NOW()
              WHERE parent_id=$${shared.length + 1}`,
            [...values, row.parent_id]
          )
          // users has no home_address; the name parts and phone live on both.
          const onAccount = shared.filter(f => ['surname', 'first_name', 'middle_name', 'phone'].includes(f))
          if (onAccount.length) {
            await client.query(
              `UPDATE users SET ${onAccount.map((f, i) => `${f}=$${i + 1}`).join(', ')}, updated_at=NOW()
                WHERE id=$${onAccount.length + 1}`,
              [...onAccount.map(f => normed[f] ?? null), row.parent_id]
            )
          }
          const others = await client.query(
            'SELECT COUNT(*)::int AS n FROM parent_student WHERE parent_id=$1 AND student_id<>$2',
            [row.parent_id, req.params.id]
          )
          sharedWith = others.rows[0].n
        }
      }

      if (!sets.length && sharedWith === null) throw new AppError('Nothing to update.', 400)
      if (sets.length) {
        sets.push('updated_at=NOW()')
        params.push(req.params.guardianId, req.params.id)
        await client.query(
          `UPDATE parent_student SET ${sets.join(',')} WHERE id=$${params.length-1} AND student_id=$${params.length}`, params
        )
      }
      return { acct, sharedWith }
    })

    const { acct: account, sharedWith } = result
    const sharedNote = sharedWith
      ? ` Their shared details now match on the ${sharedWith} other learner${sharedWith === 1 ? '' : 's'} on this parent's account.`
      : ''
    res.json({
      message: 'Guardian updated.' + sharedNote + accessNote(account?.outcome, account?.email) + alsoLinkedNote(account?.alsoLinked),
      student: presentStudent(await getStudentWithGuardians(req.params.id), req.user.role),
    })
  } catch (err) { next(err) }
})

// POST /api/students/:id/guardians/:guardianId/invitation
//
// Grant portal access, or re-issue an invitation that was revoked, expired, or
// simply needs a clean start. Body may carry `email` to authorize a different
// address than the one on the guardian row.
//
// Deliberately separate from PUT /guardians/:guardianId, whose contract is the
// guardian's own details. Re-issuing an invitation is not an edit to the
// person, and folding it in would mean every name correction had to carry an
// access decision with it — the mistake this codebase already made once with
// the edit form silently dropping `create_account`.
//
// Sends nothing. Activation begins when the parent asks for a code.
router.post('/:id/guardians/:guardianId/invitation', authorizeAnyAdmin, async (req, res, next) => {
  try {
    await assertStudentInScope(req, req.params.id)
    const { error, value } = Joi.object({ email: Joi.string().email().optional().allow('') })
      .validate(req.body || {}, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    const result = await withTransaction(async (client) => {
      const cur = await client.query(
        `SELECT parent_id, surname, first_name, middle_name, email, phone
           FROM parent_student WHERE id=$1 AND student_id=$2 FOR UPDATE`,
        [req.params.guardianId, req.params.id]
      )
      if (!cur.rows.length) throw new AppError('Guardian not found.', 404)
      const row = cur.rows[0]

      const email = String(value.email || row.email || '').trim()
      if (!email || Joi.string().email().validate(email).error) throw new AppError(PORTAL_EMAIL_MSG, 422)

      // An address that already has a parent account other than this entry's
      // own is refused, never re-invited through this guardian.
      const owner = await client.query(
        "SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND role='parent' LIMIT 1", [email]
      )
      if (owner.rows.length && owner.rows[0].id !== row.parent_id) {
        throw new AppError(row.parent_id
          ? 'This email is already used by another parent account. Use a different email.'
          : 'This email already has a parent account. Link that account instead of entering the guardian separately.', 409)
      }

      await assertGuardianEmailFree(client, {
        studentId: req.params.id, email,
        surname: row.surname, first_name: row.first_name, exceptRowId: req.params.guardianId,
      })

      const acct = await grantParentAccess(client, {
        email,
        surname: row.surname, first_name: row.first_name, middle_name: row.middle_name, phone: row.phone,
        invitedBy: req.user.id,
      })

      // UNIQUE(parent_id, student_id): the account may already sit under this
      // learner through another guardian row. Say so instead of a raw 23505.
      const dup = await client.query(
        'SELECT 1 FROM parent_student WHERE parent_id=$1 AND student_id=$2 AND id<>$3',
        [acct.id, req.params.id, req.params.guardianId]
      )
      if (dup.rows.length) {
        throw new AppError(`${email} already has portal access as another guardian of this student.`, 409)
      }

      await client.query(
        'UPDATE parent_student SET parent_id=$1, email=$2, updated_at=NOW() WHERE id=$3 AND student_id=$4',
        [acct.id, email, req.params.guardianId, req.params.id]
      )
      return { outcome: acct.outcome, email, alsoLinked: acct.alsoLinked }
    })

    res.json({
      message: 'Parent portal access updated.' + accessNote(result.outcome, result.email) + alsoLinkedNote(result.alsoLinked),
      student: presentStudent(await getStudentWithGuardians(req.params.id), req.user.role),
    })
  } catch (err) { next(err) }
})

// DELETE /api/students/:id/guardians/:guardianId/invitation
//
// Revoke portal access. The guardian row, the account and every grade and
// attendance record stay — this switches off sign-in, it does not
// delete anything.
//
// One thing the caller has to be told: an account is one login for every child
// it is linked to, so revoking here cuts the parent off from ALL of them, not
// just this learner. Taking a guardian off one child is a different action —
// DELETE /guardians/:guardianId — so the response counts the other learners
// rather than letting the admin discover it from a support call.
router.delete('/:id/guardians/:guardianId/invitation', authorizeAnyAdmin, async (req, res, next) => {
  try {
    await assertStudentInScope(req, req.params.id)
    const others = await withTransaction(async (client) => {
      const cur = await client.query(
        'SELECT parent_id FROM parent_student WHERE id=$1 AND student_id=$2 FOR UPDATE',
        [req.params.guardianId, req.params.id]
      )
      if (!cur.rows.length) throw new AppError('Guardian not found.', 404)
      const parentId = cur.rows[0].parent_id
      if (!parentId) throw new AppError('This guardian has no parent portal access to revoke.', 409)

      const n = await client.query(
        'SELECT COUNT(*)::int AS n FROM parent_student WHERE parent_id=$1 AND student_id<>$2',
        [parentId, req.params.id]
      )
      await revokeParentAccess(client, { userId: parentId, revokedBy: req.user.id })
      return n.rows[0].n
    })

    const alsoNote = others > 0
      ? ` This account also covers ${others} other learner${others === 1 ? '' : 's'}, and can no longer sign in for ${others === 1 ? 'that one' : 'those'} either.`
      : ''
    res.json({
      message: `Parent portal access revoked.${alsoNote} The guardian record and all history are unchanged.`,
      student: presentStudent(await getStudentWithGuardians(req.params.id), req.user.role),
    })
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

module.exports = router
