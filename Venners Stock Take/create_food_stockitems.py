#!/usr/bin/env python3
import csv
import json
import math
import re
import sys
import time
from pathlib import Path
from typing import Dict, Any, Tuple, List, Optional, Union

import requests

# --------------------- Config ---------------------
CSV_MAIN = Path("venners_food_clean.csv")
CSV_PRODUCTS = Path("products.csv")
CSV_OVERRIDES = Path("food_overrides.csv")
OUT_JSONL = Path("food_stockitem_payloads.jsonl")
OUT_REVIEW = Path("food_needs_review.csv")
OUT_RETRY_JSONL = Path("food_stockitem_retry.jsonl")

API_BASE = "https://api-botgcapps-prd.azurewebsites.net/api/stock/stockItems"
API_KEY = "Hawk3rHunt3r$"

POST_TO_API = True

MIN_ALERT_DEFAULT = 0
MAX_ALERT_DEFAULT = 0

HEADERS = {
    "Content-Type": "application/json",
    "X-API-KEY": API_KEY,
}

ML_IN_L = 1000.0
G_IN_KG = 1000.0

# --------------------- Helpers: text ---------------------
def norm_space(s: str) -> str:
    return " ".join((s or "").strip().split())

def normalise_header(name: str) -> str:
    return name.strip().lower().replace(" ", "_")

def expand_abbreviations(raw: str) -> str:
    s = raw
    repls = [
        (r"\bptns?\b", "Portions"),
        (r"\bch\b", "Cheese"),
        (r"\bc/cake\b", "Cheese Cake"),
        (r"\bg/f\b", "Gluten Free"),
        (r"\bc/nish\b", "Cornish"),
        (r"\bfz\s+", "Frozen "),
        (r"\bi/c\s+", "Ice Cream "),
        (r"\bpkt\b", "Packet"),
        (r"\bpk\b", "Pack"),
        (r"\bkgs\b", "kg"),
        (r"\bgms\b", "g"),
        (r"\beac\b", "Each"),
        (r"\bead\b", "Each"),
        (r"\bltr\b", "L"),
    ]
    for pat, rep in repls:
        s = re.sub(pat, rep, s, flags=re.IGNORECASE)
    return s

def titleise_food_name(name: str) -> str:
    base = norm_space(expand_abbreviations(name))
    titled = re.sub(r"\b([a-z])", lambda m: m.group(1).upper(), base.lower())
    fixes = {
        "Bbq": "BBQ",
        "Kg": "kg", "G ": "g ", "Ml": "ml", "L ": "L ", "X ": "x ",
        "Cheese": "Cheese", "Portions": "Portions",
        "Gluten Free": "Gluten Free", "Cornish": "Cornish",
        "Frozen ": "Frozen ", "Ice Cream ": "Ice Cream ",
        "Cheese Cake": "Cheese Cake",
        "Tray": "Tray", "Bag": "Bag", "Box": "Box", "Packet": "Packet",
        "Each": "Each", "Tin": "Tin", "Jar": "Jar", "Bottle": "Bottle",
    }
    for k, v in fixes.items():
        titled = titled.replace(k, v)
    return titled

def to_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    s = str(v).strip()
    if not s:
        return default
    try:
        return float(s)
    except ValueError:
        return default

# --------------------- Parsing amounts ---------------------
_amount_patterns = [
    (r"(\d+(?:\.\d+)?)\s*KG\b", "g", G_IN_KG),
    (r"(\d+(?:\.\d+)?)\s*G\b", "g", 1.0),
    (r"(\d+(?:\.\d+)?)\s*L(?:ITRE|TR)?\b", "ml", ML_IN_L),
    (r"(\d+(?:\.\d+)?)\s*ML\b", "ml", 1.0),
    (r"(\d+(?:\.\d+)?)\s*OZ\b", "g", 28.3495),
]

_container_hints = ["BAG", "BOX", "PACKET", "PACK", "TRAY", "TIN", "JAR", "BOTTLE", "TUB", "BOT", "PKT", "EAC"]

def extract_amounts(text: str) -> List[Tuple[float, str]]:
    res: List[Tuple[float, str]] = []
    t = (text or "").upper()
    for pat, unit, factor in _amount_patterns:
        for m in re.finditer(pat, t, flags=re.IGNORECASE):
            val = float(m.group(1)) * factor
            res.append((val, unit))
    return res

def looks_liquid(text: str) -> bool:
    t = (text or "").upper()
    return any(k in t for k in [" SAUCE", " OIL", " DRESS", " SYRUP", " MILK", " VINEGAR", "GLAZE", "CREAM ", "MAYO", "YOGURT", "SOYA"]) \
           or any(k in t for k in [" L", " ML", " BOTTLE", " BOT"])

def choose_base_unit(name: str, size: str, amounts: List[Tuple[float, str]]) -> str:
    if any(u == "ml" for _, u in amounts):
        return "ML"
    if any(u == "g" for _, u in amounts):
        return "GRAM"
    if looks_liquid(name) or looks_liquid(size):
        return "ML"
    return "GRAM"

def pick_best_amount(name: str, size: str, base_unit: str, amounts: List[Tuple[float, str]]) -> Optional[float]:
    if not amounts:
        if size.strip().upper() in ("KG", "KGS"):
            return G_IN_KG if base_unit == "GRAM" else None
        if " LTR" in size.upper() or size.strip().upper() == "L":
            return ML_IN_L if base_unit == "ML" else None
        return None
    candidates = [a for a in amounts if a[1] == ("ml" if base_unit == "ML" else "g")]
    if candidates:
        return max(v for v, _ in candidates)
    return None

def find_container_label(size: str, name: str) -> str:
    t = (size + " " + name).upper()
    for hint in _container_hints:
        if re.search(rf"\b{re.escape(hint)}\b", t):
            label = hint
            if label == "BOT":
                label = "BOTTLE"
            if label == "PKT":
                label = "PACKET"
            if label == "EAC":
                label = "EACH"
            return label.capitalize()
    return "Pack"

def precision_for_tu(unit_name: str) -> float:
    u = unit_name.upper()
    if u.startswith("BOTTLE") or u.startswith("CASE OF"):
        return 0.1
    if u.startswith("KILOGRAM") or u.startswith("LITRE"):
        return 0.01
    if u.startswith("BAG ") or u.startswith("TRAY "):
        return 0.01
    if any(u.startswith(prefix) for prefix in ["TIN ", "JAR ", "PACK "]):
        return 0.1
    return 0.1

# --------------------- IO ---------------------
def load_rows_csv(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        rdr = csv.DictReader(f)
        header = {h: normalise_header(h) for h in (rdr.fieldnames or [])}
        out: List[Dict[str, Any]] = []
        for raw in rdr:
            row: Dict[str, Any] = {}
            for k, v in raw.items():
                row[header.get(k, k)] = v
            out.append(row)
        return out

def load_rows_or_die(path: Path) -> List[Dict[str, Any]]:
    rows = load_rows_csv(path)
    if not rows and not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(1)
    return rows

def load_overrides(path: Path) -> Dict[str, Dict[str, Any]]:
    if not path.exists():
        return {}
    rows = load_rows_csv(path)
    by_code: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        code = str(r.get("code") or "").strip()
        if not code:
            continue
        ou = str(r.get("overridebaseunit") or "").strip().upper()
        tu = str(r.get("tradeunitname") or "").strip()
        conv = to_float(r.get("conversionratio"), 0.0)
        prec = to_float(r.get("precisionofunits"), 0.1)
        if not ou or not tu or conv <= 0:
            continue
        by_code[code] = {
            "baseUnit": ou,
            "unitName": tu,
            "conversion": conv,
            "precision": prec
        }
    return by_code

# --------------------- Core build ---------------------
def build_payload(row: Dict[str, Any], products: List[Dict[str, Any]], overrides: Dict[str, Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    code = str(row.get("code") or row.get("venners_code") or "").strip()
    raw_name = str(row.get("name") or "").strip()
    size = str(row.get("size") or "").strip()
    division = str(row.get("division") or "FOOD").strip().upper()
    cost_price = to_float(row.get("cost_price", 0.0))

    if not code or not raw_name:
        return None, None

    name_clean = f"{titleise_food_name(raw_name)} [{code}]"

    ov = overrides.get(code)
    if ov:
        base_unit = ov["baseUnit"]
        tu_name = ov["unitName"]
        conversion = float(ov["conversion"])
        precision = float(ov["precision"])
        payload = {
            "name": name_clean,
            "baseUnit": base_unit,
            "division": division,
            "minAlert": MIN_ALERT_DEFAULT,
            "maxAlert": MAX_ALERT_DEFAULT,
            "tradeUnits": [
                {
                    "unitName": tu_name,
                    "cost": round(cost_price, 2),
                    "conversionRatio": conversion,
                    "precisionOfUnits": precision
                }
            ]
        }
        return payload, None

    amts_main = extract_amounts(size) + extract_amounts(raw_name)

    amts_prod: List[Tuple[float, str]] = []
    if not amts_main and products:
        for p in products:
            if str(p.get("code", "")).strip() == code:
                amts_prod += extract_amounts(p.get("name", "")) \
                            + extract_amounts(p.get("size", "")) \
                            + extract_amounts(p.get("description", ""))
        if not amts_prod:
            tokens = [t for t in re.split(r"[^a-zA-Z0-9]+", raw_name.lower()) if t]
            for p in products:
                s = (str(p.get("name", "")) + " " + str(p.get("description", ""))).lower()
                if tokens and sum(1 for t in tokens if t and t in s) >= max(2, len(tokens)//2):
                    amts_prod += extract_amounts(p.get("name", "")) \
                               + extract_amounts(p.get("size", "")) \
                               + extract_amounts(p.get("description", ""))

    amounts = amts_main + amts_prod
    base_unit = choose_base_unit(raw_name, size, amounts)
    best_amt = pick_best_amount(raw_name, size, base_unit, amounts)

    if best_amt is None and size.strip().upper() in ("KG", "KGS"):
        best_amt = G_IN_KG
        container = "Kilogram"
    else:
        container = find_container_label(size, raw_name)

    if best_amt is None:
        review = {
            "Code": code,
            "Name": raw_name,
            "Size": size,
            "Division": division,
            "Reason": "No clear content amount in g/ml (consider adding override or allow EACH).",
        }
        return None, review

    if base_unit == "ML":
        if math.isclose(best_amt, ML_IN_L, abs_tol=0.01):
            tu_name = f"{container} 1L"
        elif best_amt > ML_IN_L and abs(best_amt/ML_IN_L - round(best_amt/ML_IN_L, 2)) < 1e-6:
            tu_name = f"{container} {round(best_amt/ML_IN_L, 2)}L"
        else:
            tu_name = f"{container} {int(round(best_amt))}ml"
        conversion = float(best_amt)
    else:
        if math.isclose(best_amt, G_IN_KG, abs_tol=0.01):
            tu_name = f"{container} 1kg" if container != "Kilogram" else "Kilogram"
        elif best_amt > G_IN_KG and abs(best_amt/G_IN_KG - round(best_amt/G_IN_KG, 2)) < 1e-6:
            tu_name = f"{container} {round(best_amt/G_IN_KG, 2)}kg"
        else:
            tu_name = f"{container} {int(round(best_amt))}g"
        conversion = float(best_amt)

    precision = precision_for_tu(tu_name)

    payload = {
        "name": name_clean,
        "baseUnit": base_unit,
        "division": division,
        "minAlert": MIN_ALERT_DEFAULT,
        "maxAlert": MAX_ALERT_DEFAULT,
        "tradeUnits": [
            {
                "unitName": tu_name,
                "cost": round(cost_price, 2),
                "conversionRatio": conversion,
                "precisionOfUnits": precision
            }
        ]
    }
    return payload, None

# --------------------- API ---------------------
def post_item(payload: Dict[str, Any]) -> Tuple[bool, int, Union[str, Dict[str, Any]]]:
    try:
        resp = requests.post(API_BASE, headers=HEADERS, json=payload, timeout=60)
        ok = 200 <= resp.status_code < 300
        try:
            body = resp.json()
        except ValueError:
            body = resp.text
        return ok, resp.status_code, body
    except requests.RequestException as ex:
        return False, 0, str(ex)

def post_with_confirm(payload: Dict[str, Any], max_retries: int = 3) -> Tuple[bool, int, Union[str, Dict[str, Any]]]:
    attempt = 0
    while True:
        attempt += 1
        ok, status, body = post_item(payload)
        print(body)
        if ok:
            return True, status, body
        if status in (0, 429, 500, 502, 503, 504) and attempt < max_retries:
            sleep_for = min(2 * attempt, 5)
            print(f"[RETRY] status={status} attempt={attempt} sleeping {sleep_for}s — {payload.get('name')}")
            time.sleep(sleep_for)
            continue
        return False, status, body

def extract_created_id(body: Union[str, Dict[str, Any]]) -> int:
    if isinstance(body, dict):
        for key in ("id", "stockId", "stock_id", "createdId", "created_id"):
            v = body.get(key)
            if isinstance(v, int) and v > 0:
                return v
            if isinstance(v, str):
                try:
                    n = int(v)
                    if n > 0:
                        return n
                except ValueError:
                    pass
        j = json.dumps(body)
        m = re.search(r'"(?:id|stockId|createdId)"\s*:\s*(\d+)', j, flags=re.IGNORECASE)
        if m:
            return int(m.group(1))
        return 0
    s = str(body).strip()
    if re.fullmatch(r"\d+", s):
        n = int(s)
        return n if n > 0 else 0
    if s.startswith("{") or s.startswith("["):
        try:
            obj = json.loads(s)
            return extract_created_id(obj)
        except Exception:
            return 0
    return 0

# --------------------- Main ---------------------
def main():
    rows = load_rows_or_die(CSV_MAIN)
    products = load_rows_csv(CSV_PRODUCTS)
    overrides = load_overrides(CSV_OVERRIDES)

    if OUT_JSONL.exists():
        OUT_JSONL.unlink()
    if OUT_REVIEW.exists():
        OUT_REVIEW.unlink()
    if OUT_RETRY_JSONL.exists():
        OUT_RETRY_JSONL.unlink()

    total = 0
    made = 0
    queued_for_retry = 0
    reviews: List[Dict[str, Any]] = []

    with OUT_JSONL.open("a", encoding="utf-8") as jout, OUT_RETRY_JSONL.open("a", encoding="utf-8") as jretry:
        for r in rows:
            code = str(r.get("code") or r.get("venners_code") or "").strip()
            raw_name = str(r.get("name") or "").strip()
            if not code or not raw_name:
                continue

            payload, review = build_payload(r, products, overrides)
            total += 1

            if review:
                reviews.append(review)
                continue

            jout.write(json.dumps(payload, ensure_ascii=False) + "\n")
            jout.flush()

            if POST_TO_API:
                print(f"[POST] → {payload['name']} | TU={payload['tradeUnits'][0]['unitName']} | cost={payload['tradeUnits'][0]['cost']} | conv={payload['tradeUnits'][0]['conversionRatio']} | base={payload['baseUnit']} | division={payload['division']}")
                ok, status, body = post_with_confirm(payload, max_retries=3)
                
                created_id = extract_created_id(body)
                success = ok and (created_id > 0)

                body_str = body if isinstance(body, str) else json.dumps(body)
                print(f"[{'OK' if success else 'FAIL'}] {status} — {payload['name']} — {body_str}")

                if not success:
                    jretry.write(json.dumps(payload, ensure_ascii=False) + "\n")
                    jretry.flush()
                    queued_for_retry += 1
                else:
                    made += 1

                time.sleep(1)

    if reviews:
        with OUT_REVIEW.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["Code","Name","Size","Division","Reason"])
            w.writeheader()
            w.writerows(reviews)

    print(f"Prepared payloads for {total} row(s).")
    if reviews:
        print(f"{len(reviews)} item(s) need review → {OUT_REVIEW}")
    print(f"JSONL written → {OUT_JSONL}")
    if POST_TO_API:
        print(f"Created {made} item(s) via API.")
        print(f"Queued {queued_for_retry} item(s) for replay → {OUT_RETRY_JSONL}")

if __name__ == "__main__":
    main()
