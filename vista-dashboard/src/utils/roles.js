export const ECE_GRADES  = ['Pre-Nursery', 'Nursery', 'Pre-Kinder', 'Kinder']
export const ELEM_GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6']
export const ALL_GRADES  = [...ECE_GRADES, ...ELEM_GRADES]

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN_ECE:   'admin_ece',
  ADMIN_ELEM:  'admin_elem',
  TEACHER:     'teacher',
  PARENT:      'parent',
}

export const ANY_ADMIN      = [ROLES.SUPER_ADMIN, ROLES.ADMIN_ECE, ROLES.ADMIN_ELEM]
export const SCOPED_ADMINS  = [ROLES.ADMIN_ECE, ROLES.ADMIN_ELEM]

export function gradeScopeForRole(role) {
  if (role === ROLES.ADMIN_ECE)  return [...ECE_GRADES]
  if (role === ROLES.ADMIN_ELEM) return [...ELEM_GRADES]
  return [...ALL_GRADES]
}

export function isAnyAdmin(role)     { return ANY_ADMIN.includes(role) }
export function isSuperAdmin(role)   { return role === ROLES.SUPER_ADMIN }
export function isScopedAdmin(role)  { return SCOPED_ADMINS.includes(role) }

export function canManageGrade(role, gradeLevel) {
  if (!gradeLevel) return true
  return gradeScopeForRole(role).includes(gradeLevel)
}

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin_ece:   'ECE Admin',
  admin_elem:  'Elementary Admin',
  teacher:     'Teacher',
  parent:      'Parent',
}
