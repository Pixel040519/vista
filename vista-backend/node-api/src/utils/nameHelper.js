/**
 * VISTA name helpers
 * titleCase('jose rizal')  → 'Jose Rizal'
 * formatName({surname, first_name, middle_name}) → 'Dela Cruz, Juan Pedro'
 */

/** Capitalise first letter of every word, lowercase the rest */
const titleCase = (str) => {
  if (!str) return ''
  return str
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** Apply titleCase to all name fields on an object, returns new object */
const normaliseName = (obj) => {
  const out = { ...obj }
  if (out.surname)     out.surname     = titleCase(out.surname)
  if (out.first_name)  out.first_name  = titleCase(out.first_name)
  if (out.middle_name) out.middle_name = titleCase(out.middle_name)
  return out
}

/** "Surname, First Name Middle Name" */
const formatFullName = ({ surname, first_name, middle_name } = {}) => {
  if (!surname && !first_name) return ''
  const given = [first_name, middle_name].filter(Boolean).join(' ')
  return `${surname}, ${given}`
}

module.exports = { titleCase, normaliseName, formatFullName }