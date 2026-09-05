/**
 * "Is this teacher the adviser of that class?" — the second source of teacher
 * scope, in one place.
 *
 * Teacher scope has always meant exactly one thing: a row in
 * `teacher_assignments (teacher_id, grade_level, section, subject, school_year)`.
 * That is a **per-subject** fact, so it answers "who teaches Math to Grade 3
 * Mabini" and never "who is responsible for Grade 3 Mabini". `sections.adviser_id`
 * answers the second, and this module is how it gets consulted.
 *
 * There is deliberately **one** module for it. The assignment lookup is written
 * inline in five different shapes across five routers, and they have drifted
 * from each other more than once; this must not become a sixth. Everything that
 * asks "does this teacher advise here" goes through the helpers below —
 * including `loadAdvisory()` on the auth payload, so what the client is told it
 * advises and what the API will actually serve cannot disagree.
 *
 * ## The active-year boundary
 *
 * Every helper here is scoped to the **active** school year. An advisory is a
 * now-fact: a teacher advises a class this year, and next year's adviser is a
 * fresh decision (which is why "copy from" does not carry the column forward).
 * The rule the feature rests on is "you advise this learner this year, so you
 * see this year's whole record" — so callers that OR this into an existing
 * filter must bound their side to the active year too, or an adviser would
 * silently gain every prior year of a learner's history.
 *
 * ## Why `section_id` and not (grade_level, section)
 *
 * A `sections` row is keyed `(school_year_id, grade_level, name)`, so it carries
 * its year as a **UUID**. The assignment-based filters cannot: they join on
 * `students.grade_level`/`students.section` — the *active-year snapshot* — while
 * narrowing records that span years, and `teacher_assignments.school_year` is a
 * label string rather than an id. Keying the new endpoints on the section's own
 * id sidesteps that year-skew entirely, and reduces the guard to one lookup.
 */

const { query } = require('../config/database')
const { AppError } = require('../middleware/error.middleware')

/**
 * An `EXISTS` fragment for OR-ing into an existing WHERE clause: true when the
 * student sits in a section this teacher advises, in the active school year.
 *
 * Expects the students table aliased **`st`** — which is what the two filters in
 * `crud.routes.js` already alias it to inside their subqueries — and takes the
 * teacher's id as its one placeholder.
 *
 * Matching on `sec.name = st.section` rather than by id is not a shortcut: no
 * table references a section by id (see `utils/sections.js`), `students.section`
 * is a bare name string, and the pair is only meaningful alongside the grade
 * level and the year, both of which are pinned here.
 *
 * @param {number|string} p  the 1-based placeholder number holding the teacher id
 */
const advisedStudentSql = (p) => `EXISTS (
        SELECT 1 FROM sections sec
          JOIN school_years sy ON sy.id = sec.school_year_id
         WHERE sec.adviser_id = $${p}
           AND sec.is_active = TRUE
           AND sy.is_active  = TRUE
           AND sec.grade_level = st.grade_level
           AND sec.name        = st.section
      )`

/**
 * The sections this teacher advises in the active school year.
 *
 * `idx_sections_adviser_sy_unique` caps this at one row, but it returns an array
 * because that is the shape the auth payload has always carried and because
 * array-to-scalar is a painful change to make later if the rule is relaxed.
 *
 * `sec.name` is exposed as **`section`**, matching `advisoryHistory()` and every
 * other table in the schema that holds a section (`students.section`,
 * `teacher_assignments.section`, `student_enrollments.section`). `sections.name`
 * is the odd one out because it is the row's own name column, and letting that
 * spelling leak into the payload meant an advisory row and an assignment row
 * beside it named the same thing two different ways — and comparisons read as
 * `v.name === student.section`, which is exactly where a reader trips.
 */
const advisorySections = async (teacherId) => {
  const r = await query(
    `SELECT sec.id, sec.grade_level, sec.name AS section,
            sec.school_year_id, sy.label AS school_year
       FROM sections sec
       JOIN school_years sy ON sy.id = sec.school_year_id
      WHERE sec.adviser_id = $1 AND sec.is_active = TRUE AND sy.is_active = TRUE
      ORDER BY sec.grade_level, sec.name`,
    [teacherId]
  )
  return r.rows
}

/**
 * Every section this teacher has ever advised, newest year first.
 *
 * The all-years counterpart to `advisorySections()`, which is deliberately
 * pinned to the active year because that is the only year an advisory grants
 * anything. This one grants nothing — it is the record, for the Accounts page's
 * assignment history, and history is exactly the thing the active-year scope
 * must not be reused for.
 *
 * `sec.name` comes back as `section` so callers can treat an advisory row and a
 * `teacher_assignments` row the same way; the two tables spell it differently.
 */
const advisoryHistory = async (teacherId) => {
  const r = await query(
    `SELECT sec.id, sec.grade_level, sec.name AS section,
            sy.label AS school_year, sy.is_active AS is_active_year
       FROM sections sec
       JOIN school_years sy ON sy.id = sec.school_year_id
      WHERE sec.adviser_id = $1 AND sec.is_active = TRUE
      ORDER BY sy.label DESC, sec.grade_level, sec.name`,
    [teacherId]
  )
  return r.rows
}

/**
 * Load the section a request is about and refuse it unless the caller advises
 * it. The guard in front of every endpoint in `advisory.routes.js`.
 *
 * A section outside the active year is refused the same way as one belonging to
 * someone else — the message stays deliberately identical for both, so probing
 * ids cannot distinguish "not yours" from "not this year".
 */
const assertAdvisorySection = async (req, sectionId) => {
  if (!sectionId) throw new AppError('section_id is required.', 400)

  const r = await query(
    `SELECT sec.id, sec.grade_level, sec.name, sec.adviser_id,
            sec.school_year_id, sy.label AS school_year,
            sy.period_model, sy.grading_policy
       FROM sections sec
       JOIN school_years sy ON sy.id = sec.school_year_id
      WHERE sec.id = $1 AND sec.is_active = TRUE AND sy.is_active = TRUE`,
    [sectionId]
  )
  const sec = r.rows[0]
  if (!sec || sec.adviser_id !== req.user.id) {
    throw new AppError('You are not the adviser of this class.', 403)
  }
  return sec
}

/** Does this teacher advise the section this learner currently sits in? */
const isAdviserOfStudent = async (teacherId, studentId) => {
  const r = await query(
    `SELECT 1 FROM students st WHERE st.id = $2 AND ${advisedStudentSql(1)} LIMIT 1`,
    [teacherId, studentId]
  )
  return r.rows.length > 0
}

/** The active school year, as both id and label — every caller here needs both. */
const activeSchoolYear = async () => {
  const r = await query(
    `SELECT id, label, period_model, grading_policy
       FROM school_years WHERE is_active = TRUE LIMIT 1`
  )
  return r.rows[0] || null
}

/**
 * The learners in an advisory class. Same predicate every other class list in
 * the codebase uses (`score.routes.js`, `crud.routes.js` by-subject), so an
 * adviser and a subject teacher never see a different set of names.
 */
const advisoryClassList = async (sec) => {
  const r = await query(
    `SELECT id, lrn, surname, first_name, middle_name, gender
       FROM students
      WHERE grade_level = $1 AND section = $2
        AND is_active = TRUE AND enrollment_status = 'enrolled'
      ORDER BY surname, first_name`,
    [sec.grade_level, sec.name]
  )
  return r.rows
}

module.exports = {
  advisedStudentSql,
  advisorySections,
  advisoryHistory,
  assertAdvisorySection,
  isAdviserOfStudent,
  activeSchoolYear,
  advisoryClassList,
}
