/**
 * Grading policy — mirror of `vista-backend/node-api/src/utils/grading.js`.
 * Same convention as `utils/roles.js`. Keep the two in sync.
 *
 * DepEd runs three different grading models across three consecutive years
 * (DO 009 and DO 015, s. 2026), so the period count and the transmutation
 * table are resolved per school year rather than hardcoded:
 *
 *   SY 2025-2026   4 quarters   DO 8, s. 2015 transmutation
 *   SY 2026-2027   3 terms      DO 015, s. 2026 adjusted transmutation
 *   SY 2027-2028+  3 terms      zero-based — no transmutation at all
 */

export const PASSING_GRADE = 75

// ── Period models ────────────────────────────────────────────

export const PERIOD_MODELS = {
  '4Q': {
    id: '4Q',
    count: 4,
    noun: 'Quarter',
    abbr: 'Q',
    periods: [1, 2, 3, 4],
    ordinals: ['1st', '2nd', '3rd', '4th'],
    sheetLabels: ['FIRST GRADING', 'SECOND GRADING', 'THIRD GRADING', 'FOURTH GRADING'],
  },
  '3T': {
    id: '3T',
    count: 3,
    noun: 'Term',
    abbr: 'T',
    periods: [1, 2, 3],
    ordinals: ['1st', '2nd', '3rd'],
    sheetLabels: ['FIRST TERM', 'SECOND TERM', 'THIRD TERM'],
  },
}

export const DEFAULT_PERIOD_MODEL = '4Q'

export const periodModel = (id) => PERIOD_MODELS[id] || PERIOD_MODELS[DEFAULT_PERIOD_MODEL]

// ── Transmutation ────────────────────────────────────────────

/**
 * DO 8, s. 2015. Kept verbatim so archived school years keep reproducing the
 * exact grades that were issued to parents.
 */
const transmuteDO8_2015 = (initial) => {
  if (initial >= 100) return 100
  if (initial >= 60)  return Math.min(99, 75 + Math.floor((initial - 60) / 1.6))
  if (initial > 0)    return Math.min(74, 60 + Math.floor(initial / 4))
  return 60
}

/**
 * DO 015, s. 2026, Annex D Table 4 — "Adjusted Transmutation Table".
 * Each entry is the band's inclusive lower bound; scanned top down.
 * The initial grade needed to pass rose from 60.00 to 70.00.
 */
export const DO15_2026_BANDS = [
  { min: 99.50, grade: 100 },
  { min: 98.32, grade:  99 },
  { min: 97.14, grade:  98 },
  { min: 95.96, grade:  97 },
  { min: 94.78, grade:  96 },
  { min: 93.60, grade:  95 },
  { min: 92.42, grade:  94 },
  { min: 91.24, grade:  93 },
  { min: 90.06, grade:  92 },
  { min: 88.88, grade:  91 },
  { min: 87.70, grade:  90 },
  { min: 86.52, grade:  89 },
  { min: 85.34, grade:  88 },
  { min: 84.16, grade:  87 },
  { min: 82.98, grade:  86 },
  { min: 81.80, grade:  85 },
  { min: 80.62, grade:  84 },
  { min: 79.44, grade:  83 },
  { min: 78.26, grade:  82 },
  { min: 77.08, grade:  81 },
  { min: 75.90, grade:  80 },
  { min: 74.72, grade:  79 },
  { min: 73.54, grade:  78 },
  { min: 72.36, grade:  77 },
  { min: 71.18, grade:  76 },
  { min: 70.00, grade:  75 },
  { min: 65.34, grade:  74 },
  { min: 60.67, grade:  73 },
  { min: 56.01, grade:  72 },
  { min: 51.34, grade:  71 },
  { min: 46.67, grade:  70 },
  { min: 42.01, grade:  69 },
  { min: 37.34, grade:  68 },
  { min: 32.68, grade:  67 },
  { min: 28.01, grade:  66 },
  { min: 23.35, grade:  65 },
  { min: 18.68, grade:  64 },
  { min: 14.01, grade:  63 },
  { min:  9.35, grade:  62 },
  { min:  4.68, grade:  61 },
  { min:  0.00, grade:  60 },
]

const transmuteDO15_2026 = (initial) => {
  if (initial >= 100) return 100
  for (const band of DO15_2026_BANDS) {
    if (initial >= band.min) return band.grade
  }
  return 60
}

/** DO 015, s. 2026 §50 — zero-based grading, effective SY 2027-2028. */
const transmuteZeroBased = (initial) => {
  if (!Number.isFinite(initial) || initial <= 0) return 0
  return Math.min(100, Math.round(initial))
}

// ── Descriptors ──────────────────────────────────────────────

const remarksPassFail = (grade) => (grade >= PASSING_GRADE ? 'Passed' : 'Failed')

/** DO 015, s. 2026 Table 11 — "Qualitative Descriptors of Numeric Grades". */
export const DO15_2026_DESCRIPTORS = [
  { min: 90, label: 'Advancing',    filipino: 'Namumukod-tangi', response: 'Enrichment; leadership, transfer, peer mentoring' },
  { min: 80, label: 'Benchmarking', filipino: 'Napamamalas',     response: 'Deeper application, transfer, increased independence' },
  { min: 75, label: 'Connecting',   filipino: 'Natutungo',       response: 'Guided practice to strengthen consistency, accuracy, confidence' },
  { min: 65, label: 'Developing',   filipino: 'Napauunlad',      response: 'Targeted remediation, scaffolded instruction' },
  { min:  0, label: 'Emerging',     filipino: 'Nagsisimula',     response: 'Structured, sustained intervention programs' },
]

const descriptorDO15_2026 = (grade) =>
  DO15_2026_DESCRIPTORS.find(d => grade >= d.min) ||
  DO15_2026_DESCRIPTORS[DO15_2026_DESCRIPTORS.length - 1]

const remarksDO15_2026 = (grade) => descriptorDO15_2026(grade).label

// ── Grading policies ─────────────────────────────────────────

export const GRADING_POLICIES = {
  DO8_2015: {
    id: 'DO8_2015',
    label: 'DO 8, s. 2015',
    transmutes: true,
    transmute: transmuteDO8_2015,
    remarksFor: remarksPassFail,
    descriptorFor: null,
  },
  DO15_2026: {
    id: 'DO15_2026',
    label: 'DO 015, s. 2026 (adjusted transmutation)',
    transmutes: true,
    transmute: transmuteDO15_2026,
    remarksFor: remarksDO15_2026,
    descriptorFor: descriptorDO15_2026,
  },
  ZERO_BASED: {
    id: 'ZERO_BASED',
    label: 'DO 015, s. 2026 (zero-based)',
    transmutes: false,
    transmute: transmuteZeroBased,
    remarksFor: remarksDO15_2026,
    descriptorFor: descriptorDO15_2026,
  },
}

export const DEFAULT_GRADING_POLICY = 'DO8_2015'

export const gradingPolicy = (id) => GRADING_POLICIES[id] || GRADING_POLICIES[DEFAULT_GRADING_POLICY]

/** Options for the school-year form's two dropdowns. */
export const PERIOD_MODEL_OPTIONS = [
  { value: '4Q', label: '4 Quarters (DO 8, s. 2015)' },
  { value: '3T', label: '3 Terms (DO 009, s. 2026)' },
]

export const GRADING_POLICY_OPTIONS = [
  { value: 'DO8_2015',   label: 'DO 8, s. 2015 transmutation' },
  { value: 'DO15_2026',  label: 'DO 015, s. 2026 transmutation' },
  { value: 'ZERO_BASED', label: 'Zero-based (no transmutation)' },
]

// ── Rating scales (descriptive grading) ──────────────────────
//
// Levels are ordered **best first**. Everything downstream derives from that
// order rather than from hardcoded letters, so adding a scale needs no changes
// to the banding, risk-weighting, or distribution code.
//
// `weight` is the 0-1 value the AI risk model uses. It is derived by rule —
// (levels - index) / levels — which reproduces VISTA's existing E/G/F/NA
// weights (1.0 / 0.75 / 0.5 / 0.25) exactly, so risk scores do not move.
//
// `numericRange` exists only on ABCDE: DO 015 Annex C s.6 publishes indicative
// equivalents for transfers to schools not yet on descriptive grading. The order
// is explicit that these are **not** exact computed grades and must never
// replace descriptive reporting, so they are labelled, not used for computation.

const RATING_SCALE_DEFS = {
  EGFNA: {
    id: 'EGFNA',
    label: 'Excellent / Good / Fair / Needs Assistance',
    short: 'E / G / F / NA',
    source: "VISTA's existing early-childhood scale",
    levels: [
      { code: 'E',  label: 'Excellent',         color: 'emerald' },
      { code: 'G',  label: 'Good',              color: 'brand'   },
      { code: 'F',  label: 'Fair',              color: 'amber'   },
      { code: 'NA', label: 'Needs Assistance',  color: 'red'     },
    ],
  },
  CODVBG: {
    id: 'CODVBG',
    label: 'Consistent / Developing / Beginning',
    short: 'CO / DV / BG',
    source: 'DepEd DO 015, s. 2026 Table 7 (Kindergarten)',
    levels: [
      { code: 'CO', label: 'Consistent', filipino: 'Palagiang Naipapakita', color: 'emerald',
        description: 'Consistently demonstrates the expected competency; works independently' },
      { code: 'DV', label: 'Developing', filipino: 'Umuusbong', color: 'amber',
        description: 'Demonstrates the competency inconsistently; needs minimal supervision' },
      { code: 'BG', label: 'Beginning',  filipino: 'Nagsisimula', color: 'red',
        description: 'Rarely demonstrates the competency; requires sustained guidance' },
    ],
  },
  ABCDE: {
    id: 'ABCDE',
    label: 'Advancing / Benchmarking / Connecting / Developing / Emerging',
    short: 'A / B / C / D / E',
    source: 'DepEd DO 015, s. 2026 Table 8 (Grades 1-3)',
    levels: [
      { code: 'A', label: 'Advancing',    filipino: 'Namumukod-tangi', color: 'emerald', numericRange: [90, 100] },
      { code: 'B', label: 'Benchmarking', filipino: 'Napamamalas',     color: 'brand',   numericRange: [80, 89]  },
      { code: 'C', label: 'Connecting',   filipino: 'Natutungo',       color: 'sky',     numericRange: [75, 79]  },
      { code: 'D', label: 'Developing',   filipino: 'Napauunlad',      color: 'amber',   numericRange: [65, 74]  },
      { code: 'E', label: 'Emerging',     filipino: 'Nagsisimula',     color: 'red',     numericRange: [0,  64]  },
    ],
  },
}

// Decorate each level with its derived rank and weight once, at module load.
export const RATING_SCALES = Object.fromEntries(
  Object.entries(RATING_SCALE_DEFS).map(([id, def]) => {
    const n = def.levels.length
    const levels = def.levels.map((lv, i) => ({
      ...lv,
      rank: n - i,          // best = n, worst = 1
      weight: (n - i) / n,  // reproduces E=1.0 / G=0.75 / F=0.5 / NA=0.25
    }))
    return [id, {
      ...def,
      levels,
      codes: levels.map(l => l.code),
      best: levels[0],
      worst: levels[n - 1],
      secondWorst: n >= 2 ? levels[n - 2] : levels[n - 1],
      weights: Object.fromEntries(levels.map(l => [l.code, l.weight])),
      byCode: Object.fromEntries(levels.map(l => [l.code, l])),
      emptyDistribution: () => Object.fromEntries(levels.map(l => [l.code, 0])),
    }]
  })
)

export const DEFAULT_RATING_SCALE = 'EGFNA'

export const ratingScale = (id) => RATING_SCALES[id] || RATING_SCALES[DEFAULT_RATING_SCALE]

export const isValidRating = (scaleId, code) => !!ratingScale(scaleId).byCode[code]

// ── Assessment mode per grade level ──────────────────────────
//
// **This is deliberately NOT `ECE_GRADES` from utils/roles.js.** That constant
// answers "which grade levels may an admin_ece manage" — an org-chart question.
// This answers "how is this grade level assessed" — a curriculum question. They
// happened to coincide while only Kinder was descriptive; DO 015
// moves Grade 1 to descriptive grading without making it an ECE admin's
// responsibility, so the two meanings must not share a constant.

// Used only when a school year has no explicit configuration row: preserves the
// behaviour VISTA had before assessment mode became configurable.
export const DEFAULT_DESCRIPTIVE_GRADES = ['Kinder']

export const defaultAssessmentFor = (gradeLevel) =>
  DEFAULT_DESCRIPTIVE_GRADES.includes(gradeLevel)
    ? { assessment_mode: 'descriptive', rating_scale: DEFAULT_RATING_SCALE }
    : { assessment_mode: 'numeric', rating_scale: null }

/**
 * Resolve how one grade level is assessed in one school year.
 * @param {string} gradeLevel
 * @param {{assessment_mode: string, rating_scale: string|null}|null} configRow
 *        the grade_level_assessment row, or null to fall back to the default
 */
export const resolveAssessment = (gradeLevel, configRow) => {
  const row = configRow || defaultAssessmentFor(gradeLevel)
  const descriptive = row.assessment_mode === 'descriptive'
  return {
    gradeLevel: gradeLevel || null,
    mode: descriptive ? 'descriptive' : 'numeric',
    isNumeric: !descriptive,
    isDescriptive: descriptive,
    configured: !!configRow,
    scale: descriptive ? ratingScale(row.rating_scale) : null,
    scaleId: descriptive ? ratingScale(row.rating_scale).id : null,
  }
}

/**
 * Band a rating distribution for the class-health / risk signals.
 *
 * Generalised from the original E/G/F/NA rules by rank rather than by letter:
 * "NA" was simply the worst level and "F" the second worst. For EGFNA this
 * produces byte-identical results to the previous implementation.
 */
export const bandDistribution = (dist, totalSkills, scaleId) => {
  const scale = ratingScale(scaleId)
  const counts = scale.codes.map(c => (dist && dist[c]) || 0)
  const rated = counts.reduce((a, b) => a + b, 0)
  if (totalSkills === 0 || rated === 0) return 'insufficient'
  if (rated / totalSkills < 0.3) return 'insufficient'
  const worst = (dist && dist[scale.worst.code]) || 0
  const secondWorst = (dist && dist[scale.secondWorst.code]) || 0
  if (worst / rated > 0.3) return 'urgent'
  if (worst > 0 || secondWorst / rated > 0.4) return 'watch'
  return 'ok'
}

/** Mean 0-1 competency value for a set of ratings — feeds the AI risk factor. */
export const competencyValue = (dist, scaleId) => {
  const scale = ratingScale(scaleId)
  let n = 0, sum = 0
  for (const lv of scale.levels) {
    const c = (dist && dist[lv.code]) || 0
    n += c
    sum += c * lv.weight
  }
  return n ? sum / n : null
}

// ── Resolver ─────────────────────────────────────────────────

/**
 * `gradeLevel` is accepted but not yet consulted — DO 015 Table 12 phases
 * Grades 1-3 off numeric grading one level per year, so the policy is
 * ultimately a function of (school year, grade level). Taking the parameter now
 * means that step lands here rather than at every caller.
 *
 * @param {{period_model?: string, grading_policy?: string}|null} schoolYearRow
 */
export function resolveGradingPolicy(schoolYearRow, gradeLevel, assessmentRow) {
  const model  = periodModel(schoolYearRow && schoolYearRow.period_model)
  const policy = gradingPolicy(schoolYearRow && schoolYearRow.grading_policy)
  const assessment = resolveAssessment(gradeLevel, assessmentRow)

  return {
    gradeLevel: gradeLevel || null,
    periodModel: model.id,
    periods: model.periods,
    periodCount: model.count,
    periodNoun: model.noun,
    periodAbbr: model.abbr,
    ordinals: model.ordinals,
    sheetLabels: model.sheetLabels,
    policy: policy.id,
    policyLabel: policy.label,
    transmutes: policy.transmutes,
    // Assessment mode is per (school year, grade level). A descriptive level
    // has no numeric grade at all — transmutation never runs for it.
    assessment,
    mode: assessment.mode,
    isNumeric: assessment.isNumeric,
    isDescriptive: assessment.isDescriptive,
    ratingScale: assessment.scale,
    ratingScaleId: assessment.scaleId,
    passingGrade: PASSING_GRADE,
    transmute: policy.transmute,
    remarksFor: policy.remarksFor,
    descriptorFor: policy.descriptorFor,
    label: (period) => `${model.noun} ${period}`,
    abbr:  (period) => `${model.abbr}${period}`,
  }
}

/**
 * Average the period grades into a final grade.
 * DO 015 §52: the average of the term grades, rounded to a whole number.
 * Missing periods are skipped so a partial year still reports meaningfully.
 */
export function finalGradeFrom(periodGrades) {
  const present = (periodGrades || []).filter(
    g => g !== null && g !== undefined && Number.isFinite(Number(g))
  )
  if (!present.length) return null
  return Math.round(present.reduce((a, b) => a + Number(b), 0) / present.length)
}
