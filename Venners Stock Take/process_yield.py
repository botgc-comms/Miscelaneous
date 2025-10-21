#!/usr/bin/env python3
# process_venners_report.py
#
# Inputs (same folder):
#   - venners_report_clean.csv   (must contain a 'Code' column)
#   - final.csv                  (must contain 'Venners_Code', 'Stock_Id', 'Suggested_Name', 'Venners_Size')
#
# Outputs:
#   - venners_report_enriched.csv        (all columns from venners_report_clean.csv + Stock_Id + Suggested_Name + manual_size)
#   - venners_report_nonmatches.csv      (rows from venners_report_clean.csv whose Code was not found in final.csv)

import csv
from pathlib import Path

HERE = Path(__file__).resolve().parent
VRC_PATH = HERE / "venners_report_clean.csv"
FINAL_PATH = HERE / "final.csv"
OUT_ENRICHED = HERE / "venners_report_enriched.csv"
OUT_NONMATCH = HERE / "venners_report_nonmatches.csv"


def canon(s: str) -> str:
    return (s or "").strip().lower()


def safe(row: dict, key: str) -> str:
    return "" if row is None else (row.get(key, "") or "")


def find_header(headers: list[str], *candidates: str) -> str:
    for cand in candidates:
        for h in headers:
            if canon(h) == canon(cand):
                return h
    raise RuntimeError(f"Required column not found. Looked for: {', '.join(candidates)} in {headers}")


def read_indexed(path: Path, key_name: str) -> tuple[list[str], list[dict], dict[str, dict], str]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        key_actual = find_header(headers, key_name)
        rows = list(reader)
        index = {}
        for r in rows:
            k = (r.get(key_actual) or "").strip()
            if k != "":
                index[k] = r
        return headers, rows, index, key_actual


def main() -> None:
    # Load venners_report_clean.csv
    vrc_headers, vrc_rows, vrc_by_code, vrc_code_h = read_indexed(VRC_PATH, "Code")

    # Load final.csv
    final_headers, final_rows, final_by_code, final_code_h = read_indexed(FINAL_PATH, "Venners_Code")
    f_stock_id_h = find_header(final_headers, "Stock_Id")
    f_suggested_h = find_header(final_headers, "Suggested_Name")
    f_size_h = find_header(final_headers, "Venners_Size")

    # Prepare output headers: all VRC columns + added fields
    out_headers = list(vrc_headers) + ["Stock_Id", "Suggested_Name", "manual_size"]

    unmatched_rows = []

    with OUT_ENRICHED.open("w", encoding="utf-8", newline="") as f_ok, \
         OUT_NONMATCH.open("w", encoding="utf-8", newline="") as f_nm:

        ok_writer = csv.DictWriter(f_ok, fieldnames=out_headers)
        nm_writer = csv.DictWriter(f_nm, fieldnames=vrc_headers)  # write original row shape for nonmatches

        ok_writer.writeheader()
        nm_writer.writeheader()

        for row in vrc_rows:
            code = (row.get(vrc_code_h) or "").strip()
            f_row = final_by_code.get(code)

            if not f_row:
                nm_writer.writerow(row)
                continue

            enriched = dict(row)
            enriched["Stock_Id"] = safe(f_row, f_stock_id_h).strip()
            enriched["Suggested_Name"] = safe(f_row, f_suggested_h).strip()
            enriched["manual_size"] = safe(f_row, f_size_h).strip()

            ok_writer.writerow(enriched)

    print(f"Wrote: {OUT_ENRICHED.name}");
    print(f"Wrote: {OUT_NONMATCH.name}");


if __name__ == "__main__":
    main();
