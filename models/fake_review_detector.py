import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import joblib
import re

# ── paths ──────────────────────────────────────────────────────────────────
RAW     = Path("data/raw/reviews")
MODELS  = Path("models")
OUT     = Path("data/processed")
MODELS.mkdir(exist_ok=True)

# ── load amazon reviews ────────────────────────────────────────────────────
print("Loading reviews...")
reviews = pd.read_csv(RAW / "Reviews.csv", nrows=500000)
print(f"Loaded: {reviews.shape}")
print(f"Columns: {list(reviews.columns)}")

# ── feature engineering for review trust-risk scoring ─────────────────────
print("\nEngineering review features...")

def review_features(df):
    df = df.copy()

    # text-based signals
    df["review_len"]         = df["Text"].fillna("").apply(lambda x: len(x.split()))
    df["summary_len"]        = df["Summary"].fillna("").apply(lambda x: len(x.split()))
    df["has_exclamation"]    = df["Text"].fillna("").apply(lambda x: int("!" in x))
    df["exclamation_count"]  = df["Text"].fillna("").apply(lambda x: x.count("!"))
    df["cap_ratio"]          = df["Text"].fillna("").apply(
        lambda x: sum(1 for c in x if c.isupper()) / (len(x) + 1)
    )
    df["has_url"]            = df["Text"].fillna("").apply(
        lambda x: int(bool(re.search(r"http\S+", x)))
    )

    # rating-based signals
    df["score"]              = pd.to_numeric(df["Score"], errors="coerce").fillna(3)
    df["is_extreme_rating"]  = df["score"].apply(lambda x: int(x in [1, 5]))

    # helpfulness signals
    df["helpful_num"]   = df["HelpfulnessNumerator"].fillna(0)
    df["helpful_denom"] = df["HelpfulnessDenominator"].fillna(0)
    df["helpful_ratio"]      = df["helpful_num"] / (df["helpful_denom"] + 1)

    # per-user behavioral signals
    user_counts              = df["UserId"].value_counts()
    df["user_review_count"]  = df["UserId"].map(user_counts).fillna(1)
    df["is_prolific_user"]   = (df["user_review_count"] > 50).astype(int)

    # per-product signals
    prod_counts              = df["ProductId"].value_counts()
    df["product_review_count"] = df["ProductId"].map(prod_counts).fillna(1)

    prod_avg_score           = df.groupby("ProductId")["score"].transform("mean")
    df["score_deviation"]    = (df["score"] - prod_avg_score).abs()

    return df

reviews = review_features(reviews)

FEATURE_COLS = [
    "review_len", "summary_len", "has_exclamation", "exclamation_count",
    "cap_ratio", "has_url", "is_extreme_rating", "helpful_ratio",
    "user_review_count", "is_prolific_user", "product_review_count",
    "score_deviation"
]

X = reviews[FEATURE_COLS].fillna(0).values

# ── scale ──────────────────────────────────────────────────────────────────
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# ── isolation forest ───────────────────────────────────────────────────────
print("\nTraining Isolation Forest review-risk scorer...")
iso = IsolationForest(
    n_estimators=200,
    contamination=0.05,   # unsupervised risk assumption for the prototype
    random_state=42,
    n_jobs=-1,
    verbose=1
)
iso.fit(X_scaled)

# anomaly scores: more negative = more likely fake
scores = iso.decision_function(X_scaled)
reviews["fake_score"]      = scores
reviews["is_fake"]         = (iso.predict(X_scaled) == -1).astype(int)

print(f"\nFlagged high-risk reviews: {reviews['is_fake'].sum():,} / {len(reviews):,}")
print(f"High-risk rate: {reviews['is_fake'].mean()*100:.1f}%")

# ── per-product trust score ────────────────────────────────────────────────
print("\nComputing per-product trust scores...")
product_trust = reviews.groupby("ProductId").agg(
    avg_fake_score   = ("fake_score", "mean"),
    fake_review_rate = ("is_fake", "mean"),
    review_count     = ("Id", "count"),
    avg_rating       = ("score", "mean"),
    rating_std       = ("score", "std"),
).reset_index()

product_trust["rating_std"]      = product_trust["rating_std"].fillna(0)
product_trust["trust_score"]     = (
    product_trust["avg_fake_score"].rank(pct=True) * 0.5 +
    (1 - product_trust["fake_review_rate"]) * 0.3 +
    (1 - product_trust["rating_std"] / 5).clip(0, 1) * 0.2
)

print(f"\nProduct trust scores computed: {len(product_trust):,} products")
print(product_trust[["ProductId","trust_score","fake_review_rate","avg_rating"]].head(10))

# ── save ───────────────────────────────────────────────────────────────────
joblib.dump(iso,    MODELS / "isolation_forest.joblib")
joblib.dump(scaler, MODELS / "review_scaler.joblib")
product_trust.to_parquet(OUT / "product_trust_scores.parquet", index=False)

print(f"\nSaved: models/isolation_forest.joblib")
print(f"Saved: data/processed/product_trust_scores.parquet")
