from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from typing import Optional

from services import behavior_lexicon

router = APIRouter()
analyzer = SentimentIntensityAnalyzer()
behavior_lexicon.install(analyzer)


def polarity(text: str) -> dict:
    """VADER scores for an observation, read with the school-behaviour vocabulary."""
    return analyzer.polarity_scores(behavior_lexicon.rewrite(text))

# ─── Pydantic Models ───────────────────────────────────────────
class SentimentRequest(BaseModel):
    text: str

class SentimentResponse(BaseModel):
    text: str
    sentiment: str          # Positive, Negative, Neutral
    score: float            # VADER compound score (-1 to 1)
    scores: dict            # Full VADER breakdown
    tags: list[str]         # Behavioral tags
    confidence: str         # High, Medium, Low

# ─── Behavioral Tag Keywords ───────────────────────────────────
POSITIVE_TAGS = {
    "shared": "Sharing/Cooperation",
    "helped": "Helpfulness",
    "participated": "Active Participation",
    "focused": "Focus",
    "completed": "Task Completion",
    "improved": "Improvement",
    "happy": "Positive Mood",
    "cooperative": "Cooperation",
    "kind": "Kindness",
    "engaged": "Engagement",
}

NEGATIVE_TAGS = {
    "cried": "Emotional Distress",
    "refused": "Refusal",
    "fought": "Conflict",
    "aggressive": "Aggression",
    "withdrawn": "Withdrawal",
    "absent-minded": "Inattention",
    "disruptive": "Disruptive Behavior",
    "anxious": "Anxiety",
    "struggling": "Academic Struggle",
    "isolated": "Social Isolation",
}


def extract_tags(text: str) -> list[str]:
    """Extract behavioral tags from observation text."""
    text_lower = text.lower()
    found_tags = []

    for keyword, tag in POSITIVE_TAGS.items():
        if keyword in text_lower and tag not in found_tags:
            found_tags.append(f"+ {tag}")

    for keyword, tag in NEGATIVE_TAGS.items():
        if keyword in text_lower and tag not in found_tags:
            found_tags.append(f"- {tag}")

    return found_tags


def compound_to_sentiment(compound: float) -> tuple[str, str]:
    """
    Convert VADER compound score to label and confidence.

    The neutral band is +/-0.1. It was +/-0.2, which is where a single mild word
    lands ("was late" scores -0.20), so those were labelled by a coin flip. VADER's
    own suggestion is +/-0.05; 0.1 keeps a margin for one weak word in an
    otherwise neutral note. Only the label moves: risk and class-health read the
    raw compound score.
    """
    if compound >= 0.6:
        return "Positive", "High"
    elif compound >= 0.1:
        return "Positive", "Medium"
    elif compound > -0.1:
        return "Neutral", "Medium"
    elif compound > -0.6:
        return "Negative", "Medium"
    else:
        return "Negative", "High"


# ─── POST /analyze/sentiment ───────────────────────────────────
@router.post("/sentiment", response_model=SentimentResponse)
async def analyze_sentiment(request: SentimentRequest):
    """
    Analyze behavioral observation text for sentiment.
    Uses VADER (Valence Aware Dictionary and sEntiment Reasoner).
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    scores = polarity(request.text)
    compound = scores["compound"]
    sentiment, confidence = compound_to_sentiment(compound)
    tags = extract_tags(request.text)

    return SentimentResponse(
        text=request.text,
        sentiment=sentiment,
        score=round(compound, 4),
        scores={
            "positive": scores["pos"],
            "negative": scores["neg"],
            "neutral": scores["neu"],
            "compound": scores["compound"]
        },
        tags=tags,
        confidence=confidence
    )


# ─── POST /analyze/sentiment/batch ────────────────────────────
class BatchSentimentRequest(BaseModel):
    texts: list[str]

@router.post("/sentiment/batch")
async def analyze_sentiment_batch(request: BatchSentimentRequest):
    """Analyze multiple observations at once."""
    results = []
    for text in request.texts:
        scores = polarity(text)
        compound = scores["compound"]
        sentiment, confidence = compound_to_sentiment(compound)
        results.append({
            "text": text,
            "sentiment": sentiment,
            "score": round(compound, 4),
            "tags": extract_tags(text)
        })

    # Aggregate summary
    sentiments = [r["sentiment"] for r in results]
    summary = {
        "total": len(results),
        "positive": sentiments.count("Positive"),
        "negative": sentiments.count("Negative"),
        "neutral": sentiments.count("Neutral"),
        "avg_score": round(sum(r["score"] for r in results) / len(results), 4)
    }

    return {"results": results, "summary": summary}