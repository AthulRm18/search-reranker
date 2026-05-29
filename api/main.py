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
import pyarrow.parquet as pq

app = FastAPI(
    title="Search Re-Ranker API",
    description="LTR-based search re-ranking with live trust scoring",
    version="2.0.0"
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

# Static trust map as fallback (from offline Isolation Forest)
print("Loading product trust scores (fallback)...")
try:
    trust_df = pd.read_parquet(PROCESSED / "product_trust_scores.parquet")
    trust_map = dict(zip(trust_df["ProductId"], trust_df["trust_score"]))
except:
    trust_map = {}

print("Loading ESCI products for search...")
products_df = pd.read_parquet("data/raw/esci/products.parquet")
products_df = products_df[products_df["product_locale"] == "us"].copy()
products_df = products_df.dropna(subset=["product_title"])
products_df["product_title_lower"] = products_df["product_title"].str.lower()
print(f"Loaded {len(products_df):,} US products")

print("API ready.")


# ── schemas ────────────────────────────────────────────────────────────────

class Product(BaseModel):
    product_id:          str
    product_title:       str
    product_description: Optional[str] = ""
    product_bullet_point:Optional[str] = ""
    product_brand:       Optional[str] = ""
    product_color:       Optional[str] = ""
    original_rank:       int
    sponsored:           Optional[bool] = False
    # Live review data from Chrome extension
    rating:              Optional[float] = 0.0
    review_count:        Optional[int] = 0
    rating_distribution: Optional[List[int]] = []
    review_samples:      Optional[List[str]] = []
    verified_count:      Optional[int] = 0

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
    trust_signals:     Optional[dict] = {}

class RankResponse(BaseModel):
    query:           str
    mode:            str
    results:         List[RankedProduct]
    # Honest metrics
    total_products:      int
    sponsored_found:     int
    sponsored_demoted:   int
    low_trust_demoted:   int
    avg_trust_top5:      float
    avg_trust_bottom5:   float
    # Backward compat (kept for the React UI)
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


# ══════════════════════════════════════════════════════════════════════════
#  LIVE TRUST SCORING — computed from real scraped review data
# ══════════════════════════════════════════════════════════════════════════

GENERIC_PHRASES = [
    'great product', 'highly recommend', 'love it', 'works great',
    'five stars', '5 stars', 'best product', 'amazing product',
    'good product', 'nice product', 'excellent product', 'awesome',
    'waste of money', 'do not buy', 'dont buy', 'worst product',
    'returned it', 'stopped working', 'broke after',
]

def compute_live_trust(product: Product) -> tuple:
    """
    Compute trust score from LIVE review data scraped from Amazon.
    Returns (trust_score: float, signals: dict)
    """
    signals = {}
    weighted_scores = []

    # ── Signal 1: Review count confidence ──
    # More reviews = more trustworthy (log scale, maxes at ~10K)
    if product.review_count and product.review_count > 0:
        count_score = min(np.log10(product.review_count + 1) / 4.0, 1.0)
        signals["review_count"] = round(count_score, 3)
        weighted_scores.append((count_score, 0.15))
    else:
        signals["review_count"] = None

    # ── Signal 2: Rating distribution analysis ──
    dist = product.rating_distribution or []
    if len(dist) == 5 and sum(dist) > 0:
        total = sum(dist)
        dist_norm = [d / total for d in dist]

        # 2a: Five-star bombing — >70% five-star is suspicious
        five_star_ratio = dist_norm[4]
        bomb_score = 1.0 - max(0, (five_star_ratio - 0.5) / 0.5)
        bomb_score = max(0, min(1, bomb_score))
        signals["five_star_ratio"] = round(five_star_ratio, 3)
        signals["bomb_score"] = round(bomb_score, 3)
        weighted_scores.append((bomb_score, 0.25))

        # 2b: Bimodal distribution — lots of 1-star AND 5-star, nothing in middle
        middle = dist_norm[1] + dist_norm[2] + dist_norm[3]  # 2,3,4 star
        extremes = dist_norm[0] + dist_norm[4]  # 1 and 5 star
        bimodal_score = min(middle / (extremes + 0.01), 1.0)
        signals["bimodal_score"] = round(bimodal_score, 3)
        weighted_scores.append((bimodal_score, 0.15))
    else:
        signals["five_star_ratio"] = None
        signals["bomb_score"] = None
        signals["bimodal_score"] = None

    # ── Signal 3: Rating value ──
    # 4.0-4.5 is most trustworthy. >4.8 is suspiciously perfect.
    if product.rating and product.rating > 0:
        r = product.rating
        if r >= 4.8:
            rating_trust = 0.4   # suspiciously perfect
        elif r >= 4.3:
            rating_trust = 1.0   # sweet spot
        elif r >= 3.8:
            rating_trust = 0.8   # good
        elif r >= 3.0:
            rating_trust = 0.6   # decent
        else:
            rating_trust = 0.3   # poor
        signals["rating_trust"] = round(rating_trust, 3)
        weighted_scores.append((rating_trust, 0.15))
    else:
        signals["rating_trust"] = None

    # ── Signal 4: Verified purchase ratio ──
    if product.review_count and product.review_count > 0 and product.verified_count and product.verified_count > 0:
        # verified_count is from the visible reviews on page (usually 8 max)
        # so we compare against min(review_count, 8)
        sample_size = min(product.review_count, 8)
        verified_ratio = min(product.verified_count / sample_size, 1.0)
        signals["verified_ratio"] = round(verified_ratio, 3)
        weighted_scores.append((verified_ratio, 0.15))
    else:
        signals["verified_ratio"] = None

    # ── Signal 5: Review text quality ──
    samples = product.review_samples or []
    if samples:
        # Average review length (short reviews = low quality / potentially fake)
        avg_len = np.mean([len(r.split()) for r in samples])
        text_quality = min(avg_len / 30.0, 1.0)  # 30+ words = good
        signals["avg_review_words"] = round(avg_len, 1)
        signals["text_quality"] = round(text_quality, 3)
        weighted_scores.append((text_quality, 0.08))

        # Generic phrase detection
        generic_hits = sum(
            1 for r in samples
            for phrase in GENERIC_PHRASES
            if phrase in r.lower()
        )
        generic_ratio = generic_hits / (len(samples) + 1)
        generic_score = 1.0 - min(generic_ratio, 1.0)
        signals["generic_ratio"] = round(generic_ratio, 3)
        signals["generic_score"] = round(generic_score, 3)
        weighted_scores.append((generic_score, 0.07))
    else:
        signals["text_quality"] = None
        signals["generic_score"] = None

    # ── Combine ──
    if not weighted_scores:
        # No live review data at all — fall back to static trust map
        static_trust = trust_map.get(product.product_id, 0.5)
        signals["source"] = "static_fallback"
        return static_trust, signals

    total_weight = sum(w for _, w in weighted_scores)
    trust = sum(s * w for s, w in weighted_scores) / total_weight
    trust = float(np.clip(trust, 0.0, 1.0))
    signals["source"] = "live"

    return trust, signals


# ── helpers ────────────────────────────────────────────────────────────────
def ndcg_at_k(scores, k=10):
    scores = np.array(scores[:k])
    ideal  = np.sort(scores)[::-1]
    def dcg(s):
        return sum((2**r - 1) / np.log2(i + 2) for i, r in enumerate(s))
    idcg = dcg(ideal)
    return dcg(scores) / idcg if idcg > 0 else 0.0


# ══════════════════════════════════════════════════════════════════════════
#  MAIN ENDPOINT
# ══════════════════════════════════════════════════════════════════════════

@app.post("/rerank", response_model=RankResponse)
def rerank(req: RankRequest):
    if not req.products:
        raise HTTPException(status_code=400, detail="No products provided")

    # extract features + predict relevance
    features = []
    trust_scores = []
    trust_signals_list = []

    for p in req.products:
        feat = extract_features(req.query, p)
        features.append([feat[f] for f in FEATURE_COLS])

        # LIVE trust scoring from scraped review data
        trust, signals = compute_live_trust(p)
        trust_scores.append(trust)
        trust_signals_list.append(signals)

    X             = np.array(features)
    relevance     = model.predict(X)
    trust_scores  = np.array(trust_scores)

    # normalize
    def norm(x):
        r = x.max() - x.min()
        return (x - x.min()) / r if r > 0 else np.ones_like(x) * 0.5

    rel_norm   = norm(relevance)
    trust_norm = norm(trust_scores) if trust_scores.max() != trust_scores.min() else trust_scores

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

    # ── Honest metrics ─────────────────────────────────────────────────────
    sponsored_indices = [i for i, p in enumerate(req.products) if p.sponsored]
    sponsored_found = len(sponsored_indices)

    # How many sponsored were in original top 5 but aren't in new top 5
    original_top5 = set(range(5))
    new_top5 = set(optimized_order[:5].tolist())
    sponsored_in_original_top5 = len([i for i in sponsored_indices if i in original_top5])
    sponsored_in_new_top5 = len([i for i in sponsored_indices if i in new_top5])
    sponsored_demoted = max(0, sponsored_in_original_top5 - sponsored_in_new_top5)

    # Low trust products demoted (trust < 0.4 that moved down)
    low_trust_demoted = 0
    for new_rank_pos, orig_idx in enumerate(optimized_order):
        p = req.products[orig_idx]
        if trust_scores[orig_idx] < 0.4 and (new_rank_pos + 1) > p.original_rank:
            low_trust_demoted += 1

    # Average trust in top 5 and bottom 5
    top5_indices = optimized_order[:5]
    bottom5_indices = optimized_order[-5:] if len(optimized_order) >= 5 else optimized_order
    avg_trust_top5 = float(np.mean(trust_scores[top5_indices]))
    avg_trust_bottom5 = float(np.mean(trust_scores[bottom5_indices]))

    # Backward compat: compute NDCG for the React UI
    baseline_relevance  = list(rel_norm)
    optimized_relevance = [rel_norm[i] for i in optimized_order]
    baseline_ndcg  = ndcg_at_k(baseline_relevance)
    optimized_ndcg = ndcg_at_k(optimized_relevance)
    bias_reduction = float(np.mean(sponsored_penalty[optimized_order[:10]] == 1.0) -
                           np.mean([p.sponsored for p in req.products[:10]])) if len(req.products) >= 10 else 0.0

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
            trust_score=float(trust_scores[idx]),
            final_score=float(final_scores[idx]),
            sponsored=p.sponsored,
            trust_signals=trust_signals_list[idx],
        ))

    return RankResponse(
        query=req.query,
        mode=req.mode,
        results=results,
        total_products=len(req.products),
        sponsored_found=sponsored_found,
        sponsored_demoted=sponsored_demoted,
        low_trust_demoted=low_trust_demoted,
        avg_trust_top5=round(avg_trust_top5, 4),
        avg_trust_bottom5=round(avg_trust_bottom5, 4),
        baseline_ndcg=round(baseline_ndcg, 4),
        optimized_ndcg=round(optimized_ndcg, 4),
        bias_reduction=round(bias_reduction * 100, 1),
    )

@app.get("/health")
def health():
    return {"status": "ok", "model": "ranker_v1.lgb", "features": len(FEATURE_COLS), "version": "2.0-live-trust"}

@app.get("/search")
def search_products(q: str, n: int = 10):
    """Search real ESCI products and return with simulated sponsored injection"""
    q_lower = q.lower()
    q_terms = set(q_lower.split())

    # score by term overlap
    def score(title):
        t = set(str(title).split())
        return len(q_terms & t) / len(q_terms) if q_terms else 0

    mask = products_df["product_title_lower"].apply(
        lambda t: any(term in str(t) for term in q_terms)
    )
    matches = products_df[mask].copy()

    if len(matches) < n:
        return {"products": [], "error": "Not enough matches"}

    matches["match_score"] = matches["product_title_lower"].apply(score)
    matches = matches.sort_values("match_score", ascending=False).head(50)
    matches = matches.sample(min(n, len(matches)), random_state=42)

    products = []
    for i, (_, row) in enumerate(matches.iterrows()):
        # simulate Amazon: inject sponsored at ranks 1,2,4 (top positions)
        sponsored = i in [0, 1, 3]
        products.append({
            "product_id":           row["product_id"],
            "product_title":        row["product_title"][:120],
            "product_description":  str(row["product_description"] or "")[:300],
            "product_bullet_point": str(row["product_bullet_point"] or "")[:300],
            "product_brand":        str(row["product_brand"] or ""),
            "product_color":        str(row["product_color"] or ""),
            "original_rank":        i + 1,
            "sponsored":            sponsored,
        })

    return {"products": products, "total_matches": int(mask.sum())}
