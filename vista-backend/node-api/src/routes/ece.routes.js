const express = require('express')
const router  = express.Router()
const Joi     = require('joi')
const { query } = require('../config/database')
const { authenticate, authorize, enforceGradeScope } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { ROLES, ANY_ADMIN, isAnyAdmin, gradeScopeForRole } = require('../utils/roles')
const { resolveGradingPolicy, resolveAssessment, ratingScale, isValidRating } = require('../utils/grading')
const { loadAssessmentRows } = require('../utils/assessmentConfig')
const { enforceParentLinked, rejectIfAcademicSuspended } = require('../middleware/parentScope')

router.use(authenticate)

const ALL_GRADE_LEVELS = [
  'Kinder',
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
]

// Which grade levels are assessed descriptively is now configuration, not a
// constant — DO 015, s. 2026 moves Grade 1 onto descriptive grading while it
// stays an elementary (admin_elem) responsibility. See utils/assessmentConfig.js.
const descriptiveLevelsFor = async (syId, scope) => {
  const rows = await loadAssessmentRows(syId)
  return (scope && scope.length ? scope : ALL_GRADE_LEVELS)
    .filter(gl => resolveAssessment(gl, rows.get(gl) || null).isDescriptive)
}

// The rating scale a grade level uses in a school year.
const scaleFor = async (syId, gradeLevel) => {
  const rows = await loadAssessmentRows(syId)
  return resolveAssessment(gradeLevel, rows.get(gradeLevel) || null)
}

// Competency features are open to every admin tier plus teachers. Which grade
// levels each may actually touch is enforced per-request by grade scope, so
// admin_ece keeps Kinder and admin_elem gets Grade 1 once it is
// configured as descriptive. (Previously admin_elem was blocked outright, which
// would have locked the elementary admin out of their own descriptive levels.)
const eceAllowed = authorize(...ANY_ADMIN, ROLES.TEACHER)

const getActiveSYId = async () => {
  const res = await query('SELECT id, label, period_model, grading_policy FROM school_years WHERE is_active=TRUE LIMIT 1')
  if (!res.rows.length) throw new AppError('No active school year set.', 400)
  return res.rows[0]
}

// Resolve SY: use provided sy_id if valid, else active
const resolveSY = async (syId) => {
  if (syId) {
    const r = await query('SELECT id, label, period_model, grading_policy FROM school_years WHERE id=$1', [syId])
    if (r.rows.length) return r.rows[0]
  }
  return await getActiveSYId()
}

// Verify teacher is assigned to this (grade_level, section) for an ECE grade in the active SY
const verifyEceAssignment = async (req, gradeLevel, section) => {
  if (isAnyAdmin(req.user.role)) return
  const sy = await getActiveSYId()
  const assessment = await scaleFor(sy.id, gradeLevel)
  if (!assessment.isDescriptive) {
    throw new AppError(
      `${gradeLevel} is not assessed descriptively this school year — competency tracking does not apply to it.`,
      403
    )
  }
  const res = await query(
    `SELECT 1 FROM teacher_assignments
     WHERE teacher_id=$1 AND grade_level=$2 AND section=$3 AND school_year=$4
     LIMIT 1`,
    [req.user.id, gradeLevel, section, sy.label]
  )
  if (!res.rows.length) {
    throw new AppError('You are not assigned to this class.', 403)
  }
}

// ─── Summary: dashboard widget ──────────────────────────────
// GET /summary?quarter=<1..N, per the school year period model>  (quarter auto-detected if omitted)
// Teacher: scoped to their ECE assignments. Admin: school-wide.
// Returns per-class completion stats + rating distribution + by_grade_level rollup.
router.get('/summary', eceAllowed, async (req, res, next) => {
  try {
    const sy = await getActiveSYId()
    const isAdmin = isAnyAdmin(req.user.role)

    // Which grade levels are descriptive this year, narrowed to what the
    // caller may see (admin_ece: Kinder, admin_elem: Grade 1-6).
    const scope = gradeScopeForRole(req.user.role)
    const DESCRIPTIVE = await descriptiveLevelsFor(sy.id, scope)
    const assessmentRows = await loadAssessmentRows(sy.id)
    const scaleIdFor = (gl) => resolveAssessment(gl, assessmentRows.get(gl) || null).scaleId

    // Resolve the set of (grade_level, section) pairs to aggregate over.
    // Teacher: their own assignments. Admin: every descriptive class in the school.
    const asgn = DESCRIPTIVE.length === 0 ? { rows: [] } : isAdmin
      ? await query(
          `SELECT DISTINCT grade_level, section
           FROM teacher_assignments
           WHERE school_year=$1 AND grade_level = ANY($2)
           ORDER BY grade_level, section`,
          [sy.label, DESCRIPTIVE]
        )
      : await query(
          `SELECT DISTINCT grade_level, section
           FROM teacher_assignments
           WHERE teacher_id=$1 AND school_year=$2
             AND grade_level = ANY($3)`,
          [req.user.id, sy.label, DESCRIPTIVE]
        )
    if (!asgn.rows.length) {
      return res.json({
        quarter: 1,
        classes: [],
        by_grade_level: DESCRIPTIVE.map(gl => ({
          grade_level: gl, rating_scale: scaleIdFor(gl), class_count: 0, student_count: 0,
          rated_cells: 0, total_cells: 0, completion_pct: 0,
        })),
        totals: { students: 0, rated_cells: 0, total_cells: 0, completion_pct: 0 },
        distributions: [],
      })
    }

    // Resolve quarter: use explicit param, else latest quarter with records, else Q1
    let quarter = parseInt(req.query.quarter) || 0
    if (!quarter) {
      const qRes = await query(
        `SELECT MAX(r.quarter) AS latest
         FROM ece_competency_records r
         JOIN students s ON s.id = r.student_id
         WHERE r.school_year_id=$1
           AND (s.grade_level, s.section) IN (${asgn.rows.map((_, i) => `($${i*2+2}, $${i*2+3})`).join(', ')})`,
        [sy.id, ...asgn.rows.flatMap(a => [a.grade_level, a.section])]
      )
      quarter = qRes.rows[0]?.latest || 1
    }

    const classes = []
    let totalStudents = 0, totalRated = 0, totalCells = 0
    // Keyed by scale id — grade levels in the same year can use different scales.
    const distByScale = new Map()
    const bumpScale = (scaleId, code, n) => {
      if (!distByScale.has(scaleId)) distByScale.set(scaleId, ratingScale(scaleId).emptyDistribution())
      const d = distByScale.get(scaleId)
      if (Object.prototype.hasOwnProperty.call(d, code)) d[code] += n
    }

    for (const a of asgn.rows) {
      // Count students
      const stRes = await query(
        `SELECT COUNT(*)::int AS cnt FROM students
         WHERE is_active=TRUE AND grade_level=$1 AND section=$2`,
        [a.grade_level, a.section]
      )
      const studentCount = stRes.rows[0].cnt

      // Count active skills for this grade level
      const skRes = await query(
        `SELECT COUNT(*)::int AS cnt FROM competency_skills cs
         JOIN subjects sub ON sub.id = cs.subject_id
         WHERE cs.is_active=TRUE AND sub.grade_level=$1`,
        [a.grade_level]
      )
      const skillCount = skRes.rows[0].cnt

      // Count records + distribution for this class
      const recRes = await query(
        `SELECT r.rating, r.rating_scale, COUNT(*)::int AS cnt
         FROM ece_competency_records r
         JOIN students s ON s.id = r.student_id
         WHERE s.grade_level=$1 AND s.section=$2
           AND r.school_year_id=$3 AND r.quarter=$4
         GROUP BY r.rating, r.rating_scale`,
        [a.grade_level, a.section, sy.id, quarter]
      )

      const classScaleId = scaleIdFor(a.grade_level)
      const classDist = ratingScale(classScaleId).emptyDistribution()
      let ratedCells = 0
      for (const row of recRes.rows) {
        ratedCells += row.cnt
        // Attribute each row to the scale it was actually rated on, which may
        // differ from the current configuration for historical records.
        bumpScale(row.rating_scale || classScaleId, row.rating, row.cnt)
        if (Object.prototype.hasOwnProperty.call(classDist, row.rating)) classDist[row.rating] += row.cnt
      }

      const cells = studentCount * skillCount
      classes.push({
        grade_level: a.grade_level,
        section: a.section,
        rating_scale: classScaleId,
        distribution: classDist,
        student_count: studentCount,
        total_skills: skillCount,
        rated_cells: ratedCells,
        total_cells: cells,
        completion_pct: cells > 0 ? Math.round((ratedCells / cells) * 1000) / 10 : 0,
      })

      totalStudents += studentCount
      totalRated += ratedCells
      totalCells += cells
    }

    // Roll up per-class stats into a per-grade-level summary (for admin card).
    const byGradeLevel = DESCRIPTIVE.map(gl => {
      const entries = classes.filter(c => c.grade_level === gl)
      const rated = entries.reduce((a, c) => a + c.rated_cells, 0)
      const total = entries.reduce((a, c) => a + c.total_cells, 0)
      const stu   = entries.reduce((a, c) => a + c.student_count, 0)
      return {
        grade_level: gl,
        rating_scale: scaleIdFor(gl),
        class_count: entries.length,
        student_count: stu,
        rated_cells: rated,
        total_cells: total,
        completion_pct: total > 0 ? Math.round((rated / total) * 1000) / 10 : 0,
      }
    })

    res.json({
      quarter,
      classes,
      by_grade_level: byGradeLevel,
      totals: {
        students: totalStudents,
        rated_cells: totalRated,
        total_cells: totalCells,
        completion_pct: totalCells > 0 ? Math.round((totalRated / totalCells) * 1000) / 10 : 0,
      },
      // One entry per rating scale in play, each self-describing so the UI can
      // render a legend without knowing the scales up front.
      distributions: [...distByScale.entries()].map(([id, counts]) => {
        const s = ratingScale(id)
        return {
          scale_id: id,
          label: s.label,
          short: s.short,
          levels: s.levels,
          counts,
          total: Object.values(counts).reduce((a, b) => a + b, 0),
        }
      }),
    })
  } catch (e) { next(e) }
})

// ─── Catalog: Skills (grouped by subject) ────────────────────
router.get('/skills', async (req, res, next) => {
  try {
    const { subject_id } = req.query
    const params = []
    let where = 'WHERE s.is_active = TRUE'
    if (subject_id) {
      params.push(subject_id)
      where += ` AND s.subject_id = $${params.length}`
    }
    const r = await query(
      `SELECT s.id, s.subject_id, s.name, s.description, s.display_order, s.is_active
       FROM competency_skills s
       ${where}
       ORDER BY s.display_order, s.name`,
      params
    )
    res.json({ skills: r.rows })
  } catch (e) { next(e) }
})

router.post('/skills', eceAllowed, async (req, res, next) => {
  try {
    const schema = Joi.object({
      subject_id: Joi.string().uuid().required(),
      name: Joi.string().min(1).max(255).required(),
      description: Joi.string().allow('').optional(),
      display_order: Joi.number().integer().min(0).default(0),
    })
    const { value, error } = schema.validate(req.body)
    if (error) throw new AppError(error.message, 400)
    const r = await query(
      `INSERT INTO competency_skills (subject_id, name, description, display_order)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [value.subject_id, value.name, value.description || null, value.display_order]
    )
    res.status(201).json({ skill: r.rows[0] })
  } catch (e) { next(e) }
})

router.put('/skills/:id', eceAllowed, async (req, res, next) => {
  try {
    const schema = Joi.object({
      name: Joi.string().min(1).max(255).optional(),
      description: Joi.string().allow('').optional(),
      display_order: Joi.number().integer().min(0).optional(),
      is_active: Joi.boolean().optional(),
    })
    const { value, error } = schema.validate(req.body)
    if (error) throw new AppError(error.message, 400)
    const sets = []
    const params = []
    let i = 1
    for (const [k, v] of Object.entries(value)) {
      sets.push(`${k}=$${i++}`)
      params.push(v)
    }
    if (!sets.length) throw new AppError('No fields to update.', 400)
    sets.push(`updated_at=NOW()`)
    params.push(req.params.id)
    const r = await query(
      `UPDATE competency_skills SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`,
      params
    )
    if (!r.rows.length) throw new AppError('Skill not found.', 404)
    res.json({ skill: r.rows[0] })
  } catch (e) { next(e) }
})

router.delete('/skills/:id', eceAllowed, async (req, res, next) => {
  try {
    const used = await query(
      `SELECT 1 FROM ece_competency_records WHERE skill_id=$1 LIMIT 1`, [req.params.id]
    )
    if (used.rows.length) {
      await query(`UPDATE competency_skills SET is_active=FALSE, updated_at=NOW() WHERE id=$1`, [req.params.id])
      return res.json({ message: 'Skill archived (has existing records).' })
    }
    await query(`DELETE FROM competency_skills WHERE id=$1`, [req.params.id])
    res.json({ message: 'Skill deleted.' })
  } catch (e) { next(e) }
})

// ─── Records: teacher entry ──────────────────────────────────
// GET /records?grade_level=...&section=...&quarter=1&sy_id=
// Returns roster + existing records for that class+quarter.
router.get('/records', async (req, res, next) => {
  try {
    const { grade_level, section, quarter, sy_id } = req.query
    if (!grade_level || !section || !quarter) {
      throw new AppError('grade_level, section, and quarter are required.', 400)
    }
    await verifyEceAssignment(req, grade_level, section)
    const sy = await resolveSY(sy_id)

    const assessment = await scaleFor(sy.id, grade_level)
    if (!assessment.isDescriptive) {
      throw new AppError(
        `${grade_level} is assessed numerically in SY ${sy.label} — use Score Entry, not competency ratings.`,
        400
      )
    }

    const students = await query(
      `SELECT id, full_name, gender FROM students
       WHERE is_active=TRUE AND grade_level=$1 AND section=$2
       ORDER BY full_name`,
      [grade_level, section]
    )

    const records = await query(
      `SELECT r.student_id, r.skill_id, r.rating, r.rating_scale, r.notes
       FROM ece_competency_records r
       JOIN students s ON s.id = r.student_id
       WHERE s.grade_level=$1 AND s.section=$2
         AND r.school_year_id=$3 AND r.quarter=$4`,
      [grade_level, section, sy.id, quarter]
    )

    res.json({
      school_year: sy,
      students: students.rows,
      records: records.rows,
      // The scale the UI must render buttons for. Sent explicitly so the client
      // never has to guess which letters are legal for this class.
      rating_scale: assessment.scaleId,
      scale: assessment.scale,
    })
  } catch (e) { next(e) }
})

// GET /student-records?student_id=&quarter=&sy_id=
// Parent-scoped single-student view for the vista_parent mobile Academics tab.
// Returns: { school_year, student, skills[], records[] } — skills are every
// active skill for the student's grade level (so the UI can show "Not rated"
// placeholders), records are the student's ratings for the given quarter.
// Staff (admin + teacher) can call it too; parents are gated by link + the
// academic_access_suspended flag (423 Locked when suspended).
router.get('/student-records', enforceParentLinked, async (req, res, next) => {
  try {
    const studentId = req.parentStudentId || req.query.student_id
    const { quarter, sy_id } = req.query
    if (!studentId || !quarter) {
      throw new AppError('student_id and quarter are required.', 400)
    }

    if (req.user.role === ROLES.PARENT) {
      if (await rejectIfAcademicSuspended(res, studentId)) return
    }

    const studentRes = await query(
      `SELECT id, full_name, grade_level, section, gender
         FROM students WHERE id=$1 AND is_active=TRUE`,
      [studentId]
    )
    if (!studentRes.rows.length) throw new AppError('Student not found.', 404)
    const student = studentRes.rows[0]

    // Teachers can only view their own assigned classes
    if (req.user.role === ROLES.TEACHER) {
      await verifyEceAssignment(req, student.grade_level, student.section)
    }

    const sy = await resolveSY(sy_id)
    const studentAssessment = await scaleFor(sy.id, student.grade_level)
    if (!studentAssessment.isDescriptive) {
      throw new AppError(
        `${student.grade_level} is not assessed descriptively in SY ${sy.label}.`,
        400
      )
    }

    const skills = await query(
      `SELECT cs.id, cs.subject_id, cs.name, cs.description, cs.display_order,
              sub.name AS subject_name
         FROM competency_skills cs
         JOIN subjects sub ON sub.id = cs.subject_id
        WHERE cs.is_active = TRUE AND sub.grade_level = $1
        ORDER BY sub.name, cs.display_order, cs.name`,
      [student.grade_level]
    )

    const records = await query(
      `SELECT skill_id, rating, rating_scale, notes
         FROM ece_competency_records
        WHERE student_id=$1 AND school_year_id=$2 AND quarter=$3`,
      [studentId, sy.id, quarter]
    )

    res.json({
      school_year: sy,
      student,
      skills: skills.rows,
      records: records.rows,
      rating_scale: studentAssessment.scaleId,
      scale: studentAssessment.scale,
    })
  } catch (e) { next(e) }
})

// POST /records — bulk upsert for a class
// { grade_level, section, quarter, sy_id?, entries: [{ student_id, skill_id, rating, notes? }] }
router.post('/records', async (req, res, next) => {
  try {
    const schema = Joi.object({
      grade_level: Joi.string().valid(...ALL_GRADE_LEVELS).required(),
      section: Joi.string().required(),
      quarter: Joi.number().integer().min(1).max(4).required(),
      sy_id: Joi.string().uuid().optional(),
      entries: Joi.array().items(Joi.object({
        student_id: Joi.string().uuid().required(),
        skill_id: Joi.string().uuid().required(),
        // Valid codes depend on the grade level's configured scale, so they are
        // checked below rather than with a fixed Joi list.
        rating: Joi.string().max(2).required(),
        notes: Joi.string().allow('').optional(),
      })).required(),
    })
    const { value, error } = schema.validate(req.body)
    if (error) throw new AppError(error.message, 400)

    await verifyEceAssignment(req, value.grade_level, value.section)
    const sy = await resolveSY(value.sy_id)

    // Which scale applies, and therefore which rating codes are legal.
    const assessment = await scaleFor(sy.id, value.grade_level)
    if (!assessment.isDescriptive) {
      throw new AppError(
        `${value.grade_level} is assessed numerically in SY ${sy.label} — competency ratings cannot be recorded for it.`,
        400
      )
    }
    const scaleId = assessment.scaleId
    for (const e of value.entries) {
      if (!isValidRating(scaleId, e.rating)) {
        throw new AppError(
          `"${e.rating}" is not a valid rating for ${value.grade_level} — ` +
          `SY ${sy.label} uses ${assessment.scale.short}.`,
          422
        )
      }
    }

    // The number of grading periods is a property of the school year, so it
    // cannot be expressed as a fixed Joi rule or a DB CHECK.
    const policy = resolveGradingPolicy(sy, value.grade_level)
    if (!policy.periods.includes(Number(value.quarter))) {
      throw new AppError(
        `${policy.periodNoun} ${value.quarter} is not valid for SY ${sy.label} — it runs ${policy.periodCount} ${policy.periodNoun.toLowerCase()}s.`,
        422
      )
    }

    // Upsert each entry
    for (const e of value.entries) {
      await query(
        `INSERT INTO ece_competency_records
           (student_id, skill_id, school_year_id, quarter, rating, rating_scale, notes, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (student_id, skill_id, school_year_id, quarter)
         DO UPDATE SET rating = EXCLUDED.rating,
                       rating_scale = EXCLUDED.rating_scale,
                       notes = EXCLUDED.notes,
                       recorded_by = EXCLUDED.recorded_by,
                       updated_at = NOW()`,
        [e.student_id, e.skill_id, sy.id, value.quarter, e.rating, scaleId, e.notes || null, req.user.id]
      )
    }

    res.json({ message: `Saved ${value.entries.length} competency record(s).` })
  } catch (e) { next(e) }
})

module.exports = router
