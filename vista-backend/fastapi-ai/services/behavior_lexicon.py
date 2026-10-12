"""
School-behaviour vocabulary for VADER.

VADER's lexicon was built from social-media text, so the words teachers actually
write carry no sentiment for it: "follows instructions", "completes tasks" and
"cooperates" all score exactly 0, and so did "bullies" and "refuses" — VADER does
no stemming, and only "bully" and "refused" are in its list. Every observation
built from such words came out Neutral regardless of what it described.

Three things live here, all applied before or around VADER rather than replacing it:

- LEXICON — words added to (or re-scored in) VADER's lexicon. Every inflection is
  listed explicitly, because VADER matches whole tokens only. Values are on VADER's
  own -4..+4 scale. A few existing entries are overridden where the social-media
  reading is wrong in a classroom ("slap" is +0.6 in VADER).
- BOOSTERS — frequency words ("repeatedly", "consistently") that strengthen the
  word after them, and DAMPENERS ("sometimes") that soften it.
- rewrite() — phrase rules VADER cannot express. Its negation only fires when the
  preceding word is NOT itself in the lexicon, so "refuses to cooperate" was scored
  as refuses (-1.2) plus cooperate (+1.5): mildly positive. Rewriting it to
  "refuses not cooperate" keeps the refusal's own score and flips the verb.

The rewritten text is only ever scored; it is never stored or returned.

Deliberately left out: words whose classroom meaning depends on context. "Bit" is
mostly "a bit"; "lie" is "lie down"; "sleep" is nap time in Kinder; "answers" can be
"answers questions" or "answers back"; "attention" can be paid or sought; "quiet"
and "talkative" can be praise or concern.
"""

import re

import vaderSentiment.vaderSentiment as vader


LEXICON = {
    # ── Physical aggression ──────────────────────────────────────
    "bullies": -2.5,
    "hit": -2.0, "hits": -2.0, "hitting": -2.0,
    "push": -1.5, "pushes": -1.5, "pushed": -1.5, "pushing": -1.5,
    "kick": -2.0, "kicks": -2.0, "kicked": -2.0, "kicking": -2.0,
    "punch": -2.5, "punches": -2.5, "punched": -2.5, "punching": -2.5,
    "bite": -1.8, "bites": -2.0, "biting": -2.0,
    "scratched": -1.5, "scratching": -1.5,
    "pinch": -1.5, "pinches": -1.5, "pinched": -1.5, "pinching": -1.5,
    "slap": -2.0, "slaps": -2.0, "slapped": -2.0, "slapping": -2.0,
    "aggressive": -2.0,

    # ── Verbal / conduct ─────────────────────────────────────────
    "teasing": -1.3,
    "cursed": -2.0, "cursing": -2.0, "swore": -1.5, "swear": -1.0,
    "stole": -2.2,
    "disrespectful": -2.0, "disrespects": -1.8, "disrespected": -1.8,
    "defiant": -1.8, "defies": -1.5, "defied": -1.5,
    "disobey": -1.8, "disobeys": -1.8, "disobeyed": -1.8, "disobedient": -1.8,
    "disrupt": -1.5, "disrupts": -1.5, "disrupted": -1.5, "disrupting": -1.5,
    "disruptive": -1.8,
    "shout": -1.5, "shouts": -1.5, "shouted": -1.5, "shouting": -1.5,
    "yell": -1.5, "yells": -1.5, "yelled": -1.5, "yelling": -1.5,
    "noisy": -1.0,
    "uncooperative": -1.8,
    "refuses": -1.2,

    # ── Engagement / work habits ─────────────────────────────────
    "absent": -1.0, "late": -0.8, "tardy": -1.0,
    "inattentive": -1.5, "unprepared": -1.2, "incomplete": -1.2,
    "withdrawn": -1.5,
    "unable": -1.2,
    "lacks": -1.3, "lacked": -1.3, "lacking": -1.3,
    "forgets": -0.9, "forgot": -0.9, "forgetting": -0.9,
    "reminders": -0.8, "reminding": -0.8,

    # ── Positive conduct ─────────────────────────────────────────
    "cooperate": 1.6, "cooperates": 1.6, "cooperated": 1.6, "cooperating": 1.6,
    "cooperative": 1.8,
    "follow": 1.0, "follows": 1.0, "followed": 1.0, "following": 1.0,
    "obey": 1.2, "obeys": 1.2, "obeyed": 1.2, "obedient": 1.5,
    "complete": 1.2, "completes": 1.2, "completed": 1.2, "completing": 1.2,
    "finish": 0.8, "finishes": 0.8, "finished": 0.8,
    "participate": 1.4, "participates": 1.4, "participated": 1.4, "participating": 1.4,
    "participative": 1.5,
    "volunteer": 1.4, "volunteers": 1.4, "volunteered": 1.4,
    "helped": 1.5,
    "polite": 2.0, "patient": 1.5, "punctual": 1.5,
    "attentive": 1.6, "focus": 1.0,
    "listen": 1.0, "listens": 1.2, "listened": 1.2, "listening": 1.2,
    "diligent": 2.0, "organized": 1.2, "tidy": 1.2,
    "independently": 1.0,
    "progressing": 1.5,
}

# VADER's own booster increment, applied in the direction of the word it modifies.
BOOSTERS = ["repeatedly", "constantly", "consistently", "frequently",
            "persistently", "always", "often", "habitually", "constant", "frequent"]
DAMPENERS = ["sometimes", "occasionally"]


# Each rule turns a phrase VADER would misread into one its negation handling
# reads correctly. Applied in order, case-insensitively.
_REWRITES = [
    # "refuses to cooperate", "fails to complete", "struggles to focus" —
    # keep the leading word (it carries its own score) and negate the verb.
    (re.compile(r"\b(refus(?:e|es|ed|ing)|fail(?:s|ed|ing)?|struggl(?:e|es|ed|ing)|"
                r"unable|unwilling|reluctant|forg(?:et|ets|ot|etting))\s+to\b", re.I),
     r"\1 not"),
    # "lacks focus", "lack of effort"
    (re.compile(r"\b(lack(?:s|ed|ing)?)\s+(?:of\s+)?", re.I), r"\1 not "),
    # "needs to improve", "needs more help", "needs improvement" — a concern,
    # though every one of those words is positive on its own. Narrow on purpose:
    # "needs constant reminders" must keep "reminders" un-negated.
    (re.compile(r"\bneeds?\s+(?:to\b|(?:more\s+)?(?=(?:help|improvement|support|"
                r"guidance|practice)\b))", re.I), "not "),
    # "stopped hitting", "no longer cries" — the behaviour has ended, so its
    # sentiment flips. "stopped" itself is negative in VADER and is dropped.
    (re.compile(r"\b(?:stop(?:s|ped)?|quit(?:s)?)\s+(\w+ing)\b", re.I), r"not \1"),
    (re.compile(r"\bno\s+longer\b", re.I), "not"),
    # "without help" is independence, but VADER treats "without" as a negator
    # and flips "help" into a negative.
    (re.compile(r"\bwithout\s+(?:any\s+)?(?:help|assistance|"
                r"being\s+(?:told|reminded|asked))\b", re.I), "independently"),
    # "left the room without permission", "took crayons without asking" —
    # neither word carries sentiment, so the phrase stands for what it means.
    # Must follow the rule above, which owns "without being asked".
    (re.compile(r"\bwithout\s+(?:asking|permission)\b", re.I), "disobeyed"),
]


def rewrite(text: str) -> str:
    """Rewrite school phrasing into a form VADER scores correctly."""
    for pattern, replacement in _REWRITES:
        text = pattern.sub(replacement, text)
    return text


def install(analyzer: "vader.SentimentIntensityAnalyzer") -> None:
    """
    Add the vocabulary to an analyzer. Boosters live in a module-level dict in
    vaderSentiment rather than on the analyzer, so they apply process-wide — this
    service only ever scores teacher observations, so that is the intended scope.
    """
    analyzer.lexicon.update(LEXICON)
    vader.BOOSTER_DICT.update({w: vader.B_INCR for w in BOOSTERS})
    vader.BOOSTER_DICT.update({w: vader.B_DECR for w in DAMPENERS})
