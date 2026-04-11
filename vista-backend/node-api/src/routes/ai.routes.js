const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const { query } = require('../config/database');

router.use(authenticate);

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// ─── Class-health band helpers ────────────────────────────────
// Shared by GET /class-health (single student) and GET /class-health/all
// (bulk, teacher-scoped Risk Overview) so both views stay consistent.
const BAND_RANK = { ok: 0, watch: 1, urgent: 2 };
const bandAcademic = (avg) =>
  avg === null || avg === undefined ? 'insufficient'
  : avg >= 80 ? 'ok'
  : avg >= 75 ? 'watch'
  : 'urgent';
const bandAttendance = (rate, total) =>
  total < 5 ? 'insufficient'
  : rate >= 0.85 ? 'ok'
  : rate >= 0.70 ? 'watch'
  : 'urgent';
const bandBehavior = (sentiment, count) =>
  count < 2 ? 'insufficient'
  : sentiment >= 0 ? 'ok'
  : sentiment >= -0.30 ? 'watch'
  : 'urgent';
const overallBand = (bands) => {
  const active = bands.filter(b => b !== 'insufficient');
  if (active.length === 0) return 'insufficient';
  return active.reduce((w, b) => (BAND_RANK[b] > BAND_RANK[w] ? b : w), 'ok');
};

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
// Get academic prediction for a student.
// Teachers receive a payload filtered to the subjects they are currently
// assigned to teach this student (based on the student's current
// grade_level + section under the active school year).
router.post('/predict-performance', async (req, res, next) => {
  try {
    const { student_id, subject_id } = req.body;
    if (!student_id) throw new AppError('student_id is required.', 400);

    const result = await proxyToAI('/predict/performance', { student_id, subject_id });

    if (req.user.role === 'teacher') {
      const syRes = await query(
        'SELECT label FROM school_years WHERE is_active = TRUE LIMIT 1'
      );
      const syLabel = syRes.rows[0]?.label;
      if (!syLabel) throw new AppError('No active school year set.', 400);

      const scopeRes = await query(
        `SELECT ta.subject
           FROM teacher_assignments ta
           JOIN students st ON st.id = $1
          WHERE ta.teacher_id = $2
            AND ta.grade_level = st.grade_level
            AND ta.section     = st.section
            AND ta.school_year = $3`,
        [student_id, req.user.id, syLabel]
      );
      const allowed = new Set(scopeRes.rows.map(r => r.subject));

      const subjects = (result.subjects || []).filter(s => allowed.has(s.subject_name));
      const stillRelevant = result.alert && subjects.some(s => result.alert.includes(s.subject_name));
      return res.json({
        ...result,
        subjects,
        alert: stillRelevant ? result.alert : null,
      });
    }

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

// ─── GET /api/ai/class-health ─────────────────────────────────
// Teacher-scoped "In Your Class" health card for a single student.
// Returns three lightweight, rule-banded metrics (academic, attendance,
// behavior) computed only from data the teacher is responsible for:
// subjects they are assigned to teach this student under the active SY,
// plus their own behavior logs. This intentionally does NOT reuse the
// school-wide "Risk Assessment" framing — the scoped windows are too thin
// to support that label, and a scoped "stable" reading can contradict a
// school-wide flag raised by another teacher.
router.get('/class-health', authorize('teacher'), async (req, res, next) => {
  try {
    const { student_id } = req.query;
    if (!student_id) throw new AppError('student_id is required.', 400);

    // 1. Active SY
    const syRes = await query(
      'SELECT label FROM school_years WHERE is_active = TRUE LIMIT 1'
    );
    const syLabel = syRes.rows[0]?.label;
    if (!syLabel) throw new AppError('No active school year set.', 400);

    // 2. Resolve the teacher's assignments that cover this student
    const scopeRes = await query(
      `SELECT ta.subject, st.grade_level, st.section
         FROM teacher_assignments ta
         JOIN students st ON st.id = $1
        WHERE ta.teacher_id = $2
          AND ta.grade_level = st.grade_level
          AND ta.section     = st.section
          AND ta.school_year = $3`,
      [student_id, req.user.id, syLabel]
    );
    if (!scopeRes.rows.length) {
      throw new AppError('You are not assigned to this student in the current school year.', 404);
    }
    const subjectNames = scopeRes.rows.map(r => r.subject);
    const grade_level  = scopeRes.rows[0].grade_level;
    const section      = scopeRes.rows[0].section;

    // 2b. Resolve subject UUIDs for this scope so deep-links can target them
    const subjIdRes = await query(
      `SELECT s.id, s.name
         FROM subjects s
         JOIN school_years sy ON sy.id = s.school_year_id
        WHERE sy.label = $1
          AND s.grade_level = $2
          AND s.name = ANY($3::text[])
          AND s.is_active = TRUE`,
      [syLabel, grade_level, subjectNames]
    );
    const subjects = subjIdRes.rows.map(r => ({ id: r.id, name: r.name }));
    const subjectIdByName = Object.fromEntries(subjects.map(s => [s.name, s.id]));

    // 3. Academic metric — latest quarter per subject, averaged across subjects.
    // DISTINCT ON (subject_id) + ORDER BY subject_id, quarter DESC picks the
    // highest-quarter row per subject in a single scan.
    const acadRes = await query(
      `SELECT latest.subject_id, sub.name AS subject_name, latest.quarter, latest.grade
         FROM (
           SELECT DISTINCT ON (g.subject_id) g.subject_id, g.quarter, g.grade
             FROM grades g
             JOIN subjects s ON s.id = g.subject_id
            WHERE g.student_id = $1
              AND g.school_year = $2
              AND s.name = ANY($3::text[])
              AND g.grade IS NOT NULL
            ORDER BY g.subject_id, g.quarter DESC
         ) latest
         JOIN subjects sub ON sub.id = latest.subject_id
        ORDER BY sub.name`,
      [student_id, syLabel, subjectNames]
    );
    const per_subject = acadRes.rows.map(r => ({
      subject_id:   r.subject_id,
      subject_name: r.subject_name,
      grade:        parseFloat(r.grade),
      quarter:      r.quarter,
    }));
    const acadSample = per_subject.length;
    const avg_grade  = acadSample > 0
      ? per_subject.reduce((a, r) => a + r.grade, 0) / acadSample
      : null;
    const acadBand = bandAcademic(avg_grade);

    // 4. Attendance metric — last 30 days, only this teacher's subjects
    const attRes = await query(
      `SELECT COUNT(*)::int AS total,
              SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END)::int AS present
         FROM attendance a
         JOIN subjects sub ON sub.id = a.subject_id
        WHERE a.student_id = $1
          AND a.date >= (CURRENT_DATE - INTERVAL '30 days')
          AND sub.name = ANY($2::text[])`,
      [student_id, subjectNames]
    );
    const attTotal   = attRes.rows[0]?.total || 0;
    const attPresent = attRes.rows[0]?.present || 0;
    const attRate    = attTotal > 0 ? attPresent / attTotal : null;
    const attBand = bandAttendance(attRate, attTotal);

    // 5. Behavior metric — this teacher's own logs this month
    const behRes = await query(
      `SELECT AVG(sentiment_score)::float AS avg_sentiment,
              COUNT(*)::int AS log_count
         FROM behavior_logs
        WHERE student_id = $1
          AND teacher_id = $2
          AND observed_at >= date_trunc('month', CURRENT_DATE)`,
      [student_id, req.user.id]
    );
    const logCount     = behRes.rows[0]?.log_count || 0;
    const avgSentiment = behRes.rows[0]?.avg_sentiment;
    const behBand = bandBehavior(avgSentiment, logCount);

    // 6. Overall band = worst of non-insufficient metrics
    const overall_band = overallBand([acadBand, attBand, behBand]);

    // 7. DSS — rule-based suggestions tailored to each signal the teacher
    // can actually act on. Ordered by urgency so the most important advice
    // appears first in the UI.
    const suggestions = [];

    // First subject_id falls back to whichever subject has one — used for
    // attendance deep-link when the metric is class-wide rather than
    // subject-specific.
    const firstSubjectId = subjects[0]?.id || null;

    if (acadBand === 'urgent' && per_subject.length) {
      const worst = per_subject.reduce((w, p) => p.grade < w.grade ? p : w, per_subject[0]);
      suggestions.push({
        severity: 'urgent',
        text: `Academic is critical in ${worst.subject_name} (${worst.grade} in Q${worst.quarter}). Review recent Score Entry and consider a remediation activity.`,
        action: {
          type: 'score-entry',
          subject_id: worst.subject_id,
          quarter: worst.quarter,
          label: 'Open Score Entry',
        },
      });
    } else if (acadBand === 'watch') {
      const weakest = per_subject.reduce((w, p) => p.grade < w.grade ? p : w, per_subject[0]);
      suggestions.push({
        severity: 'watch',
        text: `Academic needs monitoring — schedule a brief 1-on-1 check-in with the student this week.`,
        action: weakest ? {
          type: 'score-entry',
          subject_id: weakest.subject_id,
          quarter: weakest.quarter,
          label: 'Review scores',
        } : undefined,
      });
    }

    if (attBand === 'urgent') {
      suggestions.push({
        severity: 'urgent',
        text: `Attendance is critically low (${Math.round(attRate * 100)}% in your subject sessions). Contact the guardian and document the absence pattern.`,
        action: {
          type: 'attendance',
          subject_id: firstSubjectId,
          label: 'Open Attendance',
        },
      });
    } else if (attBand === 'watch') {
      suggestions.push({
        severity: 'watch',
        text: `Watch for consecutive absences over the next week. Flag to the homeroom adviser if the pattern continues.`,
        action: {
          type: 'attendance',
          subject_id: firstSubjectId,
          label: 'Open Attendance',
        },
      });
    }

    if (behBand === 'urgent') {
      suggestions.push({
        severity: 'urgent',
        text: `Your recent behavior logs for this student skew negative. Add a new observation with a concrete intervention note.`,
        action: { type: 'behavior', label: 'Log observation' },
      });
    } else if (behBand === 'watch') {
      suggestions.push({
        severity: 'watch',
        text: `Mixed behavioral observations in your logs — add a fresh note so the sentiment signal stays current.`,
        action: { type: 'behavior', label: 'Log observation' },
      });
    } else if (behBand === 'insufficient' && (acadBand !== 'ok' && acadBand !== 'insufficient' || attBand !== 'ok' && attBand !== 'insufficient')) {
      suggestions.push({
        severity: 'watch',
        text: `You haven't logged any behavior observations this month. Add one to track changes alongside the academic/attendance concerns above.`,
        action: { type: 'behavior', label: 'Log observation' },
      });
    }

    if (overall_band === 'ok') {
      suggestions.push({
        severity: 'ok',
        text: `Student is on track in your class — continue regular monitoring.`,
      });
    }

    if (overall_band === 'insufficient' && suggestions.length === 0) {
      suggestions.push({
        severity: 'insufficient',
        text: `Not enough data yet to generate recommendations. Record more scores, attendance, or behavior logs to enable signals.`,
      });
    }

    res.json({
      scope: { grade_level, section, subjects },
      overall_band,
      suggestions,
      metrics: {
        academic: {
          avg_grade:    avg_grade !== null ? Math.round(avg_grade * 10) / 10 : null,
          sample_count: acadSample,
          band:         acadBand,
          per_subject,
        },
        attendance: {
          rate:         attRate !== null ? Math.round(attRate * 10000) / 10000 : null,
          present:      attPresent,
          total:        attTotal,
          window_days:  30,
          band:         attBand,
        },
        behavior: {
          avg_sentiment: avgSentiment !== null && avgSentiment !== undefined
            ? Math.round(avgSentiment * 10000) / 10000
            : null,
          log_count:     logCount,
          band:          behBand,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/ai/class-health/all ─────────────────────────────
// Bulk teacher-scoped class-health for the Risk Overview page.
// Computes the same three signals as GET /class-health (academic,
// attendance, behavior) for every active student whose (grade_level,
// section) matches one of the teacher's active-SY assignments, then
// returns per-student bands + a scope-wide summary. Admins use the
// school-wide /risk-all path — this endpoint is teacher-only.
router.get('/class-health/all', authorize('teacher'), async (req, res, next) => {
  try {
    // 1. Active SY
    const syRes = await query(
      'SELECT label FROM school_years WHERE is_active = TRUE LIMIT 1'
    );
    const syLabel = syRes.rows[0]?.label;
    if (!syLabel) throw new AppError('No active school year set.', 400);

    // 2. Teacher's assignments → groups keyed by (grade_level, section)
    const asgRes = await query(
      `SELECT grade_level, section, subject
         FROM teacher_assignments
        WHERE teacher_id = $1 AND school_year = $2`,
      [req.user.id, syLabel]
    );
    if (!asgRes.rows.length) {
      return res.json({
        scope: { sections: [] },
        summary: { total: 0, ok: 0, watch: 0, urgent: 0, insufficient: 0 },
        students: [],
      });
    }
    const groups = new Map();
    for (const r of asgRes.rows) {
      const k = `${r.grade_level}|||${r.section}`;
      if (!groups.has(k)) {
        groups.set(k, { grade_level: r.grade_level, section: r.section, subjectNames: [] });
      }
      groups.get(k).subjectNames.push(r.subject);
    }
    const scopeSections = Array.from(groups.values()).map(g => ({
      grade_level: g.grade_level,
      section:     g.section,
      subjects:    g.subjectNames,
    }));

    // 3. Load active students across all groups (one query, OR'd tuples)
    const studentParams = [];
    const orClauses = [];
    for (const g of groups.values()) {
      orClauses.push(`(grade_level = $${studentParams.length + 1} AND section = $${studentParams.length + 2})`);
      studentParams.push(g.grade_level, g.section);
    }
    const stuRes = await query(
      `SELECT id, surname, first_name, middle_name, grade_level, section
         FROM students
        WHERE is_active = TRUE AND (${orClauses.join(' OR ')})
        ORDER BY surname, first_name`,
      studentParams
    );
    const students = stuRes.rows;
    if (!students.length) {
      return res.json({
        scope: { sections: scopeSections },
        summary: { total: 0, ok: 0, watch: 0, urgent: 0, insufficient: 0 },
        students: [],
      });
    }

    // Seed a per-student accumulator so groups can drop their results in.
    const byId = new Map();
    for (const s of students) {
      const full_name = [s.surname, ','].join('') + ' ' + s.first_name +
        (s.middle_name ? ` ${s.middle_name[0]}.` : '');
      byId.set(s.id, {
        student_id:  s.id,
        full_name,
        grade_level: s.grade_level,
        section:     s.section,
        _acad: { sum: 0, count: 0 },
        _att:  { present: 0, total: 0 },
        _beh:  { sum: 0, count: 0 },
      });
    }

    // 4. Per-section-group bulk metric queries. Scoping per group matters
    // when a teacher teaches different subjects in different sections —
    // we never want Grade 4-A Math attendance to count toward a Grade 5-B
    // student where the teacher only teaches Science.
    for (const g of groups.values()) {
      const groupIds = students
        .filter(s => s.grade_level === g.grade_level && s.section === g.section)
        .map(s => s.id);
      if (!groupIds.length) continue;

      // Academic — latest quarter per (student, subject)
      const acadRes = await query(
        `SELECT latest.student_id, latest.grade
           FROM (
             SELECT DISTINCT ON (g.student_id, g.subject_id)
                    g.student_id, g.subject_id, g.grade
               FROM grades g
               JOIN subjects s ON s.id = g.subject_id
              WHERE g.student_id = ANY($1::uuid[])
                AND g.school_year = $2
                AND s.name = ANY($3::text[])
                AND g.grade IS NOT NULL
              ORDER BY g.student_id, g.subject_id, g.quarter DESC
           ) latest`,
        [groupIds, syLabel, g.subjectNames]
      );
      for (const r of acadRes.rows) {
        const bucket = byId.get(r.student_id);
        if (!bucket) continue;
        bucket._acad.sum += parseFloat(r.grade);
        bucket._acad.count += 1;
      }

      // Attendance — last 30 days, teacher's subjects only
      const attRes = await query(
        `SELECT a.student_id,
                COUNT(*) FILTER (WHERE a.status = 'Present')::int AS present,
                COUNT(*)::int AS total
           FROM attendance a
           JOIN subjects sub ON sub.id = a.subject_id
          WHERE a.student_id = ANY($1::uuid[])
            AND a.date >= (CURRENT_DATE - INTERVAL '30 days')
            AND sub.name = ANY($2::text[])
          GROUP BY a.student_id`,
        [groupIds, g.subjectNames]
      );
      for (const r of attRes.rows) {
        const bucket = byId.get(r.student_id);
        if (!bucket) continue;
        bucket._att.present += r.present;
        bucket._att.total   += r.total;
      }

      // Behavior — this teacher's logs for this student, this month
      const behRes = await query(
        `SELECT student_id,
                AVG(sentiment_score)::float AS avg_sentiment,
                COUNT(*)::int AS log_count
           FROM behavior_logs
          WHERE teacher_id = $1
            AND student_id = ANY($2::uuid[])
            AND observed_at >= date_trunc('month', CURRENT_DATE)
          GROUP BY student_id`,
        [req.user.id, groupIds]
      );
      for (const r of behRes.rows) {
        const bucket = byId.get(r.student_id);
        if (!bucket) continue;
        // sum is really "avg * count" so we can fold across sections if a
        // student somehow appears in multiple groups (defensive — shouldn't
        // happen since a student has one (grade, section)).
        bucket._beh.sum   += (r.avg_sentiment || 0) * r.log_count;
        bucket._beh.count += r.log_count;
      }
    }

    // 5. Band each student, build the summary, sort worst-first.
    const TOP_ORDER = ['academic', 'attendance', 'behavior'];
    const out = [];
    const summary = { total: students.length, ok: 0, watch: 0, urgent: 0, insufficient: 0 };

    for (const bucket of byId.values()) {
      const avg_grade = bucket._acad.count > 0
        ? bucket._acad.sum / bucket._acad.count
        : null;
      const att_rate = bucket._att.total > 0
        ? bucket._att.present / bucket._att.total
        : null;
      const avg_sentiment = bucket._beh.count > 0
        ? bucket._beh.sum / bucket._beh.count
        : null;

      const acadB = bandAcademic(avg_grade);
      const attB  = bandAttendance(att_rate ?? 0, bucket._att.total);
      const behB  = bandBehavior(avg_sentiment ?? 0, bucket._beh.count);
      const overall = overallBand([acadB, attB, behB]);

      // top_concern = worst non-insufficient metric
      const perMetric = { academic: acadB, attendance: attB, behavior: behB };
      let top_concern = null;
      let worstRank = -1;
      for (const m of TOP_ORDER) {
        const b = perMetric[m];
        if (b === 'insufficient' || b === 'ok') continue;
        if (BAND_RANK[b] > worstRank) {
          worstRank = BAND_RANK[b];
          top_concern = m;
        }
      }

      summary[overall] += 1;

      out.push({
        student_id:  bucket.student_id,
        full_name:   bucket.full_name,
        grade_level: bucket.grade_level,
        section:     bucket.section,
        overall_band: overall,
        top_concern,
        metrics: {
          academic: {
            avg_grade:    avg_grade !== null ? Math.round(avg_grade * 10) / 10 : null,
            sample_count: bucket._acad.count,
            band:         acadB,
          },
          attendance: {
            rate:    att_rate !== null ? Math.round(att_rate * 10000) / 10000 : null,
            present: bucket._att.present,
            total:   bucket._att.total,
            band:    attB,
          },
          behavior: {
            avg_sentiment: avg_sentiment !== null ? Math.round(avg_sentiment * 10000) / 10000 : null,
            log_count:     bucket._beh.count,
            band:          behB,
          },
        },
      });
    }

    // Sort: urgent → watch → ok → insufficient; within band, worst
    // metric-value first so the teacher's attention lands at the top.
    const OVERALL_SORT = { urgent: 0, watch: 1, ok: 2, insufficient: 3 };
    out.sort((a, b) => {
      const d = OVERALL_SORT[a.overall_band] - OVERALL_SORT[b.overall_band];
      if (d !== 0) return d;
      // Within a band, rank by the lowest (worst) available numeric signal.
      const worstVal = (s) => {
        const vals = [];
        if (s.metrics.academic.avg_grade !== null) vals.push(s.metrics.academic.avg_grade);
        if (s.metrics.attendance.rate    !== null) vals.push(s.metrics.attendance.rate * 100);
        return vals.length ? Math.min(...vals) : 999;
      };
      return worstVal(a) - worstVal(b);
    });

    res.json({
      scope: { sections: scopeSections },
      summary,
      students: out,
    });
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