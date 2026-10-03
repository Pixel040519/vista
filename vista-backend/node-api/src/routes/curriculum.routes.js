const express = require('express')
const router  = express.Router()
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const { authenticate, authorizeAnyAdmin, authorizeSuperAdmin, enforceGradeScope } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { loadSection, sectionUsage, describeUsage, renameSectionEverywhere } = require('../utils/sections')
const { gradeScopeForRole, canManageGrade, isScopedAdmin, isSuperAdmin } = require('../utils/roles')
const { assertArchivedWritable } = require('../utils/schoolYear')
const { RATING_SCALES, resolveAssessment } = require('../utils/grading')
const { loadAssessmentRows } = require('../utils/assessmentConfig')
const { areasOf, assertGradeable, ensureMapehAreas, isMapeh } = require('../utils/subjectAreas')
const { NAME_KEY, normalizeName } = require('../utils/names')
// The same predicate the Enrollment roster filters on — see `utils/rosterSql.js`.
const { PREV_JOIN, BELONGS_TO_YEAR, withStudentAlias } = require('../utils/rosterSql')

// Look up a row's grade_level from one of the curriculum tables and enforce scope.
const assertCurriculumRowInScope = async (req, table, id) => {
  if (!isScopedAdmin(req.user.role)) return
  const r = await query(`SELECT grade_level FROM ${table} WHERE id=$1`, [id])
  if (!r.rows.length) throw new AppError('Not found.', 404)
  if (!canManageGrade(req.user.role, r.rows[0].grade_level)) {
    throw new AppError('Resource is outside your grade scope.', 403)
  }
  return r.rows[0].grade_level
}

const GRADE_LEVELS = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6']

const GRADE_ORDER = `CASE grade_level
  WHEN 'Kinder'  THEN 1
  WHEN 'Grade 1' THEN 2     WHEN 'Grade 2' THEN 3
  WHEN 'Grade 3' THEN 4     WHEN 'Grade 4' THEN 5
  WHEN 'Grade 5' THEN 6     WHEN 'Grade 6' THEN 7
  ELSE 8 END`

router.use(authenticate)

// ── Validate school year label + date alignment ───────────────
const validateSchoolYear = (label, start_date, end_date) => {
  const match = label && label.match(/^(\d{4})-(\d{4})$/)
  if (!match) return 'Format must be YYYY-YYYY (e.g. 2025-2026)'

  const y1 = parseInt(match[1])
  const y2 = parseInt(match[2])
  if (y2 !== y1 + 1) return `Second year must be exactly one after the first (e.g. ${y1}-${y1+1})`

  if (start_date) {
    const startYear = new Date(start_date).getFullYear()
    if (startYear !== y1) return `Start date year (${startYear}) must match the first year of the school year (${y1})`
  }
  if (end_date) {
    const endYear = new Date(end_date).getFullYear()
    if (endYear !== y2) return `End date year (${endYear}) must match the second year of the school year (${y2})`
  }
  return null
}


// ── Helper: resolve school_year_id ────────────────────────────
// Accepts ?sy_id=uuid or falls back to the active school year
const resolveSYId = async (sy_id) => {
  if (sy_id) return sy_id
  const res = await query('SELECT id FROM school_years WHERE is_active=TRUE LIMIT 1')
  if (!res.rows.length) throw new AppError('No active school year set.', 400)
  return res.rows[0].id
}

// ── Helper: an archived year's curriculum is read-only ────────
//
// Every write this router makes to a year's content — subjects, sections,
// advisers, grading structures, assessment configuration — lands in one school
// year, and an archived one is the record of how that year was actually taught
// and graded. So it is refused unless a super admin has unlocked the year on the
// Curriculum page, which then sends `?allow_archived=true`. Same gate as the
// Enrollment page (`assertArchivedWritable`), carried as a query parameter so it
// reaches DELETEs and leaves every body schema alone. School-year writes
// themselves are not gated: changing a year's status is how it is reopened.
const assertCurriculumYearWritable = async (req, syId) => {
  const r = await query(
    'SELECT id, label, is_active, is_upcoming FROM school_years WHERE id=$1', [syId])
  if (!r.rows.length) throw new AppError('School year not found.', 404)
  const sy = r.rows[0]
  assertArchivedWritable(req, sy, req.query.allow_archived === 'true',
    `SY ${sy.label} is archived, so its curriculum is read-only. ` +
    'Unlock it on the Curriculum page to correct it.')
}

/** The school year a subject or section row belongs to. */
const yearOfRow = async (table, id) => {
  const r = await query(`SELECT school_year_id FROM ${table} WHERE id=$1`, [id])
  if (!r.rows.length) throw new AppError(`${table === 'subjects' ? 'Subject' : 'Section'} not found.`, 404)
  return r.rows[0].school_year_id
}

// ════════════════════════════════════════════════════════════
// ASSESSMENT CONFIGURATION (per school year x grade level)
// ════════════════════════════════════════════════════════════
//
// DO 015, s. 2026 moves KS1 off numeric grading one grade level per year, but
// the schedule lives here as DATA, not code: NRYS is private (DO 015 only
// "encourages" adoption for private schools), so the school sets its own pace.

// GET /api/curriculum/assessment-config?sy_id=
// Returns every grade level with its resolved mode, flagging which ones are
// explicitly configured vs falling back to the default.
router.get('/assessment-config', async (req, res, next) => {
  try {
    const syId = await resolveSYId(req.query.sy_id)
    const rows = await loadAssessmentRows(syId)
    const scope = gradeScopeForRole(req.user.role)

    const config = GRADE_LEVELS
      .filter(gl => scope.includes(gl))
      .map(gl => {
        const a = resolveAssessment(gl, rows.get(gl) || null)
        return {
          grade_level: gl,
          assessment_mode: a.mode,
          rating_scale: a.scaleId,
          rating_scale_label: a.scale ? a.scale.label : null,
          levels: a.scale ? a.scale.levels : null,
          configured: a.configured,
        }
      })

    res.json({ sy_id: syId, config, scales: Object.values(RATING_SCALES).map(s => ({
      id: s.id, label: s.label, short: s.short, source: s.source, levels: s.levels,
    })) })
  } catch (err) { next(err) }
})

// PUT /api/curriculum/assessment-config
// { sy_id?, entries: [{ grade_level, assessment_mode, rating_scale? }] }
router.put('/assessment-config', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      sy_id: Joi.string().uuid().optional(),
      entries: Joi.array().items(Joi.object({
        grade_level:     Joi.string().valid(...GRADE_LEVELS).required(),
        assessment_mode: Joi.string().valid('numeric', 'descriptive').required(),
        rating_scale:    Joi.string().valid(...Object.keys(RATING_SCALES)).allow(null).optional(),
      })).min(1).required(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const syId = await resolveSYId(value.sy_id)
    await assertCurriculumYearWritable(req, syId)

    for (const e of value.entries) {
      enforceGradeScope(req, e.grade_level)
      if (e.assessment_mode === 'descriptive' && !e.rating_scale) {
        throw new AppError(`${e.grade_level}: a rating scale is required for descriptive grading.`, 422)
      }
    }

    // Changing a scale would orphan ratings recorded on the old one — 'E' is
    // Excellent under EGFNA but Emerging under ABCDE, so reinterpreting them
    // silently would turn top marks into failing ones. Block instead.
    for (const e of value.entries) {
      const scale = e.assessment_mode === 'descriptive' ? e.rating_scale : null
      const conflict = await query(
        `SELECT r.rating_scale, COUNT(*)::int AS n
           FROM ece_competency_records r
           JOIN students s ON s.id = r.student_id
          WHERE r.school_year_id = $1
            AND s.grade_level = $2
            AND ($3::text IS NULL OR r.rating_scale <> $3)
          GROUP BY r.rating_scale`,
        [syId, e.grade_level, scale]
      )
      if (conflict.rows.length) {
        const detail = conflict.rows.map(c => `${c.n} on ${c.rating_scale}`).join(', ')
        throw new AppError(
          `${e.grade_level} already has competency ratings recorded for this school year (${detail}). ` +
          `Delete or re-rate them before changing the scale — the same letter can mean different things on different scales.`,
          409
        )
      }
    }

    const saved = await withTransaction(async (client) => {
      const out = []
      for (const e of value.entries) {
        const r = await client.query(
          `INSERT INTO grade_level_assessment (school_year_id, grade_level, assessment_mode, rating_scale)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (school_year_id, grade_level)
           DO UPDATE SET assessment_mode = EXCLUDED.assessment_mode,
                         rating_scale    = EXCLUDED.rating_scale,
                         updated_at      = NOW()
           RETURNING grade_level, assessment_mode, rating_scale`,
          [syId, e.grade_level, e.assessment_mode,
           e.assessment_mode === 'descriptive' ? e.rating_scale : null]
        )
        out.push(r.rows[0])
      }
      return out
    })

    res.json({ message: `Assessment configuration saved for ${saved.length} grade level(s).`, config: saved })
  } catch (err) { next(err) }
})

// DELETE /api/curriculum/assessment-config/:grade_level?sy_id=
// Reverts one grade level to the built-in default.
router.delete('/assessment-config/:grade_level', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const gradeLevel = req.params.grade_level
    if (!GRADE_LEVELS.includes(gradeLevel)) throw new AppError('Unknown grade level.', 422)
    enforceGradeScope(req, gradeLevel)
    const syId = await resolveSYId(req.query.sy_id)
    await assertCurriculumYearWritable(req, syId)
    await query(
      'DELETE FROM grade_level_assessment WHERE school_year_id=$1 AND grade_level=$2',
      [syId, gradeLevel]
    )
    res.json({ message: `${gradeLevel} reverted to the default assessment mode.` })
  } catch (err) { next(err) }
})


// Rolling the school year over is what actually moves students. `students`
// carries the *current* grade_level/section/enrollment_status -- every roster
// query in the system reads those columns directly -- while
// `student_enrollments` holds the year-by-year record. Activating a year is the
// one moment the two are reconciled.
//
// A learner with no record for the incoming year is NOT carried over as
// enrolled: that is exactly the silent behaviour this replaces. They keep the
// grade level they left off at, so the admin can see where they stood, but go
// 'pending' and drop off the class lists until someone confirms them.
//
// `student_enrollments.status` is now a straight copy: it carries only the four
// attendance values, and the year-end outcome lives in its own column. (This
// UPDATE used to re-implement `mirrorStatus()` in SQL, which was a second copy
// of a rule that had to stay in step with the JS one.)
const rolloverStudents = async (client, schoolYearId) => {
  // Before adopting, fill in a section the record never got but the learner
  // plainly has.
  //
  // The adopt statement below copies `e.section` straight onto the snapshot, NULL
  // included — and a NULL there is very often an omission rather than a decision.
  // The promotion wizard places learners with no section, and nothing forces one
  // to be assigned afterwards, so the record can say NULL while `students.section`
  // still holds where the learner actually sits. Adopting over it destroyed the
  // only surviving evidence, which is what re-activating an earlier school year
  // exposed: the round trip wiped the section off every learner whose record for
  // that year had none.
  //
  // Backfilling the **record** rather than special-casing the adopt is what keeps
  // the two surfaces honest. The Enrollment page reads `e.section` directly
  // (`ROW_SECTION`), so preserving the snapshot alone would have left the Students
  // page showing a section the Enrollment page called Unassigned.
  //
  // The `sections` check is the whole safety of it. A snapshot section belongs to
  // the grade level the learner is *leaving*, so carrying it into a promotion would
  // put a Grade 1 section on a Grade 2 learner — a value not even in that row's own
  // options, and one `assertSectionsExist` would reject. It is kept only where the
  // name is a real section for the adopted grade level in this school year, which
  // is exactly the case where nothing has actually changed: re-activating a year
  // the learner already spent in that grade and section.
  await client.query(
    `UPDATE student_enrollments e
        SET section = s.section, updated_at = NOW()
       FROM students s
      WHERE s.id = e.student_id
        AND e.school_year_id = $1
        AND e.section IS NULL
        AND s.section IS NOT NULL
        AND s.is_active = TRUE
        AND EXISTS (
              SELECT 1 FROM sections sec
               WHERE sec.school_year_id = $1
                 AND sec.grade_level = e.grade_level
                 AND sec.name = s.section
        )`,
    [schoolYearId]
  )

  const adopted = await client.query(
    `UPDATE students s
        SET grade_level = e.grade_level,
            section = e.section,
            enrollment_status = e.status,
            updated_at = NOW()
       FROM student_enrollments e
      WHERE e.student_id = s.id AND e.school_year_id = $1 AND s.is_active = TRUE
      RETURNING s.id`,
    [schoolYearId]
  )

  // Learners who have left keep their standing. Marking a graduate or a
  // transferred-out learner 'pending' would quietly put them back on the
  // school's books every time a year is activated.
  //
  // The **grade level** is kept on purpose — it is where the learner left off, and
  // seeing it is how an admin knows where to enrol them. The **section** is not:
  // a section is only meaningful alongside its grade level *and* its school year,
  // and the one they are carrying belongs to the year that just ended. Keeping it
  // put learners in "Grade 2 / Mabuti" of a school year that has no Grade 2
  // sections at all — a class that does not exist, shown on the Students page as
  // if it did, and unmatchable by any section filter.
  //
  // Cleared only when it is not a real section of the incoming year for that
  // grade, so a school that reuses the same section names year to year keeps them
  // and nobody has to re-assign a roster that did not change. Same rule as the
  // backfill above, read the other way round.
  const pending = await client.query(
    `UPDATE students s
        SET enrollment_status = 'pending',
            section = CASE
              WHEN s.section IS NOT NULL AND EXISTS (
                   SELECT 1 FROM sections sec
                    WHERE sec.school_year_id = $1
                      AND sec.grade_level = s.grade_level
                      AND sec.name = s.section
              ) THEN s.section
              ELSE NULL
            END,
            updated_at = NOW()
      WHERE s.is_active = TRUE
        AND s.enrollment_status NOT IN ('transferred_out','dropped','graduated')
        AND NOT EXISTS (SELECT 1 FROM student_enrollments e
                         WHERE e.student_id = s.id AND e.school_year_id = $1)
      RETURNING s.id`,
    [schoolYearId]
  )

  return { adopted: adopted.rowCount, pending: pending.rowCount }
}

/**
 * The learners the closing year has finished with, taken off the active roll.
 *
 * `rolloverStudents()` above answers "where does everyone stand in the incoming
 * year". This answers the other half: who is not coming back at all. Without it
 * the Students page accumulated every learner the school ever had — a graduate
 * stayed on the roll forever, and someone who dropped two years ago still sat in
 * the list an admin scrolls every day.
 *
 * Judged entirely from the **closing** year's record, four ways:
 *
 *   - `status` is 'dropped' or 'transferred_out' — they stopped attending
 *   - `outcome` is 'graduated'                   — they finished the last grade
 *   - no record at all                           — never enrolled for that year
 *   - `status` is still 'pending'                — expected, never confirmed, and
 *                                                  the year is now over
 *
 * That last one is the roster's rule, not a new one: `LEFT_SQL` in
 * `utils/rosterSql.js` has always counted a learner left `pending` when their year
 * closed as having left, so later years' rosters already refuse to list them. The
 * archive said otherwise, and the two disagreeing is what left a learner who never
 * confirmed enrolment sitting on the active roll for good — on the Students page
 * but on no roster that could explain why.
 *
 * It bites only where nobody confirmed the learner all year, because the guard
 * below spares anyone with a record in the incoming year. A cohort the promotion
 * wizard placed forward is safe for that activation; a cohort left `pending`
 * through a whole year and never placed again is archived at the next one, which
 * the pre-flight count in the Edit School Year modal shows before the click.
 *
 * `archived_by` is left NULL, which is how the Students page tells a row it filed
 * itself from one an admin archived by hand.
 *
 * ── Two guards, both load-bearing ──
 *
 * A learner with a `pending` or `enrolled` record in the **incoming** year is
 * never archived, whatever the closing year says. Someone who dropped last year
 * and has been re-enrolled for the new one is coming back, and the promotion
 * wizard writes exactly such a row for everyone it places — archiving them would
 * empty the roster the wizard had just filled.
 *
 * The no-record branch is skipped entirely when the closing year holds no
 * enrolment records at all. Enrolment history only starts at the year that was
 * active when `2026_08_21_student_enrollments.sql` ran, so a year predating it
 * has no record for anybody — and that branch would then archive the whole
 * school in one click. The other three conditions read a record that exists, so
 * they are safe on such a year by construction.
 */
/**
 * "This learner has a record in the year being activated" — the single fact that
 * decides which side of the roll they land on, and the reason the two statements
 * below cannot contradict each other: the archive requires it to be false, the
 * restore requires it to be true.
 *
 * **Any** record counts, not just `pending`/`enrolled`. A learner who dropped
 * during the year now being activated is a fact *of* that year — the Students page
 * should list them with a Dropped badge, which is what the status column is for.
 * Archiving them would hide the very row an admin needs to see, and this predicate
 * used to say `status IN ('pending','enrolled')` for exactly that mistake.
 */
const IN_INCOMING_YEAR = `
              SELECT 1 FROM student_enrollments f
               WHERE f.student_id = s2.id
                 AND f.school_year_id = $1`

//
// Written once and shared with the pre-flight count below, so the number the Edit
// School Year modal shows before the click and the number activation actually
// archives cannot drift apart. Bound as $1 = incoming year id, $2 = closing year
// id, $3 = whether the closing year has any enrolment records at all.
const DEPARTED_FROM = `
       FROM students s2
       LEFT JOIN student_enrollments e
              ON e.student_id = s2.id AND e.school_year_id = $2
      WHERE s2.is_active = TRUE
        AND (
              e.outcome = 'graduated'
           OR e.status IN ('dropped','transferred_out','pending')
           OR (e.id IS NULL AND $3::boolean)
        )
        AND NOT EXISTS (${IN_INCOMING_YEAR})`

// Does the closing year have a roster at all? See the second guard above.
const closingYearIsRostered = async (runner, closingId) => {
  const r = await runner.query(
    'SELECT 1 FROM student_enrollments WHERE school_year_id=$1 LIMIT 1', [closingId]
  )
  return r.rowCount > 0
}

/**
 * The other direction: learners the year being activated brings back.
 *
 * Activation decides who is on the roll, and it has to decide **both ways** —
 * `archiveDepartedStudents()` on its own could only ever shrink the roll, so
 * switching back to an earlier school year left everyone that later years had
 * filed away still archived, including learners who plainly attended the year now
 * being activated. Reconciling one direction only is the same bug the rollover was
 * written to fix for the snapshot.
 *
 * **Who belongs is `BELONGS_TO_YEAR`** — the exact predicate the Enrollment page
 * filters its roster with, imported rather than restated. Anyone that year's roster
 * would list, and who is only archived because some activation filed them away,
 * comes back on the roll. The two questions are the same one, and answering them
 * separately is what went wrong: this used to restore *every* system archive when
 * reopening an earlier year, so going back to SY 2026-2027 revived learners who had
 * already dropped out in SY 2025-2026 — people that same year's roster correctly
 * refused to list. Now the archive reason never has to be interpreted; the records
 * decide, as of the year being activated.
 *
 * A record for the incoming year always wins, whatever it says — `pending`,
 * `enrolled`, and `dropped` too: dropping out *during* the year now running is a
 * fact of it, and the Students page should show that row with its Dropped badge
 * rather than hide the learner it describes.
 *
 * **Only system archives are lifted** (`archived_by IS NULL`). An admin who archived
 * a duplicate or a mistaken record by hand made a judgement about the record itself,
 * not about which year is running, and activation must not overturn it. That is what
 * the NULL convention is for.
 */
const restoreReturningStudents = async (client, incoming) => {
  const r = await client.query(
    `UPDATE students s
        SET is_active = TRUE,
            archived_at = NULL,
            archived_by = NULL,
            archived_reason = NULL,
            updated_at = NOW()
       FROM (
         SELECT s2.id
           FROM students s2
           LEFT JOIN student_enrollments e
                  ON e.student_id = s2.id AND e.school_year_id = $1
           ${withStudentAlias(PREV_JOIN, 's2')}
          WHERE s2.is_active = FALSE
            AND s2.archived_by IS NULL
            AND ${withStudentAlias(BELONGS_TO_YEAR, 's2')}
       ) d
      WHERE d.id = s.id
      RETURNING s.id`,
    [incoming.id, incoming.label]
  )
  return r.rowCount
}

const archiveDepartedStudents = async (client, incomingId, closing) => {
  if (!closing) return 0
  const rostered = await closingYearIsRostered(client, closing.id)

  const r = await client.query(
    `UPDATE students s
        SET is_active = FALSE,
            archived_at = NOW(),
            archived_by = NULL,
            archived_reason = d.reason,
            updated_at = NOW()
       FROM (
         SELECT s2.id,
                CASE
                  WHEN e.id IS NULL            THEN 'No enrolment record — SY ' || $4
                  WHEN e.outcome = 'graduated' THEN 'Graduated — SY ' || $4
                  WHEN e.status = 'dropped'    THEN 'Dropped — SY ' || $4
                  WHEN e.status = 'pending'    THEN 'Enrolment never confirmed — SY ' || $4
                  ELSE                              'Transferred out — SY ' || $4
                END AS reason
         ${DEPARTED_FROM}
       ) d
      WHERE d.id = s.id
      RETURNING s.id`,
    [incomingId, closing.id, rostered, closing.label]
  )

  return r.rowCount
}

// The same set, counted rather than written — the pre-flight number. Scoped by
// grade like everything else the readiness endpoint reports, so a scoped admin is
// told how many of *their* learners activation will file away.
const countReturningStudents = async (incoming) => {
  const r = await query(
    `SELECT COUNT(*)::int AS n
       FROM students s
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.school_year_id = $1
       ${PREV_JOIN}
      WHERE s.is_active = FALSE AND s.archived_by IS NULL AND ${BELONGS_TO_YEAR}`,
    [incoming.id, incoming.label]
  )
  return r.rows[0].n
}

const countDepartedStudents = async (incomingId, closing, role) => {
  if (!closing) return 0
  const rostered = await closingYearIsRostered({ query }, closing.id)
  const params = [incomingId, closing.id, rostered]
  let scope = ''
  if (isScopedAdmin(role)) {
    params.push(gradeScopeForRole(role))
    scope = ` AND s2.grade_level = ANY($${params.length}::text[])`
  }
  const r = await query(`SELECT COUNT(*)::int AS n ${DEPARTED_FROM}${scope}`, params)
  return r.rows[0].n
}

// ════════════════════════════════════════════════════════════
// SCHOOL YEARS
// ════════════════════════════════════════════════════════════

router.get('/school-years', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, label, is_active, is_upcoming, start_date, end_date,
              period_model, grading_policy, created_at
       FROM school_years ORDER BY label DESC`
    )
    res.json({ school_years: result.rows })
  } catch (err) { next(err) }
})

/**
 * Learners who finished a school year with no year-end outcome recorded.
 *
 * Only `enrolled` ones, matching the promotion wizard's own rule: someone who
 * transferred out, dropped, or was never confirmed did not finish the year, so
 * there is no verdict for them to be missing. Scoped admins count only their own
 * grade levels, like every other list here.
 */
const countUndecidedOutcomes = async (schoolYearId, role, client) => {
  const run = client ? client.query.bind(client) : query
  const params = [schoolYearId]
  let scope = ''
  if (isScopedAdmin(role)) {
    params.push(gradeScopeForRole(role))
    scope = ` AND s.grade_level = ANY($${params.length}::text[])`
  }
  const r = await run(
    `SELECT COUNT(*)::int AS n
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id
      WHERE e.school_year_id = $1 AND e.status = 'enrolled' AND e.outcome IS NULL
        AND s.is_active = TRUE${scope}`,
    params
  )
  return r.rows[0].n
}

/** The year that closes when `incomingId` is activated: whichever is active now. */
const loadClosingYear = async (incomingId) => {
  const r = await query(
    'SELECT id, label FROM school_years WHERE is_active=TRUE AND id <> $1 LIMIT 1',
    [incomingId]
  )
  return r.rows[0] || null
}

// GET /school-years/:id/enrollment-readiness
//
// Feeds the pre-flight panel in the Edit School Year modal: how many learners
// already have an enrolment record for this year, and how many would be marked
// pending if it were activated right now. Any admin may read it -- it is the
// warning that keeps activation from being a surprise, even though only a
// super_admin can pull the trigger.
router.get('/school-years/:id/enrollment-readiness', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const sy = await query('SELECT id, label, is_active FROM school_years WHERE id=$1', [req.params.id])
    if (!sy.rows.length) throw new AppError('School year not found.', 404)

    const params = [req.params.id]
    const conditions = ['s.is_active=TRUE']
    if (isScopedAdmin(req.user.role)) {
      params.push(gradeScopeForRole(req.user.role))
      conditions.push(`s.grade_level = ANY($${params.length}::text[])`)
    }

    const rows = await query(
      `SELECT COALESCE(e.status, 'none') AS status, COUNT(*)::int AS count
         FROM students s
         LEFT JOIN student_enrollments e ON e.student_id=s.id AND e.school_year_id=$1
        WHERE ${conditions.join(' AND ')}
        GROUP BY 1`,
      params
    )

    const by_status = Object.fromEntries(rows.rows.map(r => [r.status, r.count]))
    const total = rows.rows.reduce((a, r) => a + r.count, 0)
    const without_record = by_status.none || 0

    // The other half of the question. "Is this year ready to receive learners" is
    // only worth asking alongside "is the year they are leaving finished with" --
    // activating strands an undecided learner in a closed year that nothing will
    // reopen on its own, and the wizard is the only thing that can still judge them.
    const closing = await loadClosingYear(req.params.id)
    const undecided_outcomes = closing
      ? await countUndecidedOutcomes(closing.id, req.user.role)
      : 0

    // The third question, and the one with the most visible effect: how many
    // learners activation takes off the active roll altogether. Counted with the
    // same predicate the activation writes with, so the warning and the outcome
    // are the same set.
    // Same direction rule the activation itself uses: reopening an earlier year
    // archives nobody, because `closing` is then a *later* year and judging who has
    // left by it is backwards. See `rewinding` in `PUT /school-years/:id`.
    const rewinding = !!closing && closing.label > sy.rows[0].label
    const will_archive = rewinding ? 0 : await countDepartedStudents(req.params.id, closing, req.user.role)
    const will_restore = await countReturningStudents({ id: req.params.id, label: sy.rows[0].label })

    res.json({
      school_year: sy.rows[0],
      total_students: total,
      with_record: total - without_record,
      without_record,
      by_status,
      closing_school_year: closing,
      undecided_outcomes,
      will_archive,
      will_restore,
      rewinding,
    })
  } catch (err) { next(err) }
})

router.post('/school-years', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      label:       Joi.string().pattern(/^\d{4}-\d{4}$/).required()
                     .messages({ 'string.pattern.base': 'Format must be YYYY-YYYY (e.g. 2025-2026)' }),
      is_active:   Joi.boolean().default(false),
      is_upcoming: Joi.boolean().default(false),
      start_date:  Joi.date().optional().allow(null),
      end_date:    Joi.date().optional().allow(null),
      // DepEd DO 009 / DO 015, s. 2026 — the grading model is per school year.
      period_model:   Joi.string().valid('4Q', '3T').default('4Q'),
      grading_policy: Joi.string().valid('DO8_2015', 'DO15_2026', 'ZERO_BASED').default('DO8_2015'),
      copy_from_id: Joi.string().uuid().optional().allow(null), // copy subjects+sections from this SY
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    if (value.is_active && value.is_upcoming) throw new AppError('A school year cannot be both active and upcoming.', 422)

    const syErr = validateSchoolYear(value.label, value.start_date, value.end_date)
    if (syErr) throw new AppError(syErr, 422)

    if (value.is_upcoming) {
      const endYear = parseInt(value.label.split('-')[1])
      if (endYear <= new Date().getFullYear()) throw new AppError('Past school years cannot be tagged as upcoming.', 422)
    }

    const dup = await query('SELECT id FROM school_years WHERE label=$1', [value.label])
    if (dup.rows.length) throw new AppError(`School year "${value.label}" already exists.`, 409)

    const sy = await withTransaction(async (client) => {
      if (value.is_active) await client.query(`UPDATE school_years SET is_active=FALSE, updated_at=NOW()`)
      const syRes = await client.query(
        `INSERT INTO school_years (label, is_active, is_upcoming, start_date, end_date, period_model, grading_policy)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, label, is_active, is_upcoming, start_date, end_date, period_model, grading_policy, created_at`,
        [value.label, value.is_active, value.is_upcoming, value.start_date || null, value.end_date || null,
         value.period_model, value.grading_policy]
      )
      const newSY = syRes.rows[0]

      // Copy subjects & sections from another school year
      if (value.copy_from_id) {
        // Two passes, because `parent_id` points at a row in the *source* year
        // and has to be remapped to its copy. Learning areas first, then their
        // areas, re-matched by (school_year_id, grade_level, name) — the same
        // name-based re-match the grading-structure copy 40 lines below uses.
        // Unlike an adviser, a subject tree is a timetable that repeats, so
        // carrying MAPEH's four areas forward is exactly right.
        await client.query(
          `INSERT INTO subjects (name, grade_level, school_year_id)
           SELECT name, grade_level, $1 FROM subjects
           WHERE school_year_id=$2 AND is_active=TRUE AND parent_id IS NULL
           ON CONFLICT DO NOTHING`,
          [newSY.id, value.copy_from_id]
        )
        await client.query(
          `INSERT INTO subjects (name, grade_level, school_year_id, parent_id)
           SELECT area.name, area.grade_level, $1, newparent.id
             FROM subjects area
             JOIN subjects oldparent ON oldparent.id = area.parent_id
             JOIN subjects newparent ON newparent.school_year_id = $1
                                    AND newparent.grade_level    = oldparent.grade_level
                                    AND newparent.name           = oldparent.name
                                    AND newparent.is_active      = TRUE
            WHERE area.school_year_id=$2 AND area.is_active=TRUE AND area.parent_id IS NOT NULL
           ON CONFLICT DO NOTHING`,
          [newSY.id, value.copy_from_id]
        )
        // Name and grade level only — `adviser_id` is deliberately not copied,
        // which is where this departs from the teacher-assignment copy 40 lines
        // below. A subject assignment is a timetable that mostly repeats; an
        // advisory is a fresh decision each year about who is responsible for a
        // cohort. Copying one forward would also carry a stale adviser — someone
        // who has since left or moved grade levels — into a year nobody has
        // reviewed, and the one-per-teacher-per-year index would then block the
        // correct assignment until an admin found and cleared the copy.
        await client.query(
          `INSERT INTO sections (name, grade_level, school_year_id)
           SELECT name, grade_level, $1 FROM sections
           WHERE school_year_id=$2 AND is_active=TRUE
           ON CONFLICT DO NOTHING`,
          [newSY.id, value.copy_from_id]
        )

        // A MAPEH the source year never had areas for (one created before this
        // rule, or one that was blocked then) still arrives split, so the new
        // year is correct regardless of the state of the year it came from.
        const newMapeh = await client.query(
          `SELECT id, name, grade_level, school_year_id, parent_id FROM subjects
            WHERE school_year_id=$1 AND is_active=TRUE AND parent_id IS NULL`,
          [newSY.id]
        )
        for (const sub of newMapeh.rows) await ensureMapehAreas(client, sub)

        // Copy grading structures: fetch old categories, insert as new, then copy children
        const oldCats = await client.query(
          `SELECT gs.id AS old_id, gs.name, gs.weight, gs.sort_order,
                  old_sub.name AS sub_name, old_sub.grade_level
           FROM grading_structure gs
           JOIN subjects old_sub ON old_sub.id = gs.subject_id
           WHERE old_sub.school_year_id = $1
             AND gs.category_id IS NULL AND gs.is_active = TRUE
           ORDER BY gs.sort_order`,
          [value.copy_from_id]
        )
        for (const cat of oldCats.rows) {
          // Find the matching new subject
          const newSub = await client.query(
            `SELECT id FROM subjects WHERE school_year_id=$1 AND name=$2 AND grade_level=$3 AND is_active=TRUE LIMIT 1`,
            [newSY.id, cat.sub_name, cat.grade_level]
          )
          if (!newSub.rows.length) continue
          const newSubId = newSub.rows[0].id

          // Insert the category
          const newCat = await client.query(
            `INSERT INTO grading_structure (subject_id, category_id, name, weight, sort_order)
             VALUES ($1, NULL, $2, $3, $4) RETURNING id`,
            [newSubId, cat.name, cat.weight, cat.sort_order]
          )
          // Copy child components
          await client.query(
            `INSERT INTO grading_structure (subject_id, category_id, name, weight, sort_order)
             SELECT $1, $2, gs.name, gs.weight, gs.sort_order
             FROM grading_structure gs
             WHERE gs.category_id = $3 AND gs.is_active = TRUE
             ORDER BY gs.sort_order`,
            [newSubId, newCat.rows[0].id, cat.old_id]
          )
        }

        // Copy teacher assignments from source school year
        const srcSY = await client.query('SELECT label FROM school_years WHERE id=$1', [value.copy_from_id])
        if (srcSY.rows.length) {
          await client.query(
            `INSERT INTO teacher_assignments (teacher_id, grade_level, section, subject, school_year)
             SELECT teacher_id, grade_level, section, subject, $1
             FROM teacher_assignments
             WHERE school_year=$2
             ON CONFLICT DO NOTHING`,
            [newSY.label, srcSY.rows[0].label]
          )
        }
      }

      return newSY
    })

    res.status(201).json({ message: 'School year created.', school_year: sy })
  } catch (err) { next(err) }
})

router.put('/school-years/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      label:       Joi.string().pattern(/^\d{4}-\d{4}$/).optional()
                     .messages({ 'string.pattern.base': 'Format must be YYYY-YYYY' }),
      is_active:   Joi.boolean().optional(),
      is_upcoming: Joi.boolean().optional(),
      start_date:  Joi.date().optional().allow(null),
      end_date:    Joi.date().optional().allow(null),
      period_model:   Joi.string().valid('4Q', '3T').optional(),
      grading_policy: Joi.string().valid('DO8_2015', 'DO15_2026', 'ZERO_BASED').optional(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    // One read of the current row serves every guard below, and the rollover
    // needs `is_active` regardless of which fields were submitted.
    const existingRes = await query(
      `SELECT label, is_active, is_upcoming, start_date, end_date, period_model, grading_policy
         FROM school_years WHERE id=$1`,
      [req.params.id]
    )
    if (!existingRes.rows.length) throw new AppError('School year not found.', 404)
    const existing = existingRes.rows[0]

    // An archived year is closed, so its grading model is frozen: changing it would
    // silently re-transmute grades that were already issued. Only a real change is
    // rejected -- the edit modal resubmits the current values verbatim, and that
    // no-op must keep working.
    if (value.period_model !== undefined || value.grading_policy !== undefined) {
      const archived = !existing.is_active && !existing.is_upcoming
      const changed =
        (value.period_model   !== undefined && value.period_model   !== (existing.period_model   || '4Q')) ||
        (value.grading_policy !== undefined && value.grading_policy !== (existing.grading_policy || 'DO8_2015'))
      if (archived && changed) {
        throw new AppError(
          'The grading model of an archived school year cannot be changed. Its grades were already issued and must stay reproducible.',
          409
        )
      }
    }

    // Validate label+dates alignment if any of them are being updated
    if (value.label || value.start_date || value.end_date) {
      const checkLabel = value.label || existing.label
      const checkStart = value.start_date !== undefined ? value.start_date : existing.start_date
      const checkEnd   = value.end_date   !== undefined ? value.end_date   : existing.end_date
      const syErr = validateSchoolYear(checkLabel, checkStart, checkEnd)
      if (syErr) throw new AppError(syErr, 422)
    }

    if (value.is_active && value.is_upcoming) throw new AppError('A school year cannot be both active and upcoming.', 422)

    if (value.is_upcoming === true) {
      const endYear = parseInt((value.label || existing.label).split('-')[1])
      if (endYear <= new Date().getFullYear()) throw new AppError('Past school years cannot be tagged as upcoming.', 422)
    }

    const sets=[]; const params=[]
    if (value.label      !== undefined) { params.push(value.label);       sets.push(`label=$${params.length}`) }
    if (value.is_active  !== undefined) { params.push(value.is_active);   sets.push(`is_active=$${params.length}`) }
    if (value.is_upcoming !== undefined){ params.push(value.is_upcoming);  sets.push(`is_upcoming=$${params.length}`) }
    if (value.start_date !== undefined) { params.push(value.start_date);  sets.push(`start_date=$${params.length}`) }
    if (value.end_date   !== undefined) { params.push(value.end_date);    sets.push(`end_date=$${params.length}`) }
    if (value.period_model   !== undefined) { params.push(value.period_model);   sets.push(`period_model=$${params.length}`) }
    if (value.grading_policy !== undefined) { params.push(value.grading_policy); sets.push(`grading_policy=$${params.length}`) }
    if (!sets.length) throw new AppError('Nothing to update.', 400)
    sets.push('updated_at=NOW()')
    params.push(req.params.id)

    // Switching the school year is the moment students move. Anything else is
    // just an edit to the year's own metadata.
    const activating = value.is_active === true && !existing.is_active
    // Read before the transaction: the first thing it does is clear `is_active`
    // on every other year, after which there is nothing left to identify the year
    // being closed. Outcomes are not touched by activation, so the count is the
    // same either side of it.
    const closing = activating ? await loadClosingYear(req.params.id) : null
    const undecidedOutcomes = closing
      ? await countUndecidedOutcomes(closing.id, req.user.role)
      : 0

    const result = await withTransaction(async (client) => {
      // Enforce single-active across all school years
      if (value.is_active === true) await client.query(`UPDATE school_years SET is_active=FALSE, updated_at=NOW() WHERE id!=$1`, [req.params.id])
      // Mutual exclusivity on this row: activating clears upcoming and vice versa
      if (value.is_active   === true && value.is_upcoming === undefined) sets.push('is_upcoming=FALSE')
      if (value.is_upcoming === true && value.is_active   === undefined) sets.push('is_active=FALSE')
      const r = await client.query(
        `UPDATE school_years SET ${sets.join(',')}
         WHERE id=$${params.length}
         RETURNING id, label, is_active, is_upcoming, start_date, end_date,
                   period_model, grading_policy, created_at`,
        params
      )
      if (!r.rows.length) throw new AppError('School year not found.', 404)

      // Three statements, and the order is the whole design.
      //
      // Restore first: `rolloverStudents` only adopts a record onto a row where
      // `s.is_active = TRUE`, so a learner still archived when it runs would come
      // back holding a stale grade level and section from whenever they left.
      //
      // Archive last, so it can overrule the `'pending'` the rollover just wrote
      // for someone who is not coming back. It cannot undo the restore either way —
      // the two read the same `IN_INCOMING_YEAR` predicate from opposite sides.
      //
      // ── Direction matters, but only to the archive ──
      //
      // `closing` is just "whichever year was active before this click", and when
      // an admin reopens an **earlier** year that is a year which comes *after* the
      // one now running. Judging who has left by it is backwards: a learner who
      // graduated in 2025-2026 did not leave before 2024-2025, they were sitting in
      // it. So rewinding archives nobody.
      //
      // The **restore** needs no such special case, and giving it one was a bug: it
      // used to bring back every system archive when rewinding, which revived
      // learners who had left in a year earlier than the one being reopened. It now
      // asks `BELONGS_TO_YEAR` — the roster's own predicate, evaluated as of the
      // incoming year — so who comes back is decided by the records, in both
      // directions, and matches exactly who that year's roster lists.
      const rewinding = !!closing && closing.label > existing.label
      const rollover = activating
        ? await (async () => {
            const restored = await restoreReturningStudents(client, { id: req.params.id, label: existing.label })
            const moved    = await rolloverStudents(client, req.params.id)
            const archived = rewinding
              ? 0
              : await archiveDepartedStudents(client, req.params.id, closing)
            return {
              ...moved,
              restored,
              archived,
              rewinding,
              closing_school_year: closing,
              undecided_outcomes: undecidedOutcomes,
            }
          })()
        : null
      return { school_year: r.rows[0], rollover }
    })

    res.json({
      message: 'School year updated.',
      school_year: result.school_year,
      rollover: result.rollover,
    })
  } catch (err) { next(err) }
})

router.delete('/school-years/:id', authorizeSuperAdmin, async (req, res, next) => {
  try {
    const sy = await query('SELECT label, is_active FROM school_years WHERE id=$1', [req.params.id])
    if (!sy.rows.length) throw new AppError('School year not found.', 404)
    if (sy.rows[0].is_active) throw new AppError('Cannot delete the active school year.', 409)

    const inUse = await query(
      `SELECT COUNT(*) FROM grades WHERE school_year=$1`, [sy.rows[0].label]
    )
    if (parseInt(inUse.rows[0].count) > 0) {
      throw new AppError('Cannot delete: this school year has existing grade records.', 409)
    }

    await query('DELETE FROM school_years WHERE id=$1', [req.params.id])
    res.json({ message: `School year "${sy.rows[0].label}" deleted.` })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// SUBJECTS  (all filtered by school_year_id)
// ════════════════════════════════════════════════════════════
//
// A subject with `parent_id IS NULL` is a **learning area** — which is every
// subject that existed before MAPEH was split. A non-NULL `parent_id` makes it
// an **area** of one (Music, Arts, Physical Education, Health).
//
// These reads default to learning areas only, because "the subjects of Grade 4"
// means the learning areas in every existing caller: the Attendance dropdown,
// the teacher-assignment picker, the grading-structure "copy from" picker. The
// surfaces that need the level below ask for it — Score Entry and the Grades
// page, whose Subject dropdowns list learning areas while their area tab strips
// need the areas, and the Subjects tab — see `include_areas` and
// `/subjects/grouped`.

// Columns every subject read returns. `area_count` is what tells a caller a
// learning area is graded through its areas and so is not itself gradeable.
const SUBJECT_COLS = `s.id, s.name, s.grade_level, s.parent_id, s.school_year_id, s.created_at,
              p.name AS parent_name,
              (SELECT COUNT(*)::int FROM subjects a
                WHERE a.parent_id = s.id AND a.is_active = TRUE) AS area_count,
              EXISTS(SELECT 1 FROM grading_structure gs
                      WHERE gs.subject_id = s.id AND gs.is_active = TRUE) AS has_grading`

router.get('/subjects', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const conditions = ['s.school_year_id=$1', 's.is_active=TRUE']
    const params = [sy_id]
    if (req.query.grade_level) { params.push(req.query.grade_level); conditions.push(`s.grade_level=$${params.length}`) }
    if (isScopedAdmin(req.user.role)) {
      params.push(gradeScopeForRole(req.user.role))
      conditions.push(`s.grade_level = ANY($${params.length}::text[])`)
    }
    // Opt in to the areas; every caller that does not ask means learning areas.
    if (String(req.query.include_areas) !== 'true') conditions.push('s.parent_id IS NULL')

    const result = await query(
      `SELECT ${SUBJECT_COLS}
       FROM subjects s LEFT JOIN subjects p ON p.id = s.parent_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${GRADE_ORDER.replace(/grade_level/g, 's.grade_level')},
                COALESCE(p.name, s.name), s.parent_id NULLS FIRST, s.name`, params
    )
    res.json({ subjects: result.rows })
  } catch (err) { next(err) }
})

// The Subjects tab's read. Returns the tree: one entry per learning area, each
// carrying its `areas` — so the tab can render MAPEH with its four indented
// beneath it without a second request.
router.get('/subjects/grouped', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const scope = gradeScopeForRole(req.user.role)
    const result = await query(
      `SELECT ${SUBJECT_COLS}
       FROM subjects s LEFT JOIN subjects p ON p.id = s.parent_id
       WHERE s.school_year_id=$1 AND s.is_active=TRUE
         AND s.grade_level = ANY($2::text[])
       ORDER BY ${GRADE_ORDER.replace(/grade_level/g, 's.grade_level')}, s.name`, [sy_id, scope]
    )
    const grouped = {}
    for (const gl of scope) grouped[gl] = []
    const byId = new Map()
    for (const row of result.rows) {
      if (row.parent_id) continue
      row.areas = []
      byId.set(row.id, row)
      if (grouped[row.grade_level]) grouped[row.grade_level].push(row)
    }
    for (const row of result.rows) {
      if (!row.parent_id) continue
      const parent = byId.get(row.parent_id)
      if (parent) parent.areas.push(row)
    }
    res.json({ grouped })
  } catch (err) { next(err) }
})

// Re-read one subject in the shape every subject endpoint returns.
const loadSubjectRow = async (id) => {
  const r = await query(
    `SELECT ${SUBJECT_COLS}
       FROM subjects s LEFT JOIN subjects p ON p.id = s.parent_id
      WHERE s.id = $1`, [id])
  return r.rows[0] || null
}

/**
 * Refuse a subject name another subject in the same grade level and school year
 * already answers to. Shared by create and rename so the two cannot disagree.
 *
 * Names are compared ignoring case and spacing (`NAME_KEY`): "mapeH"
 * beside "MAPEH" is the same learning area to a teacher, a report card and every
 * `teacher_assignments` row holding it by name, and a second row would split its
 * grades and attendance in two. `subjects_sy_grade_name_ci_unique` backs this
 * up, but only this can say *which* subject is in the way.
 *
 * Three more cases, each with its own sentence:
 * - the name belongs to an **area** ("Music" while MAPEH is graded through one);
 * - a **dormant** row holds the exact name, which the original byte-for-byte
 *   constraint still enforces — a differently cased dormant row does not block;
 * - a **second MAPEH** under another name ("MAPEH 4" beside "MAPEH"): the grade
 *   level would have two learning areas competing for the same four areas.
 */
const assertSubjectNameFree = async ({ sy_id, grade_level, name, excludeId = null }) => {
  const r = await query(
    `SELECT s.id, s.name, s.is_active, s.parent_id, p.name AS parent_name,
            ${NAME_KEY('s.name')} = ${NAME_KEY('$3::text')} AS same_name
       FROM subjects s LEFT JOIN subjects p ON p.id = s.parent_id
      WHERE s.school_year_id = $1 AND s.grade_level = $2
        AND s.id IS DISTINCT FROM $4::uuid`,
    [sy_id, grade_level, name, excludeId])
  const rows = r.rows

  const live = rows.find(s => s.is_active && s.same_name)
  if (live) {
    if (live.parent_id) {
      throw new AppError(
        `"${live.name}" is already one of ${live.parent_name}'s areas in ${grade_level}.`, 409)
    }
    throw new AppError(live.name === name
      ? `"${name}" already exists in ${grade_level} for this school year.`
      : `"${name}" is the same subject as "${live.name}", which already exists in ${grade_level} ` +
        `for this school year. Subject names are not case-sensitive.`, 409)
  }

  if (rows.some(s => !s.is_active && s.name === name)) {
    throw new AppError(
      `"${name}" was removed from ${grade_level} earlier this school year and that record ` +
      `still holds the name. Choose a different name.`, 409)
  }

  if (isMapeh(name)) {
    const other = rows.find(s => s.is_active && !s.parent_id && isMapeh(s.name))
    if (other) {
      throw new AppError(
        `${grade_level} already has "${other.name}". A grade level has one MAPEH, ` +
        `graded through Music, Arts, Physical Education and Health.`, 409)
    }
  }
}

router.post('/subjects', authorizeAnyAdmin, async (req, res, next) => {
  try {
    // No `parent_id`. Areas are not composed by hand — MAPEH's four are created
    // for it by `ensureMapehAreas()`, which is the only writer of an area row.
    const { error, value } = Joi.object({
      name:         Joi.string().trim().min(1).max(100).required(),
      grade_level:  Joi.string().valid(...GRADE_LEVELS).required(),
      sy_id:        Joi.string().uuid().optional(),
    }).validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    enforceGradeScope(req, value.grade_level)

    const sy_id = await resolveSYId(value.sy_id)
    await assertCurriculumYearWritable(req, sy_id)
    value.name = normalizeName(value.name)
    await assertSubjectNameFree({ sy_id, grade_level: value.grade_level, name: value.name })

    const created = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO subjects (name, grade_level, school_year_id)
         VALUES ($1,$2,$3) RETURNING id, name, grade_level, school_year_id, parent_id`,
        [value.name, value.grade_level, sy_id]
      )
      // A new MAPEH arrives already graded through Music, Arts, Physical
      // Education and Health — in the same transaction, so it is never briefly
      // a flat subject someone could start entering marks against.
      await ensureMapehAreas(client, result.rows[0])
      return result.rows[0].id
    })

    const subject = await loadSubjectRow(created)
    res.status(201).json({
      message: subject.area_count
        ? `Subject added, graded through its ${subject.area_count} areas.`
        : 'Subject added.',
      subject,
    })
  } catch (err) { next(err) }
})

router.put('/subjects/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().trim().min(1).max(100).optional(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).optional(),
    }).validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    await assertCurriculumRowInScope(req, 'subjects', req.params.id)
    await assertCurriculumYearWritable(req, await yearOfRow('subjects', req.params.id))
    if (value.grade_level) enforceGradeScope(req, value.grade_level)

    const existing = await query(
      'SELECT id, name, grade_level, school_year_id, parent_id FROM subjects WHERE id=$1 AND is_active=TRUE',
      [req.params.id])
    if (!existing.rows.length) throw new AppError('Subject not found.', 404)
    const cur = existing.rows[0]

    // An area sits in its learning area's grade level by construction.
    if (value.grade_level && cur.parent_id && value.grade_level !== cur.grade_level) {
      throw new AppError('An area follows its learning area — move the learning area instead.', 422)
    }
    // A rename, or a move to another grade level, has to land on a free name.
    // Excluding this row lets a case-only correction ("MAPEh" -> "MAPEH") through.
    if (value.name) value.name = normalizeName(value.name)
    if ((value.name && value.name !== cur.name) ||
        (value.grade_level && value.grade_level !== cur.grade_level)) {
      await assertSubjectNameFree({
        sy_id: cur.school_year_id,
        grade_level: value.grade_level || cur.grade_level,
        name: value.name || cur.name,
        excludeId: cur.id,
      })
    }

    const sets=[]; const params=[]
    if (value.name)        { params.push(value.name);        sets.push(`name=$${params.length}`) }
    if (value.grade_level) { params.push(value.grade_level); sets.push(`grade_level=$${params.length}`) }
    if (!sets.length) throw new AppError('Nothing to update.', 400)
    sets.push('updated_at=NOW()')
    params.push(req.params.id)

    const result = await query(
      `UPDATE subjects SET ${sets.join(',')}
       WHERE id=$${params.length} AND is_active=TRUE RETURNING id, name, grade_level, school_year_id, parent_id`, params
    )
    if (!result.rows.length) throw new AppError('Subject not found.', 404)
    // A subject renamed to MAPEH is a MAPEH, and gets its areas like any other.
    // Renaming one of the four (Physical Education -> P.E.) is a no-op here:
    // ensureMapehAreas only fills in a MAPEH that has none at all.
    await ensureMapehAreas(null, result.rows[0])
    res.json({ message: 'Subject updated.', subject: await loadSubjectRow(req.params.id) })
  } catch (err) { next(err) }
})

// ── What deleting a subject would take with it ───────────────
//
// Split by what it is. **Recorded work** — grades, attendance, competency
// ratings, score items — blocks the delete: it was entered against this subject
// by a teacher and must never go with it. Grades alone used to be the test,
// which let a Kinder subject full of ratings go (Kinder never writes `grades`),
// and any subject with attendance but no grades yet. **Setup** — the grading
// structure and competency skills — does not block, because it is
// configuration rather than anything a learner did; the delete removes it for
// good, so the confirmation names it first.
//
// Counted over the whole family: deleting MAPEH takes its four areas, so work
// recorded under Music blocks it exactly as work under MAPEH itself would.
//
// Takes a transaction client when given one — the DELETE re-counts inside its
// transaction, after locking the rows.
const subjectUsage = async (ids, client = null) => {
  const r = await (client ? client.query.bind(client) : query)(
    `SELECT
       (SELECT COUNT(*) FROM grades     WHERE subject_id = ANY($1::uuid[]))::int AS grades,
       (SELECT COUNT(*) FROM attendance WHERE subject_id = ANY($1::uuid[]))::int AS attendance,
       (SELECT COUNT(*) FROM ece_competency_records rec
          JOIN competency_skills k ON k.id = rec.skill_id
         WHERE k.subject_id = ANY($1::uuid[]))::int AS ratings,
       (SELECT COUNT(*) FROM score_items
         WHERE subject_id = ANY($1::uuid[]) AND is_active = TRUE)::int AS score_items,
       (SELECT COUNT(*) FROM grading_structure
         WHERE subject_id = ANY($1::uuid[]) AND is_active = TRUE AND category_id IS NULL)::int AS categories,
       (SELECT COUNT(DISTINCT subject_id) FROM grading_structure
         WHERE subject_id = ANY($1::uuid[]) AND is_active = TRUE)::int AS structured,
       (SELECT COUNT(*) FROM competency_skills
         WHERE subject_id = ANY($1::uuid[]) AND is_active = TRUE)::int AS skills`,
    [ids])
  const u = r.rows[0]
  return {
    blocking: { grades: u.grades, attendance: u.attendance, ratings: u.ratings, score_items: u.score_items },
    setup:    { categories: u.categories, structured: u.structured, skills: u.skills },
  }
}

const countOf = (n, one, many) => `${n} ${n === 1 ? one : many}`

// "2 learners, 4 teacher assignments and 30 score items are" — shared by the
// subject and section refusals so the two read alike.
const countsSentence = (parts) => {
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]
  return `${list} ${parts.length === 1 && /^1 /.test(list) ? 'is' : 'are'}`
}

/** The refusal sentence, or null when nothing recorded stands in the way. */
const subjectDeleteBlocker = (row, areaCount, { blocking: b }) => {
  const parts = []
  if (b.grades)      parts.push(countOf(b.grades, 'grade', 'grades'))
  if (b.attendance)  parts.push(countOf(b.attendance, 'attendance record', 'attendance records'))
  if (b.ratings)     parts.push(countOf(b.ratings, 'competency rating', 'competency ratings'))
  if (b.score_items) parts.push(countOf(b.score_items, 'score item', 'score items'))
  if (!parts.length) return null
  return `Cannot delete "${row.name}": ${countsSentence(parts)} ` +
    `recorded under it${areaCount ? ' and its areas' : ''}. A subject can only be deleted ` +
    `before any work has been recorded against it.`
}

/**
 * The section counterpart: everything that holds the section by name, from
 * `sectionUsage()`. Learners are named in preference to enrolment records —
 * on the active year they are the same people counted twice.
 */
const sectionDeleteBlocker = (sec, u) => {
  const parts = []
  if (u.learners)         parts.push(countOf(u.learners, 'learner', 'learners'))
  else if (u.enrolments)  parts.push(countOf(u.enrolments, 'enrolment record', 'enrolment records'))
  if (u.assignments)      parts.push(countOf(u.assignments, 'teacher assignment', 'teacher assignments'))
  if (u.classes)          parts.push(countOf(u.classes, 'class assignment', 'class assignments'))
  if (u.score_items)      parts.push(countOf(u.score_items, 'score item', 'score items'))
  if (!parts.length) return null
  return `Cannot delete "${sec.name}": ${countsSentence(parts)} still in it ` +
    `(${sec.grade_level}, SY ${sec.label}). A section can only be deleted once it is empty.`
}

/** Load a subject for the delete paths, with the scope check both need. */
const loadSubjectForDelete = async (req) => {
  const sub = await query(
    'SELECT id, name, grade_level, school_year_id, parent_id FROM subjects WHERE id=$1', [req.params.id])
  if (!sub.rows.length) throw new AppError('Subject not found.', 404)
  const row = sub.rows[0]
  if (isScopedAdmin(req.user.role) && !canManageGrade(req.user.role, row.grade_level)) {
    throw new AppError('Subject is outside your grade scope.', 403)
  }
  const areas = row.parent_id ? [] : await areasOf(row.id)
  return { row, areas, family: [row.id, ...areas.map(a => a.id)] }
}

// Read-only: what the delete confirmation shows before the admin commits, and
// the same verdict `DELETE` reaches, so the panel cannot promise a delete the
// API then refuses.
router.get('/subjects/:id/usage', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { row, areas, family } = await loadSubjectForDelete(req)
    const usage = await subjectUsage(family)
    res.json({
      ...usage,
      area_count: areas.length,
      blocked_reason: subjectDeleteBlocker(row, areas.length, usage),
    })
  } catch (err) { next(err) }
})

router.delete('/subjects/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { row, areas, family } = await loadSubjectForDelete(req)
    await assertCurriculumYearWritable(req, row.school_year_id)

    // An area is structural, not something an admin assembled: MAPEH is graded
    // through exactly its four wherever it exists. Removing one on its own would
    // leave the learning area quietly averaging three, and nothing would put it
    // back — `ensureMapehAreas()` only fills in a MAPEH that has *no* areas.
    // Deleting the learning area takes them with it (below); renaming one is
    // always allowed, since a school may write "P.E.".
    if (row.parent_id) {
      const parent = await loadSubjectRow(row.parent_id)
      throw new AppError(
        `"${row.name}" is one of ${parent ? parent.name : 'its learning area'}'s areas ` +
        `and cannot be removed on its own — its grade is part of that average. ` +
        `Delete ${parent ? `"${parent.name}"` : 'the learning area'} to remove all of ` +
        `them, or rename this one if the school calls it something else.`, 409)
    }

    // A learning area goes with its areas: they exist only for it, which is what
    // the FK's ON DELETE CASCADE already says. So the usage check covers the
    // whole family (see `subjectUsage`).
    //
    // The row is deleted outright, not soft-deleted. Recorded work refuses the
    // delete, so nothing a learner did ever pointed at it, and a hidden row only
    // kept holding the name — a subject removed by mistake could not simply be
    // added back. The FKs then cascade the setup: grading structure, score items
    // (with their scores), competency skills (with their ratings), and the areas
    // themselves. `academic_predictions` is the one table without a cascade; it
    // is derived data, so it goes first.
    //
    // Locked before the re-count so the check and the delete see the same thing:
    // a grade, attendance mark or score item written concurrently has to take a
    // key-share lock on the subject row, and a rating one on its skill row, so
    // it either committed before the count (and blocks) or waits for this
    // transaction and then fails on a subject that no longer exists.
    await withTransaction(async (client) => {
      await client.query('SELECT id FROM subjects WHERE id = ANY($1::uuid[]) FOR UPDATE', [family])
      await client.query(
        'SELECT id FROM competency_skills WHERE subject_id = ANY($1::uuid[]) FOR UPDATE', [family])
      const blocker = subjectDeleteBlocker(row, areas.length, await subjectUsage(family, client))
      if (blocker) throw new AppError(blocker, 409)
      await client.query('DELETE FROM academic_predictions WHERE subject_id = ANY($1::uuid[])', [family])
      await client.query('DELETE FROM subjects WHERE id = ANY($1::uuid[])', [family])
    })

    res.json({
      message: areas.length
        ? `"${row.name}" and its ${areas.length} areas removed from ${row.grade_level}.`
        : `"${row.name}" removed from ${row.grade_level}.`,
    })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// SECTIONS  (all filtered by school_year_id)
// ════════════════════════════════════════════════════════════

// The adviser rides along on every section read, nested the way
// `getStudentWithGuardians` nests guardians. `is_active` is deliberately part
// of it: teacher accounts are soft-deleted, so a section can hold a
// deactivated teacher and the UI has to be able to say so rather than
// rendering a blank where a name was.
//
// Both queries below join `users`, which has an `is_active` of its own, so
// every section column is alias-qualified from here on.
const ADVISER_JSON = `CASE WHEN adv.id IS NULL THEN NULL ELSE json_build_object(
         'id',          adv.id,
         'surname',     adv.surname,
         'first_name',  adv.first_name,
         'middle_name', adv.middle_name,
         'is_active',   adv.is_active
       ) END AS adviser`

// One section in the shape every read returns it. Used by the writers so a
// mutation's response and a fresh fetch cannot disagree.
const loadSectionRow = async (id) => {
  const r = await query(
    `SELECT s.id, s.name, s.grade_level, s.created_at, s.adviser_id, ${ADVISER_JSON}
       FROM sections s
       LEFT JOIN users adv ON adv.id = s.adviser_id
      WHERE s.id=$1`, [id]
  )
  return r.rows[0] || null
}

router.get('/sections', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const conditions = ['s.school_year_id=$1', 's.is_active=TRUE']
    const params = [sy_id]
    if (req.query.grade_level) { params.push(req.query.grade_level); conditions.push(`s.grade_level=$${params.length}`) }
    if (isScopedAdmin(req.user.role)) {
      params.push(gradeScopeForRole(req.user.role))
      conditions.push(`s.grade_level = ANY($${params.length}::text[])`)
    }

    const result = await query(
      `SELECT s.id, s.name, s.grade_level, s.created_at, s.adviser_id, ${ADVISER_JSON}
       FROM sections s
       LEFT JOIN users adv ON adv.id = s.adviser_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${GRADE_ORDER}, s.name`, params
    )
    res.json({ sections: result.rows })
  } catch (err) { next(err) }
})

router.get('/sections/grouped', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const scope = gradeScopeForRole(req.user.role)
    const result = await query(
      `SELECT s.id, s.name, s.grade_level, s.adviser_id, ${ADVISER_JSON}
       FROM sections s
       LEFT JOIN users adv ON adv.id = s.adviser_id
       WHERE s.school_year_id=$1 AND s.is_active=TRUE
         AND s.grade_level = ANY($2::text[])
       ORDER BY ${GRADE_ORDER}, s.name`, [sy_id, scope]
    )
    const grouped = {}
    for (const gl of scope) grouped[gl] = []
    for (const row of result.rows) { if (grouped[row.grade_level]) grouped[row.grade_level].push(row) }
    res.json({ grouped })
  } catch (err) { next(err) }
})

/**
 * Refuse a section name another section in the same grade level and school
 * year already answers to — ignoring case and spacing, the subjects' rule
 * (`NAME_KEY`). For sections it matters more: five tables hold a section by its
 * name string, and `assertSectionsExist()` resolves a typed name to the stored
 * one case-insensitively, so "Mabini" beside "mabini" would leave the batch
 * upload placing learners in whichever it found. `sections_sy_grade_name_ci_unique`
 * backs this up; only this can say which section is in the way.
 *
 * A dormant section holding the exact name is refused too: the original
 * byte-for-byte constraint covers deleted rows, and would otherwise surface as
 * a bare "Record already exists."
 */
const assertSectionNameFree = async ({ sy_id, grade_level, name, excludeId = null, label = null }) => {
  const r = await query(
    `SELECT id, name, is_active,
            ${NAME_KEY('name')} = ${NAME_KEY('$3::text')} AS same_name
       FROM sections
      WHERE school_year_id = $1 AND grade_level = $2
        AND id IS DISTINCT FROM $4::uuid`,
    [sy_id, grade_level, name, excludeId])
  const year = label ? `SY ${label}` : 'this school year'

  const live = r.rows.find(s => s.is_active && s.same_name)
  if (live) {
    throw new AppError(live.name === name
      ? `Section "${name}" already exists in ${grade_level} for ${year}.`
      : `Section "${name}" is the same as "${live.name}", which already exists in ${grade_level} ` +
        `for ${year}. Section names are not case-sensitive.`, 409)
  }
  if (r.rows.some(s => !s.is_active && s.name === name)) {
    throw new AppError(
      `Section "${name}" was removed from ${grade_level} earlier in ${year} and that record ` +
      `still holds the name. Choose a different name.`, 409)
  }
}

router.post('/sections', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().trim().min(1).max(100).required(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).required(),
      sy_id:       Joi.string().uuid().optional(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    enforceGradeScope(req, value.grade_level)

    const sy_id = await resolveSYId(value.sy_id)
    await assertCurriculumYearWritable(req, sy_id)
    value.name = normalizeName(value.name)
    await assertSectionNameFree({ sy_id, grade_level: value.grade_level, name: value.name })

    // `adviser` is returned NULL rather than omitted so a freshly-added section
    // has the same shape as one that came back from a read — the Sections tab
    // merges this row straight into its state map.
    const result = await query(
      `INSERT INTO sections (name, grade_level, school_year_id)
       VALUES ($1,$2,$3)
       RETURNING id, name, grade_level, created_at, adviser_id, NULL::json AS adviser`,
      [value.name, value.grade_level, sy_id]
    )
    res.status(201).json({ message: 'Section added.', section: result.rows[0] })
  } catch (err) { next(err) }
})

// Nothing references a section by id -- five tables hold it as a bare name
// string (see `utils/sections.js`). So renaming one is a fan-out write, and
// moving one between grade levels is not a rename at all: the learners, teacher
// assignments and score items sitting in it belong to the old grade level and
// would become nonsense. Renames cascade; grade-level moves are refused once
// anything depends on the section.
router.put('/sections/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().trim().min(1).max(100).optional(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).optional(),
    }).validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    await assertCurriculumRowInScope(req, 'sections', req.params.id)
    await assertCurriculumYearWritable(req, await yearOfRow('sections', req.params.id))
    if (value.grade_level) enforceGradeScope(req, value.grade_level)

    const sec = await loadSection(req.params.id)
    if (!sec || !sec.section_is_active) throw new AppError('Section not found.', 404)

    const newName  = value.name        !== undefined ? normalizeName(value.name) : sec.name
    const newGrade = value.grade_level !== undefined ? value.grade_level : sec.grade_level
    const renaming = newName  !== sec.name
    const moving   = newGrade !== sec.grade_level
    if (!renaming && !moving) throw new AppError('Nothing to update.', 400)

    // Excluding this row lets a case-only correction ("mabini" -> "Mabini")
    // through; the rename below still carries it across all five tables.
    await assertSectionNameFree({
      sy_id: sec.school_year_id, grade_level: newGrade, name: newName,
      excludeId: sec.id, label: sec.label,
    })

    const usage = await sectionUsage(sec)

    if (moving && usage.total > 0) {
      throw new AppError(
        `Cannot move "${sec.name}" to ${newGrade}: it still holds ${describeUsage(usage)} in ${sec.grade_level}. ` +
        'Move those first, or create a new section under the target grade level.',
        409
      )
    }

    const result = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE sections SET name=$1, grade_level=$2, updated_at=NOW()
          WHERE id=$3 AND is_active=TRUE
          RETURNING id`,
        [newName, newGrade, sec.id]
      )
      if (!r.rows.length) throw new AppError('Section not found.', 404)

      // Carry the name across everything that holds it, scoped to this
      // section's grade level and school year.
      const moved = renaming ? await renameSectionEverywhere(client, sec, newName) : null
      return { moved }
    })

    // Re-read through the shared loader so the response carries the adviser.
    // The Sections tab replaces its cached section wholesale, so a row without
    // it would blank the adviser on screen until the next fetch.
    const section = await loadSectionRow(sec.id)

    const moved = result.moved
    res.json({
      message: moved && moved.total
        ? `Section renamed to "${newName}". Updated ${describeUsage(moved) || `${moved.total} record(s)`}.`
        : 'Section updated.',
      section,
      updated: moved,
    })
  } catch (err) { next(err) }
})

/** Load a section for the delete paths, with the scope check both need. */
const loadSectionForDelete = async (req) => {
  const sec = await loadSection(req.params.id)
  if (!sec || !sec.section_is_active) throw new AppError('Section not found.', 404)
  if (isScopedAdmin(req.user.role) && !canManageGrade(req.user.role, sec.grade_level)) {
    throw new AppError('Section is outside your grade scope.', 403)
  }
  return sec
}

// Read-only, the section twin of `GET /subjects/:id/usage`: the delete
// confirmation asks before the admin commits, and gets the verdict the DELETE
// below would reach, so a refusal shows up front instead of after the click.
router.get('/sections/:id/usage', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const sec = await loadSectionForDelete(req)
    const usage = await sectionUsage(sec)
    res.json({ usage, blocked_reason: sectionDeleteBlocker(sec, usage) })
  } catch (err) { next(err) }
})

router.delete('/sections/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const sec = await loadSectionForDelete(req)
    await assertCurriculumYearWritable(req, sec.school_year_id)

    // Scoped by grade level AND school year (see `sectionUsage`). The adviser is
    // deliberately not part of it. That guard counts what a delete would
    // *orphan* — learners, enrolment records, teacher assignments, score items,
    // all of which hold the section by name and would outlive it. The adviser
    // is a pointer on the row being deleted and goes with it.
    //
    // Deleted outright rather than soft-deleted: nothing references a section by
    // id, and the guard establishes that nothing holds it by name either, so a
    // hidden row would only keep owning the name and stop the section being
    // added back. The row is locked before the re-count, the same shape as the
    // subject delete, so a concurrent rename of this section cannot slip
    // between the check and the delete.
    await withTransaction(async (client) => {
      const locked = await client.query(
        'SELECT name, grade_level FROM sections WHERE id=$1 AND is_active=TRUE FOR UPDATE', [sec.id])
      if (!locked.rows.length) throw new AppError('Section not found.', 404)
      const cur = { ...sec, ...locked.rows[0] }   // counted under its name as of the lock
      const blocker = sectionDeleteBlocker(cur, await sectionUsage(cur, client))
      if (blocker) throw new AppError(blocker, 409)
      await client.query('DELETE FROM sections WHERE id=$1', [sec.id])
    })
    res.json({ message: `Section "${sec.name}" removed from ${sec.grade_level}.` })
  } catch (err) { next(err) }
})

// ── Section advisers ─────────────────────────────────────────
//
// The adviser is the teacher responsible for a class as a whole, as opposed to
// `teacher_assignments`, which links a teacher to a class per *subject* and so
// answers "who teaches Math to Grade 3 Mabini" rather than "who is responsible
// for Grade 3 Mabini".
//
// It is a column on `sections` because that table is already keyed
// (school_year_id, grade_level, name) — exactly the scope of an advisory — and
// because it is keyed by the section's own id, so `renameSectionEverywhere()`
// carries it through a rename with no extra statement.
//
// These are separate endpoints rather than a third field on `PUT /sections/:id`:
// that handler's contract is name + grade level, with a rename fan-out, a
// usage-blocked grade move and a `Nothing to update.` 400, and an orthogonal
// field tangles all three.
//
// Archived school years are not gated here. Renaming and deleting a section on
// a closed year are already ungated — unlike enrolment writes and the grading
// model freeze — so the adviser follows the surface it lives on. A decision,
// not an oversight.

const ADVISER_RULE = 'A teacher may advise one section per school year.'

// Load the section an adviser call is about, scope-checked.
const loadAdvisableSection = async (req) => {
  await assertCurriculumRowInScope(req, 'sections', req.params.id)
  const sec = await loadSection(req.params.id)
  if (!sec || !sec.section_is_active) throw new AppError('Section not found.', 404)
  return sec
}

// The other section this teacher already advises in the same school year, or
// null. Naming it is only safe when the caller could have seen it anyway: an
// `admin_ece` refused on their own Kinder card must not learn from the message
// that the teacher advises "Grade 5 — Sampaguita".
const advisedElsewhere = async (req, teacherId, schoolYearId, exceptId) => {
  const r = await query(
    `SELECT grade_level, name FROM sections
      WHERE school_year_id=$1 AND adviser_id=$2 AND is_active=TRUE AND id <> $3
      LIMIT 1`,
    [schoolYearId, teacherId, exceptId]
  )
  if (!r.rows.length) return null
  const other = r.rows[0]
  return canManageGrade(req.user.role, other.grade_level)
    ? { grade_level: other.grade_level, name: other.name }
    : { grade_level: null, name: null }
}

const describeAdvised = (other) =>
  other.name ? `${other.grade_level} — ${other.name}` : 'another section'

// Every active teacher, with the two facts the picker needs: whether they
// already teach this class (so the obvious candidate sorts to the top) and
// whether they already advise elsewhere this year (so that row can be disabled
// with the reason on it, the way the promotion wizard writes
// "Graduated — Grade 6 only").
router.get('/sections/:id/adviser-candidates', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const sec = await loadAdvisableSection(req)

    // `teacher_assignments.school_year` is the year's **label**, not its id —
    // see the table map at the top of utils/sections.js.
    const result = await query(
      `SELECT u.id, u.surname, u.first_name, u.middle_name, u.email,
              EXISTS (
                SELECT 1 FROM teacher_assignments ta
                 WHERE ta.teacher_id = u.id AND ta.school_year = $1
                   AND ta.grade_level = $2 AND ta.section = $3
              ) AS teaches_this_class,
              adv.grade_level AS advises_grade_level,
              adv.name        AS advises_section
         FROM users u
         LEFT JOIN sections adv
                ON adv.adviser_id = u.id
               AND adv.school_year_id = $4
               AND adv.is_active = TRUE
               AND adv.id <> $5
        WHERE u.role = 'teacher' AND u.is_active = TRUE
        ORDER BY u.surname, u.first_name`,
      [sec.label, sec.grade_level, sec.name, sec.school_year_id, sec.id]
    )

    const teachers = result.rows.map(r => ({
      id:          r.id,
      surname:     r.surname,
      first_name:  r.first_name,
      middle_name: r.middle_name,
      email:       r.email,
      teaches_this_class: r.teaches_this_class,
      advises: r.advises_grade_level
        ? (canManageGrade(req.user.role, r.advises_grade_level)
            ? { grade_level: r.advises_grade_level, name: r.advises_section }
            : { grade_level: null, name: null })
        : null,
    }))

    res.json({
      teachers,
      section: { id: sec.id, name: sec.name, grade_level: sec.grade_level, school_year: sec.label },
    })
  } catch (err) { next(err) }
})

router.put('/sections/:id/adviser', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      // null clears the adviser; it is required rather than optional so an
      // empty body cannot silently mean "remove".
      teacher_id: Joi.string().uuid().allow(null).required(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    const sec = await loadAdvisableSection(req)
    await assertCurriculumYearWritable(req, sec.school_year_id)
    let teacher = null

    if (value.teacher_id) {
      const t = await query(
        'SELECT id, surname, first_name, role, is_active FROM users WHERE id=$1',
        [value.teacher_id]
      )
      if (!t.rows.length || t.rows[0].role !== 'teacher') {
        throw new AppError('That account is not a teacher.', 422)
      }
      teacher = t.rows[0]
      if (!teacher.is_active) throw new AppError('That teacher account is deactivated.', 422)

      // The partial unique index is the guarantee; this pre-check exists so the
      // refusal can name the section already holding them.
      const other = await advisedElsewhere(req, value.teacher_id, sec.school_year_id, sec.id)
      if (other) {
        throw new AppError(
          `${teacher.first_name} ${teacher.surname} already advises ${describeAdvised(other)} ` +
          `in SY ${sec.label}. ${ADVISER_RULE}`,
          409
        )
      }
    }

    try {
      const r = await query(
        `UPDATE sections SET adviser_id=$1, updated_at=NOW()
          WHERE id=$2 AND is_active=TRUE RETURNING id`,
        [value.teacher_id, sec.id]
      )
      if (!r.rows.length) throw new AppError('Section not found.', 404)
    } catch (e) {
      // The pre-check races — two admins can both pass it and only one write
      // wins. The index is what actually holds the rule.
      if (e.code === '23505') {
        throw new AppError(
          `That teacher already advises another section in SY ${sec.label}. ${ADVISER_RULE}`,
          409
        )
      }
      throw e
    }

    const section = await loadSectionRow(sec.id)
    res.json({
      message: teacher
        ? `${teacher.first_name} ${teacher.surname} is now the adviser of ${sec.grade_level} — ${sec.name}.`
        : `Adviser removed from ${sec.grade_level} — ${sec.name}.`,
      section,
    })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// GRADING STRUCTURE  (per subject)
// ════════════════════════════════════════════════════════════

router.get('/subjects/:id/grading', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, category_id, name, weight, sort_order
       FROM grading_structure
       WHERE subject_id=$1 AND is_active=TRUE
       ORDER BY sort_order, name`,
      [req.params.id]
    )
    // Assemble tree: categories (category_id IS NULL) with nested components
    const categories = []
    const catMap = new Map()
    for (const row of result.rows) {
      if (!row.category_id) {
        const cat = { ...row, components: [] }
        categories.push(cat)
        catMap.set(row.id, cat)
      }
    }
    for (const row of result.rows) {
      if (row.category_id && catMap.has(row.category_id)) {
        const { category_id, ...comp } = row
        catMap.get(row.category_id).components.push(comp)
      }
    }
    res.json({ categories })
  } catch (err) { next(err) }
})

router.put('/subjects/:id/grading', authorizeAnyAdmin, async (req, res, next) => {
  try {
    // Validate subject exists
    const sub = await query('SELECT id, grade_level FROM subjects WHERE id=$1 AND is_active=TRUE', [req.params.id])
    if (!sub.rows.length) throw new AppError('Subject not found.', 404)
    await assertCurriculumYearWritable(req, await yearOfRow('subjects', req.params.id))
    if (isScopedAdmin(req.user.role) && !canManageGrade(req.user.role, sub.rows[0].grade_level)) {
      throw new AppError('Subject is outside your grade scope.', 403)
    }
    // A learning area graded through its areas has no weights of its own —
    // each area carries its own Written Work / Performance Task / Assessment.
    await assertGradeable(req.params.id)

    const catSchema = Joi.object({
      id:         Joi.string().uuid().optional(),
      name:       Joi.string().min(1).max(100).required(),
      weight:     Joi.number().precision(2).greater(0).max(100).required(),
      sort_order: Joi.number().integer().min(0).default(0),
      components: Joi.array().items(Joi.object({
        id:         Joi.string().uuid().optional(),
        name:       Joi.string().min(1).max(100).required(),
        weight:     Joi.number().precision(2).greater(0).max(100).required(),
        sort_order: Joi.number().integer().min(0).default(0),
      })).default([]),
    })
    const { error, value } = Joi.object({
      categories: Joi.array().items(catSchema).min(1).required(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    // Validate category weights sum to 100
    const catTotal = value.categories.reduce((s, c) => s + parseFloat(c.weight), 0)
    if (Math.abs(catTotal - 100) > 0.01) {
      throw new AppError(`Category weights must sum to 100% (currently ${catTotal.toFixed(2)}%).`, 422)
    }

    // Validate component weights within each category sum to category weight
    for (const cat of value.categories) {
      if (cat.components.length > 0) {
        const compTotal = cat.components.reduce((s, c) => s + parseFloat(c.weight), 0)
        if (Math.abs(compTotal - parseFloat(cat.weight)) > 0.01) {
          throw new AppError(
            `Components in "${cat.name}" must sum to ${cat.weight}% (currently ${compTotal.toFixed(2)}%).`, 422
          )
        }
      }
    }

    const categories = await withTransaction(async (client) => {
      // Collect IDs that should remain active
      const keepIds = []
      for (const cat of value.categories) {
        if (cat.id) keepIds.push(cat.id)
        for (const comp of cat.components) {
          if (comp.id) keepIds.push(comp.id)
        }
      }

      // Find rows being removed
      const removedRes = keepIds.length > 0
        ? await client.query(
            `SELECT id, name, category_id FROM grading_structure
             WHERE subject_id=$1 AND is_active=TRUE AND id != ALL($2)`,
            [req.params.id, keepIds]
          )
        : await client.query(
            `SELECT id, name, category_id FROM grading_structure
             WHERE subject_id=$1 AND is_active=TRUE`,
            [req.params.id]
          )

      // Block removal of components that have recorded scores
      if (removedRes.rows.length > 0) {
        const removedIds = removedRes.rows.map(r => r.id)
        const withScores = await client.query(
          `SELECT DISTINCT gs.id, gs.name
           FROM grading_structure gs
           JOIN score_items si ON si.component_id = gs.id AND si.is_active = TRUE
           JOIN student_scores ss ON ss.score_item_id = si.id
           WHERE gs.id = ANY($1)`,
          [removedIds]
        )
        if (withScores.rows.length > 0) {
          const names = withScores.rows.map(r => `"${r.name}"`).join(', ')
          throw new AppError(`Cannot remove ${names} — has recorded student scores. Clear scores in Score Entry first.`, 422)
        }
      }

      // Soft-delete rows that are no longer in the payload
      if (removedRes.rows.length > 0) {
        const removedIds = removedRes.rows.map(r => r.id)
        await client.query(
          `UPDATE grading_structure SET is_active=FALSE, updated_at=NOW()
           WHERE id = ANY($1)`,
          [removedIds]
        )
      }

      const result = []
      for (let i = 0; i < value.categories.length; i++) {
        const cat = value.categories[i]
        let catRow

        if (cat.id) {
          // Update existing category
          const catRes = await client.query(
            `UPDATE grading_structure SET name=$1, weight=$2, sort_order=$3, is_active=TRUE, updated_at=NOW()
             WHERE id=$4 AND subject_id=$5
             RETURNING id, name, weight, sort_order`,
            [cat.name, cat.weight, cat.sort_order ?? i, cat.id, req.params.id]
          )
          catRow = catRes.rows[0]
        }
        if (!catRow) {
          // Insert new category
          const catRes = await client.query(
            `INSERT INTO grading_structure (subject_id, category_id, name, weight, sort_order)
             VALUES ($1, NULL, $2, $3, $4) RETURNING id, name, weight, sort_order`,
            [req.params.id, cat.name, cat.weight, cat.sort_order ?? i]
          )
          catRow = catRes.rows[0]
        }

        const newCat = { ...catRow, components: [] }

        for (let j = 0; j < cat.components.length; j++) {
          const comp = cat.components[j]
          let compRow

          if (comp.id) {
            // Update existing component
            const compRes = await client.query(
              `UPDATE grading_structure SET name=$1, weight=$2, sort_order=$3, category_id=$4, is_active=TRUE, updated_at=NOW()
               WHERE id=$5 AND subject_id=$6
               RETURNING id, name, weight, sort_order`,
              [comp.name, comp.weight, comp.sort_order ?? j, newCat.id, comp.id, req.params.id]
            )
            compRow = compRes.rows[0]
          }
          if (!compRow) {
            // Insert new component
            const compRes = await client.query(
              `INSERT INTO grading_structure (subject_id, category_id, name, weight, sort_order)
               VALUES ($1, $2, $3, $4, $5) RETURNING id, name, weight, sort_order`,
              [req.params.id, newCat.id, comp.name, comp.weight, comp.sort_order ?? j]
            )
            compRow = compRes.rows[0]
          }
          newCat.components.push(compRow)
        }
        result.push(newCat)
      }
      return result
    })

    res.json({ message: 'Grading structure saved.', categories })
  } catch (err) { next(err) }
})

router.delete('/subjects/:id/grading', authorizeAnyAdmin, async (req, res, next) => {
  try {
    await assertCurriculumRowInScope(req, 'subjects', req.params.id)
    await assertCurriculumYearWritable(req, await yearOfRow('subjects', req.params.id))
    // Block if any component has recorded scores
    const withScores = await query(
      `SELECT DISTINCT gs.name
       FROM grading_structure gs
       JOIN score_items si ON si.component_id = gs.id AND si.is_active = TRUE
       JOIN student_scores ss ON ss.score_item_id = si.id
       WHERE gs.subject_id=$1 AND gs.is_active=TRUE`,
      [req.params.id]
    )
    if (withScores.rows.length > 0) {
      const names = withScores.rows.map(r => `"${r.name}"`).join(', ')
      throw new AppError(`Cannot clear — ${names} has recorded student scores. Clear scores in Score Entry first.`, 422)
    }

    const result = await query(
      `UPDATE grading_structure SET is_active=FALSE, updated_at=NOW()
       WHERE subject_id=$1 AND is_active=TRUE RETURNING id`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('No grading structure found for this subject.', 404)
    res.json({ message: 'Grading structure cleared.' })
  } catch (err) { next(err) }
})

// GET /api/curriculum/subjects/:id/grading/scores-check
// Returns component IDs that have recorded student scores
router.get('/subjects/:id/grading/scores-check', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT DISTINCT gs.id
       FROM grading_structure gs
       JOIN score_items si ON si.component_id = gs.id AND si.is_active = TRUE
       JOIN student_scores ss ON ss.score_item_id = si.id
       WHERE gs.subject_id=$1 AND gs.is_active=TRUE`,
      [req.params.id]
    )
    res.json({ components_with_scores: result.rows.map(r => r.id) })
  } catch (err) { next(err) }
})

module.exports = router