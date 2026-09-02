#!/usr/bin/env python3
"""
uk_golf_email_harvester.py

End-to-end UK golf-club contact harvester.

What it does
------------
1. Uses Playwright/Chromium to open the public club finders for:
   - England Golf
   - Scottish Golf
   - Wales Golf
   - Golf Ireland (then keeps Northern Ireland clubs only)
2. Discovers club detail pages and official club websites.
3. Crawls each official club website.
4. Extracts publicly published email addresses (including mailto links,
   Cloudflare-obfuscated addresses and common "[at] / [dot]" forms).
5. Scores addresses for likely:
   - Club Manager / General Manager / Club Secretary
   - Handicap Secretary / Handicap Committee / Competitions / Match & Handicap
6. Writes:
   - discovered_clubs.csv
   - golf_club_contacts.csv

No hand-built clubs.csv is required.

Install
-------
    python -m pip install -r requirements.txt
    python -m playwright install chromium

Run
---
    python uk_golf_email_harvester.py

Useful options
--------------
    python uk_golf_email_harvester.py --headful
    python uk_golf_email_harvester.py --max-pages-per-site 100
    python uk_golf_email_harvester.py --workers 8
    python uk_golf_email_harvester.py --reuse-clubs discovered_clubs.csv

Important
---------
This collects addresses that are publicly exposed on public web pages. It does
not guess named people's email addresses and does not attempt SMTP validation.
No crawler can guarantee literally every address because sites can block bots,
hide content behind logins, render content conditionally, or publish contacts
only in images/documents.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse, urldefrag
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
except ImportError:
    sync_playwright = None
    PlaywrightTimeoutError = Exception


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0 Safari/537.36"
)

DIRECTORIES = [
    {
        "nation": "England",
        "url": "https://www.englandgolf.org/find-and-play/",
        "host": "englandgolf.org",
        "detail_text": ("view", "details", "club", "facility"),
    },
    {
        "nation": "Scotland",
        "url": "https://www.scottishgolf.org/find-a-facility",
        "host": "scottishgolf.org",
        "detail_text": ("view details",),
    },
    {
        "nation": "Wales",
        "url": "https://www.walesgolf.org/find-a-facility",
        "host": "walesgolf.org",
        "detail_text": ("view details",),
    },
    {
        "nation": "Northern Ireland",
        "url": "https://www.golfireland.ie/find-a-club",
        "host": "golfireland.ie",
        "detail_text": ("view club",),
    },
]

GOVERNING_HOSTS = {
    "englandgolf.org", "www.englandgolf.org",
    "scottishgolf.org", "www.scottishgolf.org",
    "walesgolf.org", "www.walesgolf.org",
    "golfireland.ie", "www.golfireland.ie",
}

SOCIAL_HOST_BITS = (
    "facebook.", "instagram.", "twitter.", "x.com", "linkedin.",
    "youtube.", "tiktok.", "threads.net"
)

BOOKING_HOST_BITS = (
    "golfnow.", "brsgolf.", "howdidido.", "masterscoreboard.",
    "clubv1.", "intelligentgolf.", "teeofftimes.", "chronogolf.",
    "visitors.brsgolf", "members.brsgolf", "dotgolf."
)

ASSET_EXTENSIONS = (
    ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
    ".zip", ".rar", ".7z", ".mp3", ".mp4", ".avi", ".mov",
    ".css", ".js", ".xml", ".json", ".woff", ".woff2", ".ttf",
)

EMAIL_RE = re.compile(
    r"(?i)(?<![a-z0-9._%+\-])"
    r"([a-z0-9._%+\-]{1,64}@[a-z0-9.\-]{1,253}\.[a-z]{2,24})"
)

OBFUSCATED_RE = re.compile(
    r"(?ix)"
    r"([a-z0-9._%+\-]{1,64})"
    r"\s*(?:\[at\]|\(at\)|\{at\}|\sat\s)\s*"
    r"([a-z0-9.\-]{1,253})"
    r"\s*(?:\[dot\]|\(dot\)|\{dot\}|\sdot\s)\s*"
    r"([a-z]{2,24})"
)

UK_NI_COUNTIES = (
    "antrim", "armagh", "down", "fermanagh", "tyrone",
    "londonderry", "derry", "belfast"
)
ROI_BORDER_COUNTIES = ("donegal", "cavan", "monaghan")
BT_POSTCODE_RE = re.compile(r"\bBT\d{1,2}\s?\d[A-Z]{2}\b", re.I)

CONTACT_HINTS = (
    "contact", "contacts", "committee", "committees", "staff", "team",
    "management", "manager", "secretary", "officials", "officers",
    "handicap", "handicapping", "competition", "competitions",
    "match", "membership", "members", "about", "who-we-are",
    "club", "golf", "governance", "captain", "office"
)

CONTACT_PATH_SEEDS = (
    "/contact", "/contact-us", "/contacts", "/club-contacts",
    "/committee", "/committees", "/staff", "/team", "/management",
    "/club-officials", "/officials", "/about", "/about-us",
    "/who-we-are", "/handicap", "/handicaps", "/handicapping",
    "/competitions", "/competition", "/match-and-handicap",
    "/membership", "/members", "/governance"
)

ROLE_PHRASES = {
    "handicap": {
        "handicap secretary": 30,
        "handicaps secretary": 30,
        "handicap officer": 26,
        "handicap chair": 24,
        "handicap chairman": 24,
        "handicap committee": 22,
        "handicapping": 16,
        "world handicap system": 14,
        "whs": 11,
        "competition secretary": 24,
        "competitions secretary": 26,
        "competitions manager": 22,
        "match and handicap": 27,
        "match & handicap": 27,
        "match secretary": 14,
        "competitions": 10,
        "competition": 8,
        "handicap": 15,
    },
    "manager": {
        "general manager": 30,
        "club manager": 30,
        "golf club manager": 30,
        "secretary manager": 28,
        "secretary-manager": 28,
        "secretary/manager": 28,
        "club secretary": 26,
        "general secretary": 22,
        "chief executive": 20,
        "managing secretary": 26,
        "manager": 15,
        "secretary": 13,
        "club office": 9,
        "office": 5,
        "administration": 5,
    },
}

LOCALPART_PHRASES = {
    "handicap": {
        "handicap": 35, "handicaps": 35, "whs": 28,
        "competition": 22, "competitions": 24, "comps": 18,
        "matchhandicap": 28,
    },
    "manager": {
        "manager": 35, "clubmanager": 38, "generalmanager": 38,
        "secretary": 30, "clubsecretary": 34, "secretarymanager": 35,
        "office": 16, "admin": 12, "administration": 12,
        "ceo": 18,
    },
}

BAD_EMAIL_BITS = (
    "example.com", "example.org", "sentry.io", "wixpress.com",
    "wordpress.com", "cloudflare.com", "mailchimp.com",
)

GENERIC_LOCALPARTS = {
    "info", "office", "admin", "contact", "enquiries", "enquiry",
    "secretary", "manager", "clubmanager", "generalmanager",
    "handicap", "handicaps", "whs", "competition", "competitions",
    "comps", "membership", "members", "reception", "golf"
}


@dataclass
class Club:
    name: str
    nation: str
    directory_url: str
    detail_url: str = ""
    website: str = ""
    domain: str = ""
    address_text: str = ""
    directory_email: str = ""
    discovery_notes: str = ""


@dataclass
class Contact:
    club: str
    nation: str
    website: str
    club_domain: str
    email: str
    role: str
    role_score: int
    manager_score: int
    handicap_score: int
    matched_keywords: Set[str] = field(default_factory=set)
    source_urls: Set[str] = field(default_factory=set)
    evidence: List[str] = field(default_factory=list)
    source_types: Set[str] = field(default_factory=set)
    email_domain_matches_club: bool = False
    first_seen_utc: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def clean_space(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def host_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower().strip(".")
    except Exception:
        return ""


def base_domainish(host: str) -> str:
    host = (host or "").lower().strip(".")
    return host[4:] if host.startswith("www.") else host


def canonicalize_url(url: str) -> str:
    if not url:
        return ""
    url = html.unescape(url.strip())
    if url.startswith("//"):
        url = "https:" + url
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    try:
        p = urlparse(url)
        scheme = p.scheme.lower()
        host = (p.hostname or "").lower()
        if not host:
            return ""
        port = f":{p.port}" if p.port and p.port not in (80, 443) else ""
        path = p.path or "/"
        query = urlencode(sorted(parse_qsl(p.query, keep_blank_values=True)))
        return urlunparse((scheme, host + port, path, "", query, ""))
    except Exception:
        return ""


def same_site(url: str, club_domain: str) -> bool:
    h = base_domainish(host_of(url))
    d = base_domainish(club_domain)
    return bool(h and d and (h == d or h.endswith("." + d)))


def clean_email(addr: str) -> str:
    addr = html.unescape(addr or "")
    addr = addr.strip().strip(".,;:()[]{}<>\"'").lower()
    return addr


def valid_email(addr: str) -> bool:
    if not addr or len(addr) > 320 or "@" not in addr:
        return False
    if any(bit in addr for bit in BAD_EMAIL_BITS):
        return False
    local, _, dom = addr.rpartition("@")
    if not local or not dom or "." not in dom:
        return False
    if dom.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")):
        return False
    return bool(re.fullmatch(
        r"[a-z0-9._%+\-]{1,64}@[a-z0-9.\-]{1,253}\.[a-z]{2,24}",
        addr, re.I
    ))


def role_address(addr: str) -> bool:
    local = addr.split("@", 1)[0].lower()
    compact = re.sub(r"[^a-z0-9]", "", local)
    return local in GENERIC_LOCALPARTS or compact in GENERIC_LOCALPARTS


def decode_cf_email(encoded: str) -> Optional[str]:
    try:
        key = int(encoded[:2], 16)
        out = "".join(
            chr(int(encoded[i:i+2], 16) ^ key)
            for i in range(2, len(encoded), 2)
        )
        out = clean_email(out)
        return out if valid_email(out) else None
    except Exception:
        return None


def evidence_around(text: str, needle: str, radius: int = 220) -> str:
    text = clean_space(text)
    if not text:
        return ""
    pos = text.lower().find((needle or "").lower())
    if pos < 0:
        return text[:440]
    return text[max(0, pos-radius): min(len(text), pos+len(needle)+radius)]


def score_role(context: str, addr: str) -> Tuple[int, int, Set[str]]:
    text = clean_space(context).lower()
    local = addr.split("@", 1)[0].lower()
    local_compact = re.sub(r"[^a-z0-9]", "", local)
    mgr = 0
    hcp = 0
    matched: Set[str] = set()

    for phrase, weight in ROLE_PHRASES["manager"].items():
        if phrase in text:
            mgr += weight
            matched.add(phrase)
    for phrase, weight in ROLE_PHRASES["handicap"].items():
        if phrase in text:
            hcp += weight
            matched.add(phrase)

    for phrase, weight in LOCALPART_PHRASES["manager"].items():
        compact = re.sub(r"[^a-z0-9]", "", phrase)
        if phrase in local or compact in local_compact:
            mgr += weight
            matched.add("email:" + phrase)
    for phrase, weight in LOCALPART_PHRASES["handicap"].items():
        compact = re.sub(r"[^a-z0-9]", "", phrase)
        if phrase in local or compact in local_compact:
            hcp += weight
            matched.add("email:" + phrase)

    return mgr, hcp, matched


def likely_role(manager_score: int, handicap_score: int) -> Tuple[str, int]:
    if manager_score == 0 and handicap_score == 0:
        return "other/public club contact", 0
    if handicap_score > manager_score:
        return "handicap/competitions", handicap_score
    if manager_score > handicap_score:
        return "club manager/secretary", manager_score
    return "manager or handicap", manager_score


def is_northern_ireland_text(text: str) -> bool:
    t = clean_space(text).lower()
    if BT_POSTCODE_RE.search(text or ""):
        return True
    if any(c in t for c in UK_NI_COUNTIES):
        # avoid a loose "Ulster" test; three Ulster counties are in the Republic.
        if not any(c in t for c in ROI_BORDER_COUNTIES):
            return True
    return False


def plausible_detail_link(url: str, text: str, config: dict) -> bool:
    if not url or url.startswith(("mailto:", "tel:", "javascript:", "#")):
        return False
    h = base_domainish(host_of(url))
    if h != base_domainish(config["host"]):
        return False

    t = clean_space(text).lower()
    p = urlparse(url).path.lower()

    # Strong textual signals first.
    if config["nation"] in ("Scotland", "Wales") and "view details" in t:
        return True
    if config["nation"] == "Northern Ireland" and "view club" in t:
        return True

    # URL patterns used by club/facility detail pages. This is intentionally
    # permissive, then filtered later against nav / finder URLs.
    signal = any(x in p for x in (
        "club-detail", "clubdetails", "club-details", "facility-detail",
        "facilitydetails", "facility-details", "/club/", "/facility/",
        "find-and-play/club", "find-a-facility/"
    ))
    bad = p.rstrip("/") in (
        "/find-a-facility", "/find-and-play", "/find-a-club",
        "/club", "/facility"
    )
    return signal and not bad


def click_initial_search(page) -> None:
    # Some finders auto-load; some need Search / Apply.
    for label in ("Search", "Apply"):
        try:
            loc = page.get_by_role("button", name=re.compile(rf"^{label}$", re.I))
            if loc.count():
                for i in range(min(loc.count(), 3)):
                    if loc.nth(i).is_visible():
                        loc.nth(i).click(timeout=2500)
                        page.wait_for_timeout(1800)
                        return
        except Exception:
            pass


def click_next(page) -> bool:
    candidates = [
        page.get_by_role("button", name=re.compile(r"^next$", re.I)),
        page.get_by_role("link", name=re.compile(r"^next$", re.I)),
        page.locator("text=Next"),
    ]
    for loc in candidates:
        try:
            count = min(loc.count(), 5)
            for i in range(count):
                el = loc.nth(i)
                if not el.is_visible():
                    continue
                disabled = el.get_attribute("disabled")
                aria_disabled = el.get_attribute("aria-disabled")
                cls = (el.get_attribute("class") or "").lower()
                if disabled is not None or aria_disabled == "true" or "disabled" in cls:
                    continue
                el.click(timeout=3000)
                page.wait_for_timeout(1600)
                return True
        except Exception:
            continue
    return False


def extract_anchor_rows(page) -> List[Tuple[str, str]]:
    try:
        rows = page.locator("a").evaluate_all(
            """els => els.map(a => ({
                href: a.href || '',
                text: (a.innerText || a.textContent || '').trim()
            }))"""
        )
        return [(r.get("href", ""), r.get("text", "")) for r in rows]
    except Exception:
        return []


def discover_detail_links(page, config: dict, max_pages: int = 120) -> Dict[str, str]:
    links: Dict[str, str] = {}
    seen_page_signatures: Set[str] = set()

    click_initial_search(page)

    for page_num in range(1, max_pages + 1):
        page.wait_for_timeout(1000)
        rows = extract_anchor_rows(page)
        for href, text in rows:
            href = canonicalize_url(href)
            if plausible_detail_link(href, text, config):
                links.setdefault(href, clean_space(text))

        # Result cards occasionally have a button with onclick/navigation.
        try:
            for phrase in ("View Details", "View Club"):
                els = page.get_by_text(re.compile(rf"^{re.escape(phrase)}$", re.I))
                for i in range(min(els.count(), 200)):
                    el = els.nth(i)
                    if not el.is_visible():
                        continue
                    try:
                        href = el.get_attribute("href") or ""
                        if not href:
                            href = el.evaluate(
                                """e => {
                                  let a = e.closest('a') || e.querySelector('a');
                                  return a ? a.href : '';
                                }"""
                            )
                        href = canonicalize_url(href)
                        if href and plausible_detail_link(href, phrase, config):
                            links.setdefault(href, phrase)
                    except Exception:
                        pass
        except Exception:
            pass

        try:
            body = clean_space(page.locator("body").inner_text(timeout=3000))
        except Exception:
            body = ""
        sig = body[-2500:] if body else f"page-{page_num}-{len(links)}"
        if sig in seen_page_signatures:
            break
        seen_page_signatures.add(sig)

        before = len(links)
        if not click_next(page):
            break

        # If a finder ignores Next, repeated signature catches it next round.
        log(f"    directory page {page_num}: {len(links)} detail links")
        if page_num > 2 and len(links) == before and len(links) == 0:
            break

    return links


def external_website_candidates(page, governing_host: str) -> List[Tuple[int, str, str]]:
    out: List[Tuple[int, str, str]] = []
    for href, text in extract_anchor_rows(page):
        href = canonicalize_url(href)
        if not href:
            continue
        h = host_of(href)
        hb = base_domainish(h)
        if not hb or hb == base_domainish(governing_host):
            continue
        if any(bit in h for bit in SOCIAL_HOST_BITS):
            continue
        if any(bit in h for bit in BOOKING_HOST_BITS):
            continue
        if h in ("google.com", "www.google.com", "maps.google.com"):
            continue

        score = 0
        t = clean_space(text).lower()
        if "website" in t or "visit website" in t:
            score += 50
        if "club website" in t:
            score += 70
        if "home" == t:
            score += 5
        if "golf" in h:
            score += 12
        if ".gov." in h or ".ac." in h:
            score -= 50
        out.append((score, href, text))

    out.sort(key=lambda x: (-x[0], len(x[1])))
    return out


def parse_detail_page(page, nation: str, detail_url: str, anchor_text: str, config: dict) -> Club:
    try:
        page.goto(detail_url, wait_until="domcontentloaded", timeout=35000)
        page.wait_for_timeout(1200)
    except Exception:
        pass

    try:
        body = clean_space(page.locator("body").inner_text(timeout=5000))
    except Exception:
        body = ""

    name = ""
    for selector in ("h1", "h2", ".club-name", ".facility-name"):
        try:
            loc = page.locator(selector)
            if loc.count():
                val = clean_space(loc.first.inner_text(timeout=1500))
                if val and len(val) < 180:
                    name = val
                    break
        except Exception:
            pass

    if not name:
        # "View Details" is not a club name, but other finders may use the club
        # name as the clickable anchor.
        candidate = clean_space(anchor_text)
        if candidate.lower() not in ("view details", "view club", "view"):
            name = candidate

    if not name:
        try:
            title = clean_space(page.title())
            name = re.split(r"\s+[|\-–]\s+", title)[0][:160]
        except Exception:
            name = detail_url

    website = ""
    candidates = external_website_candidates(page, config["host"])
    if candidates:
        website = candidates[0][1]

    # Directory-published email is retained as a useful seed/evidence field.
    dir_email = ""
    for m in EMAIL_RE.finditer(body):
        e = clean_email(m.group(1))
        if valid_email(e) and not e.endswith("@golfireland.ie") \
                and not e.endswith("@scottishgolf.org") \
                and not e.endswith("@walesgolf.org") \
                and not e.endswith("@englandgolf.org"):
            dir_email = e
            break

    return Club(
        name=clean_space(name),
        nation=nation,
        directory_url=config["url"],
        detail_url=detail_url,
        website=canonicalize_url(website) if website else "",
        domain=base_domainish(host_of(website)) if website else "",
        address_text=body[:2500],
        directory_email=dir_email,
        discovery_notes="Playwright rendered governing-body directory"
    )


def discover_nation(browser, config: dict, max_directory_pages: int) -> List[Club]:
    nation = config["nation"]
    log(f"[DISCOVER] {nation}: {config['url']}")
    page = browser.new_page(user_agent=USER_AGENT)
    page.set_default_timeout(7000)

    try:
        page.goto(config["url"], wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(2500)
    except Exception as exc:
        log(f"  warning: initial load issue: {exc}")

    links = discover_detail_links(page, config, max_pages=max_directory_pages)
    log(f"  found {len(links)} candidate club detail links")

    clubs: List[Club] = []
    for idx, (detail_url, anchor_text) in enumerate(links.items(), 1):
        if idx == 1 or idx % 25 == 0:
            log(f"  reading club details {idx}/{len(links)}")
        club = parse_detail_page(page, nation, detail_url, anchor_text, config)

        if nation == "Northern Ireland":
            # Golf Ireland covers the whole island. Keep only UK/NI clubs.
            if not is_northern_ireland_text(club.address_text):
                continue

        if club.name:
            clubs.append(club)

    page.close()
    return clubs


def dedupe_clubs(clubs: List[Club]) -> List[Club]:
    by_key: Dict[str, Club] = {}
    for club in clubs:
        if club.domain:
            key = f"{club.nation.lower()}|domain:{club.domain}"
        else:
            key = f"{club.nation.lower()}|name:{re.sub(r'[^a-z0-9]', '', club.name.lower())}"
        old = by_key.get(key)
        if old is None:
            by_key[key] = club
        else:
            # Prefer whichever record has more useful fields.
            if not old.website and club.website:
                old.website = club.website
                old.domain = club.domain
            if not old.detail_url and club.detail_url:
                old.detail_url = club.detail_url
            if not old.directory_email and club.directory_email:
                old.directory_email = club.directory_email
            if len(club.address_text) > len(old.address_text):
                old.address_text = club.address_text
    return sorted(by_key.values(), key=lambda c: (c.nation, c.name.lower()))


def save_clubs(clubs: List[Club], path: str) -> None:
    fields = [
        "club", "nation", "website", "domain", "detail_url",
        "directory_url", "directory_email", "address_text", "discovery_notes"
    ]
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for c in clubs:
            w.writerow({
                "club": c.name,
                "nation": c.nation,
                "website": c.website,
                "domain": c.domain,
                "detail_url": c.detail_url,
                "directory_url": c.directory_url,
                "directory_email": c.directory_email,
                "address_text": c.address_text,
                "discovery_notes": c.discovery_notes,
            })


def load_clubs(path: str) -> List[Club]:
    clubs = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            clubs.append(Club(
                name=r.get("club", "").strip(),
                nation=r.get("nation", "").strip(),
                directory_url=r.get("directory_url", "").strip(),
                detail_url=r.get("detail_url", "").strip(),
                website=r.get("website", "").strip(),
                domain=r.get("domain", "").strip() or base_domainish(host_of(r.get("website", ""))),
                address_text=r.get("address_text", "").strip(),
                directory_email=r.get("directory_email", "").strip(),
                discovery_notes=r.get("discovery_notes", "").strip(),
            ))
    return clubs


def make_robot_parser(session: requests.Session, website: str) -> Optional[RobotFileParser]:
    try:
        p = urlparse(website)
        robots_url = f"{p.scheme}://{p.netloc}/robots.txt"
        r = session.get(robots_url, timeout=10)
        if r.status_code >= 400:
            return None
        rp = RobotFileParser()
        rp.set_url(robots_url)
        rp.parse(r.text.splitlines())
        return rp
    except Exception:
        return None


def extract_emails_from_html(raw: str, soup: BeautifulSoup) -> Dict[str, Tuple[str, str]]:
    found: Dict[str, Tuple[str, str]] = {}
    page_text = clean_space(soup.get_text(" ", strip=True))

    # mailto:
    for a in soup.find_all("a", href=True):
        href = html.unescape(a.get("href", "")).strip()
        if href.lower().startswith("mailto:"):
            part = href[7:].split("?", 1)[0]
            for piece in re.split(r"[,;]", part):
                addr = clean_email(piece)
                if valid_email(addr):
                    ctx = clean_space(
                        a.parent.get_text(" ", strip=True) if a.parent else page_text
                    )
                    found[addr] = ("mailto", evidence_around(ctx, addr))

    # Visible text and raw HTML.
    for text, source_type in ((page_text, "visible_text"), (raw, "html")):
        for m in EMAIL_RE.finditer(text):
            addr = clean_email(m.group(1))
            if valid_email(addr):
                found.setdefault(
                    addr,
                    (source_type, evidence_around(page_text, addr))
                )

    # [at] / [dot]
    for m in OBFUSCATED_RE.finditer(page_text):
        addr = clean_email(f"{m.group(1)}@{m.group(2)}.{m.group(3)}")
        if valid_email(addr):
            found.setdefault(
                addr,
                ("obfuscated_text", evidence_around(page_text, m.group(1)))
            )

    # Cloudflare data-cfemail.
    for el in soup.select("[data-cfemail]"):
        addr = decode_cf_email(el.get("data-cfemail", ""))
        if addr:
            ctx = clean_space(
                el.parent.get_text(" ", strip=True) if el.parent else page_text
            )
            found.setdefault(
                addr,
                ("cloudflare", evidence_around(ctx, addr.split("@")[0]))
            )

    return found


def internal_links(soup: BeautifulSoup, base_url: str, club_domain: str) -> List[str]:
    scored: List[Tuple[int, str]] = []
    for a in soup.find_all("a", href=True):
        href = html.unescape(a.get("href", "")).strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        u = canonicalize_url(urljoin(base_url, href))
        if not u or not same_site(u, club_domain):
            continue
        p = urlparse(u)
        if p.path.lower().endswith(ASSET_EXTENSIONS):
            continue
        combined = (p.path + " " + clean_space(a.get_text(" ", strip=True))).lower()
        score = sum(4 for hint in CONTACT_HINTS if hint in combined)
        scored.append((score, u))

    scored.sort(key=lambda x: (-x[0], len(x[1])))
    out = []
    seen = set()
    for _, u in scored:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def crawl_club(club: Club, max_pages: int, delay: float, respect_robots: bool) -> List[Contact]:
    if not club.website or not club.domain:
        return []

    website = canonicalize_url(club.website)
    if not website:
        return []

    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
    })

    robot = make_robot_parser(session, website) if respect_robots else None
    seeds = [website]
    for path in CONTACT_PATH_SEEDS:
        seeds.append(urljoin(website.rstrip("/") + "/", path.lstrip("/")))

    queue = deque((u, 0) for u in seeds)
    visited: Set[str] = set()
    contacts: Dict[str, Contact] = {}
    last_request = 0.0

    while queue and len(visited) < max_pages:
        url, depth = queue.popleft()
        url, _ = urldefrag(url)
        url = canonicalize_url(url)

        if not url or url in visited or not same_site(url, club.domain):
            continue
        if depth > 4:
            continue
        if robot and not robot.can_fetch(USER_AGENT, url):
            continue

        visited.add(url)

        wait = delay - (time.time() - last_request)
        if wait > 0:
            time.sleep(wait)
        last_request = time.time()

        try:
            r = session.get(url, timeout=14, allow_redirects=True)
            if r.status_code >= 400:
                continue
            if not same_site(r.url, club.domain):
                continue
            ctype = (r.headers.get("Content-Type") or "").lower()
            if "text/html" not in ctype and "application/xhtml+xml" not in ctype:
                continue
        except requests.RequestException:
            continue

        soup = BeautifulSoup(r.text, "html.parser")
        page_text = clean_space(soup.get_text(" ", strip=True))
        emails = extract_emails_from_html(r.text, soup)

        for addr, (source_type, local_evidence) in emails.items():
            mgr, hcp, matched = score_role(
                local_evidence + " " + page_text[:1800],
                addr
            )
            role, role_score = likely_role(mgr, hcp)
            email_host = base_domainish(addr.rsplit("@", 1)[-1])

            old = contacts.get(addr)
            if old is None:
                old = Contact(
                    club=club.name,
                    nation=club.nation,
                    website=website,
                    club_domain=club.domain,
                    email=addr,
                    role=role,
                    role_score=role_score,
                    manager_score=mgr,
                    handicap_score=hcp,
                    email_domain_matches_club=(
                        email_host == club.domain or email_host.endswith("." + club.domain)
                    ),
                )
                contacts[addr] = old
            else:
                old.manager_score = max(old.manager_score, mgr)
                old.handicap_score = max(old.handicap_score, hcp)
                old.role, old.role_score = likely_role(
                    old.manager_score, old.handicap_score
                )

            old.matched_keywords.update(matched)
            old.source_urls.add(r.url)
            old.source_types.add(source_type)
            if local_evidence and local_evidence not in old.evidence:
                old.evidence.append(local_evidence[:600])

        if depth < 4:
            for link in internal_links(soup, r.url, club.domain):
                if link not in visited:
                    queue.append((link, depth + 1))

    # If the governing directory published an address, include it as a record
    # too. It may be the only public contact for a club whose own site blocks us.
    if club.directory_email and valid_email(club.directory_email):
        addr = clean_email(club.directory_email)
        mgr, hcp, matched = score_role(club.address_text, addr)
        role, score = likely_role(mgr, hcp)
        if addr not in contacts:
            contacts[addr] = Contact(
                club=club.name,
                nation=club.nation,
                website=website,
                club_domain=club.domain,
                email=addr,
                role=role,
                role_score=score,
                manager_score=mgr,
                handicap_score=hcp,
                matched_keywords=matched,
                source_urls={club.detail_url} if club.detail_url else {club.directory_url},
                source_types={"governing_body_directory"},
                email_domain_matches_club=same_site("https://" + addr.rsplit("@", 1)[-1], club.domain),
            )

    return list(contacts.values())


def save_contacts(contacts: List[Contact], path: str) -> None:
    fields = [
        "club", "nation", "website", "club_domain",
        "email", "likely_role", "role_score",
        "manager_score", "handicap_score",
        "matched_keywords", "is_role_address",
        "email_domain_matches_club",
        "source_url", "source_type", "evidence",
        "first_seen_utc"
    ]

    def sort_key(c: Contact):
        role_rank = {
            "handicap/competitions": 0,
            "club manager/secretary": 1,
            "manager or handicap": 2,
            "other/public club contact": 3,
        }.get(c.role, 9)
        return (c.nation, c.club.lower(), role_rank, -c.role_score, c.email)

    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for c in sorted(contacts, key=sort_key):
            w.writerow({
                "club": c.club,
                "nation": c.nation,
                "website": c.website,
                "club_domain": c.club_domain,
                "email": c.email,
                "likely_role": c.role,
                "role_score": c.role_score,
                "manager_score": c.manager_score,
                "handicap_score": c.handicap_score,
                "matched_keywords": " | ".join(sorted(c.matched_keywords)),
                "is_role_address": "yes" if role_address(c.email) else "no",
                "email_domain_matches_club": "yes" if c.email_domain_matches_club else "no",
                "source_url": " | ".join(sorted(c.source_urls)),
                "source_type": " | ".join(sorted(c.source_types)),
                "evidence": " || ".join(c.evidence[:6]),
                "first_seen_utc": c.first_seen_utc,
            })


def discovery_report(clubs: List[Club]) -> str:
    nations = {}
    with_sites = {}
    for c in clubs:
        nations[c.nation] = nations.get(c.nation, 0) + 1
        if c.website:
            with_sites[c.nation] = with_sites.get(c.nation, 0) + 1
    parts = []
    for nation in ("England", "Scotland", "Wales", "Northern Ireland"):
        parts.append(
            f"{nation}: {nations.get(nation, 0)} clubs, "
            f"{with_sites.get(nation, 0)} with websites"
        )
    return "; ".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Discover UK golf clubs and harvest publicly listed club contact emails."
    )
    ap.add_argument(
        "-o", "--output",
        default="golf_club_contacts.csv",
        help="Contact CSV output (default: golf_club_contacts.csv)"
    )
    ap.add_argument(
        "--clubs-output",
        default="discovered_clubs.csv",
        help="Discovered clubs cache/output"
    )
    ap.add_argument(
        "--reuse-clubs",
        default="",
        help="Skip directory discovery and reuse a previously generated discovered_clubs.csv"
    )
    ap.add_argument(
        "--workers", type=int, default=6,
        help="Parallel club-site crawls (default: 6)"
    )
    ap.add_argument(
        "--max-pages-per-site", type=int, default=70,
        help="Maximum HTML pages crawled per club site (default: 70)"
    )
    ap.add_argument(
        "--max-directory-pages", type=int, default=120,
        help="Safety limit for finder pagination per governing body"
    )
    ap.add_argument(
        "--delay", type=float, default=0.45,
        help="Minimum delay between requests within one club crawl"
    )
    ap.add_argument(
        "--headful", action="store_true",
        help="Show Chromium during club discovery (useful for debugging)"
    )
    ap.add_argument(
        "--ignore-robots", action="store_true",
        help="Ignore robots.txt for club-site crawl (default: respect it)"
    )
    ap.add_argument(
        "--nation",
        choices=["all", "england", "scotland", "wales", "northern-ireland"],
        default="all",
        help="Limit discovery/crawl to one nation"
    )
    args = ap.parse_args()

    if args.reuse_clubs:
        clubs = load_clubs(args.reuse_clubs)
        log(f"[CACHE] loaded {len(clubs)} clubs from {args.reuse_clubs}")
    else:
        if sync_playwright is None:
            log("ERROR: Playwright is not installed.")
            log("Run: python -m pip install playwright")
            log("Then: python -m playwright install chromium")
            return 2

        wanted = {
            "england": "England",
            "scotland": "Scotland",
            "wales": "Wales",
            "northern-ireland": "Northern Ireland",
        }.get(args.nation)

        clubs = []
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headful)
            try:
                for config in DIRECTORIES:
                    if wanted and config["nation"] != wanted:
                        continue
                    try:
                        clubs.extend(discover_nation(
                            browser, config, args.max_directory_pages
                        ))
                    except Exception as exc:
                        log(f"[ERROR] {config['nation']} discovery failed: {exc}")
            finally:
                browser.close()

        clubs = dedupe_clubs(clubs)
        save_clubs(clubs, args.clubs_output)
        log(f"[DISCOVERED] {len(clubs)} clubs")
        log("[DISCOVERED] " + discovery_report(clubs))
        log(f"[WROTE] {args.clubs_output}")

    if args.nation != "all":
        wanted = {
            "england": "England",
            "scotland": "Scotland",
            "wales": "Wales",
            "northern-ireland": "Northern Ireland",
        }[args.nation]
        clubs = [c for c in clubs if c.nation == wanted]

    crawlable = [c for c in clubs if c.website and c.domain]
    missing_site = len(clubs) - len(crawlable)
    log(f"[CRAWL] {len(crawlable)} club websites; {missing_site} clubs have no resolved website")

    all_contacts: List[Contact] = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futures = {
            ex.submit(
                crawl_club,
                club,
                args.max_pages_per_site,
                args.delay,
                not args.ignore_robots,
            ): club
            for club in crawlable
        }

        done = 0
        total = len(futures)
        for fut in as_completed(futures):
            club = futures[fut]
            done += 1
            try:
                contacts = fut.result()
                all_contacts.extend(contacts)
                log(
                    f"[{done}/{total}] {club.name}: "
                    f"{len(contacts)} public email(s)"
                )
            except Exception as exc:
                log(f"[{done}/{total}] {club.name}: ERROR {exc}")

    save_contacts(all_contacts, args.output)
    log(f"[WROTE] {len(all_contacts)} email records to {args.output}")

    role_count = sum(
        1 for c in all_contacts
        if c.role in ("handicap/competitions", "club manager/secretary", "manager or handicap")
    )
    log(f"[DONE] {role_count} records scored as manager/secretary or handicap/competitions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
