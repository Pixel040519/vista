// Single source of truth for user roles + their grade scopes.
//
// Roles:
//   super_admin    — school-wide access (was 'admin' pre-split).
//   admin_ece      — scoped to Pre-Nursery..Kinder.
//   admin_elem     — scoped to Grade 1..Grade 6.
//   teacher        — scoped via teacher_assignments.
//   parent         — scoped via parent_student.
//   security_guard — school-wide, read-only, gate use (vista_guard mobile app).

const ECE_GRADES  = ['Pre-Nursery', 'Nursery', 'Pre-Kinder', 'Kinder'];
const ELEM_GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];
const ALL_GRADES  = [...ECE_GRADES, ...ELEM_GRADES];

const ROLES = {
  SUPER_ADMIN:    'super_admin',
  ADMIN_ECE:      'admin_ece',
  ADMIN_ELEM:     'admin_elem',
  TEACHER:        'teacher',
  PARENT:         'parent',
  SECURITY_GUARD: 'security_guard',
};

const ANY_ADMIN = [ROLES.SUPER_ADMIN, ROLES.ADMIN_ECE, ROLES.ADMIN_ELEM];
const SCOPED_ADMINS = [ROLES.ADMIN_ECE, ROLES.ADMIN_ELEM];

function gradeScopeForRole(role) {
  if (role === ROLES.ADMIN_ECE)  return [...ECE_GRADES];
  if (role === ROLES.ADMIN_ELEM) return [...ELEM_GRADES];
  if (role === ROLES.SECURITY_GUARD) return [];
  return [...ALL_GRADES];
}

function isAnyAdmin(role)       { return ANY_ADMIN.includes(role); }
function isSuperAdmin(role)     { return role === ROLES.SUPER_ADMIN; }
function isScopedAdmin(role)    { return SCOPED_ADMINS.includes(role); }
function isSecurityGuard(role)  { return role === ROLES.SECURITY_GUARD; }

function canManageGrade(role, gradeLevel) {
  if (!gradeLevel) return true;
  return gradeScopeForRole(role).includes(gradeLevel);
}

module.exports = {
  ROLES,
  ECE_GRADES,
  ELEM_GRADES,
  ALL_GRADES,
  ANY_ADMIN,
  SCOPED_ADMINS,
  gradeScopeForRole,
  isAnyAdmin,
  isSuperAdmin,
  isScopedAdmin,
  isSecurityGuard,
  canManageGrade,
};
