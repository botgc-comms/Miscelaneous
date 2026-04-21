#!/usr/bin/env python3

import csv
import json
import math
import re
import sys
import time
from dataclasses import dataclass, asdict
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OUTPUT_CSV = "golf_clubs_gb.csv"
OUTPUT_JSON = "golf_clubs_gb.json"
REQUEST_TIMEOUT_SECONDS = 180
MAX_RETRIES = 5
BACKOFF_SECONDS = 4


@dataclass
class GolfClub:
    osm_type: str
    osm_id: int
    name: str
    lat: float
    lon: float
    leisure: Optional[str]
    golf: Optional[str]
    operator: Optional[str]
    website: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    addr_street: Optional[str]
    addr_city: Optional[str]
    addr_county: Optional[str]
    addr_postcode: Optional[str]
    is_in: Optional[str]
    source_tags: Dict[str, Any]


def build_query() -> str:
    return """
[out:json][timeout:180];
area["ISO3166-1"="GB"][admin_level=2]->.searchArea;

(
  node["leisure"="golf_course"](area.searchArea);
  way["leisure"="golf_course"](area.searchArea);
  relation["leisure"="golf_course"](area.searchArea);

  node["golf"="clubhouse"](area.searchArea);
  way["golf"="clubhouse"](area.searchArea);
  relation["golf"="clubhouse"](area.searchArea);
);

out center tags;
""".strip()


def fetch_overpass(query: str) -> Dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "text/plain; charset=utf-8",
        "User-Agent": "golf-club-list-builder/1.0",
    }

    last_error: Optional[Exception] = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.post(
                OVERPASS_URL,
                data=query.encode("utf-8"),
                headers=headers,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )

            if response.status_code == 429 or response.status_code >= 500:
                raise requests.HTTPError(
                    f"Overpass returned HTTP {response.status_code}: {response.text[:500]}"
                )

            response.raise_for_status()
            return response.json()

        except Exception as exc:
            last_error = exc
            if attempt == MAX_RETRIES:
                break

            sleep_seconds = BACKOFF_SECONDS * attempt
            print(
                f"Attempt {attempt} failed: {exc}. Retrying in {sleep_seconds} seconds...",
                file=sys.stderr,
            )
            time.sleep(sleep_seconds)

    raise RuntimeError(f"Overpass request failed after {MAX_RETRIES} attempts: {last_error}")


def get_lat_lon(element: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    if "lat" in element and "lon" in element:
        return float(element["lat"]), float(element["lon"])

    center = element.get("center")
    if center and "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])

    return None


def clean_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None

    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def extract_name(tags: Dict[str, Any]) -> Optional[str]:
    preferred_keys = [
        "name",
        "official_name",
        "short_name",
        "club",
    ]

    for key in preferred_keys:
        value = clean_text(tags.get(key))
        if value:
            return value

    return None


def extract_website(tags: Dict[str, Any]) -> Optional[str]:
    for key in ["website", "contact:website", "url"]:
        value = clean_text(tags.get(key))
        if value:
            return value
    return None


def extract_phone(tags: Dict[str, Any]) -> Optional[str]:
    for key in ["phone", "contact:phone"]:
        value = clean_text(tags.get(key))
        if value:
            return value
    return None


def extract_email(tags: Dict[str, Any]) -> Optional[str]:
    for key in ["email", "contact:email"]:
        value = clean_text(tags.get(key))
        if value:
            return value
    return None


def normalise_name(name: str) -> str:
    text = name.casefold()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\b(golf\s+club|golf|club|course)\b", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def round_coord(value: float, places: int = 4) -> float:
    factor = 10 ** places
    return math.floor((value * factor) + 0.5) / factor


def should_keep(tags: Dict[str, Any], name: Optional[str]) -> bool:
    if not name:
        return False

    text_blob = " ".join(
        clean_text(str(v)) or ""
        for v in [
            tags.get("name"),
            tags.get("official_name"),
            tags.get("short_name"),
            tags.get("description"),
        ]
    ).casefold()

    exclusions = [
        "mini golf",
        "minigolf",
        "crazy golf",
        "adventure golf",
        "pitch and putt",
        "driving range",
        "disc golf",
        "footgolf",
    ]

    for exclusion in exclusions:
        if exclusion in text_blob:
            return False

    return True


def to_club(element: Dict[str, Any]) -> Optional[GolfClub]:
    tags = element.get("tags", {})
    name = extract_name(tags)
    coords = get_lat_lon(element)

    if not coords:
        return None

    if not should_keep(tags, name):
        return None

    lat, lon = coords

    return GolfClub(
        osm_type=element["type"],
        osm_id=int(element["id"]),
        name=name,
        lat=lat,
        lon=lon,
        leisure=clean_text(tags.get("leisure")),
        golf=clean_text(tags.get("golf")),
        operator=clean_text(tags.get("operator")),
        website=extract_website(tags),
        phone=extract_phone(tags),
        email=extract_email(tags),
        addr_street=clean_text(tags.get("addr:street")),
        addr_city=clean_text(tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village")),
        addr_county=clean_text(tags.get("addr:county")),
        addr_postcode=clean_text(tags.get("addr:postcode")),
        is_in=clean_text(tags.get("is_in")),
        source_tags=tags,
    )


def dedupe(clubs: Iterable[GolfClub]) -> List[GolfClub]:
    best_by_key: Dict[Tuple[str, float, float], GolfClub] = {}

    for club in clubs:
        key = (
            normalise_name(club.name),
            round_coord(club.lat),
            round_coord(club.lon),
        )

        existing = best_by_key.get(key)
        if existing is None:
            best_by_key[key] = club
            continue

        existing_score = completeness_score(existing)
        candidate_score = completeness_score(club)

        if candidate_score > existing_score:
            best_by_key[key] = club

    result = list(best_by_key.values())
    result.sort(key=lambda x: (x.name.casefold(), x.addr_postcode or "", x.osm_type, x.osm_id))
    return result


def completeness_score(club: GolfClub) -> int:
    score = 0
    for value in [
        club.website,
        club.phone,
        club.email,
        club.addr_street,
        club.addr_city,
        club.addr_county,
        club.addr_postcode,
        club.operator,
    ]:
        if value:
            score += 1

    if club.leisure == "golf_course":
        score += 2

    if club.golf == "clubhouse":
        score += 1

    return score


def write_csv(clubs: List[GolfClub], path: str) -> None:
    fieldnames = [
        "osm_type",
        "osm_id",
        "name",
        "lat",
        "lon",
        "leisure",
        "golf",
        "operator",
        "website",
        "phone",
        "email",
        "addr_street",
        "addr_city",
        "addr_county",
        "addr_postcode",
        "is_in",
    ]

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for club in clubs:
            row = {key: getattr(club, key) for key in fieldnames}
            writer.writerow(row)


def write_json(clubs: List[GolfClub], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump([asdict(club) for club in clubs], f, ensure_ascii=False, indent=2)


def main() -> None:
    print("Building Overpass query...", file=sys.stderr)
    query = build_query()

    print("Fetching data from Overpass...", file=sys.stderr)
    payload = fetch_overpass(query)

    elements = payload.get("elements", [])
    print(f"Received {len(elements)} raw OSM elements.", file=sys.stderr)

    clubs: List[GolfClub] = []
    for element in elements:
        club = to_club(element)
        if club is not None:
            clubs.append(club)

    print(f"Kept {len(clubs)} named candidate clubs before dedupe.", file=sys.stderr)

    deduped = dedupe(clubs)
    print(f"Kept {len(deduped)} clubs after dedupe.", file=sys.stderr)

    write_csv(deduped, OUTPUT_CSV)
    write_json(deduped, OUTPUT_JSON)

    print(f"Wrote {OUTPUT_CSV}", file=sys.stderr)
    print(f"Wrote {OUTPUT_JSON}", file=sys.stderr)


if __name__ == "__main__":
    main()