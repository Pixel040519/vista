// ============================================================
// ATTENDANCE ROUTES
// ============================================================
const express = require('express');
const attendanceRouter = express.Router();
const { query } = require('../config/database');
const { authenticate, authorize, authorizeAnyAdmin, enforceGradeScope } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const { ROLES, isAnyAdmin, isScopedAdmin, gradeScopeForRole } = require('../utils/roles');
const { resolveGradingPolicy } = require('../utils/grading');
const { loadAssessment } = require('../utils/assessmentConfig');
const {
  enforceParentLinked,
  rejectIfAcademicSuspended,
} = require('../middleware/parentScope');
// The second source of teacher scope. `teacher_assignments` says which subjects
// a teacher teaches; `sections.adviser_id` says which class they are responsible
// for. Both narrow the three reads below — see utils/advisory.js.
const {
  advisedStudentSql,
  isAdviserOfStudent,
  activeSchoolYear,
} = require('../utils/advisory');
// MAPEH and anything shaped like it: a learning area graded through its areas.
// Reads here count learning areas; only Score Entry works one level down.
const {
  areasOf,
  assertGradeable,
  rollUpAfterGradeWrite,
} = require('../utils/subjectAreas');

// Grade routes serve elementary only — Kinder is assessed descriptively and
// uses the ECE Competency tracker instead of the grades table, so admin_ece is
// rejected here. Parents of linked Grade 1–6 students are allowed (mobile app);
// parents of Kinder pupils simply get no rows (they have no `grades` entries).
const GRADE_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN_ELEM, ROLES.TEACHER, ROLES.PARENT];

/**
 * Attendance is taken against a **learning area**, never one of its areas.
 *
 * MAPEH's four areas each carry their own grade, but a learner sits in one
 * MAPEH period — so one roll. Recording against Music instead would leave four
 * partial registers where there should be one, and every attendance rate
 * derived from them (the risk factor, the parent app's "X of Y days") would be
 * computed off a fraction of the days the learner actually attended.
 */
const assertAttendanceTarget = async (subjectId) => {
  const sub = await query(
    `SELECT s.name, p.name AS parent_name
       FROM subjects s LEFT JOIN subjects p ON p.id = s.parent_id
      WHERE s.id = $1`, [subjectId]);
  if (!sub.rows.length) throw new AppError('Subject not found.', 404);
  if (sub.rows[0].parent_name) {
    throw new AppError(
      `Attendance is recorded for ${sub.rows[0].parent_name} as a whole, not for ` +
      `${sub.rows[0].name} on its own.`, 409);
  }
};

attendanceRouter.use(authenticate);

// Read access for admin + teacher; write access for teacher only below

// GET /api/attendance?student_id=&start_date=&end_date=
attendanceRouter.get('/', enforceParentLinked, async (req, res, next) => {
  try {
    const { student_id, start_date, end_date, sy_id } = req.query;
    if (!student_id) throw new AppError('student_id is required.', 400);

    // `sy_id` is optional and off by default: with no params this still returns
    // every record the learner ever had, which is what Student Detail and the
    // parent app show. It exists so a caller that cares about one school year can
    // ask for it directly instead of guessing from dates.
    const params = [student_id, start_date || null, end_date || null, sy_id || null];
    let teacherFilter = '';
    if (req.user.role === 'teacher') {
      const activeSY = await query(
        `SELECT id, label FROM school_years WHERE is_active=TRUE LIMIT 1`
      );
      const syLabel = activeSY.rows[0]?.label || null;
      const syId    = activeSY.rows[0]?.id || null;
      params.push(req.user.id, syLabel, syId);
      // Two ways a teacher may see a learner's attendance, and they answer
      // different questions. As a **subject teacher** they see the subjects they
      // teach, in every year. As the **class adviser** they see the whole
      // register — every subject, including ones they do not teach — but only
      // for the active year, because that is the year they advise. Widening the
      // adviser side to all years would hand them a learner's entire history off
      // a one-year responsibility.
      teacherFilter = `
         AND (
           sub.name IN (
             SELECT ta.subject
             FROM teacher_assignments ta
             JOIN students st ON st.id = $1
             WHERE ta.teacher_id = $5
               AND ta.grade_level = st.grade_level
               AND ta.section = st.section
               AND ta.school_year = $6
           )
           OR (
             a.school_year_id = $7::uuid
             AND EXISTS (
               SELECT 1 FROM students st WHERE st.id = $1 AND ${advisedStudentSql(5)}
             )
           )
         )`;
    }

    const result = await query(
      `SELECT a.*, u.full_name as recorded_by_name, sub.name as subject_name,
              sy.label as school_year
       FROM attendance a
       LEFT JOIN users u ON u.id = a.recorded_by
       LEFT JOIN subjects sub ON sub.id = a.subject_id
       LEFT JOIN school_years sy ON sy.id = a.school_year_id
       WHERE a.student_id = $1
         AND ($2::date IS NULL OR a.date >= $2::date)
         AND ($3::date IS NULL OR a.date <= $3::date)
         AND ($4::uuid IS NULL OR a.school_year_id = $4::uuid)${teacherFilter}
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
      // Attendance is one roll per learning area per day. MAPEH's areas are
      // graded separately but not attended separately — a learner sits in one
      // MAPEH period, so recording against Music would split the register into
      // four partial ones and make every attendance rate wrong.
      await assertAttendanceTarget(record.subject_id);
      // `school_year_id` is derived from the subject, not from the date. Subjects
      // are scoped per school year, so the subject is the authoritative answer to
      // "which year is this attendance from" -- and the date is not: consecutive
      // school years leave months uncovered between one year's end date and the
      // next one's start, and a record falling in such a gap used to belong to no
      // year at all. Done inline so the upsert stays one statement.
      const result = await query(
        `INSERT INTO attendance (student_id, date, status, remarks, recorded_by, subject_id, school_year_id)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT school_year_id FROM subjects WHERE id = $6))
         ON CONFLICT (student_id, date, subject_id)
         DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks,
                       recorded_by = EXCLUDED.recorded_by, school_year_id = EXCLUDED.school_year_id
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
      // Mirror of the attendance filter above: subject teacher sees their own
      // learning areas in any year, class adviser sees every learning area but
      // only for the year they advise. `grades.school_year` is the year's label,
      // not its id, so the adviser's bound is the label.
      teacherFilter = `
         AND (
           COALESCE(par.name, s.name) IN (
             SELECT ta.subject
             FROM teacher_assignments ta
             JOIN students st ON st.id = $1
             WHERE ta.teacher_id = $3
               AND ta.grade_level = st.grade_level
               AND ta.section = st.section
               AND ta.school_year = $4
           )
           OR (
             g.school_year = $4
             AND EXISTS (
               SELECT 1 FROM students st WHERE st.id = $1 AND ${advisedStudentSql(3)}
             )
           )
         )`;
    }

    // `parent_subject_id` / `parent_subject_name` are non-null on an area
    // (Music under MAPEH) and null on a learning area. Both are returned so a
    // consumer can nest the areas under their learning area — and, crucially,
    // average only the learning areas. Student Detail and the parent app both
    // do exactly that; returning one level only would force a second request.
    const result = await query(
      `SELECT g.*, s.name as subject_name,
              s.parent_id AS parent_subject_id, par.name AS parent_subject_name
       FROM grades g
       JOIN subjects s ON s.id = g.subject_id
       LEFT JOIN subjects par ON par.id = s.parent_id
       WHERE g.student_id = $1
         AND ($2::text IS NULL OR g.school_year = $2)${teacherFilter}
       ORDER BY g.quarter, COALESCE(par.name, s.name), s.parent_id NULLS FIRST, s.name`,
      params
    );

    // Group by grading period. The prefix comes from the school year's own
    // period model (Q1-Q4 for archived years, T1-T3 from SY 2026-2027 on).
    const syRow = await query(
      `SELECT id, label, period_model, grading_policy FROM school_years
        WHERE label = COALESCE($1, (SELECT label FROM school_years WHERE is_active=TRUE LIMIT 1))
        LIMIT 1`,
      [school_year || null]
    );
    const policy = resolveGradingPolicy(syRow.rows[0] || null);

    const byQuarter = result.rows.reduce((acc, row) => {
      const q = policy.abbr(row.quarter);
      if (!acc[q]) acc[q] = [];
      acc[q].push(row);
      return acc;
    }, {});

    res.json({
      grades: result.rows,
      byQuarter,
      period_model: policy.periodModel,
      period_noun: policy.periodNoun,
      periods: policy.periods,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/grades — Submit grades (batch)
//
// `grade` and `remarks` are always derived server-side from the submitted
// initial grade (`score`) using the school year's grading policy. A client may
// not supply a final grade directly — doing so would bypass the DepEd
// transmutation table entirely, which is what this endpoint previously allowed.
gradeRouter.post('/', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN_ELEM, ROLES.TEACHER), async (req, res, next) => {
  try {
    const { records } = req.body; // [{ student_id, subject_id, quarter, school_year, score }]
    if (!Array.isArray(records) || !records.length) {
      throw new AppError('records must be a non-empty array.', 422);
    }

    // Resolve each distinct school year once.
    const policyCache = new Map();
    const policyFor = async (label) => {
      const key = label || '__active__';
      if (policyCache.has(key)) return policyCache.get(key);
      const syRes = await query(
        `SELECT id, label, period_model, grading_policy FROM school_years
          WHERE label = COALESCE($1, (SELECT label FROM school_years WHERE is_active=TRUE LIMIT 1))
          LIMIT 1`,
        [label || null]
      );
      if (!syRes.rows.length) throw new AppError(`Unknown school year "${label}".`, 422);
      const resolved = { row: syRes.rows[0], policy: resolveGradingPolicy(syRes.rows[0]) };
      policyCache.set(key, resolved);
      return resolved;
    };

    const inserted = [];
    for (const r of records) {
      if (!r.student_id || !r.subject_id) {
        throw new AppError('student_id and subject_id are required on every record.', 422);
      }
      // A learning area graded through its areas has no grade of its own to
      // submit — its grade is the average of the areas, written by the roll-up
      // below. Accepting one here would let a hand-entered MAPEH grade sit until
      // the next area was saved and then silently vanish.
      await assertGradeable(r.subject_id);
      const initial = Number(r.score);
      if (!Number.isFinite(initial) || initial < 0 || initial > 100) {
        throw new AppError('score must be a number between 0 and 100.', 422);
      }

      const { row: syRow, policy } = await policyFor(r.school_year);
      const period = Number(r.quarter);
      if (!policy.periods.includes(period)) {
        throw new AppError(
          `${policy.periodNoun} ${r.quarter} is not valid for SY ${syRow.label} — it runs ${policy.periodCount} ${policy.periodNoun.toLowerCase()}s.`,
          422
        );
      }

      const rounded = Math.round(initial * 100) / 100;
      const finalGrade = policy.transmute(rounded);
      const remarks = policy.remarksFor(finalGrade);

      const result = await query(
        `INSERT INTO grades (student_id, subject_id, quarter, school_year, score, grade, remarks, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (student_id, subject_id, quarter, school_year)
         DO UPDATE SET score = EXCLUDED.score, grade = EXCLUDED.grade,
                       remarks = EXCLUDED.remarks, updated_at = NOW()
         RETURNING *`,
        [r.student_id, r.subject_id, period, syRow.label, rounded, finalGrade, remarks, req.user.id]
      );
      inserted.push(result.rows[0]);

      // Roll the write up into its learning area when the subject is an area.
      await rollUpAfterGradeWrite(null, {
        student_id: r.student_id, subject_id: r.subject_id, quarter: period,
        school_year: syRow.label, policy, recorded_by: req.user.id,
      });
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

    // Teacher authorization: must have matching assignment (admin bypasses).
    // One teacher handles a whole learning area, so an area (Music) is assigned
    // under its parent's name (MAPEH) — see verifyTeacherAssignment().
    if (req.user.role === 'teacher') {
      const subjectRow = await query(
        `SELECT COALESCE(p.name, s.name) AS name FROM subjects s
           LEFT JOIN subjects p ON p.id = s.parent_id WHERE s.id=$1`, [subject_id]);
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
         AND enrollment_status='enrolled'
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

    // 3. Subject name, plus what it is: an area names its learning area, and a
    // learning area names the areas its grade is averaged from. The Grades page
    // uses both to caption the sheet and to explain a blank cell.
    const subjectResult = await query(
      `SELECT s.name, s.parent_id, p.name AS parent_name FROM subjects s
         LEFT JOIN subjects p ON p.id = s.parent_id WHERE s.id=$1`, [subject_id]);
    const subject_name  = subjectResult.rows[0]?.name || '';
    const parent_name   = subjectResult.rows[0]?.parent_name || null;
    const areas         = (await areasOf(subject_id)).map(a => ({ id: a.id, name: a.name }));

    // 3b. For a learning area graded through areas, the grade in each area for
    // the same class. The roll-up sheet says what MAPEH's grade *is*; this says
    // what it was averaged from, which is the summary the Grades page shows
    // beside it. One extra query on a page that already knows the area ids —
    // the alternative was four more round trips from the client.
    const area_grades = {};
    if (areas.length && studentIds.length) {
      const areaResult = await query(
        `SELECT student_id, subject_id, quarter, grade
         FROM grades
         WHERE subject_id = ANY($1) AND school_year=$2 AND student_id = ANY($3)`,
        [areas.map(a => a.id), school_year, studentIds]
      );
      for (const row of areaResult.rows) {
        if (!area_grades[row.student_id]) area_grades[row.student_id] = {};
        if (!area_grades[row.student_id][row.subject_id]) area_grades[row.student_id][row.subject_id] = {};
        area_grades[row.student_id][row.subject_id][row.quarter] =
          row.grade != null ? parseFloat(row.grade) : null;
      }
    }

    // 4. Teacher name
    const teacherResult = await query(
      `SELECT u.surname, u.first_name, u.middle_name
       FROM teacher_assignments ta
       JOIN users u ON u.id = ta.teacher_id
       WHERE ta.grade_level=$1 AND ta.section=$2 AND ta.subject=$3 AND ta.school_year=$4
       LIMIT 1`,
      [grade_level, section, parent_name || subject_name, school_year]
    );
    const t = teacherResult.rows[0];
    const teacher_name = t ? `${t.surname}, ${t.first_name}${t.middle_name ? ' ' + t.middle_name : ''}` : null;

    res.json({ students, grades: gradesMap, subject_name, teacher_name, parent_name, areas, area_grades });
  } catch (err) {
    next(err);
  }
});

// GET /api/grades/class-record?grade_level=&section=&school_year=
//
// Every learning area for one class in one request — the Grades page's
// "All subjects" view, and the learner record it opens. Per-period grades are
// returned rather than finals so the client can show any period, or the final,
// without another round trip; the finals and the general average are
// `finalGradeFrom()` over them, exactly as the by-subject sheet computes them.
//
// Admin-only. A subject teacher sees one column of a class, and the adviser's
// cross-subject view is `/api/advisory/grades`, bounded to their own section.
gradeRouter.get('/class-record', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN_ELEM), async (req, res, next) => {
  try {
    const { grade_level, section, school_year } = req.query;
    if (!grade_level || !section || !school_year)
      throw new AppError('grade_level, section, and school_year are all required.', 400);
    enforceGradeScope(req, grade_level);

    const syRes = await query(
      `SELECT id, label, period_model, grading_policy FROM school_years WHERE label=$1 LIMIT 1`,
      [school_year]
    );
    const sy = syRes.rows[0];
    if (!sy) throw new AppError(`Unknown school year "${school_year}".`, 404);

    // A descriptive grade level has no numeric grades to lay out.
    const assessment = await loadAssessment(sy.id, grade_level);
    if (assessment.isDescriptive) {
      throw new AppError(
        `${grade_level} is assessed descriptively in SY ${sy.label} — its ratings are in ECE Competency.`,
        400
      );
    }

    // The same roster as /by-subject, so both views of a class list the same learners.
    const students = (await query(
      `SELECT id, lrn, surname, first_name, middle_name, gender
       FROM students
       WHERE grade_level=$1 AND section=$2 AND is_active=TRUE
         AND enrollment_status='enrolled'
       ORDER BY gender DESC NULLS LAST, surname, first_name`,
      [grade_level, section]
    )).rows;
    const ids = students.map(s => s.id);

    // Every grade row for the year — learning areas and their areas alike. The
    // areas are only ever shown beneath their learning area; nothing here adds
    // them to it, since the learning area's own row already holds the roll-up.
    const gradeRows = ids.length
      ? (await query(
          `SELECT g.student_id, g.subject_id, g.quarter, g.grade,
                  sub.name, sub.parent_id, sub.grade_level
             FROM grades g
             JOIN subjects sub ON sub.id = g.subject_id
            WHERE g.student_id = ANY($1::uuid[])
              AND g.school_year = $2`,
          [ids, sy.label]
        )).rows
      : [];

    // Columns are the grade level's learning areas plus any learning area the
    // learners actually hold a grade in this year, flagged `off_level` — the
    // same rule as /api/advisory/grades, for the same reason: a learner moved
    // mid-year has grades against another level's subjects, and dropping them
    // would make the sheet read as ungraded.
    const levelSubjects = (await query(
      `SELECT id, name FROM subjects
        WHERE grade_level=$1 AND school_year_id=$2 AND is_active=TRUE
          AND parent_id IS NULL
        ORDER BY name`,
      [grade_level, sy.id]
    )).rows;
    const columns = levelSubjects.map(s => ({ id: s.id, name: s.name, off_level: false, grade_level }));
    const known = new Set(columns.map(c => c.id));
    const missingParents = new Set();
    for (const r of gradeRows) {
      if (r.parent_id) {
        if (!known.has(r.parent_id)) missingParents.add(r.parent_id);
        continue;
      }
      if (known.has(r.subject_id)) continue;
      known.add(r.subject_id);
      columns.push({ id: r.subject_id, name: r.name, off_level: true, grade_level: r.grade_level });
    }
    // An off-level area whose learning area holds no grade yet (a partial MAPEH
    // set is withheld) still names its learning area as a column.
    if (missingParents.size) {
      const parents = await query(
        `SELECT id, name, grade_level FROM subjects WHERE id = ANY($1::uuid[])`,
        [[...missingParents]]
      );
      for (const p of parents.rows) {
        if (known.has(p.id)) continue;
        known.add(p.id);
        columns.push({ id: p.id, name: p.name, off_level: true, grade_level: p.grade_level });
      }
    }

    const areaRows = columns.length
      ? (await query(
          `SELECT id, name, parent_id FROM subjects
            WHERE parent_id = ANY($1::uuid[]) AND is_active = TRUE
            ORDER BY name`,
          [columns.map(c => c.id)]
        )).rows
      : [];
    const subjects = columns.map(c => ({
      ...c,
      areas: areaRows.filter(a => a.parent_id === c.id).map(a => ({ id: a.id, name: a.name })),
    }));

    // student_id -> subject_id -> period -> grade
    const grades = {};
    for (const r of gradeRows) {
      if (r.grade == null) continue;
      ((grades[r.student_id] ??= {})[r.subject_id] ??= {})[r.quarter] = parseFloat(r.grade);
    }

    const adviser = (await query(
      `SELECT u.surname, u.first_name, u.middle_name
         FROM sections sec
         JOIN users u ON u.id = sec.adviser_id
        WHERE sec.school_year_id=$1 AND sec.grade_level=$2 AND sec.name=$3 AND sec.is_active=TRUE
        LIMIT 1`,
      [sy.id, grade_level, section]
    )).rows[0];
    const adviser_name = adviser
      ? `${adviser.surname}, ${adviser.first_name}${adviser.middle_name ? ' ' + adviser.middle_name : ''}`
      : null;

    res.json({ students, subjects, grades, adviser_name });
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
        AND st.is_active = TRUE
        AND st.enrollment_status = 'enrolled'
      LIMIT 1`,
    [studentId, teacherId, syLabel]
  );
  return r.rows.length > 0;
};

// GET /api/behavior
// Teacher: requires student_id, scoped to own logs for students in own classes.
// Parent:  requires student_id; must be linked to the student (enforceParentLinked).
// Admin:   student_id optional; supports teacher_id, category, sentiment, date_from, date_to,
//          school_year_id, limit, offset.
behaviorRouter.get('/', enforceParentLinked, async (req, res, next) => {
  try {
    const isAdmin = isAnyAdmin(req.user.role);
    const {
      student_id, teacher_id, category, sentiment,
      date_from, date_to, grade_level, section, school_year_id,
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
    // The year a log was stamped with on write — never inferred from the date.
    if (school_year_id) add('bl.school_year_id = ?::uuid', school_year_id);

    if (req.user.role === 'teacher') {
      // Two independent ways in, and they grant different things.
      //
      // A **subject teacher** sees only the logs they wrote themselves. A
      // **class adviser** sees every teacher's logs for their advisory learners,
      // because conduct is the adviser's responsibility and a record made of
      // only their own observations would be worse than none — it would look
      // complete while missing whatever the other teachers saw. This is the one
      // read in the app where a teacher sees another teacher's writing.
      //
      // The adviser's reach is bounded to the active year (they advise this
      // year, not the learner's whole past); their own logs stay visible across
      // every year, as before.
      const owns    = await teacherOwnsStudent(req.user.id, student_id);
      const advises = await isAdviserOfStudent(req.user.id, student_id);
      // StudentDetail hits this for any student, so fall back to empty rather
      // than 403 — the page must not break on a learner the teacher has no
      // relationship with.
      if (!owns && !advises) return res.json({ logs: [], total: 0 });

      if (advises) {
        const sy = await activeSchoolYear();
        params.push(req.user.id, sy?.id || null);
        where.push(`(bl.teacher_id = $${params.length - 1} OR bl.school_year_id = $${params.length}::uuid)`);
      } else {
        add('bl.teacher_id = ?', req.user.id);
      }
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
             sy.label AS school_year,
             s.first_name, s.middle_name, s.surname, s.lrn,
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
        LEFT JOIN school_years sy ON sy.id = bl.school_year_id
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

// GET /api/behavior/class-roster — the teacher's Behavior page roster.
// Every learner in one of the caller's classes, each with the tally of the logs
// `GET /api/behavior` would show them for that learner. Visibility is the same
// rule, applied class-wide: the teacher's own logs from any year, plus every
// teacher's logs for this year when they also advise the section. Keeping the
// two in step is what stops a roster count disagreeing with the timeline it opens.
behaviorRouter.get('/class-roster', authorize('teacher'), async (req, res, next) => {
  try {
    const { grade_level, section } = req.query;
    if (!grade_level || !section) {
      throw new AppError('grade_level and section are required.', 400);
    }

    const sy = await activeSchoolYear();
    const access = await query(
      `SELECT
         EXISTS (SELECT 1 FROM teacher_assignments ta
                  WHERE ta.teacher_id = $1 AND ta.grade_level = $2
                    AND ta.section = $3 AND ta.school_year = $4) AS teaches,
         EXISTS (SELECT 1 FROM sections sec
                  WHERE sec.adviser_id = $1 AND sec.grade_level = $2
                    AND sec.name = $3 AND sec.is_active = TRUE
                    AND sec.school_year_id = $5::uuid) AS advises`,
      [req.user.id, grade_level, section, sy?.label || null, sy?.id || null]
    );
    const { teaches, advises } = access.rows[0];
    if (!teaches && !advises) {
      throw new AppError('You are not assigned to this class.', 403);
    }

    // Same roster predicate as every other class list (see advisoryClassList).
    const r = await query(
      `SELECT st.id, st.lrn, st.surname, st.first_name, st.middle_name,
              COUNT(bl.id)::int                                          AS total,
              COUNT(bl.id) FILTER (WHERE bl.sentiment = 'Positive')::int AS positive,
              COUNT(bl.id) FILTER (WHERE bl.sentiment = 'Neutral')::int  AS neutral,
              COUNT(bl.id) FILTER (WHERE bl.sentiment = 'Negative')::int AS negative,
              MAX(bl.observed_at)                                        AS last_observed_at
         FROM students st
         LEFT JOIN behavior_logs bl
           ON bl.student_id = st.id
          AND (bl.teacher_id = $1 OR ($4 AND bl.school_year_id = $5::uuid))
        WHERE st.grade_level = $2 AND st.section = $3
          AND st.is_active = TRUE AND st.enrollment_status = 'enrolled'
        GROUP BY st.id
        ORDER BY st.surname, st.first_name`,
      [req.user.id, grade_level, section, advises, sy?.id || null]
    );

    res.json({ students: r.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/behavior/summary — admin-only aggregate counts for the current filters.
behaviorRouter.get('/summary', authorizeAnyAdmin, async (req, res, next) => {
  try {
    const {
      student_id, teacher_id, category, sentiment,
      date_from, date_to, grade_level, section, school_year_id,
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
    // The year a log was stamped with on write — never inferred from the date.
    if (school_year_id) add('bl.school_year_id = ?::uuid', school_year_id);
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
         (student_id, teacher_id, observation, category, sentiment, sentiment_score, observed_at,
          school_year_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
          (SELECT id FROM school_years WHERE is_active = TRUE LIMIT 1))
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
