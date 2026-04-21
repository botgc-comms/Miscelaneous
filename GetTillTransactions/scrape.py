import logging;
import os;
import re;
import time;
import json;
import threading;
from dataclasses import dataclass, field;
from datetime import date, datetime, timedelta;
from typing import Dict, Iterable, List, Tuple, Optional;
from concurrent.futures import ThreadPoolExecutor, as_completed;

import requests;
from requests.cookies import RequestsCookieJar;
from bs4 import BeautifulSoup;

from settings import (
    MEMBER_ID,
    MEMBER_PIN,
    ADMIN_PASSWORD,
    VERIFY_TLS,
    MAX_TX_WORKERS,
    CONNECT_TIMEOUT_SECONDS,
    READ_TIMEOUT_SECONDS,
    OUTPUT_DIR,
    PROGRESS_INTERVAL_SECONDS,
);


BASE_URL = "https://www.botgc.co.uk";
LOGIN_URL = f"{BASE_URL}/login.php";
ADMIN_URL = f"{BASE_URL}/membership2.php";

LIST_URL = f"{BASE_URL}/tillreports.php?tab=transactions&requestType=ajax&ajaxaction=updatedata";
DETAIL_URL_TEMPLATE = f"{BASE_URL}/tillreports.php?tab=transactions&fromDate={{from_date}}&toDate={{to_date}}&requestType=ajax&ajaxaction=getTransactionItems";

DEFAULT_HEADERS = {
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
    "Origin": BASE_URL,
    "Accept-Language": "en-GB,en;q=0.9",
};

AJAX_HEADERS = {
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "*/*",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
};

shutdown_event = threading.Event();


class AuthError(RuntimeError):
    pass;


class RequestError(RuntimeError):
    pass;


def ensure_output_dir() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True);


def ddmmyyyy(d: date) -> str:
    return f"{d.day:02d}/{d.month:02d}/{d.year:04d}";


def yyyymmdd(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}-{d.day:02d}";


def compact(d: date) -> str:
    return f"{d.year:04d}{d.month:02d}{d.day:02d}";


def is_login_page(html: str) -> bool:
    soup = BeautifulSoup(html, "html.parser");
    if soup.find("input", {"name": "memberid"}) is not None:
        return True;
    if soup.find("input", {"name": "pin"}) is not None:
        return True;
    title = (soup.title.text.strip().lower() if soup.title and soup.title.text else "");
    return "login" in title;


def new_session() -> requests.Session:
    s = requests.Session();
    s.headers.update(DEFAULT_HEADERS);
    return s;


def login_and_get_cookies() -> RequestsCookieJar:
    s = new_session();

    payload = {
        "task": "login",
        "topmenu": "1",
        "memberid": MEMBER_ID,
        "pin": MEMBER_PIN,
        "cachemid": "1",
        "Submit": "Login",
    };

    resp = s.post(
        LOGIN_URL,
        data=payload,
        timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
        verify=VERIFY_TLS,
    );

    if resp.status_code >= 400:
        raise AuthError(f"Member login failed: HTTP {resp.status_code}");
    if is_login_page(resp.text):
        raise AuthError("Member login appears to have failed (still on login page).");

    resp2 = s.post(
        ADMIN_URL,
        data={"leveltwopassword": ADMIN_PASSWORD},
        timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
        verify=VERIFY_TLS,
    );

    if resp2.status_code >= 400:
        raise AuthError(f"Admin elevation failed: HTTP {resp2.status_code}");

    jar = RequestsCookieJar();
    jar.update(s.cookies);
    return jar;


def session_with_cookies(cookies: RequestsCookieJar) -> requests.Session:
    s = new_session();
    s.cookies.update(cookies);
    return s;


def post_with_retries(session: requests.Session, url: str, form: Dict[str, str], label: str, extra_headers: Optional[Dict[str, str]] = None) -> requests.Response:
    headers = dict(AJAX_HEADERS);
    if extra_headers:
        headers.update(extra_headers);

    last_exc: Optional[Exception] = None;

    for attempt in range(1, 6):
        if shutdown_event.is_set():
            raise RequestError(f"[{label}] Aborted");

        try:
            resp = session.post(
                url,
                headers=headers,
                data=form,
                timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
                verify=VERIFY_TLS,
            );

            if resp.status_code in (429, 502, 503, 504):
                retry_after = resp.headers.get("Retry-After");
                sleep_for = float(retry_after) if retry_after and retry_after.isdigit() else float(min(2 ** (attempt - 1), 30));
                logging.warning("[%s] HTTP %d; retrying after %.1fs (attempt=%d)", label, resp.status_code, sleep_for, attempt);
                time.sleep(sleep_for);
                continue;

            return resp;
        except Exception as ex:
            last_exc = ex;
            sleep_for = float(min(2 ** (attempt - 1), 30));
            logging.warning("[%s] Exception; retrying after %.1fs (attempt=%d) %s", label, sleep_for, attempt, str(ex));
            time.sleep(sleep_for);

    raise RequestError(f"[{label}] Failed after retries: {last_exc}");


def build_list_form(from_d: date, to_d: date) -> Dict[str, str]:
    report_range = f"{from_d.day:02d}_{from_d.month:02d}_{from_d.year:04d}-{to_d.day:02d}_{to_d.month:02d}_{to_d.year:04d}";
    reportname = f"Till Transactions: {report_range}";
    pdftitle = f"Till Transactions {date.today().isoformat()} {datetime.now().strftime('%H:%M')}";

    return {
        "rangetype": "CU",
        "datefrom": ddmmyyyy(from_d),
        "timefrom": "00:00",
        "dateto": ddmmyyyy(to_d),
        "timeto": "23:59",
        "till_config_id": "0",
        "zread": "4768",
        "includesales": "1",
        "includerefund": "0",
        "includevoided": "0",
        "includetopup": "0",
        "includeevents": "0",
        "till[]": "0",
        "operator": "0",
        "paymentMethod": "0",
        "reportname": reportname,
        "pdftitle": pdftitle,
        "layout3": "1",
        "undefined": "",
    };


def build_detail_form(from_d: date, to_d: date, transaction_id: str) -> Dict[str, str]:
    report_range = f"{from_d.day:02d}_{from_d.month:02d}_{from_d.year:04d}-{to_d.day:02d}_{to_d.month:02d}_{to_d.year:04d}";
    reportname = f"Till Transactions: {report_range}";
    pdftitle = f"Till Transactions {date.today().isoformat()} {datetime.now().strftime('%H:%M')}";

    return {
        "rangetype": "CU",
        "datefrom": ddmmyyyy(from_d),
        "timefrom": "00:00",
        "dateto": ddmmyyyy(to_d),
        "timeto": "23:59",
        "till_config_id": "0",
        "zread": "4768",
        "includesales": "1",
        "includerefund": "0",
        "includevoided": "0",
        "includetopup": "0",
        "includeevents": "0",
        "till[]": "0",
        "operator": "0",
        "paymentMethod": "0",
        "reportname": reportname,
        "pdftitle": pdftitle,
        "layout3": "1",
        "transaction_id": str(transaction_id),
        "undefined": "",
    };


def extract_transaction_ids(html: str) -> List[str]:
    ids: List[str] = [];
    ids.extend(re.findall(r"id\s*=\s*['\"]transactionItemRow([0-9]+)['\"]", html, flags=re.IGNORECASE));
    ids = [x.strip() for x in ids if x and x.strip().isdigit()];
    return list(dict.fromkeys(ids));


def parse_replace_actions(content: bytes, label: str) -> List[Tuple[str, str]]:
    try:
        payload = json.loads(content.decode("utf-8"));
    except Exception as ex:
        raise RequestError(f"[{label}] Response not valid JSON: {str(ex)}");

    actions = payload.get("actions");
    if not isinstance(actions, list):
        raise RequestError(f"[{label}] Missing actions[]");

    out: List[Tuple[str, str]] = [];

    for action in actions:
        if not isinstance(action, dict):
            continue;
        if action.get("type") != "replacecontent":
            continue;
        selector = action.get("selector");
        html = action.get("html");
        if selector and html:
            out.append((str(selector), str(html)));

    if not out:
        raise RequestError(f"[{label}] No replacecontent actions found");

    return out;


def extract_report_fragment_from_actions(actions: List[Tuple[str, str]], label: str) -> str:
    candidates: List[Tuple[int, str]] = [];
    for selector, html in actions:
        if not html:
            continue;
        score = 0;
        if "reporttablecustom" in html:
            score += 100;
        if "<table" in html:
            score += 10;
        if "Till Transactions" in html:
            score += 5;
        candidates.append((score, html));

    if not candidates:
        raise RequestError(f"[{label}] No HTML fragments in actions");

    candidates.sort(key=lambda x: x[0], reverse=True);
    return candidates[0][1];


def fetch_list_table_fragment(session: requests.Session, from_d: date, to_d: date, label: str) -> BeautifulSoup:
    list_form = build_list_form(from_d, to_d);
    list_resp = post_with_retries(
        session,
        LIST_URL,
        list_form,
        label,
        extra_headers={"Referer": f"{BASE_URL}/tillreports.php?tab=transactions"},
    );

    if list_resp.status_code >= 400:
        raise RequestError(f"[{label}] List failed HTTP {list_resp.status_code}");
    if is_login_page(list_resp.text):
        raise RequestError(f"[{label}] List returned login page");

    actions = parse_replace_actions(list_resp.content, label);
    fragment_html = extract_report_fragment_from_actions(actions, label);

    return BeautifulSoup(fragment_html, "html.parser");


def apply_row_expansion(dom: BeautifulSoup, transaction_id: str, html_fragment: str) -> None:
    target = dom.find("tr", {"id": f"transactionItemRow{transaction_id}"});
    if target is None:
        return;

    target["style"] = "display: table-row;";
    classes = target.get("class") or [];
    if "ig-unfolded" not in classes:
        target["class"] = list(classes) + ["ig-unfolded"];

    target.clear();
    fragment_dom = BeautifulSoup(html_fragment, "html.parser");
    for node in list(fragment_dom.contents):
        target.append(node);


@dataclass
class Progress:
    label: str;
    tx_total: int = 0;
    tx_done: int = 0;
    started_at: float = 0.0;
    lock: threading.Lock = field(default_factory=threading.Lock);

    def start(self) -> None:
        with self.lock:
            self.started_at = time.time();

    def set_total(self, total: int) -> None:
        with self.lock:
            self.tx_total = total;

    def add_done(self, n: int = 1) -> None:
        with self.lock:
            self.tx_done += n;

    def snapshot(self) -> str:
        with self.lock:
            elapsed = time.time() - self.started_at if self.started_at else 0.0;
            return f"[{self.label}] tx {self.tx_done}/{self.tx_total} elapsed {elapsed:.0f}s";


def week_filename(from_d: date, to_d: date) -> str:
    ensure_output_dir();
    return os.path.join(OUTPUT_DIR, f"{compact(from_d)}-{compact(to_d)}.html");


def week_start_monday(d: date) -> date:
    return d - timedelta(days=d.weekday());


def iter_weeks_monday_to_sunday(start_inclusive: date, end_inclusive: date) -> Iterable[Tuple[date, date]]:
    cur = week_start_monday(start_inclusive);
    while cur <= end_inclusive:
        w_start = cur;
        w_end = cur + timedelta(days=6);
        yield (max(w_start, start_inclusive), min(w_end, end_inclusive));
        cur = cur + timedelta(days=7);


def last_day_previous_month(d: date) -> date:
    first_of_month = date(d.year, d.month, 1);
    return first_of_month - timedelta(days=1);


def add_years_safe(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years);
    except ValueError:
        if d.month == 2 and d.day == 29:
            return date(d.year + years, 2, 28);
        raise;


def fetch_week(from_d: date, to_d: date, cookies: RequestsCookieJar) -> str:
    out_path = week_filename(from_d, to_d);
    if os.path.exists(out_path):
        return out_path;

    week_label = f"{from_d.isoformat()}..{to_d.isoformat()}";
    prog = Progress(label=f"{week_label}");
    prog.start();

    stop = threading.Event();

    def printer() -> None:
        while not stop.is_set():
            logging.info(prog.snapshot());
            time.sleep(float(PROGRESS_INTERVAL_SECONDS));

    t = threading.Thread(target=printer, daemon=True);
    t.start();

    try:
        list_session = session_with_cookies(cookies);

        dom = fetch_list_table_fragment(
            list_session,
            from_d,
            to_d,
            f"{week_label}|list",
        );

        tx_ids = extract_transaction_ids(str(dom));
        prog.set_total(len(tx_ids));

        detail_url = DETAIL_URL_TEMPLATE.format(from_date=yyyymmdd(from_d), to_date=yyyymmdd(to_d));
        referer = f"{BASE_URL}/tillreports.php?tab=transactions&fromDate={yyyymmdd(from_d)}&toDate={yyyymmdd(to_d)}";

        def detail_worker(tx_id: str) -> Tuple[str, List[Tuple[str, str]]]:
            s = session_with_cookies(cookies);
            form = build_detail_form(from_d, to_d, tx_id);
            resp = post_with_retries(
                s,
                detail_url,
                form,
                f"{week_label}|detail",
                extra_headers={"Referer": referer},
            );
            if resp.status_code >= 400:
                raise RequestError(f"[{week_label}] Detail failed tx={tx_id} HTTP {resp.status_code}");
            actions = parse_replace_actions(resp.content, f"{week_label}|tx={tx_id}");
            return (tx_id, actions);

        results: List[Tuple[str, List[Tuple[str, str]]]] = [];

        with ThreadPoolExecutor(max_workers=MAX_TX_WORKERS) as executor:
            futures = {executor.submit(detail_worker, tx): tx for tx in tx_ids};

            for fut in as_completed(futures):
                if shutdown_event.is_set():
                    break;
                tx_id, actions = fut.result();
                results.append((tx_id, actions));
                prog.add_done(1);

        for tx_id, actions in results:
            for selector, html in actions:
                if selector.strip() == f"#transactionItemRow{tx_id}":
                    apply_row_expansion(dom, tx_id, html);

        compiled = (
            "<!doctype html><html><head><meta charset='utf-8'>"
            f"<title>Till Transactions {week_label}</title>"
            "</head><body>"
            f"<h1>Till Transactions {week_label}</h1>"
            + str(dom)
            + "</body></html>"
        );

        with open(out_path, "wb") as f:
            f.write(compiled.encode("utf-8"));

        logging.info("Saved %s", out_path);
        return out_path;
    finally:
        stop.set();
        t.join(timeout=2.0);


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s");

    if not VERIFY_TLS:
        import urllib3;
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning);

    ensure_output_dir();

    today = date.today();
    end_date = last_day_previous_month(today);
    start_date = add_years_safe(end_date, -3) + timedelta(days=1);

    logging.info("Logging in once...");
    cookies = login_and_get_cookies();
    logging.info("Login OK.");

    weeks = list(iter_weeks_monday_to_sunday(start_date, end_date));
    logging.info("Range: %s -> %s (weeks=%d)", start_date.isoformat(), end_date.isoformat(), len(weeks));

    todo = [(w_start, w_end) for (w_start, w_end) in weeks if not os.path.exists(week_filename(w_start, w_end))];
    logging.info("To do: %d (already have %d)", len(todo), len(weeks) - len(todo));

    completed = 0;
    total = len(todo);

    try:
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {executor.submit(fetch_week, w_start, w_end, cookies): (w_start, w_end) for (w_start, w_end) in todo};

            for fut in as_completed(futures):
                if shutdown_event.is_set():
                    return 1;

                w_start, w_end = futures[fut];

                try:
                    path = fut.result();
                    completed += 1;
                    logging.info("Progress %d/%d : %s..%s -> %s", completed, total, w_start.isoformat(), w_end.isoformat(), path);
                except Exception as ex:
                    shutdown_event.set();
                    logging.exception("FAILED on %s..%s : %s", w_start.isoformat(), w_end.isoformat(), str(ex));
                    return 1;

    except KeyboardInterrupt:
        shutdown_event.set();
        logging.warning("Interrupted; stopping.");
        return 1;

    logging.info("Done. Weeks processed this run: %d", completed);
    return 0;


if __name__ == "__main__":
    raise SystemExit(main());