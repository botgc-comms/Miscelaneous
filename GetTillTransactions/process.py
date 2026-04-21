from __future__ import annotations

from bs4 import BeautifulSoup
from pathlib import Path
from datetime import datetime, date, time, timedelta
import pandas as pd
import re
import json


OUTPUT_DIR = Path("./output");
CSV_PATH = OUTPUT_DIR / "transactions.csv";
YEAR_FALLBACK = 2023;


MONTH_MAP = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
};


def parse_money(s: str | None) -> float | None:
    if s is None:
        return None;
    s = s.strip();
    if not s:
        return None;
    s = s.replace("£", "").replace(",", "").strip();
    try:
        return float(s);
    except ValueError:
        m = re.search(r"[-+]?\d+(?:\.\d+)?", s);
        return float(m.group(0)) if m else None;


def parse_day_label(day_label: str, year: int) -> date | None:
    day_label = " ".join(day_label.split());
    m = re.match(
        r"^(?P<dow>[A-Za-z]{3})\s+(?P<day>\d+)(?:st|nd|rd|th)\s+(?P<month>[A-Za-z]+)$",
        day_label,
    );
    if not m:
        return None;
    d = int(m.group("day"));
    mon = MONTH_MAP.get(m.group("month"));
    if not mon:
        return None;
    return date(year, mon, d);


def half_hour_bucket(hhmm: str) -> str | None:
    hhmm = hhmm.strip();
    if not hhmm:
        return None;
    m = re.match(r"^(?P<h>\d{1,2}):(?P<m>\d{2})$", hhmm);
    if not m:
        return None;
    hh = int(m.group("h"));
    mm = int(m.group("m"));
    start_min = (mm // 30) * 30;
    dt_start = datetime(2000, 1, 1, hh, start_min);
    dt_end = dt_start + timedelta(minutes=30);
    return f"{dt_start.strftime('%H:%M')}-{dt_end.strftime('%H:%M')}";


def infer_year_from_filename(path: Path) -> int:
    m = re.search(r"(19|20)\d{2}", path.stem);
    if m:
        return int(m.group(0));
    return YEAR_FALLBACK;


def parse_html_file(path: Path) -> list[dict]:
    html = path.read_text(encoding="utf-8", errors="ignore");
    soup = BeautifulSoup(html, "html.parser");

    year = infer_year_from_filename(path);

    rows: list[dict] = [];

    for fr in soup.select("tr.foldHere"):
        tds = fr.find_all("td");
        if len(tds) < 11:
            continue;

        day_label = tds[0].get_text(strip=True);
        time_text = tds[1].get_text(strip=True);
        txn_type = tds[2].get_text(strip=True);

        member_name = " ".join(tds[4].get_text(" ", strip=True).split());

        d = parse_day_label(day_label, year);
        if d is None:
            continue;

        dow_full = d.strftime("%A");
        period = half_hour_bucket(time_text);

        data_ajax = fr.get("data-ajax-variables");
        txn_id = None;
        if data_ajax:
            try:
                data = json.loads(data_ajax);
                txn_id = data.get("data-ajax-data-inlinewithform-transaction_id");
            except Exception:
                txn_id = None;

        unfolded = fr.find_next_sibling("tr");
        if unfolded is None or "ig-unfolded" not in (unfolded.get("class") or []):
            continue;

        till = None;
        meta_rows = unfolded.select("table.table.table-striped tr");
        if len(meta_rows) >= 2:
            meta_tds = meta_rows[1].find_all("td");
            if len(meta_tds) >= 2:
                till = meta_tds[1].get_text(" ", strip=True);

        item_header = None;
        for r in meta_rows:
            ths = [th.get_text(strip=True) for th in r.find_all("th")];
            if ths[:1] == ["Description"]:
                item_header = r;
                break;

        if item_header is None:
            continue;

        item_row = item_header.find_next_sibling("tr");
        while item_row is not None:
            if item_row.find("th"):
                item_row = item_row.find_next_sibling("tr");
                continue;

            item_tds = item_row.find_all("td");
            if len(item_tds) < 7:
                break;

            desc = item_tds[0].get_text(" ", strip=True);
            if not desc:
                item_row = item_row.find_next_sibling("tr");
                continue;

            price = parse_money(item_tds[1].get_text());
            discount = parse_money(item_tds[2].get_text());
            subtotal = parse_money(item_tds[3].get_text());
            vat = parse_money(item_tds[4].get_text());
            total = parse_money(item_tds[6].get_text());

            rows.append(
                {
                    "SourceFile": path.name,
                    "TransactionId": txn_id,
                    "Date": d.strftime("%Y-%m-%d"),
                    "DayOfWeek": dow_full,
                    "Time": time_text,
                    "TimePeriod": period,
                    "MemberName": member_name if member_name else None,
                    "TransactionType": txn_type,
                    "Till": till,
                    "Item": desc,
                    "Price": price,
                    "Discount": discount,
                    "Subtotal": subtotal,
                    "VAT": vat,
                    "Total": total,
                }
            );

            item_row = item_row.find_next_sibling("tr");

    return rows;


def main() -> None:
    if not OUTPUT_DIR.exists():
        raise SystemExit(f"Folder not found: {OUTPUT_DIR}");

    html_files = sorted([p for p in OUTPUT_DIR.glob("*.html") if p.is_file()]);
    if not html_files:
        raise SystemExit(f"No .html files found in: {OUTPUT_DIR}");

    all_rows: list[dict] = [];
    for f in html_files:
        all_rows.extend(parse_html_file(f));

    df = pd.DataFrame(all_rows);

    cols = [
        "SourceFile",
        "TransactionId",
        "Date",
        "DayOfWeek",
        "Time",
        "TimePeriod",
        "MemberName",
        "TransactionType",
        "Till",
        "Item",
        "Price",
        "Discount",
        "Subtotal",
        "VAT",
        "Total",
    ];
    for c in cols:
        if c not in df.columns:
            df[c] = None;

    df = df[cols];

    df.to_csv(CSV_PATH, index=False);
    print(f"Wrote {len(df)} rows to {CSV_PATH}");


if __name__ == "__main__":
    main();