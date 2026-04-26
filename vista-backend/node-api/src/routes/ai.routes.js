const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticate, authorize, authorizeAnyAdmin } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const { query } = require('../config/database');
const { ROLES, ANY_ADMIN, gradeScopeForRole, isScopedAdmin } = require('../utils/roles');

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
// ECE band: uses the rating distribution for the latest quarter's records.
// Distinct from bandAcademic because ECE learners have no numeric grades.
const bandCompetency = (dist, totalSkills) => {
  const rated = (dist.E||0)+(dist.G||0)+(dist.F||0)+(dist.NA||0);
  if (totalSkills === 0 || rated === 0) return 'insufficient';
  const completion = rated / totalSkills;
  if (completion < 0.3) return 'insufficient';
  const naPct = (dist.NA||0) / rated;
  const fPct  = (dist.F||0)  / rated;
  if (naPct > 0.3) return 'urgent';
  if ((dist.NA||0) > 0 || fPct > 0.4) return 'watch';
  return 'ok';
};
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
router.post('/risk-assessment', authorize(...ANY_ADMIN, 'teacher'), async (req, res, next) => {
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
router.post('/sentiment', authorize(...ANY_ADMIN, 'teacher'), async (req, res, next) => {
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
router.get('/risk-all', authorize(...ANY_ADMIN, 'teacher'), async (req, res, next) => {
  try {
    const response = await axios.get(`${AI_URL}/classify/risk/all`, { timeout: 15000 });
    const allStudents = response.data?.students || [];

    // Super_admin: full school-wide list passes through unfiltered.
    if (req.user.role === ROLES.SUPER_ADMIN) {
      return res.json(response.data);
    }

    // Scoped admins (admin_ece / admin_elem): filter to their grade scope.
    if (isScopedAdmin(req.user.role)) {
      const scope = new Set(gradeScopeForRole(req.user.role));
      const students = allStudents.filter(s => scope.has(s.grade_level));
      const summary = {
        total: students.length,
        stable:   students.filter(s => s.risk_level === 'Stable').length,
        moderate: students.filter(s => s.risk_level === 'Moderate Risk').length,
        high:     students.filter(s => s.risk_level === 'High Risk').length,
      };
      return res.json({ students, summary });
    }

    // Teacher: filter to their (grade_level, section) assignments.
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

// ─── GET /api/ai/ece-class-health ─────────────────────────────
// ECE-equivalent of /class-health for Pre-Nursery → Kinder learners.
// Because ECE has no numeric grades, the academic tile is replaced by a
// Competency tile banded on the rating mix (E/G/F/NA) for the student's
// latest quarter with records. Attendance + Behavior tiles reuse the same
// rules as /class-health. Available to both admin (school-wide) and
// teacher (scoped to their teacher_assignments for this student's class).
router.get('/ece-class-health', authorize(...ANY_ADMIN, 'teacher'), async (req, res, next) => {
  try {
    const { student_id } = req.query;
    if (!student_id) throw new AppError('student_id is required.', 400);

    // 1. Active SY
    const syRes = await query(
      'SELECT id, label FROM school_years WHERE is_active = TRUE LIMIT 1'
    );
    const sy = syRes.rows[0];
    if (!sy) throw new AppError('No active school year set.', 400);

    // 2. Student + ECE check
    const ECE = ['Pre-Nursery', 'Nursery', 'Pre-Kinder', 'Kinder'];
    const stRes = await query(
      `SELECT id, grade_level, section FROM students WHERE id = $1 AND is_active = TRUE`,
      [student_id]
    );
    if (!stRes.rows.length) throw new AppError('Student not found.', 404);
    const st = stRes.rows[0];
    if (!ECE.includes(st.grade_level)) {
      throw new AppError('This endpoint is only for ECE learners.', 400);
    }

    // 3. Teacher scope (role=teacher → restrict to subjects they teach for this class)
    let teacherSubjectNames = null;
    if (req.user.role === 'teacher') {
      const scopeRes = await query(
        `SELECT subject
           FROM teacher_assignments
          WHERE teacher_id = $1
            AND grade_level = $2
            AND section     = $3
            AND school_year = $4`,
        [req.user.id, st.grade_level, st.section, sy.label]
      );
      if (!scopeRes.rows.length) {
        throw new AppError('You are not assigned to this student in the current school year.', 404);
      }
      teacherSubjectNames = scopeRes.rows.map(r => r.subject);
    }

    // 4. Competency metric — latest quarter with records for this student
    const latestQRes = await query(
      `SELECT MAX(quarter)::int AS q
         FROM ece_competency_records
        WHERE student_id = $1 AND school_year_id = $2`,
      [student_id, sy.id]
    );
    const latestQ = latestQRes.rows[0]?.q || null;

    // Per-subject totals for this student's grade level (used in both branches).
    const subjectTotalsRes = await query(
      `SELECT sub.id         AS subject_id,
              sub.name       AS subject_name,
              COUNT(s.id)::int AS total_skills
         FROM subjects sub
         LEFT JOIN competency_skills s
           ON s.subject_id = sub.id AND s.is_active = TRUE
        WHERE sub.grade_level = $1
        GROUP BY sub.id, sub.name
       HAVING COUNT(s.id) > 0
        ORDER BY sub.name`,
      [st.grade_level]
    );
    const subjectTotals = subjectTotalsRes.rows;
    const totalSkills   = subjectTotals.reduce((a, r) => a + r.total_skills, 0);

    // Per-subject rating distribution for the latest quarter (empty map if no Q).
    const perSubjectDist = new Map(); // subject_id -> { E, G, F, NA }
    if (latestQ) {
      const ratingRes = await query(
        `SELECT s.subject_id, r.rating, COUNT(*)::int AS n
           FROM ece_competency_records r
           JOIN competency_skills s ON s.id = r.skill_id
          WHERE r.student_id = $1
            AND r.school_year_id = $2
            AND r.quarter = $3
          GROUP BY s.subject_id, r.rating`,
        [student_id, sy.id, latestQ]
      );
      for (const row of ratingRes.rows) {
        const d = perSubjectDist.get(row.subject_id) || { E: 0, G: 0, F: 0, NA: 0 };
        d[row.rating] = row.n;
        perSubjectDist.set(row.subject_id, d);
      }
    }

    // Build per-subject entries + aggregate totals.
    const BAND_SORT = { urgent: 0, watch: 1, insufficient: 2, ok: 3 };
    const overallDist = { E: 0, G: 0, F: 0, NA: 0 };
    const per_subject = subjectTotals.map(s => {
      const dist = perSubjectDist.get(s.subject_id) || { E: 0, G: 0, F: 0, NA: 0 };
      const rated = dist.E + dist.G + dist.F + dist.NA;
      overallDist.E += dist.E; overallDist.G += dist.G;
      overallDist.F += dist.F; overallDist.NA += dist.NA;
      return {
        subject_id:   s.subject_id,
        subject_name: s.subject_name,
        rated,
        total_skills: s.total_skills,
        distribution: dist,
        band:         bandCompetency(dist, s.total_skills),
      };
    }).sort((a, b) =>
      (BAND_SORT[a.band] - BAND_SORT[b.band]) ||
      a.subject_name.localeCompare(b.subject_name)
    );

    const overallRated      = overallDist.E + overallDist.G + overallDist.F + overallDist.NA;
    const overallCompletion = totalSkills > 0 ? overallRated / totalSkills : 0;
    const competency = {
      quarter:      latestQ,
      rated:        overallRated,
      total_skills: totalSkills,
      completion:   Math.round(overallCompletion * 10000) / 10000,
      distribution: overallDist,
      band:         bandCompetency(overallDist, totalSkills),
      per_subject,
    };

    // 5. Attendance — last 30 days. Teachers filter to their own subjects.
    const attArgs = [student_id];
    let attSubjectClause = '';
    if (teacherSubjectNames) {
      attArgs.push(teacherSubjectNames);
      attSubjectClause = `AND sub.name = ANY($${attArgs.length}::text[])`;
    }
    const attRes = await query(
      `SELECT COUNT(*)::int AS total,
              SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END)::int AS present
         FROM attendance a
         JOIN subjects sub ON sub.id = a.subject_id
        WHERE a.student_id = $1
          AND a.date >= (CURRENT_DATE - INTERVAL '30 days')
          ${attSubjectClause}`,
      attArgs
    );
    const attTotal   = attRes.rows[0]?.total || 0;
    const attPresent = attRes.rows[0]?.present || 0;
    const attRate    = attTotal > 0 ? attPresent / attTotal : null;
    const attBand    = bandAttendance(attRate, attTotal);

    // 6. Behavior — this month. Teachers filter to their own logs.
    const behArgs = [student_id];
    let behTeacherClause = '';
    if (req.user.role === 'teacher') {
      behArgs.push(req.user.id);
      behTeacherClause = `AND teacher_id = $${behArgs.length}`;
    }
    const behRes = await query(
      `SELECT AVG(sentiment_score)::float AS avg_sentiment,
              COUNT(*)::int AS log_count
         FROM behavior_logs
        WHERE student_id = $1
          AND observed_at >= date_trunc('month', CURRENT_DATE)
          ${behTeacherClause}`,
      behArgs
    );
    const logCount     = behRes.rows[0]?.log_count || 0;
    const avgSentiment = behRes.rows[0]?.avg_sentiment;
    const behBand      = bandBehavior(avgSentiment, logCount);

    // 7. Overall band = worst of non-insufficient
    const overall_band = overallBand([competency.band, attBand, behBand]);

    // 8. DSS suggestions — per-subject competency lines, then attendance + behavior.
    const suggestions = [];
    const urgentSubjects = competency.per_subject.filter(s => s.band === 'urgent');
    const watchSubjects  = competency.per_subject.filter(s => s.band === 'watch');
    const URGENT_CAP = 3;
    const WATCH_CAP  = 2;

    for (const s of urgentSubjects.slice(0, URGENT_CAP)) {
      const na = s.distribution.NA;
      suggestions.push({
        severity: 'urgent',
        text: `${s.subject_name}: ${na} skill${na === 1 ? '' : 's'} marked Needs Assistance in Q${competency.quarter}. Plan a targeted play-based session this week.`,
        action: { type: 'ece', label: 'Open ECE Competency' },
      });
    }
    for (const s of watchSubjects.slice(0, WATCH_CAP)) {
      const below = (s.distribution.NA || 0) + (s.distribution.F || 0);
      suggestions.push({
        severity: 'watch',
        text: `${s.subject_name}: ${below} skill${below === 1 ? '' : 's'} below "Good" in Q${competency.quarter}. Schedule focused practice and re-observe next week.`,
        action: { type: 'ece', label: 'Open ECE Competency' },
      });
    }
    const overflowCount =
      Math.max(0, urgentSubjects.length - URGENT_CAP) +
      Math.max(0, watchSubjects.length  - WATCH_CAP);
    if (overflowCount > 0) {
      suggestions.push({
        severity: 'watch',
        text: `+${overflowCount} more subject${overflowCount === 1 ? '' : 's'} need attention — review the full list.`,
        action: { type: 'ece', label: 'Open ECE Competency' },
      });
    }

    // Overall-completion nudge — fires only when no per-subject lines were
    // added (otherwise it's redundant), and the overall band is insufficient.
    if (urgentSubjects.length === 0 && watchSubjects.length === 0
        && competency.band === 'insufficient' && competency.total_skills > 0) {
      suggestions.push({
        severity: 'watch',
        text: competency.quarter
          ? `Only ${competency.rated} of ${competency.total_skills} skills rated in Q${competency.quarter}. Complete this quarter's tracker to surface signals.`
          : `No competency ratings recorded yet. Start this quarter's tracker to surface signals.`,
        action: { type: 'ece', label: 'Open ECE Competency' },
      });
    }

    if (attBand === 'urgent') {
      suggestions.push({
        severity: 'urgent',
        text: `Attendance is critically low (${Math.round(attRate * 100)}% over the last 30 days). Contact the guardian and document the pattern.`,
        action: { type: 'attendance', label: 'Open Attendance' },
      });
    } else if (attBand === 'watch') {
      suggestions.push({
        severity: 'watch',
        text: `Watch for consecutive absences. Flag to the homeroom adviser if the pattern continues.`,
        action: { type: 'attendance', label: 'Open Attendance' },
      });
    }

    if (behBand === 'urgent') {
      suggestions.push({
        severity: 'urgent',
        text: req.user.role === 'teacher'
          ? `Your behavior logs for this student skew negative. Log a fresh observation with a concrete intervention.`
          : `Behavior observations skew negative this month. Follow up with the homeroom teacher.`,
        action: { type: 'behavior', label: 'Log observation' },
      });
    } else if (behBand === 'watch') {
      suggestions.push({
        severity: 'watch',
        text: `Mixed behavioral observations — add a fresh note so the signal stays current.`,
        action: { type: 'behavior', label: 'Log observation' },
      });
    }

    if (overall_band === 'ok') {
      suggestions.push({
        severity: 'ok',
        text: `Student is progressing well across tracked signals — continue regular observation.`,
      });
    }

    if (overall_band === 'insufficient' && suggestions.length === 0) {
      suggestions.push({
        severity: 'insufficient',
        text: `Not enough tracked data yet. Rate more competency skills, take attendance, or log behavior to enable signals.`,
      });
    }

    res.json({
      scope: { grade_level: st.grade_level, section: st.section },
      overall_band,
      suggestions,
      metrics: {
        competency,
        attendance: {
          rate:        attRate !== null ? Math.round(attRate * 10000) / 10000 : null,
          present:     attPresent,
          total:       attTotal,
          window_days: 30,
          band:        attBand,
        },
        behavior: {
          avg_sentiment: avgSentiment !== null && avgSentiment !== undefined
            ? Math.round(avgSentiment * 10000) / 10000
            : null,
          log_count: logCount,
          band:      behBand,
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
      'SELECT id, label FROM school_years WHERE is_active = TRUE LIMIT 1'
    );
    const syRow = syRes.rows[0];
    if (!syRow) throw new AppError('No active school year set.', 400);
    const syLabel = syRow.label;
    const syId    = syRow.id;

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
    const ECE_GRADE_LEVELS = new Set(['Pre-Nursery', 'Nursery', 'Pre-Kinder', 'Kinder']);
    const byId = new Map();
    for (const s of students) {
      const full_name = [s.surname, ','].join('') + ' ' + s.first_name +
        (s.middle_name ? ` ${s.middle_name[0]}.` : '');
      byId.set(s.id, {
        student_id:  s.id,
        full_name,
        grade_level: s.grade_level,
        section:     s.section,
        is_ece:      ECE_GRADE_LEVELS.has(s.grade_level),
        _acad: { sum: 0, count: 0 },
        _att:  { present: 0, total: 0 },
        _beh:  { sum: 0, count: 0 },
        _comp: null, // filled for ECE students below
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

    // 5. ECE competency — loaded once for all ECE students in scope, since
    // ECE learners have no numeric grades and the academic tile would always
    // say "insufficient" for them. The competency tile replaces it.
    const eceStudents = students.filter(s => ECE_GRADE_LEVELS.has(s.grade_level));
    if (eceStudents.length) {
      const eceIds    = eceStudents.map(s => s.id);
      const eceGrades = [...new Set(eceStudents.map(s => s.grade_level))];

      // total skills per grade level (sum over subjects that have skills)
      const totalRes = await query(
        `SELECT sub.grade_level, COUNT(cs.id)::int AS total_skills
           FROM subjects sub
           JOIN competency_skills cs
             ON cs.subject_id = sub.id AND cs.is_active = TRUE
          WHERE sub.grade_level = ANY($1::text[])
          GROUP BY sub.grade_level`,
        [eceGrades]
      );
      const totalSkillsByGrade = new Map(totalRes.rows.map(r => [r.grade_level, r.total_skills]));

      // latest-quarter rating distribution per student, in active SY
      const distRes = await query(
        `SELECT r.student_id, r.rating, COUNT(*)::int AS n
           FROM ece_competency_records r
           JOIN (
             SELECT student_id, MAX(quarter) AS q
               FROM ece_competency_records
              WHERE student_id = ANY($1::uuid[]) AND school_year_id = $2
              GROUP BY student_id
           ) latest ON latest.student_id = r.student_id AND latest.q = r.quarter
          WHERE r.student_id = ANY($1::uuid[]) AND r.school_year_id = $2
          GROUP BY r.student_id, r.rating`,
        [eceIds, syId]
      );
      const distByStudent = new Map();
      for (const row of distRes.rows) {
        const d = distByStudent.get(row.student_id) || { E: 0, G: 0, F: 0, NA: 0 };
        d[row.rating] = row.n;
        distByStudent.set(row.student_id, d);
      }

      for (const s of eceStudents) {
        const bucket = byId.get(s.id);
        if (!bucket) continue;
        bucket._comp = {
          dist:         distByStudent.get(s.id) || { E: 0, G: 0, F: 0, NA: 0 },
          total_skills: totalSkillsByGrade.get(s.grade_level) || 0,
        };
      }
    }

    // 6. Band each student, build the summary, sort worst-first.
    const TOP_ORDER = ['academic', 'competency', 'attendance', 'behavior'];
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

      const attB  = bandAttendance(att_rate ?? 0, bucket._att.total);
      const behB  = bandBehavior(avg_sentiment ?? 0, bucket._beh.count);

      // ECE students swap academic → competency in both the per-row chip and
      // the overall-band calc. Non-ECE students keep the existing flow.
      let acadB = 'insufficient';
      let compB = 'insufficient';
      let competencyMetric = null;
      if (bucket.is_ece && bucket._comp) {
        compB = bandCompetency(bucket._comp.dist, bucket._comp.total_skills);
        const d = bucket._comp.dist;
        const rated = d.E + d.G + d.F + d.NA;
        competencyMetric = {
          rated,
          total_skills: bucket._comp.total_skills,
          completion:   bucket._comp.total_skills > 0
            ? Math.round((rated / bucket._comp.total_skills) * 10000) / 10000
            : 0,
          distribution: d,
          band:         compB,
        };
      } else if (!bucket.is_ece) {
        acadB = bandAcademic(avg_grade);
      }

      const overall = bucket.is_ece
        ? overallBand([compB, attB, behB])
        : overallBand([acadB, attB, behB]);

      // top_concern = worst non-insufficient metric. For ECE students
      // "academic" is never considered; for non-ECE "competency" isn't.
      const perMetric = { academic: acadB, competency: compB, attendance: attB, behavior: behB };
      let top_concern = null;
      let worstRank = -1;
      for (const m of TOP_ORDER) {
        if (bucket.is_ece && m === 'academic') continue;
        if (!bucket.is_ece && m === 'competency') continue;
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
        is_ece:      bucket.is_ece,
        overall_band: overall,
        top_concern,
        metrics: {
          academic: {
            avg_grade:    avg_grade !== null ? Math.round(avg_grade * 10) / 10 : null,
            sample_count: bucket._acad.count,
            band:         acadB,
          },
          competency: competencyMetric, // null for non-ECE
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
router.get('/dashboard-summary', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const result = await axios.get(`${AI_URL}/dashboard/summary`, { timeout: 15000 });
    const payload = result.data;

    // Super admin sees the full school-wide aggregate unchanged.
    if (!isScopedAdmin(req.user.role)) {
      return res.json(payload);
    }

    // Scoped admins (admin_ece / admin_elem): narrow counts to their grade scope.
    const scope = gradeScopeForRole(req.user.role);
    const scopeSet = new Set(scope);

    // Filter enrollment_by_grade + academic_declines by grade.
    if (Array.isArray(payload?.overview?.enrollment_by_grade)) {
      payload.overview.enrollment_by_grade = payload.overview.enrollment_by_grade
        .filter(r => scopeSet.has(r.grade));
    }
    if (Array.isArray(payload?.academic_declines)) {
      payload.academic_declines = payload.academic_declines
        .filter(d => scopeSet.has(d.grade_level));
    }

    // Recount overview.total_students from DB within scope.
    try {
      const totalRes = await query(
        `SELECT COUNT(*)::int AS n FROM students
          WHERE is_active = TRUE AND grade_level = ANY($1::text[])`,
        [scope]
      );
      payload.overview = payload.overview || {};
      payload.overview.total_students = totalRes.rows[0]?.n || 0;
    } catch {}

    // Recompute risk_distribution for the scope by re-hitting the live risk endpoint.
    try {
      const riskRes = await axios.get(`${AI_URL}/classify/risk/all`, { timeout: 15000 });
      const allStudents = riskRes.data?.students || [];
      const scoped = allStudents.filter(s => scopeSet.has(s.grade_level));
      const dist = { stable: 0, moderate_risk: 0, high_risk: 0 };
      for (const s of scoped) {
        if (s.risk_level === 'Stable')             dist.stable++;
        else if (s.risk_level === 'Moderate Risk') dist.moderate_risk++;
        else if (s.risk_level === 'High Risk')     dist.high_risk++;
      }
      payload.risk_distribution = dist;
    } catch {}

    res.json(payload);
  } catch (err) {
    next(new AppError('Could not fetch dashboard summary.', 503));
  }
});

// ─── GET /api/ai/parent-summary/:student_id ───────────────────
// Lightweight single-student rollup for the vista_parent mobile Overview tab.
// Returns risk tier, 30-day attendance rate, quarter grade avg (or ECE quarter
// rated/total), latest behavior sentiment, and unread-notification count.
// Gated with enforceParentLinked so parents only see their own children; staff
// can also call it (handy for QA) since it's read-only and cheap.
const { enforceParentLinked } = require('../middleware/parentScope');
router.get('/parent-summary/:student_id', enforceParentLinked, async (req, res, next) => {
  try {
    const studentId = req.params.student_id;

    const studentRes = await query(
      `SELECT id, full_name, grade_level, section, profile_photo_url,
              academic_access_suspended, academic_access_suspended_reason
         FROM students WHERE id = $1 AND is_active = TRUE`,
      [studentId]
    );
    if (!studentRes.rows.length) throw new AppError('Student not found.', 404);
    const student = studentRes.rows[0];
    const isEce = ['Pre-Nursery', 'Nursery', 'Pre-Kinder', 'Kinder'].includes(student.grade_level);

    const activeSY = await query(
      `SELECT id, label FROM school_years WHERE is_active = TRUE LIMIT 1`
    );
    const syId = activeSY.rows[0]?.id || null;
    const syLabel = activeSY.rows[0]?.label || null;

    // Risk tier + factor breakdown — newest assessment (FastAPI /classify/risk/all
    // could also work, but we prefer the stored value for a cheap single-student
    // read). Factor columns drive the parent-app "What's driving this" section.
    const riskRes = await query(
      `SELECT risk_level, risk_score, assessed_at,
              attendance_factor, academic_factor,
              behavioral_factor, ece_competency_factor
         FROM risk_assessments
        WHERE student_id = $1
        ORDER BY assessed_at DESC LIMIT 1`,
      [studentId]
    );
    const risk = riskRes.rows[0] || null;

    // Attendance rate over the last 30 days. Numerator and denominator are
    // both in days — collapsing per-subject rows via BOOL_OR so a student
    // marked Present/Late in any subject for that day counts as present, and
    // total_days counts distinct calendar days with any record. Without the
    // per-day collapse, multi-subject days inflated present_days against a
    // distinct-date denominator and produced rates above 100%.
    const attRes = await query(
      `WITH per_day AS (
         SELECT date,
                BOOL_OR(status IN ('Present','Late')) AS counted_present
           FROM attendance
          WHERE student_id = $1
            AND date >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY date
       )
       SELECT
         COUNT(*) FILTER (WHERE counted_present)::int AS present_days,
         COUNT(*)::int AS total_days
         FROM per_day`,
      [studentId]
    );
    const { present_days = 0, total_days = 0 } = attRes.rows[0] || {};
    const attendanceRate = total_days > 0 ? Math.round((present_days / total_days) * 1000) / 10 : null;

    // Academic rollup: non-ECE = latest-quarter avg grade; ECE = rated/total for latest quarter.
    let academic = null;
    if (!isEce && syLabel) {
      const gRes = await query(
        `SELECT MAX(quarter) AS q FROM grades WHERE student_id=$1 AND school_year=$2`,
        [studentId, syLabel]
      );
      const q = gRes.rows[0]?.q || null;
      if (q) {
        const avgRes = await query(
          `SELECT AVG(grade)::float AS avg_grade
             FROM grades WHERE student_id=$1 AND school_year=$2 AND quarter=$3`,
          [studentId, syLabel, q]
        );
        academic = {
          quarter: q,
          avg_grade: avgRes.rows[0]?.avg_grade ? Math.round(avgRes.rows[0].avg_grade * 10) / 10 : null,
        };
      }
    } else if (isEce && syId) {
      const qRes = await query(
        `SELECT MAX(quarter) AS q
           FROM ece_competency_records
          WHERE student_id=$1 AND school_year_id=$2`,
        [studentId, syId]
      );
      const q = qRes.rows[0]?.q || null;
      if (q) {
        const distRes = await query(
          `SELECT rating, COUNT(*)::int AS cnt
             FROM ece_competency_records
            WHERE student_id=$1 AND school_year_id=$2 AND quarter=$3
            GROUP BY rating`,
          [studentId, syId, q]
        );
        const dist = { E: 0, G: 0, F: 0, NA: 0 };
        for (const r of distRes.rows) if (r.rating in dist) dist[r.rating] = r.cnt;
        const rated = dist.E + dist.G + dist.F + dist.NA;

        const totalRes = await query(
          `SELECT COUNT(*)::int AS n
             FROM competency_skills cs
             JOIN subjects sub ON sub.id = cs.subject_id
            WHERE cs.is_active = TRUE AND sub.grade_level = $1`,
          [student.grade_level]
        );
        academic = {
          quarter: q,
          rated,
          total_skills: totalRes.rows[0]?.n || 0,
          distribution: dist,
        };
      }
    }

    // Latest behavior observation (any teacher).
    const bRes = await query(
      `SELECT sentiment, sentiment_score, category, observed_at
         FROM behavior_logs
        WHERE student_id=$1
        ORDER BY observed_at DESC LIMIT 1`,
      [studentId]
    );
    const latestBehavior = bRes.rows[0] || null;

    // Unread notifications for the parent (across all their children, not just this one).
    let unreadNotifications = 0;
    if (req.user.role === ROLES.PARENT) {
      const nRes = await query(
        `SELECT COUNT(*)::int AS n FROM notifications
          WHERE recipient_id=$1 AND is_read=FALSE`,
        [req.user.id]
      );
      unreadNotifications = nRes.rows[0]?.n || 0;
    }

    res.json({
      student: {
        id: student.id,
        full_name: student.full_name,
        grade_level: student.grade_level,
        section: student.section,
        profile_photo_url: student.profile_photo_url,
        academic_access_suspended: student.academic_access_suspended,
        academic_access_suspended_reason: student.academic_access_suspended_reason,
      },
      is_ece: isEce,
      risk: risk ? {
        tier: risk.risk_level,
        score: risk.risk_score ? Number(risk.risk_score) : null,
        assessed_at: risk.assessed_at,
        factors: {
          attendance: risk.attendance_factor     != null ? Number(risk.attendance_factor)     : null,
          academic:   risk.academic_factor       != null ? Number(risk.academic_factor)       : null,
          behavioral: risk.behavioral_factor     != null ? Number(risk.behavioral_factor)     : null,
          competency: risk.ece_competency_factor != null ? Number(risk.ece_competency_factor) : null,
        },
      } : null,
      attendance: {
        rate_pct: attendanceRate,
        present_days,
        total_days,
      },
      academic,
      latest_behavior: latestBehavior,
      unread_notifications: unreadNotifications,
    });
  } catch (err) { next(err); }
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