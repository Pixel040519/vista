/**
 * School-year status — the three-way value derived from the boolean pair.
 *
 * There is no status column on `school_years`: exactly one row is `is_active`,
 * zero or more are `is_upcoming`, and everything else is archived. That
 * derivation was written out inline in five places (two routers, three
 * components) before this file existed, which is how it stayed easy to get one
 * of them subtly wrong.
 *
 * Mirrored in `vista-dashboard/src/components/SchoolYearPicker.jsx`, which
 * already owned the rendering half of the same idea (`SYStatusPill`).
 */

const { AppError } = require('../middleware/error.middleware');
const { isSuperAdmin } = require('./roles');

/** 'active' | 'upcoming' | 'archived'. */
const syStatus = (sy) =>
  !sy ? null : sy.is_active ? 'active' : sy.is_upcoming ? 'upcoming' : 'archived';

/**
 * True for a year that has closed. What lives in an archived year is the record
 * of what actually happened, so writes to it are refused unless the caller says
 * plainly that it is correcting history.
 */
const isArchivedYear = (sy) => syStatus(sy) === 'archived';

/**
 * The archived-year gate, shared by every writer that can reach a closed year:
 * the Enrollment page (`PUT /`, `DELETE /`), the promotion commit's target, and
 * everything the Curriculum page writes (subjects, sections, advisers, grading
 * structures, assessment configuration).
 *
 * Two refusals, because there are two different callers. Unlocking a closed year
 * is a super_admin capability: a scoped admin told to "unlock the school year"
 * would be pointed at an affordance their page does not offer, so they get a 403
 * naming who can instead. The 409 is for the super admin who simply did not send
 * the flag — a mis-picked year from a dropdown that lists closed years like any
 * other, which is the risk this gate has always been about. A page sends the
 * flag only after its own explicit unlock.
 */
const assertArchivedWritable = (req, sy, allowArchived, conflictMessage) => {
  if (!isArchivedYear(sy)) return;
  if (!isSuperAdmin(req.user.role)) {
    throw new AppError(
      `SY ${sy.label} is archived. Correcting the records of a closed school year is ` +
      'restricted to a super admin.',
      403
    );
  }
  if (!allowArchived) throw new AppError(conflictMessage, 409);
};

module.exports = { syStatus, isArchivedYear, assertArchivedWritable };
