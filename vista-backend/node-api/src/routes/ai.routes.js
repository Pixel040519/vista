const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const { query } = require('../config/database');

router.use(authenticate);

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// Helper to proxy requests to FastAPI
const proxyToAI = async (endpoint, data) => {
  try {
    const response = await axios.post(`${AI_URL}${endpoint}`, data, {
      timeout: 10000
    });
    return response.data;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new AppError('AI service is currently unavailable.', 503);
    }
    throw new AppError(err.response?.data?.detail || 'AI service error.', err.response?.status || 500);
  }
};

// ─── POST /api/ai/predict-performance ─────────────────────────
// Get academic prediction for a student
router.post('/predict-performance', async (req, res, next) => {
  try {
    const { student_id, subject_id } = req.body;
    if (!student_id) throw new AppError('student_id is required.', 400);

    const result = await proxyToAI('/predict/performance', { student_id, subject_id });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/ai/risk-assessment ─────────────────────────────
// Get risk level classification for a student
router.post('/risk-assessment', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const { student_id } = req.body;
    if (!student_id) throw new AppError('student_id is required.', 400);

    const result = await proxyToAI('/classify/risk', { student_id });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/ai/sentiment ────────────────────────────────────
// Analyze behavioral text sentiment
router.post('/sentiment', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text) throw new AppError('text is required.', 400);

    const result = await proxyToAI('/analyze/sentiment', { text });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/ai/risk-all ─────────────────────────────────────
// Get latest risk assessments for all active students.
// Teachers receive a payload scoped to their (grade_level, section) assignments
// under the active school year; admins get the full school-wide list.
router.get('/risk-all', authorize('admin', 'teacher'), async (req, res, next) => {
  try {
    const response = await axios.get(`${AI_URL}/classify/risk/all`, { timeout: 15000 });

    if (req.user.role !== 'teacher') {
      return res.json(response.data);
    }

    const syRes = await query(
      'SELECT label FROM school_years WHERE is_active = TRUE LIMIT 1'
    );
    const syLabel = syRes.rows[0]?.label;
    if (!syLabel) throw new AppError('No active school year set.', 400);

    const asgRes = await query(
      `SELECT DISTINCT grade_level, section
         FROM teacher_assignments
        WHERE teacher_id = $1 AND school_year = $2`,
      [req.user.id, syLabel]
    );
    const scope = new Set(
      asgRes.rows.map(r => `${r.grade_level}||${r.section}`)
    );

    const allStudents = response.data?.students || [];
    const students = allStudents.filter(s =>
      scope.has(`${s.grade_level}||${s.section}`)
    );
    const summary = {
      total: students.length,
      stable:   students.filter(s => s.risk_level === 'Stable').length,
      moderate: students.filter(s => s.risk_level === 'Moderate Risk').length,
      high:     students.filter(s => s.risk_level === 'High Risk').length,
    };

    res.json({ students, summary });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new AppError('Could not fetch risk assessments.', 503));
  }
});

// ─── GET /api/ai/dashboard-summary ────────────────────────────
// Get AI-generated summary for admin dashboard
router.get('/dashboard-summary', authorize('admin'), async (req, res, next) => {
  try {
    const result = await axios.get(`${AI_URL}/dashboard/summary`, { timeout: 15000 });
    res.json(result.data);
  } catch (err) {
    next(new AppError('Could not fetch dashboard summary.', 503));
  }
});

// ─── GET /api/ai/teacher-dashboard ────────────────────────────
// Teacher-scoped dashboard summary (only the teacher's assignments)
router.get('/teacher-dashboard', authorize('teacher'), async (req, res, next) => {
  try {
    const syRes = await query(
      'SELECT label FROM school_years WHERE is_active = TRUE LIMIT 1'
    );
    const syLabel = syRes.rows[0]?.label;
    if (!syLabel) throw new AppError('No active school year set.', 400);

    const result = await axios.get(`${AI_URL}/teacher-dashboard/summary`, {
      params: { teacher_id: req.user.id, sy_label: syLabel },
      timeout: 15000,
    });
    res.json(result.data);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      return next(new AppError('AI service is currently unavailable.', 503));
    }
    next(err);
  }
});

module.exports = router;