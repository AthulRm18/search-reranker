import pandas as pd
import numpy as np
import lightgbm as lgb
from pathlib import Path
from sklearn.model_selection import GroupShuffleSplit
import json

# ── paths ──────────────────────────────────────────────────────────────────
PROCESSED = Path("data/processed")
MODELS    = Path("models")
MODELS.mkdir(exist_ok=True)

# ── load features ──────────────────────────────────────────────────────────
print("Loading features...")
df = pd.read_parquet(PROCESSED / "features_v1.parquet")
print(f"Shape: {df.shape}")

FEATURE_COLS = [
    "f_title_overlap", "f_desc_overlap", "f_bullet_overlap",
    "f_exact_title_match", "f_query_len", "f_title_len",
    "f_has_description", "f_has_bullets", "f_has_brand",
    "f_has_color", "f_title_query_len_ratio"
]

# ── train/val split by query group ────────────────────────────────────────
print("Splitting by query groups...")
groups = df["query_id"].values
gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
train_idx, val_idx = next(gss.split(df, groups=groups))

train_df = df.iloc[train_idx]
val_df   = df.iloc[val_idx]

print(f"Train: {len(train_df):,} | Val: {len(val_df):,}")

# ── group sizes for LambdaMART ─────────────────────────────────────────────
train_groups = train_df.groupby("query_id").size().values
val_groups   = val_df.groupby("query_id").size().values

# ── datasets ───────────────────────────────────────────────────────────────
X_train = train_df[FEATURE_COLS].values
y_train = train_df["relevance_score"].values

X_val = val_df[FEATURE_COLS].values
y_val = val_df["relevance_score"].values

train_data = lgb.Dataset(X_train, label=y_train, group=train_groups)
val_data   = lgb.Dataset(X_val,   label=y_val,   group=val_groups)

# ── LambdaMART params ──────────────────────────────────────────────────────
params = {
    "objective":        "lambdarank",
    "metric":           "ndcg",
    "ndcg_eval_at":     [5, 10],
    "learning_rate":    0.05,
    "num_leaves":       127,
    "min_data_in_leaf": 50,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq":     5,
    "verbose":          1,
    "n_jobs":           -1,
}

# ── train ──────────────────────────────────────────────────────────────────
print("\nTraining LambdaMART ranker...")
callbacks = [lgb.early_stopping(50), lgb.log_evaluation(25)]

model = lgb.train(
    params,
    train_data,
    num_boost_round=500,
    valid_sets=[val_data],
    callbacks=callbacks,
)

# ── evaluate ───────────────────────────────────────────────────────────────
print("\n── Evaluation ──")
best_score = model.best_score["valid_0"]
print(f"NDCG@5  : {best_score['ndcg@5']:.4f}")
print(f"NDCG@10 : {best_score['ndcg@10']:.4f}")

# ── feature importance ─────────────────────────────────────────────────────
importance = dict(zip(FEATURE_COLS, model.feature_importance(importance_type="gain")))
importance = dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))
print("\nFeature Importance (gain):")
for f, v in importance.items():
    print(f"  {f:<30} {v:.1f}")

# ── save ───────────────────────────────────────────────────────────────────
model.save_model(str(MODELS / "ranker_v1.lgb"))
with open(MODELS / "feature_cols.json", "w") as f:
    json.dump(FEATURE_COLS, f)
with open(MODELS / "best_scores.json", "w") as f:
    json.dump({k: float(v) for k, v in best_score.items()}, f)

print(f"\nModel saved to models/ranker_v1.lgb")