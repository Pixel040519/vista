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

/** 'active' | 'upcoming' | 'archived'. */
const syStatus = (sy) =>
  !sy ? null : sy.is_active ? 'active' : sy.is_upcoming ? 'upcoming' : 'archived';

/**
 * True for a year that has closed. What lives in an archived year is the record
 * of what actually happened, so writes to it are refused unless the caller says
 * plainly that it is correcting history.
 */
const isArchivedYear = (sy) => syStatus(sy) === 'archived';

module.exports = { syStatus, isArchivedYear };
