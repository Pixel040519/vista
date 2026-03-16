/**
 * Frontend name helpers — mirrors backend nameHelper.js
 */

/** Capitalise first letter of each word, lowercase rest */
export const titleCase = (str = '') =>
  str.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')

/** "Surname, First Name Middle Name" — matches DB generated column format */
export const formatName = ({ surname = '', first_name = '', middle_name = '' } = {}) => {
  if (!surname && !first_name) return ''
  const given = [first_name, middle_name].filter(Boolean).join(' ')
  return `${surname}, ${given}`
}

/** Initial letter for avatars */
export const nameInitial = ({ surname = '', first_name = '' } = {}) =>
  surname ? surname[0].toUpperCase() : first_name ? first_name[0].toUpperCase() : '?'