/**
 * Loader for `grade_level_assessment` — how each grade level is assessed in a
 * given school year (numeric vs descriptive, and on which rating scale).
 *
 * Kept separate from `utils/grading.js` because that module is deliberately
 * pure (no DB) so it can be mirrored verbatim into the dashboard bundle.
 *
 * With no configuration rows the resolver falls back to
 * `defaultAssessmentFor()`, which reproduces VISTA's pre-DO-015 behaviour:
 * Kinder descriptive on E/G/F/NA, Grades 1-6 numeric.
 */
const { query } = require('../config/database')
const { resolveAssessment, DEFAULT_DESCRIPTIVE_GRADES } = require('./grading')

/** Raw config rows for a school year, keyed by grade level. */
const loadAssessmentRows = async (syId) => {
  if (!syId) return new Map()
  const res = await query(
    `SELECT grade_level, assessment_mode, rating_scale
       FROM grade_level_assessment
      WHERE school_year_id = $1`,
    [syId]
  )
  return new Map(res.rows.map(r => [r.grade_level, r]))
}

/** Resolved assessment for every grade level in a school year. */
const loadAssessmentMap = async (syId, gradeLevels) => {
  const rows = await loadAssessmentRows(syId)
  const levels = gradeLevels && gradeLevels.length
    ? gradeLevels
    : [...new Set([...rows.keys(), ...DEFAULT_DESCRIPTIVE_GRADES])]
  return new Map(levels.map(gl => [gl, resolveAssessment(gl, rows.get(gl) || null)]))
}

/** Resolved assessment for one grade level. */
const loadAssessment = async (syId, gradeLevel) => {
  const rows = await loadAssessmentRows(syId)
  return resolveAssessment(gradeLevel, rows.get(gradeLevel) || null)
}

/**
 * Grade levels assessed descriptively in a school year — the configurable
 * replacement for the hardcoded `ECE_GRADES` list that previously gated the
 * competency tracker.
 *
 * Note this is NOT `roles.ECE_GRADES`: that constant answers "which grade levels
 * may an `admin_ece` manage", an org-chart question that DO 015 does not change.
 */
const descriptiveGradeLevels = async (syId, allGradeLevels) => {
  const rows = await loadAssessmentRows(syId)
  const candidates = allGradeLevels && allGradeLevels.length
    ? allGradeLevels
    : [...new Set([...rows.keys(), ...DEFAULT_DESCRIPTIVE_GRADES])]
  return candidates.filter(gl => resolveAssessment(gl, rows.get(gl) || null).isDescriptive)
}

module.exports = {
  loadAssessmentRows,
  loadAssessmentMap,
  loadAssessment,
  descriptiveGradeLevels,
}
