import csv
import requests
from datetime import datetime

MEMBER_IDS = [
    2739,
    2212,
    2265,
    1708,
    2242,
    1801,
    2736,
    3486,
    1616,
    1617,
    3517,
    1460,
    16,
    2288,
    453,
    18,
    416,
    24,
    25,
    1228,
    1647,
    424,
    1188,
    2345,
    1633,
    2766,
    3334,
    1224,
    180,
    41,
    3377,
    3627,
    3526,
    2207,
    749,
    39,
    765,
    1774,
    1773,
    3680,
    3123,
    2818,
    3269,
    493,
    59,
    940,
    1236,
    321,
    61,
    3455,
    1786,
    1423,
    730,
    2690,
    2338,
    2667,
    3529,
    74,
    648,
    3200,
    2430,
    1570,
    80,
    1052,
    510,
    1818,
    3432,
    2315,
    3605,
    719,
    98,
    2695,
    2939,
    2274,
    2219,
    3113,
    3356,
    1763,
    3131,
    57,
    1486,
    2396,
    2879,
    677,
    1408,
    829,
    141,
    271,
    1182,
    944,
    636,
    1631,
    1008,
    161,
    528,
    471,
    549,
    1624,
    3114,
    1305,
    3790,
    1767,
    1543,
    2826,
    2369,
    1406,
    807,
    3478,
    1499,
    1548,
    3047,
    619,
    3077,
    2729,
    2424,
    3310,
    2217,
    3065,
    686,
    2360,
    676,
    3756,
    1399,
    1516,
    3331,
    866,
    3321,
    2279,
    3048,
    255,
    645,
    451,
    3369,
    2256,
    589,
    3232,
    1444,
    775,
    674,
    1385,
    1207,
    2684,
    984,
    3530,
    284,
    64,
    3600,
    289,
    3603,
    679,
    1154,
    1697,
    2418,
    2331,
    302,
    2255,
    3210,
    1762,
    987,
    651,
    1360,
    2878,
    1350,
    764,
    1488,
    2277,
    712,
    3418,
    2247,
    2160,
    1831,
    1492,
    3378,
    2383,
    2306,
    3399,
    3476,
    969,
]

BASE_URL = "https://api-botgcapps-prd.azurewebsites.net"
API_KEY = "Hawk3rHunt3r$"
TARGET_YEAR = datetime.now().year - 1
OUTPUT_FILE = "member_round_summary.csv"


def fetch_rounds(session: requests.Session, member_id: int) -> list[dict]:
    url = f"{BASE_URL}/api/members/{member_id}/rounds"
    response = session.get(url, timeout=30)
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, list):
        raise ValueError(f"Unexpected response for member {member_id}")
    return data


def is_in_target_year(round_item: dict) -> bool:
    date_played = round_item.get("datePlayed")
    if not date_played:
        return False

    try:
        played_date = datetime.fromisoformat(date_played.replace("Z", "+00:00"))
    except ValueError:
        return False

    return played_date.year == TARGET_YEAR


def is_competition(round_item: dict) -> bool:
    return round_item.get("isGeneralPlay") is False


def main() -> None:
    headers = {
        "accept": "application/json",
        "X-API-KEY": API_KEY,
    }

    results: list[dict] = []

    with requests.Session() as session:
        session.headers.update(headers)

        for member_id in MEMBER_IDS:
            try:
                rounds = fetch_rounds(session, member_id)
                rounds_last_year = [r for r in rounds if is_in_target_year(r)]
                competitions_last_year = [r for r in rounds_last_year if is_competition(r)]

                results.append(
                    {
                        "memberId": member_id,
                        "roundsPlayedLastYear": len(rounds_last_year),
                        "competitionsPlayedLastYear": len(competitions_last_year),
                        "status": "OK",
                    }
                )

                print(
                    f"Member {member_id}: rounds={len(rounds_last_year)}, competitions={len(competitions_last_year)}"
                )

            except requests.HTTPError as ex:
                status_code = ex.response.status_code if ex.response is not None else "HTTPError"
                reason = ex.response.reason if ex.response is not None else str(ex)
                results.append(
                    {
                        "memberId": member_id,
                        "roundsPlayedLastYear": 0,
                        "competitionsPlayedLastYear": 0,
                        "status": f"{status_code} {reason}",
                    }
                )
                print(f"Member {member_id}: failed with {status_code} {reason}")

            except Exception as ex:
                results.append(
                    {
                        "memberId": member_id,
                        "roundsPlayedLastYear": 0,
                        "competitionsPlayedLastYear": 0,
                        "status": str(ex),
                    }
                )
                print(f"Member {member_id}: failed with {ex}")

    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(
            csv_file,
            fieldnames=[
                "memberId",
                "roundsPlayedLastYear",
                "competitionsPlayedLastYear",
                "status",
            ],
        )
        writer.writeheader()
        writer.writerows(results)

    print(f"Done. Wrote {OUTPUT_FILE}")


if __name__ == "__main__":
    main()