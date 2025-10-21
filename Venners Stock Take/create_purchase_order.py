#!/usr/bin/env python3
import csv
import json
from pathlib import Path

import requests

CSV_PATH = Path("venners_report_enriched.csv")
TU_MATCHED_PATH = Path("tu_matched.csv")
API_BASE = "https://api-botgcapps-prd.azurewebsites.net/api/stock/stockItems"
API_KEY = "Hawk3rHunt3r$"

HEADERS = {
    "Content-Type": "application/json",
    "X-API-KEY": API_KEY,
}

ORDER_REFERENCE = "Venners MT8220251010"
SUPPLIER_ID = 1
STOCK_ROOM_ID = 1

def f2(x: float) -> float:
    return float(f"{x:.2f}")

def f4(x: float) -> float:
    return float(f"{x:.4f}")

def pick_number(row, *names, default=0.0) -> float:
    for n in names:
        v = row.get(n)
        if v is None or str(v).strip() == "":
            continue
        try:
            return float(str(v).strip())
        except ValueError:
            continue
    return float(default)

def load_csv_by_code(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        rdr = csv.DictReader(f)
        by_code = {}
        for r in rdr:
            code = (r.get("Code") or r.get("Venners_Code") or r.get("code") or "").strip()
            if code:
                by_code[code] = r
    return by_code

def load_tu_matches(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        rdr = csv.DictReader(f)
        out = []
        for r in rdr:
            code = (r.get("Code") or "").strip()
            tu = (r.get("TradeUnit") or "").strip()
            if code and tu:
                out.append((code, tu))
    return out

def fetch_stock_items():
    resp = requests.get(API_BASE, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    return resp.json()

def norm(s: str) -> str:
    return " ".join((s or "").strip().lower().split())

def tu_kind(tu_name: str) -> str:
    s = norm(tu_name)
    if "box of 12" in s or s == "dozen" or s == "12":
        return "box12"
    if "box of 10" in s or s == "10":
        return "box10"
    if "gallon" in s or s == "gal":
        return "gallon"
    if s in ("litre", "ltr", "liter"):
        return "litre"
    if s.startswith("bottle"):
        return "bottle"
    if s.startswith("can"):
        return "can"
    if "case" in s:
        return "case"
    if s == "packet":
        return "packet"
    return "other"

def quantity_in_trade_unit(csv_row: dict, tu_name: str) -> float:
    stock_units = pick_number(csv_row, "StockHoldingUnits", "stockholdingunits")
    y = pick_number(csv_row, "Yield", "yield")
    k = tu_kind(tu_name)
    if k in ("box12", "box10", "case", "gallon", "litre"):
        return stock_units
    if k in ("bottle", "can"):
        if y > 1:
            return stock_units * y
        return stock_units
    if k == "packet":
        if y in (10, 12):
            return stock_units * y
        return stock_units
    return stock_units

def fallback_unit_cost_from_csv(csv_row: dict, tu_name: str) -> float:
    unit_cost_csv = pick_number(csv_row, "UnitCost", "unitcost")
    y = pick_number(csv_row, "Yield", "yield")
    k = tu_kind(tu_name)
    if k in ("box12", "box10", "case", "gallon", "litre"):
        return unit_cost_csv
    if k in ("bottle", "can"):
        return unit_cost_csv / y if y > 1 else unit_cost_csv
    if k == "packet":
        return unit_cost_csv / y if y in (10, 12) else unit_cost_csv
    return unit_cost_csv

def resolve_unit_id(stock_item: dict, tu_name: str) -> int:
    target = norm(tu_name)
    for tu in stock_item.get("tradeUnits") or []:
        if norm(tu.get("unitName", "")) == target:
            return int(tu.get("unitId"))
    for tu in stock_item.get("tradeUnits") or []:
        if target in norm(tu.get("unitName", "")):
            return int(tu.get("unitId"))
    raise KeyError("trade unit not found")

def main():
    csv_by_code = load_csv_by_code(CSV_PATH)
    tu_matches = load_tu_matches(TU_MATCHED_PATH)
    stock_items = fetch_stock_items()
    by_external = {str(it.get("externalId") or "").strip(): it for it in stock_items}

    items = []
    for code, tu_name in tu_matches:
        row = csv_by_code.get(code)
        item = by_external.get(code)
        if not row or not item:
            continue

        stock_item_id = int(item["id"])
        tu_id = resolve_unit_id(item, tu_name)

        qty = quantity_in_trade_unit(row, tu_name)
        line_price = pick_number(row, "StockHoldingPrice", "stockholdingprice")
        if qty > 0 and line_price > 0:
            unit_cost = f4(line_price / qty)
            price = f2(line_price)
        else:
            unit_cost = f4(fallback_unit_cost_from_csv(row, tu_name))
            price = f2(unit_cost * qty)

        items.append({
            "tillStockItemId": stock_item_id,
            "stockItemId": stock_item_id,
            "tillStockItemUnitId": tu_id,
            "unitCost": unit_cost,
            "quantity": f2(qty),
            "price": price,
            "selectedStockRoomId": 1,
        })

    payload = {
        "orderReference": ORDER_REFERENCE,
        "supplier": SUPPLIER_ID,
        "items": items,
    }

    Path("purchase_order.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Lines: {len(items)}")
    print("Wrote purchase_order.json")

if __name__ == "__main__":
    main()
