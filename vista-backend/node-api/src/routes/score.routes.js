const express = require('express')
const router  = express.Router()
const Joi     = require('joi')
const { query, withTransaction } = require('../config/database')
const { authenticate, authorize } = require('../middleware/auth.middleware')
const { AppError } = require('../middleware/error.middleware')

router.use(authenticate)

// ── Helper: DepEd transmutation table (DO 8, s. 2015) ────────
// Converts initial grade (weighted average) to transmuted grade (60–100 scale)
const transmuteGrade = (initial) => {
  if (initial >= 100) return 100
  if (initial >= 60)  return Math.min(99, 75 + Math.floor((initial - 60) / 1.6))
  if (initial > 0)    return Math.min(74, 60 + Math.floor(initial / 4))
  return 60
}

// ── Helper: verify teacher is assigned to the given subject's class ──
// Resolves subject_id → subject name + grade_level, then checks teacher_assignments.
// Admins are always allowed. For teachers, grade_level and section must also be provided.
const verifyTeacherAssignment = async (req, subjectId, gradeLevel, section) => {
  if (req.user.role === 'admin') return
  // Look up the subject name, grade_level, and school year from subjects table
  const subRes = await query(
    `SELECT s.name, s.grade_level, sy.label AS school_year
     FROM subjects s
     JOIN school_years sy ON sy.id = s.school_year_id
     WHERE s.id=$1`, [subjectId]
  )
  if (!subRes.rows.length) throw new AppError('Subject not found.', 404)
  const subjectName = subRes.rows[0].name
  const subGradeLevel = gradeLevel || subRes.rows[0].grade_level
  const subSchoolYear = subRes.rows[0].school_year

  const conditions = [
    'teacher_id=$1', 'grade_level=$2', 'subject=$3'
  ]
  const params = [req.user.id, subGradeLevel, subjectName]

  if (section) {
    conditions.push(`section=$${params.length + 1}`)
    params.push(section)
  }
  if (subSchoolYear) {
    conditions.push(`school_year=$${params.length + 1}`)
    params.push(subSchoolYear)
  }

  const check = await query(
    `SELECT id FROM teacher_assignments WHERE ${conditions.join(' AND ')} LIMIT 1`,
    params
  )
  if (!check.rows.length) {
    throw new AppError('You are not assigned to this class/subject.', 403)
  }
}

// ── Helper: resolve school_year_id ────────────────────────────
const resolveSYId = async (sy_id) => {
  if (sy_id) return sy_id
  const res = await query('SELECT id FROM school_years WHERE is_active=TRUE LIMIT 1')
  if (!res.rows.length) throw new AppError('No active school year set.', 400)
  return res.rows[0].id
}

// ── Helper: build grading structure tree for a subject ────────
const getStructureTree = async (subjectId) => {
  const result = await query(
    `SELECT id, category_id, name, weight, sort_order
     FROM grading_structure
     WHERE subject_id=$1 AND is_active=TRUE
     ORDER BY sort_order, name`,
    [subjectId]
  )
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
  return categories
}


// ════════════════════════════════════════════════════════════
// SCORE ITEMS
// ════════════════════════════════════════════════════════════

// GET /api/scores/items?subject_id=&quarter=&grade_level=&section=
// Returns grading structure tree with score items nested under each component.
// Score items are scoped per section so a teacher handling the same subject in
// multiple sections maintains independent score items per section.
router.get('/items', async (req, res, next) => {
  try {
    const { subject_id, quarter, grade_level, section } = req.query
    if (!subject_id || !quarter || !section) {
      throw new AppError('subject_id, quarter, and section are required.', 400)
    }

    await verifyTeacherAssignment(req, subject_id, grade_level, section)

    const categories = await getStructureTree(subject_id)

    // Fetch all active score items for this subject+section+quarter
    const itemsRes = await query(
      `SELECT id, component_id, name, highest_possible_score, sort_order
       FROM score_items
       WHERE subject_id=$1 AND section=$2 AND quarter=$3 AND is_active=TRUE
       ORDER BY sort_order, name`,
      [subject_id, section, parseInt(quarter)]
    )

    // Group items by component_id
    const itemsByComp = new Map()
    for (const item of itemsRes.rows) {
      if (!itemsByComp.has(item.component_id)) itemsByComp.set(item.component_id, [])
      itemsByComp.get(item.component_id).push(item)
    }

    // Attach items to components
    for (const cat of categories) {
      for (const comp of cat.components) {
        comp.items = itemsByComp.get(comp.id) || []
      }
    }

    res.json({ categories })
  } catch (err) { next(err) }
})

// POST /api/scores/items — Create/replace score items for a component+quarter
router.post('/items', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const schema = Joi.object({
      component_id: Joi.string().uuid().required(),
      subject_id:   Joi.string().uuid().required(),
      grade_level:  Joi.string().optional(),
      section:      Joi.string().min(1).required(),
      quarter:      Joi.number().integer().min(1).max(4).required(),
      items: Joi.array().items(Joi.object({
        id:                     Joi.string().uuid().optional(),
        name:                   Joi.string().min(1).max(100).required(),
        highest_possible_score: Joi.number().greater(0).required(),
        sort_order:             Joi.number().integer().min(0).default(0),
      })).required(),
    })
    const { error, value } = schema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    // Verify teacher is assigned to this class/subject
    await verifyTeacherAssignment(req, value.subject_id, value.grade_level, value.section)

    // Verify component exists and belongs to the subject
    const compCheck = await query(
      `SELECT id FROM grading_structure
       WHERE id=$1 AND subject_id=$2 AND category_id IS NOT NULL AND is_active=TRUE`,
      [value.component_id, value.subject_id]
    )
    if (!compCheck.rows.length) throw new AppError('Component not found or invalid.', 404)

    const items = await withTransaction(async (client) => {
      // Collect IDs of items that should remain
      const keepIds = value.items.filter(i => i.id).map(i => i.id)

      // Hard-delete items no longer in the payload that have no recorded scores,
      // soft-delete items that have scores (should not happen since frontend blocks removal)
      const removedRes = keepIds.length > 0
        ? await client.query(
            `SELECT id FROM score_items WHERE component_id=$1 AND section=$2 AND quarter=$3 AND is_active=TRUE AND id != ALL($4)`,
            [value.component_id, value.section, value.quarter, keepIds]
          )
        : await client.query(
            `SELECT id FROM score_items WHERE component_id=$1 AND section=$2 AND quarter=$3 AND is_active=TRUE`,
            [value.component_id, value.section, value.quarter]
          )

      for (const row of removedRes.rows) {
        const hasScores = await client.query(
          `SELECT 1 FROM student_scores WHERE score_item_id=$1 LIMIT 1`, [row.id]
        )
        if (hasScores.rows.length) {
          await client.query(
            `UPDATE score_items SET is_active=FALSE, updated_at=NOW() WHERE id=$1`, [row.id]
          )
        } else {
          await client.query(`DELETE FROM score_items WHERE id=$1`, [row.id])
        }
      }

      const result = []
      for (let i = 0; i < value.items.length; i++) {
        const item = value.items[i]
        let row

        if (item.id) {
          // Update existing item in place (preserves student_scores)
          const r = await client.query(
            `UPDATE score_items SET name=$1, highest_possible_score=$2, sort_order=$3, is_active=TRUE, updated_at=NOW()
             WHERE id=$4 AND component_id=$5 AND section=$6 AND quarter=$7
             RETURNING id, component_id, name, highest_possible_score, sort_order`,
            [item.name, item.highest_possible_score, item.sort_order ?? i,
             item.id, value.component_id, value.section, value.quarter]
          )
          row = r.rows[0]
        }
        if (!row) {
          // Insert new item
          const r = await client.query(
            `INSERT INTO score_items (component_id, subject_id, section, quarter, name, highest_possible_score, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, component_id, name, highest_possible_score, sort_order`,
            [value.component_id, value.subject_id, value.section, value.quarter,
             item.name, item.highest_possible_score, item.sort_order ?? i, req.user.id]
          )
          row = r.rows[0]
        }
        result.push(row)
      }
      return result
    })

    res.json({ message: 'Score items saved.', items })
  } catch (err) { next(err) }
})

// DELETE /api/scores/items/:id — Soft-delete a score item
router.delete('/items/:id', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    // Look up the item's subject to verify assignment
    const itemRes = await query(
      'SELECT subject_id FROM score_items WHERE id=$1 AND is_active=TRUE', [req.params.id]
    )
    if (!itemRes.rows.length) throw new AppError('Score item not found.', 404)
    await verifyTeacherAssignment(req, itemRes.rows[0].subject_id)

    const result = await query(
      `UPDATE score_items SET is_active=FALSE, updated_at=NOW()
       WHERE id=$1 AND is_active=TRUE RETURNING id`,
      [req.params.id]
    )
    if (!result.rows.length) throw new AppError('Score item not found.', 404)
    res.json({ message: 'Score item removed.' })
  } catch (err) { next(err) }
})


// ════════════════════════════════════════════════════════════
// STUDENT SCORES
// ════════════════════════════════════════════════════════════

// GET /api/scores?subject_id=&quarter=&grade_level=&section=
// Returns students list, score items, and all scores for the grid
router.get('/', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const { subject_id, quarter, grade_level, section } = req.query
    if (!subject_id || !quarter || !grade_level || !section) {
      throw new AppError('subject_id, quarter, grade_level, and section are required.', 400)
    }

    // Verify teacher is assigned to this class/subject
    await verifyTeacherAssignment(req, subject_id, grade_level, section)

    // Fetch students in this grade_level + section
    const studentsRes = await query(
      `SELECT id, lrn, surname, first_name, middle_name, gender
       FROM students
       WHERE grade_level=$1 AND section=$2 AND is_active=TRUE
       ORDER BY surname, first_name`,
      [grade_level, section]
    )

    // Fetch active score items for this section
    const itemsRes = await query(
      `SELECT id, component_id, name, highest_possible_score, sort_order
       FROM score_items
       WHERE subject_id=$1 AND section=$2 AND quarter=$3 AND is_active=TRUE
       ORDER BY sort_order, name`,
      [subject_id, section, parseInt(quarter)]
    )

    // Fetch all student_scores for these items and students
    const studentIds = studentsRes.rows.map(s => s.id)
    const itemIds = itemsRes.rows.map(i => i.id)

    let scores = []
    if (studentIds.length && itemIds.length) {
      const scoresRes = await query(
        `SELECT score_item_id, student_id, score
         FROM student_scores
         WHERE score_item_id = ANY($1) AND student_id = ANY($2)`,
        [itemIds, studentIds]
      )
      scores = scoresRes.rows
    }

    res.json({
      students:    studentsRes.rows,
      score_items: itemsRes.rows,
      scores
    })
  } catch (err) { next(err) }
})

// POST /api/scores — Batch upsert student scores + auto-compute final grade
router.post('/', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const schema = Joi.object({
      subject_id:   Joi.string().uuid().required(),
      quarter:      Joi.number().integer().min(1).max(4).required(),
      grade_level:  Joi.string().required(),
      section:      Joi.string().required(),
      sy_id:        Joi.string().uuid().optional(),
      scores: Joi.array().items(Joi.object({
        score_item_id: Joi.string().uuid().required(),
        student_id:    Joi.string().uuid().required(),
        score:         Joi.number().min(0).allow(null).required(),
      })).min(1).required(),
    })
    const { error, value } = schema.validate(req.body)
    if (error) throw new AppError(error.details[0].message, 422)

    // Verify teacher is assigned to this class/subject
    await verifyTeacherAssignment(req, value.subject_id, value.grade_level, value.section)

    // Validate scores don't exceed HPS
    const itemIds = [...new Set(value.scores.map(s => s.score_item_id))]
    const hpsRes = await query(
      `SELECT id, highest_possible_score FROM score_items WHERE id = ANY($1) AND is_active=TRUE`,
      [itemIds]
    )
    const hpsMap = new Map(hpsRes.rows.map(r => [r.id, parseFloat(r.highest_possible_score)]))
    for (const s of value.scores) {
      const hps = hpsMap.get(s.score_item_id)
      if (hps === undefined) throw new AppError(`Score item ${s.score_item_id} not found.`, 404)
      if (s.score !== null && s.score > hps) {
        throw new AppError(`Score ${s.score} exceeds highest possible score ${hps}.`, 422)
      }
    }

    // Batch upsert scores
    await withTransaction(async (client) => {
      for (const s of value.scores) {
        await client.query(
          `INSERT INTO student_scores (score_item_id, student_id, score, recorded_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (score_item_id, student_id)
           DO UPDATE SET score = EXCLUDED.score, recorded_by = EXCLUDED.recorded_by, updated_at = NOW()`,
          [s.score_item_id, s.student_id, s.score, req.user.id]
        )
      }
    })

    // Auto-compute and sync final grades for affected students
    const studentIds = [...new Set(value.scores.map(s => s.student_id))]
    const sy_id = await resolveSYId(value.sy_id)

    // Get school year label for grades table
    const syRes = await query('SELECT label FROM school_years WHERE id=$1', [sy_id])
    const schoolYear = syRes.rows[0]?.label

    // Compute grades for each student
    const categories = await getStructureTree(value.subject_id)
    const allItems = await query(
      `SELECT id, component_id, highest_possible_score
       FROM score_items
       WHERE subject_id=$1 AND section=$2 AND quarter=$3 AND is_active=TRUE`,
      [value.subject_id, value.section, value.quarter]
    )

    for (const studentId of studentIds) {
      const studentScores = await query(
        `SELECT ss.score_item_id, ss.score
         FROM student_scores ss
         JOIN score_items si ON si.id = ss.score_item_id
         WHERE si.subject_id=$1 AND si.section=$2 AND si.quarter=$3 AND si.is_active=TRUE AND ss.student_id=$4`,
        [value.subject_id, value.section, value.quarter, studentId]
      )
      const scoreMap = new Map(studentScores.rows.map(r => [r.score_item_id, parseFloat(r.score)]))

      // Build item lookup by component
      const itemsByComp = new Map()
      for (const item of allItems.rows) {
        if (!itemsByComp.has(item.component_id)) itemsByComp.set(item.component_id, [])
        itemsByComp.get(item.component_id).push(item)
      }

      let initialGrade = 0
      for (const cat of categories) {
        for (const comp of cat.components) {
          const compItems = itemsByComp.get(comp.id) || []
          if (!compItems.length) continue
          const total = compItems.reduce((sum, item) => sum + (scoreMap.get(item.id) || 0), 0)
          const hpsTotal = compItems.reduce((sum, item) => sum + parseFloat(item.highest_possible_score), 0)
          const ps = hpsTotal > 0 ? (total / hpsTotal) * 100 : 0
          const ws = ps * (parseFloat(comp.weight) / 100)
          initialGrade += ws
        }
      }

      const roundedInitial = Math.round(initialGrade * 100) / 100
      const transmutedGrade = transmuteGrade(roundedInitial)
      const remarks = transmutedGrade >= 75 ? 'Passed' : 'Failed'

      if (schoolYear) {
        await query(
          `INSERT INTO grades (student_id, subject_id, quarter, school_year, score, grade, remarks, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (student_id, subject_id, quarter, school_year)
           DO UPDATE SET score = EXCLUDED.score, grade = EXCLUDED.grade, remarks = EXCLUDED.remarks, updated_at = NOW()`,
          [studentId, value.subject_id, value.quarter, schoolYear, roundedInitial, transmutedGrade, remarks, req.user.id]
        )
      }
    }

    res.json({ message: `${value.scores.length} scores saved.`, count: value.scores.length })
  } catch (err) { next(err) }
})

// GET /api/scores/breakdown?subject_id=&quarter=&grade_level=&section=
// Returns fully computed grade breakdown per student
router.get('/breakdown', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const { subject_id, quarter, grade_level, section } = req.query
    if (!subject_id || !quarter || !grade_level || !section) {
      throw new AppError('subject_id, quarter, grade_level, and section are required.', 400)
    }

    // Verify teacher is assigned to this class/subject
    await verifyTeacherAssignment(req, subject_id, grade_level, section)

    const categories = await getStructureTree(subject_id)

    // Fetch students
    const studentsRes = await query(
      `SELECT id, lrn, surname, first_name, middle_name, gender
       FROM students
       WHERE grade_level=$1 AND section=$2 AND is_active=TRUE
       ORDER BY surname, first_name`,
      [grade_level, section]
    )

    // Fetch all active score items for this subject+section+quarter
    const itemsRes = await query(
      `SELECT id, component_id, highest_possible_score
       FROM score_items
       WHERE subject_id=$1 AND section=$2 AND quarter=$3 AND is_active=TRUE`,
      [subject_id, section, parseInt(quarter)]
    )
    const itemsByComp = new Map()
    for (const item of itemsRes.rows) {
      if (!itemsByComp.has(item.component_id)) itemsByComp.set(item.component_id, [])
      itemsByComp.get(item.component_id).push(item)
    }

    // Fetch all scores
    const studentIds = studentsRes.rows.map(s => s.id)
    const itemIds = itemsRes.rows.map(i => i.id)
    let allScores = []
    if (studentIds.length && itemIds.length) {
      const scoresRes = await query(
        `SELECT score_item_id, student_id, score
         FROM student_scores
         WHERE score_item_id = ANY($1) AND student_id = ANY($2)`,
        [itemIds, studentIds]
      )
      allScores = scoresRes.rows
    }

    // Build score lookup: studentId -> itemId -> score
    const scoreLookup = new Map()
    for (const s of allScores) {
      if (!scoreLookup.has(s.student_id)) scoreLookup.set(s.student_id, new Map())
      scoreLookup.get(s.student_id).set(s.score_item_id, parseFloat(s.score))
    }

    // Compute breakdown per student
    const breakdown = studentsRes.rows.map(student => {
      const studentScores = scoreLookup.get(student.id) || new Map()
      const catBreakdown = categories.map(cat => {
        const compBreakdown = cat.components.map(comp => {
          const compItems = itemsByComp.get(comp.id) || []
          const total = compItems.reduce((sum, item) => sum + (studentScores.get(item.id) || 0), 0)
          const hpsTotal = compItems.reduce((sum, item) => sum + parseFloat(item.highest_possible_score), 0)
          const ps = hpsTotal > 0 ? (total / hpsTotal) * 100 : 0
          const ws = ps * (parseFloat(comp.weight) / 100)
          return { id: comp.id, name: comp.name, weight: comp.weight, total, hps_total: hpsTotal, ps: Math.round(ps * 100) / 100, ws: Math.round(ws * 100) / 100 }
        })
        const catWs = compBreakdown.reduce((sum, c) => sum + c.ws, 0)
        return { id: cat.id, name: cat.name, weight: cat.weight, components: compBreakdown, ws: Math.round(catWs * 100) / 100 }
      })
      const initialGrade = Math.round(catBreakdown.reduce((sum, c) => sum + c.ws, 0) * 100) / 100
      const transmuted = transmuteGrade(initialGrade)
      return {
        student,
        categories: catBreakdown,
        initial_grade: initialGrade,
        final_grade:   transmuted,
        remarks:       transmuted >= 75 ? 'Passed' : 'Failed',
      }
    })

    res.json({ breakdown })
  } catch (err) { next(err) }
})

module.exports = router
