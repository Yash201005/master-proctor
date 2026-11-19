"""
extractor.py
------------
Turns OCR lines into structured fields.

Strategy
  1. "Label : value" parsing (fuzzy label matching, several labels per line,
     value on the next line, multi-line addresses)
  2. Pattern search over the whole text (email, phone, USN, DL no, PAN, ...)
  3. Layout heuristics (name above "Father's Name", name above "Emp. ID")
  4. Run separately for each OCR engine, then MERGE: if both agree the field
     is marked "match"; if not, the better-validated value wins and the other
     is kept under "alternatives".
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple

try:
    from rapidfuzz import fuzz
except ImportError:
    fuzz = None

# --------------------------------------------------------------------------- #
# label vocabulary
# --------------------------------------------------------------------------- #
LABEL_MAP = {
    "name": "name", "studentname": "name", "nameofthestudent": "name", "candidatename": "name",
    "employeename": "name",
    "fathersname": "father_name", "fathername": "father_name",
    "mothersname": "mother_name", "mothername": "mother_name",
    "dob": "dob", "dateofbirth": "dob", "birthdate": "dob",
    "mobno": "phone", "mobileno": "phone", "mobile": "phone", "phone": "phone", "phoneno": "phone",
    "contactno": "phone", "contact": "phone",
    "emailid": "email", "email": "email",
    "validity": "valid_till", "validitytill": "valid_till", "validtill": "valid_till",
    "validupto": "valid_till", "validthru": "valid_till", "expiry": "valid_till",
    "expirydate": "valid_till",
    "issued": "issued_on", "dateofissue": "issued_on", "doi": "issued_on",
    "course": "course", "branch": "course",
    "idno": "id_number", "idnumber": "id_number", "admissionno": "id_number", "rollno": "id_number",
    "regno": "id_number", "usn": "id_number",
    "dlno": "dl_number", "licenceno": "dl_number", "licenseno": "dl_number",
    "bg": "blood_group", "bloodgroup": "blood_group",
    "co": "care_of", "careof": "care_of",
    "address": "address", "residentialaddress": "address", "residentialadress": "address",
    "empid": "employee_id", "employeeid": "employee_id", "empno": "employee_id",
    "designation": "designation", "department": "department",
    "remarks": "remarks", "class": "class_section", "std": "class_section",
}
_FUZZY_KEYS = [k for k in LABEL_MAP if len(k) >= 5]

PERSONAL_MAIL = ("gmail.", "yahoo.", "outlook.", "hotmail.", "rediffmail.", "icloud.", "proton")
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

STOP_LINE = re.compile(r"sign|if found|principal|valid|issuing|licen[cs]|www\.|@|authority|terms|"
                       r"customer|not transferable|return to|telefax|e-?mail", re.I)
NAME_STOP = {
    "institute", "technology", "college", "school", "limited", "bank", "approved", "affiliated",
    "recognized", "recognised", "government", "principal", "karnataka", "india", "department",
    "licence", "license", "driving", "transport", "identity", "card", "valid", "name", "signature",
    "return", "address", "mysore", "mysuru", "university", "autonomous", "education", "revolution",
    "residential", "father", "mother", "course", "phone", "email", "remarks", "validity", "issued",
    "found", "please", "gmail", "mail", "com", "transferable", "payments", "prepaid", "platinum", "rupay", "technologies",
    "emp", "authority", "issuing", "state", "union", "motor", "central", "belagavi", "belavadi",
    "mandya", "patna", "electronic", "only", "use", "customer", "care", "number", "holder", "sign",
}


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #
def resolve_label(txt: str) -> Optional[str]:
    n = re.sub(r"[^a-z]", "", txt.lower())
    if not n:
        return None
    if n in LABEL_MAP:
        return LABEL_MAP[n]
    if fuzz and len(n) >= 5:
        best = max(_FUZZY_KEYS, key=lambda k: fuzz.ratio(n, k))
        if fuzz.ratio(n, best) >= 84:
            return LABEL_MAP[best]
    return None


def _split_colon(line: str) -> List[Tuple[str, str]]:
    """'DL No. : KA55 123  DOI : 27/07/2023'  ->  [('dl_number','KA55 123'), ('issued_on','27/07/2023')]"""
    hits = []                              # (label_start, colon_pos, field)
    prev_end = 0
    for m in re.finditer(r"[:;]", line):
        c = m.start()
        pre = line[prev_end:c]
        toks = [(t.group(), t.start() + prev_end) for t in re.finditer(r"\S+", pre)]
        for n in range(min(4, len(toks)), 0, -1):           # longest label first
            f = resolve_label(" ".join(t for t, _ in toks[-n:]))
            if f:
                hits.append((toks[-n][1], c, f))
                prev_end = c + 1
                break
    segs = []
    for i, (_, c, f) in enumerate(hits):
        end = hits[i + 1][0] if i + 1 < len(hits) else len(line)
        segs.append((f, line[c + 1:end].strip(" :;-|")))
    return segs


# labels that OCR often prints WITHOUT a colon, glued to the value (typical on driving licences):
#   "NAME HASNAIN ..."  "D.Q.B 04/04/2005 B.G.O+"  "VALIDTILL03/04/2045(NT)"  "DLNo KA55 ..."
_GLUED = [
    ("dl_number", r"(?<![A-Za-z])DL\s?N[o0]\.?", 0),
    ("issued_on", r"(?<![A-Za-z])DOI(?![A-Za-z])", 0),
    ("dob", r"(?<![A-Za-z])D\.?\s?[O0Q]\.?\s?B(?![A-Za-z])\.?", 0),
    ("blood_group", r"(?<![A-Za-z])B\.?\s?G(?![A-Za-z])\.?", 0),
    ("valid_till", r"(?<![A-Za-z])VALID\s?(?:TILL|UPTO)|(?<![A-Za-z])VALIDITY(?:\s?TILL)?", re.I),
    ("address", r"(?<![A-Za-z])ADD?RESS", re.I),
    ("name", r"^\W*NAME(?![A-Za-z])", re.I),
    ("care_of", r"^\W*(?:C\s?/\s?[Oo0]|C[il]e|Clo)(?![A-Za-z])", 0),
]


def _split_glued(line: str) -> List[Tuple[str, str]]:
    hits = []
    for f, pat, fl in _GLUED:
        for m in re.finditer(pat, line, fl):
            hits.append((m.start(), m.end(), f))
    hits.sort()
    clean, last = [], -1
    for s, en, f in hits:
        if s >= last:
            clean.append((s, en, f))
            last = en
    segs = []
    for i, (s, en, f) in enumerate(clean):
        stop = clean[i + 1][0] if i + 1 < len(clean) else len(line)
        segs.append((f, line[en:stop].strip(" :;-.|")))
    return segs


def split_segments(line: str) -> List[Tuple[str, str]]:
    """Label/value pairs of a line: 'Label : value' first, colon-less glued labels as fallback."""
    return _split_colon(line) or _split_glued(line)


def fix_digits(s: str) -> str:
    return s.translate(str.maketrans({"O": "0", "o": "0", "l": "1", "I": "1", "|": "1"}))


def norm_date(s: str) -> Optional[str]:
    """Return DD-MM-YYYY or None."""
    s2 = fix_digits(s)
    m = re.search(r"(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4}|\d{2})\b", s2)
    d = mo = y = None
    if m:
        d, mo, y = (int(x) for x in m.groups())
    else:
        m = re.search(r"(\d{1,2})\s*[-/ ]\s*([A-Za-z]{3})[A-Za-z]*\s*[-/ ,]\s*(\d{4}|\d{2})\b", s)
        if m and m.group(2).lower() in MONTHS:
            d, mo, y = int(m.group(1)), MONTHS[m.group(2).lower()], int(m.group(3))
    if d is None:
        return None
    if y < 100:
        y += 2000 if y <= 50 else 1900
    try:
        datetime(y, mo, d)
    except ValueError:
        return None
    return f"{d:02d}-{mo:02d}-{y}"


def name_like(s: str) -> bool:
    s = s.strip(" .,:;-")
    if not re.fullmatch(r"[A-Za-z][A-Za-z .'’\-]{2,40}", s):
        return False
    toks = s.lower().replace(".", " ").replace("-", " ").split()
    if not (1 <= len(toks) <= 5):
        return False
    if any(t in NAME_STOP for t in toks):
        return False
    # need one real word (>=4 letters, with a vowel); rejects OCR garbage like "Pe A i ie"
    return any(len(t) >= 4 and re.search(r"[aeiouy]", t) for t in toks)


def clean_name(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Za-z .'’\-]", "", s)).strip(" .-")


_DOMAIN_FIX = {"qmail.com": "gmail.com", "gmai1.com": "gmail.com", "gmall.com": "gmail.com",
               "gmaii.com": "gmail.com", "gmial.com": "gmail.com", "yahoo.corn": "yahoo.com"}
_EMAIL_RE = r"[A-Za-z0-9][\w.%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+"


def clean_email(s: str) -> Optional[str]:
    toks = [t for t in re.split(r"\s+", s) if "@" in t] or [s.replace(" ", "")]
    for t in toks:
        m = re.search(_EMAIL_RE, t.strip("_.,;:|-"))
        if m:
            user, dom = m.group(0).lower().rsplit("@", 1)
            return f"{user.strip('_.-')}@{_DOMAIN_FIX.get(dom, dom)}"
    return None


def clean_junk(s: str) -> str:
    """Strip OCR noise symbols and short junk tokens from both ends of a text value."""
    s = re.sub(r"[|©®>~_«»=]+", " ", s)
    toks = s.split()
    def junk(t): return len(t) <= 2 and not re.search(r"\d", t) and not t.isupper() or t in {"w", "A", "Y", "8"}
    while toks and junk(toks[0]):
        toks.pop(0)
    while toks and junk(toks[-1]):
        toks.pop()
    return " ".join(toks).strip(" ,.-")


def is_stop(line: str) -> bool:
    if STOP_LINE.search(line):
        return True
    if re.search(r"\b\d[A-Z]{2}\d{2}[A-Z]{2,3}\d{3}\b", line, re.I):       # USN under barcode
        return True
    if re.fullmatch(r"\s*\d{6}\.?\s*", line):                               # pincode line is allowed
        return False
    letters = sum(ch.isalpha() for ch in line)
    return len(line.strip()) < 3 or letters / max(1, len(line)) < 0.4


# --------------------------------------------------------------------------- #
# extraction for ONE engine
# --------------------------------------------------------------------------- #
def extract_one(lines: List[str], extra: List[str], doc_type: str) -> Dict[str, object]:
    F: Dict[str, object] = {}
    idx: Dict[str, int] = {}
    used = set()
    n = len(lines)
    text = "\n".join(lines + extra)
    up = text.upper()

    # ---- 1. label : value --------------------------------------------------
    for i, line in enumerate(lines):
        if i in used:
            continue
        segs = split_segments(line)
        if not segs and resolve_label(line.strip(" :;")) == "address":   # heading-only "Residential Address"
            segs = [("address", "")]
        for f, v in segs:
            idx.setdefault(f, i)
            if f == "address":
                parts = [v] if v else []
                j = i + 1
                while j < n and len(parts) < 4 and j not in used:
                    if is_stop(lines[j]) or split_segments(lines[j]):
                        break
                    parts.append(lines[j])
                    used.add(j)
                    j += 1
                v = ", ".join(c for c in (clean_junk(p) for p in parts) if c)
            elif not v and i + 1 < n and i + 1 not in used and not split_segments(lines[i + 1]):
                v = lines[i + 1].strip()
                used.add(i + 1)
            if v:
                F.setdefault(f, v)

    # ---- 2. normalise labelled values -------------------------------------
    for k in ("dob", "issued_on", "valid_till"):
        if k in F:
            raw = str(F[k])
            nd = norm_date(raw)
            note = re.search(r"\(([A-Za-z]{1,4})\)", raw)
            if nd:
                F[k] = nd
                if note and k == "valid_till":
                    F["valid_till_note"] = note.group(1)
    for k in ("name", "father_name", "mother_name", "care_of"):
        if k in F:
            F[k] = clean_name(re.split(r"[\[\(|]", str(F[k]))[0])
            if not F[k]:
                del F[k]
    if "phone" in F:
        raw = str(F["phone"])
        d = re.sub(r"\D", "", raw)
        d = d[2:] if len(d) == 12 and d.startswith("91") else d
        if re.search(r"(?:\+?91[-\s]?|\b0)\d{2,4}[-\s]\d{6,8}\b", raw):      # it is a landline
            F["landline"] = re.sub(r"\s+", "", raw.split()[0] if len(raw.split()) > 1 else raw)
            del F["phone"]
        elif re.fullmatch(r"[6-9]\d{9}", d):
            F["phone"] = d
        else:
            del F["phone"]
    if "email" in F:
        ce = clean_email(str(F["email"]))
        if ce:
            F["email"] = ce
        else:
            del F["email"]
    if "employee_id" in F:
        F["employee_id"] = re.sub(r"\s", "", str(F["employee_id"]))

    for k in ("father_name", "mother_name", "course", "issued_on", "designation", "department", "care_of"):
        if isinstance(F.get(k), str):
            F[k] = clean_junk(F[k])
            if not F[k]:
                del F[k]

    # ---- 3. pattern search over whole text --------------------------------
    emails = list(dict.fromkeys(x for x in (clean_email(t) for t in re.findall(_EMAIL_RE, text)) if x))
    if "email" not in F:
        personal = [e for e in emails if any(p in e for p in PERSONAL_MAIL)]
        if personal:
            F["email"] = personal[0]
    if "email" in F and not any(p in str(F["email"]) for p in PERSONAL_MAIL):
        personal = [x for x in emails if any(p in x for p in PERSONAL_MAIL)]
        if personal:
            F["email"] = personal[0]
        elif doc_type in ("college_id", "school_id", "employee_id"):
            emails.append(str(F.pop("email")))               # that is the institution's mail, not the holder's
            emails = list(dict.fromkeys(emails))
    others = [x for x in emails if x != F.get("email")]
    if others:
        F["other_emails"] = others

    land = re.findall(r"(?:\+?91[-\s]?|\b0)\d{2,4}[-\s]\d{6,8}\b", text)
    if land:
        F["landline"] = re.sub(r"\s+", "", land[0])
    mtext = re.sub(r"(?:\+?91[-\s]?|\b0)\d{2,4}[-\s]\d{6,8}\b", " ", text)
    phones = []
    for m in re.finditer(r"(?<!\d)(?:\+?91[-\s]?)?([6-9]\d{9})(?!\d)", mtext):
        if m.group(1) not in phones:
            phones.append(m.group(1))
    if "phone" not in F and phones:
        F["phone"] = phones[0]
    others = [p for p in phones if p != F.get("phone")]
    if others:
        F["other_phones"] = others

    m = re.search(r"\b[1-9][A-Z]{2}\d{2}[A-Z]{2,3}\d{3}\b", up)
    if m and "id_number" not in F:
        F["id_number"] = m.group(0)

    m = re.search(r"\b([A-Z]{2}\s?-?\d{2})\s?-?(\d{11})\b", up)
    if m:
        F["dl_number"] = f"{re.sub(r'[^A-Z0-9]', '', m.group(1))} {m.group(2)}"

    m = re.search(r"EMP\.?\s*ID\s*[:\-]?\s*(\d{4,})", up)
    if m and "employee_id" not in F:
        F["employee_id"] = m.group(1)

    if doc_type == "aadhaar":
        m = re.search(r"\b\d{4}\s\d{4}\s\d{4}\b", text)
        if m:
            F["aadhaar_number"] = m.group(0)
    if doc_type == "pan_card":
        m = re.search(r"\b[A-Z]{5}\d{4}[A-Z]\b", up)
        if m:
            F["pan_number"] = m.group(0)
    if doc_type == "bank_card":
        m = re.search(r"\b(?:\d{4}[\s-]?){3}\d{4}\b", text)
        if m:
            F["card_number"] = re.sub(r"\D", "", m.group(0))
        m = re.search(r"\b(0[1-9]|1[0-2])\s*/\s*(\d{2}|\d{4})\b", text)
        if m:
            F["card_expiry"] = f"{m.group(1)}/{m.group(2)}"
        m = re.search(r"\b[A-Z]{4}0[A-Z0-9]{6}\b", up)
        if m:
            F["ifsc"] = m.group(0)
        for net in ("RUPAY", "VISA", "MASTERCARD"):
            if net in up:
                F["card_network"] = net.title() if net != "RUPAY" else "RuPay"
                break
        for kind in ("PREPAID", "DEBIT", "CREDIT"):
            if kind in up:
                F["card_kind"] = kind.title()
                break
        for l in lines + extra:
            if re.search(r"[A-Za-z]{3,}\s+(payments\s+)?bank", l, re.I) and "@" not in l and len(l) < 40:
                F["issuer"] = l.strip()
                break

    # blood group
    src = str(F.get("blood_group", "")) or ""
    m = re.search(r"(AB|A|B|O)\s*([+\-])", src.upper()) or re.search(r"B\.?\s?G\.?\s*[:;]\s*(AB|A|B|O)\s*([+\-])", up)
    if m:
        F["blood_group"] = m.group(1) + m.group(2)
    else:
        F.pop("blood_group", None)

    # vehicle classes (licence)
    covs = re.findall(r"(LMV|MCWG|MCWOG|HMV|HGMV|HPMV|MGV|LTV|TRANS)(?![A-Z])\W{0,5}(\d{2}/\d{2}/\d{4})", up)
    if covs:
        F["vehicle_classes"] = [f"{c} ({d.replace('/', '-')})" for c, d in covs]

    # class / section (school)
    m = re.search(r"\b(VI|VII|VIII|IX|XI|XII)\s*[-–]\s*([A-Z])\b", up)
    if m:
        F["class_section"] = f"{m.group(1)}-{m.group(2)}"

    # institution / company / website / pincode
    for l in lines + extra:
        if re.search(r"(institute of technology|college|university|school|academy)", l, re.I) and \
                not re.search(r"affiliated|approved|recogni[sz]ed|return|autonomous|e-?mail|www|@", l, re.I):
            c = clean_junk(re.sub(r"\s+", " ", l))
            m2 = re.match(r"(.*?(?:Mysore|Mysuru))\b", c, re.I)
            F.setdefault("institution", (m2.group(1) if m2 else c).strip())
            break
    for i, l in enumerate(lines):
        if re.search(r"\b(technologies|solutions|systems|limited|ltd|pvt|private)\b", l, re.I) and "@" not in l:
            c = re.sub(r"\s+", " ", l).strip()
            if i > 0 and re.fullmatch(r"[A-Z]{4,}", lines[i - 1].strip()) and not c.upper().startswith(lines[i - 1].strip()):
                c = lines[i - 1].strip() + " " + c
            F.setdefault("company", clean_junk(c))
            break
    m = re.search(r"\b(?:https?://)?(?:www\.)[a-z0-9.-]+\.[a-z]{2,}\b", text, re.I)
    if m:
        F["website"] = m.group(0).lower()
    addr = str(F.get("address", ""))
    m = re.search(r"\b[1-9]\d{2}\s?\d{3}\b", addr) or (
        re.search(r"\b5[0-9]{2}\s?\d{3}\b", text) if doc_type in ("driving_licence",) else None)
    if m:
        F["pincode"] = m.group(0).replace(" ", "")

    # DOB fallback when the label was unreadable: first plausible birth date in the text
    if "dob" not in F:
        for m in re.finditer(r"\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4}", text):
            nd = norm_date(m.group(0))
            if nd and 1930 <= int(nd[-4:]) <= datetime.now().year - 14:
                F["dob"] = nd
                F["_heuristic_dob"] = True
                break

    # name behind a garbled label, e.g. "Ss : HASNAIN MOHAMMED SHARIFF"
    if "name" not in F:
        for l in lines:
            m = re.match(r"^\W*\S{0,4}\s*[:;]\s*([A-Z][A-Z .']{5,})", l)
            if m and name_like(m.group(1)) and len(m.group(1).split()) >= 2:
                F["name"] = clean_name(clean_junk(m.group(1)))
                F["_heuristic_name"] = True
                break

    # ---- 4. layout heuristics for the person's name -----------------------
    if "name" not in F:
        guess = None
        if "father_name" in idx:                                 # name sits above "Father's Name"
            for j in range(idx["father_name"] - 1, max(-1, idx["father_name"] - 4), -1):
                if name_like(lines[j]):
                    guess = lines[j]
                    break
        if guess is None and ("employee_id" in idx or re.search(r"emp\.?\s*id", text, re.I)):
            ei = next((i for i, l in enumerate(lines) if re.search(r"emp\.?\s*id", l, re.I)), None)
            if ei:
                parts = []
                for j in range(ei - 1, max(-1, ei - 3), -1):
                    if name_like(lines[j]):
                        parts.insert(0, lines[j].strip())
                    else:
                        break
                guess = " ".join(parts) if parts else None
        if guess is None:
            for l in lines:
                if name_like(l) and len(l.split()) >= 2:
                    guess = l
                    break
        if guess:
            nm = clean_name(clean_junk(guess))
            if name_like(nm) and len(nm.split()) >= 2 and all(len(t) >= 3 or t.isupper() for t in nm.split()):
                F["name"] = nm
                F["_heuristic_name"] = True

    return F


# --------------------------------------------------------------------------- #
# merge both engines
# --------------------------------------------------------------------------- #
LIST_FIELDS = {"other_emails", "other_phones", "vehicle_classes"}


def _valid(field: str, v: str) -> int:
    v = str(v)
    if field in ("dob", "issued_on", "valid_till"):
        return int(bool(re.fullmatch(r"\d{2}-\d{2}-\d{4}", v)))
    if field in ("email",):
        return int(bool(re.fullmatch(r"[\w.%+-]+@[\w-]+(\.[\w-]+)+", v)))
    if field == "phone":
        return int(bool(re.fullmatch(r"[6-9]\d{9}", v)))
    if field == "id_number":
        return int(bool(re.fullmatch(r"[1-9][A-Z]{2}\d{2}[A-Z]{2,3}\d{3}", v)))
    if field == "dl_number":
        return int(bool(re.fullmatch(r"[A-Z]{2}\d{2} \d{11}", v)))
    if field in ("name", "father_name", "mother_name"):
        return int(bool(re.fullmatch(r"[A-Za-z .'’\-]+", v)))
    return 1


def _same(a: str, b: str) -> Tuple[bool, bool]:
    na, nb = re.sub(r"\W", "", a.lower()), re.sub(r"\W", "", b.lower())
    if na == nb:
        return True, False
    if fuzz and fuzz.ratio(na, nb) >= 90:
        return True, True
    return False, False


def merge(per_engine: Dict[str, Dict[str, object]]) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    keys: List[str] = []
    for d in per_engine.values():
        for k in d:
            if k not in keys:
                keys.append(k)
    heur = {e: bool(d.get("_heuristic_name")) for e, d in per_engine.items()}
    heur_dob = {e: bool(d.get("_heuristic_dob")) for e, d in per_engine.items()}
    keys = [k for k in keys if not k.startswith("_heuristic")]
    for k in keys:
        vals = {e: d[k] for e, d in per_engine.items() if d.get(k)}
        if k in LIST_FIELDS:
            merged = list(dict.fromkeys(x for v in vals.values() for x in v))
            out[k] = {"value": merged, "source": "+".join(vals)}
            continue
        if len(vals) == 1:
            e, v = next(iter(vals.items()))
            out[k] = {"value": v, "source": e, "agreement": "single-engine"}
            if (k == "name" and heur.get(e)) or (k == "dob" and heur_dob.get(e)):
                out[k]["agreement"] = "heuristic (verify)"
            continue
        (e1, v1), (e2, v2) = list(vals.items())[:2]
        same, fuzzy = _same(str(v1), str(v2))
        if same:
            pick = v1 if e1 == "paddle" else v2
            out[k] = {"value": pick, "source": "both", "agreement": "match (fuzzy)" if fuzzy else "match"}
        else:
            s1, s2 = _valid(k, v1), _valid(k, v2)
            hf = heur if k == "name" else heur_dob if k == "dob" else {}
            if hf.get(e1) != hf.get(e2) and k in ("name", "dob"):
                win, lose = ((e2, v2), (e1, v1)) if hf.get(e1) else ((e1, v1), (e2, v2))
            elif s2 > s1:
                win, lose = (e2, v2), (e1, v1)
            elif s1 > s2:
                win, lose = (e1, v1), (e2, v2)
            else:                                   # tie -> prefer paddle, then longer text
                ordered = sorted(((e, v) for e, v in vals.items()),
                                 key=lambda ev: (ev[0] == "paddle", len(str(ev[1]))), reverse=True)
                win, lose = ordered[0], ordered[1]
            out[k] = {"value": win[1], "source": win[0], "agreement": "conflict",
                      "alternatives": {lose[0]: lose[1]}}
    return out


SENSITIVE = {"aadhaar_number", "pan_number", "card_number", "dl_number"}


def mask_value(v: str) -> str:
    v = str(v)
    keep = 4
    return "*" * max(0, len(v) - keep) + v[-keep:]