"""
Train, test and save VISTA's two models on the synthetic school.

    cd vista-backend/fastapi-ai
    PYTHONIOENCODING=utf-8 venv/Scripts/python scripts/train_models.py
    PYTHONIOENCODING=utf-8 venv/Scripts/python scripts/train_models.py --quick      # skip the sensitivity runs
    PYTHONIOENCODING=utf-8 venv/Scripts/python scripts/train_models.py --no-save    # look, don't overwrite models/

What it does, in plain words:

1. Builds the fake school (`ml/synthetic.py`) from a fixed seed.
2. Hides 20% of the learners. Every model learns from the other 80% and is
   graded only on the hidden ones — a model graded on learners it has already
   seen would be grading its own homework.
3. Risk tier: trains Naive Bayes, and for comparison Logistic Regression and a
   small Decision Tree, and also grades the OLD rule-based check on the same
   hidden learners. The score that matters most is High-Risk recall: of the
   learners whose year really ended badly, how many got the warning.
4. Next grade: trains one Linear Regression, and compares it with "the next
   grade will equal the last one" and with the OLD per-learner curve.
5. Re-runs everything with 5 seeds and 3 noise levels, so a good result can be
   shown not to be a lucky draw.
6. Saves models/risk_nb.json, models/grade_lr.json and models/metrics.json. The
   saved models are the ones trained on the 80%, so the numbers printed here are
   exactly the saved models' test results.

Synthetic data warning: these scores measure whether a model can recover the
patterns `ml/synthetic.py` built in. They are not evidence of accuracy at a real
school, and a paper should say so.
"""

import argparse
import json
import math
import sys
import warnings
from pathlib import Path

import numpy as np
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                             mean_absolute_error, mean_squared_error, precision_score,
                             r2_score, recall_score)
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import GaussianNB
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml import grade_model, risk_model, synthetic  # noqa: E402
from ml.features import GRADE_FEATURES, RISK_FEATURES, RISK_LABELS, WORSE_WHEN_HIGHER, model_inputs  # noqa: E402
from ml.naive_bayes import GaussianNaiveBayes  # noqa: E402
from routers.prediction import predict_grades  # noqa: E402
from routers.risk import rule_based_risk  # noqa: E402

RISK_VERSION = "nb-synth-v2"
GRADE_VERSION = "lr-synth-v1"
HIGH = "High Risk"


# ─── Risk ──────────────────────────────────────────────────────
def risk_matrix(rows):
    """Rows as the model reads them — through model_inputs(), as the live endpoint does."""
    X = np.array([[np.nan if v is None else v for v in (model_inputs(r)[f] for f in RISK_FEATURES)]
                  for r in rows])
    y = np.array([r["label"] for r in rows])
    return X, y


def rules_predict(X):
    col = {f: RISK_FEATURES.index(f) for f in RISK_FEATURES}
    out = []
    for x in X:
        v = lambda f: None if math.isnan(x[col[f]]) else float(x[col[f]])  # noqa: E731
        level, _, _ = rule_based_risk(v("attendance_rate"), v("avg_grade"),
                                      v("behavioral_score"), v("competency_score"))
        out.append(level)
    return np.array(out)


def check_direction(nb: GaussianNaiveBayes, X) -> list[str]:
    """
    Each input on its own must only ever push toward risk as it gets WORSE.
    A bell curve judges how unusual a value is in either direction, so a class
    whose values spread widest can make a very good value look like a risk sign
    — which is exactly how a signed grade trend once counted a big improvement
    against a learner. Walks each input across its observed range (1st-99th
    percentile) with every other input missing, and reports any stretch where
    the risk score (P(Moderate)/2 + P(High)) falls as the value gets worse.
    """
    problems = []
    for fi, f in enumerate(RISK_FEATURES):
        col = X[:, fi]
        col = col[~np.isnan(col)]
        lo, hi = np.percentile(col, [1, 99])
        grid = np.linspace(lo, hi, 60)
        if f not in WORSE_WHEN_HIGHER:
            grid = grid[::-1]                       # walk from good to bad
        scores = []
        for v in grid:
            x = [np.nan] * len(RISK_FEATURES)
            x[fi] = v
            p = nb.predict_proba_one(x)
            scores.append(p["Moderate Risk"] * 0.5 + p["High Risk"])
        drops = [(grid[i], scores[i] - scores[i + 1]) for i in range(len(scores) - 1)
                 if scores[i] - scores[i + 1] > 0.01]
        if drops:
            worst = max(drops, key=lambda d: d[1])
            problems.append(f"{f}: risk falls as it worsens near {worst[0]:.3f} (by {worst[1]:.3f})")
    return problems


def classifier_scores(y_true, y_pred) -> dict:
    return {
        "accuracy": round(accuracy_score(y_true, y_pred), 4),
        "macro_f1": round(f1_score(y_true, y_pred, labels=RISK_LABELS, average="macro", zero_division=0), 4),
        "high_risk_recall": round(recall_score(y_true, y_pred, labels=[HIGH], average="macro", zero_division=0), 4),
        "high_risk_precision": round(precision_score(y_true, y_pred, labels=[HIGH], average="macro", zero_division=0), 4),
    }


def train_risk(learners, seed):
    rows = synthetic.risk_rows(learners, seed)
    X, y = risk_matrix(rows)
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, stratify=y, random_state=seed)

    nb = GaussianNaiveBayes().fit(X_tr, y_tr, RISK_LABELS, RISK_FEATURES)
    # Logistic Regression and the tree cannot read a blank, so they get blanks
    # filled with the median plus a yes/no "was missing" column per input.
    logreg = make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(),
                           LogisticRegression(max_iter=2000)).fit(X_tr, y_tr)
    tree = make_pipeline(SimpleImputer(strategy="median", add_indicator=True),
                         DecisionTreeClassifier(max_depth=4, random_state=seed)).fit(X_tr, y_tr)

    preds = {
        "Rule-based check (old)": rules_predict(X_te),
        "Naive Bayes": np.array(nb.predict(X_te)),
        "Logistic Regression": logreg.predict(X_te),
        "Decision Tree (depth 4)": tree.predict(X_te),
    }
    scores = {name: classifier_scores(y_te, p) for name, p in preds.items()}
    cm = confusion_matrix(y_te, preds["Naive Bayes"], labels=RISK_LABELS).tolist()
    sizes = {"train": int(len(y_tr)), "test": int(len(y_te))}
    return nb, scores, cm, sizes, (X_tr, y_tr, X_te)


def check_nb_against_sklearn(X_tr, y_tr, X_te) -> dict:
    """
    Our Naive Bayes must equal sklearn's wherever nothing is missing. No learner
    has both grades and competency ratings, so the check uses the four inputs a
    graded learner can have all of, on the rows where all four are present.
    """
    cols = [RISK_FEATURES.index(f) for f in ("attendance_rate", "avg_grade", "grade_drop", "behavioral_score")]
    tr = ~np.isnan(X_tr[:, cols]).any(axis=1)
    te = ~np.isnan(X_te[:, cols]).any(axis=1)
    Xa, ya, Xb = X_tr[tr][:, cols], y_tr[tr], X_te[te][:, cols]
    ours = GaussianNaiveBayes().fit(Xa, ya, RISK_LABELS, [RISK_FEATURES[c] for c in cols])
    theirs = GaussianNB().fit(Xa, ya)
    order = [list(theirs.classes_).index(c) for c in RISK_LABELS]
    p_ours = ours.predict_proba(Xb)
    p_theirs = theirs.predict_proba(Xb)[:, order]
    agree = float(np.mean(np.array(ours.predict(Xb)) == theirs.predict(Xb)))
    return {"rows": int(len(Xb)), "same_answer": round(agree, 4),
            "max_probability_difference": float(np.abs(p_ours - p_theirs).max())}


# ─── Grades ────────────────────────────────────────────────────
def grade_examples(seqs, step: int):
    """
    (X, y, histories) for predicting the grade `step` periods after period t.
    X rows are GRADE_FEATURES at period t; histories are the grades up to t.
    """
    X, y, hist = [], [], []
    for s in seqs:
        g = s["grades"]
        for t in range(1, len(g) - step + 1):          # t is 1-based
            beh = s["behaviour"][t - 1]
            X.append([g[t - 1], g[t - 2] if t >= 2 else g[t - 1],
                      s["attendance"][t - 1], 0.0 if beh is None else beh])
            y.append(g[t - 1 + step])
            hist.append(g[:t])
    return np.array(X, dtype=float), np.array(y, dtype=float), hist


def regression_scores(y_true, y_pred) -> dict:
    return {
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 3),
        "rmse": round(float(math.sqrt(mean_squared_error(y_true, y_pred))), 3),
        "r2": round(float(r2_score(y_true, y_pred)), 4),
    }


def train_grades(learners, seed):
    seqs = synthetic.grade_sequences(learners)
    ids = sorted({s["learner_id"] for s in seqs})
    rng = np.random.default_rng(seed)
    test_ids = set(rng.choice(ids, size=len(ids) // 5, replace=False).tolist())
    train = [s for s in seqs if s["learner_id"] not in test_ids]
    test = [s for s in seqs if s["learner_id"] in test_ids]

    X_tr, y_tr, _ = grade_examples(train, 1)
    lr = LinearRegression().fit(X_tr, y_tr)
    model = {"intercept": float(lr.intercept_), "coef": [float(c) for c in lr.coef_],
             "features": GRADE_FEATURES,
             "fill": {"attendance_rate": round(float(X_tr[:, 2].mean()), 4), "behavioral_score": 0.0}}

    results = {}
    for step in (1, 2):
        X_te, y_te, hist = grade_examples(test, step)
        if not len(y_te):
            continue
        if step == 1:
            ours = grade_model.predict_rows(model, X_te)
        else:
            ours = []
            for x in X_te:
                first = grade_model.predict_rows(model, [x])[0]
                ours.append(grade_model.predict_rows(model, [[first, x[0], x[2], x[3]]])[0])
        old = []
        for h in hist:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                old.append(predict_grades([float(v) for v in h])[0][step - 1])
        results[step] = {
            "Linear Regression (new)": regression_scores(y_te, ours),
            "Same as last grade": regression_scores(y_te, X_te[:, 0]),
            "Per-learner curve (old)": regression_scores(y_te, old),
            "examples": int(len(y_te)),
        }
    sizes = {"train_learners": len(ids) - len(test_ids), "test_learners": len(test_ids),
             "train_examples": int(len(y_tr))}
    return model, results, sizes


# ─── Sensitivity ───────────────────────────────────────────────
def sensitivity(n, period_model, seeds=(1, 2, 3, 4, 5), noises=(0.5, 1.0, 1.5)):
    table = []
    for noise in noises:
        runs = []
        for seed in seeds:
            learners = synthetic.generate_school(n, seed, period_model, noise)
            _, rs, _, _, _ = train_risk(learners, seed)
            _, gs, _ = train_grades(learners, seed)
            runs.append({
                "nb_macro_f1": rs["Naive Bayes"]["macro_f1"],
                "rules_macro_f1": rs["Rule-based check (old)"]["macro_f1"],
                "nb_high_recall": rs["Naive Bayes"]["high_risk_recall"],
                "lr_rmse": gs[1]["Linear Regression (new)"]["rmse"],
                "last_grade_rmse": gs[1]["Same as last grade"]["rmse"],
            })
            print(".", end="", flush=True)
        summary = {k: {"mean": round(float(np.mean([r[k] for r in runs])), 4),
                       "sd": round(float(np.std([r[k] for r in runs])), 4)} for k in runs[0]}
        table.append({"noise": noise, "seeds": list(seeds), **summary})
    print()
    return table


# ─── Report ────────────────────────────────────────────────────
def print_risk(scores, cm, check, sizes):
    print(f"\nRISK TIER  (trained on {sizes['train']} learners, tested on {sizes['test']} hidden ones)")
    print(f"  {'model':<26}{'accuracy':>10}{'macro F1':>10}{'High recall':>13}{'High precision':>16}")
    for name, s in scores.items():
        print(f"  {name:<26}{s['accuracy']:>10.3f}{s['macro_f1']:>10.3f}"
              f"{s['high_risk_recall']:>13.3f}{s['high_risk_precision']:>16.3f}")
    print("\n  Naive Bayes confusion matrix (rows = how the year really ended, columns = model's guess)")
    print(f"  {'':<16}" + "".join(f"{c:>15}" for c in RISK_LABELS))
    for label, line in zip(RISK_LABELS, cm):
        print(f"  {label:<16}" + "".join(f"{v:>15}" for v in line))
    print(f"\n  Check vs sklearn GaussianNB on {check['rows']} complete rows: "
          f"same answer {check['same_answer']:.1%}, "
          f"largest probability difference {check['max_probability_difference']:.2e}")


def print_grades(model, results, sizes):
    print(f"\nNEXT GRADE  (trained on {sizes['train_learners']} learners, "
          f"tested on {sizes['test_learners']} hidden ones)")
    names = dict(zip(GRADE_FEATURES, model["coef"]))
    print("  learned recipe: next grade = "
          + " + ".join(f"{c:.3f} x {f}" for f, c in names.items())
          + f" + {model['intercept']:.2f}")
    for step, res in results.items():
        print(f"\n  {step} period(s) ahead  ({res['examples']} test examples; lower MAE/RMSE is better)")
        print(f"  {'method':<26}{'MAE':>8}{'RMSE':>8}{'R2':>8}")
        for name, s in res.items():
            if name == "examples":
                continue
            print(f"  {name:<26}{s['mae']:>8.2f}{s['rmse']:>8.2f}{s['r2']:>8.3f}")


def print_sensitivity(table):
    print("\nSENSITIVITY  (mean +/- sd over 5 seeds at each noise level)")
    print(f"  {'noise':<7}{'NB macro F1':>16}{'rules macro F1':>18}{'NB High recall':>18}"
          f"{'LR RMSE':>16}{'last-grade RMSE':>18}")
    for t in table:
        cell = lambda k: f"{t[k]['mean']:.3f}+/-{t[k]['sd']:.3f}"  # noqa: E731
        print(f"  {t['noise']:<7}{cell('nb_macro_f1'):>16}{cell('rules_macro_f1'):>18}"
              f"{cell('nb_high_recall'):>18}{cell('lr_rmse'):>16}{cell('last_grade_rmse'):>18}")


def main(args):
    learners = synthetic.generate_school(args.n, args.seed, args.period_model)
    mix = synthetic.label_mix(learners)
    print(f"Synthetic school: {args.n} learners, seed {args.seed}, {args.period_model}  "
          + ", ".join(f"{k} {v}" for k, v in mix.items()))

    nb, risk_scores, cm, risk_sizes, (X_tr, y_tr, X_te) = train_risk(learners, args.seed)
    check = check_nb_against_sklearn(X_tr, y_tr, X_te)
    print_risk(risk_scores, cm, check, risk_sizes)
    direction = check_direction(nb, X_tr)
    print("  Direction check (each input alone, risk must not fall as it worsens): "
          + ("passed" if not direction else "FAILED"))

    lr_model, grade_results, grade_sizes = train_grades(learners, args.seed)
    print_grades(lr_model, grade_results, grade_sizes)

    table = None
    if not args.quick:
        print("\nRunning sensitivity checks", end="", flush=True)
        table = sensitivity(args.n // 2, args.period_model)
        print_sensitivity(table)

    # ── warnings a person should not miss ──
    problems = []
    if check["same_answer"] < 1.0 or check["max_probability_difference"] > 1e-6:
        problems.append("Naive Bayes does not match sklearn on complete rows")
    problems += [f"direction check — {d}" for d in direction]
    if risk_scores["Naive Bayes"]["macro_f1"] <= risk_scores["Rule-based check (old)"]["macro_f1"]:
        problems.append("Naive Bayes does not beat the old rules on macro F1")
    r1 = grade_results[1]
    if r1["Linear Regression (new)"]["rmse"] >= r1["Same as last grade"]["rmse"]:
        problems.append("Linear Regression does not beat 'same as last grade'")
    for p in problems:
        print(f"\nWARNING: {p}")

    training_data = {"source": "synthetic (ml/synthetic.py)", "learners": args.n,
                     "seed": args.seed, "period_model": args.period_model, "label_mix": mix}
    if args.no_save:
        print("\n--no-save: models/ left as it was.")
        return

    nb_metrics = {**risk_scores["Naive Bayes"], "confusion_matrix": {"labels": RISK_LABELS, "rows": cm},
                  **risk_sizes}
    risk_path = risk_model.save(nb, RISK_VERSION, training_data, nb_metrics)
    lr_new_1 = grade_results[1]["Linear Regression (new)"]
    lr_new_2 = grade_results.get(2, {}).get("Linear Regression (new)", lr_new_1)
    grade_path = grade_model.save(
        lr_model["intercept"], lr_model["coef"], lr_model["fill"], GRADE_VERSION, training_data,
        {"r2": lr_new_1["r2"], "mae": lr_new_1["mae"],
         "rmse_by_step": [lr_new_1["rmse"], lr_new_2["rmse"]], **grade_sizes})
    metrics_path = ROOT / "models" / "metrics.json"
    metrics_path.write_text(json.dumps({
        "training_data": training_data,
        "risk": {"comparison": risk_scores, "naive_bayes_confusion_matrix": cm,
                 "sklearn_check": check, "direction_check": direction or "passed", **risk_sizes},
        "grades": {"comparison_by_steps_ahead": grade_results, **grade_sizes},
        "sensitivity": table,
    }, indent=2), encoding="utf-8")
    print(f"\nSaved {risk_path.name}, {grade_path.name}, {metrics_path.name} in {risk_path.parent}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Train and test VISTA's models on synthetic data.")
    p.add_argument("--n", type=int, default=4000)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--period-model", choices=["4Q", "3T"], default="4Q")
    p.add_argument("--quick", action="store_true", help="skip the sensitivity runs")
    p.add_argument("--no-save", action="store_true", help="print results without writing models/")
    main(p.parse_args())
