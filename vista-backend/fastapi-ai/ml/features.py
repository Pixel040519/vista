"""
The inputs the trained models read, in the order they read them.

Training (`scripts/train_models.py`, from the synthetic school) and the live
endpoints (`routers/risk.py`, `routers/prediction.py`, from the database) both
build their rows through this module, so the two can never disagree about what a
column means. Change a feature here and the saved models must be retrained:
the model files record the list they were trained on, and loading one whose list
differs is refused (see risk_model.py / grade_model.py).

What `routers/risk.py:extract_features()` measures (the raw features):

    attendance_rate   0-1, Present / all attendance records, last 30 days
    avg_grade         60-100, the average of each learning area's latest grade
                      in the active school year (MAPEH counted once)
    grade_trend       average change in the learning areas graded in both of
                      the last two periods; negative = falling
    behavioral_score  -1..+1, average VADER compound of this month's behaviour notes
    competency_score  0-1, average rating weight of the latest period
                      (descriptively assessed learners only)

Any of them may be None: a Kinder learner has no grades, a Grade 3 learner has
no competency ratings, and most learners have no behaviour notes in a given
month. None means "no information", never zero.

The model does not read grade_trend as it is. It reads `grade_drop` — how many
points the grades FELL, 0 when they held or rose (see model_inputs()). A bell
curve judges a value by how unusual it is, in either direction, and in the
training data the High-Risk learners' trends spread widest — so a signed trend
let a big IMPROVEMENT count as a sign of risk. Rising grades are not a risk
sign, so the model is never shown them as anything but "no drop".
"""

RISK_FEATURES = [
    "attendance_rate",
    "avg_grade",
    "grade_drop",
    "behavioral_score",
    "competency_score",
]

# Which way is worse, per model input. Used to keep a factor from being listed
# when the value is on the good side (see risk_model.predict()).
WORSE_WHEN_HIGHER = {"grade_drop"}

RISK_LABELS = ["Stable", "Moderate Risk", "High Risk"]

PASSING_GRADE = 75   # DepEd, every grading policy VISTA supports

# Next-period grade: the two latest grades in the subject, then the learner's
# recent attendance and behaviour. Missing behaviour is filled as 0.0 (neutral)
# and missing attendance with the training mean — see grade_model.py.
GRADE_FEATURES = [
    "grade_last",
    "grade_before",
    "attendance_rate",
    "behavioral_score",
]

# Words a person reads on the risk card. One line per feature, used when that
# feature is what pushed a learner toward risk.
FACTOR_NAMES = {
    "attendance_rate":  "Attendance",
    "avg_grade":        "Academic Performance",
    "grade_drop":       "Falling Grades",
    "behavioral_score": "Behavioral/Emotional",
    "competency_score": "ECE Competency",
}


def model_inputs(raw: dict) -> dict:
    """The raw features as the model reads them (grade_trend -> grade_drop)."""
    trend = raw.get("grade_trend")
    return {
        "attendance_rate": raw.get("attendance_rate"),
        "avg_grade": raw.get("avg_grade"),
        "grade_drop": None if trend is None else max(0.0, -trend),
        "behavioral_score": raw.get("behavioral_score"),
        "competency_score": raw.get("competency_score"),
    }


def _subjects(n: int) -> str:
    return f"{n} learning area{'' if n == 1 else 's'}"


def describe(feature: str, value: float, detail: dict | None = None) -> str:
    """
    One plain sentence about a feature's value, for the risk card. `detail` is
    the academic breakdown extract_features() returns, so the sentence can say
    how many learning areas a figure stands on and name the failing ones.
    """
    detail = detail or {}
    if feature == "attendance_rate":
        return f"Marked present in {value * 100:.0f}% of classes over the last 30 days"
    if feature == "avg_grade":
        text = f"Average grade is {value:.1f}"
        if detail.get("subjects"):
            text += f" across {_subjects(detail['subjects'])}"
        failing = detail.get("failing") or []
        if failing:
            text += f"; below {PASSING_GRADE} in {', '.join(failing)}"
        return text
    if feature == "grade_drop":
        n = detail.get("trend_subjects")
        across = f" across {_subjects(n)}" if n else ""
        text = f"Grades fell an average of {value:.1f} points since the previous period{across}"
        steepest = detail.get("steepest_drop")
        if steepest:
            text += f"; steepest in {steepest[0]} ({steepest[1]:+.0f})"
        return text
    if feature == "behavioral_score":
        return f"Behaviour notes this month lean negative (average tone {value:+.2f})"
    if feature == "competency_score":
        return f"Competency ratings average {value * 100:.0f}%"
    return f"{feature} = {value}"


def row(values: dict, features: list[str] = RISK_FEATURES) -> list:
    """A feature dict as a list in model order, None kept as None."""
    return [values.get(f) for f in features]
