#!/usr/bin/env python3
# run_matching.py
import csv
import json
import re
from pathlib import Path
import numpy as np
import pandas as pd

from pair_matcher import (
    match_left_to_right,
    match_right_to_left,
    default_compatible,
)
from strategies import scorer_cascade

HERE = Path(__file__).resolve().parent
STOCKTAKE = HERE / "botgc stocktake 25.txt"
SYSTEM = HERE / "response_1760601522626.json"
OUT_PREFIX = HERE / "stock_merge"

def resolve_one_to_one(pairs: pd.DataFrame) -> pd.DataFrame:
    if pairs.empty:
        return pairs.copy()
    df = pairs.copy()
    df["CombinedScore"] = df[["L2RScore","R2LScore"]].max(axis=1, skipna=True).fillna(-1.0)
    df["RightNameLen"] = df["RightName"].astype(str).str.len()
    df["LeftNameLen"]  = df["LeftName"].astype(str).str.len()
    df = df.sort_values(
        by=["CombinedScore","RightNameLen","LeftNameLen","LeftName","RightName"],
        ascending=[False, False, False, True, True]
    ).reset_index(drop=True)
    used_left  = set()
    used_right = set()
    chosen_rows = []
    for _, row in df.iterrows():
        lk = row["LeftKey"]
        rk = row["RightKey"]
        if pd.isna(lk) or pd.isna(rk):
            continue
        if lk in used_left or rk in used_right:
            continue
        used_left.add(lk)
        used_right.add(rk)
        chosen_rows.append(row)
    out = pd.DataFrame(chosen_rows)
    keep_cols = ["LeftKey","LeftName","RightKey","RightName","L2RScore","R2LScore","CombinedScore","Source"]
    out = out[keep_cols].sort_values(["LeftName","RightName"]).reset_index(drop=True)
    return out

def sniff_separator(path: Path) -> str:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            sample = f.read(4096)
        dialect = csv.Sniffer().sniff(sample, delimiters=[",",";","\t","|"])
        return dialect.delimiter
    except Exception:
        return ","

def load_stocktake(path: Path) -> pd.DataFrame:
    """
    Load Code, Product, Size from the stocktake.
    If 'Size' is absent, create it as NA.
    """
    sep = sniff_separator(path)
    df_try = pd.read_csv(path, sep=sep, dtype=str, encoding_errors="replace")
    lower = [c.lower() for c in df_try.columns.astype(str)]
    if "code" in lower and ("product" in lower or "name" in lower):
        rename = {}
        for c in df_try.columns:
            lc = c.lower()
            if lc == "code": rename[c] = "Code"
            if lc in ("product","name"): rename[c] = "Product"
            if lc == "size": rename[c] = "Size"
        df = df_try.rename(columns=rename)
        if "Size" not in df.columns:
            df["Size"] = pd.NA
        return df[["Code","Product","Size"]].copy()
    # Headerless: assume col0=Code, col1=Product, col2=Size (if present)
    df = pd.read_csv(path, sep=sep, header=None, dtype=str, encoding_errors="replace")
    while df.shape[1] < 3:
        df[df.shape[1]] = None
    df = df.iloc[:, :3].copy()
    df.columns = ["Code","Product","Size"]
    return df

def load_system(path: Path) -> pd.DataFrame:
    """
    Keep matching unchanged: id + name are what we feed to the matcher.
    Also surface IsActive for right-side outputs (unmatched_right).
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    df = pd.DataFrame(data)

    # id + name stay for matching
    cols = []
    if "id" in df.columns: cols.append("id")
    if "name" in df.columns: cols.append("name")

    # IsActive for outputs
    if "isActive" in df.columns:
        df["IsActive"] = df["isActive"]
    elif "active" in df.columns:
        df["IsActive"] = df["active"]
    else:
        df["IsActive"] = pd.NA
    cols += ["IsActive"]

    df = df[cols].copy()
    if "id" in df.columns:
        df["id"] = df["id"].astype(str)
    return df

def write_csv(df: pd.DataFrame, path: Path) -> None:
    df.to_csv(path, index=False, encoding="utf-8", lineterminator="\n")

def sort_by_product(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    if "LeftName" in d.columns and "Rank" in d.columns:
        return d.sort_values(["LeftName", "Rank"]).reset_index(drop=True)
    if "LeftName" in d.columns:
        keys = ["LeftName"]
        if "RightName" in d.columns:
            keys.append("RightName")
        return d.sort_values(keys).reset_index(drop=True)
    if "Product" in d.columns and "Rank" in d.columns:
        return d.sort_values(["Product", "Rank"]).reset_index(drop=True)
    if "Product" in d.columns:
        return d.sort_values(["Product"]).reset_index(drop=True)
    if "RightName" in d.columns:
        return d.sort_values(["RightName"]).reset_index(drop=True)
    return d.reset_index(drop=True)

def _normalise_left_name_key(s: str) -> str:
    s = str(s or "").lower().strip()
    s = re.sub(r"\s+", " ", s)
    return s

def main():
    if not STOCKTAKE.exists():
        raise FileNotFoundError(f"Stocktake file not found next to script: {STOCKTAKE}")
    if not SYSTEM.exists():
        raise FileNotFoundError(f"System JSON file not found next to script: {SYSTEM}")

    left_full = load_stocktake(STOCKTAKE)  # Code, Product, Size
    right = load_system(SYSTEM)            # id, name, IsActive (for outputs only)

    # --- Skip left rows whose name appears more than once (by normalised name) ---
    tmp = left_full.copy()
    tmp["_NameKey"] = tmp["Product"].map(_normalise_left_name_key)
    dupe_mask = tmp["_NameKey"].duplicated(keep=False)
    left_dupes = tmp[dupe_mask].drop(columns=["_NameKey"]).copy()
    left_solo  = tmp[~dupe_mask].drop(columns=["_NameKey"]).copy()

    # Use only unique-name left rows for matching
    left = left_solo

    scorer = scorer_cascade()

    # Run both directions (matching unchanged)
    l2r_matches, l2r_candidates = match_left_to_right(
        left_df=left,
        right_df=right[["id","name"]],
        scorer=scorer,
        compatible=default_compatible,
        top_k=3,
        left_key_col="Code",
        left_name_col="Product",
        left_vol_col=None,
        right_key_col="id",
        right_name_col="name",
        right_vol_col=None,
    )
    r2l_matches, r2l_candidates = match_right_to_left(
        right_df=right[["id","name"]],
        left_df=left,
        scorer=scorer,
        compatible=default_compatible,
        top_k=3,
        right_key_col="id",
        right_name_col="name",
        right_vol_col=None,
        left_key_col="Code",
        left_name_col="Product",
        left_vol_col=None,
    )

    # Status columns
    for d in (l2r_matches, r2l_matches):
        if "RightKey" in d.columns:
            d["Status"] = d["RightKey"].notna().map({True:"matched", False:"unmatched"})
        elif "Code" in d.columns:
            d["Status"] = d["Code"].notna().map({True:"matched", False:"unmatched"})

    # Matched-only / Unmatched-only from solo-set matching
    l2r_matched_only   = l2r_matches.dropna(subset=["RightKey"]) if "RightKey" in l2r_matches.columns else l2r_matches.iloc[0:0]
    r2l_matched_only   = r2l_matches.dropna(subset=["Code"])     if "Code" in r2l_matches.columns     else r2l_matches.iloc[0:0]
    l2r_unmatched_only = l2r_matches[l2r_matches["RightKey"].isna()] if "RightKey" in l2r_matches.columns else l2r_matches.iloc[0:0]
    r2l_unmatched_only = r2l_matches[r2l_matches["Code"].isna()]     if "Code" in r2l_matches.columns     else r2l_matches.iloc[0:0]

    # Build single deduped union of matched pairs (unchanged)
    l2r_pairs = (
        l2r_matched_only[["LeftKey","LeftName","RightKey","RightName","Score"]]
        .rename(columns={"Score":"L2RScore"})
    )
    r2l_pairs = (
        r2l_matched_only[["id","name","Code","Product","Score"]]
        .rename(columns={
            "id":"RightKey","name":"RightName",
            "Code":"LeftKey","Product":"LeftName",
            "Score":"R2LScore"
        })
    )
    pairs_union = pd.merge(
        l2r_pairs, r2l_pairs,
        on=["LeftKey","RightKey"],
        how="outer",
        suffixes=("_L2R","_R2L")
    )

    def coalesce(a, b): return a if pd.notna(a) and a != "" else b
    pairs_union["LeftName"]  = [coalesce(a, b) for a, b in zip(pairs_union.get("LeftName_L2R"),  pairs_union.get("LeftName_R2L"))]
    pairs_union["RightName"] = [coalesce(a, b) for a, b in zip(pairs_union.get("RightName_L2R"), pairs_union.get("RightName_R2L"))]
    pairs_union["Source"]    = np.where(
        pairs_union["L2RScore"].notna() & pairs_union["R2LScore"].notna(), "both",
        np.where(pairs_union["L2RScore"].notna(), "l2r", "r2l")
    )
    dedup_pairs = (
        pairs_union[["LeftKey","LeftName","RightKey","RightName","L2RScore","R2LScore","Source"]]
        .drop_duplicates()
        .reset_index(drop=True)
    )

    one2one_pairs = resolve_one_to_one(dedup_pairs)

    # Unmatched LEFT: now include Size
    unmatched_left_from_match = (
        l2r_unmatched_only[["LeftKey","LeftName"]]
        .merge(
            left_full[["Code","Size"]].rename(columns={"Code":"LeftKey","Size":"LeftSize"}),
            how="left",
            on="LeftKey"
        )
        .drop_duplicates()
    )
    dupes_as_unmatched = (
        left_dupes.rename(columns={"Code":"LeftKey","Product":"LeftName","Size":"LeftSize"})
        [["LeftKey","LeftName","LeftSize"]]
        .drop_duplicates()
    )
    unmatched_left = pd.concat([unmatched_left_from_match, dupes_as_unmatched], ignore_index=True).drop_duplicates()
    unmatched_left = sort_by_product(unmatched_left)

    # Unmatched RIGHT: include IsActive
    unmatched_right = (
        r2l_unmatched_only[["id","name"]]
        .rename(columns={"id":"RightKey","name":"RightName"})
        .drop_duplicates()
        .merge(
            right[["id","IsActive"]].rename(columns={"id":"RightKey"}),
            how="left",
            on="RightKey"
        )
        .sort_values(["RightName"]).reset_index(drop=True)
    )

    # ---- Sort outputs ----
    l2r_matches        = sort_by_product(l2r_matches)
    l2r_matched_only   = sort_by_product(l2r_matched_only)
    l2r_candidates     = sort_by_product(l2r_candidates)
    r2l_matches        = sort_by_product(r2l_matches)
    r2l_matched_only   = sort_by_product(r2l_matched_only)
    r2l_candidates     = sort_by_product(r2l_candidates)
    dedup_pairs        = sort_by_product(dedup_pairs)
    one2one_pairs      = sort_by_product(one2one_pairs)

    # Paths
    out_dir = OUT_PREFIX.parent
    p_l2r_all         = out_dir / (OUT_PREFIX.name + "_l2r_matches_all.csv")
    p_l2r_matched     = out_dir / (OUT_PREFIX.name + "_l2r_matches_matched.csv")
    p_l2r_cands       = out_dir / (OUT_PREFIX.name + "_l2r_candidates.csv")
    p_r2l_all         = out_dir / (OUT_PREFIX.name + "_r2l_matches_all.csv")
    p_r2l_matched     = out_dir / (OUT_PREFIX.name + "_r2l_matches_matched.csv")
    p_r2l_cands       = out_dir / (OUT_PREFIX.name + "_r2l_candidates.csv")
    p_pairs           = out_dir / (OUT_PREFIX.name + "_pairs.csv")
    p_pairs_one2one   = out_dir / (OUT_PREFIX.name + "_pairs_one2one.csv")
    p_unmatched_left  = out_dir / (OUT_PREFIX.name + "_unmatched_left.csv")
    p_unmatched_right = out_dir / (OUT_PREFIX.name + "_unmatched_right.csv")

    # Write
    write_csv(l2r_matches,       p_l2r_all)
    write_csv(l2r_matched_only,  p_l2r_matched)
    write_csv(l2r_candidates,    p_l2r_cands)
    write_csv(r2l_matches,       p_r2l_all)
    write_csv(r2l_matched_only,  p_r2l_matched)
    write_csv(r2l_candidates,    p_r2l_cands)
    write_csv(dedup_pairs,       p_pairs)
    write_csv(one2one_pairs,     p_pairs_one2one)
    write_csv(unmatched_left,    p_unmatched_left)
    write_csv(unmatched_right,   p_unmatched_right)

    matched_left  = int(l2r_matched_only.shape[0])
    matched_right = int(r2l_matched_only.shape[0])
    both_count    = int((dedup_pairs["Source"] == "both").sum())
    skipped_dupes = int(left_dupes.shape[0])

    print("=== Summary ===")
    print(f"Left rows (stocktake): {len(left_full)}  (skipped duplicates: {skipped_dupes})")
    print(f"Right rows (system):   {len(right)}")
    print(f"Left→Right matched:    {matched_left}")
    print(f"Right→Left matched:    {matched_right}")
    print(f"Unique pairs (union):  {len(dedup_pairs)}  (both: {both_count})")
    print(f"One-to-one pairs:      {len(one2one_pairs)}")
    print(f"Wrote: {p_pairs.name}")
    print(f"Wrote: {p_pairs_one2one.name}")
    print(f"Wrote: {p_unmatched_left.name}")
    print(f"Wrote: {p_unmatched_right.name}")

if __name__ == "__main__":
    main()
