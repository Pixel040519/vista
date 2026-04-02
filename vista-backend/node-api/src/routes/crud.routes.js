// ============================================================
// ATTENDANCE ROUTES
// ============================================================
const express = require('express');
const attendanceRouter = express.Router();
const { query } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');

attendanceRouter.use(authenticate);

// Read access for admin + teacher; write access for teacher only below

// GET /api/attendance?student_id=&start_date=&end_date=
attendanceRouter.get('/', async (req, res, next) => {
  try {
    const { student_id, start_date, end_date } = req.query;
    if (!student_id) throw new AppError('student_id is required.', 400);

    const result = await query(
      `SELECT a.*, u.full_name as recorded_by_name, sub.name as subject_name
       FROM attendance a
       LEFT JOIN users u ON u.id = a.recorded_by
       LEFT JOIN subjects sub ON sub.id = a.subject_id
       WHERE a.student_id = $1
         AND ($2::date IS NULL OR a.date >= $2::date)
         AND ($3::date IS NULL OR a.date <= $3::date)
       ORDER BY a.date DESC`,
      [student_id, start_date || null, end_date || null]
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

// GET /api/grades?student_id=&school_year=
gradeRouter.get('/', async (req, res, next) => {
  try {
    const { student_id, school_year } = req.query;
    if (!student_id) throw new AppError('student_id is required.', 400);

    const result = await query(
      `SELECT g.*, s.name as subject_name
       FROM grades g
       JOIN subjects s ON s.id = g.subject_id
       WHERE g.student_id = $1
         AND ($2::text IS NULL OR g.school_year = $2)
       ORDER BY g.quarter, s.name`,
      [student_id, school_year || null]
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
gradeRouter.post('/', authorize('admin', 'teacher'), async (req, res, next) => {
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

module.exports.gradeRouter = gradeRouter;


// ============================================================
// BEHAVIOR LOG ROUTES
// ============================================================
const behaviorRouter = express.Router();
const axios = require('axios');

behaviorRouter.use(authenticate);

// GET /api/behavior?student_id=&limit=
behaviorRouter.get('/', async (req, res, next) => {
  try {
    const { student_id, limit = 30 } = req.query;
    if (!student_id) throw new AppError('student_id is required.', 400);

    const result = await query(
      `SELECT bl.*, u.full_name as teacher_name
       FROM behavior_logs bl
       JOIN users u ON u.id = bl.teacher_id
       WHERE bl.student_id = $1
       ORDER BY bl.observed_at DESC
       LIMIT $2`,
      [student_id, limit]
    );

    res.json({ logs: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/behavior — Log a behavior observation
behaviorRouter.post('/', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const { student_id, observation, category, observed_at } = req.body;
    if (!student_id || !observation) {
      throw new AppError('student_id and observation are required.', 400);
    }

    // Call FastAPI AI service for sentiment analysis
    let sentiment = 'Neutral';
    let sentiment_score = 0;
    try {
      const aiResponse = await axios.post(
        `${process.env.AI_SERVICE_URL || 'http://localhost:8000'}/analyze/sentiment`,
        { text: observation }
      );
      sentiment = aiResponse.data.sentiment;
      sentiment_score = aiResponse.data.score;
    } catch (aiErr) {
      console.warn('AI sentiment service unavailable, skipping:', aiErr.message);
    }

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

// PUT /api/behavior/:id — Update a behavior log
behaviorRouter.put('/:id', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const { observation, category } = req.body;
    if (!observation) throw new AppError('observation is required.', 400);

    // Re-analyze sentiment
    let sentiment = 'Neutral';
    let sentiment_score = 0;
    try {
      const aiResponse = await axios.post(
        `${process.env.AI_SERVICE_URL || 'http://localhost:8000'}/analyze/sentiment`,
        { text: observation }
      );
      sentiment = aiResponse.data.sentiment;
      sentiment_score = aiResponse.data.score;
    } catch (aiErr) {
      console.warn('AI sentiment service unavailable, skipping:', aiErr.message);
    }

    const result = await query(
      `UPDATE behavior_logs
       SET observation=$1, category=$2, sentiment=$3, sentiment_score=$4
       WHERE id=$5
       RETURNING *`,
      [observation, category || 'Social', sentiment, sentiment_score, req.params.id]
    );
    if (!result.rows.length) throw new AppError('Behavior log not found.', 404);

    res.json({ message: 'Behavior log updated.', log: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/behavior/:id — Delete a behavior log
behaviorRouter.delete('/:id', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM behavior_logs WHERE id=$1 RETURNING id',
      [req.params.id]
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
dismissalRouter.post('/verify', authorize('admin', 'teacher'), async (req, res, next) => {
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

    res.json({
      message: 'Student released successfully.',
      student: studentResult.rows[0].full_name,
      authorizedGuardian: authCheck.rows[0].full_name,
      dismissedAt: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dismissal/logs?date=
dismissalRouter.get('/logs', authorize('admin'), async (req, res, next) => {
  try {
    const { date } = req.query;
    const result = await query(
      `SELECT dl.*, s.full_name as student_name, u.full_name as guardian_name
       FROM dismissal_logs dl
       JOIN students s ON s.id = dl.student_id
       JOIN users u ON u.id = dl.authorized_by
       WHERE ($1::date IS NULL OR dl.scanned_at::date = $1::date)
       ORDER BY dl.scanned_at DESC`,
      [date || null]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports.dismissalRouter = dismissalRouter;