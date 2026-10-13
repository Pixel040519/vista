"""
A fake school to train the models on, because there is no real data yet.

How a fake learner is made, in plain words:

1. Every learner secretly gets three traits — how good at school they are
   (ability), how often they show up (engagement), how they behave (conduct).
   The three are mildly related, as they are in real classrooms.
2. Some learners get a "bad event" partway through the year (a family problem,
   an illness). From that period on their attendance, grades and behaviour drop.
   An event that happens *after* the moment we look at a learner cannot be
   seen in their numbers yet — which is exactly why no model can be 100% right,
   and why this data is not too easy.
3. From the traits we produce what VISTA records: daily attendance, a final grade
   per learning area per period (MAPEH = the average of its four areas, as DO 8
   says), competency ratings for Kinder, and teacher behaviour notes. The notes
   are real sentences scored by VISTA's own VADER analyzer, so the behaviour
   numbers are made exactly the way the live system makes them.
4. How the year ENDS decides the label, using the DepEd promotion rule the
   Year-End Promotion wizard uses (DO 8, s. 2015 Table 10):
       no failing learning area     -> Stable
       1-2 failing learning areas   -> Moderate Risk
       3+ failing, or dropped out   -> High Risk
   Kinder has no grades, so its label comes from its last competency ratings.
5. The model is shown the learner's numbers from the MIDDLE of the year and has
   to guess that label: an early warning, not a description of today.

Every number below is a modelling choice. The ones grounded in DepEd rules are
marked; the rest are plausible assumptions, and a paper using this data should
say so. Change them and retrain — the training script reports how sensitive the
results are to the noise level.
"""

import math
from dataclasses import dataclass, field

import numpy as np

from ml.features import RISK_LABELS

# ─── Curriculum (mirrors the active school year's subjects) ─────
LOWER_AREAS = ["Araling Panlipunan", "Character Education", "English",
               "Filipino", "Mathematics", "Science", "MAPEH"]
UPPER_AREAS = LOWER_AREAS + ["EPP"]          # Grades 4-6 add EPP
MAPEH_AREAS = ["Music", "Arts", "Physical Education", "Health"]
NUMERIC_GRADES = ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"]
GRADE_LEVELS = ["Kinder"] + NUMERIC_GRADES

PASSING_GRADE = 75                            # DepEd DO 8, s. 2015
GRADE_FLOOR = 60                              # lowest transmuted grade under DO 8

# Kinder ratings on E/G/F/NA. Weights mirror RATING_SCALE_WEIGHTS in routers/risk.py.
EGFNA = ["E", "G", "F", "NA"]
EGFNA_WEIGHT = {"E": 1.0, "G": 0.75, "F": 0.5, "NA": 0.25}
KINDER_SKILLS = 10

# A school year is ~200 days. "Last 30 days" in the live system is ~20 school days.
SCHOOL_DAYS = {"4Q": 50, "3T": 66}
PERIODS = {"4Q": 4, "3T": 3}
RECENT_DAYS = 20

# ─── Teacher notes (scored by the real VADER at generation time) ─
NOTES = {
    "Positive": [
        "Helped a classmate finish the activity.",
        "Participated actively during the group discussion.",
        "Completed all seatwork on time and with care.",
        "Shared materials kindly with seatmates.",
        "Showed great improvement in reading today.",
        "Was focused and engaged throughout the lesson.",
        "Volunteered to answer and explained the solution clearly.",
        "Cooperative and respectful during group work.",
        "Proudly presented the project to the class.",
        "Followed classroom rules and encouraged others to do the same.",
    ],
    "Neutral": [
        "Was quiet during the lesson today.",
        "Submitted the assignment.",
        "Asked to go to the clinic in the afternoon.",
        "Sat with a new group for the activity.",
        "Brought a note from the parent about the schedule.",
        "Moved to the front row for the lesson.",
        "Worked on the activity with a partner.",
        "Read the story aloud when called.",
    ],
    "Negative": [
        "Refused to do the seatwork.",
        "Was disruptive and talked during the lesson.",
        "Fought with a classmate during recess.",
        "Cried and seemed anxious the whole morning.",
        "Did not submit the assignment again.",
        "Was withdrawn and did not join the group activity.",
        "Arrived late and seemed tired and distracted.",
        "Was rude to a classmate and needs to apologize.",
        "Kept sleeping in class and missed the instructions.",
        "Bullied a younger pupil at recess.",
    ],
}
NOTE_CATEGORIES = ["Academic", "Social", "Emotional"]

SURNAMES = ["Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza",
            "Torres", "Villanueva", "Ramos", "Aquino", "Navarro", "Castillo",
            "Flores", "Domingo", "Gonzales", "Mercado", "Pascual", "Salazar",
            "Tolentino", "Dizon", "Manalo", "Lim", "Soriano", "Valdez"]
FIRST_MALE = ["Juan", "Miguel", "Gabriel", "Rafael", "Joshua", "Paolo", "Carlo",
              "Nathan", "Ethan", "Lorenzo", "Andres", "Marco", "Daniel", "Elijah"]
FIRST_FEMALE = ["Maria", "Angela", "Sofia", "Andrea", "Bea", "Camille", "Isabel",
                "Patricia", "Althea", "Bianca", "Nicole", "Samantha", "Hannah", "Mika"]

_scored_notes: dict | None = None


def scored_notes() -> dict:
    """Each bank sentence with VADER's real reading, computed once."""
    global _scored_notes
    if _scored_notes is None:
        from routers.sentiment import compound_to_sentiment, polarity
        _scored_notes = {}
        for tone, sentences in NOTES.items():
            out = []
            for s in sentences:
                compound = round(polarity(s)["compound"], 4)
                label, _ = compound_to_sentiment(compound)
                out.append({"text": s, "score": compound, "sentiment": label})
            _scored_notes[tone] = out
    return _scored_notes


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def round_half_up(x: float) -> int:
    """How a grade is rounded on a report card (Python's round() goes to even)."""
    return int(math.floor(x + 0.5))


@dataclass
class Learner:
    id: int
    grade_level: str
    ability: float
    engagement: float
    conduct: float
    shock_period: int | None
    shock_severity: float
    periods: int
    days: list = field(default_factory=list)       # per period: list of statuses
    grades: dict = field(default_factory=dict)     # area -> [grade per period]
    area_grades: dict = field(default_factory=dict)  # MAPEH area -> [grade per period]
    ratings: list = field(default_factory=list)    # per period: list of EGFNA codes
    notes: list = field(default_factory=list)      # per period: list of (day, note)
    dropped: bool = False
    label: str = "Stable"
    failing_areas: int = 0

    @property
    def numeric(self) -> bool:
        return self.grade_level != "Kinder"


def make_learner(i: int, rng: np.random.Generator, period_model: str = "4Q",
                 noise: float = 1.0, shock_rate: float = 0.15,
                 grade_level: str | None = None) -> Learner:
    P = PERIODS[period_model]
    D = SCHOOL_DAYS[period_model]
    ability, engagement, conduct = rng.multivariate_normal(
        [0, 0, 0], [[1, .35, .30], [.35, 1, .35], [.30, .35, 1]])
    shock = rng.random() < shock_rate
    lr = Learner(
        id=i,
        grade_level=grade_level or GRADE_LEVELS[int(rng.integers(len(GRADE_LEVELS)))],
        ability=float(ability), engagement=float(engagement), conduct=float(conduct),
        shock_period=int(rng.integers(2, P + 1)) if shock else None,
        shock_severity=float(rng.uniform(0.6, 1.6)) if shock else 0.0,
        periods=P,
    )

    drift = rng.normal(0, 0.8)                      # grade points per period
    areas = (UPPER_AREAS if lr.grade_level in ("Grade 4", "Grade 5", "Grade 6")
             else LOWER_AREAS) if lr.numeric else []
    # A learner is stronger in some subjects than others.
    offsets = {a: rng.normal(0, 4.0) for a in areas + MAPEH_AREAS}
    attended_frac = []
    # Missed lessons keep costing in later periods: grades follow a running
    # mix of this period's attendance and the earlier ones, not this period alone.
    carried = None

    for p in range(1, P + 1):
        sh = lr.shock_severity if (lr.shock_period and p >= lr.shock_period) else 0.0
        eng = lr.engagement - 1.3 * sh
        abil = lr.ability - 0.7 * sh
        cond = lr.conduct - 0.9 * sh

        # Daily attendance. Only 'Present' counts as present in the live
        # attendance rate, so Late is kept as its own status here too.
        p_here = _sigmoid(2.9 + 0.9 * eng)
        statuses = []
        for _ in range(D):
            if rng.random() < p_here:
                statuses.append("Late" if rng.random() < 0.04 else "Present")
            else:
                statuses.append("Excused" if rng.random() < 0.25 else "Absent")
        lr.days.append(statuses)
        here = sum(s in ("Present", "Late") for s in statuses) / D
        attended_frac.append(here)
        carried = here if carried is None else 0.5 * carried + 0.5 * here

        if lr.numeric:
            def grade(area):
                g = (85 + 5.5 * abil + offsets[area] + drift * (p - 1)
                     + 30 * (carried - 0.93) + rng.normal(0, 2.0 * noise))
                return round_half_up(min(100, max(GRADE_FLOOR, g)))
            for a in areas:
                if a == "MAPEH":
                    parts = {m: grade(m) for m in MAPEH_AREAS}
                    for m, g in parts.items():
                        lr.area_grades.setdefault(m, []).append(g)
                    # DO 8: MAPEH is the average of its four areas, not transmuted again.
                    lr.grades.setdefault("MAPEH", []).append(
                        round_half_up(sum(parts.values()) / len(parts)))
                else:
                    lr.grades.setdefault(a, []).append(grade(a))
        else:
            codes = []
            for _ in range(KINDER_SKILLS):
                z = 0.9 * abil + 0.3 * eng + rng.normal(0, 0.7 * noise)
                codes.append("E" if z > 0.3 else "G" if z > -0.75 else "F" if z > -1.6 else "NA")
            lr.ratings.append(codes)

        # Teacher notes: about two a period, tone leaning on conduct.
        bank = scored_notes()
        period_notes = []
        for _ in range(rng.poisson(2.2)):
            t = cond + rng.normal(0, 1.0)
            tone = "Positive" if t > 0.7 else "Negative" if t < -0.8 else "Neutral"
            note = bank[tone][int(rng.integers(len(bank[tone])))]
            period_notes.append((int(rng.integers(D)), note))
        lr.notes.append(sorted(period_notes, key=lambda n: n[0]))

    # Dropping out: a learner who stopped coming is likely to leave.
    if any(f < 0.65 for f in attended_frac[1:]) and rng.random() < 0.5:
        lr.dropped = True

    # Year-end outcome (DO 8 Table 10 for graded learners).
    if lr.numeric:
        finals = {a: round_half_up(sum(g) / len(g)) for a, g in lr.grades.items()}
        lr.failing_areas = sum(1 for g in finals.values() if g < PASSING_GRADE)
        if lr.dropped or lr.failing_areas >= 3:
            lr.label = "High Risk"
        elif lr.failing_areas >= 1:
            lr.label = "Moderate Risk"
    else:
        last = competency(lr.ratings[-1])
        if lr.dropped or last < 0.5:
            lr.label = "High Risk"
        elif last < 0.65:
            lr.label = "Moderate Risk"
    return lr


def competency(codes: list[str]) -> float:
    return sum(EGFNA_WEIGHT[c] for c in codes) / len(codes)


def attendance_rate(statuses: list[str]) -> float:
    return sum(s == "Present" for s in statuses) / len(statuses)


def recent_behaviour(lr: Learner, k: int) -> list[float]:
    """Compound scores of the notes in the last RECENT_DAYS of period k (1-based)."""
    D = len(lr.days[k - 1])
    return [n["score"] for day, n in lr.notes[k - 1] if day >= D - RECENT_DAYS]


def period_average(lr: Learner, k: int) -> float:
    return sum(g[k - 1] for g in lr.grades.values()) / len(lr.grades)


def snapshot(lr: Learner, k: int, rng: np.random.Generator | None = None,
             missing: bool = True) -> dict:
    """
    What VISTA would know about this learner at the end of period k — the same
    five inputs `routers/risk.py` computes live. With `missing`, some inputs are
    blanked the way real records have gaps (a register not yet filled in, grades
    not yet encoded).
    """
    rng = rng or np.random.default_rng(0)
    gap = (lambda p: missing and rng.random() < p)

    att = None if gap(0.05) else attendance_rate(lr.days[k - 1][-RECENT_DAYS:])
    avg = grade_trend = comp = None
    if lr.numeric and not gap(0.08):
        avg = period_average(lr, k)
        if k >= 2:
            grade_trend = avg - period_average(lr, k - 1)
    if not lr.numeric and not gap(0.08):
        comp = competency(lr.ratings[k - 1])
    beh = recent_behaviour(lr, k)

    return {
        "attendance_rate": att,
        "avg_grade": avg,
        "grade_trend": grade_trend,
        "behavioral_score": (sum(beh) / len(beh)) if beh else None,
        "competency_score": comp,
    }


def generate_school(n: int, seed: int = 42, period_model: str = "4Q",
                    noise: float = 1.0) -> list[Learner]:
    rng = np.random.default_rng(seed)
    return [make_learner(i, rng, period_model, noise) for i in range(n)]


def risk_rows(learners: list[Learner], seed: int = 42) -> list[dict]:
    """One mid-year snapshot per learner, with the year-end label."""
    rng = np.random.default_rng(seed + 1)
    rows = []
    for lr in learners:
        k = int(rng.integers(1, lr.periods))       # periods 1..P-1: mid-year
        row = snapshot(lr, k, rng)
        row.update({"learner_id": lr.id, "grade_level": lr.grade_level,
                    "period": k, "label": lr.label})
        rows.append(row)
    return rows


def grade_sequences(learners: list[Learner]) -> list[dict]:
    """
    One row per graded learner per learning area: the grade, attendance and
    behaviour of every period. The grade model is trained and tested on these.
    """
    out = []
    for lr in learners:
        if not lr.numeric:
            continue
        att = [attendance_rate(d[-RECENT_DAYS:]) for d in lr.days]
        beh = []
        for k in range(1, lr.periods + 1):
            scores = recent_behaviour(lr, k)
            beh.append(sum(scores) / len(scores) if scores else None)
        for area, gs in lr.grades.items():
            out.append({"learner_id": lr.id, "area": area, "grades": gs,
                        "attendance": att, "behaviour": beh})
    return out


def label_mix(learners: list[Learner]) -> dict:
    return {lab: sum(1 for lr in learners if lr.label == lab) for lab in RISK_LABELS}


# ─── Demo slice for the database seeder ─────────────────────────
def demo_school(n: int = 150, seed: int = 7, period_model: str = "4Q",
                periods_done: int = 3, attendance_days: int = 40) -> dict:
    """
    A small school for `node-api/scripts/seedSyntheticStudents.js`. Dates are
    school-day offsets counted back from the day the seeder runs (0 = the most
    recent school day), so "the last 30 days" in the live system lands on them
    whenever it is seeded. The seeder writes no outcome: `simulated_outcome` is
    how this fake learner's year was written to end, kept so a demo can compare
    the model's warning with it.
    """
    rng = np.random.default_rng(seed)
    P = PERIODS[period_model]
    periods_done = max(1, min(periods_done, P))
    learners = []
    for i in range(n):
        gl = GRADE_LEVELS[i % len(GRADE_LEVELS)]
        lr = make_learner(i, rng, period_model, grade_level=gl)
        male = rng.random() < 0.5
        age = 5 + GRADE_LEVELS.index(gl)
        # Days of the latest completed period, most recent last.
        statuses = lr.days[periods_done - 1][-attendance_days:]
        D = len(lr.days[periods_done - 1])
        behaviour = [
            {"day_offset": D - 1 - day, "text": note["text"], "sentiment": note["sentiment"],
             "score": note["score"],
             "category": NOTE_CATEGORIES[int(rng.integers(len(NOTE_CATEGORIES)))]}
            for day, note in lr.notes[periods_done - 1]
            if D - 1 - day < attendance_days
        ]
        learners.append({
            "ref": i,
            "surname": SURNAMES[int(rng.integers(len(SURNAMES)))],
            "first_name": (FIRST_MALE if male else FIRST_FEMALE)[
                int(rng.integers(len(FIRST_MALE if male else FIRST_FEMALE)))],
            "middle_name": SURNAMES[int(rng.integers(len(SURNAMES)))],
            "gender": "Male" if male else "Female",
            "age": age,
            "grade_level": gl,
            # Learning areas (MAPEH excluded: the seeder rolls it up from its
            # areas through utils/subjectAreas.js, as a teacher's save would).
            "grades": {a: g[:periods_done] for a, g in lr.grades.items() if a != "MAPEH"}
                      | {a: g[:periods_done] for a, g in lr.area_grades.items()},
            "competency": [r for r in lr.ratings[:periods_done]],
            "attendance": statuses,
            "behaviour": behaviour,
            "simulated_outcome": lr.label,
        })
    return {
        "generated_by": "fastapi-ai/scripts/generate_synthetic.py",
        "seed": seed,
        "period_model": period_model,
        "periods_done": periods_done,
        "attendance_days": attendance_days,
        "learners": learners,
    }
