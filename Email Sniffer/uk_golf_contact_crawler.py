#!/usr/bin/env python3
"""
uk_golf_contact_crawler.py

Crawl a list of golf-club websites and collect publicly listed email addresses,
with scoring for Club Manager / Secretary and Handicap / Competitions contacts.

INPUT CSV
---------
A CSV with at least one of these columns:
    domain
    website
    url

Optional columns are preserved where useful, especially:
    club
    club_name
    country
    county

Example:
club,domain
Example Golf Club,https://www.examplegolfclub.co.uk

OUTPUT
------
CSV columns include:
    club
    domain
    email
    likely_role
    role_score
    matched_keywords
    source_url
    source_type
    evidence
    first_seen
    pages_seen
    is_role_address

Notes:
- Only collects emails published on the club's own domain.
- Does NOT guess named people's email addresses.
- Does NOT perform SMTP verification.
- Respects robots.txt by default.
- Rate-limited and bounded per domain.
"""

from __future__ import annotations

import argparse
import csv
import html
import re
import sys
import time
import threading
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import urljoin, urlparse, urldefrag
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

USER_AGENT = "UKGolfContactResearchBot/1.0 (+public-contact-research)"
DEFAULT_TIMEOUT = 15
DEFAULT_DELAY = 0.75
DEFAULT_MAX_PAGES = 40
DEFAULT_DEPTH = 3

EMAIL_RE = re.compile(
    r"""(?ix)
    (?<![a-z0-9._%+\-])
    ([a-z0-9._%+\-]{1,64}
    @
    [a-z0-9.\-]{1,253}
    \.[a-z]{2,24})
    """
)

OBFUSCATED_PATTERNS = [
    re.compile(
        r"""(?ix)
        ([a-z0-9._%+\-]{1,64})
        \s*(?:\[at\]|\(at\)|\sat\s)\s*
        ([a-z0-9.\-]{1,253})
        \s*(?:\[dot\]|\(dot\)|\sdot\s)\s*
        ([a-z]{2,24})
        """
    ),
]

ROLE_KEYWORDS = {
    "handicap": {
        "handicap": 12,
        "handicaps": 12,
        "handicap secretary": 18,
        "handicap committee": 16,
        "handicapping": 12,
        "world handicap system": 12,
        "whs": 10,
        "competitions": 8,
        "competition secretary": 14,
        "competitions secretary": 14,
        "match and handicap": 16,
        "match & handicap": 16,
        "match secretary": 8,
    },
    "manager": {
        "club manager": 18,
        "general manager": 18,
        "golf club manager": 18,
        "manager": 10,
        "secretary manager": 17,
        "secretary/manager": 17,
        "club secretary": 15,
        "secretary": 9,
        "general secretary": 12,
        "chief executive": 12,
        "ceo": 10,
        "office": 5,
        "administration": 5,
    },
}

ROLE_LOCALPART_HINTS = {
    "handicap": {
        "handicap": 18,
        "handicaps": 18,
        "whs": 16,
        "competition": 12,
        "competitions": 14,
        "comps": 10,
        "match": 7,
    },
    "manager": {
        "manager": 18,
        "clubmanager": 18,
        "generalmanager": 18,
        "secretary": 15,
        "clubsecretary": 17,
        "office": 8,
        "admin": 7,
        "administration": 7,
        "ceo": 10,
    },
}

GENERIC_ROLE_LOCALPARTS = {
    "info", "office", "admin", "enquiries", "enquiry", "contact",
    "secretary", "manager", "clubmanager", "generalmanager",
    "handicap", "handicaps", "whs", "competition", "competitions",
    "comps", "golf", "membership", "members", "reception"
}

CONTACT_PATH_HINTS = [
    "/contact", "/contact-us", "/contacts", "/club-contacts",
    "/committee", "/committees", "/who-we-are", "/about", "/about-us",
    "/staff", "/team", "/management", "/club-officials", "/officials",
    "/members", "/membership", "/golf", "/handicaps", "/handicap",
    "/competitions", "/competition", "/match-and-handicap",
    "/privacy", "/terms"
]

SKIP_EXTENSIONS = (
    ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
    ".zip", ".rar", ".7z", ".mp3", ".mp4", ".avi", ".mov",
    ".css", ".js", ".xml", ".json"
)

@dataclass
class EmailRecord:
    club: str
    domain: str
    email: str
    source_urls: Set[str] = field(default_factory=set)
    source_types: Set[str] = field(default_factory=set)
    evidence_snippets: List[str] = field(default_factory=list)
    matched_keywords: Set[str] = field(default_factory=set)
    manager_score: int = 0
    handicap_score: int = 0
    first_seen: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def likely_role(self) -> Tuple[str, int]:
        if self.handicap_score == 0 and self.manager_score == 0:
            return ("other", 0)
        if self.handicap_score > self.manager_score:
            return ("handicap/competitions", self.handicap_score)
        if self.manager_score > self.handicap_score:
            return ("club manager/secretary", self.manager_score)
        return ("manager or handicap", self.manager_score)


class DomainPoliteness:
    def __init__(self, delay: float):
        self.delay = delay
        self.last_access: Dict[str, float] = {}
        self.lock = threading.Lock()

    def wait(self, domain: str) -> None:
        with self.lock:
            now = time.time()
            last = self.last_access.get(domain, 0.0)
            remaining = self.delay - (now - last)
            if remaining > 0:
                time.sleep(remaining)
            self.last_access[domain] = time.time()


def normalize_start_url(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    if not re.match(r"^https?://", value, flags=re.I):
        value = "https://" + value
    return value.rstrip("/")


def canonical_domain(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def same_domain(url: str, domain: str) -> bool:
    host = canonical_domain(url)
    return host == domain or host.endswith("." + domain)


def clean_email(email_addr: str) -> str:
    email_addr = html.unescape(email_addr).strip().strip(".,;:()[]{}<>\"'")
    return email_addr.lower()


def valid_email(email_addr: str) -> bool:
    if len(email_addr) > 320 or "@" not in email_addr:
        return False
    local, _, domain = email_addr.rpartition("@")
    if not local or not domain or "." not in domain:
        return False
    if domain.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")):
        return False
    if any(x in email_addr for x in ("example.com", "example.org", "sentry.io")):
        return False
    return True


def decode_cf_email(encoded: str) -> Optional[str]:
    """Decode Cloudflare email-protection hex strings."""
    try:
        key = int(encoded[:2], 16)
        chars = []
        for i in range(2, len(encoded), 2):
            chars.append(chr(int(encoded[i:i+2], 16) ^ key))
        result = "".join(chars)
        return clean_email(result) if valid_email(clean_email(result)) else None
    except Exception:
        return None


def extract_obfuscated_emails(text: str) -> Set[str]:
    out = set()
    for pat in OBFUSCATED_PATTERNS:
        for m in pat.finditer(text):
            addr = f"{m.group(1)}@{m.group(2)}.{m.group(3)}"
            addr = clean_email(addr)
            if valid_email(addr):
                out.add(addr)
    return out


def evidence_around(text: str, needle: str, radius: int = 180) -> str:
    low = text.lower()
    pos = low.find(needle.lower())
    if pos == -1:
        return re.sub(r"\s+", " ", text[:360]).strip()
    start = max(0, pos - radius)
    end = min(len(text), pos + len(needle) + radius)
    return re.sub(r"\s+", " ", text[start:end]).strip()


def score_text(text: str, email_addr: str) -> Tuple[int, int, Set[str]]:
    t = text.lower()
    local = email_addr.split("@", 1)[0].lower()
    local_compact = re.sub(r"[^a-z0-9]", "", local)

    scores = {"manager": 0, "handicap": 0}
    matched: Set[str] = set()

    for role, mapping in ROLE_KEYWORDS.items():
        for keyword, weight in mapping.items():
            if keyword in t:
                scores[role] += weight
                matched.add(keyword)

    for role, mapping in ROLE_LOCALPART_HINTS.items():
        for keyword, weight in mapping.items():
            keyword_compact = re.sub(r"[^a-z0-9]", "", keyword)
            if keyword in local or keyword_compact in local_compact:
                scores[role] += weight
                matched.add(f"email:{keyword}")

    return scores["manager"], scores["handicap"], matched


def is_role_address(email_addr: str) -> bool:
    local = email_addr.split("@", 1)[0].lower()
    compact = re.sub(r"[^a-z0-9]", "", local)
    return local in GENERIC_ROLE_LOCALPARTS or compact in GENERIC_ROLE_LOCALPARTS


def get_robot_parser(session: requests.Session, start_url: str) -> Optional[RobotFileParser]:
    try:
        parsed = urlparse(start_url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        rp = RobotFileParser()
        r = session.get(robots_url, timeout=DEFAULT_TIMEOUT, headers={"User-Agent": USER_AGENT})
        if r.status_code >= 400:
            return None
        rp.set_url(robots_url)
        rp.parse(r.text.splitlines())
        return rp
    except Exception:
        return None


def candidate_links(soup: BeautifulSoup, base_url: str, domain: str) -> List[str]:
    scored = []
    for a in soup.find_all("a", href=True):
        href = html.unescape(a.get("href", "")).strip()
        if not href or href.startswith(("#", "javascript:", "tel:", "mailto:")):
            continue
        absolute = urljoin(base_url, href)
        absolute, _ = urldefrag(absolute)
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            continue
        if not same_domain(absolute, domain):
            continue
        path = parsed.path.lower()
        if path.endswith(SKIP_EXTENSIONS):
            continue

        anchor = a.get_text(" ", strip=True).lower()
        score = 0
        combined = f"{path} {anchor}"
        for hint in (
            "contact", "committee", "staff", "team", "manager", "secretary",
            "official", "handicap", "competition", "competitions", "membership",
            "about", "golf", "club"
        ):
            if hint in combined:
                score += 4
        scored.append((score, absolute))

    # Higher-value contact pages first, then ordinary internal links.
    scored.sort(key=lambda x: (-x[0], len(x[1])))
    deduped = []
    seen = set()
    for _, u in scored:
        if u not in seen:
            seen.add(u)
            deduped.append(u)
    return deduped


def extract_emails_from_page(
    soup: BeautifulSoup,
    raw_html: str,
    page_url: str
) -> Dict[str, Tuple[str, str]]:
    """
    Return email -> (source_type, evidence_text).
    """
    results: Dict[str, Tuple[str, str]] = {}

    page_text = soup.get_text(" ", strip=True)

    # mailto links
    for a in soup.find_all("a", href=True):
        href = html.unescape(a.get("href", "")).strip()
        if href.lower().startswith("mailto:"):
            email_part = href[7:].split("?", 1)[0]
            for piece in re.split(r"[,;]", email_part):
                addr = clean_email(piece)
                if valid_email(addr):
                    context = a.parent.get_text(" ", strip=True) if a.parent else page_text
                    results[addr] = ("mailto", evidence_around(context, addr))

    # visible/plain HTML text
    for m in EMAIL_RE.finditer(raw_html):
        addr = clean_email(m.group(1))
        if valid_email(addr):
            results.setdefault(addr, ("html", evidence_around(page_text, addr)))

    for m in EMAIL_RE.finditer(page_text):
        addr = clean_email(m.group(1))
        if valid_email(addr):
            results.setdefault(addr, ("visible_text", evidence_around(page_text, addr)))

    # common textual obfuscation
    for addr in extract_obfuscated_emails(page_text):
        results.setdefault(addr, ("obfuscated_text", evidence_around(page_text, addr.split("@")[0])))

    # Cloudflare email protection
    for el in soup.select("[data-cfemail]"):
        decoded = decode_cf_email(el.get("data-cfemail", ""))
        if decoded:
            context = el.parent.get_text(" ", strip=True) if el.parent else page_text
            results.setdefault(decoded, ("cloudflare", evidence_around(context, decoded.split("@")[0])))

    return results


def crawl_club(
    club: str,
    start_url: str,
    max_pages: int,
    max_depth: int,
    delay: float,
    respect_robots: bool = True,
) -> List[EmailRecord]:
    domain = canonical_domain(start_url)
    if not domain:
        return []

    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
    })
    politeness = DomainPoliteness(delay)
    robot = get_robot_parser(session, start_url) if respect_robots else None

    seeds = [start_url] + [urljoin(start_url + "/", p.lstrip("/")) for p in CONTACT_PATH_HINTS]
    queue = deque((u, 0) for u in seeds)
    visited: Set[str] = set()
    records: Dict[str, EmailRecord] = {}

    while queue and len(visited) < max_pages:
        url, depth = queue.popleft()
        url, _ = urldefrag(url)
        if url in visited or depth > max_depth or not same_domain(url, domain):
            continue
        if robot and not robot.can_fetch(USER_AGENT, url):
            continue

        visited.add(url)
        politeness.wait(domain)

        try:
            r = session.get(url, timeout=DEFAULT_TIMEOUT, allow_redirects=True)
            if r.status_code >= 400:
                continue
            ctype = (r.headers.get("Content-Type") or "").lower()
            if "text/html" not in ctype and "application/xhtml+xml" not in ctype:
                continue
            if not same_domain(r.url, domain):
                continue
        except requests.RequestException:
            continue

        soup = BeautifulSoup(r.text, "html.parser")
        page_text = soup.get_text(" ", strip=True)

        found = extract_emails_from_page(soup, r.text, r.url)
        for addr, (source_type, local_evidence) in found.items():
            # Keep only addresses belonging to the club's own domain or subdomain.
            email_domain = addr.rsplit("@", 1)[-1].lower()
            if not (email_domain == domain or email_domain.endswith("." + domain)):
                continue

            rec = records.get(addr)
            if rec is None:
                rec = EmailRecord(club=club, domain=domain, email=addr)
                records[addr] = rec

            combined_evidence = f"{local_evidence} {page_text[:1000]}"
            mgr_score, hcp_score, matched = score_text(combined_evidence, addr)

            rec.manager_score = max(rec.manager_score, mgr_score)
            rec.handicap_score = max(rec.handicap_score, hcp_score)
            rec.matched_keywords.update(matched)
            rec.source_urls.add(r.url)
            rec.source_types.add(source_type)
            if local_evidence and local_evidence not in rec.evidence_snippets:
                rec.evidence_snippets.append(local_evidence[:500])

        if depth < max_depth:
            for link in candidate_links(soup, r.url, domain):
                if link not in visited:
                    queue.append((link, depth + 1))

    return list(records.values())


def detect_columns(fieldnames: Iterable[str]) -> Tuple[Optional[str], Optional[str]]:
    names = [x.strip() for x in fieldnames if x]
    url_col = next((x for x in names if x.lower() in {"domain", "website", "url"}), None)
    club_col = next((x for x in names if x.lower() in {"club", "club_name", "name"}), None)
    return url_col, club_col


def read_input(path: str) -> List[Tuple[str, str]]:
    rows = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("Input CSV has no header.")
        url_col, club_col = detect_columns(reader.fieldnames)
        if not url_col:
            raise ValueError("Input CSV needs a domain, website, or url column.")

        for row in reader:
            start_url = normalize_start_url(row.get(url_col, ""))
            if not start_url:
                continue
            club = (row.get(club_col, "") if club_col else "").strip()
            if not club:
                club = canonical_domain(start_url)
            rows.append((club, start_url))
    return rows


def write_output(records: List[EmailRecord], output_path: str) -> None:
    fields = [
        "club",
        "domain",
        "email",
        "likely_role",
        "role_score",
        "manager_score",
        "handicap_score",
        "matched_keywords",
        "source_url",
        "source_type",
        "evidence",
        "first_seen",
        "pages_seen",
        "is_role_address",
    ]
    with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()

        def sort_key(rec: EmailRecord):
            role, score = rec.likely_role()
            priority = {
                "handicap/competitions": 0,
                "club manager/secretary": 1,
                "manager or handicap": 2,
                "other": 3,
            }.get(role, 9)
            return (rec.club.lower(), priority, -score, rec.email)

        for rec in sorted(records, key=sort_key):
            role, score = rec.likely_role()
            writer.writerow({
                "club": rec.club,
                "domain": rec.domain,
                "email": rec.email,
                "likely_role": role,
                "role_score": score,
                "manager_score": rec.manager_score,
                "handicap_score": rec.handicap_score,
                "matched_keywords": " | ".join(sorted(rec.matched_keywords)),
                "source_url": " | ".join(sorted(rec.source_urls)),
                "source_type": " | ".join(sorted(rec.source_types)),
                "evidence": " || ".join(rec.evidence_snippets[:5]),
                "first_seen": rec.first_seen,
                "pages_seen": len(rec.source_urls),
                "is_role_address": "yes" if is_role_address(rec.email) else "no",
            })


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Collect publicly listed manager/secretary and handicap/competition emails from golf-club websites."
    )
    parser.add_argument("input_csv", help="CSV containing domain/website/url column")
    parser.add_argument("-o", "--output", default="golf_club_contacts.csv", help="Output CSV")
    parser.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES, help="Maximum HTML pages per club")
    parser.add_argument("--max-depth", type=int, default=DEFAULT_DEPTH, help="Maximum crawl depth")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY, help="Minimum delay between requests to same domain")
    parser.add_argument(
        "--ignore-robots",
        action="store_true",
        help="Ignore robots.txt (not recommended; default is to respect it)"
    )
    args = parser.parse_args()

    clubs = read_input(args.input_csv)
    if not clubs:
        print("No clubs found in input CSV.", file=sys.stderr)
        return 1

    all_records: List[EmailRecord] = []
    total = len(clubs)

    for i, (club, url) in enumerate(clubs, start=1):
        print(f"[{i}/{total}] {club}: {url}", file=sys.stderr)
        try:
            recs = crawl_club(
                club=club,
                start_url=url,
                max_pages=args.max_pages,
                max_depth=args.max_depth,
                delay=args.delay,
                respect_robots=not args.ignore_robots,
            )
            all_records.extend(recs)
            print(f"  found {len(recs)} unique on-domain email(s)", file=sys.stderr)
        except Exception as exc:
            print(f"  ERROR: {exc}", file=sys.stderr)

    write_output(all_records, args.output)
    print(f"Wrote {len(all_records)} records to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
