"""
classifier.py
-------------
Decides WHAT KIND of card it is by looking for weighted keywords / patterns
in the OCR text (college, school, bank, licence, employee, aadhaar, PAN ...).

 * keyword hits use word boundaries (so "emp" won't match "temporary")
 * keywords starting with "~" are substring matches (e.g. "~bank" matches "nsdlbank")
 * long keywords also get a fuzzy match, so OCR typos ("Instltute") still count
 * hybrid cards (e.g. a college ID that is also a RuPay prepaid card) are
   reported via `secondary_types`
"""
from __future__ import annotations

import re
from typing import Dict, List

try:
    from rapidfuzz import fuzz
except ImportError:                                  # works without rapidfuzz, just less tolerant
    fuzz = None

# (keyword, weight) -- keywords are written in NORMALISED form: lowercase, a-z0-9 only
DOC_TYPES: Dict[str, dict] = {
    "college_id": {
        "label": "College / University ID card",
        "keywords": [("institute of technology", 4), ("engineering college", 4), ("college", 3),
                     ("university", 3), ("vtu", 3), ("aicte", 3), ("autonomous institution", 3),
                     ("affiliated to", 2), ("usn", 3), ("course", 2), ("branch", 2), ("semester", 2),
                     ("student", 2), ("principal", 1), ("recognised by government", 1),
                     ("recognized by government", 1), ("hod", 1)],
        "regex": [(r"\b\d[A-Z]{2}\d{2}[A-Z]{2,3}\d{3}\b", 4, "USN pattern")],
    },
    "school_id": {
        "label": "School ID card",
        "keywords": [("school", 4), ("central school", 3), ("cbse", 3), ("icse", 3), ("identity card", 2),
                     ("roll no", 2), ("admission no", 2), ("mother s name", 2), ("class", 1),
                     ("std", 1), ("grade", 1), ("principal", 1), ("sathagalli", 0)],
        "regex": [(r"\b(?:VI|VII|VIII|IX|XI|XII)\s*[-–]\s*[A-Z]\b", 2, "class-section (e.g. IX-B)")],
    },
    "driving_licence": {
        "label": "Driving licence",
        "keywords": [("driving licence", 5), ("driving license", 5), ("motor driving", 4),
                     ("transport department", 3), ("dl no", 4), ("licencing authority", 4),
                     ("licensing authority", 4), ("valid throughout india", 3), ("lmv", 3),
                     ("mcwg", 3), ("mcwog", 3), ("indian union", 2), ("rto", 2), ("cov", 2),
                     ("form 7", 1), ("non transport", 2)],
        "regex": [(r"\b[A-Z]{2}\s?-?\d{2}\s?-?\d{11}\b", 5, "DL number pattern")],
    },
    "bank_card": {
        "label": "Bank / debit / credit / prepaid card",
        "keywords": [("~bank", 3), ("payments bank", 4), ("debit", 3), ("credit", 3), ("prepaid", 4),
                     ("rupay", 4), ("visa", 3), ("mastercard", 3), ("platinum", 1), ("valid thru", 3),
                     ("cvv", 2), ("ifsc", 3), ("customer care", 1), ("nsdl", 2), ("npci", 2)],
        "regex": [(r"\b(?:\d{4}[\s-]?){3}\d{4}\b", 3, "16-digit card number")],
    },
    "employee_id": {
        "label": "Employee / corporate ID card",
        "keywords": [("emp id", 4), ("employee", 4), ("employee id", 2), ("designation", 3),
                     ("technologies limited", 3), ("private limited", 2), ("pvt ltd", 2), ("limited", 1),
                     ("issuing authority", 2), ("if found please return to company", 3),
                     ("excelsoft", 3), ("department", 1)],
        "regex": [(r"\bEmp\.?\s*ID\b", 2, "Emp. ID label")],
    },
    "aadhaar": {
        "label": "Aadhaar card",
        "keywords": [("aadhaar", 5), ("uidai", 5), ("unique identification", 4), ("mera aadhaar", 3),
                     ("government of india", 1), ("vid", 1)],
        "regex": [(r"\b\d{4}\s\d{4}\s\d{4}\b", 3, "12-digit Aadhaar number")],
    },
    "pan_card": {
        "label": "PAN card",
        "keywords": [("income tax department", 5), ("permanent account number", 5), ("pan", 1)],
        "regex": [(r"\b[A-Z]{5}\d{4}[A-Z]\b", 5, "PAN pattern")],
    },
    "passport": {
        "label": "Passport",
        "keywords": [("passport", 5), ("republic of india", 2), ("p<ind", 5), ("nationality", 2)],
        "regex": [],
    },
    "voter_id": {
        "label": "Voter ID (EPIC)",
        "keywords": [("election commission", 5), ("elector", 4), ("epic", 2), ("electors photo identity", 5)],
        "regex": [],
    },
}

BACK_SIDE_HINTS = ["if found", "return to", "terms", "residential address", "residential adress",
                   "issuing authority", "customer care", "not transferable", "principal signature"]


def _norm(text: str) -> str:
    t = text.lower().replace("’", "'")
    t = re.sub(r"[^a-z0-9+<]+", " ", t)
    return " " + re.sub(r"\s+", " ", t).strip() + " "


def classify(text: str) -> dict:
    nt = _norm(text)
    scores: Dict[str, float] = {}
    hits: Dict[str, List[str]] = {}

    for dtype, spec in DOC_TYPES.items():
        score, found = 0.0, []
        for kw, w in spec["keywords"]:
            if w <= 0:
                continue
            sub = kw.startswith("~")
            k = kw.lstrip("~")
            if (k in nt) if sub else (f" {k} " in nt):
                score += w
                found.append(k)
            elif fuzz and len(k) >= 8 and fuzz.partial_ratio(k, nt) >= 90:
                score += w * 0.7
                found.append(k + " (fuzzy)")
        for pat, w, lab in spec["regex"]:
            if re.search(pat, text, flags=re.I if "USN" in lab else 0):
                score += w
                found.append(lab)
        scores[dtype], hits[dtype] = score, found

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    (top, top_s), (_, second_s) = ranked[0], ranked[1]

    if top_s < 3:
        doc_type, conf = "unknown", 0.0
    else:
        doc_type, conf = top, round(top_s / (top_s + second_s + 2), 2)

    secondary = [t for t, s in ranked[1:] if s >= max(3.0, 0.35 * top_s)] if doc_type != "unknown" else []
    low = text.lower()
    side = "back" if any(h in low for h in BACK_SIDE_HINTS) else "front/unknown"

    return {
        "doc_type": doc_type,
        "doc_type_label": DOC_TYPES[doc_type]["label"] if doc_type != "unknown" else "Unknown document",
        "confidence": conf,
        "secondary_types": secondary,
        "is_hybrid": bool(secondary),
        "matched_keywords": hits.get(top, []) if doc_type != "unknown" else [],
        "scores": {k: round(v, 1) for k, v in ranked if v > 0},
        "side_hint": side,
    }
