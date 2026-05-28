import numpy as np
import pandas as pd
from pathlib import Path
from pymoo.core.problem import Problem
from pymoo.algorithms.moo.nsga2 import NSGA2
from pymoo.operators.crossover.sbx import SBX
from pymoo.operators.mutation.pm import PM
from pymoo.operators.sampling.rnd import FloatRandomSampling
from pymoo.optimize import minimize
from pymoo.termination import get_termination
import lightgbm as lgb
import joblib
import json


PROCESSED = Path("data/processed")
MODELS    = Path("models")


#Load models-------

print("Loading ranker model...")
model = lgb.Booster(model_file=str(MODELS / "ranker_v1.lgb"))
with open(MODELS / "feature_cols.json") as f:
    FEATURE_COLS = json.load(f)


print("Loading features...")
df = pd.read_parquet(PROCESSED / "features_v1.parquet")

#one query group for demo optimization
sample_query_id = df["query_id"].value_counts().index[0]
query_df = df[df["query_id"] == sample_query_id].copy()
print(f"Optimizing query_id: {sample_query_id} | candidates: {len(query_df)}")

X = query_df[FEATURE_COLS].values
query_df["relevance_pred"] = model.predict(X)

#intitial simulations
np.random.seed(42)
query_df["price_fairness"] = (
    (query_df["f_title_len"] / query_df["f_title_len"].max()) * 0.4 +
    query_df["f_has_description"] * 0.3 +
    query_df["f_has_brand"] * 0.3 +
    np.random.normal(0, 0.05, len(query_df))
).clip(0, 1)


query_df["review_trust"] = (
    query_df["f_has_bullets"] * 0.4 +
    query_df["f_has_description"] * 0.3 +
    np.random.normal(0.6, 0.1, len(query_df))
).clip(0, 1)