from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, date

from services.db import get_db

router = APIRouter()


# ─── GET /dashboard/summary ────────────────────────────────────
@router.get("/summary")
async def get_dashboard_summary(db: AsyncSession = Depends(get_db)):
    """
    Aggregate AI-driven insights for the admin dashboard.
    Returns enrollment, attendance, risk distribution, and alert counts.
    """
    today = date.today()

    # ── Enrollment Summary ──
    enrollment = await db.execute(text("""
        SELECT grade_level, COUNT(*) as count
        FROM students
        WHERE is_active = TRUE AND enrollment_status = 'enrolled'
        GROUP BY grade_level ORDER BY grade_level
    """))
    enrollment_data = [
        {"grade": r.grade_level, "count": r.count}
        for r in enrollment.fetchall()
    ]
    total_students = sum(e["count"] for e in enrollment_data)

    # ── Today's Attendance ──
    attendance = await db.execute(text("""
        WITH per_student AS (
            SELECT student_id,
                   MIN(CASE status
                       WHEN 'Present' THEN 1
                       WHEN 'Late'    THEN 2
                       WHEN 'Excused' THEN 3
                       ELSE 4
                   END) AS best
            FROM attendance WHERE date = :today
            GROUP BY student_id
        )
        SELECT
            COUNT(*) AS total_logged,
            SUM(CASE WHEN best = 1 THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN best = 4 THEN 1 ELSE 0 END) AS absent,
            SUM(CASE WHEN best = 2 THEN 1 ELSE 0 END) AS late
        FROM per_student
    """), {"today": today})
    att_row = attendance.fetchone()

    # ── Risk Distribution (latest per student) ──
    risk = await db.execute(text("""
        SELECT risk_level, COUNT(*) as count
        FROM (
            SELECT DISTINCT ON (student_id) student_id, risk_level
            FROM risk_assessments
            ORDER BY student_id, assessed_at DESC
        ) latest
        GROUP BY risk_level
    """))
    risk_data = {r.risk_level: r.count for r in risk.fetchall()}

    # ── Behavior Sentiment (last 7 days) ──
    sentiment = await db.execute(text("""
        SELECT sentiment, COUNT(*) as count
        FROM behavior_logs
        WHERE observed_at >= NOW() - INTERVAL '7 days'
        GROUP BY sentiment
    """))
    sentiment_data = {r.sentiment: r.count for r in sentiment.fetchall()}

    # ── Recent High-Risk Alerts ──
    alerts = await db.execute(text("""
        SELECT DISTINCT ON (ra.student_id)
            s.full_name, s.grade_level, ra.risk_level, ra.risk_score, ra.assessed_at
        FROM risk_assessments ra
        JOIN students s ON s.id = ra.student_id
        WHERE ra.risk_level = 'High Risk' AND s.is_active = TRUE
        ORDER BY ra.student_id, ra.assessed_at DESC
        LIMIT 10
    """))
    alert_list = [
        {
            "student_name": r.full_name,
            "grade_level": r.grade_level,
            "risk_level": r.risk_level,
            "risk_score": float(r.risk_score),
            "assessed_at": r.assessed_at.isoformat() if r.assessed_at else None
        }
        for r in alerts.fetchall()
    ]

    # ── Attendance Trend (last 7 days) ──
    trend = await db.execute(text("""
        WITH per_student_day AS (
            SELECT date, student_id,
                   MIN(CASE status
                       WHEN 'Present' THEN 1
                       WHEN 'Late'    THEN 2
                       WHEN 'Excused' THEN 3
                       ELSE 4
                   END) AS best
            FROM attendance
            WHERE date >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY date, student_id
        )
        SELECT date,
               COUNT(*) AS total,
               SUM(CASE WHEN best=1 THEN 1 ELSE 0 END) AS present,
               SUM(CASE WHEN best=2 THEN 1 ELSE 0 END) AS late,
               SUM(CASE WHEN best=4 THEN 1 ELSE 0 END) AS absent
        FROM per_student_day
        GROUP BY date
        ORDER BY date
    """))
    trend_data = []
    for r in trend.fetchall():
        total = r.total or 0
        attended = (r.present or 0) + (r.late or 0)
        trend_data.append({
            "date": r.date.isoformat() if r.date else None,
            "total": total,
            "present": r.present or 0,
            "late": r.late or 0,
            "absent": r.absent or 0,
            "rate": round((attended / total) * 100, 1) if total else 0.0,
        })

    # ── Academic Decline Alerts ──
    declines = await db.execute(text("""
        WITH ranked AS (
            SELECT g.student_id, g.subject_id, g.quarter, g.school_year, g.grade,
                   ROW_NUMBER() OVER (
                       PARTITION BY g.student_id, g.subject_id
                       ORDER BY g.school_year DESC, g.quarter DESC
                   ) AS rn
            FROM grades g
            JOIN subjects gsub ON gsub.id = g.subject_id
            WHERE g.grade IS NOT NULL
              -- Learning areas only: a MAPEH slip would otherwise alert twice,
              -- once as MAPEH and again as whichever area moved.
              AND gsub.parent_id IS NULL
        )
        SELECT s.id AS student_id,
               s.full_name AS student_name,
               s.grade_level,
               sub.name AS subject_name,
               latest.grade AS latest_grade,
               prev.grade   AS prev_grade,
               (prev.grade - latest.grade) AS drop_points
        FROM ranked latest
        JOIN ranked prev
          ON prev.student_id = latest.student_id
         AND prev.subject_id = latest.subject_id
         AND prev.rn = 2
        JOIN students s ON s.id = latest.student_id
        JOIN subjects sub ON sub.id = latest.subject_id
        WHERE latest.rn = 1
          AND s.is_active = TRUE
          AND (prev.grade - latest.grade) >= 3
          AND latest.grade < 80
        ORDER BY drop_points DESC
        LIMIT 10
    """))
    decline_list = [
        {
            "student_id": str(r.student_id),
            "student_name": r.student_name,
            "grade_level": r.grade_level,
            "subject_name": r.subject_name,
            "latest_grade": float(r.latest_grade),
            "prev_grade": float(r.prev_grade),
            "drop": round(float(r.drop_points), 1),
        }
        for r in declines.fetchall()
    ]

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "overview": {
            "total_students": total_students,
            "enrollment_by_grade": enrollment_data
        },
        "todays_attendance": {
            "total_logged": att_row.total_logged or 0,
            "present": att_row.present or 0,
            "absent": att_row.absent or 0,
            "late": att_row.late or 0,
            "attendance_rate": round(
                (att_row.present or 0) / max(att_row.total_logged or 1, 1), 4
            )
        },
        "risk_distribution": {
            "stable": risk_data.get("Stable", 0),
            "moderate_risk": risk_data.get("Moderate Risk", 0),
            "high_risk": risk_data.get("High Risk", 0)
        },
        "behavioral_sentiment_7d": {
            "positive": sentiment_data.get("Positive", 0),
            "neutral": sentiment_data.get("Neutral", 0),
            "negative": sentiment_data.get("Negative", 0)
        },
        "high_risk_alerts": alert_list,
        "attendance_trend_7d": trend_data,
        "academic_declines": decline_list,
    }