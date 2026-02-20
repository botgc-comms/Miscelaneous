import argparse
import csv
import gzip
import re
import time
import xml.etree.ElementTree as ET
from collections import deque
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urljoin, urlparse, urlunparse, urldefrag

import requests
from bs4 import BeautifulSoup

try:
    from pypdf import PdfReader
except Exception:
    PdfReader = None


@dataclass
class Finding:
    url: str
    match_term: str
    match_snippet: str
    content_type: str


@dataclass
class FetchResult:
    ok: bool
    url: str
    status_code: Optional[int]
    content_type: str
    error: Optional[str]
    content: Optional[bytes]


def normalise_url(base: str, href: str) -> Optional[str]:
    if not href:
        return None

    href = href.strip()
    if href.startswith(("mailto:", "tel:", "javascript:", "#")):
        return None

    absolute = urljoin(base, href)
    absolute, _ = urldefrag(absolute)

    parsed = urlparse(absolute)
    if parsed.scheme not in ("http", "https"):
        return None

    path = parsed.path or "/"
    parsed = parsed._replace(path=path)
    return urlunparse(parsed)


def is_same_site(url: str, allowed_hosts: set[str]) -> bool:
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host in allowed_hosts


def looks_like_html(content_type: str) -> bool:
    ct = (content_type or "").lower()
    return "text/html" in ct or "application/xhtml+xml" in ct or ct.startswith("text/html")


def looks_like_pdf(url: str, content_type: str) -> bool:
    ct = (content_type or "").lower()
    if "application/pdf" in ct:
        return True
    return urlparse(url).path.lower().endswith(".pdf")


def clean_visible_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "template"]):
        tag.decompose()
    text = soup.get_text(separator=" ")
    return re.sub(r"\s+", " ", text).strip()


def build_patterns(terms: list[str]) -> list[tuple[str, re.Pattern]]:
    out: list[tuple[str, re.Pattern]] = []
    for t in terms:
        t = t.strip()
        if t:
            out.append((t, re.compile(re.escape(t), re.IGNORECASE)))
    return out


def find_terms_in_text(text: str, patterns: list[tuple[str, re.Pattern]], window: int = 140) -> list[tuple[str, str]]:
    hits: list[tuple[str, str]] = []
    for label, rx in patterns:
        m = rx.search(text)
        if not m:
            continue
        start = max(0, m.start() - window)
        end = min(len(text), m.end() + window)
        hits.append((label, text[start:end].strip()))
    return hits


def extract_links(html: str, base_url: str) -> set[str]:
    soup = BeautifulSoup(html, "html.parser")
    urls: set[str] = set()
    for a in soup.select("a[href]"):
        u = normalise_url(base_url, a.get("href", ""))
        if u:
            urls.add(u)
    return urls


def pdf_text_from_bytes(data: bytes) -> str:
    if PdfReader is None:
        raise RuntimeError("pypdf is not installed. Install with: pip install pypdf")

    from io import BytesIO
    reader = PdfReader(BytesIO(data))
    parts: list[str] = []
    for page in reader.pages:
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        if t:
            parts.append(t)
    return re.sub(r"\s+", " ", "\n".join(parts)).strip()


def fetch(session: requests.Session, url: str, timeout_s: float, verify_tls: bool) -> FetchResult:
    try:
        resp = session.get(url, timeout=timeout_s, allow_redirects=True, verify=verify_tls)
        ct = resp.headers.get("Content-Type", "") or ""
        if resp.status_code < 200 or resp.status_code >= 300:
            return FetchResult(False, resp.url, resp.status_code, ct, f"HTTP {resp.status_code}", None)
        return FetchResult(True, resp.url, resp.status_code, ct, None, resp.content)
    except Exception as ex:
        return FetchResult(False, url, None, "", str(ex), None)


def try_get_sitemap_urls(session: requests.Session, root: str, timeout_s: float, verify_tls: bool) -> list[str]:
    candidates = [
        urljoin(root, "/sitemap.xml"),
        urljoin(root, "/sitemap_index.xml"),
        urljoin(root, "/sitemap.xml.gz"),
    ]

    for sm in candidates:
        r = fetch(session, sm, timeout_s, verify_tls)
        if not r.ok or r.content is None:
            continue

        data = r.content
        if sm.endswith(".gz"):
            try:
                data = gzip.decompress(data)
            except Exception:
                continue

        try:
            xml = data.decode("utf-8", errors="ignore")
            root_el = ET.fromstring(xml)
        except Exception:
            continue

        ns = ""
        if root_el.tag.startswith("{"):
            ns = root_el.tag.split("}")[0] + "}"

        urls: list[str] = []

        if root_el.tag == f"{ns}sitemapindex":
            for loc in root_el.findall(f".//{ns}loc"):
                if not loc.text:
                    continue
                child = loc.text.strip()
                cr = fetch(session, child, timeout_s, verify_tls)
                if not cr.ok or cr.content is None:
                    continue
                try:
                    child_xml = cr.content.decode("utf-8", errors="ignore")
                    child_root = ET.fromstring(child_xml)
                    child_ns = ""
                    if child_root.tag.startswith("{"):
                        child_ns = child_root.tag.split("}")[0] + "}"
                    for cloc in child_root.findall(f".//{child_ns}loc"):
                        if cloc.text:
                            urls.append(cloc.text.strip())
                except Exception:
                    continue

        if root_el.tag == f"{ns}urlset":
            for loc in root_el.findall(f".//{ns}loc"):
                if loc.text:
                    urls.append(loc.text.strip())

        if urls:
            return list(dict.fromkeys(urls))

    return []


def crawl(
    start_url: str,
    terms: list[str],
    max_pages: int,
    delay_s: float,
    timeout_s: float,
    include_pdfs: bool,
    max_pdf_mb: int,
    stop_on_first: bool,
    verbose: bool,
    verify_tls: bool,
) -> tuple[list[Finding], set[str], dict[str, str]]:
    parsed = urlparse(start_url)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    allowed_hosts = {host, f"www.{host}"}

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
        }
    )

    patterns = build_patterns(terms)
    max_pdf_bytes = max_pdf_mb * 1024 * 1024

    queue: deque[str] = deque()
    visited: set[str] = set()
    errors: dict[str, str] = {}
    findings: list[Finding] = []

    root = f"{parsed.scheme}://{parsed.netloc}/"
    sitemap_urls = try_get_sitemap_urls(session, root, timeout_s, verify_tls)

    if sitemap_urls:
        for u in sitemap_urls:
            nu = normalise_url(root, u)
            if nu and is_same_site(nu, allowed_hosts):
                queue.append(nu)
    else:
        queue.append(start_url)

    while queue and len(visited) < max_pages:
        url = queue.popleft()
        if url in visited:
            continue
        if not is_same_site(url, allowed_hosts):
            continue

        visited.add(url)

        fr = fetch(session, url, timeout_s, verify_tls)
        if not fr.ok:
            errors[fr.url] = fr.error or "Unknown error"
            if verbose:
                sc = fr.status_code if fr.status_code is not None else "-"
                print(f"[ERR] {url} -> {fr.url} status={sc} reason={errors[fr.url]}")
            time.sleep(delay_s)
            continue

        final_url = fr.url
        content_type = fr.content_type
        content = fr.content or b""

        if include_pdfs and looks_like_pdf(final_url, content_type):
            if len(content) <= max_pdf_bytes:
                try:
                    text = pdf_text_from_bytes(content)
                    for term, snippet in find_terms_in_text(text, patterns):
                        findings.append(Finding(final_url, term, snippet, content_type or "application/pdf"))
                        if stop_on_first:
                            return findings, visited, errors
                except Exception as ex:
                    errors[final_url] = f"PDF parse error: {ex}"
                    if verbose:
                        print(f"[ERR] {final_url} PDF parse error: {ex}")
            else:
                errors[final_url] = f"PDF too large (> {max_pdf_mb}MB)"
            time.sleep(delay_s)
            continue

        if looks_like_html(content_type):
            html = content.decode("utf-8", errors="ignore")
            text = clean_visible_text(html)

            for term, snippet in find_terms_in_text(text, patterns):
                findings.append(Finding(final_url, term, snippet, content_type or "text/html"))
                if stop_on_first:
                    return findings, visited, errors

            for link in extract_links(html, final_url):
                if link not in visited and is_same_site(link, allowed_hosts):
                    queue.append(link)

        time.sleep(delay_s)

    return findings, visited, errors


def write_csv(findings: list[Finding], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["url", "match_term", "content_type", "snippet"])
        for x in findings:
            w.writerow([x.url, x.match_term, x.content_type, x.match_snippet])


def write_errors(errors: dict[str, str], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["url", "reason"])
        for url, reason in errors.items():
            w.writerow([url, reason])


def main() -> int:
    parser = argparse.ArgumentParser(description="Crawl botgc.co.uk and find references to specific terms.")
    parser.add_argument("--start", default="https://botgc.co.uk/", help="Start URL.")
    parser.add_argument("--term", action="append", default=["club manager", "phil joynes", "phil joyne", "joynes"])
    parser.add_argument("--max-pages", type=int, default=5000)
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--include-pdfs", action="store_true")
    parser.add_argument("--max-pdf-mb", type=int, default=20)
    parser.add_argument("--stop-on-first", action="store_true")
    parser.add_argument("--out", default="botgc_manager_references.csv")
    parser.add_argument("--errors-out", default="botgc_crawl_errors.csv")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="Disable TLS certificate verification (ONLY use if you trust the site).",
    )
    args = parser.parse_args()

    verify_tls = not args.insecure

    findings, visited, errors = crawl(
        start_url=args.start,
        terms=args.term,
        max_pages=args.max_pages,
        delay_s=args.delay,
        timeout_s=args.timeout,
        include_pdfs=args.include_pdfs,
        max_pdf_mb=args.max_pdf_mb,
        stop_on_first=args.stop_on_first,
        verbose=args.verbose,
        verify_tls=verify_tls,
    )

    write_csv(findings, args.out)
    write_errors(errors, args.errors_out)

    print(f"Visited: {len(visited)} pages")
    print(f"Findings: {len(findings)} matches")
    print(f"Errors: {len(errors)} pages")
    print(f"Output: {args.out}")
    print(f"Errors output: {args.errors_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
