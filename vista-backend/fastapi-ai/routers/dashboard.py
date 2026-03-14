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
        FROM students WHERE is_active = TRUE
        GROUP BY grade_level ORDER BY grade_level
    """))
    enrollment_data = [
        {"grade": r.grade_level, "count": r.count}
        for r in enrollment.fetchall()
    ]
    total_students = sum(e["count"] for e in enrollment_data)

    # ── Today's Attendance ──
    attendance = await db.execute(text("""
        SELECT
            COUNT(*) AS total_logged,
            SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent,
            SUM(CASE WHEN status = 'Late' THEN 1 ELSE 0 END) AS late
        FROM attendance WHERE date = :today
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
        "high_risk_alerts": alert_list
    }