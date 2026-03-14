from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
import numpy as np
import logging
from datetime import datetime, timedelta
from typing import Optional

from services.db import get_db

router = APIRouter()
logger = logging.getLogger("vista-ai.risk")

# ─── Risk Level Labels ─────────────────────────────────────────
RISK_LABELS = ["Stable", "Moderate Risk", "High Risk"]
RISK_COLORS = {
    "Stable": "#22c55e",         # green
    "Moderate Risk": "#f59e0b",  # amber
    "High Risk": "#ef4444"       # red
}


# ─── Pydantic Models ───────────────────────────────────────────
class RiskRequest(BaseModel):
    student_id: str


class RiskFactor(BaseModel):
    factor: str
    severity: str                # Low, Medium, High
    description: str


class RiskResponse(BaseModel):
    student_id: str
    student_name: str
    risk_level: str
    risk_score: float            # 0.0 to 1.0
    risk_color: str
    factors: list[RiskFactor]
    attendance_rate: float
    avg_grade: Optional[float]
    behavioral_score: Optional[float]
    recommendation: str
    assessed_at: str


# ─── Feature Extraction ────────────────────────────────────────
async def extract_features(student_id: str, db: AsyncSession) -> dict:
    """
    Extract the three risk factors for a student:
    1. Attendance rate (last 30 days)
    2. Average grade (latest quarter)
    3. Behavioral sentiment average (last 30 days)
    """
    now = datetime.utcnow()
    thirty_days_ago = (now - timedelta(days=30)).date()

    # ── Attendance Rate ──
    att_result = await db.execute(text("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present
        FROM attendance
        WHERE student_id = :sid AND date >= :start
    """), {"sid": student_id, "start": thirty_days_ago})
    att = att_result.fetchone()
    total_days = att.total or 1
    present_days = att.present or 0
    attendance_rate = present_days / total_days

    # ── Average Grade ──
    grade_result = await db.execute(text("""
        SELECT AVG(grade) as avg_grade
        FROM grades
        WHERE student_id = :sid AND quarter = (
            SELECT MAX(quarter) FROM grades WHERE student_id = :sid
        )
    """), {"sid": student_id})
    grade_row = grade_result.fetchone()
    avg_grade = float(grade_row.avg_grade) if grade_row.avg_grade else None

    # ── Behavioral Sentiment ──
    beh_result = await db.execute(text("""
        SELECT AVG(sentiment_score) as avg_sentiment
        FROM behavior_logs
        WHERE student_id = :sid AND observed_at >= :start
    """), {"sid": student_id, "start": datetime(now.year, now.month, 1)})
    beh_row = beh_result.fetchone()
    behavioral_score = float(beh_row.avg_sentiment) if beh_row.avg_sentiment else 0.0

    return {
        "attendance_rate": round(attendance_rate, 4),
        "avg_grade": round(avg_grade, 2) if avg_grade else None,
        "behavioral_score": round(behavioral_score, 4)
    }


def rule_based_risk(
    attendance_rate: float,
    avg_grade: Optional[float],
    behavioral_score: float
) -> tuple[str, float, list[RiskFactor]]:
    """
    Rule-based risk classification.
    In production this would be replaced by a trained Random Forest model.
    Using rules here ensures the system works without historical training data.
    """
    factors = []
    risk_points = 0

    # ── Attendance Factor ──
    if attendance_rate < 0.7:
        factors.append(RiskFactor(
            factor="Attendance",
            severity="High",
            description=f"Attendance rate is critically low ({attendance_rate*100:.1f}%)"
        ))
        risk_points += 2
    elif attendance_rate < 0.85:
        factors.append(RiskFactor(
            factor="Attendance",
            severity="Medium",
            description=f"Attendance rate needs improvement ({attendance_rate*100:.1f}%)"
        ))
        risk_points += 1

    # ── Academic Factor ──
    if avg_grade is not None:
        if avg_grade < 75:
            factors.append(RiskFactor(
                factor="Academic Performance",
                severity="High",
                description=f"Average grade is below minimum ({avg_grade:.1f})"
            ))
            risk_points += 2
        elif avg_grade < 80:
            factors.append(RiskFactor(
                factor="Academic Performance",
                severity="Medium",
                description=f"Average grade is below target ({avg_grade:.1f})"
            ))
            risk_points += 1

    # ── Behavioral Factor ──
    if behavioral_score < -0.3:
        factors.append(RiskFactor(
            factor="Behavioral/Emotional",
            severity="High",
            description="Predominantly negative behavioral observations logged"
        ))
        risk_points += 2
    elif behavioral_score < 0:
        factors.append(RiskFactor(
            factor="Behavioral/Emotional",
            severity="Medium",
            description="Some negative behavioral patterns observed"
        ))
        risk_points += 1

    # ── Classify Risk ──
    if risk_points >= 4:
        risk_level = "High Risk"
        risk_score = min(0.95, 0.65 + (risk_points - 4) * 0.1)
    elif risk_points >= 2:
        risk_level = "Moderate Risk"
        risk_score = 0.35 + (risk_points - 2) * 0.1
    else:
        risk_level = "Stable"
        risk_score = max(0.05, risk_points * 0.1)

    return risk_level, round(risk_score, 4), factors


def get_recommendation(risk_level: str, factors: list[RiskFactor]) -> str:
    if risk_level == "High Risk":
        return ("🚨 Immediate intervention required. Schedule urgent parent-teacher-counselor "
                "conference. Develop individualized support plan.")
    elif risk_level == "Moderate Risk":
        factor_names = [f.factor for f in factors]
        return (f"⚠️ Monitor closely. Address concern areas: {', '.join(factor_names)}. "
                "Consider additional support resources.")
    return "✅ Student is on track. Continue regular monitoring."


# ─── POST /classify/risk ───────────────────────────────────────
@router.post("/risk", response_model=RiskResponse)
async def classify_risk(
    request: RiskRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Classify a student's risk level using attendance, academic, and behavioral data.
    Algorithm: Rule-based classifier (upgradeable to Random Forest with training data).
    """
    # Fetch student
    student_result = await db.execute(
        text("SELECT id, full_name FROM students WHERE id = :sid"),
        {"sid": request.student_id}
    )
    student = student_result.fetchone()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    # Extract features
    features = await extract_features(request.student_id, db)

    # Classify risk
    risk_level, risk_score, factors = rule_based_risk(
        features["attendance_rate"],
        features["avg_grade"],
        features["behavioral_score"]
    )

    recommendation = get_recommendation(risk_level, factors)

    # Persist assessment
    await db.execute(text("""
        INSERT INTO risk_assessments
            (student_id, risk_level, risk_score, attendance_factor,
             academic_factor, behavioral_factor, contributing_factors, model_version)
        VALUES (:sid, :level, :score, :att, :acad, :beh, :factors::jsonb, :ver)
    """), {
        "sid": request.student_id,
        "level": risk_level,
        "score": risk_score,
        "att": features["attendance_rate"],
        "acad": features["avg_grade"],
        "beh": features["behavioral_score"],
        "factors": str([f.model_dump() for f in factors]),
        "ver": "rule-v1.0"
    })
    await db.commit()

    return RiskResponse(
        student_id=request.student_id,
        student_name=student.full_name,
        risk_level=risk_level,
        risk_score=risk_score,
        risk_color=RISK_COLORS[risk_level],
        factors=factors,
        attendance_rate=features["attendance_rate"],
        avg_grade=features["avg_grade"],
        behavioral_score=features["behavioral_score"],
        recommendation=recommendation,
        assessed_at=datetime.utcnow().isoformat()
    )


# ─── GET /classify/risk/all ────────────────────────────────────
@router.get("/risk/all")
async def get_all_risk_levels(db: AsyncSession = Depends(get_db)):
    """Get latest risk assessments for all active students (Admin dashboard view)."""
    result = await db.execute(text("""
        SELECT DISTINCT ON (ra.student_id)
            ra.student_id, s.full_name, s.grade_level, s.section,
            ra.risk_level, ra.risk_score, ra.assessed_at
        FROM risk_assessments ra
        JOIN students s ON s.id = ra.student_id
        WHERE s.is_active = TRUE
        ORDER BY ra.student_id, ra.assessed_at DESC
    """))
    rows = result.fetchall()

    students = [
        {
            "student_id": str(r.student_id),
            "full_name": r.full_name,
            "grade_level": r.grade_level,
            "section": r.section,
            "risk_level": r.risk_level,
            "risk_score": float(r.risk_score),
            "risk_color": RISK_COLORS.get(r.risk_level, "#6b7280"),
            "assessed_at": r.assessed_at.isoformat() if r.assessed_at else None
        }
        for r in rows
    ]

    # Summary counts
    summary = {
        "total": len(students),
        "stable": sum(1 for s in students if s["risk_level"] == "Stable"),
        "moderate": sum(1 for s in students if s["risk_level"] == "Moderate Risk"),
        "high": sum(1 for s in students if s["risk_level"] == "High Risk"),
    }

    return {"students": students, "summary": summary}