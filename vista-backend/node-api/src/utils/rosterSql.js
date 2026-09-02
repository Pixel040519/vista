/**
 * "Was this learner part of school year X?" — as SQL, in one place.
 *
 * Two callers have to agree on this and used to answer it separately:
 *
 *   - `enrollment.routes.js` — which learners the Enrollment page **lists** for a
 *     school year.
 *   - `curriculum.routes.js` — which archived learners activating that school year
 *     puts back **on the roll**.
 *
 * They are the same question, and when they were written apart they drifted:
 * activation restored every automatically-archived learner indiscriminately, so
 * reopening SY 2026-2027 revived people who had already dropped out in SY
 * 2025-2026 — learners that same year's roster correctly refused to list.
 *
 * Every fragment below is bound as **$1 = school year id, $2 = school year label**
 * and expects the students table aliased `s`, the year's enrolment row aliased
 * `e`, and `PREV_JOIN` in the FROM clause.
 *
 * `students.is_active` is deliberately absent. It is one global flag meaning "not
 * on the roll *today*", carries no year, and is written by whichever activation
 * last ran — so it cannot answer a per-year question, and using it as one hid a
 * learner declared "Not enrolled" for a year from that very year's roster.
 */

/**
 * The learner's most recent record from a school year **earlier** than the one
 * being asked about, gaps skipped. Everything below reads it.
 */
const PREV_JOIN = `
      LEFT JOIN LATERAL (
        SELECT pe.grade_level, pe.section, pe.status, pe.outcome, psy.label,
               (NOT psy.is_active AND NOT psy.is_upcoming) AS closed
          FROM student_enrollments pe
          JOIN school_years psy ON psy.id = pe.school_year_id
         WHERE pe.student_id = s.id AND psy.label < $2
         ORDER BY psy.label DESC
         LIMIT 1
      ) prev ON TRUE`

/**
 * "Had not left the school as of this year", judged from `prev`. Three ways to
 * have left; the last two are about a year having **begun** without the learner
 * in it, not about anything anyone recorded:
 *
 *   - `transferred_out` / `dropped` — they were enrolled and then stopped
 *   - **not enrolled** — no record at all for a year that has started
 *   - **`pending` when that year closed** — expected, never confirmed
 *
 * Three boundaries this must not cross: `prev.status IS NULL` short-circuits, so a
 * learner with no earlier record at all is never hidden (they are new, not
 * absent); the gap window starts at `prev.label`, not at the beginning of time, or
 * anyone who joined late reads as having left; and it ends **before** the year
 * being asked about, never at it, or a year would judge itself by its own
 * emptiness.
 */
const LEFT_SQL = `(
  prev.status IS NULL
  OR (
    prev.status NOT IN ('transferred_out','dropped')
    AND NOT (prev.status = 'pending' AND prev.closed)
    AND NOT EXISTS (
      SELECT 1 FROM school_years gap
       WHERE gap.label > prev.label AND gap.label < $2
         AND NOT gap.is_upcoming
    )
  )
)`

/**
 * "Finished school here" — a `graduated` outcome on `prev`. Kept apart from
 * leaving: graduating is completing, not departing, and unlike the reasons above
 * it is never lifted by `include_left`, since there is nothing to re-enrol a
 * graduate into.
 */
const COMPLETED_SQL = `(prev.outcome IS NOT DISTINCT FROM 'graduated')`

/**
 * "Had joined the school by this year" — the mirror image of `LEFT_SQL`.
 *
 * A roster that only asks who **left** lists every learner the school has ever
 * had on every year it has ever run. Adding a learner today gave them one record,
 * for the active year, and nothing earlier — which `LEFT_SQL` reads as "new, not
 * absent" and so shows them, correctly, on this year and every year to come. But
 * the same reasoning ran backwards too, and put a learner enrolled this week on
 * the roster of a school year that closed before they existed, listed as **Not
 * enrolled** as though someone had forgotten to enrol them.
 *
 * `prev` answers it: a record from an **earlier** year is the learner having
 * already been here. Its absence means one of two things, and only the second is
 * a joiner —
 *
 *   - **no records at all** — a learner from before enrolment history began (it
 *     starts at the year active when `2026_08_21_student_enrollments.sql` ran).
 *     Nothing says when they joined, so they are never hidden, exactly as
 *     `LEFT_SQL` never hides them.
 *   - **records, but none earlier** — they joined in this year or a later one.
 *     Before that they were not a learner here, and a year they predate is not a
 *     gap in their enrolment for an admin to fill in.
 *
 * `e.id IS NOT NULL` still overrides, so the year they *were* added in lists them
 * normally, and so does any year someone deliberately enrolled them into.
 */
const JOINED_SQL = `(
  prev.status IS NOT NULL
  OR NOT EXISTS (SELECT 1 FROM student_enrollments je WHERE je.student_id = s.id)
)`

/**
 * The three exclusions as the roster applies them, each escaped by
 * `e.id IS NOT NULL` — **a record for the year in question always wins**, whatever
 * happened before or since.
 */
const NOT_LEFT = `(e.id IS NOT NULL OR ${LEFT_SQL})`
const NOT_COMPLETED = `(e.id IS NOT NULL OR NOT ${COMPLETED_SQL})`
const HAS_JOINED = `(e.id IS NOT NULL OR ${JOINED_SQL})`

/** All three together: "belongs to this school year". */
const BELONGS_TO_YEAR = `(${NOT_LEFT} AND ${NOT_COMPLETED} AND ${HAS_JOINED})`

/**
 * Re-point a fragment at a different `students` alias.
 *
 * Every fragment above is written against `s`, which is the alias each caller
 * happens to use — except the activation's `UPDATE students s ... FROM (SELECT
 * s2.id FROM students s2 ...)`, where `s` is already taken by the row being
 * written. That call site used to fix up `PREV_JOIN` with a bare `.replace()`,
 * which rewrites only the **first** match; the moment a second fragment mentioned
 * `s.id` — `JOINED_SQL` does — the leftover would have silently correlated to the
 * outer `s` and quietly answered a different question. Global, and applied to
 * every fragment a query uses, is the only safe form.
 */
const withStudentAlias = (sql, alias) =>
  alias === 's' ? sql : sql.replace(/\bs\.id\b/g, `${alias}.id`)

module.exports = {
  PREV_JOIN, LEFT_SQL, COMPLETED_SQL, JOINED_SQL,
  NOT_LEFT, NOT_COMPLETED, HAS_JOINED, BELONGS_TO_YEAR,
  withStudentAlias,
}
