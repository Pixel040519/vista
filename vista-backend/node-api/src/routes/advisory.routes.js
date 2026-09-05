/**
 * The class adviser's view of their own section — /api/advisory
 *
 * Every other teacher-facing academic read in this codebase is **one subject at
 * a time**: `/grades/by-subject`, `/scores`, `/scores/breakdown` all require a
 * `subject_id` and gate on a matching `teacher_assignments` row. That is the
 * right shape for a subject teacher and the wrong one for an adviser, whose
 * remit is the whole learner across every learning area — the SF9 report card,
 * the SF2 attendance register, and conduct. So this is a new surface rather than
 * a wider filter on the old one.
 *
 * ## Read-only, structurally
 *
 * This router defines **no POST, PUT or DELETE**, and nothing outside it gained
 * an adviser branch on a write path. Entering grades, marking attendance and
 * recording scores stay with the subject teacher, gated exactly as before by
 * `verifyTeacherAssignment()` and friends. The read-only promise is therefore a
 * property of the code's shape, not a convention someone has to remember: there
 * is no adviser-authorized write to accidentally reach.
 *
 * ## Scope
 *
 * Everything is keyed on `section_id` and guarded by `assertAdvisorySection()`,
 * which refuses anything the caller does not advise in the **active** school
 * year. See `utils/advisory.js` for why the section's own id is the right key
 * (the assignment-based filters suffer a year-skew this cannot).
 */

const express = require('express')
const router  = express.Router()

const { query } = require('../config/database')
const { authenticate, authorize } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')
const { ROLES } = require('../utils/roles')
const { resolveGradingPolicy, finalGradeFrom, bandDistribution } = require('../utils/grading')
const { loadAssessment } = require('../utils/assessmentConfig')
const { assertAdvisorySection, advisoryClassList } = require('../utils/advisory')

// Advisory is a teacher concept. Admins have school-wide surfaces of their own
// and would only reach this one by holding an adviser row, which they cannot.
router.use(authenticate, authorize(ROLES.TEACHER))

/**
 * Resolve the section, its class list and how its grade level is assessed — the
 * preamble every handler needs. `ids` is precomputed because each of the four
 * data queries filters on `student_id = ANY($1)`.
 */
const advisoryContext = async (req) => {
  const section    = await assertAdvisorySection(req, req.query.section_id)
  const assessment = await loadAssessment(section.school_year_id, section.grade_level)
  const students   = await advisoryClassList(section)
  const grading    = resolveGradingPolicy(section, section.grade_level, null)
  return { section, assessment, students, ids: students.map(s => s.id), grading }
}

/** The period the caller asked for, validated against this year's model. */
const readPeriod = (req, grading) => {
  const q = parseInt(req.query.quarter, 10)
  if (!q || !grading.periods.includes(q)) {
    throw new AppError(
      `quarter must be one of ${grading.periods.join(', ')} for a ${grading.periodModel} school year.`,
      422
    )
  }
  return q
}

/** Section header + class list + how this grade level is assessed. */
router.get('/class-list', async (req, res, next) => {
  try {
    const { section, assessment, students, grading } = await advisoryContext(req)

    // Every learning area of this grade level for this year — the adviser sees
    // all of them, including the ones they do not teach. That is the whole
    // point. `parent_id IS NULL` keeps MAPEH one entry rather than five: the
    // adviser compiles an SF9, which has one row per learning area.
    const subjects = await query(
      `SELECT id, name,
              (SELECT COUNT(*)::int FROM subjects a
                WHERE a.parent_id = subjects.id AND a.is_active = TRUE) AS area_count
         FROM subjects
        WHERE grade_level=$1 AND school_year_id=$2 AND is_active=TRUE
          AND parent_id IS NULL
        ORDER BY name`,
      [section.grade_level, section.school_year_id]
    )

    res.json({
      section: {
        id: section.id,
        grade_level: section.grade_level,
        name: section.name,
        school_year: section.school_year,
        school_year_id: section.school_year_id,
      },
      // The client picks Grades vs Competency off this, never off a grade-level
      // list — Grade 1 becomes descriptive under DO 015 without any code change.
      assessment: {
        mode: assessment.mode,
        is_descriptive: assessment.isDescriptive,
        rating_scale: assessment.scaleId,
        scale: assessment.scale,
      },
      grading: {
        period_model: grading.periodModel,
        period_noun:  grading.periodNoun,
        periods:      grading.periods,
        ordinals:     grading.ordinals,
        passing_grade: grading.passingGrade,
      },
      subjects: subjects.rows,
      students,
    })
  } catch (e) { next(e) }
})

/**
 * The cross-subject grade sheet — learners down, subjects across.
 *
 * There is no existing endpoint this could reuse. `/grades/by-subject` takes one
 * `subject_id` and 403s a teacher with no assignment for it, so an adviser could
 * only assemble this by teaching every subject in their own class.
 */
router.get('/grades', async (req, res, next) => {
  try {
    const { section, assessment, students, ids, grading } = await advisoryContext(req)

    if (assessment.isDescriptive) {
      throw new AppError(
        `${section.grade_level} is assessed descriptively in SY ${section.school_year} — use the competency view.`,
        400
      )
    }

    const quarter = readPeriod(req, grading)

    // `grades.school_year` is the year's label, not its id — the column predates
    // the school_year_id convention and every other reader matches it the same
    // way.
    const rows = ids.length
      ? await query(
          `SELECT g.student_id, g.subject_id, g.quarter, g.grade, g.score, g.remarks,
                  sub.name AS subject_name, sub.grade_level AS subject_grade_level
             FROM grades g
             JOIN subjects sub ON sub.id = g.subject_id
            WHERE g.student_id = ANY($1::uuid[])
              AND g.school_year = $2
              AND sub.parent_id IS NULL`,
          [ids, section.school_year]
        )
      : { rows: [] }

    // Columns are this grade level's subjects **plus any subject the learners
    // actually hold a grade in this year**.
    //
    // The union is not defensive padding. `students.grade_level` is the active
    // year's snapshot, while a grade row points at whatever subject it was
    // recorded against — and a subject is scoped to a grade level. So a learner
    // promoted mid-year, or one whose placement was corrected, has grades
    // against another level's subjects inside the same school year. Listing only
    // the current level's subjects silently drops those: the sheet renders full
    // of blanks and looks like nobody has been graded. Surfacing them with an
    // `off_level` flag lets the adviser see the work and notice the anomaly,
    // which is the house rule everywhere else — marked, not hidden.
    //
    // Both sides of the union are **learning areas** (`parent_id IS NULL`).
    // MAPEH is one column carrying the grade the roll-up wrote, not five; that
    // is what an SF9 row is, and it is also what keeps `general_average` below
    // from weighting MAPEH four times against every other learning area.
    const levelSubjects = await query(
      `SELECT id, name FROM subjects
        WHERE grade_level=$1 AND school_year_id=$2 AND is_active=TRUE
          AND parent_id IS NULL
        ORDER BY name`,
      [section.grade_level, section.school_year_id]
    )
    const columns = levelSubjects.rows.map(s => ({ ...s, off_level: false }))
    const known = new Set(columns.map(s => s.id))
    for (const r of rows.rows) {
      if (known.has(r.subject_id)) continue
      known.add(r.subject_id)
      columns.push({
        id: r.subject_id,
        name: r.subject_name,
        off_level: true,
        grade_level: r.subject_grade_level,
      })
    }
    const subjects = { rows: columns }

    // student_id -> subject_id -> quarter -> row
    const byStudent = new Map(ids.map(id => [id, new Map()]))
    for (const r of rows.rows) {
      const perSubject = byStudent.get(r.student_id)
      if (!perSubject) continue
      if (!perSubject.has(r.subject_id)) perSubject.set(r.subject_id, new Map())
      perSubject.get(r.subject_id).set(r.quarter, r)
    }

    const result = students.map(s => {
      const perSubject = byStudent.get(s.id) || new Map()
      const cells = subjects.rows.map(sub => {
        const periods = perSubject.get(sub.id) || new Map()
        const here = periods.get(quarter)
        return {
          subject_id: sub.id,
          grade: here?.grade ?? null,
          remarks: here?.remarks ?? null,
          // The learner's standing in this subject across every period so far,
          // so the sheet can show a running final beside the selected one.
          final: finalGradeFrom(grading.periods.map(p => periods.get(p)?.grade ?? null)),
        }
      })
      const present = cells.map(c => c.grade).filter(g => g !== null && g !== undefined)
      return {
        student_id: s.id,
        cells,
        // The general average across learning areas for the selected period —
        // the number an adviser is actually looking for.
        general_average: finalGradeFrom(present),
      }
    })

    res.json({ quarter, subjects: subjects.rows, students, rows: result })
  } catch (e) { next(e) }
})

/**
 * The descriptive equivalent of the sheet above.
 *
 * Deliberately its own endpoint rather than an adviser branch inside
 * `verifyEceAssignment()` (`ece.routes.js`): that helper gates `POST /records`
 * as well as the two reads, so widening it would hand the adviser a write.
 */
router.get('/competency', async (req, res, next) => {
  try {
    const { section, assessment, students, ids, grading } = await advisoryContext(req)

    if (!assessment.isDescriptive) {
      throw new AppError(
        `${section.grade_level} is assessed numerically in SY ${section.school_year} — use the grades view.`,
        400
      )
    }

    const quarter = readPeriod(req, grading)

    // `competency_skills` carries no grade level of its own — it reaches one
    // through `subject_id`, which is also what scopes it to a school year. Same
    // join `ece.routes.js` uses to count skills for a class.
    const skills = await query(
      `SELECT sk.id, sk.name, sk.domain_id, d.name AS domain_name,
              sk.subject_id, sub.name AS subject_name, sk.display_order
         FROM competency_skills sk
         JOIN subjects sub             ON sub.id = sk.subject_id
         LEFT JOIN competency_domains d ON d.id = sk.domain_id
        WHERE sk.is_active=TRUE AND sub.is_active=TRUE
          AND sub.grade_level=$1 AND sub.school_year_id=$2
        ORDER BY sub.name, sk.display_order, sk.name`,
      [section.grade_level, section.school_year_id]
    )

    const records = ids.length
      ? await query(
          `SELECT r.student_id, r.skill_id, r.rating, r.rating_scale
             FROM ece_competency_records r
            WHERE r.student_id = ANY($1::uuid[])
              AND r.school_year_id=$2 AND r.quarter=$3`,
          [ids, section.school_year_id, quarter]
        )
      : { rows: [] }

    // Each record carries its own scale, so a re-configured grade level cannot
    // silently reinterpret history. Band per learner on the record's own scale.
    const byStudent = new Map(ids.map(id => [id, []]))
    for (const r of records.rows) byStudent.get(r.student_id)?.push(r)

    const rows = students.map(s => {
      const mine = byStudent.get(s.id) || []
      const dist = {}
      for (const r of mine) dist[r.rating] = (dist[r.rating] || 0) + 1
      return {
        student_id: s.id,
        rated: mine.length,
        total_skills: skills.rows.length,
        distribution: dist,
        band: bandDistribution(dist, skills.rows.length, mine[0]?.rating_scale || assessment.scaleId),
      }
    })

    res.json({
      quarter,
      rating_scale: assessment.scaleId,
      scale: assessment.scale,
      skills: skills.rows,
      students,
      records: records.rows,
      rows,
    })
  } catch (e) { next(e) }
})

/**
 * Attendance across **every** subject, which is what the register asks for.
 * A subject teacher's own view is narrowed to the subjects they teach; the
 * adviser's is not, and the per-subject breakdown is what makes a partial day
 * ("present in Math, absent in Science") legible.
 */
router.get('/attendance', async (req, res, next) => {
  try {
    const { section, students, ids } = await advisoryContext(req)
    const { from, to } = req.query

    const rows = ids.length
      ? await query(
          `SELECT a.student_id, a.status, sub.name AS subject_name, COUNT(*)::int AS n
             FROM attendance a
             LEFT JOIN subjects sub ON sub.id = a.subject_id
            WHERE a.student_id = ANY($1::uuid[])
              AND a.school_year_id = $2
              AND ($3::date IS NULL OR a.date >= $3::date)
              AND ($4::date IS NULL OR a.date <= $4::date)
            GROUP BY a.student_id, a.status, sub.name
            ORDER BY sub.name NULLS LAST`,
          [ids, section.school_year_id, from || null, to || null]
        )
      : { rows: [] }

    const blank = () => ({ Present: 0, Absent: 0, Late: 0, Excused: 0 })
    const totals   = new Map(ids.map(id => [id, blank()]))
    const bySubject = new Map(ids.map(id => [id, new Map()]))

    for (const r of rows.rows) {
      const t = totals.get(r.student_id)
      if (!t) continue
      if (r.status in t) t[r.status] += r.n
      const subj = r.subject_name || 'No subject'
      const per = bySubject.get(r.student_id)
      if (!per.has(subj)) per.set(subj, blank())
      if (r.status in per.get(subj)) per.get(subj)[r.status] += r.n
    }

    res.json({
      from: from || null,
      to: to || null,
      students,
      rows: students.map(s => {
        const t = totals.get(s.id) || blank()
        const marked = t.Present + t.Absent + t.Late + t.Excused
        return {
          student_id: s.id,
          counts: t,
          total: marked,
          // Present and Late both mean the learner attended — the same rule the
          // dashboard's "Present Today" card uses.
          rate: marked ? (t.Present + t.Late) / marked : null,
          by_subject: [...(bySubject.get(s.id) || new Map())].map(([subject_name, counts]) => ({
            subject_name, counts,
          })),
        }
      }),
    })
  } catch (e) { next(e) }
})

/**
 * Every teacher's behaviour logs for the section's learners.
 *
 * This is the one place an adviser reads something another teacher wrote. A
 * subject teacher's own `GET /api/behavior` stays pinned to `bl.teacher_id =
 * me`; conduct is the adviser's responsibility, so their view is the class's,
 * not their own.
 */
router.get('/behavior', async (req, res, next) => {
  try {
    const { section, students, ids } = await advisoryContext(req)
    const limit  = Math.min(parseInt(req.query.limit, 10) || 100, 300)
    const offset = parseInt(req.query.offset, 10) || 0

    const where = ['bl.student_id = ANY($1::uuid[])', 'bl.school_year_id = $2']
    const params = [ids.length ? ids : [null], section.school_year_id]
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)) }
    if (req.query.category)  add('bl.category = ?', req.query.category)
    if (req.query.sentiment) add('bl.sentiment = ?', req.query.sentiment)
    if (req.query.student_id) add('bl.student_id = ?', req.query.student_id)

    const clause = where.join(' AND ')
    const [list, count] = await Promise.all([
      query(
        `SELECT bl.id, bl.student_id, bl.teacher_id, bl.category, bl.observation,
                bl.sentiment, bl.sentiment_score, bl.observed_at,
                u.full_name AS teacher_name
           FROM behavior_logs bl
           LEFT JOIN users u ON u.id = bl.teacher_id
          WHERE ${clause}
          ORDER BY bl.observed_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*)::int AS n FROM behavior_logs bl WHERE ${clause}`, params),
    ])

    res.json({ students, logs: list.rows, total: count.rows[0].n, limit, offset })
  } catch (e) { next(e) }
})

module.exports = router
