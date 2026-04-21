#!/usr/bin/env python3

import csv
import json
import math
import os
import time
import urllib3
from dataclasses import asdict, dataclass
from pathlib import Path

import certifi
import requests


BASE_URL = "https://www.englandgolf.org/api/clubs/ClubSearch"
PAGE_SIZE = 12
OUTPUT_CSV = "england_golf_clubs.csv"
OUTPUT_JSON = "england_golf_clubs.json"
REQUEST_TIMEOUT_SECONDS = 30
PAUSE_BETWEEN_REQUESTS_SECONDS = 0.25

VERIFY_SSL = False
CA_BUNDLE_PATH = None


@dataclass
class ClubRecord:
    club_id: int
    club_name: str
    address: str
    page_number: int
    loc_address_1: str
    loc_address_2: str
    loc_address_3: str
    loc_address_4: str
    postal_code: str


def clean(value: str | None) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


def build_address(item: dict) -> str:
    parts = [
        clean(item.get("LocAddress1")),
        clean(item.get("LocAddress2")),
        clean(item.get("LocAddress3")),
        clean(item.get("LocAddress4")),
    ]

    parts = [part for part in parts if part]

    postcode = clean(item.get("PostalCode"))
    if postcode:
        parts.append(postcode)

    return ", ".join(parts)


def get_verify_setting():
    if not VERIFY_SSL:
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        return False

    if CA_BUNDLE_PATH:
        return CA_BUNDLE_PATH

    return certifi.where()


def fetch_page(session: requests.Session, page_number: int, verify_setting) -> list[dict]:
    payload = {
        "userLatitude": None,
        "userLongitude": None,
        "amenityIds": [],
        "programmeIds": [],
        "pageNumber": page_number,
        "pageSize": PAGE_SIZE,
    }

    response = session.post(
        BASE_URL,
        json=payload,
        timeout=REQUEST_TIMEOUT_SECONDS,
        verify=verify_setting,
        headers={
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/json",
            "Origin": "https://www.englandgolf.org",
            "Referer": "https://www.englandgolf.org/find-and-play",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "Mozilla/5.0",
        },
    )

    response.raise_for_status()

    data = response.json()
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected response shape for page {page_number}: {type(data).__name__}")

    return data


def map_records(items: list[dict], page_number: int) -> list[ClubRecord]:
    records: list[ClubRecord] = []

    for item in items:
        records.append(
            ClubRecord(
                club_id=int(item["ClubId"]),
                club_name=clean(item.get("ClubName")),
                address=build_address(item),
                page_number=page_number,
                loc_address_1=clean(item.get("LocAddress1")),
                loc_address_2=clean(item.get("LocAddress2")),
                loc_address_3=clean(item.get("LocAddress3")),
                loc_address_4=clean(item.get("LocAddress4")),
                postal_code=clean(item.get("PostalCode")),
            )
        )

    return records


def dedupe(records: list[ClubRecord]) -> list[ClubRecord]:
    seen: set[int] = set()
    result: list[ClubRecord] = []

    for record in records:
        if record.club_id in seen:
            continue
        seen.add(record.club_id)
        result.append(record)

    return result


def write_csv(records: list[ClubRecord], file_path: str) -> None:
    with open(file_path, "w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "club_id",
                "club_name",
                "address",
                "page_number",
                "loc_address_1",
                "loc_address_2",
                "loc_address_3",
                "loc_address_4",
                "postal_code",
            ],
        )
        writer.writeheader()

        for record in records:
            writer.writerow(asdict(record))


def write_json(records: list[ClubRecord], file_path: str) -> None:
    with open(file_path, "w", encoding="utf-8") as file:
        json.dump([asdict(record) for record in records], file, ensure_ascii=False, indent=2)


def main() -> None:
    verify_setting = get_verify_setting()

    if verify_setting is False:
        print("WARNING: SSL certificate verification is disabled for this run.")
    else:
        print(f"Using CA bundle: {verify_setting}")

    all_records: list[ClubRecord] = []

    with requests.Session() as session:
        first_page_items = fetch_page(session, 1, verify_setting)
        if not first_page_items:
            raise RuntimeError("Page 1 returned no results.")

        total_count = int(first_page_items[0].get("TotalCount") or len(first_page_items))
        total_pages = max(1, math.ceil(total_count / PAGE_SIZE))

        print(f"Total clubs reported: {total_count}")
        print(f"Total pages: {total_pages}")

        first_page_records = map_records(first_page_items, 1)
        print(f"Page 1: {len(first_page_records)} records")
        all_records.extend(first_page_records)

        for page_number in range(2, total_pages + 1):
            items = fetch_page(session, page_number, verify_setting)
            if not items:
                print(f"Page {page_number}: no records returned, stopping.")
                break

            page_records = map_records(items, page_number)
            print(f"Page {page_number}: {len(page_records)} records")
            all_records.extend(page_records)

            time.sleep(PAUSE_BETWEEN_REQUESTS_SECONDS)

    unique_records = dedupe(all_records)

    write_csv(unique_records, OUTPUT_CSV)
    write_json(unique_records, OUTPUT_JSON)

    print(f"Wrote {len(unique_records)} unique clubs to {Path(OUTPUT_CSV).resolve()}")
    print(f"Wrote {len(unique_records)} unique clubs to {Path(OUTPUT_JSON).resolve()}")


if __name__ == "__main__":
    main()