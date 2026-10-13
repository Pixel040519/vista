// Put a small fake school into the database for a demo, or take it out again.
//
//   cd vista-backend/node-api
//   node scripts/seedSyntheticStudents.js                    # dry run: say what would be written
//   node scripts/seedSyntheticStudents.js --apply            # write it
//   node scripts/seedSyntheticStudents.js --remove           # dry run: say what would be deleted
//   node scripts/seedSyntheticStudents.js --remove --apply   # delete every fake learner
//   node scripts/seedSyntheticStudents.js --file <path>      # another demo_school.json
//
// The learners come from fastapi-ai/data/synthetic/demo_school.json, written by
// fastapi-ai/scripts/generate_synthetic.py — the same generator the AI models are
// trained on, so the demo shows the models data shaped like what they learned
// from. This script only places that school into the ACTIVE school year: it adds
// learners to existing sections and grades them against existing subjects. It
// never creates curriculum, and refuses when the year has none.
//
// What it writes, per learner: the student, an enrolled `student_enrollments`
// row for the active year, period grades (MAPEH through its four areas, rolled up
// by utils/subjectAreas.js exactly as a teacher's save would), one attendance
// roll per learning area per school day, VADER-scored behaviour notes, and for
// Kinder, competency ratings against the skills that year already has. Dates are
// counted back from today in school days, so the AI service's "last 30 days" and
// "this month" windows land on them.
//
// Every fake learner carries two marks — an LRN starting 999999 and the home
// address below — and --remove deletes only rows carrying both. Their grades,
// attendance, notes, ratings and enrolment go with them (all cascade from
// students). Refuses to run when NODE_ENV=production.

const { envPath } = require('../src/config/env');
require('dotenv').config({ path: envPath });

const fs = require('fs');
const path = require('path');
const { pool, withTransaction } = require('../src/config/database');
const { resolveGradingPolicy } = require('../src/utils/grading');
const { rollUp } = require('../src/utils/subjectAreas');

const LRN_PREFIX = '999999';
const MARKER = 'SYNTHETIC DEMO LEARNER (scripts/seedSyntheticStudents.js)';
const DEFAULT_FILE = path.resolve(__dirname, '..', '..', 'fastapi-ai', 'data', 'synthetic', 'demo_school.json');
const IS_SYNTHETIC = `lrn LIKE '${LRN_PREFIX}%' AND home_address = $1`;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REMOVE = args.includes('--remove');
const fileArg = args.indexOf('--file');
const FILE = fileArg >= 0 ? path.resolve(args[fileArg + 1]) : DEFAULT_FILE;

const lrnFor = (ref) => `${LRN_PREFIX}${String(ref).padStart(6, '0')}`;
const iso = (d) => d.toISOString().slice(0, 10);

// The last `n` weekdays ending today (or the last Friday on a weekend), oldest first.
function schoolDays(n) {
  const days = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  while (days.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(new Date(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return days.reverse();
}

async function remove() {
  const { rows: [c] } = await pool.query(
    `SELECT COUNT(*)::int AS learners,
            (SELECT COUNT(*)::int FROM grades WHERE student_id IN (SELECT id FROM students WHERE ${IS_SYNTHETIC})) AS grades,
            (SELECT COUNT(*)::int FROM attendance WHERE student_id IN (SELECT id FROM students WHERE ${IS_SYNTHETIC})) AS attendance,
            (SELECT COUNT(*)::int FROM behavior_logs WHERE student_id IN (SELECT id FROM students WHERE ${IS_SYNTHETIC})) AS behaviour,
            (SELECT COUNT(*)::int FROM ece_competency_records WHERE student_id IN (SELECT id FROM students WHERE ${IS_SYNTHETIC})) AS ratings
       FROM students WHERE ${IS_SYNTHETIC}`, [MARKER]);
  console.log(`Fake learners:      ${c.learners}`);
  console.log(`  grades:           ${c.grades}`);
  console.log(`  attendance:       ${c.attendance}`);
  console.log(`  behaviour notes:  ${c.behaviour}`);
  console.log(`  competency:       ${c.ratings}`);
  if (!c.learners) return console.log('\nNothing to remove.');
  if (!APPLY) return console.log('\nDry run: nothing was deleted. Re-run with --remove --apply.');
  const res = await pool.query(`DELETE FROM students WHERE ${IS_SYNTHETIC}`, [MARKER]);
  console.log(`\nDeleted ${res.rowCount} fake learners and everything recorded for them.`);
}

async function seed() {
  if (!fs.existsSync(FILE)) {
    throw new Error(`${FILE} not found. Run fastapi-ai/scripts/generate_synthetic.py first.`);
  }
  const demo = JSON.parse(fs.readFileSync(FILE, 'utf8'));

  const { rows: [sy] } = await pool.query(
    `SELECT id, label, period_model, grading_policy FROM school_years WHERE is_active = TRUE LIMIT 1`);
  if (!sy) throw new Error('No active school year. Activate one on the Curriculum page first.');
  const periods = resolveGradingPolicy(sy).periodCount;
  const periodsDone = Math.min(demo.periods_done, periods);
  if (periodsDone < demo.periods_done) {
    console.warn(`  ${sy.label} has ${periods} periods; writing grades for ${periodsDone}, not ${demo.periods_done}.`);
  }

  const { rows: [existing] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM students WHERE ${IS_SYNTHETIC}`, [MARKER]);
  if (existing.n) throw new Error(`${existing.n} fake learners are already in the database. Run with --remove --apply first.`);
  const lrns = demo.learners.map(l => lrnFor(l.ref));
  const { rows: clash } = await pool.query(`SELECT lrn FROM students WHERE lrn = ANY($1::text[])`, [lrns]);
  if (clash.length) throw new Error(`LRN ${clash[0].lrn} already belongs to a real learner; refusing to touch it.`);

  // Curriculum per grade level, read once.
  const grades = [...new Set(demo.learners.map(l => l.grade_level))];
  const curriculum = {};
  for (const gl of grades) {
    const { rows: subjects } = await pool.query(
      `SELECT id, name, parent_id FROM subjects
        WHERE school_year_id = $1 AND grade_level = $2 AND is_active = TRUE`, [sy.id, gl]);
    const { rows: sections } = await pool.query(
      `SELECT name FROM sections WHERE school_year_id = $1 AND grade_level = $2 AND is_active = TRUE ORDER BY name`,
      [sy.id, gl]);
    const { rows: skills } = await pool.query(
      `SELECT cs.id FROM competency_skills cs JOIN subjects s ON s.id = cs.subject_id
        WHERE s.school_year_id = $1 AND s.grade_level = $2 AND cs.is_active = TRUE AND s.is_active = TRUE
        ORDER BY s.name, cs.display_order, cs.name`, [sy.id, gl]);
    const { rows: [assess] } = await pool.query(
      `SELECT rating_scale FROM grade_level_assessment WHERE school_year_id = $1 AND grade_level = $2`, [sy.id, gl]);
    curriculum[gl] = {
      byName: new Map(subjects.map(s => [s.name.trim().toLowerCase(), s])),
      // Attendance is one roll per learning area (never per MAPEH area).
      learningAreas: subjects.filter(s => !s.parent_id),
      parents: [...new Set(subjects.filter(s => s.parent_id).map(s => s.parent_id))],
      sections: sections.map(s => s.name),
      skills: skills.map(s => s.id),
      // The generator rates on E/G/F/NA; a level configured on another scale is skipped.
      ratingScaleOk: !assess || !assess.rating_scale || assess.rating_scale === 'EGFNA',
    };
    if (!subjects.length) throw new Error(`${sy.label} has no ${gl} subjects. Set up the curriculum first.`);
  }

  const days = schoolDays(demo.attendance_days);
  const skipped = new Set();
  const plan = demo.learners.map((l, i) => {
    const c = curriculum[l.grade_level];
    const gradeRows = [];
    for (const [name, values] of Object.entries(l.grades)) {
      const subject = c.byName.get(name.toLowerCase());
      if (!subject) { skipped.add(`${l.grade_level} ${name}`); continue; }
      values.slice(0, periodsDone).forEach((g, q) => gradeRows.push([subject.id, q + 1, g]));
    }
    const ratings = [];
    if (c.ratingScaleOk) {
      l.competency.slice(0, periodsDone).forEach((codes, q) =>
        c.skills.forEach((skillId, k) => ratings.push([skillId, q + 1, codes[k % codes.length]])));
    }
    const offset = days.length - l.attendance.length;
    return {
      ...l,
      lrn: lrnFor(l.ref),
      section: c.sections.length ? c.sections[i % c.sections.length] : null,
      dob: `${new Date().getUTCFullYear() - l.age}-${String(1 + (l.ref % 12)).padStart(2, '0')}-${String(1 + (l.ref % 28)).padStart(2, '0')}`,
      gradeRows,
      ratings,
      attendanceRows: l.attendance.flatMap((status, d) =>
        c.learningAreas.map(s => [iso(days[offset + d]), status, s.id])),
      notes: l.behaviour
        .filter(b => b.day_offset < days.length)
        .map(b => ({ ...b, at: `${iso(days[days.length - 1 - b.day_offset])} ${String(8 + (b.day_offset % 7)).padStart(2, '0')}:30` })),
    };
  });

  const count = (k) => plan.reduce((n, p) => n + p[k].length, 0);
  const mix = plan.reduce((m, p) => ({ ...m, [p.simulated_outcome]: (m[p.simulated_outcome] || 0) + 1 }), {});
  console.log(`Active school year:  ${sy.label} (${sy.period_model}, ${periodsDone} period(s) graded)`);
  console.log(`Fake learners:       ${plan.length}`);
  for (const gl of grades) {
    const n = plan.filter(p => p.grade_level === gl).length;
    const secs = curriculum[gl].sections;
    console.log(`  ${gl.padEnd(8)} ${String(n).padStart(3)}  in ${secs.length ? secs.join(', ') : 'no section (this year has none)'}`);
  }
  console.log(`Grade rows:          ${count('gradeRows')}  (+ MAPEH rolled up from its areas)`);
  console.log(`Attendance rows:     ${count('attendanceRows')}  (${days.length} school days, ${iso(days[0])} to ${iso(days[days.length - 1])})`);
  console.log(`Behaviour notes:     ${count('notes')}`);
  console.log(`Competency ratings:  ${count('ratings')}`);
  console.log(`How their years were simulated to end: ${Object.entries(mix).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (skipped.size) console.warn(`  Not in this year's curriculum, skipped: ${[...skipped].join('; ')}`);
  if (!APPLY) return console.log('\nDry run: nothing was written. Re-run with --apply.');

  const policyFor = Object.fromEntries(grades.map(gl => [gl, resolveGradingPolicy(sy, gl)]));
  await withTransaction(async (client) => {
    for (const p of plan) {
      const { rows: [st] } = await client.query(
        `INSERT INTO students (lrn, surname, first_name, middle_name, date_of_birth, gender,
                               grade_level, section, home_address, enrollment_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'enrolled') RETURNING id`,
        [p.lrn, p.surname, p.first_name, p.middle_name, p.dob, p.gender, p.grade_level, p.section, MARKER]);
      await client.query(
        `INSERT INTO student_enrollments (student_id, school_year_id, grade_level, section, status)
         VALUES ($1,$2,$3,$4,'enrolled')`, [st.id, sy.id, p.grade_level, p.section]);

      const policy = policyFor[p.grade_level];
      for (const [subjectId, quarter, grade] of p.gradeRows) {
        await client.query(
          `INSERT INTO grades (student_id, subject_id, quarter, school_year, grade, remarks)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [st.id, subjectId, quarter, sy.label, grade, policy.remarksFor(grade)]);
      }
      for (const parentId of curriculum[p.grade_level].parents) {
        for (let q = 1; q <= periodsDone; q++) {
          await rollUp(client, { student_id: st.id, parent_id: parentId, quarter: q, school_year: sy.label, policy });
        }
      }

      if (p.attendanceRows.length) {
        await client.query(
          `INSERT INTO attendance (student_id, date, status, subject_id, school_year_id)
           SELECT $1, d::date, s, sub::uuid, $5
             FROM unnest($2::text[], $3::text[], $4::text[]) AS t(d, s, sub)`,
          [st.id, p.attendanceRows.map(r => r[0]), p.attendanceRows.map(r => r[1]),
            p.attendanceRows.map(r => r[2]), sy.id]);
      }
      for (const n of p.notes) {
        await client.query(
          `INSERT INTO behavior_logs (student_id, observation, category, sentiment, sentiment_score,
                                      ai_sentiment, ai_sentiment_score, observed_at, school_year_id)
           VALUES ($1,$2,$3,$4,$5,$4,$5,$6,$7)`,
          [st.id, n.text, n.category, n.sentiment, n.score, n.at, sy.id]);
      }
      for (const [skillId, quarter, rating] of p.ratings) {
        await client.query(
          `INSERT INTO ece_competency_records (student_id, skill_id, school_year_id, quarter, rating, rating_scale)
           VALUES ($1,$2,$3,$4,$5,'EGFNA')`, [st.id, skillId, sy.id, quarter, rating]);
      }
    }
  });
  console.log(`\nWrote ${plan.length} fake learners into ${sy.label}. Remove them with --remove --apply.`);
}

(async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run with NODE_ENV=production: this script writes fake learners.');
    process.exit(1);
  }
  try {
    await (REMOVE ? remove() : seed());
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
