"""
Risk tier from the trained Naive Bayes model.

`predict()` answers None when there is no usable model file, and the caller
(`routers/risk.py`) then falls back to the old rule-based check — so deleting or
breaking `models/risk_nb.json` can never take the risk pages down.

How the answer is built from the model's three probabilities:

    risk_level  the most likely class
    risk_score  P(Moderate) * 0.5 + P(High), 0-1 — "how serious, on average".
                Same range and meaning as the old rules' score, so the bars and
                sorting on the risk pages keep working.
    factors     the inputs that pushed this learner toward the tier they got,
                strongest first, in the same {factor, severity, description}
                shape as before. A Moderate or High verdict always lists every
                input that pushed it there (severity Low when the push was
                small), so the card can never show a risk tier with nothing to
                explain it. A Stable learner lists only strong pushes — things
                worth watching even though the overall picture is fine.
"""

import json
import logging
from datetime import datetime
from pathlib import Path

from ml.features import FACTOR_NAMES, RISK_FEATURES, WORSE_WHEN_HIGHER, describe, model_inputs, row
from ml.naive_bayes import GaussianNaiveBayes

logger = logging.getLogger("vista-ai.risk-model")

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "risk_nb.json"

# A push is a log-likelihood ratio (see GaussianNaiveBayes.explain):
# 0.7 ~ the value is twice as typical of an at-risk learner, 2.0 ~ seven times.
MEDIUM_PUSH = 0.7
HIGH_PUSH = 2.0

_state = {"checked_mtime": None, "model": None, "meta": None}


def _load():
    """Load the model file once, and again only if the file changes."""
    try:
        mtime = MODEL_PATH.stat().st_mtime
    except FileNotFoundError:
        if _state["checked_mtime"] != "missing":
            logger.info("No %s; risk uses the rule-based check.", MODEL_PATH.name)
        _state.update(checked_mtime="missing", model=None, meta=None)
        return None
    if _state["checked_mtime"] == mtime:
        return _state["model"]

    _state["checked_mtime"] = mtime
    try:
        data = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
        if data.get("features") != RISK_FEATURES:
            raise ValueError(f"model features {data.get('features')} != {RISK_FEATURES}; retrain")
        _state["model"] = GaussianNaiveBayes.from_dict(data)
        _state["meta"] = {k: data.get(k) for k in ("version", "trained_at", "training_data", "test_metrics")}
        logger.info("Loaded risk model %s", data.get("version"))
    except Exception as exc:  # a bad file must fall back, never crash a request
        logger.warning("Could not load %s (%s); risk uses the rule-based check.", MODEL_PATH.name, exc)
        _state.update(model=None, meta=None)
    return _state["model"]


def model_info() -> dict | None:
    return _state["meta"] if _load() else None


def predict(features: dict):
    """
    (risk_level, risk_score, factors, probabilities, model_version), or None
    when no trained model is available.
    """
    model = _load()
    if model is None:
        return None
    version = _state["meta"]["version"]

    inputs = model_inputs(features)
    x = row(inputs)
    if all(v is None for v in x):
        # Nothing to judge from — same answer the rules give.
        return "Stable", 0.0, [], None, version

    proba = model.predict_proba_one(x)
    level = max(proba, key=proba.get)
    score = round(proba.get("Moderate Risk", 0.0) * 0.5 + proba.get("High Risk", 0.0), 4)

    # Which inputs to list: for a Moderate or High learner, everything that
    # pushed them toward the tier they got (a Moderate learner is explained by
    # what made them look Moderate rather than Stable); for a Stable learner,
    # only inputs pushing hard toward High — a single alarming input worth
    # watching. How SEVERE an input is, though, is always measured against the
    # same yardstick (High vs Stable), so one value reads the same on every card:
    # 70% attendance is never "Medium" on one learner and "High" on the next.
    toward = level if level != "Stable" else "High Risk"
    floor = 0.0 if level != "Stable" else MEDIUM_PUSH
    detail = features.get("academic_detail")

    factors = []
    pushes = model.explain(x, toward=toward, away_from="Stable")
    severity_push = model.explain(x, toward="High Risk", away_from="Stable")
    for feature, push in sorted(pushes.items(), key=lambda kv: -kv[1]):
        value = inputs[feature]
        if push <= floor or not _worse_than_typical(model, feature, value):
            continue
        strength = severity_push[feature]
        factors.append({
            "factor": FACTOR_NAMES[feature],
            "severity": "High" if strength >= HIGH_PUSH else "Medium" if strength >= MEDIUM_PUSH else "Low",
            "description": describe(feature, value, detail),
        })

    return level, score, factors, {k: round(v, 4) for k, v in proba.items()}, version


# VADER's neutral band (routers/sentiment.py compound_to_sentiment): a tone
# inside it is not negative, however far below the average Stable learner.
NEUTRAL_TONE = -0.1


def _worse_than_typical(model: GaussianNaiveBayes, feature: str, value: float) -> bool:
    """
    Is the value on the bad side of a typical Stable learner? A bell curve can
    call a very GOOD value "unusual for Stable" too, and telling a teacher that
    perfect attendance is a risk sign is nonsense. Behaviour must also be
    actually negative: all-neutral notes sit below the Stable average (+0.10)
    but saying they "lean negative" would be false.
    """
    typical = model.class_mean("Stable", feature)
    if feature in WORSE_WHEN_HIGHER:
        return value > typical
    if feature == "behavioral_score" and value > NEUTRAL_TONE:
        return False
    return value < typical


def save(model: GaussianNaiveBayes, version: str, training_data: dict, test_metrics: dict) -> Path:
    data = model.to_dict()
    data.update({
        "version": version,
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "training_data": training_data,
        "test_metrics": test_metrics,
    })
    MODEL_PATH.parent.mkdir(exist_ok=True)
    MODEL_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return MODEL_PATH
