#!/usr/bin/env python3
import csv
import re
import sys
from pathlib import Path
from typing import Dict, Any, List, Tuple

import requests

CSV_PATH = Path("venners_report_enriched.csv")
API_BASE = "https://api-botgcapps-prd.azurewebsites.net/api/stock/stockItems"
API_KEY = "Hawk3rHunt3r$"

HEADERS = {
    "Content-Type": "application/json",
    "X-API-KEY": API_KEY,
}

def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()

def normalise_header(name: str) -> str:
    return name.strip().lower().replace(" ", "_")

def parse_size_to_ml(size_str: str) -> Tuple[int, str]:
    s = norm(size_str)
    m = re.search(r"(\d+(?:\.\d+)?)\s*(ml|cl|l|ltr|litre|liter)\b", s)
    if m:
        val = float(m.group(1))
        unit = m.group(2)
        if unit == "ml":
            ml = int(round(val))
        elif unit == "cl":
            ml = int(round(val * 10))
        else:
            ml = int(round(val * 1000))
        return ml, "ml"
    m2 = re.search(r"^\s*(\d+(?:\.\d+)?)\s*$", (size_str or ""))
    if m2:
        val = float(m2.group(1))
        if val <= 100:
            return int(round(val * 10)), "ml"
        return int(round(val)), "ml"
    return 0, ""

def pick_size_source(csv_row: dict) -> str:
    raw_manual = (csv_row.get("manual_size") or "").strip()
    placeholder = {"bottle", "can", "postmix", "ten", "doz", "each", "gal"}
    if raw_manual.lower() in placeholder or raw_manual == "":
        return str(csv_row.get("Size") or csv_row.get("Venners_Size") or "").strip()
    return raw_manual

def load_csv_rows(path: Path) -> Tuple[List[Dict[str, Any]], List[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        rows = list(reader)
    return rows, headers

def fetch_stock_items() -> List[Dict[str, Any]]:
    resp = requests.get(API_BASE, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    return resp.json()

def choose_trade_unit(stock_item: Dict[str, Any], csv_row: Dict[str, Any]) -> Tuple[str, str]:
    unit_base = norm(stock_item.get("unit", ""))
    division = norm(stock_item.get("division", ""))
    tus = stock_item.get("tradeUnits", []) or []
    tu_names = [tu.get("unitName", "") for tu in tus]
    tu_names_norm = [norm(x) for x in tu_names]

    code = (csv_row.get("Code") or csv_row.get("Venners_Code") or csv_row.get("code") or "").strip()
    name = norm(csv_row.get("Name") or csv_row.get("Venners_Name") or csv_row.get("name") or "")
    size_raw = pick_size_source(csv_row)
    size_ml, _ = parse_size_to_ml(size_raw)
    size_token_ml = f"{size_ml}ml" if size_ml else ""
    size_token_cl = f"{int(round(size_ml/10))}cl" if size_ml else ""

    size_label = norm(csv_row.get("Size") or csv_row.get("Venners_Size") or "")
    manual_label = norm(csv_row.get("manual_size") or "")

    cand: List[str] = []

    if unit_base in ("each", "packet"):
        sz = size_label or manual_label
        nm = name
        if sz in ("doz", "dozen") or " doz" in nm or " dozen" in nm:
            cand += ["box of 12", "dozen", "12"]
        if sz in ("ten",) or " ten" in nm or nm.endswith(" ten"):
            cand += ["box of 10", "10"]
        cand += ["packet"]

    if unit_base == "bottle":
        if size_ml:
            cand += [f"bottle {size_token_ml}", f"bottle {size_token_cl}"]
        cand += ["single bottle", "bottle"]

    if unit_base == "can":
        if size_ml:
            cand += [f"can {size_token_ml}", f"can {size_token_cl}"]
        cand += ["single can", "can"]

    if unit_base in ("pint", "splash"):
        cand += ["gallon", "gal"]
        if ("postmix" in name) or ("cordial" in name) or (size_label in {"ltr", "liter", "litre", "l"}) or (manual_label in {"ltr", "liter", "litre", "l"}):
            cand += ["litre", "ltr", "liter"]

    if not cand and ("soft" in division or "mixer" in division):
        cand += ["bottle", "can", "litre", "ltr"]

    if size_label in {"ltr", "liter", "litre", "l"} and not any(x in {"litre", "ltr", "liter"} for x in cand):
        cand += ["litre", "ltr", "liter"]

    for c in cand:
        c_norm = norm(c)
        for i, tu in enumerate(tu_names_norm):
            if c_norm in tu:
                return tu_names[i], ""
        if size_token_ml:
            for i, tu in enumerate(tu_names_norm):
                if size_token_ml in tu:
                    return tu_names[i], ""
        if size_token_cl:
            for i, tu in enumerate(tu_names_norm):
                if size_token_cl in tu:
                    return tu_names[i], ""

    reason = f"no match; base={unit_base}; size='{size_raw}'; candidates={';'.join(cand)}; available={';'.join(tu_names)}"
    return "", reason

def main():
    if not CSV_PATH.exists():
        print(f"File not found: {CSV_PATH}", file=sys.stderr)
        sys.exit(1)

    csv_rows, csv_headers = load_csv_rows(CSV_PATH)
    out_headers: List[str] = []
    for h in csv_headers:
        if h not in out_headers:
            out_headers.append(h)

    stock_items = fetch_stock_items()
    by_external: Dict[str, Dict[str, Any]] = {str(it.get("externalId") or "").strip(): it for it in stock_items}

    matched_rows: List[List[str]] = []
    unmatched_rows: List[List[str]] = []

    matched_header = ["Code", "TradeUnit"] + out_headers
    unmatched_header = ["Code", "Reason", "AvailableTradeUnits"] + out_headers

    for r in csv_rows:
        code = (r.get("Code") or r.get("Venners_Code") or r.get("code") or "").strip()
        if not code:
            continue
        item = by_external.get(code)
        if not item:
            unmatched_rows.append([code, "stock item not found", ""] + [r.get(h, "") for h in out_headers])
            continue

        chosen, reason = choose_trade_unit(item, r)
        if chosen:
            matched_rows.append([code, chosen] + [r.get(h, "") for h in out_headers])
        else:
            available = ";".join([tu.get("unitName", "") for tu in (item.get("tradeUnits") or [])])
            unmatched_rows.append([code, reason, available] + [r.get(h, "") for h in out_headers])

    with open("tu_matched.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(matched_header)
        for row in matched_rows:
            w.writerow(row)

    with open("tu_unmatched.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(unmatched_header)
        for row in unmatched_rows:
            w.writerow(row)

    print(f"tu_matched.csv: {len(matched_rows)} rows")
    print(f"tu_unmatched.csv: {len(unmatched_rows)} rows")

if __name__ == "__main__":
    main()
