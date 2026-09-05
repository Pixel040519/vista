/**
 * Composite learning areas — MAPEH and anything shaped like it, in one place.
 *
 * MAPEH is a single DepEd **learning area** whose grade is assembled from four
 * separately graded **areas**: Music, Arts, Physical Education, Health. DO 8,
 * s. 2015 — "individual grades are given to each area ... the quarterly grade
 * for MAPEH is the average of the quarterly grades in the four areas."
 *
 * `subjects.parent_id` models that: NULL means a learning area (every subject
 * that existed before this), non-NULL means an area of one. Each area is a real
 * subject row, so it gets its own grading structure and its own score items for
 * free — both of those are keyed on `subject_id` already.
 *
 * ## The one rule everything follows
 *
 * **Every analytic and reporting read counts learning areas; only score entry
 * and the grading structure descend into areas.** A promotion count, a general
 * average, a risk factor, a report-card row — all of them mean "one learning
 * area", so all of them filter `parent_id IS NULL`. Score Entry is the only
 * surface that works one level down.
 *
 * ## Why the roll-up is stored rather than computed on read
 *
 * The alternative is for every consumer to average the areas itself. There are
 * seven `AVG(grade)` sites across Node and FastAPI, the promotion wizard's DO 8
 * Table 10 count, the adviser's general average, and the parent app's quarter
 * average — in three languages. Storing a real `grades` row for the learning
 * area means every one of them keeps working unchanged, and the only thing they
 * need is to stop counting the areas beside it.
 *
 * A Postgres trigger would be airtight where this is not (a hand-written `psql`
 * UPDATE will not roll up), but `remarksFor` would have to be reimplemented in
 * PL/pgSQL — a third copy of a grading policy that already lives in two
 * hand-synced files. Not worth it.
 *
 * ## Two things that are easy to get wrong
 *
 * 1. **The roll-up is never transmuted again.** The areas' grades were already
 *    transmuted when they were written. DO 8 averages those *quarterly grades*.
 *    Transmuting the mean a second time would inflate every MAPEH grade under
 *    DO8_2015's floor and shift bands under DO15_2026.
 * 2. **Withholding deletes the row; it does not merely skip the write.** MAPEH
 *    has no grade until all four areas have one. If an area's scores are later
 *    cleared, a grade computed while it was complete must not be left behind.
 */

const { query } = require('../config/database')
const { AppError } = require('../middleware/error.middleware')

/**
 * MAPEH's four areas, in DepEd's own order, and the test for which subject is a
 * MAPEH. Case-insensitive on the whole word, so MAPEH / Mapeh / MaPeH and
 * "MAPEH 4" all qualify while "Mapehematics" does not.
 *
 * The set is **fixed**: there is no endpoint to add or remove an area, and the
 * UI offers none. MAPEH is graded through exactly these four wherever it exists,
 * so the only thing an admin can change about them is a name.
 */
const MAPEH_AREAS = ['Music', 'Arts', 'Physical Education', 'Health']
const isMapeh = (name) => /\bmapeh\b/i.test(name || '')

/** Run against a transaction client when given one, else the pool. */
const run = (client, text, params) =>
  client ? client.query(text, params) : query(text, params)

/** The subject row, or null. */
const subjectRow = async (subjectId, client) => {
  const res = await run(client,
    `SELECT id, name, grade_level, school_year_id, parent_id, is_active
       FROM subjects WHERE id = $1`, [subjectId])
  return res.rows[0] || null
}

/** The active areas of a learning area, in display order. Empty for a plain subject. */
const areasOf = async (subjectId, client) => {
  const res = await run(client,
    `SELECT id, name, grade_level, school_year_id
       FROM subjects
      WHERE parent_id = $1 AND is_active = TRUE
      ORDER BY name`, [subjectId])
  return res.rows
}

/** The learning area this subject belongs to, or null when it is one itself. */
const parentOf = async (subjectId, client) => {
  const res = await run(client,
    `SELECT p.id, p.name, p.grade_level, p.school_year_id
       FROM subjects s JOIN subjects p ON p.id = s.parent_id
      WHERE s.id = $1`, [subjectId])
  return res.rows[0] || null
}

/**
 * Give a MAPEH subject its four areas. The only writer of an area row.
 *
 * Called wherever a MAPEH can come into existence — creating a subject,
 * renaming one to MAPEH, and copying a school year — so a school never has to
 * ask for the split and can never end up with a half-made one. The backfill in
 * `2026_09_07_mapeh_areas.sql` is the same rule applied to rows that already
 * existed.
 *
 * Idempotent, and safe to call on any subject: it returns `[]` without touching
 * anything unless every one of these holds.
 *
 * - The subject is a MAPEH, and a learning area rather than an area itself.
 * - It has **no areas yet.** Only a completely unsplit MAPEH is filled in, which
 *   is what makes renaming an area safe: rename "Physical Education" to "P.E."
 *   and the next call sees four areas and does nothing, rather than deciding
 *   "Physical Education" is missing and creating a fifth.
 * - It holds no grades, score items or grading structure **of its own**. Adding
 *   areas makes its grade derived, so marks recorded against it directly would
 *   be stranded — computed by rules that no longer apply and invisible to a
 *   teacher now working one level down. Such a MAPEH stays flat and keeps
 *   working exactly as it did.
 * - Every one of the four names is free, **or** held only by a dormant row this
 *   can revive. All-or-nothing on purpose: creating three of four would leave
 *   MAPEH quietly averaging the wrong number of areas.
 *
 * ## Soft deletes are why this is not four plain INSERTs
 *
 * Subjects are soft-deleted (`is_active = FALSE`) but
 * `subjects_sy_grade_name_unique` does **not** filter on `is_active`. So after a
 * MAPEH is deleted its four areas are still sitting in the table holding their
 * names, and a straight INSERT for the next MAPEH in that grade level raises a
 * raw 23505 that surfaces to the admin as "Record already exists."
 *
 * A dormant row is therefore revived rather than duplicated — the same choice
 * the Students page makes for an archived learner. Reviving is only safe when
 * the row carries no work of its own: a deleted standalone "Music" subject with
 * grades behind it must not be quietly adopted as one of MAPEH's areas, dragging
 * its marks into a different learning area's average. Such a name counts as
 * taken, and the whole split is skipped.
 */
const ensureMapehAreas = async (client, subject) => {
  if (!subject || subject.parent_id || !isMapeh(subject.name)) return []
  if ((await areasOf(subject.id, client)).length) return []

  const own = await run(client,
    `SELECT (SELECT COUNT(*) FROM grades WHERE subject_id = $1)
          + (SELECT COUNT(*) FROM score_items WHERE subject_id = $1 AND is_active = TRUE)
          + (SELECT COUNT(*) FROM grading_structure WHERE subject_id = $1 AND is_active = TRUE)
            AS n`, [subject.id])
  if (Number(own.rows[0].n) > 0) return []

  // Decide every name before writing any of them, so the set is all-or-nothing.
  const existing = await run(client,
    `SELECT s.id, s.name, s.is_active,
            (SELECT COUNT(*) FROM grades g WHERE g.subject_id = s.id)
          + (SELECT COUNT(*) FROM score_items si WHERE si.subject_id = s.id)
              AS work
       FROM subjects s
      WHERE s.school_year_id = $1 AND s.grade_level = $2 AND s.name = ANY($3::text[])`,
    [subject.school_year_id, subject.grade_level, MAPEH_AREAS])
  const byName = new Map(existing.rows.map(r => [r.name, r]))

  const plan = []
  for (const name of MAPEH_AREAS) {
    const row = byName.get(name)
    if (!row) { plan.push({ name, revive: null }); continue }
    if (row.is_active || Number(row.work) > 0) return []   // genuinely taken
    plan.push({ name, revive: row.id })
  }

  const created = []
  for (const step of plan) {
    const r = step.revive
      ? await run(client,
          `UPDATE subjects SET is_active = TRUE, parent_id = $1, updated_at = NOW()
            WHERE id = $2 RETURNING id, name`,
          [subject.id, step.revive])
      : await run(client,
          `INSERT INTO subjects (name, grade_level, school_year_id, parent_id)
           VALUES ($1, $2, $3, $4) RETURNING id, name`,
          [step.name, subject.grade_level, subject.school_year_id, subject.id])
    created.push(r.rows[0])
  }
  return created
}

/**
 * Refuse a write aimed at a learning area that is graded through its areas.
 * Names them, because "MAPEH is not gradeable" on its own tells a teacher
 * nothing about where to go instead.
 */
const assertGradeable = async (subjectId, client) => {
  const areas = await areasOf(subjectId, client)
  if (!areas.length) return
  const sub = await subjectRow(subjectId, client)
  const names = areas.map(a => a.name).join(', ')
  throw new AppError(
    `"${sub ? sub.name : 'This subject'}" is graded through its ${areas.length} areas — ` +
    `record this under ${names} instead.`, 409)
}

/**
 * Recompute one learning area's grade for one learner and one period.
 *
 * Returns 'set', 'withheld' or 'skipped' (the subject has no areas). `policy`
 * is a resolved grading policy — only `remarksFor` is used, because the mean of
 * already-transmuted grades must not be transmuted again.
 */
const rollUp = async (client, {
  student_id, parent_id, quarter, school_year, policy, recorded_by,
}) => {
  const areas = await areasOf(parent_id, client)
  if (!areas.length) return 'skipped'

  const graded = await run(client,
    `SELECT score, grade FROM grades
      WHERE student_id = $1 AND subject_id = ANY($2::uuid[])
        AND quarter = $3 AND school_year = $4 AND grade IS NOT NULL`,
    [student_id, areas.map(a => a.id), quarter, school_year])

  // The withhold rule: nothing partial. One un-entered area blanks the learning
  // area, and blanking means removing any row an earlier complete set produced.
  if (graded.rows.length < areas.length) {
    await run(client,
      `DELETE FROM grades
        WHERE student_id = $1 AND subject_id = $2 AND quarter = $3 AND school_year = $4`,
      [student_id, parent_id, quarter, school_year])
    return 'withheld'
  }

  const mean = (vals) => vals.reduce((a, b) => a + b, 0) / vals.length
  const grade = Math.round(mean(graded.rows.map(r => Number(r.grade))))
  // The areas' initial weighted averages, averaged the same way. Informational:
  // a learning area has no grading structure of its own to break this down.
  const initials = graded.rows.map(r => Number(r.score)).filter(Number.isFinite)
  const score = initials.length === graded.rows.length
    ? Math.round(mean(initials) * 100) / 100
    : null

  await run(client,
    `INSERT INTO grades (student_id, subject_id, quarter, school_year, score, grade, remarks, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (student_id, subject_id, quarter, school_year)
     DO UPDATE SET score = EXCLUDED.score, grade = EXCLUDED.grade,
                   remarks = EXCLUDED.remarks, updated_at = NOW()`,
    [student_id, parent_id, quarter, school_year, score, grade,
      policy.remarksFor(grade), recorded_by || null])
  return 'set'
}

/**
 * Call after writing a `grades` row. Rolls the write up into the subject's
 * learning area, or does nothing when the subject is one itself.
 */
const rollUpAfterGradeWrite = async (client, {
  student_id, subject_id, quarter, school_year, policy, recorded_by,
}) => {
  const parent = await parentOf(subject_id, client)
  if (!parent) return 'skipped'
  return rollUp(client, {
    student_id, parent_id: parent.id, quarter, school_year, policy, recorded_by,
  })
}

// There is deliberately no "re-roll everything because the set of areas
// changed" helper. The set cannot change while grades exist:
// `ensureMapehAreas()` refuses a MAPEH that holds its own marks, an area cannot
// be deleted on its own, and deleting the learning area is refused while any of
// the family carries a grade. So the only roll-up that ever has to run is the
// one after a grade write.

module.exports = {
  MAPEH_AREAS, isMapeh, ensureMapehAreas,
  subjectRow, areasOf, parentOf, assertGradeable,
  rollUp, rollUpAfterGradeWrite,
}
