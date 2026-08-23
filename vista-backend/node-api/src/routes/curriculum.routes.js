const express = require('express')
const router  = express.Router()
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const { authenticate, authorizeAnyAdmin, authorizeSuperAdmin, enforceGradeScope } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { loadSection, sectionUsage, describeUsage, renameSectionEverywhere } = require('../utils/sections')
const { gradeScopeForRole, canManageGrade, isScopedAdmin, isSuperAdmin } = require('../utils/roles')
const { RATING_SCALES, resolveAssessment } = require('../utils/grading')
const { loadAssessmentRows } = require('../utils/assessmentConfig')

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
  const pending = await client.query(
    `UPDATE students s
        SET enrollment_status = 'pending', updated_at = NOW()
      WHERE s.is_active = TRUE
        AND s.enrollment_status NOT IN ('transferred_out','dropped','graduated')
        AND NOT EXISTS (SELECT 1 FROM student_enrollments e
                         WHERE e.student_id = s.id AND e.school_year_id = $1)
      RETURNING s.id`,
    [schoolYearId]
  )

  return { adopted: adopted.rowCount, pending: pending.rowCount }
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

    res.json({
      school_year: sy.rows[0],
      total_students: total,
      with_record: total - without_record,
      without_record,
      by_status,
      closing_school_year: closing,
      undecided_outcomes,
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
        await client.query(
          `INSERT INTO subjects (name, grade_level, school_year_id)
           SELECT name, grade_level, $1 FROM subjects
           WHERE school_year_id=$2 AND is_active=TRUE
           ON CONFLICT DO NOTHING`,
          [newSY.id, value.copy_from_id]
        )
        await client.query(
          `INSERT INTO sections (name, grade_level, school_year_id)
           SELECT name, grade_level, $1 FROM sections
           WHERE school_year_id=$2 AND is_active=TRUE
           ON CONFLICT DO NOTHING`,
          [newSY.id, value.copy_from_id]
        )

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

      const rollover = activating
        ? {
            ...(await rolloverStudents(client, req.params.id)),
            closing_school_year: closing,
            undecided_outcomes: undecidedOutcomes,
          }
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

router.get('/subjects', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const conditions = ['school_year_id=$1', 'is_active=TRUE']
    const params = [sy_id]
    if (req.query.grade_level) { params.push(req.query.grade_level); conditions.push(`grade_level=$${params.length}`) }
    if (isScopedAdmin(req.user.role)) {
      params.push(gradeScopeForRole(req.user.role))
      conditions.push(`grade_level = ANY($${params.length}::text[])`)
    }

    const result = await query(
      `SELECT id, name, grade_level, created_at,
              EXISTS(SELECT 1 FROM grading_structure gs WHERE gs.subject_id=subjects.id AND gs.is_active=TRUE) AS has_grading
       FROM subjects WHERE ${conditions.join(' AND ')}
       ORDER BY ${GRADE_ORDER}, name`, params
    )
    res.json({ subjects: result.rows })
  } catch (err) { next(err) }
})

router.get('/subjects/grouped', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const scope = gradeScopeForRole(req.user.role)
    const result = await query(
      `SELECT id, name, grade_level,
              EXISTS(SELECT 1 FROM grading_structure gs WHERE gs.subject_id=subjects.id AND gs.is_active=TRUE) AS has_grading
       FROM subjects WHERE school_year_id=$1 AND is_active=TRUE
         AND grade_level = ANY($2::text[])
       ORDER BY ${GRADE_ORDER}, name`, [sy_id, scope]
    )
    const grouped = {}
    for (const gl of scope) grouped[gl] = []
    for (const row of result.rows) { if (grouped[row.grade_level]) grouped[row.grade_level].push(row) }
    res.json({ grouped })
  } catch (err) { next(err) }
})

router.post('/subjects', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:         Joi.string().min(1).max(100).required(),
      grade_level:  Joi.string().valid(...GRADE_LEVELS).required(),
      sy_id:        Joi.string().uuid().optional(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    enforceGradeScope(req, value.grade_level)

    const sy_id = await resolveSYId(value.sy_id)
    const dup = await query(
      'SELECT id FROM subjects WHERE school_year_id=$1 AND grade_level=$2 AND name=$3 AND is_active=TRUE',
      [sy_id, value.grade_level, value.name]
    )
    if (dup.rows.length) throw new AppError(`"${value.name}" already exists in ${value.grade_level} for this school year.`, 409)

    const result = await query(
      `INSERT INTO subjects (name, grade_level, school_year_id)
       VALUES ($1,$2,$3) RETURNING id, name, grade_level, created_at`,
      [value.name, value.grade_level, sy_id]
    )
    res.status(201).json({ message: 'Subject added.', subject: result.rows[0] })
  } catch (err) { next(err) }
})

router.put('/subjects/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().min(1).max(100).optional(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).optional(),
    }).validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    await assertCurriculumRowInScope(req, 'subjects', req.params.id)
    if (value.grade_level) enforceGradeScope(req, value.grade_level)

    const sets=[]; const params=[]
    if (value.name)        { params.push(value.name);        sets.push(`name=$${params.length}`) }
    if (value.grade_level) { params.push(value.grade_level); sets.push(`grade_level=$${params.length}`) }
    if (!sets.length) throw new AppError('Nothing to update.', 400)
    sets.push('updated_at=NOW()')
    params.push(req.params.id)

    const result = await query(
      `UPDATE subjects SET ${sets.join(',')}
       WHERE id=$${params.length} AND is_active=TRUE
       RETURNING id, name, grade_level, created_at`, params
    )
    if (!result.rows.length) throw new AppError('Subject not found.', 404)
    res.json({ message: 'Subject updated.', subject: result.rows[0] })
  } catch (err) { next(err) }
})

router.delete('/subjects/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const sub = await query('SELECT name, grade_level FROM subjects WHERE id=$1', [req.params.id])
    if (!sub.rows.length) throw new AppError('Subject not found.', 404)
    if (isScopedAdmin(req.user.role) && !canManageGrade(req.user.role, sub.rows[0].grade_level)) {
      throw new AppError('Subject is outside your grade scope.', 403)
    }

    const inUse = await query('SELECT COUNT(*) FROM grades WHERE subject_id=$1', [req.params.id])
    if (parseInt(inUse.rows[0].count) > 0) {
      throw new AppError('Cannot delete: this subject has existing grade records.', 409)
    }
    await query('UPDATE subjects SET is_active=FALSE, updated_at=NOW() WHERE id=$1', [req.params.id])
    res.json({ message: `"${sub.rows[0].name}" removed from ${sub.rows[0].grade_level}.` })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// SECTIONS  (all filtered by school_year_id)
// ════════════════════════════════════════════════════════════

router.get('/sections', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const conditions = ['school_year_id=$1', 'is_active=TRUE']
    const params = [sy_id]
    if (req.query.grade_level) { params.push(req.query.grade_level); conditions.push(`grade_level=$${params.length}`) }
    if (isScopedAdmin(req.user.role)) {
      params.push(gradeScopeForRole(req.user.role))
      conditions.push(`grade_level = ANY($${params.length}::text[])`)
    }

    const result = await query(
      `SELECT id, name, grade_level, created_at
       FROM sections WHERE ${conditions.join(' AND ')}
       ORDER BY ${GRADE_ORDER}, name`, params
    )
    res.json({ sections: result.rows })
  } catch (err) { next(err) }
})

router.get('/sections/grouped', async (req, res, next) => {
  try {
    const sy_id = await resolveSYId(req.query.sy_id)
    const scope = gradeScopeForRole(req.user.role)
    const result = await query(
      `SELECT id, name, grade_level
       FROM sections WHERE school_year_id=$1 AND is_active=TRUE
         AND grade_level = ANY($2::text[])
       ORDER BY ${GRADE_ORDER}, name`, [sy_id, scope]
    )
    const grouped = {}
    for (const gl of scope) grouped[gl] = []
    for (const row of result.rows) { if (grouped[row.grade_level]) grouped[row.grade_level].push(row) }
    res.json({ grouped })
  } catch (err) { next(err) }
})

router.post('/sections', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      name:        Joi.string().min(1).max(100).required(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).required(),
      sy_id:       Joi.string().uuid().optional(),
    }).validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    enforceGradeScope(req, value.grade_level)

    const sy_id = await resolveSYId(value.sy_id)
    const dup = await query(
      'SELECT id FROM sections WHERE school_year_id=$1 AND grade_level=$2 AND name=$3 AND is_active=TRUE',
      [sy_id, value.grade_level, value.name]
    )
    if (dup.rows.length) throw new AppError(`Section "${value.name}" already exists in ${value.grade_level} for this school year.`, 409)

    const result = await query(
      `INSERT INTO sections (name, grade_level, school_year_id)
       VALUES ($1,$2,$3) RETURNING id, name, grade_level, created_at`,
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
      name:        Joi.string().min(1).max(100).optional(),
      grade_level: Joi.string().valid(...GRADE_LEVELS).optional(),
    }).validate(req.body, { stripUnknown: true })
    if (error) throw new AppError(error.details[0].message, 422)

    await assertCurriculumRowInScope(req, 'sections', req.params.id)
    if (value.grade_level) enforceGradeScope(req, value.grade_level)

    const sec = await loadSection(req.params.id)
    if (!sec || !sec.section_is_active) throw new AppError('Section not found.', 404)

    const newName  = value.name        !== undefined ? value.name        : sec.name
    const newGrade = value.grade_level !== undefined ? value.grade_level : sec.grade_level
    const renaming = newName  !== sec.name
    const moving   = newGrade !== sec.grade_level
    if (!renaming && !moving) throw new AppError('Nothing to update.', 400)

    // The unique constraint is (school_year_id, grade_level, name); catching the
    // collision here gives a readable message instead of a 500 from Postgres.
    const dup = await query(
      `SELECT id FROM sections
        WHERE school_year_id=$1 AND grade_level=$2 AND name=$3 AND is_active=TRUE AND id<>$4`,
      [sec.school_year_id, newGrade, newName, sec.id]
    )
    if (dup.rows.length) {
      throw new AppError(`Section "${newName}" already exists in ${newGrade} for SY ${sec.label}.`, 409)
    }

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
          RETURNING id, name, grade_level, created_at`,
        [newName, newGrade, sec.id]
      )
      if (!r.rows.length) throw new AppError('Section not found.', 404)

      // Carry the name across everything that holds it, scoped to this
      // section's grade level and school year.
      const moved = renaming ? await renameSectionEverywhere(client, sec, newName) : null
      return { section: r.rows[0], moved }
    })

    const moved = result.moved
    res.json({
      message: moved && moved.total
        ? `Section renamed to "${newName}". Updated ${describeUsage(moved) || `${moved.total} record(s)`}.`
        : 'Section updated.',
      section: result.section,
      updated: moved,
    })
  } catch (err) { next(err) }
})

router.delete('/sections/:id', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const sec = await loadSection(req.params.id)
    if (!sec || !sec.section_is_active) throw new AppError('Section not found.', 404)
    if (isScopedAdmin(req.user.role) && !canManageGrade(req.user.role, sec.grade_level)) {
      throw new AppError('Section is outside your grade scope.', 403)
    }

    // Scoped by grade level AND school year. The old guard matched on the name
    // alone, so a Grade 6 "Mabuhay" could not be deleted while a Kinder learner
    // sat in a differently-scoped section that happened to share the name.
    const usage = await sectionUsage(sec)
    if (usage.total > 0) {
      throw new AppError(
        `Cannot delete "${sec.name}" (${sec.grade_level}, SY ${sec.label}): it still holds ${describeUsage(usage)}.`,
        409
      )
    }

    await query('UPDATE sections SET is_active=FALSE, updated_at=NOW() WHERE id=$1', [req.params.id])
    res.json({ message: `Section "${sec.name}" removed from ${sec.grade_level}.` })
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
    if (isScopedAdmin(req.user.role) && !canManageGrade(req.user.role, sub.rows[0].grade_level)) {
      throw new AppError('Subject is outside your grade scope.', 403)
    }

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