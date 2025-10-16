# pair_matcher.py
from typing import Callable, Optional, Tuple, List, Dict, Any
import pandas as pd

# Scorer returns Optional[float]: None means "no candidate"
ScoreFn = Callable[[str, str], Optional[float]]
CompatFn = Callable[[Optional[float], Optional[float]], bool]

def _ensure_cols(df: pd.DataFrame, rename: Dict[str, str]) -> pd.DataFrame:
    cols = {c.lower(): c for c in df.columns}
    out = df.copy()
    for want, alias in rename.items():
        if want in out.columns:
            continue
        lower_alias = alias.lower()
        if lower_alias in cols:
            out.rename(columns={cols[lower_alias]: want}, inplace=True)
    return out

def match_left_to_right(
    left_df: pd.DataFrame,
    right_df: pd.DataFrame,
    scorer: ScoreFn,
    compatible: CompatFn,
    top_k: int = 3,
    left_key_col: str = "Code",
    left_name_col: str = "Product",
    left_vol_col: Optional[str] = None,
    right_key_col: str = "id",
    right_name_col: str = "name",
    right_vol_col: Optional[str] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Wiring only:
      - If scorer(...) returns None for all candidates, mark UNMATCHED.
      - Otherwise pick the highest-scoring candidate, and emit top_k candidates.
    """
    L = _ensure_cols(left_df, {left_key_col: left_key_col, left_name_col: left_name_col})
    R = _ensure_cols(right_df, {right_key_col: right_key_col, right_name_col: right_name_col})

    matches_rows: List[Dict[str, Any]] = []
    candidates_rows: List[Dict[str, Any]] = []

    for _, lrow in L.iterrows():
        lkey = lrow.get(left_key_col)
        lname = str(lrow.get(left_name_col, "") or "")
        lvol = lrow.get(left_vol_col) if left_vol_col else None

        local: List[Dict[str, Any]] = []
        best: Optional[Dict[str, Any]] = None
        best_score: Optional[float] = None

        for _, rrow in R.iterrows():
            rkey = rrow.get(right_key_col)
            rname = str(rrow.get(right_name_col, "") or "")
            rvol = rrow.get(right_vol_col) if right_vol_col else None

            if not compatible(lvol, rvol):
                continue

            score = scorer(lname, rname)  # may be None
            if score is None:
                continue

            row = {
                "LeftKey": lkey, "LeftName": lname, "LeftVolumeML": lvol,
                "RightKey": rkey, "RightName": rname, "RightVolumeML": rvol,
                "Score": float(score)
            }
            local.append(row)

            if best_score is None or score > best_score:
                best_score = float(score)
                best = {**row, "Method": "left_to_right"}

        if local:
            local.sort(key=lambda d: d["Score"], reverse=True)
            for rank, row in enumerate(local[:max(1, top_k)], start=1):
                candidates_rows.append({**row, "Rank": rank})
            matches_rows.append(best)  # type: ignore[arg-type]
        else:
            matches_rows.append({
                "LeftKey": lkey, "LeftName": lname, "LeftVolumeML": lvol,
                "RightKey": None, "RightName": None, "RightVolumeML": None,
                "Score": None, "Method": "left_to_right"
            })

    matches = pd.DataFrame(matches_rows, columns=[
        "LeftKey","LeftName","LeftVolumeML",
        "RightKey","RightName","RightVolumeML",
        "Score","Method"
    ])
    candidates = pd.DataFrame(candidates_rows, columns=[
        "LeftKey","LeftName","LeftVolumeML",
        "RightKey","RightName","RightVolumeML",
        "Score","Rank"
    ])
    return matches, candidates

def match_right_to_left(
    right_df: pd.DataFrame,
    left_df: pd.DataFrame,
    scorer: ScoreFn,
    compatible: CompatFn,
    top_k: int = 3,
    right_key_col: str = "id",
    right_name_col: str = "name",
    right_vol_col: Optional[str] = None,
    left_key_col: str = "Code",
    left_name_col: str = "Product",
    left_vol_col: Optional[str] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    # Remap columns and reuse left->right logic
    r = right_df.rename(columns={
        right_key_col: "Code",
        right_name_col: "Product",
        **({right_vol_col: "VolR"} if right_vol_col else {})
    })
    l = left_df.rename(columns={
        left_key_col: "id",
        left_name_col: "name",
        **({left_vol_col: "VolL"} if left_vol_col else {})
    })

    matches_lr, candidates_lr = match_left_to_right(
        left_df=r, right_df=l, scorer=scorer, compatible=compatible, top_k=top_k,
        left_key_col="Code", left_name_col="Product", left_vol_col=("VolR" if right_vol_col else None),
        right_key_col="id", right_name_col="name", right_vol_col=("VolL" if left_vol_col else None),
    )

    matches = matches_lr.rename(columns={
        "LeftKey": right_key_col, "LeftName": right_name_col,
        "LeftVolumeML": (right_vol_col or "RightVolumeML"),
        "RightKey": left_key_col, "RightName": left_name_col,
        "RightVolumeML": (left_vol_col or "LeftVolumeML"),
    }).copy()
    matches["Method"] = "right_to_left"

    candidates = candidates_lr.rename(columns={
        "LeftKey": right_key_col, "LeftName": right_name_col,
        "LeftVolumeML": (right_vol_col or "RightVolumeML"),
        "RightKey": left_key_col, "RightName": left_name_col,
        "RightVolumeML": (left_vol_col or "LeftVolumeML"),
    }).copy()

    return matches, candidates

# Defaults: ensure UNMATCHED until a real scorer/compat is provided
def default_scorer(_: str, __: str) -> Optional[float]:
    return None

def default_compatible(_: Optional[float], __: Optional[float]) -> bool:
    return True
