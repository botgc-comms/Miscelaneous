import re
from dataclasses import dataclass
from typing import List, Tuple, Optional, Dict, Set

import pandas as pd


JUNIORS_CSV_PATH = "untitled-report-2026-02-20-9_23_46.csv"
NON_JUNIORS_CSV_PATH = "untitled-report-2026-02-20-10_52_49.csv"

OUTPUT_JUNIOR_TO_ADULTS = "junior_to_non_junior_relationship_candidates.csv"
OUTPUT_ADULT_TO_JUNIORS = "non_junior_to_junior_relationship_candidates.csv"


PARENT_CHILD_RELATIONSHIP_COL = "Parent-Child Relationship"


def _norm_text(value: object) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    if s.lower() in {"nan", "none"}:
        return ""
    s = re.sub(r"\s+", " ", s)
    return s


def _norm_upper(value: object) -> str:
    return _norm_text(value).upper()


def _norm_email(value: object) -> str:
    return _norm_text(value).strip().lower()


def _digits_only(value: object) -> str:
    s = _norm_text(value)
    if not s:
        return ""
    return re.sub(r"\D+", "", s)


def _norm_member_id(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return ""
    if isinstance(value, (int,)):
        return str(value)
    if isinstance(value, (float,)):
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


def _norm_postcode(value: object) -> str:
    s = _norm_upper(value)
    if not s:
        return ""
    s = s.replace(" ", "")
    return s


def _norm_title(value: object) -> str:
    s = _norm_upper(value)
    s = re.sub(r"[^\w]+", "", s)
    titles = {"MR", "MRS", "MS", "MISS", "DR", "PROF", "REV", "SIR", "LADY"}
    return s if s in titles else ""


def _norm_name_part(value: object) -> str:
    s = _norm_text(value)
    s = re.sub(r"[^\w'\- ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _safe_int(value: object) -> Optional[int]:
    s = _norm_text(value)
    if not s:
        return None
    try:
        return int(float(s))
    except Exception:
        return None


def _address_key(row: pd.Series) -> str:
    parts = [
        _norm_upper(row.get("Address 1", "")),
        _norm_upper(row.get("Address 2", "")),
        _norm_upper(row.get("Address 3", "")),
        _norm_upper(row.get("Town", "")),
        _norm_postcode(row.get("Postcode", "")),
    ]
    parts = [p for p in parts if p]
    return "|".join(parts)


def _address1_postcode_key(row: pd.Series) -> str:
    a1 = _norm_upper(row.get("Address 1", ""))
    pc = _norm_postcode(row.get("Postcode", ""))
    if not a1 or not pc:
        return ""
    return f"{a1}|{pc}"


def _match_band(score: int) -> str:
    if score >= 1000:
        return "EXACT"
    if score >= 120:
        return "Very likely"
    if score >= 80:
        return "Likely"
    if score >= 45:
        return "Possible"
    return "Weak"


def _surname_weight(surname: str, surname_freq: dict) -> int:
    if not surname:
        return 0
    freq = surname_freq.get(surname, 0)
    if freq <= 2:
        return 36
    if freq <= 5:
        return 32
    if freq <= 20:
        return 26
    if freq <= 100:
        return 16
    return 9


@dataclass
class Weights:
    same_email: int = 120
    same_mobile: int = 45
    same_hometel: int = 35
    same_worktel: int = 25
    exact_address: int = 60
    address1_postcode: int = 45
    same_postcode: int = 20
    same_town: int = 6
    plausible_parent: int = 16
    plausible_grandparent: int = 11
    postcode_but_surname_diff: int = 9


def _age_relation_bonus(junior_age: Optional[int], adult_age: Optional[int], w: Weights) -> Tuple[int, List[str]]:
    if junior_age is None or adult_age is None:
        return 0, []
    diff = adult_age - junior_age
    reasons: List[str] = []
    bonus = 0
    if 18 <= diff <= 55:
        bonus = max(bonus, w.plausible_parent)
        reasons.append(f"Age gap plausible parent ({diff}y)")
    if 40 <= diff <= 80:
        bonus = max(bonus, w.plausible_grandparent)
        reasons.append(f"Age gap plausible grandparent ({diff}y)")
    return bonus, reasons


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()

    out["MemberNumber"] = out["Member (login) number"].apply(_norm_text)
    out["MemberNumberN"] = out["Member (login) number"].apply(_norm_member_id)

    out["TitleN"] = out["Title"].apply(_norm_title)
    out["ForenameN"] = out["Forename"].apply(_norm_name_part)
    out["SurnameN"] = out["Surname"].apply(lambda x: _norm_name_part(x).upper())
    out["FullNameN"] = out["Full Name"].apply(_norm_name_part)

    out["EmailN"] = out["Email"].apply(_norm_email)

    out["MobileN"] = out["Mobile"].apply(_digits_only)
    out["HometelN"] = out["Hometel"].apply(_digits_only)
    out["WorkN"] = out["Work"].apply(_digits_only)

    out["PostcodeN"] = out["Postcode"].apply(_norm_postcode)
    out["TownN"] = out["Town"].apply(_norm_upper)

    out["AgeN"] = out["Age"].apply(_safe_int)

    out["AddressKey"] = out.apply(_address_key, axis=1)
    out["Address1PostcodeKey"] = out.apply(_address1_postcode_key, axis=1)

    if PARENT_CHILD_RELATIONSHIP_COL in out.columns:
        out["ParentChildRelationshipRaw"] = out[PARENT_CHILD_RELATIONSHIP_COL].apply(_norm_text)
    else:
        out["ParentChildRelationshipRaw"] = ""

    return out


def _parse_child_ids(value: object) -> List[str]:
    if value is None:
        return []
    if isinstance(value, (int, float)) and not pd.isna(value):
        mid = _norm_member_id(value)
        return [mid] if mid else []
    s = _norm_text(value)
    if not s:
        return []
    tokens = re.split(r"[;,]", s)
    ids: List[str] = []
    for t in tokens:
        mid = _norm_member_id(t)
        if mid:
            ids.append(mid)
    return ids


def build_explicit_relationships(non_juniors_raw: pd.DataFrame) -> Dict[str, Set[str]]:
    if PARENT_CHILD_RELATIONSHIP_COL not in non_juniors_raw.columns:
        return {}

    relationships: Dict[str, Set[str]] = {}

    for _, row in non_juniors_raw.iterrows():
        adult_id_n = _norm_member_id(row.get("Member (login) number", ""))
        if not adult_id_n:
            continue

        child_ids = _parse_child_ids(row.get(PARENT_CHILD_RELATIONSHIP_COL, ""))
        child_ids_set = {cid for cid in child_ids if cid}

        if child_ids_set:
            relationships[adult_id_n] = child_ids_set

    return relationships


def score_pair(
    j: pd.Series,
    a: pd.Series,
    surname_freq: dict,
    w: Weights,
    explicit_relationships: Dict[str, Set[str]],
) -> Tuple[int, List[str], bool, Set[str]]:
    adult_id_n = a["MemberNumberN"]
    junior_id_n = j["MemberNumberN"]

    explicit_child_ids = explicit_relationships.get(adult_id_n, set())
    is_exact = bool(adult_id_n and junior_id_n and junior_id_n in explicit_child_ids)

    if is_exact:
        return 1000, ["Explicit parent-child relationship"], True, explicit_child_ids

    score = 0
    reasons: List[str] = []

    if j["EmailN"] and a["EmailN"] and j["EmailN"] == a["EmailN"]:
        score += w.same_email
        reasons.append("Same email")

    if j["MobileN"] and a["MobileN"] and j["MobileN"] == a["MobileN"]:
        score += w.same_mobile
        reasons.append("Same mobile")

    if j["HometelN"] and a["HometelN"] and j["HometelN"] == a["HometelN"]:
        score += w.same_hometel
        reasons.append("Same home telephone")

    if j["WorkN"] and a["WorkN"] and j["WorkN"] == a["WorkN"]:
        score += w.same_worktel
        reasons.append("Same work telephone")

    if j["AddressKey"] and a["AddressKey"] and j["AddressKey"] == a["AddressKey"]:
        score += w.exact_address
        reasons.append("Same full address")
    elif j["Address1PostcodeKey"] and a["Address1PostcodeKey"] and j["Address1PostcodeKey"] == a["Address1PostcodeKey"]:
        score += w.address1_postcode
        reasons.append("Same Address 1 + postcode")
    elif j["PostcodeN"] and a["PostcodeN"] and j["PostcodeN"] == a["PostcodeN"]:
        score += w.same_postcode
        reasons.append("Same postcode")

    if j["TownN"] and a["TownN"] and j["TownN"] == a["TownN"]:
        score += w.same_town
        reasons.append("Same town")

    if j["SurnameN"] and a["SurnameN"] and j["SurnameN"] == a["SurnameN"]:
        sw = _surname_weight(j["SurnameN"], surname_freq)
        score += sw
        reasons.append(f"Same surname (weighted {sw})")
    else:
        if j["PostcodeN"] and a["PostcodeN"] and j["PostcodeN"] == a["PostcodeN"]:
            score += w.postcode_but_surname_diff
            reasons.append("Same postcode but different surname (possible guardian/step-parent)")

    age_bonus, age_reasons = _age_relation_bonus(j["AgeN"], a["AgeN"], w)
    if age_bonus:
        score += age_bonus
        reasons.extend(age_reasons)

    return score, reasons, False, explicit_child_ids


def main() -> None:
    juniors_raw = pd.read_csv(JUNIORS_CSV_PATH)
    non_juniors_raw = pd.read_csv(NON_JUNIORS_CSV_PATH)

    explicit_relationships = build_explicit_relationships(non_juniors_raw)

    juniors = prepare(juniors_raw)
    non_juniors = prepare(non_juniors_raw)

    surname_freq = pd.concat([juniors["SurnameN"], non_juniors["SurnameN"]]).value_counts(dropna=True).to_dict()

    w = Weights()

    non_juniors_by_email = non_juniors[non_juniors["EmailN"] != ""].set_index("EmailN", drop=False)
    non_juniors_by_postcode = non_juniors[non_juniors["PostcodeN"] != ""].set_index("PostcodeN", drop=False)
    non_juniors_by_surname = non_juniors[non_juniors["SurnameN"] != ""].set_index("SurnameN", drop=False)

    results_j2a: List[dict] = []

    for _, j in juniors.iterrows():
        candidate_frames: List[pd.DataFrame] = []

        if j["EmailN"] and j["EmailN"] in non_juniors_by_email.index:
            hit = non_juniors_by_email.loc[j["EmailN"]]
            candidate_frames.append(hit.to_frame().T if isinstance(hit, pd.Series) else hit)

        if j["PostcodeN"] and j["PostcodeN"] in non_juniors_by_postcode.index:
            hit = non_juniors_by_postcode.loc[j["PostcodeN"]]
            candidate_frames.append(hit.to_frame().T if isinstance(hit, pd.Series) else hit)

        if j["SurnameN"] and j["SurnameN"] in non_juniors_by_surname.index:
            hit = non_juniors_by_surname.loc[j["SurnameN"]]
            candidate_frames.append(hit.to_frame().T if isinstance(hit, pd.Series) else hit)

        if candidate_frames:
            candidates = pd.concat(candidate_frames, ignore_index=True).drop_duplicates(subset=["MemberNumberN"])
        else:
            candidates = non_juniors.copy()

        scored: List[Tuple[int, pd.Series, List[str], bool, Set[str]]] = []
        for _, a in candidates.iterrows():
            score, reasons, is_exact, explicit_child_ids = score_pair(j, a, surname_freq, w, explicit_relationships)
            if score > 0:
                scored.append((score, a, reasons, is_exact, explicit_child_ids))

        scored.sort(key=lambda t: t[0], reverse=True)
        top_scored = scored[:25]

        for score, a, reasons, is_exact, explicit_child_ids in top_scored:
            results_j2a.append(
                {
                    "JuniorMemberNumber": j["MemberNumber"],
                    "JuniorMemberNumberN": j["MemberNumberN"],
                    "JuniorName": _norm_text(j.get("Full Name", "")) or f"{_norm_text(j.get('Forename', ''))} {_norm_text(j.get('Surname', ''))}".strip(),
                    "JuniorAge": j["AgeN"],
                    "JuniorEmail": j["EmailN"],
                    "JuniorPostcode": j["PostcodeN"],
                    "NonJuniorMemberNumber": a["MemberNumber"],
                    "NonJuniorMemberNumberN": a["MemberNumberN"],
                    "NonJuniorName": _norm_text(a.get("Full Name", "")) or f"{_norm_text(a.get('Forename', ''))} {_norm_text(a.get('Surname', ''))}".strip(),
                    "NonJuniorAge": a["AgeN"],
                    "NonJuniorEmail": a["EmailN"],
                    "NonJuniorPostcode": a["PostcodeN"],
                    "NonJuniorParentChildRelationship": a["ParentChildRelationshipRaw"],
                    "NonJuniorExplicitChildIds": ",".join(sorted(explicit_child_ids)) if explicit_child_ids else "",
                    "NonJuniorHasExplicitLinks": bool(explicit_child_ids),
                    "IsExact": is_exact,
                    "Score": score,
                    "Band": _match_band(score),
                    "Reasons": "; ".join(reasons),
                }
            )

    j2a_df = pd.DataFrame(results_j2a)
    if not j2a_df.empty:
        j2a_df.sort_values(["JuniorMemberNumberN", "Score"], ascending=[True, False], inplace=True)
    j2a_df.to_csv(OUTPUT_JUNIOR_TO_ADULTS, index=False)

    results_a2j: List[dict] = []
    if not j2a_df.empty:
        for _, group in j2a_df.groupby(["NonJuniorMemberNumberN"]):
            top = group.sort_values("Score", ascending=False).head(25)
            for _, row in top.iterrows():
                results_a2j.append(
                    {
                        "NonJuniorMemberNumber": row["NonJuniorMemberNumber"],
                        "NonJuniorMemberNumberN": row["NonJuniorMemberNumberN"],
                        "NonJuniorName": row["NonJuniorName"],
                        "NonJuniorAge": row["NonJuniorAge"],
                        "NonJuniorEmail": row["NonJuniorEmail"],
                        "NonJuniorPostcode": row["NonJuniorPostcode"],
                        "NonJuniorParentChildRelationship": row["NonJuniorParentChildRelationship"],
                        "NonJuniorExplicitChildIds": row["NonJuniorExplicitChildIds"],
                        "NonJuniorHasExplicitLinks": row["NonJuniorHasExplicitLinks"],
                        "JuniorMemberNumber": row["JuniorMemberNumber"],
                        "JuniorMemberNumberN": row["JuniorMemberNumberN"],
                        "JuniorName": row["JuniorName"],
                        "JuniorAge": row["JuniorAge"],
                        "JuniorEmail": row["JuniorEmail"],
                        "JuniorPostcode": row["JuniorPostcode"],
                        "IsExact": row["IsExact"],
                        "Score": row["Score"],
                        "Band": row["Band"],
                        "Reasons": row["Reasons"],
                    }
                )

    a2j_df = pd.DataFrame(results_a2j)
    if not a2j_df.empty:
        a2j_df.sort_values(["NonJuniorMemberNumberN", "Score"], ascending=[True, False], inplace=True)
    a2j_df.to_csv(OUTPUT_ADULT_TO_JUNIORS, index=False)

    print("Wrote:")
    print(OUTPUT_JUNIOR_TO_ADULTS)
    print(OUTPUT_ADULT_TO_JUNIORS)


if __name__ == "__main__":
    main()
