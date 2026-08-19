from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures
from typing import Optional
import logging

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


class SubjectPrediction(BaseModel):
    subject_id: str
    subject_name: str
    historical_grades: list[dict]
    predictions: list[QuarterPrediction]
    overall_trend: str
    recommendation: Optional[str] = None


class PredictionResponse(BaseModel):
    student_id: str
    student_name: str
    subjects: list[SubjectPrediction]
    alert: Optional[str] = None


# ─── Core Prediction Logic ─────────────────────────────────────
def predict_grades(grade_history: list[float]) -> tuple[list[float], float]:
    """
    Use Linear Regression to predict the next 1-2 quarters.
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
        return "📚 Student is below proficiency. Enrichment activities recommended."
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
    Analyzes historical grade data per subject and forecasts next quarters.
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

    # 3. Fetch grade history
    subject_filter = "AND g.subject_id = CAST(:subject_id AS uuid)" if request.subject_id else ""
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

    # 4. Group by subject and run predictions
    df = pd.DataFrame(grade_rows, columns=["subject_id", "subject_name", "quarter", "school_year", "grade"])
    subject_predictions = []
    overall_alert = None

    for subject_id, group in df.groupby("subject_id"):
        subject_name = group["subject_name"].iloc[0]
        grade_history = group["grade"].tolist()
        quarter_history = group["quarter"].tolist()

        predictions_raw, confidence = predict_grades(grade_history)
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
                trend=trend
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
        alert=overall_alert
    )