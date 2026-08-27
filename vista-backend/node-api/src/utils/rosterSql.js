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
 * The two exclusions as the roster applies them, each escaped by
 * `e.id IS NOT NULL` — **a record for the year in question always wins**, whatever
 * happened before or since.
 */
const NOT_LEFT = `(e.id IS NOT NULL OR ${LEFT_SQL})`
const NOT_COMPLETED = `(e.id IS NOT NULL OR NOT ${COMPLETED_SQL})`

/** Both together: "belongs to this school year". */
const BELONGS_TO_YEAR = `(${NOT_LEFT} AND ${NOT_COMPLETED})`

module.exports = {
  PREV_JOIN, LEFT_SQL, COMPLETED_SQL, NOT_LEFT, NOT_COMPLETED, BELONGS_TO_YEAR,
}
