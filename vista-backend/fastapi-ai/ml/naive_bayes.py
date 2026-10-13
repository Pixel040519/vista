"""
Gaussian Naive Bayes that can skip a missing input.

The idea in plain words: for every risk class (Stable / Moderate / High) the
model remembers what each input usually looks like — its average and how much it
spreads (a bell curve). To judge a learner it asks, input by input, "how normal
is this value for a Stable learner? for a High-Risk learner?", multiplies those
answers together with how common each class is, and the class with the biggest
result wins.

It is "naive" because it treats the inputs as unrelated to each other (grades and
attendance are not, really). That costs some accuracy but buys the property VISTA
needs most: since every input is judged on its own, an input the learner does not
have — no grades for Kinder, no behaviour notes this month — is simply left out
of the multiplication. sklearn's GaussianNB cannot do that (it refuses NaN), so
this is a small re-implementation. On rows with nothing missing it gives the same
answers as sklearn; `scripts/train_models.py` checks that on every training run.

The fitted model is plain numbers, so it is saved as JSON — readable, diffable,
and with none of the code-execution risk of loading a pickle.
"""

import math

import numpy as np


class GaussianNaiveBayes:
    def __init__(self, var_smoothing: float = 1e-9):
        self.var_smoothing = var_smoothing
        self.classes: list[str] = []
        self.features: list[str] = []
        self.log_prior: np.ndarray | None = None
        self.mean: np.ndarray | None = None   # [class, feature]
        self.var: np.ndarray | None = None    # [class, feature]

    # ── training ───────────────────────────────────────────────
    def fit(self, X, y, classes: list[str], features: list[str]):
        """X: rows of floats with np.nan for missing. y: class names."""
        X = np.asarray(X, dtype=float)
        y = np.asarray(y)
        self.classes = list(classes)
        self.features = list(features)
        n_cls, n_feat = len(self.classes), X.shape[1]

        # Same smoothing rule as sklearn: a small fraction of the widest
        # feature's variance, added to every variance so none is ever zero.
        epsilon = self.var_smoothing * float(np.nanmax(np.nanvar(X, axis=0)))

        counts = np.array([np.sum(y == c) for c in self.classes], dtype=float)
        if np.any(counts == 0):
            missing = [c for c, n in zip(self.classes, counts) if n == 0]
            raise ValueError(f"No training rows for class {missing}")
        self.log_prior = np.log(counts / counts.sum())

        overall_mean = np.nanmean(X, axis=0)
        overall_var = np.nanvar(X, axis=0)
        self.mean = np.zeros((n_cls, n_feat))
        self.var = np.zeros((n_cls, n_feat))
        for ci, c in enumerate(self.classes):
            Xc = X[y == c]
            for fi in range(n_feat):
                col = Xc[:, fi]
                col = col[~np.isnan(col)]
                if len(col) >= 2:
                    self.mean[ci, fi] = col.mean()
                    self.var[ci, fi] = col.var() + epsilon
                else:
                    # Too few values in this class to learn a curve: use the
                    # whole population's, so the feature cannot tilt the result.
                    self.mean[ci, fi] = overall_mean[fi]
                    self.var[ci, fi] = overall_var[fi] + epsilon
        return self

    # ── prediction ─────────────────────────────────────────────
    def _log_likelihood(self, ci: int, fi: int, x: float) -> float:
        var = self.var[ci, fi]
        return -0.5 * math.log(2 * math.pi * var) - (x - self.mean[ci, fi]) ** 2 / (2 * var)

    def log_joint(self, x) -> np.ndarray:
        """log P(class) + sum of log P(input | class) over the inputs present."""
        out = self.log_prior.copy()
        for fi, value in enumerate(x):
            if value is None or (isinstance(value, float) and math.isnan(value)):
                continue
            for ci in range(len(self.classes)):
                out[ci] += self._log_likelihood(ci, fi, float(value))
        return out

    def predict_proba_one(self, x) -> dict[str, float]:
        lj = self.log_joint(x)
        p = np.exp(lj - lj.max())
        p /= p.sum()
        return {c: float(v) for c, v in zip(self.classes, p)}

    def predict_one(self, x) -> str:
        return self.classes[int(np.argmax(self.log_joint(x)))]

    def predict(self, X) -> list[str]:
        return [self.predict_one(row) for row in np.asarray(X, dtype=float)]

    def predict_proba(self, X) -> np.ndarray:
        rows = [self.predict_proba_one(r) for r in np.asarray(X, dtype=float)]
        return np.array([[r[c] for c in self.classes] for r in rows])

    def explain(self, x, toward: str, away_from: str) -> dict[str, float]:
        """
        How hard each present input pushes toward one class and away from
        another, as a log-likelihood ratio: 0 = no push, +0.7 ~ twice as likely,
        +2.0 ~ seven times as likely. Missing inputs are not listed.
        """
        ti, ai = self.classes.index(toward), self.classes.index(away_from)
        pushes = {}
        for fi, value in enumerate(x):
            if value is None or (isinstance(value, float) and math.isnan(value)):
                continue
            v = float(value)
            pushes[self.features[fi]] = self._log_likelihood(ti, fi, v) - self._log_likelihood(ai, fi, v)
        return pushes

    def class_mean(self, cls: str, feature: str) -> float:
        return float(self.mean[self.classes.index(cls), self.features.index(feature)])

    # ── saving ─────────────────────────────────────────────────
    def to_dict(self) -> dict:
        return {
            "type": "gaussian_naive_bayes",
            "var_smoothing": self.var_smoothing,
            "classes": self.classes,
            "features": self.features,
            "prior": [float(v) for v in np.exp(self.log_prior)],
            "mean": [[float(v) for v in row] for row in self.mean],
            "var": [[float(v) for v in row] for row in self.var],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "GaussianNaiveBayes":
        m = cls(var_smoothing=d.get("var_smoothing", 1e-9))
        m.classes = list(d["classes"])
        m.features = list(d["features"])
        m.log_prior = np.log(np.asarray(d["prior"], dtype=float))
        m.mean = np.asarray(d["mean"], dtype=float)
        m.var = np.asarray(d["var"], dtype=float)
        return m
