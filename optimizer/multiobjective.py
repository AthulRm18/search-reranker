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


def norm(x):
    r = x.max() - x.min()
    return (x - x.min()) / r if r > 0 else x * 0

query_df["relevance_norm"]    = norm(query_df["relevance_pred"])
query_df["price_fairness_n"]  = norm(query_df["price_fairness"])
query_df["review_trust_n"]    = norm(query_df["review_trust"])

n_items = len(query_df)
print(f"\nRunning NSGA-II over {n_items} candidates...")

#define multi-objective problem
class RankingOptimizationProblem(Problem):
    """
    Decision variables: weight vector w of shape (n_items,)
    representing how much to boost each item's final score.

    Objectives (all minimized, so we negate maximization objectives):
      1. -mean(relevance * w)       → maximize relevance
      2. -mean(price_fairness * w)  → maximize price fairness
      3. -mean(review_trust * w)    → maximize review trust

    Constraints:
      - sum(w) = n_items  (weights sum to number of items)
      - w_i >= 0.1        (every item gets minimum exposure)
      - w_i <= 3.0        (no item boosted more than 3x)
    """
    def __init__(self):
        super().__init__(
            n_var=n_items,
            n_obj=3,
            n_ieq_constr=2,
            xl=0.1,
            xu=3.0,
        )
        self.relevance   = query_df["relevance_norm"].values
        self.price       = query_df["price_fairness_n"].values
        self.trust       = query_df["review_trust_n"].values

    def _evaluate(self, x, out, *args, **kwargs):
        # x shape: (pop_size, n_items)
        w = x / x.sum(axis=1, keepdims=True) * n_items  # normalize weights

        f1 = -np.dot(w, self.relevance)  / n_items   # maximize relevance
        f2 = -np.dot(w, self.price)      / n_items   # maximize price fairness
        f3 = -np.dot(w, self.trust)      / n_items   # maximize review trust

        out["F"] = np.column_stack([f1, f2, f3])

        # constraints: sum deviation + bound violation
        g1 = np.abs(x.sum(axis=1) - n_items) - 0.1
        g2 = (x - 3.0).max(axis=1)
        out["G"] = np.column_stack([g1, g2])

# ── run NSGA-II ────────────────────────────────────────────────────────────
problem = RankingOptimizationProblem()

algorithm = NSGA2(
    pop_size=100,
    sampling=FloatRandomSampling(),
    crossover=SBX(prob=0.9, eta=15),
    mutation=PM(eta=20),
    eliminate_duplicates=True,
)

termination = get_termination("n_gen", 50)

result = minimize(
    problem,
    algorithm,
    termination,
    seed=42,
    verbose=True,
)

print(f"\nPareto front size: {len(result.F)}")
print(f"Objective space (first 5 solutions):")
print(-result.F[:5])  # negate back to maximization


print(f"\nPareto front size: {len(result.F)}")
print(f"Objective space (first 5 solutions):")
print(-result.F[:5])  # negate back to maximization

# ── extract best balanced solution ────────────────────────────────────────
# pick solution closest to utopia point (max all objectives)
utopia = result.F.min(axis=0)
dists  = np.linalg.norm(result.F - utopia, axis=1)
best_idx = np.argmin(dists)
best_weights = result.X[best_idx]
best_weights = best_weights / best_weights.sum() * n_items

query_df["optimized_weight"]      = best_weights
query_df["final_score"]           = query_df["relevance_norm"] * best_weights
query_df["baseline_rank"]         = query_df["relevance_norm"].rank(ascending=False).astype(int)
query_df["optimized_rank"]        = query_df["final_score"].rank(ascending=False).astype(int)
query_df["rank_change"]           = query_df["baseline_rank"] - query_df["optimized_rank"]

# ── results ────────────────────────────────────────────────────────────────
print("\n── Optimization Results ──")
print(f"Best solution objectives:")
print(f"  Relevance    : {-result.F[best_idx,0]:.4f}")
print(f"  Price Fair   : {-result.F[best_idx,1]:.4f}")
print(f"  Review Trust : {-result.F[best_idx,2]:.4f}")

print(f"\nTop 10 re-ranked items:")
top10 = query_df.sort_values("final_score", ascending=False).head(10)
print(top10[[
    "product_id","baseline_rank","optimized_rank",
    "rank_change","relevance_norm","price_fairness_n","review_trust_n"
]].to_string())

# ── save ───────────────────────────────────────────────────────────────────
query_df.to_parquet(PROCESSED / "optimized_results.parquet", index=False)
print(f"\nSaved: data/processed/optimized_results.parquet")