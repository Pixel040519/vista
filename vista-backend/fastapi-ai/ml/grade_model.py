"""
Next-period grade from the trained Linear Regression.

One model learned from thousands of learners, instead of a curve fitted to one
learner's 2-4 grades. In plain words it learned a recipe like

    next grade ~ a * last grade + b * grade before + c * attendance + d * behaviour + e

and the numbers a..e are what `models/grade_lr.json` holds — small enough to read.

Two periods ahead is predicted by feeding the first prediction back in as
"last grade". Each prediction carries a `margin`: the typical miss (RMSE) the
model made on learners it never saw during training, one and two periods ahead.
`confidence` is the model's R² on those same learners — one honest number for the
model as a whole, rather than a per-learner R² that reads 100% whenever a curve
passes through three points.

`forecast()` answers None when there is no usable model, and
`routers/prediction.py` falls back to its old per-learner curve.
"""

import json
import logging
from datetime import datetime
from pathlib import Path

from ml.features import GRADE_FEATURES

logger = logging.getLogger("vista-ai.grade-model")

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "grade_lr.json"
GRADE_MIN, GRADE_MAX = 60.0, 100.0

_state = {"checked_mtime": None, "model": None}


def _load():
    try:
        mtime = MODEL_PATH.stat().st_mtime
    except FileNotFoundError:
        _state.update(checked_mtime="missing", model=None)
        return None
    if _state["checked_mtime"] == mtime:
        return _state["model"]
    _state["checked_mtime"] = mtime
    try:
        data = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
        if data.get("features") != GRADE_FEATURES:
            raise ValueError(f"model features {data.get('features')} != {GRADE_FEATURES}; retrain")
        _state["model"] = data
        logger.info("Loaded grade model %s", data.get("version"))
    except Exception as exc:
        logger.warning("Could not load %s (%s); forecasts use the per-learner curve.", MODEL_PATH.name, exc)
        _state["model"] = None
    return _state["model"]


def _one_step(m: dict, last: float, before: float, attendance: float, behaviour: float) -> float:
    x = {"grade_last": last, "grade_before": before,
         "attendance_rate": attendance, "behavioral_score": behaviour}
    y = m["intercept"] + sum(c * x[f] for c, f in zip(m["coef"], m["features"]))
    return min(GRADE_MAX, max(GRADE_MIN, y))


def fill(m: dict, attendance: float | None, behaviour: float | None) -> tuple[float, float]:
    """Missing attendance -> the training average; no behaviour notes -> neutral (0)."""
    return (m["fill"]["attendance_rate"] if attendance is None else attendance,
            m["fill"]["behavioral_score"] if behaviour is None else behaviour)


def forecast(history: list[float], attendance: float | None, behaviour: float | None):
    """
    (predictions[2], confidence, margins[2], model_version), or None when no
    trained model is available.
    """
    m = _load()
    if m is None or not history:
        return None
    att, beh = fill(m, attendance, behaviour)
    last = float(history[-1])
    before = float(history[-2]) if len(history) >= 2 else last
    first = _one_step(m, last, before, att, beh)
    second = _one_step(m, first, last, att, beh)
    return [first, second], m["test_metrics"]["r2"], m["test_metrics"]["rmse_by_step"], m["version"]


def predict_rows(m: dict, X) -> list[float]:
    """Raw one-step predictions for rows already in GRADE_FEATURES order (training/eval)."""
    return [min(GRADE_MAX, max(GRADE_MIN, m["intercept"] + sum(c * v for c, v in zip(m["coef"], r))))
            for r in X]


def save(intercept: float, coef: list[float], fill_values: dict, version: str,
         training_data: dict, test_metrics: dict) -> Path:
    data = {
        "type": "linear_regression",
        "version": version,
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "features": GRADE_FEATURES,
        "intercept": float(intercept),
        "coef": [float(c) for c in coef],
        "fill": fill_values,
        "training_data": training_data,
        "test_metrics": test_metrics,
    }
    MODEL_PATH.parent.mkdir(exist_ok=True)
    MODEL_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return MODEL_PATH
