import json
import sys
import time
from datetime import datetime
from typing import Any

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://localhost:7100"
API_KEY = "Hawk3rHunt3r$"
VERIFY_SSL = False
TIMEOUT_SECONDS = 60
DEBUG = True
MAX_BODY_PREVIEW = 10000

session = requests.Session()
session.headers.update({
    "accept": "application/json",
    "X-API-KEY": API_KEY,
    "Content-Type": "application/json",
})


def now_utc() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC"


def debug(message: str) -> None:
    if DEBUG:
        print(f"[{now_utc()}] {message}")


def debug_json(title: str, value: Any, max_length: int = 4000) -> None:
    if not DEBUG:
        return

    try:
        text = json.dumps(value, indent=2, default=str)
    except Exception:
        text = repr(value)

    if len(text) > max_length:
        text = text[:max_length] + "\n... [truncated]"

    print(f"[{now_utc()}] {title}\n{text}")


def request_json(method: str, url: str, *, json_body: dict[str, Any] | None = None) -> Any:
    debug(f"Preparing {method} {url}")

    if json_body is not None:
        debug_json("Request JSON body:", json_body)

    started = time.perf_counter()

    response = session.request(
        method=method,
        url=url,
        json=json_body,
        verify=VERIFY_SSL,
        timeout=TIMEOUT_SECONDS,
    )

    duration_ms = round((time.perf_counter() - started) * 1000, 2)

    debug(f"Response {method} {url} -> HTTP {response.status_code} in {duration_ms} ms")

    raw_body = response.text

    if not response.ok:
        print(f"\nHTTP {response.status_code} calling {url}")
        print(raw_body[:MAX_BODY_PREVIEW])
        response.raise_for_status()

    if not raw_body.strip():
        debug("Empty response body")
        return None

    preview = raw_body[:MAX_BODY_PREVIEW]
    debug(f"Response preview:\n{preview}")

    parsed = response.json()

    if isinstance(parsed, list):
        debug(f"Parsed JSON list length: {len(parsed)}")
    elif isinstance(parsed, dict):
        debug(f"Parsed JSON keys: {list(parsed.keys())}")

    return parsed


def get_junior_members() -> list[dict[str, Any]]:
    debug("Fetching junior members")
    data = request_json("GET", f"{BASE_URL}/api/members/juniors")

    if not isinstance(data, list):
        raise ValueError("Expected /api/members/juniors to return a list")

    debug(f"Retrieved {len(data)} junior members")
    return data


def get_single_junior_member(member_number: int) -> dict[str, Any]:
    debug(f"Using single junior member id: {member_number}")
    return {
        "memberNumber": member_number,
        "fullName": f"Member {member_number}",
    }


def get_handicap_history(member_number: int) -> dict[str, Any]:
    debug(f"Fetching handicap history for {member_number}")
    data = request_json("GET", f"{BASE_URL}/api/members/{member_number}/handicapHistory")

    if not isinstance(data, dict):
        raise ValueError("Expected handicap history to be an object")

    return data


def publish_event(event_type: str, payload: dict[str, Any]) -> None:
    body = {
        "eventType": event_type,
        "payload": payload,
    }

    debug(f"Publishing {event_type} for member {payload.get('memberId')}")
    debug_json("Payload:", body)

    returned = request_json("POST", f"{BASE_URL}/api/events/admin/publish", json_body=body)

    debug_json("Publish response:", returned)

    print(
        f"Published {event_type} for member {returned.get('memberId')} at {returned.get('occurredAtUtc')}"
    )


def get_sorted_handicap_points(history: dict[str, Any]) -> list[dict[str, Any]]:
    points = history.get("handicapIndexPoints", [])

    if not isinstance(points, list):
        return []

    valid_points: list[dict[str, Any]] = []

    for point in points:
        if not isinstance(point, dict):
            continue

        if point.get("date") is None or point.get("index") is None:
            continue

        valid_points.append(point)

    valid_points.sort(key=lambda x: x["date"])

    debug(f"Valid handicap points: {len(valid_points)}")
    return valid_points


def replay_handicap_changes_for_member(member: dict[str, Any]) -> None:
    member_number = member.get("memberNumber")
    full_name = member.get("fullName", "Unknown member")

    debug(f"Processing {full_name} ({member_number})")

    if not isinstance(member_number, int) or member_number <= 0:
        print(f"Skipping {full_name}: invalid memberNumber '{member_number}'")
        return

    history = get_handicap_history(member_number)
    points = get_sorted_handicap_points(history)

    if len(points) < 2:
        print(f"Skipping {full_name} ({member_number}): not enough data")
        return

    previous_index: float | None = None
    published_count = 0

    for point in points:
        occurred_at = point["date"]
        current_index = float(point["index"])

        if previous_index is None:
            previous_index = current_index
            continue

        if current_index == previous_index:
            continue

        event_type = (
            "junior.handicap.reduced"
            if current_index < previous_index
            else "junior.handicap.increased"
        )

        debug(f"Change detected for {full_name}: {previous_index} -> {current_index}")

        payload = {
            "memberId": member_number,
            "occurredAtUtc": occurred_at,
            "previousHandicap": previous_index,
            "currentHandicap": current_index,
        }

        publish_event(event_type, payload)
        published_count += 1
        previous_index = current_index

    print(f"Processed {full_name} ({member_number}): {published_count} events")


def get_members_to_process() -> list[dict[str, Any]]:
    if len(sys.argv) < 2:
        debug("No member id provided, fetching all juniors")
        return get_junior_members()

    raw_member_number = sys.argv[1]

    try:
        member_number = int(raw_member_number)
    except ValueError as ex:
        raise ValueError(f"Invalid member id '{raw_member_number}'. Expected an integer.") from ex

    return [get_single_junior_member(member_number)]


def main() -> None:
    debug("Script started")

    members = get_members_to_process()

    success = 0
    failures = 0

    for member in members:
        try:
            replay_handicap_changes_for_member(member)
            success += 1
        except Exception as ex:
            failures += 1
            print(f"Failed for member {member.get('memberNumber')}: {ex}")

    print("\nSummary")
    print("-------")
    print(f"Total: {len(members)}")
    print(f"Success: {success}")
    print(f"Failures: {failures}")


if __name__ == "__main__":
    main()