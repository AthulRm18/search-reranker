import pandas as pd
from pathlib import Path

# Paths
RAW_PATH = Path("data/raw/esci/products.parquet")
TRUST_PATH = Path("data/processed/product_trust_scores.parquet")

print("Loading original datasets...")
products_df = pd.read_parquet(RAW_PATH)
trust_df = pd.read_parquet(TRUST_PATH)

print(f"Original products rows: {len(products_df):,}")
print(f"Original trust score rows: {len(trust_df):,}")

# Filter to US locale products
df_us = products_df[products_df["product_locale"] == "us"].copy()

# Keep only rows containing popular query keywords (to support test searches)
keywords = "headphone|earbud|wireless|speaker|charger|cable|phone|laptop|keyboard|mouse|watch|monitor|stand"
df_trimmed = df_us[df_us["product_title"].str.lower().str.contains(keywords, na=False)].copy()

# Limit to a highly-relevant, compact sample (e.g. 15,000 rows) to keep it under 2MB
df_trimmed = df_trimmed.sample(min(15000, len(df_trimmed)), random_state=42)

# Keep only matching trust score IDs
trust_trimmed = trust_df[trust_df["ProductId"].isin(df_trimmed["product_id"])].copy()

print(f"Trimmed products rows: {len(df_trimmed):,}")
print(f"Trimmed trust score rows: {len(trust_trimmed):,}")

# Save back and overwrite with high compression
df_trimmed.to_parquet(RAW_PATH, compression="snappy", index=False)
trust_trimmed.to_parquet(TRUST_PATH, compression="snappy", index=False)

print("Datasets optimized successfully!")
