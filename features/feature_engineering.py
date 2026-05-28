import pandas as pd
import numpy as np
from pathlib import Path
import re
from tqdm import tqdm

tqdm.pandas()

RAW = Path("data/raw/esci")
OUT = Path("data/processed")
OUT.mkdir(parents=True, exist_ok=True)

# ── load ───────────────────────────────────────────────────────────────────
print("Loading data...")
examples = pd.read_parquet(RAW / "examples.parquet")
products = pd.read_parquet(RAW / "products.parquet")

# focus on english + train split only for now
examples = examples[(examples["product_locale"] == "us") & (examples["split"] == "train")].copy()
print(f"US train examples: {len(examples):,}")

# ── merge ──────────────────────────────────────────────────────────────────
df = examples.merge(products, on="product_id", how="left")
print(f"Merged shape: {df.shape}")

# ── label encoding ─────────────────────────────────────────────────────────
# ESCI: E=exact, S=substitute, C=complement, I=irrelevant
label_map = {"E": 3, "S": 2, "C": 1, "I": 0}
df["relevance_score"] = df["esci_label"].map(label_map)

# ── text features ──────────────────────────────────────────────────────────
def clean(text):
    if not isinstance(text, str):
        return ""
    return re.sub(r"\s+", " ", text.lower().strip())

print("Cleaning text...")
df["query_clean"]       = df["query"].progress_apply(clean)
df["title_clean"]       = df["product_title"].progress_apply(clean)
df["desc_clean"]        = df["product_description"].progress_apply(clean)
df["bullet_clean"]      = df["product_bullet_point"].progress_apply(clean)

# ── lexical match features ─────────────────────────────────────────────────
print("Computing lexical features...")

def query_terms(q):
    return set(q.split())

def term_overlap(query, text):
    if not query or not text:
        return 0.0
    q_terms = query_terms(query)
    t_terms = set(text.split())
    return len(q_terms & t_terms) / len(q_terms)

def title_contains_exact(query, title):
    if not query or not title:
        return 0
    return int(query in title)

def query_len(query):
    return len(query.split())

def title_len(title):
    return len(title.split()) if isinstance(title, str) else 0

df["f_title_overlap"]        = df.progress_apply(lambda r: term_overlap(r["query_clean"], r["title_clean"]), axis=1)
df["f_desc_overlap"]         = df.progress_apply(lambda r: term_overlap(r["query_clean"], r["desc_clean"]), axis=1)
df["f_bullet_overlap"]       = df.progress_apply(lambda r: term_overlap(r["query_clean"], r["bullet_clean"]), axis=1)
df["f_exact_title_match"]    = df.progress_apply(lambda r: title_contains_exact(r["query_clean"], r["title_clean"]), axis=1)
df["f_query_len"]            = df["query_clean"].apply(query_len)
df["f_title_len"]            = df["title_clean"].apply(title_len)
df["f_has_description"]      = df["desc_clean"].apply(lambda x: int(len(x) > 20))
df["f_has_bullets"]          = df["bullet_clean"].apply(lambda x: int(len(x) > 20))
df["f_has_brand"]            = df["product_brand"].apply(lambda x: int(isinstance(x, str) and len(x) > 0))
df["f_has_color"]            = df["product_color"].apply(lambda x: int(isinstance(x, str) and len(x) > 0))
df["f_title_query_len_ratio"] = df["f_title_len"] / (df["f_query_len"] + 1)

# ── save ───────────────────────────────────────────────────────────────────
feature_cols = [
    "example_id", "query_id", "product_id", "relevance_score",
    "f_title_overlap", "f_desc_overlap", "f_bullet_overlap",
    "f_exact_title_match", "f_query_len", "f_title_len",
    "f_has_description", "f_has_bullets", "f_has_brand",
    "f_has_color", "f_title_query_len_ratio"
]

df[feature_cols].to_parquet(OUT / "features_v1.parquet", index=False)
print(f"\nSaved to data/processed/features_v1.parquet")
print(f"Shape: {df[feature_cols].shape}")
print(f"\nLabel distribution:")
print(df["relevance_score"].value_counts().sort_index())