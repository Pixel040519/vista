// ============================================================
// ATTENDANCE ROUTES
// ============================================================
const express = require('express');
const attendanceRouter = express.Router();
const { query } = require('../config/database');
const { authenticate, authorize, authorizeAnyAdmin } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const { ROLES, ANY_ADMIN, isAnyAdmin, isScopedAdmin, gradeScopeForRole } = require('../utils/roles');
const {
  enforceParentLinked,
  getParentLinkedStudentIds,
  rejectIfAcademicSuspended,
} = require('../middleware/parentScope');
const pushService = require('../services/push.service');

// Grade routes serve elementary only — ECE grade levels (Pre-Nursery–Kinder)
// use the ECE Competency tracker instead of the grades table. Reject admin_ece
// to match the pattern where ECE routes reject admin_elem. Parents of linked
// Grade 1–6 students are allowed (mobile app); parents of ECE students will
// simply get no rows (ECE kids don't have `grades` entries).
const GRADE_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN_ELEM, ROLES.TEACHER, ROLES.PARENT];

attendanceRouter.use(authenticate);

// Read access for admin + teacher; write access for teacher only below

// GET /api/attendance?student_id=&start_date=&end_date=
attendanceRouter.get('/', enforceParentLinked, async (req, res, next) => {
  try {
    const { student_id, start_date, end_date } = req.query;
    if (!student_id) throw new AppError('student_id is required.', 400);

    const params = [student_id, start_date || null, end_date || null];
    let teacherFilter = '';
    if (req.user.role === 'teacher') {
      const activeSY = await query(
        `SELECT label FROM school_years WHERE is_active=TRUE LIMIT 1`
      );
      const syLabel = activeSY.rows[0]?.label || null;
      params.push(req.user.id, syLabel);
      teacherFilter = `
         AND sub.name IN (
           SELECT ta.subject
           FROM teacher_assignments ta
           JOIN students st ON st.id = $1
           WHERE ta.teacher_id = $4
             AND ta.grade_level = st.grade_level
             AND ta.section = st.section
             AND ta.school_year = $5
         )`;
    }

    const result = await query(
      `SELECT a.*, u.full_name as recorded_by_name, sub.name as subject_name
       FROM attendance a
       LEFT JOIN users u ON u.id = a.recorded_by
       LEFT JOIN subjects sub ON sub.id = a.subject_id
       WHERE a.student_id = $1
         AND ($2::date IS NULL OR a.date >= $2::date)
         AND ($3::date IS NULL OR a.date <= $3::date)${teacherFilter}
       ORDER BY a.date DESC`,
      params
    );

    // Calculate summary
    const summary = result.rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      acc.total++;
      return acc;
    }, { Present: 0, Absent: 0, Late: 0, Excused: 0, total: 0 });

    res.json({ attendance: result.rows, summary });
  } catch (err) {
    next(err);
  }
});

// GET /api/attendance/bulk?date=&grade_level=&section=
attendanceRouter.get('/bulk', async (req, res, next) => {
  try {
    const { date, grade_level, section, subject_id } = req.query;
    if (!date) throw new AppError('date is required.', 400);

    const conditions = ['a.date = $1'];
    const params = [date];

    if (grade_level) {
      params.push(grade_level);
      conditions.push(`s.grade_level = $${params.length}`);
    }
    if (section) {
      params.push(section);
      conditions.push(`s.section = $${params.length}`);
    }
    if (subject_id) {
      params.push(subject_id);
      conditions.push(`a.subject_id = $${params.length}`);
    }

    const result = await query(
      `SELECT a.student_id, a.status
       FROM attendance a
       JOIN students s ON s.id = a.student_id
       WHERE ${conditions.join(' AND ')}`,
      params
    );

    // Return as { student_id: status } map
    const records = {};
    for (const row of result.rows) records[row.student_id] = row.status;

    res.json({ records });
  } catch (err) {
    next(err);
  }
});

// GET /api/attendance/daily-detail?date= — Per-student, per-subject attendance for a date
attendanceRouter.get('/daily-detail', async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) throw new AppError('date is required.', 400);

    const result = await query(
      `SELECT a.student_id, s.full_name, s.grade_level, s.section,
              sub.name AS subject_name, a.status
       FROM attendance a
       JOIN students s ON s.id = a.student_id AND s.is_active = TRUE
       JOIN subjects sub ON sub.id = a.subject_id
       WHERE a.date = $1
       ORDER BY s.grade_level, s.section, s.full_name, sub.name`,
      [date]
    );

    res.json({ date, records: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/attendance — Log attendance (single or batch)
attendanceRouter.post('/', authorize('teacher'), async (req, res, next) => {
  try {
    const { records } = req.body; // [{ student_id, date, status, remarks, subject_id }]
    if (!Array.isArray(records) || records.length === 0) {
      throw new AppError('records array is required.', 400);
    }

    const inserted = [];
    for (const record of records) {
      if (!record.subject_id) throw new AppError('subject_id is required for each record.', 400);
      const result = await query(
        `INSERT INTO attendance (student_id, date, status, remarks, recorded_by, subject_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, date, subject_id)
         DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, recorded_by = EXCLUDED.recorded_by
         RETURNING *`,
        [record.student_id, record.date, record.status, record.remarks, req.user.id, record.subject_id]
      );
      inserted.push(result.rows[0]);
    }

    res.status(201).json({ message: `${inserted.length} attendance records saved.`, records: inserted });
  } catch (err) {
    next(err);
  }
});

module.exports = { attendanceRouter };


// ============================================================
// GRADE ROUTES
// ============================================================
const gradeRouter = express.Router();

gradeRouter.use(authenticate);
gradeRouter.use(authorize(...GRADE_ROLES));

// GET /api/grades?student_id=&school_year=
gradeRouter.get('/', enforceParentLinked, async (req, res, next) => {
  try {
    const { student_id, school_year } = req.query;
    if (!student_id) throw new AppError('student_id is required.', 400);

    // Parents cannot see grades for a student whose academic access is suspended
    // (Conditional Access Controller per the manuscript). Staff bypass this gate.
    if (req.user.role === ROLES.PARENT) {
      if (await rejectIfAcademicSuspended(res, student_id)) return;
    }

    const params = [student_id, school_year || null];
    let teacherFilter = '';
    if (req.user.role === 'teacher') {
      const activeSY = await query(
        `SELECT label FROM school_years WHERE is_active=TRUE LIMIT 1`
      );
      const syLabel = activeSY.rows[0]?.label || null;
      params.push(req.user.id, syLabel);
      teacherFilter = `
         AND s.name IN (
           SELECT ta.subject
           FROM teacher_assignments ta
           JOIN students st ON st.id = $1
           WHERE ta.teacher_id = $3
             AND ta.grade_level = st.grade_level
             AND ta.section = st.section
             AND ta.school_year = $4
         )`;
    }

    const result = await query(
      `SELECT g.*, s.name as subject_name
       FROM grades g
       JOIN subjects s ON s.id = g.subject_id
       WHERE g.student_id = $1
         AND ($2::text IS NULL OR g.school_year = $2)${teacherFilter}
       ORDER BY g.quarter, s.name`,
      params
    );

    // Group by quarter for easy consumption
    const byQuarter = result.rows.reduce((acc, row) => {
      const q = `Q${row.quarter}`;
      if (!acc[q]) acc[q] = [];
      acc[q].push(row);
      return acc;
    }, {});

    res.json({ grades: result.rows, byQuarter });
  } catch (err) {
    next(err);
  }
});

// POST /api/grades — Submit grades (batch)
gradeRouter.post('/', async (req, res, next) => {
  try {
    const { records } = req.body; // [{ student_id, subject_id, quarter, school_year, score, grade }]

    const inserted = [];
    for (const r of records) {
      const result = await query(
        `INSERT INTO grades (student_id, subject_id, quarter, school_year, score, grade, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (student_id, subject_id, quarter, school_year)
         DO UPDATE SET score = EXCLUDED.score, grade = EXCLUDED.grade, updated_at = NOW()
         RETURNING *`,
        [r.student_id, r.subject_id, r.quarter, r.school_year, r.score, r.grade, req.user.id]
      );
      inserted.push(result.rows[0]);
    }

    res.status(201).json({ message: `${inserted.length} grade records saved.`, records: inserted });
  } catch (err) {
    next(err);
  }
});

// GET /api/grades/by-subject?subject_id=&grade_level=&section=&school_year=
gradeRouter.get('/by-subject', async (req, res, next) => {
  try {
    const { subject_id, grade_level, section, school_year } = req.query;
    if (!subject_id || !grade_level || !section || !school_year)
      throw new AppError('subject_id, grade_level, section, and school_year are all required.', 400);

    // Teacher authorization: must have matching assignment (admin bypasses)
    if (req.user.role === 'teacher') {
      const subjectRow = await query('SELECT name FROM subjects WHERE id=$1', [subject_id]);
      if (!subjectRow.rows.length) throw new AppError('Subject not found.', 404);
      const subjectName = subjectRow.rows[0].name;
      const assignCheck = await query(
        `SELECT id FROM teacher_assignments
         WHERE teacher_id=$1 AND grade_level=$2 AND section=$3 AND subject=$4 AND school_year=$5
         LIMIT 1`,
        [req.user.id, grade_level, section, subjectName, school_year]
      );
      if (!assignCheck.rows.length) throw new AppError('You are not assigned to this class/subject.', 403);
    }

    // 1. Students in this class
    const studentsResult = await query(
      `SELECT id, lrn, surname, first_name, middle_name, gender
       FROM students
       WHERE grade_level=$1 AND section=$2 AND is_active=TRUE
       ORDER BY gender DESC NULLS LAST, surname, first_name`,
      [grade_level, section]
    );
    const students = studentsResult.rows;
    const studentIds = students.map(s => s.id);

    // 2. Quarterly grades for these students + subject
    const gradesMap = {};
    if (studentIds.length) {
      const gradesResult = await query(
        `SELECT student_id, quarter, grade, score, remarks
         FROM grades
         WHERE subject_id=$1 AND school_year=$2 AND student_id = ANY($3)
         ORDER BY quarter`,
        [subject_id, school_year, studentIds]
      );
      for (const row of gradesResult.rows) {
        if (!gradesMap[row.student_id]) gradesMap[row.student_id] = {};
        gradesMap[row.student_id][row.quarter] = { grade: parseFloat(row.grade), score: parseFloat(row.score), remarks: row.remarks };
      }
    }

    // 3. Subject name
    const subjectResult = await query('SELECT name FROM subjects WHERE id=$1', [subject_id]);
    const subject_name = subjectResult.rows[0]?.name || '';

    // 4. Teacher name
    const teacherResult = await query(
      `SELECT u.surname, u.first_name, u.middle_name
       FROM teacher_assignments ta
       JOIN users u ON u.id = ta.teacher_id
       WHERE ta.grade_level=$1 AND ta.section=$2 AND ta.subject=$3 AND ta.school_year=$4
       LIMIT 1`,
      [grade_level, section, subject_name, school_year]
    );
    const t = teacherResult.rows[0];
    const teacher_name = t ? `${t.surname}, ${t.first_name}${t.middle_name ? ' ' + t.middle_name : ''}` : null;

    res.json({ students, grades: gradesMap, subject_name, teacher_name });
  } catch (err) {
    next(err);
  }
});

module.exports.gradeRouter = gradeRouter;


// ============================================================
// BEHAVIOR LOG ROUTES
// ============================================================
const behaviorRouter = express.Router();
const axios = require('axios');

behaviorRouter.use(authenticate);

const getActiveSYLabel = async () => {
  const r = await query(`SELECT label FROM school_years WHERE is_active=TRUE LIMIT 1`);
  return r.rows[0]?.label || null;
};

const analyzeSentiment = async (text) => {
  try {
    const r = await axios.post(
      `${process.env.AI_SERVICE_URL || 'http://localhost:8000'}/analyze/sentiment`,
      { text }
    );
    return { sentiment: r.data.sentiment, sentiment_score: r.data.score };
  } catch (aiErr) {
    console.warn('AI sentiment service unavailable, skipping:', aiErr.message);
    return { sentiment: 'Neutral', sentiment_score: 0 };
  }
};

// Verify the given student is in one of the teacher's active-SY classes.
const teacherOwnsStudent = async (teacherId, studentId) => {
  const syLabel = await getActiveSYLabel();
  const r = await query(
    `SELECT 1
       FROM students st
       JOIN teacher_assignments ta
         ON ta.grade_level = st.grade_level
        AND ta.section = st.section
      WHERE st.id = $1
        AND ta.teacher_id = $2
        AND ta.school_year = $3
      LIMIT 1`,
    [studentId, teacherId, syLabel]
  );
  return r.rows.length > 0;
};

// GET /api/behavior
// Teacher: requires student_id, scoped to own logs for students in own classes.
// Parent:  requires student_id; must be linked to the student (enforceParentLinked).
// Admin:   student_id optional; supports teacher_id, category, sentiment, date_from, date_to, limit, offset.
behaviorRouter.get('/', enforceParentLinked, async (req, res, next) => {
  try {
    const isAdmin = isAnyAdmin(req.user.role);
    const {
      student_id, teacher_id, category, sentiment,
      date_from, date_to, grade_level, section,
    } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || (isAdmin ? 50 : 30), 200);
    const offset = parseInt(req.query.offset, 10) || 0;

    if (!isAdmin && !student_id) {
      throw new AppError('student_id is required.', 400);
    }

    const where = [];
    const params = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };

    if (student_id) add('bl.student_id = ?', student_id);
    if (category)   add('bl.category = ?', category);
    if (sentiment)  add('bl.sentiment = ?', sentiment);
    if (grade_level) add('s.grade_level = ?', grade_level);
    if (section)    add('s.section = ?', section);
    if (date_from)  add('bl.observed_at >= ?::date', date_from);
    if (date_to)    add('bl.observed_at <  (?::date + INTERVAL \'1 day\')', date_to);

    if (req.user.role === 'teacher') {
      add('bl.teacher_id = ?', req.user.id);
      // Defense-in-depth: only return logs for students the teacher actually teaches.
      // (StudentDetail hits this for any student, so fall back to empty rather than 403.)
      const owns = await teacherOwnsStudent(req.user.id, student_id);
      if (!owns) return res.json({ logs: [], total: 0 });
    } else if (teacher_id) {
      add('bl.teacher_id = ?', teacher_id);
    }

    if (isScopedAdmin(req.user.role)) {
      add('s.grade_level = ANY(?::text[])', gradeScopeForRole(req.user.role));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const listParams = [...params, limit, offset];
    const listSql = `
      SELECT bl.*,
             u.full_name AS teacher_name,
             s.first_name, s.middle_name, s.surname,
             s.grade_level, s.section,
             (
               SELECT STRING_AGG(DISTINCT ta.subject, ', ' ORDER BY ta.subject)
                 FROM teacher_assignments ta
                WHERE ta.teacher_id = bl.teacher_id
                  AND ta.grade_level = s.grade_level
                  AND ta.section = s.section
             ) AS subject
        FROM behavior_logs bl
        JOIN users u    ON u.id = bl.teacher_id
        JOIN students s ON s.id = bl.student_id
        ${whereSql}
       ORDER BY bl.observed_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
    `;

    const [listResult, countResult] = await Promise.all([
      query(listSql, listParams),
      query(
        `SELECT COUNT(*)::int AS total
           FROM behavior_logs bl
           JOIN students s ON s.id = bl.student_id
           ${whereSql}`,
        params
      ),
    ]);

    res.json({
      logs: listResult.rows,
      total: countResult.rows[0]?.total || 0,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/behavior/summary — admin-only aggregate counts for the current filters.
behaviorRouter.get('/summary', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const {
      student_id, teacher_id, category, sentiment,
      date_from, date_to, grade_level, section,
    } = req.query;

    const where = [];
    const params = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };

    if (student_id) add('bl.student_id = ?', student_id);
    if (teacher_id) add('bl.teacher_id = ?', teacher_id);
    if (category)   add('bl.category = ?', category);
    if (sentiment)  add('bl.sentiment = ?', sentiment);
    if (date_from)  add('bl.observed_at >= ?::date', date_from);
    if (date_to)    add('bl.observed_at <  (?::date + INTERVAL \'1 day\')', date_to);
    if (grade_level) add('s.grade_level = ?', grade_level);
    if (section)    add('s.section = ?', section);

    if (isScopedAdmin(req.user.role)) {
      add('s.grade_level = ANY(?::text[])', gradeScopeForRole(req.user.role));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const r = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE bl.sentiment = 'Positive')::int AS positive,
         COUNT(*) FILTER (WHERE bl.sentiment = 'Neutral')::int  AS neutral,
         COUNT(*) FILTER (WHERE bl.sentiment = 'Negative')::int AS negative,
         COUNT(*) FILTER (WHERE bl.observed_at >= NOW() - INTERVAL '7 days')::int AS this_week
       FROM behavior_logs bl
       JOIN students s ON s.id = bl.student_id
       ${whereSql}`,
      params
    );

    res.json(r.rows[0] || { total: 0, positive: 0, neutral: 0, negative: 0, this_week: 0 });
  } catch (err) {
    next(err);
  }
});

// POST /api/behavior — Teacher logs an observation on a student in one of their classes.
behaviorRouter.post('/', authorize('teacher'), async (req, res, next) => {
  try {
    const { student_id, observation, category, observed_at } = req.body;
    if (!student_id || !observation) {
      throw new AppError('student_id and observation are required.', 400);
    }

    const owns = await teacherOwnsStudent(req.user.id, student_id);
    if (!owns) throw new AppError('Student is not in one of your classes.', 403);

    const { sentiment, sentiment_score } = await analyzeSentiment(observation);

    const result = await query(
      `INSERT INTO behavior_logs
         (student_id, teacher_id, observation, category, sentiment, sentiment_score, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [student_id, req.user.id, observation, category, sentiment, sentiment_score,
       observed_at || new Date()]
    );

    res.status(201).json({
      message: 'Behavior logged.',
      log: result.rows[0],
      ai: { sentiment, sentiment_score }
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/behavior/:id — Teacher updates their own log.
behaviorRouter.put('/:id', authorize('teacher'), async (req, res, next) => {
  try {
    const { observation, category } = req.body;
    if (!observation) throw new AppError('observation is required.', 400);

    const { sentiment, sentiment_score } = await analyzeSentiment(observation);

    const result = await query(
      `UPDATE behavior_logs
          SET observation=$1, category=$2, sentiment=$3, sentiment_score=$4
        WHERE id=$5 AND teacher_id=$6
        RETURNING *`,
      [observation, category || 'Social', sentiment, sentiment_score, req.params.id, req.user.id]
    );
    if (!result.rows.length) throw new AppError('Behavior log not found.', 404);

    res.json({ message: 'Behavior log updated.', log: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/behavior/:id — Teacher deletes their own log.
behaviorRouter.delete('/:id', authorize('teacher'), async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM behavior_logs WHERE id=$1 AND teacher_id=$2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) throw new AppError('Behavior log not found.', 404);

    res.json({ message: 'Behavior log deleted.' });
  } catch (err) {
    next(err);
  }
});

module.exports.behaviorRouter = behaviorRouter;


// ============================================================
// DISMISSAL ROUTES — SecurePass QR System
// ============================================================
const dismissalRouter = express.Router();

dismissalRouter.use(authenticate);

// POST /api/dismissal/verify — Scan & verify QR code
// Security guards (vista_guard mobile app) are the primary caller; admin + teacher
// retained for the web SecurePass scanner fallback.
dismissalRouter.post('/verify', authorize(...ANY_ADMIN, ROLES.TEACHER, ROLES.SECURITY_GUARD), async (req, res, next) => {
  try {
    const { qrPayload, authorized_by } = req.body;

    let parsed;
    try {
      parsed = JSON.parse(qrPayload);
    } catch {
      throw new AppError('Invalid QR code format.', 400);
    }

    const { studentId, token, expiresAt } = parsed;

    // Check expiry
    if (new Date() > new Date(expiresAt)) {
      await query(
        `INSERT INTO dismissal_logs (student_id, authorized_by, scanned_by, qr_token, status)
         VALUES ($1, $2, $3, $4, 'Expired')`,
        [studentId, authorized_by, req.user.id, token]
      );
      throw new AppError('QR code has expired. Please generate a new one.', 410);
    }

    // Verify token against DB
    const studentResult = await query(
      'SELECT * FROM students WHERE id = $1 AND qr_code = $2',
      [studentId, token]
    );

    if (studentResult.rows.length === 0) {
      throw new AppError('Invalid QR code. Student not found.', 404);
    }

    // Check if parent is authorized for pickup
    const authCheck = await query(
      `SELECT ps.*, u.full_name
       FROM parent_student ps
       JOIN users u ON u.id = ps.parent_id
       WHERE ps.student_id = $1 AND ps.parent_id = $2 AND ps.is_authorized_pickup = TRUE`,
      [studentId, authorized_by]
    );

    if (authCheck.rows.length === 0) {
      throw new AppError('Guardian is not authorized for pickup.', 403);
    }

    // Log successful dismissal and invalidate QR
    const scannedAt = new Date();
    await query(
      `INSERT INTO dismissal_logs (student_id, authorized_by, scanned_by, qr_token, status)
       VALUES ($1, $2, $3, $4, 'Success')`,
      [studentId, authorized_by, req.user.id, token]
    );

    // Invalidate QR token after use
    await query(
      'UPDATE students SET qr_code = NULL, qr_expires_at = NULL WHERE id = $1',
      [studentId]
    );

    // Insert an in-app notification row for every linked parent so the bell
    // icon in the parent mobile app reflects the event even if push was
    // dropped by the OS / offline / permissions-denied.
    await query(
      `INSERT INTO notifications (recipient_id, title, body, type, reference_id)
       SELECT ps.parent_id,
              $2 || ' has been picked up',
              $3 || ' just signed out ' || $2 || ' at the gate.',
              'pickup',
              $1
         FROM parent_student ps
        WHERE ps.student_id = $1 AND ps.parent_id IS NOT NULL`,
      [studentId, studentResult.rows[0].full_name, authCheck.rows[0].full_name]
    );

    // Fire-and-forget push. Failures are logged inside the service and must
    // not bubble up — the gate is unblocked regardless of FCM health.
    pushService.sendPickupAlert({
      studentId,
      studentName: studentResult.rows[0].full_name,
      guardianName: authCheck.rows[0].full_name,
      scannedAt,
    }).catch(() => {});

    res.json({
      message: 'Student released successfully.',
      student: studentResult.rows[0].full_name,
      authorizedGuardian: authCheck.rows[0].full_name,
      dismissedAt: scannedAt.toISOString()
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dismissal/logs?date=
// Admin/guard: full school-wide logs (guard optionally filtered by date for the
// "Today's log" screen). Parent: last 30 rows across every linked student, date
// filter ignored (the mobile UI is a simple history scroll, not a date picker).
dismissalRouter.get('/logs', authorize(...ANY_ADMIN, ROLES.SECURITY_GUARD, ROLES.PARENT), async (req, res, next) => {
  try {
    if (req.user.role === ROLES.PARENT) {
      const studentIds = await getParentLinkedStudentIds(req.user.id);
      if (studentIds.length === 0) return res.json({ logs: [] });
      const r = await query(
        `SELECT dl.*, s.full_name as student_name, u.full_name as guardian_name
           FROM dismissal_logs dl
           JOIN students s ON s.id = dl.student_id
           JOIN users u ON u.id = dl.authorized_by
          WHERE dl.student_id = ANY($1)
          ORDER BY dl.scanned_at DESC
          LIMIT 30`,
        [studentIds]
      );
      return res.json({ logs: r.rows });
    }

    const { date } = req.query;
    const params = [date || null];
    let scopeClause = '';
    if (isScopedAdmin(req.user.role)) {
      params.push(gradeScopeForRole(req.user.role));
      scopeClause = ` AND s.grade_level = ANY($${params.length}::text[])`;
    }
    const result = await query(
      `SELECT dl.*, s.full_name as student_name, u.full_name as guardian_name
       FROM dismissal_logs dl
       JOIN students s ON s.id = dl.student_id
       JOIN users u ON u.id = dl.authorized_by
       WHERE ($1::date IS NULL OR dl.scanned_at::date = $1::date)${scopeClause}
       ORDER BY dl.scanned_at DESC`,
      params
    );
    res.json({ logs: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports.dismissalRouter = dismissalRouter;