#!/usr/bin/env python3
import csv
import json
import sys
import time
from pathlib import Path

import requests

CSV_PATH = Path("venners_report_enriched.csv")
API_BASE = "https://api-botgcapps-prd.azurewebsites.net/api/stock/stockItems"
API_KEY = "Hawk3rHunt3r$"

HEADERS = {
    "Content-Type": "application/json",
    "X-API-KEY": API_KEY,
}

def normalise_header(name: str) -> str:
    return name.strip().lower().replace(" ", "_")

def load_rows(csv_path: Path):
    if not csv_path.exists():
        print(f"File not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)

        def get(row, key_candidates):
            for k in row.keys():
                if normalise_header(k) in key_candidates:
                    return row[k]
            return None

        for row in reader:
            stock_id_raw = get(row, {"stock_id", "stockid", "stock_id_", "stock__id", "stockid_"})
            suggested_name_raw = get(row, {"suggested_name", "suggestedname", "suggested_name_"})

            yield {
                "stock_id": (stock_id_raw or "").strip(),
                "suggested_name": (suggested_name_raw or "").strip(),
            }

def main():
    session = requests.Session()
    rows = list(load_rows(CSV_PATH))

    if not rows:
        print("No rows found in CSV.")
        return

    for idx, row in enumerate(rows, start=1):
        stock_id_str = row["stock_id"]
        suggested_name = row["suggested_name"]

        if not stock_id_str or not suggested_name:
            print(f"[SKIP] Row {idx}: missing stock_id or suggested_name.")
            continue

        try:
            stock_id = int(stock_id_str)
        except ValueError:
            print(f"[SKIP] Row {idx}: stock_id '{stock_id_str}' is not an integer.")
            continue

        url = f"{API_BASE}/{stock_id}"
        payload = {
            "stockId": stock_id,
            "name": suggested_name,
        }

        print(f"\nAbout to update Stock ID {stock_id} → \"{suggested_name}\"")

        try:
            resp = session.put(url, headers=HEADERS, json=payload, timeout=30)
        except requests.RequestException as ex:
            print(f"[ERROR] Request failed for Stock ID {stock_id}: {ex}")
            # Wait 60 seconds before proceeding to the next attempt/request
            print("Waiting 1 seconds before the next request...")
            time.sleep(1)
            continue

        ok = 200 <= resp.status_code < 300
        try:
            body = resp.json()
        except ValueError:
            body = resp.text

        status = "SUCCESS" if ok else "FAIL"
        print(f"[{status}] {resp.status_code} {resp.reason} — Response: {body}")

        print("Waiting 1 seconds before the next request...")
        time.sleep(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nAborted by user.")
