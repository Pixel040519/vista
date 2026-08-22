/**
 * Enrollment vocabulary — mirror of `vista-backend/node-api/src/utils/enrollment.js`.
 * Same convention as `utils/roles.js` and `utils/grading.js`: the backend copy is
 * canonical, this one exists so the bundle needs no round trip. Keep the shared
 * half in sync; this copy adds only presentation helpers.
 *
 * ── Two questions, two columns ───────────────────────────────
 *
 *   student_enrollments.status    Is this learner attending this school year?
 *                                 pending / enrolled / transferred_out / dropped
 *                                 Owned by the Enrollment page.
 *
 *   student_enrollments.outcome   How did the year end for them?
 *                                 promoted / retained / graduated, null until
 *                                 the year is closed.
 *                                 Owned by the Year-End Promotion wizard.
 *
 * They are orthogonal — a learner is *enrolled* in 2025-2026 **and** *promoted*
 * at the end of it. Never offer them in the same select.
 */

import { ALL_GRADES } from './roles'

// ── Enrolment status ─────────────────────────────────────────

export const ENROLLMENT_STATUSES = [
  { id: 'pending',  label: 'Pending', tone: 'blue',
    description: 'Expected this school year but not yet confirmed enrolled.' },
  { id: 'enrolled', label: 'Enrolled', tone: 'emerald',
    description: 'Currently studying in this school year.' },
  { id: 'transferred_out', label: 'Transferred out', tone: 'slate',
    description: 'Moved to another school.' },
  { id: 'dropped', label: 'Dropped', tone: 'red',
    description: 'Stopped attending without transferring.' },
]

export const ENROLLMENT_STATUS_IDS = ENROLLMENT_STATUSES.map(s => s.id)

/** Statuses meaning the learner is no longer attending that year. */
export const LEFT_STATUS_IDS = ['transferred_out', 'dropped']

// ── Year-end outcome ─────────────────────────────────────────

export const OUTCOMES = [
  { id: 'promoted', label: 'Promoted', tone: 'emerald',
    description: 'Finished the year and moves up to the next grade level.' },
  { id: 'retained', label: 'Retained', tone: 'amber',
    description: 'Finished the year and repeats the same grade level.' },
  { id: 'graduated', label: 'Graduated', tone: 'brand',
    description: 'Completed the final grade level and left the school.' },
]

export const PROMOTION_OUTCOMES = OUTCOMES.map(o => o.id)

/** Outcomes that carry the learner into the next school year. */
export const MOVES_ON_OUTCOMES = ['promoted', 'retained']

// ── The `students.enrollment_status` mirror ──────────────────
//
// One value wider than the record's status: 'graduated' is a year-end outcome
// that also ends the learner's presence in the school, so it has to be
// expressible as a current standing. Readable everywhere, settable only by the
// promotion wizard.

export const STUDENT_STATUSES = [
  ...ENROLLMENT_STATUSES,
  OUTCOMES.find(o => o.id === 'graduated'),
]

/** What an admin may set by hand. Graduation is earned, not typed. */
export const MANUAL_STATUSES = ENROLLMENT_STATUSES
export const MANUAL_STATUS_IDS = ENROLLMENT_STATUS_IDS

/** Statuses that mean the learner has left the school. */
export const WITHDRAWN_STATUS_IDS = ['transferred_out', 'dropped', 'graduated']

/**
 * "Not enrolled" is not a stored value — it is the absence of a record for that
 * school year. It reads like a status on screen and is selectable like one, so
 * it carries an id; choosing it means **remove this year's record**, which is
 * why it is refused on the active year, where the record is what holds the
 * learner in their current class.
 */
export const NO_RECORD_ID = 'none'
export const NO_RECORD = {
  id: NO_RECORD_ID, label: 'Not enrolled', tone: 'slate',
  description: 'No enrolment record for this school year — the learner is not on its roster at all.',
}

/** Everything the Enrollment page's status select offers, destructive one last. */
export const SELECTABLE_STATUSES = [...ENROLLMENT_STATUSES, NO_RECORD]

const BY_ID = Object.fromEntries([...ENROLLMENT_STATUSES, ...OUTCOMES].map(s => [s.id, s]))

export const statusMeta  = (id) => BY_ID[id] || NO_RECORD
export const statusLabel = (id) => statusMeta(id).label
export const outcomeLabel = (id) => (OUTCOMES.find(o => o.id === id) || {}).label || null

/**
 * Tailwind classes per tone. Written out rather than interpolated because
 * Tailwind's scanner only sees complete class names in the source.
 */
const TONE_CLASSES = {
  emerald: 'bg-emerald-100 text-emerald-700',
  blue:    'bg-blue-100 text-blue-700',
  amber:   'bg-amber-100 text-amber-700',
  red:     'bg-red-100 text-red-700',
  brand:   'bg-brand-100 text-brand-700',
  slate:   'bg-slate-100 text-slate-500',
}

export const statusClasses = (id) => TONE_CLASSES[statusMeta(id).tone] || TONE_CLASSES.slate

// ── Grade progression ────────────────────────────────────────
// Derived from ALL_GRADES rather than written out, so retiring or adding a
// grade level cannot leave a stale ladder here.

export const GRADE_PROGRESSION = ALL_GRADES

/** The grade level after this one, or null when the learner is graduating. */
export const nextGradeLevel = (gradeLevel) => {
  const i = GRADE_PROGRESSION.indexOf(gradeLevel)
  if (i === -1) return null
  return GRADE_PROGRESSION[i + 1] || null
}

/** True when finishing this grade level means leaving the school. */
export const isExitGrade = (gradeLevel) =>
  GRADE_PROGRESSION.indexOf(gradeLevel) === GRADE_PROGRESSION.length - 1
