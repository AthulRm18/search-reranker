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
