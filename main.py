#!/usr/bin/env python
"""
ID Card Reader
==============
Reads ID cards with BOTH PaddleOCR and Tesseract, works out what type of card
it is from keywords (college / school / bank / licence / employee / ...),
and extracts the fields.

Usage
-----
  python main.py -i card.jpg
  python main.py -i ./cards_folder -o results --annotate
  python main.py -i ./cards_folder --engines tesseract
  python main.py -i card.jpg --mask --show-text
  python main.py -i card.jpg --tesseract-cmd "C:\\Program Files\\Tesseract-OCR\\tesseract.exe"
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path

import cv2

import ocr_engines as oe
from classifier import classify
from extractor import SENSITIVE, extract_one, mask_value, merge

IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}

CSV_COLS = ["file", "doc_type", "confidence", "secondary_types", "side_hint", "name", "father_name",
            "dob", "phone", "email", "id_number", "dl_number", "employee_id", "institution", "company",
            "course", "class_section", "valid_till", "address"]


def collect_images(p: Path, skip: Path | None):
    if p.is_file():
        return [p]
    out = [f for f in sorted(p.rglob("*")) if f.suffix.lower() in IMG_EXT]
    if skip:
        out = [f for f in out if skip not in f.parents]
    return out


def process(path: Path, args, out_dir: Path) -> dict:
    t0 = time.time()
    warnings = []
    img = oe.load_image(str(path))

    angle = 0
    if not args.no_rotate:
        try:
            angle = oe.detect_rotation(img, args.tesseract_cmd)
        except Exception as e:                                         # noqa: BLE001
            warnings.append(f"rotation detection skipped: {e}")
    img_r = oe.rotate(img, angle)

    results = {}
    if args.engines in ("both", "paddle"):
        results["paddle"] = oe.run_paddle(img_r)
    if args.engines in ("both", "tesseract"):
        results["tesseract"] = oe.run_tesseract(img_r, args.tesseract_cmd)

    for name, r in results.items():
        if r.error:
            warnings.append(f"{name} failed: {r.error}")
    ok = {k: v for k, v in results.items() if not v.error and v.lines}

    combined = "\n".join(r.full_text for r in ok.values())
    cls = classify(combined)

    per_engine = {k: extract_one([l.text for l in r.lines], r.extra, cls["doc_type"]) for k, r in ok.items()}
    fields = merge(per_engine) if per_engine else {}
    if args.mask:
        for k in list(fields):
            if k in SENSITIVE:
                fields[k]["value"] = mask_value(fields[k]["value"])

    if args.annotate and ok:
        best = ok.get("paddle") or next(iter(ok.values()))
        cv2.imwrite(str(out_dir / f"{path.stem}_annotated.jpg"), oe.annotate(img_r, best))

    rec = {
        "file": path.name,
        "rotation_applied_deg": angle,
        "doc_type": cls["doc_type"],
        "doc_type_label": cls["doc_type_label"],
        "confidence": cls["confidence"],
        "is_hybrid": cls["is_hybrid"],
        "secondary_types": cls["secondary_types"],
        "side_hint": cls["side_hint"],
        "matched_keywords": cls["matched_keywords"],
        "type_scores": cls["scores"],
        "fields": fields,
        "engines": {k: {"mean_confidence": round(v.mean_conf, 3), "lines": len(v.lines),
                        "error": v.error, "text": v.text} for k, v in results.items()},
        "warnings": warnings,
        "seconds": round(time.time() - t0, 1),
    }
    (out_dir / f"{path.stem}.json").write_text(json.dumps(rec, indent=2, ensure_ascii=False), encoding="utf-8")
    return rec


def val(rec, k):
    f = rec["fields"].get(k)
    if not f:
        return ""
    v = f["value"]
    return ", ".join(v) if isinstance(v, list) else v


def print_record(rec, show_text=False):
    bar = "=" * 72
    print(f"\n{bar}\n{rec['file']}   (rotated {rec['rotation_applied_deg']}°, {rec['seconds']}s)")
    hybrid = f"  + also looks like: {', '.join(rec['secondary_types'])}" if rec["is_hybrid"] else ""
    print(f"TYPE : {rec['doc_type_label']}  [{rec['doc_type']}]  confidence {rec['confidence']}{hybrid}")
    print(f"       side: {rec['side_hint']}   keywords: {', '.join(rec['matched_keywords'][:8])}")
    print("-" * 72)
    for k, f in rec["fields"].items():
        v = f["value"]
        v = ", ".join(v) if isinstance(v, list) else v
        tag = f.get("agreement", "")
        tag = {"match": "✓ both", "match (fuzzy)": "~ both", "conflict": "! conflict",
               "single-engine": f"· {f['source']}", "heuristic (verify)": f"? guessed from layout, verify"}.get(tag, f.get("source", ""))
        print(f"  {k:<16} {v}   [{tag}]")
        if f.get("alternatives"):
            print(f"  {'':<16} alt: {f['alternatives']}")
    for w in rec["warnings"]:
        print(f"  ! {w}")
    if show_text:
        for e, d in rec["engines"].items():
            print(f"\n  --- raw {e} text (mean conf {d['mean_confidence']}) ---\n" +
                  "\n".join("  | " + t for t in d["text"].splitlines()))


def main():
    ap = argparse.ArgumentParser(description="Read ID cards with PaddleOCR + Tesseract and classify them.")
    ap.add_argument("-i", "--input", required=True, help="image file or folder")
    ap.add_argument("-o", "--output", default="output", help="output folder (default: ./output)")
    ap.add_argument("--engines", choices=["both", "paddle", "tesseract"], default="both")
    ap.add_argument("--tesseract-cmd", default=None, help="path to tesseract executable")
    ap.add_argument("--no-rotate", action="store_true", help="skip automatic rotation detection")
    ap.add_argument("--annotate", action="store_true", help="save images with OCR boxes drawn")
    ap.add_argument("--mask", action="store_true", help="mask card / DL / Aadhaar / PAN numbers in output")
    ap.add_argument("--show-text", action="store_true", help="print raw OCR text per engine")
    args = ap.parse_args()

    src = Path(args.input)
    if not src.exists():
        sys.exit(f"Input not found: {src}")
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    images = collect_images(src, out_dir.resolve())
    if not images:
        sys.exit("No images found.")
    print(f"Found {len(images)} image(s). Engines: {args.engines}. Output: {out_dir.resolve()}")

    records = []
    for p in images:
        try:
            rec = process(p, args, out_dir)
        except Exception as e:                                         # noqa: BLE001
            print(f"\n{p.name}: FAILED -> {type(e).__name__}: {e}")
            continue
        records.append(rec)
        print_record(rec, args.show_text)

    (out_dir / "results.json").write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    with open(out_dir / "results.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(CSV_COLS)
        for r in records:
            w.writerow([r["file"], r["doc_type"], r["confidence"], "|".join(r["secondary_types"]),
                        r["side_hint"]] + [val(r, c) for c in CSV_COLS[5:]])

    print(f"\nDone. {len(records)}/{len(images)} processed -> {out_dir / 'results.json'}, {out_dir / 'results.csv'}")


if __name__ == "__main__":
    main()
