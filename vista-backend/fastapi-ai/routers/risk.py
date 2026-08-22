from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
import numpy as np
import json
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

# Descriptive-assessment rating scales. Mirrors RATING_SCALES in
# vista-backend/node-api/src/utils/grading.js — weights are (levels - index) /
# levels, so EGFNA reproduces the original 1.0 / 0.75 / 0.5 / 0.25 exactly.
#
# The scale MUST be read from ece_competency_records.rating_scale, never assumed:
# "E" is Excellent (best) under EGFNA but Emerging (worst) under ABCDE, so a
# scale-blind lookup would score a failing learner as perfect.
RATING_SCALE_WEIGHTS = {
    "EGFNA":  {"E": 1.0, "G": 0.75, "F": 0.5, "NA": 0.25},
    "CODVBG": {"CO": 1.0, "DV": 2 / 3, "BG": 1 / 3},
    "ABCDE":  {"A": 1.0, "B": 0.8, "C": 0.6, "D": 0.4, "E": 0.2},
}
DEFAULT_RATING_SCALE = "EGFNA"


def rating_weight(scale: str | None, rating: str | None) -> float:
    """0-1 weight for one rating on its own scale."""
    table = RATING_SCALE_WEIGHTS.get(scale or DEFAULT_RATING_SCALE, {})
    return table.get(rating, 0.0)


def _rating_case_sql(column_prefix: str) -> str:
    """
    Build a SQL CASE that maps (rating_scale, rating) -> weight.
    Generated rather than hand-written so it cannot drift from the table above.
    """
    branches = [
        f"WHEN {column_prefix}.rating_scale = '{scale}' "
        f"AND {column_prefix}.rating = '{code}' THEN {weight}"
        for scale, table in RATING_SCALE_WEIGHTS.items()
        for code, weight in table.items()
    ]
    return "CASE " + " ".join(branches) + " END"


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
    attendance_rate: Optional[float]
    avg_grade: Optional[float]
    behavioral_score: Optional[float]
    competency_score: Optional[float]  # 0-1 avg rating, ECE students only
    recommendation: str
    assessed_at: str


# ─── Feature Extraction ────────────────────────────────────────
async def extract_features(student_id: str, grade_level: Optional[str], db: AsyncSession) -> dict:
    """
    Extract risk factors for a student:
    1. Attendance rate (last 30 days)
    2. Average grade (latest quarter) — non-ECE students
    3. Behavioral sentiment average (this month)
    4. Competency average (latest quarter in active SY) — descriptive learners only
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
    total_days = att.total or 0
    present_days = att.present or 0
    # No records → no signal (None); otherwise compute rate.
    attendance_rate = (present_days / total_days) if total_days > 0 else None

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
    # No logs → no signal (None); otherwise the raw sentiment average.
    behavioral_score = float(beh_row.avg_sentiment) if beh_row.avg_sentiment is not None else None

    # ── Competency ──
    # Which grade levels are assessed descriptively is configuration owned by the
    # Node API; this service stays config-agnostic and simply follows the data —
    # only descriptive learners have competency records, so a numeric learner
    # returns no rows and the factor stays None.
    competency_score = None
    comp_result = await db.execute(text("""
        SELECT rating, rating_scale
        FROM ece_competency_records
        WHERE student_id = :sid
          AND school_year_id = (
              SELECT id FROM school_years WHERE is_active = TRUE LIMIT 1
          )
          AND quarter = (
              SELECT MAX(quarter)
              FROM ece_competency_records
              WHERE student_id = :sid
                AND school_year_id = (
                    SELECT id FROM school_years WHERE is_active = TRUE LIMIT 1
                )
          )
    """), {"sid": student_id})
    ratings = [rating_weight(r.rating_scale, r.rating) for r in comp_result.fetchall()]
    if ratings:
        competency_score = sum(ratings) / len(ratings)

    return {
        "attendance_rate": round(attendance_rate, 4) if attendance_rate is not None else None,
        "avg_grade": round(avg_grade, 2) if avg_grade else None,
        "behavioral_score": round(behavioral_score, 4) if behavioral_score is not None else None,
        "competency_score": round(competency_score, 4) if competency_score is not None else None,
    }


def rule_based_risk(
    attendance_rate: Optional[float],
    avg_grade: Optional[float],
    behavioral_score: Optional[float],
    competency_score: Optional[float] = None,
) -> tuple[str, float, list[RiskFactor]]:
    """
    Rule-based risk classification.
    In production this would be replaced by a trained Random Forest model.
    Using rules here ensures the system works without historical training data.
    Any factor passed as None is treated as "no data" and contributes nothing.
    """
    factors = []
    risk_points = 0
    signals = 0  # number of factors with actual data

    # ── Attendance Factor ──
    if attendance_rate is not None:
        signals += 1
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
        signals += 1
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

    # ── ECE Competency Factor ── (ECE students only)
    # Scale: E=1.0 G=0.75 F=0.5 NA=0.25. <0.5 = mostly F/NA, 0.5–0.7 = mixed F/G.
    if competency_score is not None:
        signals += 1
        if competency_score < 0.5:
            factors.append(RiskFactor(
                factor="ECE Competency",
                severity="High",
                description=f"Competency ratings average {competency_score*100:.0f}% — many skills need assistance"
            ))
            risk_points += 2
        elif competency_score < 0.7:
            factors.append(RiskFactor(
                factor="ECE Competency",
                severity="Medium",
                description=f"Competency ratings average {competency_score*100:.0f}% — several skills below target"
            ))
            risk_points += 1

    # ── Behavioral Factor ──
    if behavioral_score is not None:
        signals += 1
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
    # Without any signal, we can't judge — return Stable with score 0.
    if signals == 0:
        return "Stable", 0.0, factors

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


def get_recommendation(risk_level: str, factors: list[RiskFactor], signals: int = 1) -> str:
    if signals == 0:
        return "ℹ️ Not enough data yet. Log attendance, scores, or behavior to enable a risk assessment."
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
        text("SELECT id, full_name, grade_level FROM students WHERE id = :sid"),
        {"sid": request.student_id}
    )
    student = student_result.fetchone()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    # Extract features
    features = await extract_features(request.student_id, student.grade_level, db)

    # Classify risk
    risk_level, risk_score, factors = rule_based_risk(
        features["attendance_rate"],
        features["avg_grade"],
        features["behavioral_score"],
        features["competency_score"],
    )

    signal_count = sum(
        1 for v in (
            features["attendance_rate"],
            features["avg_grade"],
            features["behavioral_score"],
            features["competency_score"],
        ) if v is not None
    )
    recommendation = get_recommendation(risk_level, factors, signal_count)

    # Persist assessment
    await db.execute(text("""
        INSERT INTO risk_assessments
            (student_id, risk_level, risk_score, attendance_factor,
             academic_factor, behavioral_factor, ece_competency_factor,
             contributing_factors, model_version)
        VALUES (:sid, :level, :score, :att, :acad, :beh, :comp, CAST(:factors AS jsonb), :ver)
    """), {
        "sid": request.student_id,
        "level": risk_level,
        "score": risk_score,
        "att": features["attendance_rate"],
        "acad": round(features["avg_grade"] / 100, 4) if features["avg_grade"] is not None else None,
        "beh": features["behavioral_score"],
        "comp": features["competency_score"],
        "factors": json.dumps([f.model_dump() for f in factors]),
        "ver": "rule-v1.1"
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
        competency_score=features["competency_score"],
        recommendation=recommendation,
        assessed_at=datetime.utcnow().isoformat()
    )


def _top_factor(att, acad, beh, comp):
    # Convert each stored value to a risk *deficit* (higher = more risk)
    # so "top factor" actually names the weakest area, not the strongest.
    # att/acad/comp are 0-1 where higher = better; beh is signed sentiment
    # where higher = better. None means "no data" and is skipped.
    deficits = []
    if att is not None:
        deficits.append(("attendance", max(0.0, 1.0 - float(att))))
    if acad is not None:
        deficits.append(("academic",   max(0.0, 1.0 - float(acad))))
    if beh is not None:
        deficits.append(("behavioral", max(0.0, -float(beh))))
    if comp is not None:
        deficits.append(("competency", max(0.0, 1.0 - float(comp))))
    if not deficits:
        return None
    name, val = max(deficits, key=lambda f: f[1])
    return name if val > 0 else None


# ─── GET /classify/risk/all ────────────────────────────────────
@router.get("/risk/all")
async def get_all_risk_levels(db: AsyncSession = Depends(get_db)):
    """
    Admin-scoped live risk overview for every active student.
    Computed on the fly from source tables (attendance, grades, behavior,
    ECE competency records) instead of reading persisted risk_assessments,
    so a student never has to be manually classified to appear here.
    """
    assessed_at = datetime.utcnow().isoformat()

    # 1. Active students
    stu_rows = (await db.execute(text("""
        SELECT id, full_name, grade_level, section
          FROM students
         WHERE is_active = TRUE AND enrollment_status = 'enrolled'
         ORDER BY full_name
    """))).fetchall()

    if not stu_rows:
        return {"students": [], "summary": {"total": 0, "stable": 0, "moderate": 0, "high": 0}}

    # 2. Attendance — last 30 days per student
    att_rows = (await db.execute(text("""
        SELECT student_id,
               COUNT(*) AS total,
               SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present
          FROM attendance
         WHERE date >= (CURRENT_DATE - INTERVAL '30 days')
         GROUP BY student_id
    """))).fetchall()
    att_map = {str(r.student_id): (r.total or 0, r.present or 0) for r in att_rows}

    # 3. Academic — average of each student's latest-quarter grades
    acad_rows = (await db.execute(text("""
        SELECT g.student_id, AVG(g.grade) AS avg_grade
          FROM grades g
         WHERE g.grade IS NOT NULL
           AND g.quarter = (
               SELECT MAX(quarter) FROM grades g2 WHERE g2.student_id = g.student_id
           )
         GROUP BY g.student_id
    """))).fetchall()
    acad_map = {str(r.student_id): float(r.avg_grade) for r in acad_rows if r.avg_grade is not None}

    # 4. Behavior — this month per student
    beh_rows = (await db.execute(text("""
        SELECT student_id, AVG(sentiment_score) AS avg_sentiment
          FROM behavior_logs
         WHERE observed_at >= date_trunc('month', CURRENT_DATE)
         GROUP BY student_id
    """))).fetchall()
    beh_map = {str(r.student_id): float(r.avg_sentiment) for r in beh_rows if r.avg_sentiment is not None}

    # 5. Competency — latest quarter in active SY, per student. The CASE is
    # generated from RATING_SCALE_WEIGHTS and keys on (rating_scale, rating) so
    # mixed scales in one school year are each weighted on their own terms.
    # No bind parameters here, so an f-string is safe: the interpolated CASE is
    # generated from a module-level constant, never from request input.
    comp_rows = (await db.execute(text(f"""
        WITH active_sy AS (
            SELECT id FROM school_years WHERE is_active = TRUE LIMIT 1
        ),
        latest AS (
            SELECT student_id, MAX(quarter) AS q
              FROM ece_competency_records
             WHERE school_year_id = (SELECT id FROM active_sy)
             GROUP BY student_id
        )
        SELECT ecr.student_id,
               AVG({_rating_case_sql('ecr')}) AS avg_rating
          FROM ece_competency_records ecr
          JOIN latest l ON l.student_id = ecr.student_id AND l.q = ecr.quarter
         WHERE ecr.school_year_id = (SELECT id FROM active_sy)
         GROUP BY ecr.student_id
    """))).fetchall()
    comp_map = {str(r.student_id): float(r.avg_rating) for r in comp_rows if r.avg_rating is not None}

    # 6. Per-student classification
    students = []
    for s in stu_rows:
        sid = str(s.id)
        total, present = att_map.get(sid, (0, 0))
        attendance_rate = (present / total) if total > 0 else None
        avg_grade = acad_map.get(sid)
        behavioral_score = beh_map.get(sid)
        # comp_map only contains learners who actually have competency records.
        competency_score = comp_map.get(sid)

        risk_level, risk_score, _factors = rule_based_risk(
            attendance_rate, avg_grade, behavioral_score, competency_score
        )

        # Factor columns for the table — same conventions as POST /risk.
        att_factor  = round(attendance_rate, 4) if attendance_rate is not None else None
        acad_factor = round(avg_grade / 100, 4) if avg_grade is not None else None
        beh_factor  = round(behavioral_score, 4) if behavioral_score is not None else None
        comp_factor = round(competency_score, 4) if competency_score is not None else None

        students.append({
            "student_id":  sid,
            "full_name":   s.full_name,
            "grade_level": s.grade_level,
            "section":     s.section,
            "risk_level":  risk_level,
            "risk_score":  float(risk_score),
            "risk_color":  RISK_COLORS.get(risk_level, "#6b7280"),
            "assessed_at": assessed_at,
            "attendance_factor":     float(att_factor  or 0),
            "academic_factor":       float(acad_factor or 0),
            "behavioral_factor":     float(beh_factor  or 0),
            "ece_competency_factor": float(comp_factor or 0),
            "top_factor": _top_factor(att_factor, acad_factor, beh_factor, comp_factor),
        })

    summary = {
        "total":    len(students),
        "stable":   sum(1 for s in students if s["risk_level"] == "Stable"),
        "moderate": sum(1 for s in students if s["risk_level"] == "Moderate Risk"),
        "high":     sum(1 for s in students if s["risk_level"] == "High Risk"),
    }
    return {"students": students, "summary": summary}