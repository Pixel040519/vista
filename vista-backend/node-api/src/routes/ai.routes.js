const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');

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
    throw new AppError(err.response?.data?.detail || 'AI service error.', 500);
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

module.exports = router;