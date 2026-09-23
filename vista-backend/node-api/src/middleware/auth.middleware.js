const jwt = require('jsonwebtoken');
const { ANY_ADMIN, ROLES, canManageGrade } = require('../utils/roles');

// ─── Verify JWT Token ──────────────────────────────────────────
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    // 401, not 403: the caller is not authenticated. Both the dashboard and
    // the parent app refresh the access token on 401 only, so answering an
    // expired token with 403 left every session dead once it expired.
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// ─── Role Authorization ────────────────────────────────────────
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}`
      });
    }
    next();
  };
};

// Shortcuts for the common admin gates after the super/ece/elem split.
const authorizeAnyAdmin    = authorize(...ANY_ADMIN);
const authorizeSuperAdmin  = authorize(ROLES.SUPER_ADMIN);
const authorizeAdminOrTeacher = authorize(...ANY_ADMIN, ROLES.TEACHER);

// Throws 403 if the caller's role cannot manage the given grade level.
// Use inside route handlers for mutations that target a specific grade row.
function enforceGradeScope(req, gradeLevel) {
  if (!canManageGrade(req.user?.role, gradeLevel)) {
    const err = new Error(`Access denied. Grade '${gradeLevel}' is outside your scope.`);
    // errorHandler reads `statusCode`; setting only `status` made every
    // out-of-scope rejection surface as a 500 instead of a 403.
    err.statusCode = 403;
    err.status = 403;
    throw err;
  }
}

module.exports = {
  authenticate,
  authorize,
  authorizeAnyAdmin,
  authorizeSuperAdmin,
  authorizeAdminOrTeacher,
  enforceGradeScope,
};
