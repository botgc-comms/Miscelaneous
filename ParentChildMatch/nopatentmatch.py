import re
from typing import Optional, Set, List

import pandas as pd


JUNIORS_CSV_PATH = "untitled-report-2026-02-20-9_23_46.csv"
PARENTS_LINKS_CSV_PATH = "-generated-2026-03-12-19-41-44.csv"

OUTPUT_UNLINKED_JUNIORS_CSV_PATH = "juniors_without_assigned_parent.csv"


def _norm_text(value: object) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    if s.lower() in {"nan", "none"}:
        return ""
    s = re.sub(r"\s+", " ", s)
    return s


def _norm_member_id(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if pd.isna(value):
            return ""
        try:
            return str(int(value))
        except Exception:
            return ""
    s = _norm_text(value)
    if not s:
        return ""
    if re.fullmatch(r"\d+\.0+", s):
        return s.split(".", 1)[0]
    m = re.search(r"\d+", s)
    return m.group(0) if m else ""


def _normalise_header(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def _find_col(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    lookup = {_normalise_header(c): c for c in df.columns}
    for key in candidates:
        if key in lookup:
            return lookup[key]
    return None


def _find_child_ids_column(parents_df: pd.DataFrame) -> str:
    col = _find_col(
        parents_df,
        [
            "nonjuniorexplicitchildids",
            "explicitchildids",
            "childids",
            "childrenids",
            "parentchildrelationship",
            "parentchildrelationships",
            "parentchild",
            "children",
            "linkedchildren",
        ],
    )
    if col:
        return col

    for c in parents_df.columns:
        n = _normalise_header(c)
        if "child" in n and ("id" in n or "member" in n or "number" in n):
            return c

    return parents_df.columns[0]


def _extract_ids(cell: object) -> Set[str]:
    if cell is None:
        return set()
    if isinstance(cell, (int, float)) and not pd.isna(cell):
        mid = _norm_member_id(cell)
        return {mid} if mid else set()

    s = _norm_text(cell)
    if not s:
        return set()

    tokens = re.split(r"[,\s;/|]+", s)
    ids = {_norm_member_id(t) for t in tokens}
    return {i for i in ids if i}


def main() -> None:
    juniors_df = pd.read_csv(JUNIORS_CSV_PATH)
    parents_df = pd.read_csv(PARENTS_LINKS_CSV_PATH)

    junior_id_col = "Member (login) number"
    if junior_id_col not in juniors_df.columns:
        raise ValueError(f"Expected juniors file to contain column '{junior_id_col}'.")

    juniors_df["JuniorMemberId"] = juniors_df[junior_id_col].apply(_norm_member_id)
    juniors_df = juniors_df[juniors_df["JuniorMemberId"] != ""].copy()

    child_ids_col = _find_child_ids_column(parents_df)
    parents_df["ParsedChildIds"] = parents_df[child_ids_col].apply(_extract_ids)

    linked_child_ids: Set[str] = set()
    for s in parents_df["ParsedChildIds"]:
        linked_child_ids.update(s)

    unlinked = juniors_df[~juniors_df["JuniorMemberId"].isin(linked_child_ids)].copy()

    cols_out = []
    for c in ["Member (login) number", "Full Name", "Forename", "Surname", "Age", "Email", "Postcode", "Town"]:
        if c in unlinked.columns:
            cols_out.append(c)

    if not cols_out:
        cols_out = list(unlinked.columns)

    unlinked[cols_out].to_csv(OUTPUT_UNLINKED_JUNIORS_CSV_PATH, index=False)

    print("Parents links file child-id column used:", child_ids_col)
    print("Total juniors:", len(juniors_df))
    print("Linked junior ids:", len(linked_child_ids))
    print("Unlinked juniors:", len(unlinked))
    print("Wrote:", OUTPUT_UNLINKED_JUNIORS_CSV_PATH)


if __name__ == "__main__":
    main()
