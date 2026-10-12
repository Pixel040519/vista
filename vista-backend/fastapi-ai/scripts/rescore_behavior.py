"""
Re-score saved behavior logs with the current sentiment analyzer.

    cd vista-backend/fastapi-ai
    PYTHONIOENCODING=utf-8 venv/Scripts/python scripts/rescore_behavior.py           # dry run
    PYTHONIOENCODING=utf-8 venv/Scripts/python scripts/rescore_behavior.py --apply   # write

Every log keeps the tone VADER gave it on the day it was saved. When the analyzer
improves — the school-behaviour vocabulary in `services/behavior_lexicon.py`, or a
changed neutral band in `routers/sentiment.py` — old logs keep the old reading, so
a learner's history and the behaviour summaries disagree with what the same words
would score today. This brings them in line, and fills in logs saved while the
analyzer was unreachable (NULL `ai_sentiment`), which were stored as Neutral/0.

It scores through `routers.sentiment.polarity` and `compound_to_sentiment` — the
same two functions `/analyze/sentiment` uses — so a re-scored log is exactly what
re-saving it would produce. FastAPI and Node do not need to be running.

What it never touches: a log whose tone the teacher picked
(`sentiment_overridden = TRUE`). Its label, score and its record of what VADER
said at the time are all left as they are — the teacher made that call against
that suggestion, and re-scoring must not quietly undo or reframe it.

Dry run by default: it prints what would change and writes nothing. `--apply`
writes every change in one transaction. Safe to re-run — a second run finds
nothing to change. Requires 2026_10_12_behavior_sentiment_override.sql.

Live risk and class health read these columns directly, so they follow on the next
request. Persisted `risk_assessments` rows are an audit trail and are not
recomputed.
"""

import argparse
import asyncio
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from routers.sentiment import compound_to_sentiment, polarity  # noqa: E402
from services.db import AsyncSessionLocal, engine  # noqa: E402

EXAMPLES = 15


def score(observation: str) -> tuple[str, float]:
    compound = polarity(observation)["compound"]
    label, _ = compound_to_sentiment(compound)
    return label, round(compound, 4)


def as_float(value) -> float | None:
    return None if value is None else round(float(value), 4)


async def main(apply: bool) -> None:
    async with AsyncSessionLocal() as session:
        has_columns = (await session.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'behavior_logs' AND column_name = 'ai_sentiment'"
        ))).first()
        if not has_columns:
            sys.exit("behavior_logs has no ai_sentiment column. Apply "
                     "database/migrations/2026_10_12_behavior_sentiment_override.sql first.")

        rows = (await session.execute(text(
            "SELECT id, observation, sentiment, sentiment_score, ai_sentiment, "
            "       ai_sentiment_score, sentiment_overridden "
            "  FROM behavior_logs ORDER BY observed_at"
        ))).all()

        skipped = sum(1 for r in rows if r.sentiment_overridden)
        updates, label_moves, examples = [], Counter(), []
        filled = 0

        for r in rows:
            if r.sentiment_overridden:
                continue
            label, compound = score(r.observation or "")
            unchanged = (
                r.sentiment == label and as_float(r.sentiment_score) == compound
                and r.ai_sentiment == label and as_float(r.ai_sentiment_score) == compound
            )
            if unchanged:
                continue
            updates.append({"id": r.id, "label": label, "score": compound})
            if r.ai_sentiment is None:
                filled += 1
            if r.sentiment != label:
                label_moves[(r.sentiment or "none", label)] += 1
                if len(examples) < EXAMPLES:
                    examples.append((r.sentiment or "none", label, compound, r.observation or ""))

        print(f"Behavior logs:               {len(rows)}")
        print(f"  set by a teacher, skipped: {skipped}")
        print(f"  already up to date:        {len(rows) - skipped - len(updates)}")
        print(f"  to update:                 {len(updates)}")
        print(f"    tone label changes:      {sum(label_moves.values())}")
        print(f"    score only:              {len(updates) - sum(label_moves.values())}")
        print(f"    never analysed before:   {filled}")
        if label_moves:
            print("\nLabel changes:")
            for (old, new), n in sorted(label_moves.items(), key=lambda kv: -kv[1]):
                print(f"  {old:>8} -> {new:<8} {n}")
        if examples:
            print(f"\nExamples (first {len(examples)}):")
            for old, new, compound, observation in examples:
                snippet = " ".join(observation.split())
                snippet = snippet if len(snippet) <= 80 else snippet[:77] + "..."
                print(f"  {old:>8} -> {new:<8} {compound:+.3f}  {snippet}")

        if not updates:
            print("\nNothing to change.")
        elif not apply:
            print("\nDry run: nothing was written. Re-run with --apply to save these changes.")
        else:
            # The WHERE re-checks the flag, so a log a teacher overrode after
            # it was read above is still left alone.
            await session.execute(text(
                "UPDATE behavior_logs "
                "   SET sentiment = :label, sentiment_score = :score, "
                "       ai_sentiment = :label, ai_sentiment_score = :score "
                " WHERE id = :id AND sentiment_overridden = FALSE"
            ), updates)
            await session.commit()
            print(f"\nUpdated {len(updates)} behavior logs.")

    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Re-score behavior logs with the current analyzer.")
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    asyncio.run(main(parser.parse_args().apply))
