#!/usr/bin/env python3
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

# ---------------- Config ----------------
CSV_FOOD = Path("venners_food_clean.csv")
JSONL_TU = Path("food_stockitem_payloads.jsonl")

API_BASE = "https://api-botgcapps-prd.azurewebsites.net"
API_STOCK_ITEMS = f"{API_BASE}/api/stock/stockItems"
API_KEY = "Hawk3rHunt3r$"

ORDER_REFERENCE = "Venners MT8220251010"
SUPPLIER_ID = 1
SELECTED_STOCK_ROOM_ID = 1

HEADERS = {
    "Content-Type": "application/json",
    "X-API-KEY": API_KEY,
}

OUT_JSON = Path("purchase_order_payload.json")
OUT_UNMATCHED = Path("po_unmatched_stockitems.csv")
OUT_AUDIT = Path("po_item_audit.csv")

# -------------- Helpers -----------------
def norm_header(h: str) -> str:
    return h.strip().lower().replace(" ", "_")

def load_csv_rows(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(1)
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        rdr = csv.DictReader(f)
        hdr = {h: norm_header(h) for h in (rdr.fieldnames or [])}
        return [{hdr.get(k, k): (v or "").strip() for k, v in raw.items()} for raw in rdr]

def load_jsonl_map_unit_name(path: Path) -> Dict[str, str]:
    """Map code → preferred trade unit name from your JSONL."""
    pref: Dict[str, str] = {}
    if not path.exists():
        return pref
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            name = str(obj.get("name", ""))
            m = re.search(r"\[(\d{3,})\]\s*$", name)
            if not m:
                continue
            code = m.group(1)
            tus = obj.get("tradeUnits") or []
            if tus:
                unit_name = str(tus[0].get("unitName") or "").strip()
                if unit_name:
                    pref[code] = unit_name
    return pref

def to_float(x: Any, default: float = 0.0) -> float:
    try:
        s = str(x).strip()
        return float(s) if s else default
    except Exception:
        return default

def f2(x: float) -> float:
    return float(f"{x:.2f}")

def f4(x: float) -> float:
    return float(f"{x:.4f}")

def fetch_stockitems() -> Dict[str, Dict[str, Any]]:
    """Return dict of externalId → stock item."""
    r = requests.get(API_STOCK_ITEMS, headers=HEADERS, timeout=60)
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, list):
        raise RuntimeError("Unexpected StockItems response format")
    mapping = {}
    for s in data:
        ext = str(s.get("externalId") or "").strip()
        if ext:
            mapping[ext] = s
    return mapping

# -------------- Core -----------------
def main():
    rows = load_csv_rows(CSV_FOOD)
    pref_tu_by_code = load_jsonl_map_unit_name(JSONL_TU)
    by_external = fetch_stockitems()

    items: List[Dict[str, Any]] = []
    unmatched_rows: List[Dict[str, Any]] = []
    audit_rows: List[Dict[str, Any]] = []

    for r in rows:
        code = (r.get("code") or r.get("venners_code") or "").strip()
        if not code:
            continue

        holding = to_float(r.get("holding"), 0.0)
        unit_cost_csv = to_float(r.get("cost_price"), 0.0)
        line_value_csv = to_float(r.get("value"), 0.0)
        if holding <= 0:
            continue

        si = by_external.get(code)
        if not si:
            unmatched_rows.append({
                "Code": code,
                "Name": r.get("name", ""),
                "Size": r.get("size", ""),
                "Division": r.get("division", ""),
                "Reason": "No stockItem found for externalId",
            })
            continue

        stock_item_id = int(si["id"])
        preferred_name = pref_tu_by_code.get(code, "")
        server_tus = si.get("tradeUnits") or []

        chosen_tu: Optional[Dict[str, Any]] = None
        if preferred_name:
            for tu in server_tus:
                if str(tu.get("unitName", "")).strip().lower() == preferred_name.lower():
                    chosen_tu = tu
                    break
        if not chosen_tu and server_tus:
            chosen_tu = server_tus[0]

        if not chosen_tu:
            unmatched_rows.append({
                "Code": code,
                "Name": r.get("name", ""),
                "Size": r.get("size", ""),
                "Division": r.get("division", ""),
                "Reason": "Stock item found but has no trade units",
            })
            continue

        tu_id = int(chosen_tu.get("unitId", 0) or 0)
        quantity = f2(holding)
        unit_cost = f4(unit_cost_csv)
        price = f2(line_value_csv if line_value_csv > 0 else unit_cost * holding)

        items.append({
            "tillStockItemId": stock_item_id,
            "stockItemId": stock_item_id,
            "tillStockItemUnitId": tu_id,
            "unitCost": unit_cost,
            "quantity": quantity,
            "price": price,
            "selectedStockRoomId": SELECTED_STOCK_ROOM_ID,
        })

        audit_rows.append({
            "Code": code,
            "StockItemId": stock_item_id,
            "CSV_Name": r.get("name", ""),
            "CSV_Size": r.get("size", ""),
            "PreferredTU": preferred_name,
            "ChosenTU": str(chosen_tu.get("unitName", "")),
            "ChosenTU_Id": tu_id,
            "Quantity": quantity,
            "UnitCost": unit_cost,
            "LinePrice": price,
        })

    payload = {
        "orderReference": ORDER_REFERENCE,
        "supplier": SUPPLIER_ID,
        "items": items,
    }

    OUT_JSON.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    if unmatched_rows:
        with OUT_UNMATCHED.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["Code", "Name", "Size", "Division", "Reason"])
            w.writeheader()
            w.writerows(unmatched_rows)

    if audit_rows:
        with OUT_AUDIT.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(
                f,
                fieldnames=["Code","StockItemId","CSV_Name","CSV_Size","PreferredTU","ChosenTU","ChosenTU_Id","Quantity","UnitCost","LinePrice"]
            )
            w.writeheader()
            w.writerows(audit_rows)

    print(f"Wrote {OUT_JSON} with {len(items)} items.")
    if unmatched_rows:
        print(f"{len(unmatched_rows)} code(s) did not resolve → {OUT_UNMATCHED}")
    if audit_rows:
        print(f"Item audit → {OUT_AUDIT}")

if __name__ == "__main__":
    main()
