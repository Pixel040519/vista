"""
Write the synthetic school to files.

    cd vista-backend/fastapi-ai
    PYTHONIOENCODING=utf-8 venv/Scripts/python scripts/generate_synthetic.py
    PYTHONIOENCODING=utf-8 venv/Scripts/python scripts/generate_synthetic.py --n 4000 --seed 42

Writes to data/synthetic/ (gitignored — run this again to get the same files):

    learners.csv        one row per fake learner: hidden traits, the bad event if
                        any, and how the year ended (the label)
    risk_rows.csv       what the risk model is trained on: one mid-year snapshot
                        per learner plus the year-end label
    grade_rows.csv      what the grade model is trained on: one row per learner,
                        learning area and period
    demo_school.json    a small dated school for the database seeder,
                        node-api/scripts/seedSyntheticStudents.js

The CSVs are for reading (Excel, an appendix, a sanity check) — the training
script rebuilds the same data in memory from the same seed, so it does not read
them. `ml/synthetic.py` explains how a learner is made.
"""

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml import synthetic  # noqa: E402
from ml.features import RISK_FEATURES  # noqa: E402

OUT = ROOT / "data" / "synthetic"


def write_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=columns)
        w.writeheader()
        for r in rows:
            w.writerow({c: ("" if r.get(c) is None else r.get(c)) for c in columns})


def main(args) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    learners = synthetic.generate_school(args.n, args.seed, args.period_model, args.noise)

    write_csv(OUT / "learners.csv", [{
        "learner_id": lr.id, "grade_level": lr.grade_level,
        "ability": round(lr.ability, 3), "engagement": round(lr.engagement, 3),
        "conduct": round(lr.conduct, 3),
        "bad_event_period": lr.shock_period, "bad_event_severity": round(lr.shock_severity, 3),
        "dropped_out": lr.dropped, "failing_areas": lr.failing_areas if lr.numeric else None,
        "label": lr.label,
    } for lr in learners], ["learner_id", "grade_level", "ability", "engagement", "conduct",
                            "bad_event_period", "bad_event_severity", "dropped_out",
                            "failing_areas", "label"])

    risk = synthetic.risk_rows(learners, args.seed)
    for r in risk:
        for f in RISK_FEATURES:
            if r[f] is not None:
                r[f] = round(r[f], 4)
    write_csv(OUT / "risk_rows.csv", risk,
              ["learner_id", "grade_level", "period"] + RISK_FEATURES + ["label"])

    grade_rows = []
    for s in synthetic.grade_sequences(learners):
        for p, g in enumerate(s["grades"], start=1):
            beh = s["behaviour"][p - 1]
            grade_rows.append({
                "learner_id": s["learner_id"], "area": s["area"], "period": p, "grade": g,
                "attendance_rate": round(s["attendance"][p - 1], 4),
                "behavioral_score": None if beh is None else round(beh, 4),
            })
    write_csv(OUT / "grade_rows.csv", grade_rows,
              ["learner_id", "area", "period", "grade", "attendance_rate", "behavioral_score"])

    demo = synthetic.demo_school(args.demo_n, args.seed + 1000, args.period_model, args.periods_done)
    (OUT / "demo_school.json").write_text(json.dumps(demo, indent=1), encoding="utf-8")

    mix = Counter(lr.label for lr in learners)
    print(f"Fake learners:  {len(learners)}  (seed {args.seed}, {args.period_model}, noise {args.noise})")
    for label in ("Stable", "Moderate Risk", "High Risk"):
        print(f"  {label:<14} {mix[label]:>5}  {mix[label] / len(learners):6.1%}")
    print(f"  had a bad event mid-year: {sum(1 for lr in learners if lr.shock_period)}")
    print(f"  dropped out:              {sum(1 for lr in learners if lr.dropped)}")
    print(f"Risk rows:      {len(risk)}")
    print(f"Grade rows:     {len(grade_rows)}")
    print(f"Demo learners:  {len(demo['learners'])}  ({demo['periods_done']} periods graded)")
    print(f"Written to      {OUT}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Write the synthetic school to data/synthetic/.")
    p.add_argument("--n", type=int, default=4000, help="number of fake learners (default 4000)")
    p.add_argument("--seed", type=int, default=42, help="random seed; same seed = same school")
    p.add_argument("--period-model", choices=["4Q", "3T"], default="4Q")
    p.add_argument("--noise", type=float, default=1.0, help="1.0 = normal; higher = messier grades")
    p.add_argument("--demo-n", type=int, default=150, help="learners in demo_school.json")
    p.add_argument("--periods-done", type=int, default=3,
                   help="grading periods already graded in the demo school")
    main(p.parse_args())
