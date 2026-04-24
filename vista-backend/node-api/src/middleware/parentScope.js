const { query } = require('../config/database');
const { ROLES } = require('../utils/roles');

// For parent callers, require a resolvable student_id on the request and verify
// a row exists in parent_student linking req.user.id → that student. Non-parent
// callers pass through untouched (their own role/scope checks still apply).
//
// Reads student_id from (in order): req.params.student_id, req.params.id,
// req.query.student_id, req.body.student_id. 400s if missing for a parent
// caller, 403s if the link doesn't exist.
//
// On success, attaches `req.parentStudentId = <number>` so downstream handlers
// don't have to re-parse the parameter.
async function enforceParentLinked(req, res, next) {
  try {
    if (req.user?.role !== ROLES.PARENT) return next();

    const raw =
      req.params?.student_id ??
      req.params?.id ??
      req.query?.student_id ??
      req.body?.student_id;

    const studentId = Number.parseInt(raw, 10);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ error: 'student_id is required for parent access.' });
    }

    const result = await query(
      'SELECT 1 FROM parent_student WHERE parent_id = $1 AND student_id = $2 LIMIT 1',
      [req.user.id, studentId]
    );
    if (result.rowCount === 0) {
      return res.status(403).json({ error: 'Not authorized for this student.' });
    }

    req.parentStudentId = studentId;
    next();
  } catch (err) {
    next(err);
  }
}

// Helper for list endpoints where parent sees rows for every linked student.
// Returns an array of student_ids the parent is linked to (empty array if none).
async function getParentLinkedStudentIds(parentId) {
  const result = await query(
    'SELECT student_id FROM parent_student WHERE parent_id = $1',
    [parentId]
  );
  return result.rows.map((r) => r.student_id);
}

// Checks students.academic_access_suspended. If suspended, responds HTTP 423
// with the stored reason and returns true so the caller can early-exit.
// Safety surfaces (attendance, behavior, dismissal, risk) MUST NOT call this —
// only academic surfaces (grades, ECE competency).
async function rejectIfAcademicSuspended(res, studentId) {
  const r = await query(
    `SELECT academic_access_suspended, academic_access_suspended_reason
       FROM students WHERE id = $1`,
    [studentId]
  );
  if (r.rowCount === 0) return false;
  const row = r.rows[0];
  if (row.academic_access_suspended) {
    res.status(423).json({
      error: 'Academic access is temporarily suspended.',
      reason: row.academic_access_suspended_reason || null,
    });
    return true;
  }
  return false;
}

module.exports = {
  enforceParentLinked,
  getParentLinkedStudentIds,
  rejectIfAcademicSuspended,
};
