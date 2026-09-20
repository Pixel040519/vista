/**
 * Section lookup and rename helpers.
 *
 * `sections` rows are per school year (`UNIQUE(school_year_id, grade_level, name)`),
 * but **nothing references a section by id**. Five tables carry the section as a
 * bare name string instead:
 *
 *   students.section              the active year's roster snapshot
 *   student_enrollments.section   the per-year record
 *   teacher_assignments.section   keyed by the school year *label*
 *   class_assignments.section     keyed by the school year *label* (legacy, unread)
 *   score_items.section           scoped via subject_id -> subjects.school_year_id
 *
 * So a section is only meaningful alongside its grade level AND its school year,
 * and renaming one is a fan-out write rather than a single UPDATE. Getting that
 * wrong orphans every learner holding the old string, which is exactly what
 * `PUT /api/curriculum/sections/:id` used to do.
 */

const { query } = require('../config/database');
const { AppError } = require('../middleware/error.middleware');

/** Case- and spacing-insensitive key for matching a name the user typed. */
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * `"<grade_level>|<name>"` (both normalised) -> the **stored** spelling of the
 * name, for every section defined in one school year. The value is the real
 * name rather than a presence flag because callers match on what someone typed
 * and then have to save what `sections` actually holds.
 */
const loadSectionNames = async (schoolYearId) => {
  const r = await query(
    'SELECT grade_level, name FROM sections WHERE school_year_id=$1 AND is_active=TRUE',
    [schoolYearId]
  );
  return new Map(r.rows.map(s => [`${norm(s.grade_level)}|${norm(s.name)}`, s.name]));
};

/**
 * Throw 400 if any row names a section that does not exist for its grade level
 * in the given school year. A blank section is always allowed — an unassigned
 * learner is legal, and every caller treats it that way.
 *
 * **Matching ignores case and inner spacing, and the row is rewritten in place
 * to the stored spelling.** A section lives in five tables as a bare name
 * string (see the header above), so "mabini" saved verbatim is not the section
 * `sections` holds: the learner would sit in a section no roster joins to and
 * no rename would ever reach. Validating and canonicalising therefore have to
 * be the same step — a caller that checked leniently and then saved what it was
 * given would be worse than one that refused. The batch upload is what needs
 * it, since those values are typed into Excel by hand; the other callers pass
 * values that came from a dropdown, where this is a no-op.
 *
 * @param {string} schoolYearId
 * @param {Array<{grade_level: string, section: string|null}>} rows  mutated in place
 * @param {(row, index) => string} describe  names the offending row in the message
 */
const assertSectionsExist = async (schoolYearId, rows, describe) => {
  const withSection = rows.filter(r => r.section && String(r.section).trim());
  if (!withSection.length) return;

  const names = await loadSectionNames(schoolYearId);
  const bad = [];
  rows.forEach((r, i) => {
    if (!r.section || !String(r.section).trim()) return;
    const stored = names.get(`${norm(r.grade_level)}|${norm(r.section)}`);
    if (stored === undefined) {
      bad.push(`${describe(r, i)}: section "${r.section}" does not exist for ${r.grade_level}`);
    } else {
      r.section = stored;
    }
  });
  if (bad.length) throw new AppError(bad.join('; '), 400);
};

/**
 * Everything that names one section, counted per table.
 *
 * Every count is scoped by grade level AND school year. The old delete guard
 * counted `students` by name alone, so a Grade 6 "Mabuhay" could not be deleted
 * while any Kinder learner sat in a section that happened to share the name.
 *
 * `students` is counted **only for the active year** — that table is the active
 * year's snapshot, so its rows say nothing about an archived or upcoming one.
 *
 * @param {{id, school_year_id, label, is_active, grade_level, name}} sec
 */
const sectionUsage = async (sec) => {
  const [enrolments, learners, assignments, classes, items] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS n FROM student_enrollments
        WHERE school_year_id=$1 AND grade_level=$2 AND section=$3`,
      [sec.school_year_id, sec.grade_level, sec.name]
    ),
    sec.is_active
      ? query(
          `SELECT COUNT(*)::int AS n FROM students
            WHERE is_active=TRUE AND grade_level=$1 AND section=$2`,
          [sec.grade_level, sec.name]
        )
      : Promise.resolve({ rows: [{ n: 0 }] }),
    query(
      `SELECT COUNT(*)::int AS n FROM teacher_assignments
        WHERE school_year=$1 AND grade_level=$2 AND section=$3`,
      [sec.label, sec.grade_level, sec.name]
    ),
    query(
      `SELECT COUNT(*)::int AS n FROM class_assignments
        WHERE school_year=$1 AND grade_level=$2 AND section=$3`,
      [sec.label, sec.grade_level, sec.name]
    ),
    query(
      `SELECT COUNT(*)::int AS n FROM score_items si
         JOIN subjects sub ON sub.id = si.subject_id
        WHERE sub.school_year_id=$1 AND sub.grade_level=$2 AND si.section=$3`,
      [sec.school_year_id, sec.grade_level, sec.name]
    ),
  ]);

  const usage = {
    enrolments:  enrolments.rows[0].n,
    learners:    learners.rows[0].n,
    assignments: assignments.rows[0].n,
    classes:     classes.rows[0].n,
    score_items: items.rows[0].n,
  };
  usage.total = Object.values(usage).reduce((a, b) => a + b, 0);
  return usage;
};

/** Human-readable list of what is holding a section, for error messages. */
const describeUsage = (usage) => {
  const parts = [];
  const n = (c, one, many) => (c === 1 ? `1 ${one}` : `${c} ${many}`);
  if (usage.learners)    parts.push(n(usage.learners, 'learner', 'learners'));
  else if (usage.enrolments) parts.push(n(usage.enrolments, 'enrolment record', 'enrolment records'));
  if (usage.assignments) parts.push(n(usage.assignments, 'teacher assignment', 'teacher assignments'));
  if (usage.score_items) parts.push(n(usage.score_items, 'score item', 'score items'));
  return parts.join(', ');
};

/**
 * Carry a rename across every table that holds the section by name, scoped to
 * this section's grade level and school year so a same-named section in another
 * grade or year is left alone.
 *
 * `students` is only touched when the section belongs to the **active** school
 * year, because that table is the active year's snapshot.
 *
 * Runs on a caller-supplied client so it joins the caller's transaction.
 */
const renameSectionEverywhere = async (client, sec, newName) => {
  const moved = {};

  const r1 = await client.query(
    `UPDATE student_enrollments SET section=$1, updated_at=NOW()
      WHERE school_year_id=$2 AND grade_level=$3 AND section=$4`,
    [newName, sec.school_year_id, sec.grade_level, sec.name]
  );
  moved.enrolments = r1.rowCount;

  if (sec.is_active) {
    const r2 = await client.query(
      `UPDATE students SET section=$1, updated_at=NOW()
        WHERE is_active=TRUE AND grade_level=$2 AND section=$3`,
      [newName, sec.grade_level, sec.name]
    );
    moved.learners = r2.rowCount;
  } else {
    moved.learners = 0;
  }

  const r3 = await client.query(
    `UPDATE teacher_assignments SET section=$1
      WHERE school_year=$2 AND grade_level=$3 AND section=$4`,
    [newName, sec.label, sec.grade_level, sec.name]
  );
  moved.assignments = r3.rowCount;

  const r4 = await client.query(
    `UPDATE class_assignments SET section=$1
      WHERE school_year=$2 AND grade_level=$3 AND section=$4`,
    [newName, sec.label, sec.grade_level, sec.name]
  );
  moved.classes = r4.rowCount;

  // score_items reaches its school year through the subject, so the UPDATE has
  // to be gated on a subquery rather than a join.
  const r5 = await client.query(
    `UPDATE score_items si SET section=$1, updated_at=NOW()
      WHERE si.section=$2
        AND si.subject_id IN (
          SELECT id FROM subjects WHERE school_year_id=$3 AND grade_level=$4
        )`,
    [newName, sec.name, sec.school_year_id, sec.grade_level]
  );
  moved.score_items = r5.rowCount;

  moved.total = Object.values(moved).reduce((a, b) => a + b, 0);
  return moved;
};

/** Load a section together with the school year it belongs to. */
const loadSection = async (id) => {
  const r = await query(
    `SELECT s.id, s.name, s.grade_level, s.school_year_id, s.is_active,
            sy.label, sy.is_active AS sy_is_active
       FROM sections s
       JOIN school_years sy ON sy.id = s.school_year_id
      WHERE s.id=$1`,
    [id]
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  // `is_active` on the returned object means "this section belongs to the
  // active school year" — that is the question every caller here is asking.
  return { ...row, section_is_active: row.is_active, is_active: row.sy_is_active };
};

module.exports = {
  loadSectionNames,
  assertSectionsExist,
  sectionUsage,
  describeUsage,
  renameSectionEverywhere,
  loadSection,
};
