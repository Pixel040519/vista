# FastAPI AI Service — CLAUDE.md

Entry point `main.py`. Port 8000. Role-agnostic — all access control lives in the Node proxy (`ai.routes.js`).

## Routers

- `/analyze` — VADER sentiment analysis of teacher behaviour observations. Stock VADER
  was built on social-media text and scored most classroom writing as exactly 0 —
  "follows instructions", "cooperates", and even "bullies" and "refuses" (it does no
  stemming; only "bully" and "refused" are in its lexicon). `services/behavior_lexicon.py`
  fixes that without replacing VADER: `install()` adds school vocabulary (every
  inflection listed, VADER's -4..+4 scale) plus frequency boosters, and `rewrite()`
  turns phrases VADER misreads into ones its negation handles — "refuses to X",
  "lacks X", "needs to X", "stopped Xing", "without help". The rewritten text is only
  scored, never stored or returned. Score through `polarity()` in `routers/sentiment.py`,
  not `analyzer.polarity_scores()` directly, or the rewrites are skipped. The label's
  neutral band is ±0.1 (was ±0.2, where a single mild word lands); risk and class-health
  read the raw compound, so only the label depends on it. Leave context-dependent words
  out of the lexicon (the module docstring lists them) — a teacher override is the
  answer for those, not a guess.

  **After changing the lexicon, the rewrites or the neutral band, run
  `scripts/rescore_behavior.py`** (dry run; `--apply` to write). Saved logs keep the
  reading they got on the day, so without it old and new logs are scored by different
  rules. It imports `polarity()` and `compound_to_sentiment()` rather than calling the
  endpoint, so the result is exactly what re-saving would give, and needs neither
  FastAPI nor Node running. It skips every log with `sentiment_overridden = TRUE` —
  label, score and the recorded suggestion all stay as the teacher left them — and
  fills in logs saved while the analyzer was down (NULL `ai_sentiment`).
- `/predict` — grade prediction via the trained Linear Regression in `ml/grade_model.py` (see "Trained models" below), falling back to the old per-learner curve (`predict_grades()`) when `models/grade_lr.json` is unusable. Each prediction carries `margin` (the model's test RMSE, one and two periods ahead) and the response `model_version` (`lr-synth-v1` or `curve-v1`). The forecast wraps at the **school year's own period count** (`SELECT period_model FROM school_years WHERE is_active`), not a hardcoded 4 — DepEd moved to three terms in DO 009, s. 2026.
- `/classify` — risk assessment through `assess()` in `routers/risk.py`: the trained Naive Bayes model (`ml/risk_model.py`) when `models/risk_nb.json` is usable, `rule_based_risk()` otherwise. Both endpoints report which in `model_version` (`nb-synth-v2` / `rule-v1.1`), and `POST` persists it to `risk_assessments.model_version`. `POST /classify/risk` classifies one student and persists the row to `risk_assessments` (audit trail). `GET /classify/risk/all` is **live-computed**: it aggregates attendance (last 30d) / grades (each learning area's latest grade in the active SY) / behavior (this month) / ECE competency (latest quarter in active SY) directly from the source tables for every active student — it does NOT read `risk_assessments`. That means every active student appears immediately without needing a manual classify call. Response includes `attendance_factor`, `academic_factor`, `behavioral_factor`, `ece_competency_factor`, and a derived `top_factor`. Competency is the 4th factor, computed from the latest-quarter rating average. **The academic inputs come from `academic_summary()` over `ACADEMIC_SQL`, shared by both paths**, and are restricted to the **active school year** (quarter numbers restart every year; grouping by quarter alone used to average last year's Q2 into this year's). `avg_grade` is the average of each learning area's **latest** grade — not of the latest quarter, which is usually incomplete because teachers enter grades at different times, and judged a learner on whichever subject was entered first. `grade_trend` is the average change over learning areas graded in **both** of the last two consecutive periods, and only when at least two of them, covering half the learner's graded areas, have both — averaging two quarters with different subjects in them invented rises and falls no subject had. `academic_detail` (count, failing learning areas, steepest drop) rides along for the factor sentences and is not a model input.

  **Rating scales**: ratings are weighted through `RATING_SCALE_WEIGHTS` in `routers/risk.py`, keyed on `(rating_scale, rating)` — a mirror of `RATING_SCALES` in the Node `utils/grading.js`. `EGFNA` still gives E=1.0 / G=0.75 / F=0.5 / NA=0.25, plus `CODVBG` (DO 015 Kindergarten) and `ABCDE` (DO 015 Grades 1-3). **Never look a rating up without its scale**: `'E'` is Excellent on E/G/F/NA but Emerging — the worst level — on A-E, so a scale-blind lookup scores a failing learner as perfect. The bulk endpoint's SQL `CASE` is generated by `_rating_case_sql()` from that same table so it cannot drift.

  **No grade-level list** (in `risk.py`): `ECE_GRADE_LEVELS` was removed. Which grade levels are assessed descriptively is configuration owned by the Node API (`grade_level_assessment`), and this service stays config-agnostic — it simply follows the data, since only descriptive learners have `ece_competency_records` rows at all. A numeric learner returns no rows and the factor stays `None`. `top_factor` ranks by risk *deficit* (1−value for att/acad/comp; `max(0, −sentiment)` for beh) and skips `None` factors.
- `/dashboard` — aggregated stats. Attendance counts use **distinct students**, not raw records, with priority **Present > Late > Excused > Absent** when a student has multiple subject records for a day.
- `/teacher-dashboard` (`routers/teacher_dashboard.py`) — teacher-scoped summary. Takes `teacher_id` + `sy_label` query params. Returns assignments, today's attendance per assignment, my-students rollup, risk distribution, students-to-watch, score-entry progress, recent behavior, ECE student count. This module holds the **only** hardcoded grade-level list left in the service — `ECE_GRADES = {"Kinder"}`, used solely to compute the `ece_count` tile. It is a display counter, not a policy decision, so it was left as a constant rather than routed through `grade_level_assessment`; if a second grade level ever goes descriptive, this counter is what goes stale first.

### `score_entry_progress` (in `/teacher-dashboard`)

Array is **unrolled per `(gradeable subject, section)`** in Python — see "Composite
learning areas" below: a MAPEH assignment yields four rows, one per area, labelled
`MAPEH — Music` and so on, because that is where the score items actually live.
SQL aggregates per `(subject_id, section)` because `score_items` are section-scoped. `components_total` is still subject-wide (pulled from `grading_structure`). `total_items` and `components_with_items` are scoped to `latest_quarter` (the highest-numbered quarter with any items for that subject+section) — adding items in a new quarter resets those counters to reflect just that quarter's progress.

## Composite learning areas (MAPEH)

`subjects.parent_id` makes a subject an **area** of another: MAPEH is graded through
Music, Arts, Physical Education and Health, each a subject row with its own grading
structure and score items. The MAPEH grade is a **derived row stored in `grades`
alongside the areas'** — written by the Node API (`utils/subjectAreas.js`), never
here. See the root `CLAUDE.md` for the model.

The consequence for this service is one line per query, and it goes in **both
directions**:

**Reads of `grades` count learning areas.** Every one of them joins `subjects` and
filters `parent_id IS NULL`, or MAPEH is weighed five times over — once as itself
and once per area:

- `risk.py` — the academic factor and grade trend, in `ACADEMIC_SQL`, which both
  the single-student path and the bulk `GET /classify/risk/all` share. The filter
  sits inside the `ranked` CTE, so "each learning area's latest grade" is decided
  only among learning areas — never by an area row the average then excludes.
- `prediction.py` — one forecast per learning area. An explicit `subject_id` still
  wins, so a single area can be forecast on request; it is only the "all subjects"
  default that narrows.
- `dashboard.py` — academic decline alerts, inside the `ranked` CTE. Without it a
  MAPEH slip alerts twice, once as MAPEH and again as whichever area moved.

**`teacher_dashboard.py` goes the other way.** One teacher handles a whole learning
area, so `teacher_assignments` names MAPEH and never its areas — but score items
hang off the areas. So:

- `subj_lookup` is built from **learning areas only**, since that is what an
  assignment name resolves to.
- `areas_by_parent` and the derived `gradeable` list expand an assignment into one
  entry per area. `gradeable_subject_ids` feeds the score-entry progress queries.
- `assignments` and `subject_ids` stay on learning areas, and the two lists are
  kept apart deliberately: **attendance is one roll for the whole of MAPEH**, so
  today's attendance rollup must not fan out to the areas. The `subjects` tile
  count is off `subject_ids` for the same reason — MAPEH is one subject to teach.

A missing `subj_lookup` key still yields `subject_id = None`, which silently drops
that assignment from every rollup — so this is not optional bookkeeping.

## Trained models (`ml/`)

Two models, trained on a **synthetic** school because the school has no data to share yet.
Everything a paper or a panel would ask about lives in the module docstrings; this is the map.

| File | What it is |
|---|---|
| `ml/synthetic.py` | the fake school: hidden traits, a mid-year "bad event", grades, attendance, VADER-scored notes, and the year-end label from DO 8 Table 10 |
| `ml/features.py` | **the one list of model inputs**, shared by training and the live endpoints |
| `ml/naive_bayes.py` | Gaussian Naive Bayes that **skips missing inputs** (sklearn's refuses NaN) |
| `ml/risk_model.py` / `ml/grade_model.py` | load the JSON model files, answer None when unusable so the caller falls back |
| `scripts/generate_synthetic.py` | writes the school to `data/synthetic/` (gitignored) incl. `demo_school.json` |
| `scripts/train_models.py` | trains, compares with baselines, re-runs over 5 seeds x 3 noise levels, saves |

**The model reads `grade_drop`, not `grade_trend`** (`model_inputs()` in `ml/features.py`): points fallen, 0 when grades held or rose. A Gaussian judges a value by how unusual it is in *either* direction and the High-Risk class's trends spread widest, so with a signed trend a learner whose grades rose 8 points scored as High Risk as one whose grades fell 8. `train_models.py` now runs a **direction check** — each input alone, walked from good to bad, must never lower the risk score — and warns if it fails; `WORSE_WHEN_HIGHER` in `ml/features.py` says which way is bad.

**How factors are chosen** (`risk_model.predict()`): a Moderate or High verdict lists every input that pushed it toward that tier, so a risk tier always comes with an explanation; a Stable verdict lists only inputs pushing hard toward High ("Worth watching" on the card). Severity is always measured High-vs-Stable, so one value reads the same on every learner. An input on the good side of a typical Stable learner is never listed, and behaviour must also be outside VADER's neutral band (below −0.1) — all-neutral notes are not "negative". `get_recommendation()` names a Stable learner's watch items rather than saying "on track" beside them.

**The risk model is an early warning, not a description.** Features are a learner's numbers
at a random mid-year period; the label is how their year *ended* (0 failing learning areas →
Stable, 1-2 → Moderate, 3+ or dropped → High; Kinder from its last competency ratings). Events
after the snapshot are invisible to the model by construction, which is what keeps it from
scoring 100%. Naive Bayes was chosen over the comparison models because every learner has a
different subset of inputs (Kinder no grades, Grades 1-6 no competency, many no notes this
month) and NB simply leaves a missing one out of the product. Logistic Regression scored
slightly higher in testing (`models/metrics.json`) — that is reported, not hidden.

**The grade model is one regression over everyone**: next grade from the last two grades,
recent attendance and behaviour. It replaced, as the default, a curve fitted to one learner's
2-4 grades, whose R² "confidence" read 1.0 whenever it passed through three points and which
missed by ~6 points against ~3.2 for the regression.

**Model files are JSON, not pickles** — plain numbers, readable and diffable, and loading one
cannot execute code. They record their feature list, and a file whose list differs from
`ml/features.py` is refused (logged, then the fallback answers). They are reloaded when their
mtime changes, so retraining needs no restart. `models/` is tracked so the demo needs no
training run; `data/` is not.

**After changing `ml/synthetic.py` or `ml/features.py`, retrain**:
`PYTHONIOENCODING=utf-8 venv/Scripts/python scripts/train_models.py` (~2.5 min; `--quick`
skips the sensitivity runs, `--no-save` leaves `models/` alone). It warns if Naive Bayes stops
matching sklearn's `GaussianNB` on complete rows or a model stops beating its baseline.

**Any accuracy figure here is about synthetic data.** It shows the models can recover the
patterns the generator built in, not that they work at a real school. Student Detail labels the
risk card "trained on simulated data" for the same reason. When real data exists, the same
pipeline retrains on it — only the source of the rows changes.

**Demo data** comes from the same generator: `demo_school.json` is placed into the active
school year by `node-api/scripts/seedSyntheticStudents.js` (dry run by default, `--apply`,
`--remove --apply`; refuses in production; every fake learner has an LRN starting `999999`
and a marker home address, and removal requires both).

## Attendance is year-scoped now; these queries are not

`attendance` gained a **`school_year_id`** in
`database/migrations/2026_08_23_attendance_school_year.sql`, derived from the record's
subject on write (subjects are per-school-year, so the subject is authoritative — the date
is not). Every attendance read in this service still bounds by time instead:
`routers/dashboard.py` uses `date = :today` and a 7-day trend, `routers/risk.py` uses
`date >= CURRENT_DATE - INTERVAL '30 days'` in both the single-student and bulk paths, and
`routers/teacher_dashboard.py` uses `date = :today`.

Those windows are **correct by accident**: a rolling 30 days rarely spans two school
years, but it does at the term seam, and this school's configured year dates leave months
uncovered between one year's `end_date` and the next one's `start_date` — so a window
landing in a gap silently mixes years. Nothing is broken today; the column simply exists
now if any of these ever needs to be year-exact. Prefer `school_year_id = :sy` over a date
range when adding a new attendance query.

## SQLAlchemy asyncpg caveats

- **Do not use Postgres `::type` cast syntax** (e.g., `:param::jsonb`, `:param::uuid`) inside `text()` queries — it conflicts with SQLAlchemy's `:name` parameter binding. Use `CAST(:param AS type)` instead.
- Avoid passing NULL parameters to `CAST()`. Build the query conditionally instead.
