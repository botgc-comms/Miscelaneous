# strategies.py
import re
from typing import Optional, Callable, List, Set, Tuple
from aliases import apply_aliases

# ---------- Tunables ----------
MIN_PREFIX_LEN = 3
MIN_MATCHED_TOKENS = 2
MIN_BIDI_COVERAGE = 0.66
MIN_DISTINCTIVE_LEN = 4

# ---------- Brand whitelist for brand-only matches ----------
BRAND_ONLY_WHITELIST: Set[str] = {
    "aspall","bass","bells","bowmore","carling","guinness","madri",
    "malibu","kraken","jamesons","famous","grouse","talisker","redbull","gordons",
}

# ---------- Normalisation helpers ----------
ABBR_MAP = [
    (re.compile(r"\b&\b", re.I), "and"),
    (re.compile(r"\bno\.?\s*([0-9]+)\b", re.I), r"no\1"),
    (re.compile(r"\bwhiskey\b", re.I), "whisky"),
]

STOP_TOKENS: Set[str] = {
    "gin","vodka","rum","whisky","whiskey","tequila","brandy","liqueur",
    "beer","lager","cider","ale","ipa","stout","wine","rose","rosé","prosecco","champagne",
    "tonic","water","juice","soda","cola","lemonade","mixer",
    "sparkling","bottle","dozen","pack","packs","doc","postmix","can",
    "year","yrs","yr","yo",
    "icon","gal","ltr","ml","cl",
    "malt","scotch",
    # extra generic descriptors to help brand-only reduce RHS to brand
    "spiced","original","special","dry",
}

_NUM_TOKEN_RE = re.compile(r"^\d{1,4}([a-z]*)?$", re.I)

FLAVOUR_TOKENS: Set[str] = {
    "apple","mango","raspberry","cherry","lemon","orange","blood","peach","rhubarb","gooseberry",
    "grape","grapefruit","blackcurrant","tropical","summer","citrus","passion","strawberry","lime",
    "elderflower","blush","kiwi",
    # softs families where flavour matters
    "mango","raspberry","passion","fruit","peach",
}

def norm_text(s: str) -> str:
    if not isinstance(s, str):
        return ""
    s = apply_aliases(s)
    for rx, repl in ABBR_MAP:
        s = rx.sub(repl, s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def base_name(s: str) -> str:
    s = norm_text(s)
    s = re.sub(r"\b(\d+)\s*pack\b", " ", s)
    s = re.sub(r"\b(\d+)\s*x\b", " ", s)
    s = re.sub(r"\b(\d+)\s*ml\b", " ", s)
    s = re.sub(r"\b(\d+)\s*l\b", " ", s)
    s = re.sub(r"\b(\d+)\s*g(ram|rams)?\b", " ", s)
    s = re.sub(r"\b(\d+)\s*kg\b", " ", s)
    s = re.sub(r"\b\d{1,2}%\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def tokens(s: str) -> Set[str]:
    return set(base_name(s).split()) if isinstance(s, str) else set()

def letters_slash_space_only(s: str) -> str:
    if not isinstance(s, str):
        return ""
    s = apply_aliases(s)
    s = s.lower()
    s = re.sub(r"[^a-z/ ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def letters_space_only(s: str) -> str:
    if not isinstance(s, str):
        return ""
    s = apply_aliases(s)
    s = s.lower()
    s = re.sub(r"[^a-z ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def make_slash_wildcard_regex(s: str) -> Optional[re.Pattern]:
    cleaned = letters_slash_space_only(s)
    if "/" not in cleaned:
        return None
    parts = [p.strip() for p in cleaned.split("/") if p.strip()]
    if len(parts) < 2:
        return None
    escaped = [re.escape(p) for p in parts]
    pattern = r"\b" + r"[a-z ]*".join(escaped) + r"\b"
    return re.compile(pattern)

def _is_numericish(tok: str) -> bool:
    return bool(_NUM_TOKEN_RE.fullmatch(tok))

def _clean_token_set(T: Set[str]) -> Set[str]:
    out: Set[str] = set()
    for t in T:
        if t in STOP_TOKENS:
            continue
        if _is_numericish(t):
            continue
        out.add(t)
    return out

def filt_tokens(s: str) -> Set[str]:
    return _clean_token_set(tokens(s))

MISSPELL_TOKEN_MAP = {
    "whitney": "whitley",
    "whitley": "whitley",
    "neil":    "neill",
    "neill":   "neill",
    "blk":     "black",
    "jameson": "jamesons",
}

def normalise_token(tok: str) -> str:
    t = tok
    t = re.sub(r"(.)\1+", r"\1", t)
    t = re.sub(r"^whitn?e?y$", "whitley", t)
    t = MISSPELL_TOKEN_MAP.get(t, t)
    return t

def expand_contextual(tokens_set: Set[str]) -> Set[str]:
    T = set(tokens_set)
    if "b" in T and "orange" in T:
        T.discard("b")
        T.add("blood")
        T.add("orange")
    return T

def reconcile_initials(left: Set[str], right: Set[str]) -> Tuple[Set[str], Set[str]]:
    L, R = set(left), set(right)
    for t in list(L):
        if len(t) == 1:
            candidates = [u for u in R if u.startswith(t)]
            if candidates:
                L.remove(t)
                L.add(max(candidates, key=len))
    for t in list(R):
        if len(t) == 1:
            candidates = [u for u in L if u.startswith(t)]
            if candidates:
                R.remove(t)
                R.add(max(candidates, key=len))
    return L, R

def _flavour_guard(lt: Set[str], rt: Set[str]) -> bool:
    l_has = any(t in FLAVOUR_TOKENS for t in lt)
    r_has = any(t in FLAVOUR_TOKENS for t in rt)
    return (l_has and not r_has) or (r_has and not l_has)

def _token_pair_prefix_equal(a: str, b: str, min_pref: int = MIN_PREFIX_LEN) -> bool:
    if a == b:
        return True
    la, lb = len(a), len(b)
    if la < min_pref and lb < min_pref:
        return False
    if la >= min_pref and b.startswith(a):
        return True
    if lb >= min_pref and a.startswith(b):
        return True
    return False

def _greedy_overlap(A: Set[str], B: Set[str], min_pref: int = MIN_PREFIX_LEN) -> Tuple[int, Set[str], Set[str]]:
    used_b: Set[str] = set()
    matched_a: Set[str] = set()
    matched_b: Set[str] = set()
    matches = 0
    for a in A:
        found = None
        for b in B:
            if b in used_b:
                continue
            if _token_pair_prefix_equal(a, b, min_pref=min_pref):
                found = b
                break
        if found is not None:
            used_b.add(found)
            matched_a.add(a)
            matched_b.add(found)
            matches += 1
    return matches, matched_a, matched_b

def _coverage_score(A: Set[str], B: Set[str], matches: int) -> float:
    if not A or not B:
        return 0.0
    cov_a = matches / max(len(A), 1)
    cov_b = matches / max(len(B), 1)
    return min(cov_a, cov_b)

def _has_distinctive_match(matched_tokens: Set[str]) -> bool:
    return any(len(t) >= MIN_DISTINCTIVE_LEN and re.search(r"[a-z]", t) for t in matched_tokens)

# ---------- Targeted strategies ----------

def strategy_exact_tokens_with_slash(left_name: str, right_name: str) -> Optional[float]:
    lt_raw = filt_tokens(left_name)
    rt_raw = filt_tokens(right_name)

    lt_norm = {normalise_token(t) for t in lt_raw}
    rt_norm = {normalise_token(t) for t in rt_raw}

    lt_norm = expand_contextual(lt_norm)
    rt_norm = expand_contextual(rt_norm)

    lt_eq, rt_eq = reconcile_initials(lt_norm, rt_norm)
    if lt_eq and lt_eq == rt_eq:
        return 1.0

    lt_all = {normalise_token(t) for t in tokens(left_name)}
    rt_all = {normalise_token(t) for t in tokens(right_name)}
    lt_all, rt_all = reconcile_initials(lt_all, rt_all)
    lt_all = expand_contextual(lt_all)
    rt_all = expand_contextual(rt_all)

    lt_all_clean = _clean_token_set(lt_all)
    rt_all_clean = _clean_token_set(rt_all)
    if lt_all_clean and lt_all_clean == rt_all_clean:
        return 1.0

    rx_l = make_slash_wildcard_regex(left_name)
    if rx_l is not None and rx_l.search(letters_space_only(right_name)):
        return 1.0
    rx_r = make_slash_wildcard_regex(right_name)
    if rx_r is not None and rx_r.search(letters_space_only(left_name)):
        return 1.0

    return None

def strategy_brand_only(left_name: str, right_name: str) -> Optional[float]:
    lt = {normalise_token(t) for t in filt_tokens(left_name)}
    rt = {normalise_token(t) for t in filt_tokens(right_name)}
    if not lt or not rt:
        return None
    if _flavour_guard(lt, rt):
        return None
    if len(lt) != 1 or len(rt) != 1:
        return None
    brand_l = next(iter(lt))
    brand_r = next(iter(rt))
    if brand_l == brand_r and brand_l in BRAND_ONLY_WHITELIST:
        return 0.92
    return None

def strategy_snack_fries(left_name: str, right_name: str) -> Optional[float]:
    lt = {normalise_token(t) for t in filt_tokens(left_name)}
    rt = {normalise_token(t) for t in filt_tokens(right_name)}
    if not lt or not rt:
        return None
    if "fries" not in lt or "fries" not in rt:
        return None
    flavours = {"bacon", "scampi"}
    if (lt & flavours) and (rt & flavours):
        return 0.91
    return None

def strategy_beaujolais_villages(left_name: str, right_name: str) -> Optional[float]:
    ln = " " + base_name(left_name) + " "
    rn = " " + base_name(right_name) + " "
    if " beaujolais villages " in ln and " beaujolais villages " in rn:
        return 0.91
    return None

def strategy_prefix_tokens(left_name: str, right_name: str) -> Optional[float]:
    lt = {normalise_token(t) for t in filt_tokens(left_name)}
    rt = {normalise_token(t) for t in filt_tokens(right_name)}
    if not lt or not rt:
        return None
    if _flavour_guard(lt, rt):
        return None
    matches, matched_a, matched_b = _greedy_overlap(lt, rt, min_pref=MIN_PREFIX_LEN)
    if matches < MIN_MATCHED_TOKENS:
        return None
    cov = _coverage_score(lt, rt, matches)
    if cov < MIN_BIDI_COVERAGE:
        return None
    if not (_has_distinctive_match(matched_a) or _has_distinctive_match(matched_b)):
        return None
    return 0.9

def strategy_token_overlap(left_name: str, right_name: str) -> Optional[float]:
    lt = {normalise_token(t) for t in filt_tokens(left_name)}
    rt = {normalise_token(t) for t in filt_tokens(right_name)}
    if not lt or not rt:
        return None
    if _flavour_guard(lt, rt):
        return None
    matches, matched_a, matched_b = _greedy_overlap(lt, rt, min_pref=MIN_PREFIX_LEN)
    if matches < MIN_MATCHED_TOKENS:
        return None
    cov = _coverage_score(lt, rt, matches)
    if cov < MIN_BIDI_COVERAGE:
        return None
    if not (_has_distinctive_match(matched_a) or _has_distinctive_match(matched_b)):
        return None
    return 0.8 * cov

# ---------- Scorer cascade ----------
def scorer_cascade(strategies: Optional[List[Callable[[str, str], Optional[float]]]] = None):
    steps = strategies or [
        strategy_exact_tokens_with_slash,  # 1) exact
        strategy_brand_only,               # 1.5) strict brand-only
        strategy_snack_fries,              # 1.6) fries flavour rule
        strategy_beaujolais_villages,      # 1.7) villages phrase rule
        strategy_prefix_tokens,            # 2) tightened prefix coverage
        strategy_token_overlap,            # 3) tightened overlap
    ]
    def _scorer(a: str, b: str) -> Optional[float]:
        for fn in steps:
            val = fn(a, b)
            if val is not None:
                return float(val)
        return None
    return _scorer
