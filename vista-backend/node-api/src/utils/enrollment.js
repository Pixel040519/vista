/**
 * Enrollment vocabulary — canonical source of truth.
 *
 * Mirrored in `vista-dashboard/src/utils/enrollment.js` (same convention as
 * `utils/roles.js` and `utils/grading.js`). Keep the shared half in sync; the
 * dashboard copy adds only presentation helpers, and this copy adds only the
 * promotion rules, which need no DOM.
 *
 * ── Two questions, two columns ───────────────────────────────
 *
 * A learner's place in a school year is two independent facts, and collapsing
 * them into one column is what made the Enrollment page confusing:
 *
 *   student_enrollments.status    Is this learner attending this school year?
 *                                 pending / enrolled / transferred_out / dropped
 *                                 Owned by the Enrollment page.
 *
 *   student_enrollments.outcome   How did the year end for them?
 *                                 promoted / retained / graduated, NULL until
 *                                 the year is closed.
 *                                 Owned by the Year-End Promotion wizard.
 *
 * They are orthogonal: a learner is *enrolled* in 2025-2026 **and** *promoted*
 * at the end of it. Writing an outcome must never overwrite the enrolment fact.
 *
 * `students.grade_level` / `section` / `enrollment_status` are a separate thing
 * again — the denormalised snapshot of the *active* year, which every roster
 * query reads directly. The rollover in `curriculum.routes.js` is the only place
 * the snapshot and the records are reconciled.
 */

const { ALL_GRADES } = require('./roles');

// ── Enrolment status ─────────────────────────────────────────
//
// `tone` names the badge palette so the dashboard mirror renders the same
// colours without a second mapping. It reuses the vocabulary already used by
// the school-year status pills (emerald = current, blue = expected, slate/red =
// no longer attending).

const ENROLLMENT_STATUSES = [
  { id: 'pending',  label: 'Pending', tone: 'blue',
    description: 'Expected this school year but not yet confirmed enrolled.' },
  { id: 'enrolled', label: 'Enrolled', tone: 'emerald',
    description: 'Currently studying in this school year.' },
  { id: 'transferred_out', label: 'Transferred out', tone: 'slate',
    description: 'Moved to another school.' },
  { id: 'dropped', label: 'Dropped', tone: 'red',
    description: 'Stopped attending without transferring.' },
];

const ENROLLMENT_STATUS_IDS = ENROLLMENT_STATUSES.map(s => s.id);

/** Statuses meaning the learner is no longer attending that year. */
const LEFT_STATUS_IDS = ['transferred_out', 'dropped'];

/** Only these learners appear on a teacher's class list. */
const ROSTER_STATUSES = ['enrolled'];

// ── Year-end outcome ─────────────────────────────────────────

const OUTCOMES = [
  { id: 'promoted', label: 'Promoted', tone: 'emerald',
    description: 'Finished the year and moves up to the next grade level.' },
  { id: 'retained', label: 'Retained', tone: 'amber',
    description: 'Finished the year and repeats the same grade level.' },
  { id: 'graduated', label: 'Graduated', tone: 'brand',
    description: 'Completed the final grade level and left the school.' },
];

const PROMOTION_OUTCOMES = OUTCOMES.map(o => o.id);

/** Outcomes that carry the learner into the next school year. */
const MOVES_ON_OUTCOMES = ['promoted', 'retained'];

// ── The `students.enrollment_status` mirror ──────────────────
//
// One value wider than `student_enrollments.status`: 'graduated' is a year-end
// outcome that also ends the learner's presence in the school, so it has to be
// expressible as a current standing. It is set only by the promotion wizard.

const STUDENT_STATUS_IDS = [...ENROLLMENT_STATUS_IDS, 'graduated'];

/** What an admin may set by hand. Graduation is earned, not typed. */
const MANUAL_STATUS_IDS = [...ENROLLMENT_STATUS_IDS];

/**
 * "Not enrolled" is not a stored value — it is the absence of a record for that
 * school year. It reads like a status on screen and is selectable like one, so
 * it needs an id; choosing it means **delete this year's record**, not write
 * this string.
 */
const NO_RECORD_ID = 'none';

/** Everything the Enrollment page's status select may offer. */
const SELECTABLE_STATUS_IDS = [...MANUAL_STATUS_IDS, NO_RECORD_ID];

/** Standings that mean the learner has left; the rollover must not revive them. */
const TERMINAL_STATUS_IDS = [...LEFT_STATUS_IDS, 'graduated'];

/**
 * Force a `students.enrollment_status` value into something
 * `student_enrollments.status` will accept. Only 'graduated' needs clamping —
 * a graduated learner whose record is rewritten was, in that year, enrolled.
 */
const clampToManual = (status) =>
  MANUAL_STATUS_IDS.includes(status) ? status : 'enrolled';

const statusLabel = (id) =>
  (ENROLLMENT_STATUSES.find(s => s.id === id) || {}).label ||
  (OUTCOMES.find(o => o.id === id) || {}).label ||
  'Not enrolled';

const outcomeLabel = (id) => (OUTCOMES.find(o => o.id === id) || {}).label || null;

// ── Grade progression ────────────────────────────────────────
//
// Derived from ALL_GRADES rather than written out, so retiring or adding a
// grade level (as DO 015 did with Pre-Kinder) cannot leave a stale ladder here.

const GRADE_PROGRESSION = ALL_GRADES;

/** The grade level after this one, or null when the learner is graduating. */
const nextGradeLevel = (gradeLevel) => {
  const i = GRADE_PROGRESSION.indexOf(gradeLevel);
  if (i === -1) return null;
  return GRADE_PROGRESSION[i + 1] || null;
};

/** True when finishing this grade level means leaving the school. */
const isExitGrade = (gradeLevel) =>
  GRADE_PROGRESSION.indexOf(gradeLevel) === GRADE_PROGRESSION.length - 1;

// ── Year-end promotion recommendations ───────────────────────

/**
 * DepEd DO 8, s. 2015 Table 10 — promotion for Grades 1-6.
 *
 *   every learning area at or above the passing grade  -> promoted
 *   1-2 learning areas below                           -> remedial classes,
 *                                                         then promoted
 *   3 or more below                                    -> retained
 *
 * The middle case is a *conditional* promotion: VISTA has no remedial-class
 * records, so it cannot know whether the learner passed them. It recommends
 * promotion and flags the row for review rather than deciding on the school's
 * behalf.
 *
 * Returns `outcome: null` when there is nothing to judge — a recommendation
 * invented from no grades would be worse than none.
 */
const recommendNumeric = ({ subjectsGraded, subjectsFailed, isExit }) => {
  if (!subjectsGraded) {
    return { outcome: null, needsReview: true, reason: 'No grades recorded for this school year.' };
  }
  const area = (n) => `${n} learning area${n === 1 ? '' : 's'}`;
  if (subjectsFailed === 0) {
    return isExit
      ? { outcome: 'graduated', needsReview: false, reason: `Passed all ${area(subjectsGraded)} in the final grade level.` }
      : { outcome: 'promoted', needsReview: false, reason: `Passed all ${area(subjectsGraded)}.` };
  }
  if (subjectsFailed <= 2) {
    return {
      outcome: isExit ? 'graduated' : 'promoted',
      needsReview: true,
      reason: `Did not meet expectations in ${area(subjectsFailed)} — DO 8, s. 2015 requires passing remedial classes first.`,
    };
  }
  return {
    outcome: 'retained',
    needsReview: false,
    reason: `Did not meet expectations in ${area(subjectsFailed)}.`,
  };
};

/**
 * Descriptively-assessed grade levels have no pass mark. DO 015 treats KS1 as
 * developmental — learners progress and are supported, not retained on their
 * ratings — so this never recommends retention. An `urgent` competency band is
 * flagged for review instead, which is the honest thing a rating distribution
 * can say.
 *
 * `band` comes from `bandDistribution()` in utils/grading.js.
 */
const recommendDescriptive = ({ band, isExit }) => {
  if (!band || band === 'insufficient') {
    return { outcome: null, needsReview: true, reason: 'Not enough competency ratings recorded to judge.' };
  }
  const outcome = isExit ? 'graduated' : 'promoted';
  if (band === 'urgent') {
    return { outcome, needsReview: true, reason: 'Consistently at the lowest competency levels — review before moving up.' };
  }
  if (band === 'watch') {
    return { outcome, needsReview: false, reason: 'Some competencies still developing.' };
  }
  return { outcome, needsReview: false, reason: 'Competencies demonstrated.' };
};

module.exports = {
  NO_RECORD_ID,
  SELECTABLE_STATUS_IDS,
  ENROLLMENT_STATUSES,
  ENROLLMENT_STATUS_IDS,
  LEFT_STATUS_IDS,
  ROSTER_STATUSES,
  OUTCOMES,
  PROMOTION_OUTCOMES,
  MOVES_ON_OUTCOMES,
  STUDENT_STATUS_IDS,
  MANUAL_STATUS_IDS,
  TERMINAL_STATUS_IDS,
  clampToManual,
  statusLabel,
  outcomeLabel,
  GRADE_PROGRESSION,
  nextGradeLevel,
  isExitGrade,
  recommendNumeric,
  recommendDescriptive,
};
