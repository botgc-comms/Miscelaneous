# aliases.py
import re
from typing import List, Tuple

# Regex-style aliases (applied first, globally, case-insensitive)
REGEX_ALIASES: List[Tuple[re.Pattern, str]] = [
    # Whitley Neill variants
    (re.compile(r"\bw\s*/\s*neil(l)?\b", re.I), "whitley neill"),
    (re.compile(r"\bwhitney\s+neil(l)?\b", re.I), "whitley neill"),
    (re.compile(r"\bwhitney\b", re.I), "whitley"),
    (re.compile(r"\bneil\b", re.I), "neill"),
    (re.compile(r"\bteq\b", re.I), "Tequilla"),
    (re.compile(r"\bhilmasprings\b", re.I), "Hilma Springs"),


    # Dead Man → Dead Mans Fingers
    (re.compile(r"\bdead\s*man'?s?\b", re.I), "dead mans fingers"),

    # Curacao / De Kuyper
    (re.compile(r"\bdky\b", re.I), "de kuyper"),
    (re.compile(r"\bcurac[ãa]o\b", re.I), "curacao"),
    (re.compile(r"\bblue\s*curacao\b", re.I), "blue curacao"),

    # Pinot / Trevigiana families
    (re.compile(r"\bp\s*/\s*grigio\b", re.I), "pinot grigio"),
    (re.compile(r"\bp\s*/\s*noir\b", re.I), "pinot noir"),
    (re.compile(r"\btrev(igian|igiana)\b", re.I), "trevigiana"),
    (re.compile(r"\btrev\b", re.I), "trevigiana"),

    # Beaujolais Villages (singular → plural normalisation)
    (re.compile(r"\bbeaujolais\s+village\b", re.I), "beaujolais villages"),

    # Rosé/Blush unification
    (re.compile(r"\bblush\b", re.I), "rose"),

    # Bottle shorthand + trailing stock-taker suffixes
    (re.compile(r"\bbot\b", re.I), "bottle"),
    (re.compile(r"\s*-\s*\d+\s*$", re.I), ""),

    # Can/postmix shorthands
    (re.compile(r"\bcn\b", re.I), "can"),
    (re.compile(r"\bpost\s*mix\b", re.I), "postmix"),
    (re.compile(r"\bpost[- ]?mix\b", re.I), "postmix"),

    # Schnapps / cream / age forms
    (re.compile(r"\bsch\b", re.I), "schnapps"),
    (re.compile(r"\bcrm\b", re.I), "cream"),
    (re.compile(r"\b(\d+)\s*yo\b", re.I), r"\1 year"),
    (re.compile(r"\b(\d+)\s*y[re]s?\b", re.I), r"\1 year"),

    # Whisky spelling
    (re.compile(r"\bwhiskey\b", re.I), "whisky"),

    # Supa/Super mix
    (re.compile(r"\bsupa?mix\b", re.I), "supermix"),

    # Arte Noble variations
    (re.compile(r"\barte\s+noble\b", re.I), "arte noble"),

    # Zinfandel / Hilmar Springs
    (re.compile(r"\bzinf\b", re.I), "zinfandel"),
    (re.compile(r"\bhilma?r\s+springs\b", re.I), "hilmar springs"),

    # Red Bull -> Redbull
    (re.compile(r"\bred\s+bull\b", re.I), "redbull"),

    # Guinness 0% variants → "guinness zero"
    (re.compile(r"\b0\.?0?%?\b", re.I), "zero"),

    # FOC / ICON noise removal
    (re.compile(r"\bfoc\b", re.I), ""),
    (re.compile(r"\bicon\b", re.I), ""),
    (re.compile(r"\bO%?\b", re.I), "zero"),
    (re.compile(r"\bred\s+bull\b", re.I), "redbull"),
    (re.compile(r"\b0\.?0?%?\b", re.I), "zero"),
]

# Token aliases (single tokens, applied after the regex step)
TOKEN_ALIASES = {
    # Common spellings
    "whitney": "whitley",
    "neil": "neill",
    "jameson": "jamesons",
    "sauv": "sauvignon",
    "blnc": "blanc",

    # Liquor/category short forms
    "blk": "black",
    "med": "medium",
    "org": "orange",
    "teq": "tequila",

    # Variants / words
    "rosso": "red",

    # Snacks/brand normalisation (helps Fries)
    "scampi": "scampi",
    "bacon": "bacon",

    # Containers / counts
    "doz": "dozen",

    # Sauvignon Blanc shorthand
    "sauv": "sauvignon",
    "blnc": "blanc",
}

def apply_aliases(text: str) -> str:
    """
    Apply REGEX_ALIASES then TOKEN_ALIASES to the input string.
    Returns a lowercased, lightly cleaned string ready for subsequent normalisation.
    """
    if not isinstance(text, str):
        return ""
    s = text
    for rx, repl in REGEX_ALIASES:
        s = rx.sub(repl, s)
    s = s.lower()

    if TOKEN_ALIASES:
        pattern = r"\b(" + "|".join(map(re.escape, TOKEN_ALIASES.keys())) + r")\b"
        s = re.sub(pattern, lambda m: TOKEN_ALIASES.get(m.group(1), m.group(1)), s)

    return s
