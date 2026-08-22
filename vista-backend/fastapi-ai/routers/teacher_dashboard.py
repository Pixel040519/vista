from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, date

from services.db import get_db

router = APIRouter()

ECE_GRADES = {"Kinder"}


# ─── GET /teacher-dashboard/summary ───────────────────────────
@router.get("/summary")
async def get_teacher_dashboard_summary(
    teacher_id: str = Query(...),
    sy_label: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Teacher-scoped dashboard summary.
    All aggregations are filtered to the teacher's active-SY assignments
    (grade_level + section + subject_id).
    """
    today = date.today()

    # ── 1. Resolve active school_year_id from label ──
    sy_row = await db.execute(
        text("SELECT id FROM school_years WHERE label = :label LIMIT 1"),
        {"label": sy_label},
    )
    sy = sy_row.fetchone()
    if not sy:
        raise HTTPException(404, f"School year '{sy_label}' not found")
    sy_id = str(sy.id)

    # ── 2. Teacher assignments for that SY ──
    a_rows = await db.execute(
        text(
            """
            SELECT grade_level, section, subject
            FROM teacher_assignments
            WHERE teacher_id = CAST(:tid AS UUID) AND school_year = :sy
            ORDER BY grade_level, section, subject
            """
        ),
        {"tid": teacher_id, "sy": sy_label},
    )
    assignments_raw = a_rows.fetchall()

    if not assignments_raw:
        return _empty_payload(sy_label)

    # ── 3. Resolve subject_id for each (grade_level, name) under this SY ──
    subj_rows = await db.execute(
        text(
            """
            SELECT id, grade_level, name
            FROM subjects
            WHERE school_year_id = CAST(:syid AS UUID)
            """
        ),
        {"syid": sy_id},
    )
    subj_lookup = {(r.grade_level, r.name): str(r.id) for r in subj_rows.fetchall()}

    assignments = []
    for a in assignments_raw:
        subject_id = subj_lookup.get((a.grade_level, a.subject))
        assignments.append(
            {
                "grade_level": a.grade_level,
                "section": a.section,
                "subject": a.subject,
                "subject_id": subject_id,
            }
        )

    grade_section_pairs = sorted(
        {(a["grade_level"], a["section"]) for a in assignments}
    )
    grade_levels = list({a["grade_level"] for a in assignments})
    sections = list({a["section"] for a in assignments})
    subject_ids = list({a["subject_id"] for a in assignments if a["subject_id"]})

    # ── 4. Students in teacher's sections (distinct) ──
    students_rows = await db.execute(
        text(
            """
            SELECT id, full_name, grade_level, section
            FROM students
            WHERE is_active = TRUE
              AND enrollment_status = 'enrolled'
              AND grade_level = ANY(:grades)
              AND section = ANY(:sections)
            """
        ),
        {"grades": grade_levels, "sections": sections},
    )
    all_students = [
        {
            "id": str(r.id),
            "full_name": r.full_name,
            "grade_level": r.grade_level,
            "section": r.section,
        }
        for r in students_rows.fetchall()
    ]
    # Tighten to actual (grade, section) pairs the teacher owns
    pair_set = set(grade_section_pairs)
    my_students = [
        s for s in all_students if (s["grade_level"], s["section"]) in pair_set
    ]
    student_ids = [s["id"] for s in my_students]
    ece_count = sum(1 for s in my_students if s["grade_level"] in ECE_GRADES)

    # ── 5. Today's attendance rollup (across teacher's subjects) ──
    today_rollup = {"present": 0, "late": 0, "absent": 0, "excused": 0, "total_logged": 0}
    if student_ids and subject_ids:
        att_rows = await db.execute(
            text(
                """
                WITH per_student AS (
                    SELECT student_id,
                           MIN(CASE status
                               WHEN 'Present' THEN 1
                               WHEN 'Late'    THEN 2
                               WHEN 'Excused' THEN 3
                               ELSE 4
                           END) AS best
                    FROM attendance
                    WHERE date = :today
                      AND student_id = ANY(:sids)
                      AND subject_id = ANY(:subids)
                    GROUP BY student_id
                )
                SELECT
                    COUNT(*) AS total_logged,
                    SUM(CASE WHEN best = 1 THEN 1 ELSE 0 END) AS present,
                    SUM(CASE WHEN best = 2 THEN 1 ELSE 0 END) AS late,
                    SUM(CASE WHEN best = 3 THEN 1 ELSE 0 END) AS excused,
                    SUM(CASE WHEN best = 4 THEN 1 ELSE 0 END) AS absent
                FROM per_student
                """
            ),
            {"today": today, "sids": student_ids, "subids": subject_ids},
        )
        r = att_rows.fetchone()
        today_rollup = {
            "total_logged": r.total_logged or 0,
            "present": r.present or 0,
            "late": r.late or 0,
            "excused": r.excused or 0,
            "absent": r.absent or 0,
        }

    # ── 6. Per-assignment "attendance taken?" status ──
    today_status = []
    for a in assignments:
        if not a["subject_id"]:
            today_status.append({**a, "expected": 0, "logged": 0, "pending": True})
            continue
        expected = sum(
            1
            for s in my_students
            if s["grade_level"] == a["grade_level"] and s["section"] == a["section"]
        )
        logged_row = await db.execute(
            text(
                """
                SELECT COUNT(DISTINCT a.student_id) AS logged
                FROM attendance a
                JOIN students s ON s.id = a.student_id
                WHERE a.date = :today
                  AND a.subject_id = CAST(:subid AS UUID)
                  AND s.grade_level = :gl
                  AND s.section = :sec
                """
            ),
            {
                "today": today,
                "subid": a["subject_id"],
                "gl": a["grade_level"],
                "sec": a["section"],
            },
        )
        logged = logged_row.fetchone().logged or 0
        today_status.append(
            {
                **a,
                "expected": expected,
                "logged": logged,
                "pending": logged < expected or expected == 0,
            }
        )

    # ── 7. Risk distribution & top students-to-watch (in teacher's sections) ──
    risk_dist = {"stable": 0, "moderate_risk": 0, "high_risk": 0}
    students_to_watch = []
    if student_ids:
        risk_rows = await db.execute(
            text(
                """
                SELECT DISTINCT ON (ra.student_id)
                    ra.student_id, ra.risk_level, ra.risk_score,
                    ra.attendance_factor, ra.academic_factor, ra.behavioral_factor,
                    s.full_name, s.grade_level, s.section
                FROM risk_assessments ra
                JOIN students s ON s.id = ra.student_id
                WHERE ra.student_id = ANY(:sids)
                ORDER BY ra.student_id, ra.assessed_at DESC
                """
            ),
            {"sids": student_ids},
        )
        latest = risk_rows.fetchall()
        for r in latest:
            level = r.risk_level
            if level == "Stable":
                risk_dist["stable"] += 1
            elif level == "Moderate Risk":
                risk_dist["moderate_risk"] += 1
            elif level == "High Risk":
                risk_dist["high_risk"] += 1

        # Top 5 by risk_score, prioritising High > Moderate
        rank = {"High Risk": 0, "Moderate Risk": 1, "Stable": 2}
        watch_sorted = sorted(
            (r for r in latest if r.risk_level in ("High Risk", "Moderate Risk")),
            key=lambda r: (rank.get(r.risk_level, 3), -float(r.risk_score or 0)),
        )[:5]
        for r in watch_sorted:
            factors = {
                "attendance": float(r.attendance_factor or 0),
                "academic": float(r.academic_factor or 0),
                "behavioral": float(r.behavioral_factor or 0),
            }
            top_factor = max(factors, key=factors.get) if any(factors.values()) else None
            students_to_watch.append(
                {
                    "id": str(r.student_id),
                    "full_name": r.full_name,
                    "grade_level": r.grade_level,
                    "section": r.section,
                    "risk_level": r.risk_level,
                    "risk_score": float(r.risk_score or 0),
                    "top_factor": top_factor,
                }
            )

    # ── 8. Score-entry progress per (subject, section) ──
    # Score items are scoped per section, so a teacher handling the same
    # subject in two sections sees independent totals per section.
    # `components_with_items` and `total_items` are scoped to the latest
    # quarter that has any items, so adding items in a new quarter resets
    # those counts to reflect just that quarter's progress.
    score_progress = []
    if subject_ids:
        # Subject-wide component totals (grading_structure is per subject).
        comp_rows = await db.execute(
            text(
                """
                SELECT subject_id,
                       COUNT(*) FILTER (WHERE category_id IS NOT NULL) AS components_total
                FROM grading_structure
                WHERE subject_id = ANY(:subids) AND is_active = TRUE
                GROUP BY subject_id
                """
            ),
            {"subids": subject_ids},
        )
        comp_total_by_subject = {
            str(r.subject_id): r.components_total or 0 for r in comp_rows.fetchall()
        }

        # Per (subject, section) aggregates scoped to the latest quarter with items.
        sp_rows = await db.execute(
            text(
                """
                WITH latest AS (
                    SELECT subject_id, section, MAX(quarter) AS latest_quarter
                    FROM score_items
                    WHERE subject_id = ANY(:subids) AND is_active = TRUE
                    GROUP BY subject_id, section
                )
                SELECT
                    l.subject_id,
                    l.section,
                    l.latest_quarter,
                    COUNT(DISTINCT si.id)           AS total_items,
                    COUNT(DISTINCT si.component_id) AS components_with_items
                FROM latest l
                LEFT JOIN score_items si
                       ON si.subject_id = l.subject_id
                      AND si.section = l.section
                      AND si.quarter = l.latest_quarter
                      AND si.is_active = TRUE
                GROUP BY l.subject_id, l.section, l.latest_quarter
                """
            ),
            {"subids": subject_ids},
        )
        agg_by_subject_section = {
            (str(r.subject_id), r.section): {
                "total_items": r.total_items or 0,
                "components_with_items": r.components_with_items or 0,
                "latest_quarter": r.latest_quarter,
            }
            for r in sp_rows.fetchall()
        }

        for a in assignments:
            sid = a["subject_id"]
            if not sid:
                continue
            base = agg_by_subject_section.get((sid, a["section"]), {
                "total_items": 0,
                "components_with_items": 0,
                "latest_quarter": None,
            })
            score_progress.append(
                {
                    "subject_id": sid,
                    "subject": a["subject"],
                    "grade_level": a["grade_level"],
                    "section": a["section"],
                    "components_total": comp_total_by_subject.get(sid, 0),
                    "components_with_items": base["components_with_items"],
                    "total_items": base["total_items"],
                    "latest_quarter": base["latest_quarter"],
                }
            )
        score_progress.sort(key=lambda r: (r["grade_level"], r["section"], r["subject"]))

    # ── 9. Recent behavior logs authored by this teacher ──
    beh_rows = await db.execute(
        text(
            """
            SELECT bl.id, bl.observation, bl.sentiment, bl.sentiment_score,
                   bl.observed_at, s.full_name AS student_name,
                   s.grade_level, s.section
            FROM behavior_logs bl
            JOIN students s ON s.id = bl.student_id
            WHERE bl.teacher_id = CAST(:tid AS UUID)
            ORDER BY bl.observed_at DESC
            LIMIT 5
            """
        ),
        {"tid": teacher_id},
    )
    behavior_recent = [
        {
            "id": str(r.id),
            "student_name": r.student_name,
            "grade_level": r.grade_level,
            "section": r.section,
            "excerpt": (r.observation or "")[:120],
            "sentiment": r.sentiment,
            "vader_compound": float(r.sentiment_score or 0),
            "observed_at": r.observed_at.isoformat() if r.observed_at else None,
        }
        for r in beh_rows.fetchall()
    ]

    # ── 10. Behavior sentiment counts (last 7 days, this teacher's logs) ──
    sent_rows = await db.execute(
        text(
            """
            SELECT sentiment, COUNT(*) AS c
            FROM behavior_logs
            WHERE teacher_id = CAST(:tid AS UUID)
              AND observed_at >= NOW() - INTERVAL '7 days'
            GROUP BY sentiment
            """
        ),
        {"tid": teacher_id},
    )
    sent_map = {r.sentiment: r.c for r in sent_rows.fetchall()}
    behavior_sentiment_7d = {
        "positive": sent_map.get("Positive", 0),
        "neutral": sent_map.get("Neutral", 0),
        "negative": sent_map.get("Negative", 0),
    }

    # ── 11. Per-section roll-up (for the My Classes grid) ──
    sections_payload = []
    # Pre-compute risk-by-student lookup
    risk_by_student = {}
    if student_ids:
        rb_rows = await db.execute(
            text(
                """
                SELECT DISTINCT ON (ra.student_id)
                    ra.student_id, ra.risk_level
                FROM risk_assessments ra
                WHERE ra.student_id = ANY(:sids)
                ORDER BY ra.student_id, ra.assessed_at DESC
                """
            ),
            {"sids": student_ids},
        )
        risk_by_student = {str(r.student_id): r.risk_level for r in rb_rows.fetchall()}

    for gl, sec in grade_section_pairs:
        section_students = [
            s for s in my_students if s["grade_level"] == gl and s["section"] == sec
        ]
        rd = {"stable": 0, "moderate_risk": 0, "high_risk": 0, "unassessed": 0}
        for s in section_students:
            lvl = risk_by_student.get(s["id"])
            if lvl == "Stable":
                rd["stable"] += 1
            elif lvl == "Moderate Risk":
                rd["moderate_risk"] += 1
            elif lvl == "High Risk":
                rd["high_risk"] += 1
            else:
                rd["unassessed"] += 1
        section_subjects = [
            a["subject"]
            for a in assignments
            if a["grade_level"] == gl and a["section"] == sec
        ]
        sections_payload.append(
            {
                "grade_level": gl,
                "section": sec,
                "subjects": section_subjects,
                "enrollment": len(section_students),
                "risk": rd,
            }
        )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "school_year": sy_label,
        "assignments": assignments,
        "today_attendance_status": today_status,
        "todays_attendance_rollup": today_rollup,
        "my_students": {
            "total": len(my_students),
            "sections": len(grade_section_pairs),
            "subjects": len(subject_ids),
        },
        "my_sections": sections_payload,
        "risk_in_my_sections": risk_dist,
        "students_to_watch": students_to_watch,
        "score_entry_progress": score_progress,
        "behavior_recent": behavior_recent,
        "behavior_sentiment_7d": behavior_sentiment_7d,
        "ece_student_count": ece_count,
    }


def _empty_payload(sy_label: str) -> dict:
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "school_year": sy_label,
        "assignments": [],
        "today_attendance_status": [],
        "todays_attendance_rollup": {
            "total_logged": 0,
            "present": 0,
            "late": 0,
            "excused": 0,
            "absent": 0,
        },
        "my_students": {"total": 0, "sections": 0, "subjects": 0},
        "my_sections": [],
        "risk_in_my_sections": {"stable": 0, "moderate_risk": 0, "high_risk": 0},
        "students_to_watch": [],
        "score_entry_progress": [],
        "behavior_recent": [],
        "behavior_sentiment_7d": {"positive": 0, "neutral": 0, "negative": 0},
        "ece_student_count": 0,
    }
