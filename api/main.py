from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np
import lightgbm as lgb
import json
from pathlib import Path
from typing import List, Optional
import re


app = FastAPI(
    title="Search Re-Ranker API",
    description="LTR-based search re-ranking with multi-objective optimization",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── load model ─────────────────────────────────────────────────────────────
MODELS    = Path("models")
PROCESSED = Path("data/processed")

print("Loading model...")
model = lgb.Booster(model_file=str(MODELS / "ranker_v1.lgb"))
with open(MODELS / "feature_cols.json") as f:
    FEATURE_COLS = json.load(f)

print("Loading product trust scores...")
try:
    trust_df = pd.read_parquet(PROCESSED / "product_trust_scores.parquet")
    trust_map = dict(zip(trust_df["ProductId"], trust_df["trust_score"]))
except:
    trust_map = {}

print("API ready.")


# schemas--------------

class Product(BaseModel):
    product_id:          str
    product_title:       str
    product_description: Optional[str] = ""
    product_bullet_point:Optional[str] = ""
    product_brand:       Optional[str] = ""
    product_color:       Optional[str] = ""
    original_rank:       int
    sponsored:           Optional[bool] = False

class RankRequest(BaseModel):
    query:    str
    products: List[Product]
    mode:     Optional[str] = "balanced"  # balanced | relevance | fair

class RankedProduct(BaseModel):
    product_id:    str
    product_title: str
    original_rank: int
    new_rank:      int
    rank_change:   int
    relevance_score:   float
    trust_score:       float
    final_score:       float
    sponsored:         bool

class RankResponse(BaseModel):
    query:           str
    mode:            str
    results:         List[RankedProduct]
    baseline_ndcg:   float
    optimized_ndcg:  float
    bias_reduction:  float

# ── feature extraction ─────────────────────────────────────────────────────
def clean(text):
    if not isinstance(text, str) or not text:
        return ""
    return re.sub(r"\s+", " ", text.lower().strip())

def extract_features(query: str, product: Product) -> dict:
    q = clean(query)
    t = clean(product.product_title)
    d = clean(product.product_description)
    b = clean(product.product_bullet_point)

    q_terms = set(q.split())
    t_terms = set(t.split())
    d_terms = set(d.split())
    b_terms = set(b.split())

    def overlap(q_t, other):
        if not q_t or not other:
            return 0.0
        return len(q_t & other) / len(q_t)

    return {
        "f_title_overlap":         overlap(q_terms, t_terms),
        "f_desc_overlap":          overlap(q_terms, d_terms),
        "f_bullet_overlap":        overlap(q_terms, b_terms),
        "f_exact_title_match":     int(q in t),
        "f_query_len":             len(q.split()),
        "f_title_len":             len(t.split()),
        "f_has_description":       int(len(d) > 20),
        "f_has_bullets":           int(len(b) > 20),
        "f_has_brand":             int(bool(product.product_brand)),
        "f_has_color":             int(bool(product.product_color)),
        "f_title_query_len_ratio": len(t.split()) / (len(q.split()) + 1),
    }


# helper-----
def ndcg_at_k(scores, k=10):
    scores = np.array(scores[:k])
    ideal  = np.sort(scores)[::-1]
    def dcg(s):
        return sum((2**r - 1) / np.log2(i + 2) for i, r in enumerate(s))
    idcg = dcg(ideal)
    return dcg(scores) / idcg if idcg > 0 else 0.0


# main endpoint
@app.post("/rerank", response_model=RankResponse)
def rerank(req: RankRequest):
    if not req.products:
        raise HTTPException(status_code=400, detail="No products provided")

    # extract features + predict relevance
    features, trust_scores = [], []
    for p in req.products:
        feat = extract_features(req.query, p)
        features.append([feat[f] for f in FEATURE_COLS])
        trust_scores.append(trust_map.get(p.product_id, 0.5))

    X             = np.array(features)
    relevance     = model.predict(X)
    trust_scores  = np.array(trust_scores)

    # normalize
    def norm(x):
        r = x.max() - x.min()
        return (x - x.min()) / r if r > 0 else np.ones_like(x) * 0.5

    rel_norm   = norm(relevance)
    trust_norm = norm(trust_scores)

    # sponsored penalty
    sponsored_penalty = np.array([0.7 if p.sponsored else 1.0 for p in req.products])

    # mode-based weighting
    weights = {
        "balanced":  (0.6, 0.2, 0.2),
        "relevance": (0.9, 0.05, 0.05),
        "fair":      (0.4, 0.3, 0.3),
    }.get(req.mode, (0.6, 0.2, 0.2))

    w_rel, w_trust, w_penalty = weights
    final_scores = (
        w_rel   * rel_norm +
        w_trust * trust_norm +
        w_penalty * (sponsored_penalty - 1 + 1)
    ) * sponsored_penalty

    # rank
    optimized_order = np.argsort(final_scores)[::-1]

    # compute ndcg
    baseline_relevance  = [rel_norm[p.original_rank - 1]
                           if p.original_rank <= len(rel_norm)
                           else 0.0 for p in req.products]
    optimized_relevance = [rel_norm[i] for i in optimized_order]

    baseline_ndcg  = ndcg_at_k(sorted(baseline_relevance, reverse=True))
    optimized_ndcg = ndcg_at_k(optimized_relevance)
    bias_reduction = float(np.mean(sponsored_penalty[optimized_order[:10]] == 1.0) -
                           np.mean([p.sponsored for p in req.products[:10]]))

    # build response
    results = []
    for new_rank, idx in enumerate(optimized_order, 1):
        p = req.products[idx]
        results.append(RankedProduct(
            product_id=p.product_id,
            product_title=p.product_title,
            original_rank=p.original_rank,
            new_rank=new_rank,
            rank_change=p.original_rank - new_rank,
            relevance_score=float(rel_norm[idx]),
            trust_score=float(trust_norm[idx]),
            final_score=float(final_scores[idx]),
            sponsored=p.sponsored,
        ))

    return RankResponse(
        query=req.query,
        mode=req.mode,
        results=results,
        baseline_ndcg=round(baseline_ndcg, 4),
        optimized_ndcg=round(optimized_ndcg, 4),
        bias_reduction=round(bias_reduction * 100, 1),
    )

@app.get("/health")
def health():
    return {"status": "ok", "model": "ranker_v1.lgb", "features": len(FEATURE_COLS)}
