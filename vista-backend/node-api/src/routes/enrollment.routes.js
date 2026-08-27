// ════════════════════════════════════════════════════════════
// ENROLLMENT — /api/enrollment
// ════════════════════════════════════════════════════════════
//
// One record per (student, school year): the grade, section and status the
// learner held that year. `students.grade_level` / `section` /
// `enrollment_status` remain the denormalised snapshot of the *active* year —
// they are what every roster query reads — and are reconciled with these
// records by the rollover in `curriculum.routes.js` when a year is activated.
//
// Admin-only. Scoped admins see and touch only their own grade levels.

const express = require('express')
const router  = express.Router()
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const { authenticate, authorizeAnyAdmin, authorizeSuperAdmin, enforceGradeScope } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { gradeScopeForRole, isScopedAdmin, isSuperAdmin, canManageGrade } = require('../utils/roles')
const { assertSectionsExist } = require('../utils/sections')
const { syStatus, isArchivedYear } = require('../utils/schoolYear')
// One definition of "was this learner part of this school year", shared with the
// activation in `curriculum.routes.js` so the roster and the roll cannot disagree.
const { PREV_JOIN, LEFT_SQL, COMPLETED_SQL, NOT_LEFT, NOT_COMPLETED } = require('../utils/rosterSql')
const {
  ENROLLMENT_STATUSES, OUTCOMES, PROMOTION_OUTCOMES, MANUAL_STATUS_IDS,
  NO_RECORD_ID, SELECTABLE_STATUS_IDS,
  MOVES_ON_OUTCOMES, statusLabel, nextGradeLevel, isExitGrade, GRADE_PROGRESSION, clampToManual,
  recommendNumeric, recommendDescriptive,
} = require('../utils/enrollment')
const {
  resolveGradingPolicy, resolveAssessment, finalGradeFrom,
  bandDistribution, competencyValue,
} = require('../utils/grading')
const { loadAssessmentRows } = require('../utils/assessmentConfig')

router.use(authenticate)
router.use(authorizeAnyAdmin)

/**
 * The section a roster row is actually in.
 *
 * **Not** `COALESCE(e.section, s.section)`. That fell back to the learner's current
 * section whenever the year's record left it NULL — but NULL on an existing record is
 * a fact, not a gap: it means "no section assigned for this year", which is exactly
 * what every learner the promotion wizard places looks like. Coalescing hid them from
 * a section filter, and worse, reported them as being in a section belonging to the
 * grade level they are *leaving* (a Grade 2 placement showing "Makabayan", a Grade 1
 * section). The fallback is only sound when there is no record at all, where the
 * learner's current standing is the honest stand-in.
 *
 * `grade_level` needs no such care: a record cannot exist without one, so its
 * COALESCE never actually falls back.
 */
const ROW_SECTION = `CASE WHEN e.id IS NOT NULL THEN e.section ELSE s.section END`

/**
 * The grade level a roster row is in **for the year being looked at** — and
 * therefore which admin owns it.
 *
 * `s.grade_level` is the snapshot of the *active* year, so scoping on it answers
 * the wrong question for every other year. Once a Kinder learner is promoted and
 * the next year is activated, their snapshot reads Grade 1: the year they spent
 * in Kinder disappeared from `admin_ece`'s roster and turned up on `admin_elem`'s,
 * where the learner was never theirs to manage. A year's roster has to be judged
 * by the grade the learner held *in it*.
 *
 * The COALESCE only falls back where there is no record at all — a year nobody
 * has enrolled the learner into yet, where their current standing is the honest
 * stand-in for where they would land.
 */
const ROW_GRADE = `COALESCE(e.grade_level, s.grade_level)`

// Same ordering the curriculum routes use, so grade lists match across pages.
// `$COL` is substituted per query because the roster sorts on the enrolment
// row's grade level, falling back to the student's current one.
const gradeOrder = (col) => `CASE ${col}
  WHEN 'Kinder' THEN 0 WHEN 'Grade 1' THEN 1 WHEN 'Grade 2' THEN 2
  WHEN 'Grade 3' THEN 3 WHEN 'Grade 4' THEN 4 WHEN 'Grade 5' THEN 5
  WHEN 'Grade 6' THEN 6 ELSE 99 END`

const loadSchoolYear = async (id) => {
  const r = await query(
    'SELECT id, label, is_active, is_upcoming, start_date, end_date FROM school_years WHERE id=$1',
    [id]
  )
  if (!r.rows.length) throw new AppError('School year not found.', 404)
  return r.rows[0]
}

/**
 * The school year immediately after this one — the only year a closing year can
 * hand learners over to, taken as the next `school_years` row by label.
 *
 * This is derived, never chosen. The wizard used to default its target to the
 * earliest *upcoming* year regardless of the source, so re-running it on an
 * older year after the next one had been activated silently closed that year
 * into the wrong one: the outcome changed, a fresh placement appeared two years
 * out, and the placement in the year actually being handed to was left behind,
 * still holding the superseded grade level.
 */
const loadNextSchoolYear = async (source) => {
  const r = await query(
    'SELECT id, label, is_active, is_upcoming FROM school_years WHERE label > $1 ORDER BY label ASC LIMIT 1',
    [source.label]
  )
  return r.rows[0] || null
}

/**
 * Refuse any target that is not that year. Skipping a year orphans whatever the
 * skipped one already holds, and no legitimate close ever needs to: if the next
 * year in sequence does not exist as a row, the year after it *is* the adjacent
 * row and this accepts it.
 */
const assertAdjacentYears = (source, target, next) => {
  if (!next) {
    throw new AppError(
      `SY ${source.label} is the most recent school year on record, so there is no year for learners to move into. ` +
      'Create the next school year in Curriculum Management first.',
      409
    )
  }
  if (target.id !== next.id) {
    throw new AppError(
      `SY ${source.label} hands over to SY ${next.label}, not SY ${target.label}. ` +
      `Closing it into a later year would leave every placement already recorded in SY ${next.label} behind, ` +
      'still holding the grade level it was given before.',
      409
    )
  }
}

/**
 * Where an outcome sends a learner, derived from the grade level they are
 * *leaving* and nothing else. One rule, mirrored by `placementFor()` in
 * `PromotionWizard.jsx`, because a seed that disagrees with it puts a retained
 * learner in the next grade.
 */
const placementForOutcome = (outcome, gradeLevel) => {
  if (outcome === 'retained') return gradeLevel
  if (outcome === 'promoted') return nextGradeLevel(gradeLevel)
  return null;   // a graduate has no placement at all
}

/**
 * Does this learner have academic work inside this school year?
 *
 * One definition, two consumers — the flag the roster returns so the UI can grey
 * out "Not enrolled", and the refusal below — so the option shown and the record
 * protected can never disagree.
 *
 * The four sources reach a school year by four different routes, because they
 * were built at different times:
 *   grades      `school_year` is a VARCHAR *label*, not a FK
 *   scores      student_scores -> score_items -> subjects.school_year_id
 *   competency  a real `school_year_id`
 *   attendance  a real `school_year_id` too, since
 *               `2026_08_23_attendance_school_year.sql`. It used to be bounded by
 *               the year's start/end date instead, which silently attributed
 *               nothing at all: consecutive years leave months uncovered between
 *               one year's end and the next one's start, and every record in such
 *               a gap belonged to no year. A NULL now means genuinely
 *               unattributable, and counts for no year.
 *
 * `behavior_logs` is deliberately left out. It is an observation about a learner,
 * not academic work produced inside a year, and like attendance it carries only a
 * timestamp.
 */
const ACADEMIC_SQL = (sy, stu) => `
  (SELECT COUNT(*)::int FROM grades g
    WHERE g.student_id = ${stu} AND g.school_year = (SELECT label FROM school_years WHERE id = ${sy}))
  + (SELECT COUNT(*)::int FROM student_scores ss
       JOIN score_items si ON si.id = ss.score_item_id
       JOIN subjects sub   ON sub.id = si.subject_id
      WHERE ss.student_id = ${stu} AND sub.school_year_id = ${sy})
  + (SELECT COUNT(*)::int FROM ece_competency_records ec
      WHERE ec.student_id = ${stu} AND ec.school_year_id = ${sy})
  + (SELECT COUNT(*)::int FROM attendance a
      WHERE a.student_id = ${stu} AND a.school_year_id = ${sy})`

/** Per-source counts for the learners named, so a refusal can say what is holding them. */
const academicRecordsFor = async (syId, studentIds) => {
  if (!studentIds.length) return []
  const r = await query(
    `SELECT s.id AS student_id, s.full_name,
            (SELECT COUNT(*)::int FROM grades g
              WHERE g.student_id=s.id AND g.school_year=(SELECT label FROM school_years WHERE id=$1)) AS grades,
            (SELECT COUNT(*)::int FROM student_scores ss
               JOIN score_items si ON si.id = ss.score_item_id
               JOIN subjects sub   ON sub.id = si.subject_id
              WHERE ss.student_id=s.id AND sub.school_year_id=$1) AS scores,
            (SELECT COUNT(*)::int FROM ece_competency_records ec
              WHERE ec.student_id=s.id AND ec.school_year_id=$1) AS competency,
            (SELECT COUNT(*)::int FROM attendance a
              WHERE a.student_id=s.id AND a.school_year_id=$1) AS attendance
       FROM students s
      WHERE s.id = ANY($2::uuid[])`,
    [syId, studentIds]
  )
  return r.rows.filter(x => x.grades + x.scores + x.competency + x.attendance > 0)
}

/**
 * Refuse to delete an enrolment record whose learner has academic work in that
 * year. Removing the record would leave grades, scores and attendance attached
 * to a learner the year no longer says was ever there.
 */
const assertNoAcademicRecords = async (syId, label, studentIds) => {
  const held = await academicRecordsFor(syId, studentIds)
  if (!held.length) return
  const describe = (x) => {
    const parts = []
    const n = (c, one) => (c === 1 ? `1 ${one}` : `${c} ${one}s`)
    if (x.grades)     parts.push(n(x.grades, 'grade'))
    if (x.scores)     parts.push(n(x.scores, 'score'))
    if (x.competency) parts.push(n(x.competency, 'competency rating'))
    if (x.attendance) parts.push(n(x.attendance, 'attendance record'))
    return `${x.full_name} (${parts.join(', ')})`
  }
  const named = held.slice(0, 3).map(describe).join('; ')
  const rest = held.length > 3 ? ` and ${held.length - 3} more` : ''
  throw new AppError(
    `${named}${rest} already have work recorded in SY ${label}, so their enrolment records cannot be removed. ` +
    'Mark them Transferred out or Dropped instead — that keeps the record and everything attached to it.',
    409
  )
}

/**
 * Refuse to delete an enrolment record that carries a year-end outcome.
 *
 * Removing a record drops one row and nothing else -- grades, scores, attendance
 * and behaviour logs all hang off `students`, not off this table. What it does
 * destroy irrecoverably is the `outcome`: `POST /promotion` is its only writer
 * anywhere, so a deleted verdict can only come back by re-running the wizard for
 * that year, which is itself gated once the year is archived.
 *
 * Absolute, unlike the archived gate above -- there is no flag to override it.
 */
const assertNoOutcome = async (syId, studentIds) => {
  if (!studentIds.length) return
  const r = await query(
    `SELECT s.full_name, e.outcome
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id
      WHERE e.school_year_id=$1 AND e.student_id = ANY($2::uuid[]) AND e.outcome IS NOT NULL
      ORDER BY s.full_name`,
    [syId, studentIds]
  )
  if (!r.rows.length) return
  const named = r.rows.slice(0, 3).map(x => `${x.full_name} (${statusLabel(x.outcome)})`).join(', ')
  const rest = r.rows.length > 3 ? ` and ${r.rows.length - 3} more` : ''
  throw new AppError(
    `${named}${rest} already have a year-end outcome for this school year, so their records cannot be removed. ` +
    'Change the outcome in Year-End Promotion first — it is the only place an outcome can be set, ' +
    'so deleting the record would lose it for good.',
    409
  )
}

/**
 * The archived-year gate, shared by the three writers that can reach a closed
 * year (`PUT /`, `DELETE /`, and the promotion commit's target).
 *
 * Two refusals, because there are two different callers. Unlocking a closed year
 * is a super_admin capability: a scoped admin told to "unlock the school year"
 * would be pointed at an affordance their page does not offer, so they get a 403
 * naming who can instead. The 409 stays for the caller who simply did not send
 * the flag -- a mis-picked year from a dropdown that lists closed years like any
 * other, which is the risk this gate has always been about.
 */
const assertArchivedWritable = (req, sy, allowArchived, conflictMessage) => {
  if (!isArchivedYear(sy)) return
  if (!isSuperAdmin(req.user.role)) {
    throw new AppError(
      `SY ${sy.label} is archived. Correcting the records of a closed school year is ` +
      'restricted to a super admin.',
      403
    )
  }
  if (!allowArchived) throw new AppError(conflictMessage, 409)
}

const resolveSYId = async (sy_id) => {
  if (sy_id) return sy_id
  const r = await query('SELECT id FROM school_years WHERE is_active=TRUE LIMIT 1')
  if (!r.rows.length) throw new AppError('No active school year set.', 400)
  return r.rows[0].id
}

// ── GET /api/enrollment ──────────────────────────────────────
//
// The roster for one school year. LEFT JOIN on purpose: a student with no
// record for that year comes back with `status: null` — "not enrolled yet" —
// rather than disappearing, because those are exactly the ones the admin needs
// to act on.
//
// A learner who has already left the school is excluded, because otherwise every
// future year's roster accumulates every ex-student the school has ever had.
// "Has left" is judged from their most recent *earlier* record — see `prev`
// below — and `?include_left=true` brings them back so a returning learner can
// still be re-enrolled.
//
// A **graduate** is excluded on a separate rule (`COMPLETED_SQL`) that
// `include_left` does not lift. They did not leave, they finished, and there is
// nothing in a later year to re-enrol them into.
router.get('/', async (req, res, next) => {
  try {
    const { grade_level, section, status, outcome, q } = req.query
    const includeLeft = req.query.include_left === 'true'
    const syId = await resolveSYId(req.query.sy_id)
    const schoolYear = await loadSchoolYear(syId)

    // $1 = school year id, $2 = its label (the LATERAL compares labels, since
    // that is the only ordering `school_years` has).
    const params = [syId, schoolYear.label]
    // ON_ROLL_OR_RECORDED: **a record for the year on screen always wins.**
    //
    // **`students.is_active` is not a filter here at all**, and that is the point.
    //
    // It is a single global flag meaning "not on the school's roll *today*". This
    // page asks a per-year question — was this learner part of SY X — and the
    // archive cannot answer it: it carries no year, and it is set automatically by
    // whichever activation happened to run last. Using it to filter a per-year
    // roster made the flag overrule the very records it was derived from.
    //
    // The damage was worst exactly where the page is most useful. A learner an
    // admin declares "Not enrolled" for a year has no record for it, so the next
    // activation archives them with the reason "No enrolment record — SY 2025-2026"
    // — and then that flag hid them from SY 2025-2026, the one year whose roster
    // explains their state and where an admin would go to correct it.
    //
    // `notLeft` and `notCompleted` below already answer the per-year question
    // properly, from the learner's most recent record *earlier* than the year on
    // screen. They are the whole filter. Archived learners are **marked**, via
    // `is_archived` / `archived_reason` on the row, not hidden.
    const conditions = []

    if (isScopedAdmin(req.user.role)) {
      params.push(gradeScopeForRole(req.user.role))
      conditions.push(`${ROW_GRADE} = ANY($${params.length}::text[])`)
    }
    if (grade_level) { params.push(grade_level); conditions.push(`${ROW_GRADE}=$${params.length}`) }
    // 'none' means *no section*, the same sentinel `status` and `outcome` use below.
    // `NULLIF` because the column is written both ways: `PUT /` normalises '' to NULL,
    // but `students.section` can still hold an empty string from older paths, and an
    // unassigned learner has to be findable however their row happens to spell it.
    if (section === NO_RECORD_ID) {
      conditions.push(`NULLIF(${ROW_SECTION}, '') IS NULL`)
    } else if (section) {
      params.push(section); conditions.push(`${ROW_SECTION}=$${params.length}`)
    }
    if (status === 'none') {
      conditions.push('e.id IS NULL')
    } else if (status) {
      params.push(status); conditions.push(`e.status=$${params.length}`)
    }
    if (outcome === 'none') {
      conditions.push('e.id IS NOT NULL AND e.outcome IS NULL')
    } else if (outcome) {
      params.push(outcome); conditions.push(`e.outcome=$${params.length}`)
    }
    if (q) {
      params.push(`%${q}%`)
      conditions.push(`(s.surname ILIKE $${params.length} OR s.first_name ILIKE $${params.length} OR s.full_name ILIKE $${params.length} OR s.lrn ILIKE $${params.length})`)
    }

    // A learner with a record for this year is always shown — someone put them
    // here deliberately, even if they left in an earlier year.
    //
    // Also returned per row, negated, as `has_left`: the rows the toggle reveals,
    // the count on it and the rows the table greys out are then one set by
    // construction. The client cannot derive it — two of the three ways to have
    // left are about a year *closing* without the learner in it, which needs the
    // gap check inside LEFT_SQL rather than anything visible on the row.
    const notLeft = NOT_LEFT
    if (!includeLeft) conditions.push(notLeft)

    // Graduates are filtered out whatever `include_left` says — see COMPLETED_SQL.
    // Same `e.id IS NOT NULL` escape: a record for this year always wins.
    const notCompleted = NOT_COMPLETED
    conditions.push(notCompleted)

    // A closed year with no filters leaves nothing to constrain on, and `WHERE`
    // with nothing after it is a syntax error.
    const clause = (arr) => arr.length ? `WHERE ${arr.join(' AND ')}` : ''
    const where = clause(conditions)

    // `prev` is the learner's most recent record from a *earlier* school year,
    // skipping gaps. It answers both "where did they last attend" (the column
    // that replaced a useless "Currently") and "have they left the school".
    // `current_*` is where the learner stands right now; `grade_level`/`section`
    // are what this school year's record says. They differ whenever the admin
    // has enrolled ahead into a year that is not active yet.
    const rows = await query(
      `SELECT s.id AS student_id, s.lrn, s.surname, s.first_name, s.middle_name, s.full_name,
              s.grade_level AS current_grade_level, s.section AS current_section,
              s.enrollment_status AS current_status,
              e.id AS enrollment_id, e.grade_level, e.section, e.status, e.remarks,
              e.outcome, e.outcome_remarks,
              e.decided_at, u.full_name AS decided_by_name,
              prev.label AS last_school_year, prev.grade_level AS last_grade_level,
              prev.section AS last_section, prev.status AS last_status,
              prev.outcome AS last_outcome,
              NOT ${notLeft} AS has_left,
              -- Only ever true for a learner the rule above kept because they have
              -- a record for this year. The row has to say so: otherwise a closed
              -- year lists someone who is on no class list anywhere, with nothing
              -- explaining the difference between them and the learner beside them.
              NOT s.is_active AS is_archived,
              s.archived_reason,
              (${ACADEMIC_SQL('$1', 's.id')}) > 0 AS has_academic_records
         FROM students s
         LEFT JOIN student_enrollments e ON e.student_id=s.id AND e.school_year_id=$1
         LEFT JOIN users u ON u.id = e.decided_by
         ${PREV_JOIN}
         ${where}
        ORDER BY ${gradeOrder(ROW_GRADE)},
                 ${ROW_SECTION} NULLS FIRST, s.surname, s.first_name`,
      params
    )

    // Summary is over the caller's whole scope for this year, not the filtered
    // view — it drives the status chips, which must keep their counts while one
    // of them is selected. It respects the has-left rule so the chips add up to
    // what is on screen.
    const scopeParams = [syId, schoolYear.label]
    const scopeConditions = []
    if (isScopedAdmin(req.user.role)) {
      scopeParams.push(gradeScopeForRole(req.user.role))
      scopeConditions.push(`${ROW_GRADE} = ANY($${scopeParams.length}::text[])`)
    }
    const scopeWhere = clause(scopeConditions)

    const [summaryRows, outcomeRows, leftRow] = await Promise.all([
      query(
        `SELECT COALESCE(e.status, 'none') AS status, COUNT(*)::int AS count
           FROM students s
           LEFT JOIN student_enrollments e ON e.student_id=s.id AND e.school_year_id=$1
           ${PREV_JOIN}
          ${clause([...scopeConditions, notCompleted, notLeft])}
          GROUP BY 1`,
        scopeParams
      ),
      query(
        `SELECT COALESCE(e.outcome, 'none') AS outcome, COUNT(*)::int AS count
           FROM students s
           JOIN student_enrollments e ON e.student_id=s.id AND e.school_year_id=$1
           ${PREV_JOIN}
          ${scopeWhere}
          GROUP BY 1`,
        scopeParams
      ),
      // How many the has-left rule is hiding, so the toggle can say so. Graduates
      // are not among them — the toggle cannot reveal one, so counting them here
      // would promise rows that never arrive.
      query(
        `SELECT COUNT(*)::int AS n
           FROM students s
           LEFT JOIN student_enrollments e ON e.student_id=s.id AND e.school_year_id=$1
           ${PREV_JOIN}
          ${clause([...scopeConditions, notCompleted, `NOT ${notLeft}`])}`,
        scopeParams
      ),
    ])

    res.json({
      school_year: schoolYear,
      students: rows.rows,
      summary: Object.fromEntries(summaryRows.rows.map(r => [r.status, r.count])),
      outcome_summary: Object.fromEntries(outcomeRows.rows.map(r => [r.outcome, r.count])),
      left_count: leftRow.rows[0].n,
      include_left: includeLeft,
      statuses: ENROLLMENT_STATUSES,
      outcomes: OUTCOMES,
    })
  } catch (err) { next(err) }
})

// ── GET /api/enrollment/student/:id ──────────────────────────
// One learner's year-by-year history, newest first.
//
// **Archived learners included**, and this lookup must not filter `is_active`.
// Preserving the record is the entire point of archiving rather than deleting, and
// this endpoint is that record — so refusing it for an archived learner denied the
// history precisely when it is the only thing left to look at. Student Detail calls
// it on mount, so the 404 also surfaced as a "Student not found" toast on a page
// that had already loaded the student.
//
// Scope is still enforced, on `students.grade_level`: for an archived learner that
// is the last grade they held, which is the right owner either way.
router.get('/student/:id', async (req, res, next) => {
  try {
    const st = await query('SELECT grade_level FROM students WHERE id=$1', [req.params.id])
    if (!st.rows.length) throw new AppError('Student not found.', 404)
    if (isScopedAdmin(req.user.role) && !canManageGrade(req.user.role, st.rows[0].grade_level)) {
      throw new AppError('Student is outside your grade scope.', 403)
    }

    const rows = await query(
      `SELECT e.id, e.grade_level, e.section, e.status, e.remarks,
              e.outcome, e.outcome_remarks, e.decided_at,
              sy.id AS school_year_id, sy.label AS school_year,
              sy.is_active, sy.is_upcoming,
              u.full_name AS decided_by_name
         FROM student_enrollments e
         JOIN school_years sy ON sy.id = e.school_year_id
         LEFT JOIN users u ON u.id = e.decided_by
        WHERE e.student_id=$1
        ORDER BY sy.label DESC`,
      [req.params.id]
    )
    res.json({ enrollments: rows.rows })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// YEAR-END PROMOTION
// ════════════════════════════════════════════════════════════

// ── GET /api/enrollment/promotion-review?sy_id=&target_sy_id= ─
//
// Everything the wizard's first step needs: each learner enrolled in the
// closing year, what their results say, and the outcome VISTA recommends.
//
// The recommendation is advice, never a decision. Every row carries the numbers
// it was derived from so the admin can see *why*, and `needs_review` marks the
// rows a human has to look at rather than wave through.
router.get('/promotion-review', async (req, res, next) => {
  try {
    const syId = await resolveSYId(req.query.sy_id)
    const source = await loadSchoolYear(syId)
    // The handover year is derived from the source, so the client does not have
    // to pass it and cannot pass the wrong one. An explicit `target_sy_id` is
    // still honoured for older callers, but only if it agrees.
    const next = await loadNextSchoolYear(source)
    const target = req.query.target_sy_id ? await loadSchoolYear(req.query.target_sy_id) : next
    if (target) assertAdjacentYears(source, target, next)

    // Roster: everyone with a record for the closing year. Learners already
    // decided in a previous run come back with that decision, so the wizard is
    // resumable rather than destructive.
    const params = [syId]
    const conditions = ['s.is_active=TRUE']
    // Scoped on the grade level the learner held in the **closing** year, which
    // is what `POST /promotion` checks when the decisions come back. Scoping the
    // review on `students.grade_level` instead meant that once the next year was
    // activated the wizard changed hands mid-close: the Kinder cohort vanished
    // from `admin_ece`'s review and appeared in `admin_elem`'s, even though the
    // commit would still have refused them.
    if (isScopedAdmin(req.user.role)) {
      params.push(gradeScopeForRole(req.user.role))
      conditions.push(`e.grade_level = ANY($${params.length}::text[])`)
    }

    // Only learners who were actually enrolled get a year-end outcome. Someone
    // who transferred out, dropped, or was never confirmed did not finish the
    // year -- their status already says what happened, and asking an admin to
    // also promote or retain them is the vocabulary mixing this split removes.
    const roster = await query(
      `SELECT s.id AS student_id, s.lrn, s.surname, s.first_name, s.middle_name, s.full_name,
              e.grade_level, e.section, e.status, e.outcome, e.outcome_remarks
         FROM student_enrollments e
         JOIN students s ON s.id = e.student_id
        WHERE e.school_year_id=$1 AND e.status='enrolled' AND ${conditions.join(' AND ')}
        ORDER BY ${gradeOrder('e.grade_level')}, e.section NULLS FIRST, s.surname, s.first_name`,
      params
    )

    // Everyone the filter above removed, counted so the wizard can account for
    // them rather than leaving the admin to wonder where they went.
    const excludedRows = await query(
      `SELECT e.status, COUNT(*)::int AS count
         FROM student_enrollments e
         JOIN students s ON s.id = e.student_id
        WHERE e.school_year_id=$1 AND e.status<>'enrolled' AND ${conditions.join(' AND ')}
        GROUP BY 1`,
      params
    )
    const excluded = Object.fromEntries(excludedRows.rows.map(r => [r.status, r.count]))

    if (!roster.rows.length) {
      return res.json({
        source_school_year: source, target_school_year: target,
        students: [], summary: {}, target_sections: {}, total: 0,
        excluded: Object.fromEntries(
          (await query(
            `SELECT e.status, COUNT(*)::int AS count
               FROM student_enrollments e
               JOIN students s ON s.id = e.student_id
              WHERE e.school_year_id=$1 AND e.status<>'enrolled' AND ${conditions.join(' AND ')}
              GROUP BY 1`,
            params
          )).rows.map(r => [r.status, r.count])
        ),
      })
    }

    const ids = roster.rows.map(r => r.student_id)

    // How each grade level was assessed in the *closing* year decides which
    // evidence to read: grades, or competency ratings.
    const assessmentRows = await loadAssessmentRows(syId)
    const assessmentFor = (gl) => resolveAssessment(gl, assessmentRows.get(gl) || null)
    const policy = resolveGradingPolicy(source, null, null)

    // ── Numeric evidence: final grade per subject, per DO 015 §52 — the mean of
    // the period grades. Missing periods are skipped, so a partial year still
    // reports something rather than nothing.
    const gradeRows = await query(
      `SELECT g.student_id, g.subject_id, sub.name AS subject_name, g.quarter, g.grade
         FROM grades g
         JOIN subjects sub ON sub.id = g.subject_id
        WHERE g.school_year=$1 AND g.student_id = ANY($2::uuid[])`,
      [source.label, ids]
    )
    const bySubject = new Map()   // student -> subject_id -> { name, periods[] }
    for (const g of gradeRows.rows) {
      if (!bySubject.has(g.student_id)) bySubject.set(g.student_id, new Map())
      const subs = bySubject.get(g.student_id)
      if (!subs.has(g.subject_id)) subs.set(g.subject_id, { name: g.subject_name, periods: [] })
      subs.get(g.subject_id).periods.push(g.grade)
    }

    // ── Descriptive evidence: the latest period that has ratings, banded by
    // rank through the record's own scale — never by letter, since 'E' is the
    // best level on EGFNA and the worst on ABCDE.
    const eceRows = await query(
      `SELECT student_id, quarter, rating, rating_scale
         FROM ece_competency_records
        WHERE school_year_id=$1 AND student_id = ANY($2::uuid[])`,
      [syId, ids]
    )
    const latestQuarter = new Map()
    for (const r of eceRows.rows) {
      const q = latestQuarter.get(r.student_id)
      if (q === undefined || r.quarter > q) latestQuarter.set(r.student_id, r.quarter)
    }
    const eceDist = new Map()     // student -> { scaleId, dist }
    for (const r of eceRows.rows) {
      if (r.quarter !== latestQuarter.get(r.student_id)) continue
      if (!eceDist.has(r.student_id)) eceDist.set(r.student_id, { scaleId: r.rating_scale, dist: {} })
      const d = eceDist.get(r.student_id)
      d.dist[r.rating] = (d.dist[r.rating] || 0) + 1
    }
    const skillTotals = await query(
      `SELECT sub.grade_level, COUNT(*)::int AS n
         FROM competency_skills cs
         JOIN subjects sub ON sub.id = cs.subject_id
        WHERE sub.school_year_id=$1 AND cs.is_active=TRUE
        GROUP BY 1`,
      [syId]
    )
    const totalSkills = Object.fromEntries(skillTotals.rows.map(r => [r.grade_level, r.n]))

    // ── Decisions already recorded for the year they move into.
    const placed = target
      ? await query(
          `SELECT student_id, grade_level, section, status
             FROM student_enrollments WHERE school_year_id=$1 AND student_id = ANY($2::uuid[])`,
          [target.id, ids]
        )
      : { rows: [] }
    const placedBy = new Map(placed.rows.map(r => [r.student_id, r]))

    const students = roster.rows.map(r => {
      const assessment = assessmentFor(r.grade_level)
      const isExit = isExitGrade(r.grade_level)
      let evidence, rec

      if (assessment.isDescriptive) {
        const d = eceDist.get(r.student_id)
        const total = totalSkills[r.grade_level] || 0
        const band = d ? bandDistribution(d.dist, total, d.scaleId) : 'insufficient'
        const rated = d ? Object.values(d.dist).reduce((a, b) => a + b, 0) : 0
        evidence = {
          mode: 'descriptive',
          rating_scale: d ? d.scaleId : assessment.scaleId,
          quarter: latestQuarter.get(r.student_id) || null,
          distribution: d ? d.dist : null,
          rated, total_skills: total, band,
          competency_value: d ? competencyValue(d.dist, d.scaleId) : null,
        }
        rec = recommendDescriptive({ band, isExit })
      } else {
        const subs = bySubject.get(r.student_id) || new Map()
        const finals = [...subs.entries()]
          .map(([subject_id, v]) => ({
            subject_id, subject_name: v.name, final_grade: finalGradeFrom(v.periods),
          }))
          .filter(f => f.final_grade !== null)
          .sort((a, b) => a.subject_name.localeCompare(b.subject_name))
        const failed = finals.filter(f => f.final_grade < policy.passingGrade)
        evidence = {
          mode: 'numeric',
          passing_grade: policy.passingGrade,
          subjects: finals,
          subjects_graded: finals.length,
          subjects_failed: failed.length,
          failed_subjects: failed.map(f => f.subject_name),
          general_average: finals.length
            ? Math.round(finals.reduce((a, f) => a + f.final_grade, 0) / finals.length)
            : null,
        }
        rec = recommendNumeric({
          subjectsGraded: finals.length, subjectsFailed: failed.length, isExit,
        })
      }

      const next = placedBy.get(r.student_id)
      return {
        student_id: r.student_id, lrn: r.lrn,
        surname: r.surname, first_name: r.first_name, middle_name: r.middle_name,
        full_name: r.full_name,
        grade_level: r.grade_level, section: r.section,
        is_exit_grade: isExit,
        current_status: r.status,
        // Set once the wizard has already been committed for this year. Read
        // straight off its own column now -- it no longer has to be inferred
        // from a status that was overloaded to carry it.
        decided_outcome: r.outcome,
        decided_remarks: r.outcome_remarks,
        // Where each outcome sends them, computed from the grade level they are
        // *leaving* and nothing else. Kept separate from `next_grade_level`
        // below, which is only a seed: once a retention has been committed the
        // existing placement IS the unchanged grade, so reusing it as "where
        // promotion goes" would leave a re-promoted learner in the same year.
        promoted_grade_level: nextGradeLevel(r.grade_level),
        retained_grade_level: r.grade_level,
        // Seed for the form: the placement already on file, else wherever the
        // recommendation would send them. This used to be the advance no matter
        // what was recommended, so a learner recommended *retained* who was
        // never committed arrived pre-placed in the next grade level — and
        // accepting the recommendation without reopening the dropdown promoted
        // them anyway.
        next_grade_level: next ? next.grade_level : placementForOutcome(rec.outcome, r.grade_level),
        next_section: next ? next.section : null,
        already_placed: !!next,
        evidence,
        recommendation: rec.outcome,
        needs_review: rec.needsReview,
        reason: rec.reason,
      }
    })

    const summary = students.reduce((a, s) => {
      const k = s.recommendation || 'no_data'
      a[k] = (a[k] || 0) + 1
      if (s.needs_review) a.needs_review = (a.needs_review || 0) + 1
      return a
    }, {})

    // Sections available in the year they move into, for step 2.
    const target_sections = {}
    if (target) {
      const secs = await query(
        `SELECT grade_level, name FROM sections
          WHERE school_year_id=$1 AND is_active=TRUE
          ORDER BY ${gradeOrder('grade_level')}, name`,
        [target.id]
      )
      for (const row of secs.rows) {
        if (!target_sections[row.grade_level]) target_sections[row.grade_level] = []
        target_sections[row.grade_level].push(row.name)
      }
    }

    res.json({
      source_school_year: source,
      target_school_year: target,
      students, summary, target_sections, excluded,
      total: students.length,
    })
  } catch (err) { next(err) }
})

// ── POST /api/enrollment/promotion ───────────────────────────
//
// Commit the wizard. Two writes per learner, in one transaction:
//   1. the closing year's record gets the outcome    (promoted / retained / ...)
//   2. the year they move into gets a `pending` record at the new placement
//
// `pending`, not `enrolled`: a promotion decision says where the learner belongs
// if they come back, not that they have. Someone still has to confirm them —
// which is the whole point of that status.
router.post('/promotion', async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      sy_id:        Joi.string().uuid().required(),
      target_sy_id: Joi.string().uuid().required(),
      decisions: Joi.array().min(1).max(1000).items(Joi.object({
        student_id:       Joi.string().uuid().required(),
        // `null` clears a decision committed by an earlier run. Still `.required()`,
        // so the key has to be present: an *absent* outcome stays a validation error
        // rather than being read as a request to erase a verdict.
        outcome:          Joi.string().valid(...PROMOTION_OUTCOMES).allow(null).required(),
        remarks:          Joi.string().allow('', null).max(500).optional(),
        next_grade_level: Joi.string().allow(null).optional(),
        next_section:     Joi.string().allow('', null).optional(),
      })).required(),
      // Set only by the wizard after the admin has unlocked a closed handover.
      // Absent means "I did not mean to touch history".
      allow_archived: Joi.boolean().default(false),
    }).validate(req.body, { abortEarly: false, stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    if (value.sy_id === value.target_sy_id) {
      throw new AppError('The closing school year and the year learners move into must be different.', 422)
    }
    const source = await loadSchoolYear(value.sy_id)
    const target = await loadSchoolYear(value.target_sy_id)
    assertAdjacentYears(source, target, await loadNextSchoolYear(source))

    // A year that has not started has no results to judge, so a year-end outcome
    // for it is not a correction -- it is a category error, which is why this is
    // refused outright rather than put behind the unlock below.
    if (syStatus(source) === 'upcoming') {
      throw new AppError(
        `SY ${source.label} has not started yet, so there is nothing to close. ` +
        'A school year can only be closed once it has run.',
        422
      )
    }

    // Gated on the year learners move *into*, not on the closing year. Writing an
    // outcome onto an already-archived closing year is the normal sequence --
    // that is what closing last year after activating this one does. What alters
    // history is the other two writes, and both land on the target: the placement
    // upsert rewrites a closed year's grade level and section (leaving `status`
    // alone, so an archived 'enrolled' learner keeps that status under a changed
    // grade), and a `graduated` decision deletes the target row outright, erasing
    // the fact the learner attended that year at all -- the same act
    // `DELETE /api/enrollment` already puts behind this flag.
    assertArchivedWritable(req, target, value.allow_archived,
      `SY ${source.label} hands over to SY ${target.label}, which is archived. ` +
      'Closing one archived school year into another rewrites records that are already history. ' +
      'Unlock the wizard to correct them on purpose.')

    // Only promoted and retained learners carry forward. A learner who
    // graduated gets no record in the next year at all — that is what
    // graduating means, and it is why they stop appearing in later rosters.
    const decisions = value.decisions.map(d => ({
      ...d,
      next_section: d.next_section || null,
      next_grade_level: MOVES_ON_OUTCOMES.includes(d.outcome) ? d.next_grade_level : null,
    }))

    const missing = decisions.filter(d => MOVES_ON_OUTCOMES.includes(d.outcome) && !d.next_grade_level)
    if (missing.length) {
      throw new AppError(
        `${missing.length} learner${missing.length === 1 ? ' has' : 's have'} no grade level set for SY ${target.label}.`,
        422
      )
    }

    const ids = [...new Set(decisions.map(d => d.student_id))]
    // `status='enrolled'` is the same gate the review applies: an outcome can
    // only be recorded for a learner who actually attended the year.
    const cur = await query(
      `SELECT s.id, s.full_name, e.grade_level AS source_grade_level,
              e.outcome AS prior_outcome, e.status AS source_status
         FROM students s
         JOIN student_enrollments e ON e.student_id = s.id AND e.school_year_id = $2
        WHERE s.id = ANY($1::uuid[]) AND s.is_active=TRUE AND e.status='enrolled'`,
      [ids, value.sy_id]
    )
    if (cur.rows.length !== ids.length) {
      throw new AppError(
        'One or more learners were not enrolled in the closing school year, so they cannot be given a year-end outcome.',
        409
      )
    }

    // Graduating means finishing the last grade level the school offers, so it
    // is only available to a learner sitting in it. Anywhere else it is a
    // mis-click that ends a learner's schooling: `students.enrollment_status`
    // goes to 'graduated', they drop off every later roster, and nothing carries
    // them forward. `isExitGrade` reads the same `ALL_GRADES` ladder the UI does,
    // so adding or retiring a grade level moves this with it.
    const gradeOf = new Map(cur.rows.map(r => [r.id, r.source_grade_level]))
    const nameOf  = new Map(cur.rows.map(r => [r.id, r.full_name]))
    const earlyGraduates = decisions.filter(
      d => d.outcome === 'graduated' && !isExitGrade(gradeOf.get(d.student_id))
    )
    if (earlyGraduates.length) {
      const levels = [...new Set(earlyGraduates.map(d => gradeOf.get(d.student_id)))].join(', ')
      throw new AppError(
        `${earlyGraduates.length} learner${earlyGraduates.length === 1 ? '' : 's'} in ${levels} cannot be graduated — ` +
        `only learners finishing ${GRADE_PROGRESSION[GRADE_PROGRESSION.length - 1]} can. ` +
        'Record them as promoted or retained; a learner who is leaving the school is marked ' +
        'Transferred out or Dropped on the Enrollment page.',
        422
      )
    }

    // Scope is checked on the grade level they are leaving AND the one they are
    // entering: a scoped admin must not close out someone else's grade level,
    // nor place a learner into one.
    if (isScopedAdmin(req.user.role)) {
      const out = cur.rows.filter(r => !canManageGrade(req.user.role, r.source_grade_level))
      if (out.length) throw new AppError(`${out.length} of the selected learners are outside your grade scope.`, 403)
    }

    // ...with one exception, or closing a year would be impossible for the admin
    // who owns its **last** grade level: promotion out of the top of a scoped
    // range necessarily lands outside it. Kinder promotes into Grade 1, which
    // `admin_ece` does not otherwise touch, and Grade 6 graduates into nothing.
    // So an out-of-scope target is allowed **only where the ladder derives it**
    // for that learner -- the next grade for a promotion, the same one for a
    // retention -- and never as a free placement. Anything else still 403s.
    for (const d of decisions) {
      if (!d.next_grade_level) continue
      if (canManageGrade(req.user.role, d.next_grade_level)) continue
      const from = gradeOf.get(d.student_id)
      const derived = d.outcome === 'retained' ? from : nextGradeLevel(from)
      if (d.next_grade_level === derived) continue
      // Out of scope **and** not what the outcome implies. The bare scope message
      // reads as a permissions problem, when for a scoped admin the usual cause is
      // a placement that contradicts the decision beside it -- a retained learner
      // sent up a grade, which for `admin_ece` lands in Grade 1 and trips this.
      // Name both, so the fix is obvious rather than looking like missing access.
      throw new AppError(
        `${nameOf.get(d.student_id) || 'A learner'} is recorded as ${statusLabel(d.outcome)}, ` +
        `which means ${derived || 'no placement at all'} — but the placement is ${d.next_grade_level}, ` +
        'which is outside your grade scope. Correct the outcome or the placement so the two agree.',
        403
      )
    }

    // Clearing a decision removes the placement it created in the target year. That
    // is the same delete `DELETE /api/enrollment` puts behind `assertNoAcademicRecords`,
    // and for the same reason: if the learner has already been given work in that year,
    // dropping the record would leave it hanging off a learner the year no longer says
    // was ever there. Undoing a verdict must not cost anyone their grades.
    const clearedIds = decisions.filter(d => d.outcome === null).map(d => d.student_id)
    await assertNoAcademicRecords(value.target_sy_id, target.label, clearedIds)

    await assertSectionsExist(
      value.target_sy_id,
      decisions.filter(d => d.next_grade_level)
        .map(d => ({ student_id: d.student_id, grade_level: d.next_grade_level, section: d.next_section })),
      (e) => nameOf.get(e.student_id) || 'Learner'
    )

    const priorOutcome = new Map(cur.rows.map(r => [r.id, r.prior_outcome]))
    const sourceStatus = new Map(cur.rows.map(r => [r.id, r.source_status]))

    const result = await withTransaction(async (client) => {
      let closed = 0, carried = 0, cleared = 0
      for (const d of decisions) {
        // `status` is deliberately untouched. The learner *was* enrolled that
        // year; the outcome says how it ended. Overwriting one with the other is
        // exactly the conflation this split removes.
        await client.query(
          `UPDATE student_enrollments
              SET outcome=$1, outcome_remarks=$2, decided_by=$3, decided_at=NOW(), updated_at=NOW()
            WHERE student_id=$4 AND school_year_id=$5`,
          [d.outcome, d.remarks || null, req.user.id, d.student_id, value.sy_id]
        )
        if (d.outcome === null) cleared++; else closed++

        if (d.next_grade_level) {
          await client.query(
            `INSERT INTO student_enrollments
               (student_id, school_year_id, grade_level, section, status, decided_by, decided_at)
             VALUES ($1,$2,$3,$4,'pending',$5,NOW())
             ON CONFLICT (student_id, school_year_id) DO UPDATE
               SET grade_level=EXCLUDED.grade_level, section=EXCLUDED.section,
                   decided_by=EXCLUDED.decided_by, decided_at=NOW(), updated_at=NOW()`,
            [d.student_id, value.target_sy_id, d.next_grade_level, d.next_section, req.user.id]
          )
          carried++
        } else {
          // Reversing an earlier decision: a learner who graduated must not keep
          // a stale placement in a year they are not attending.
          await client.query(
            'DELETE FROM student_enrollments WHERE student_id=$1 AND school_year_id=$2',
            [d.student_id, value.target_sy_id]
          )
        }

        // Graduating is the one outcome that also ends the learner's presence in
        // the school, so it is the one that changes what they currently are —
        // and only while the closing year is still the active one. Promotion and
        // retention leave the mirror alone: the learner stays in their current
        // class until the next year is activated.
        if (source.is_active && d.outcome === 'graduated') {
          await client.query(
            `UPDATE students SET enrollment_status='graduated', updated_at=NOW()
              WHERE id=$1 AND is_active=TRUE`,
            [d.student_id]
          )
        }

        // ...and undoing that verdict has to undo its mirror too, or a learner
        // whose graduation was recorded by mistake stays off every roster with
        // nothing on record saying why. They go back to what the closing year's
        // record still says they were during it -- `status` was never touched by
        // any of this, so it is the honest answer.
        if (source.is_active && d.outcome === null && priorOutcome.get(d.student_id) === 'graduated') {
          await client.query(
            `UPDATE students SET enrollment_status=$1, updated_at=NOW()
              WHERE id=$2 AND is_active=TRUE`,
            [clampToManual(sourceStatus.get(d.student_id)), d.student_id]
          )
        }
      }
      return { closed, carried, cleared }
    })

    // Built rather than templated, because a run can be any mix of the three and
    // "closed for 0 learners" would be a lie about a run that only undid a mistake.
    const parts = []
    if (result.closed)  parts.push(`SY ${source.label} closed for ${result.closed} learner${result.closed === 1 ? '' : 's'}`)
    if (result.carried) parts.push(`${result.carried} carried into SY ${target.label} as pending`)
    if (result.cleared) parts.push(`${result.cleared} decision${result.cleared === 1 ? '' : 's'} cleared`)

    res.json({
      message: `${parts.join('. ')}.`,
      ...result,
      target_school_year: target.label,
    })
  } catch (err) { next(err) }
})

// ── PUT /api/enrollment ──────────────────────────────────────
// Bulk upsert of one school year's records. All-or-nothing.
// `status: 'none'` means "remove this year's record" rather than write a value,
// so it is the one case where a grade level is meaningless.
const entrySchema = Joi.object({
  student_id:  Joi.string().uuid().required(),
  status:      Joi.string().valid(...SELECTABLE_STATUS_IDS).required(),
  grade_level: Joi.string().min(1).when('status', {
    is: NO_RECORD_ID, then: Joi.optional().allow(null, ''), otherwise: Joi.required(),
  }),
  section:     Joi.string().allow('', null).optional(),
  remarks:     Joi.string().allow('', null).max(500).optional(),
})

router.put('/', async (req, res, next) => {
  try {
    // Checked before Joi, because a year-end outcome arriving here is not a
    // malformed enum -- it is a request aimed at the wrong surface, and the
    // generic "must be one of [...]" would not say so.
    const misplaced = (Array.isArray(req.body && req.body.entries) ? req.body.entries : [])
      .filter(e => e && PROMOTION_OUTCOMES.includes(e.status))
    if (misplaced.length) {
      throw new AppError(
        `"${PROMOTION_OUTCOMES.map(o => statusLabel(o)).join('", "')}" are year-end outcomes, not enrolment statuses. ` +
        'Record them in Year-End Promotion. This page sets whether a learner is attending the school year.',
        422
      )
    }

    const { error, value } = Joi.object({
      sy_id:   Joi.string().uuid().required(),
      entries: Joi.array().items(entrySchema).min(1).max(1000).required(),
      // Set only by the Enrollment page after the admin has unlocked a closed
      // year. Absent means "I did not mean to touch history", which is the
      // right default for anything else that ever calls this.
      allow_archived: Joi.boolean().default(false),
    }).validate(req.body, { abortEarly: false, stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    const schoolYear = await loadSchoolYear(value.sy_id)

    // An archived year is closed: its records are the history of who actually
    // attended, and the roster page defaults to a year the admin is far more
    // likely to have meant. Correcting a closed year is legitimate -- records do
    // get entered wrong -- so this is a deliberate gate, not a freeze. Unlike
    // the grading-model lock in curriculum.routes.js there is nothing to
    // re-derive here; the risk is a mis-picked year, so an explicit flag is
    // enough to distinguish intent from accident.
    assertArchivedWritable(req, schoolYear, value.allow_archived,
      `SY ${schoolYear.label} is archived, so its enrolment records are read-only. ` +
      'Unlock the school year on the Enrollment page to correct historical records.')

    const all = value.entries.map(e => ({ ...e, section: e.section || null }))

    // "Not enrolled" removes the year's record. What blocks it is no longer the
    // year's status but what is attached to the record: a year-end verdict that
    // nothing else can rewrite, or academic work that would be left hanging off a
    // learner the year no longer says was ever there. On the active year the
    // mirror on `students` is reconciled below, so removal is safe there too.
    const removals = all.filter(e => e.status === NO_RECORD_ID)
    const entries  = all.filter(e => e.status !== NO_RECORD_ID)

    // Removing a record erases the fact the learner attended that year at all,
    // which is a different act from correcting the status they held in it. The
    // per-learner status edits below stay open to every admin within their scope.
    if (removals.length && !isSuperAdmin(req.user.role)) {
      throw new AppError(
        'Removing an enrolment record is restricted to a super admin. ' +
        `${removals.length} of the submitted learners are set to "Not enrolled".`,
        403
      )
    }

    const removalIds = removals.map(e => e.student_id)
    await assertNoOutcome(value.sy_id, removalIds)
    await assertNoAcademicRecords(value.sy_id, schoolYear.label, removalIds)

    // Both the grade the learner moves *into* and the one they came *from* have
    // to be in scope. Checking only the target would let an ECE admin promote a
    // Kinder learner into Grade 1 and lose sight of them; checking only the
    // source would let them reach up into elementary. A removal has no target
    // grade, so only the source check applies to it.
    for (const e of entries) enforceGradeScope(req, e.grade_level)

    const ids = [...new Set(all.map(e => e.student_id))]
    // The source grade is the one the learner holds **in the year being edited**,
    // which is `students.grade_level` only for the active year. Reading the
    // snapshot instead handed every past year to whoever owns the learner *now*:
    // after a Kinder cohort is promoted and the next year activated, `admin_elem`
    // could edit their Kinder records and `admin_ece` — the admin who actually
    // kept that roster — could not. Falls back to the snapshot where the year has
    // no record yet, which is the only case where nothing else says where they sit.
    const cur = await query(
      `SELECT s.id, s.full_name, ${ROW_GRADE} AS grade_level
         FROM students s
         LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.school_year_id = $2
        WHERE s.id = ANY($1::uuid[]) AND s.is_active=TRUE`,
      [ids, value.sy_id]
    )
    if (cur.rows.length !== ids.length) throw new AppError('One or more students no longer exist.', 404)
    if (isScopedAdmin(req.user.role)) {
      const outOfScope = cur.rows.filter(r => !canManageGrade(req.user.role, r.grade_level))
      if (outOfScope.length) {
        throw new AppError(`${outOfScope.length} of the selected students are outside your grade scope.`, 403)
      }
    }

    const nameOf = new Map(cur.rows.map(r => [r.id, r.full_name]))

    // The status column is super_admin's. A scoped admin still *places* learners
    // -- grade level and section are the roster they keep -- but whether a
    // learner is attending the year at all is not theirs to set.
    //
    // Enforced by comparing against what is stored, not by dropping the field:
    // the page posts the whole draft row, so silently overwriting the submitted
    // status would answer 200 to a save that did not do what it said. A learner
    // with no record yet has no status to preserve, and a new record may only be
    // created 'pending' -- what the rollover gives anyone who has not been
    // confirmed for the year.
    if (isScopedAdmin(req.user.role) && entries.length) {
      const prior = await query(
        `SELECT student_id, status FROM student_enrollments
           WHERE school_year_id=$1 AND student_id = ANY($2::uuid[])`,
        [value.sy_id, entries.map(e => e.student_id)]
      )
      const stored = new Map(prior.rows.map(r => [r.student_id, r.status]))
      const changed = entries.filter(e => e.status !== (stored.get(e.student_id) || 'pending'))
      if (changed.length) {
        const named = changed.slice(0, 3).map(e => nameOf.get(e.student_id) || 'a learner').join(', ')
        const rest = changed.length > 3 ? ` and ${changed.length - 3} more` : ''
        throw new AppError(
          `Setting a learner's enrolment status is restricted to a super admin, so this save was ` +
          `refused: it would change the status of ${named}${rest}. Grade level and section can still be edited.`,
          403
        )
      }
    }

    await assertSectionsExist(value.sy_id, entries, (e) => nameOf.get(e.student_id) || 'Student')

    const saved = await withTransaction(async (client) => {
      let n = 0, removed = 0

      // "Not enrolled" is the absence of a record, so it is written by deleting
      // one. On the **active** year the `students` mirror has to follow, or the
      // learner keeps their grade level, section and 'enrolled' standing with no
      // record behind them — still on class lists for a year they are no longer
      // on. 'pending' is what the rollover gives anyone without a record, so it
      // is the same answer to the same question.
      for (const e of removals) {
        const r = await client.query(
          'DELETE FROM student_enrollments WHERE student_id=$1 AND school_year_id=$2',
          [e.student_id, value.sy_id]
        )
        removed += r.rowCount
        if (schoolYear.is_active) {
          await client.query(
            `UPDATE students SET enrollment_status='pending', updated_at=NOW()
              WHERE id=$1 AND is_active=TRUE`,
            [e.student_id]
          )
        }
      }

      for (const e of entries) {
        const r = await client.query(
          `INSERT INTO student_enrollments
             (student_id, school_year_id, grade_level, section, status, remarks, decided_by, decided_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
           ON CONFLICT (student_id, school_year_id) DO UPDATE
             SET grade_level=EXCLUDED.grade_level, section=EXCLUDED.section,
                 status=EXCLUDED.status, remarks=EXCLUDED.remarks,
                 decided_by=EXCLUDED.decided_by, decided_at=NOW(), updated_at=NOW()
           RETURNING id`,
          [e.student_id, value.sy_id, e.grade_level, e.section, e.status, e.remarks || null, req.user.id]
        )
        n += r.rowCount

        // Editing the year that is currently running has to move the learner
        // now — there is no later activation to pick the change up. Editing any
        // other year only writes the record; the rollover applies it when that
        // year is activated.
        if (schoolYear.is_active) {
          await client.query(
            `UPDATE students SET grade_level=$1, section=$2, enrollment_status=$3, updated_at=NOW()
              WHERE id=$4 AND is_active=TRUE`,
            [e.grade_level, e.section, e.status, e.student_id]
          )
        }
      }
      return { saved: n, removed }
    })

    const parts = []
    if (saved.saved)   parts.push(`${saved.saved} enrolment record${saved.saved === 1 ? '' : 's'} saved`)
    if (saved.removed) parts.push(`${saved.removed} removed`)

    res.json({
      message: `${parts.join(', ') || 'Nothing changed'} for SY ${schoolYear.label}.`,
      ...saved,
      applied_now: schoolYear.is_active,
    })
  } catch (err) { next(err) }
})

// ── DELETE /api/enrollment ───────────────────────────────────
// Remove a record entered by mistake. super_admin only: this erases the fact the
// learner attended that year at all, which is a different act from correcting the
// status they held in it — that stays open to every admin within their scope, both
// here via PUT and on the Students page. What blocks it beyond the role is what is
// attached to the record (assertNoOutcome / assertNoAcademicRecords), not the
// year's status; on the active year the mirror on `students` is reconciled below.
router.delete('/', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      sy_id:      Joi.string().uuid().required(),
      student_id: Joi.string().uuid().required(),
      allow_archived: Joi.boolean().default(false),
    }).validate(req.query)
    if (error) throw new AppError(error.details[0].message, 422)

    const schoolYear = await loadSchoolYear(value.sy_id)
    // Deleting an archived record erases the fact the learner attended that year
    // at all, so it sits behind the same unlock as editing one.
    assertArchivedWritable(req, schoolYear, value.allow_archived,
      `SY ${schoolYear.label} is archived, so its enrolment records are read-only. ` +
      'Unlock the school year on the Enrollment page to correct historical records.')

    // The record's own grade level, not the learner's current snapshot: this
    // deletes a past year's row, and the two diverge the moment a newer year is
    // activated.
    const owner = await query(
      `SELECT e.grade_level FROM student_enrollments e
         JOIN students s ON s.id = e.student_id
        WHERE e.student_id=$1 AND e.school_year_id=$2`,
      [value.student_id, value.sy_id]
    )
    if (!owner.rows.length) throw new AppError('Enrolment record not found.', 404)
    enforceGradeScope(req, owner.rows[0].grade_level)

    await assertNoOutcome(value.sy_id, [value.student_id])
    await assertNoAcademicRecords(value.sy_id, schoolYear.label, [value.student_id])

    await withTransaction(async (client) => {
      await client.query(
        'DELETE FROM student_enrollments WHERE student_id=$1 AND school_year_id=$2',
        [value.student_id, value.sy_id]
      )
      // Same reconciliation as PUT: on the active year the mirror must follow, or
      // the learner keeps an 'enrolled' standing with no record behind it.
      if (schoolYear.is_active) {
        await client.query(
          `UPDATE students SET enrollment_status='pending', updated_at=NOW()
            WHERE id=$1 AND is_active=TRUE`,
          [value.student_id]
        )
      }
    })
    res.json({ message: 'Enrolment record removed.' })
  } catch (err) { next(err) }
})

module.exports = router
