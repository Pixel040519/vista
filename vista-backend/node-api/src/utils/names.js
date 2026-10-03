/**
 * When two curriculum names are the same name: case and spacing do not count,
 * so "MAPEH", "mapeH" and " Mapeh " are one subject, and "Mabini" and
 * "mabini " one section.
 *
 * Shared by subjects and sections, the two tables an admin names by hand inside
 * a grade level and school year. `NAME_KEY` is the SQL form and must stay
 * identical to the expression in the case-insensitive unique indexes
 * (`subjects_sy_grade_name_ci_unique`, `sections_sy_grade_name_ci_unique`),
 * which back the API's own checks; `normalizeName` is what a name is stored as.
 */

/** SQL: the comparison key for a name column or parameter. */
const NAME_KEY = (expr) => `lower(btrim(regexp_replace(${expr}, '\\s+', ' ', 'g')))`

/** What a typed name is saved as: trimmed, inner runs of spaces collapsed. */
const normalizeName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ')

/** JS mirror of `NAME_KEY`, for matching in memory. */
const nameKey = (name) => normalizeName(name).toLowerCase()

module.exports = { NAME_KEY, normalizeName, nameKey }
