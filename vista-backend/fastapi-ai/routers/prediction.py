from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures
from typing import Optional
import logging
from datetime import datetime, timedelta

from ml import grade_model
from services.db import get_db

router = APIRouter()
logger = logging.getLogger("vista-ai.prediction")


# ─── Pydantic Models ───────────────────────────────────────────
class PredictionRequest(BaseModel):
    student_id: str
    subject_id: Optional[str] = None   # If None, predict for all subjects


class QuarterPrediction(BaseModel):
    quarter: int
    predicted_grade: float
    confidence: float
    trend: str                           # Improving, Declining, Stable
    margin: Optional[float] = None       # typical miss in grade points (trained model only)


class SubjectPrediction(BaseModel):
    subject_id: str
    subject_name: str
    historical_grades: list[dict]
    predictions: list[QuarterPrediction]
    overall_trend: str
    recommendation: Optional[str] = None


class PredictionResponse(BaseModel):
    # `model_version` is a field, not pydantic's reserved model_* namespace.
    model_config = ConfigDict(protected_namespaces=())

    student_id: str
    student_name: str
    subjects: list[SubjectPrediction]
    alert: Optional[str] = None
    model_version: str = "curve-v1"      # lr-synth-v1 when the trained model answered


# ─── Core Prediction Logic ─────────────────────────────────────
def predict_grades(grade_history: list[float]) -> tuple[list[float], float]:
    """
    The old per-learner forecast: a curve fitted to this learner's own grades.
    Kept as the backup when models/grade_lr.json is unavailable, and as a
    baseline in scripts/train_models.py, where it loses clearly — with three
    grades the curve passes through all of them, so its R² "confidence" reads
    1.0 while predicting badly.
    Returns (predictions, r2_score).
    """
    if len(grade_history) < 2:
        # Not enough data — return current grade as prediction
        return [grade_history[-1]] * 2, 0.5

    X = np.array(range(1, len(grade_history) + 1)).reshape(-1, 1)
    y = np.array(grade_history)

    # Use polynomial features for better fit with small datasets
    poly = PolynomialFeatures(degree=min(2, len(grade_history) - 1))
    X_poly = poly.fit_transform(X)

    model = LinearRegression()
    model.fit(X_poly, y)

    # Calculate R² confidence score
    r2 = max(0.0, model.score(X_poly, y))

    # Predict next quarters
    next_quarters = np.array([[len(grade_history) + 1], [len(grade_history) + 2]])
    next_poly = poly.transform(next_quarters)
    predictions = model.predict(next_poly)

    # Clamp predictions to valid grade range (60-100)
    predictions = np.clip(predictions, 60, 100)

    return predictions.tolist(), round(r2, 4)


def get_trend(grades: list[float]) -> str:
    """Determine trend direction from grade history."""
    if len(grades) < 2:
        return "Stable"
    slope = grades[-1] - grades[0]
    if slope > 3:
        return "Improving"
    elif slope < -3:
        return "Declining"
    return "Stable"


def get_recommendation(trend: str, latest_grade: float) -> Optional[str]:
    """Generate actionable recommendation based on trend and grade."""
    if trend == "Declining" and latest_grade < 75:
        return "⚠️ Immediate tutoring support recommended. Schedule parent-teacher conference."
    elif trend == "Declining":
        return "📉 Grade is declining. Consider additional review sessions."
    elif latest_grade < 75:
        # Remedial, not enrichment: enrichment is extra challenge for learners
        # who are ahead, and this branch is a learner below the passing grade.
        return "📚 Below the passing grade of 75. Remedial support recommended."
    elif trend == "Improving" and latest_grade >= 90:
        return "⭐ Excellent progress! Consider advanced enrichment programs."
    return None


# ─── POST /predict/performance ─────────────────────────────────
@router.post("/performance", response_model=PredictionResponse)
async def predict_performance(
    request: PredictionRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Predict a student's future academic performance using Linear Regression.
    Analyzes historical grade data per subject and forecasts the next two
    periods with the trained model (ml/grade_model.py), or the per-learner
    curve when models/grade_lr.json is unavailable.
    """

    # 1. Fetch student info
    student_result = await db.execute(
        text("SELECT id, full_name FROM students WHERE id = :sid"),
        {"sid": request.student_id}
    )
    student = student_result.fetchone()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    # 2. How many grading periods this school year has. DepEd moved from four
    #    quarters to three terms (DO 009, s. 2026), so this cannot be hardcoded.
    period_result = await db.execute(
        text("SELECT period_model FROM school_years WHERE is_active = TRUE LIMIT 1")
    )
    period_row = period_result.fetchone()
    periods_per_year = 3 if (period_row and period_row.period_model == "3T") else 4

    # 3. Fetch grade history.
    # One forecast per **learning area**. MAPEH's areas each carry a grade, but
    # the parent is what a report card and a parent's app show, so predicting
    # per area would produce four cards where the reader expects one. An explicit
    # subject_id still wins, so an area can be forecast on request.
    subject_filter = "AND g.subject_id = CAST(:subject_id AS uuid)" if request.subject_id else "AND s.parent_id IS NULL"
    grade_query = f"""
        SELECT g.subject_id, s.name as subject_name,
               g.quarter, g.school_year, g.grade
        FROM grades g
        JOIN subjects s ON s.id = g.subject_id
        WHERE g.student_id = :sid
          {subject_filter}
          AND g.grade IS NOT NULL
        ORDER BY g.subject_id, g.school_year, g.quarter
    """
    params = {"sid": request.student_id}
    if request.subject_id:
        params["subject_id"] = request.subject_id
    grades_result = await db.execute(text(grade_query), params)
    grade_rows = grades_result.fetchall()

    if not grade_rows:
        raise HTTPException(
            status_code=404,
            detail="No grade data found for this student."
        )

    # 4. Recent attendance and behaviour — the trained model's other two inputs,
    #    on the same windows the risk check uses (last 30 days, this month).
    now = datetime.utcnow()
    att = (await db.execute(text("""
        SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present
          FROM attendance WHERE student_id = :sid AND date >= :start
    """), {"sid": request.student_id, "start": (now - timedelta(days=30)).date()})).fetchone()
    attendance_rate = (att.present / att.total) if att.total else None
    beh = (await db.execute(text("""
        SELECT AVG(sentiment_score) AS avg FROM behavior_logs
         WHERE student_id = :sid AND observed_at >= :start
    """), {"sid": request.student_id, "start": datetime(now.year, now.month, 1)})).fetchone()
    behavioral_score = float(beh.avg) if beh.avg is not None else None
    model_version = "curve-v1"

    # 5. Group by subject and run predictions
    df = pd.DataFrame(grade_rows, columns=["subject_id", "subject_name", "quarter", "school_year", "grade"])
    subject_predictions = []
    overall_alert = None

    for subject_id, group in df.groupby("subject_id"):
        subject_name = group["subject_name"].iloc[0]
        grade_history = [float(g) for g in group["grade"].tolist()]
        quarter_history = group["quarter"].tolist()

        trained = grade_model.forecast(grade_history, attendance_rate, behavioral_score)
        if trained is not None:
            predictions_raw, confidence, margins, model_version = trained
        else:
            predictions_raw, confidence = predict_grades(grade_history)
            margins = [None, None]
        trend = get_trend(grade_history)
        latest_grade = grade_history[-1]
        recommendation = get_recommendation(trend, latest_grade)

        # Build period predictions starting from the next grading period.
        next_q_start = quarter_history[-1] + 1
        quarter_preds = []
        for i, pred_grade in enumerate(predictions_raw[:2]):
            q = ((next_q_start - 1 + i) % periods_per_year) + 1
            quarter_preds.append(QuarterPrediction(
                quarter=q,
                predicted_grade=round(pred_grade, 2),
                confidence=confidence,
                trend=trend,
                margin=margins[i],
            ))

        # Set system-wide alert for high-risk academic performance
        if trend == "Declining" and latest_grade < 75:
            overall_alert = f"⚠️ Student is at academic risk in {subject_name}. Immediate attention needed."

        subject_predictions.append(SubjectPrediction(
            subject_id=str(subject_id),
            subject_name=subject_name,
            historical_grades=[
                {"quarter": int(r.quarter), "grade": float(r.grade)}
                for r in group.itertuples()
            ],
            predictions=quarter_preds,
            overall_trend=trend,
            recommendation=recommendation
        ))

    return PredictionResponse(
        student_id=request.student_id,
        student_name=student.full_name,
        subjects=subject_predictions,
        alert=overall_alert,
        model_version=model_version,
    )