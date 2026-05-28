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

