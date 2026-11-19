"""
ocr_engines.py
--------------
OCR layer: runs BOTH Tesseract and PaddleOCR on an ID-card image.

Features
  * EXIF-aware image loading
  * automatic 0/90/180/270 rotation detection (cards photographed sideways)
  * pre-processing for Tesseract (upscale, CLAHE, denoise)
  * word boxes are merged into reading-order "rows" so that
    "Label : value" pairs end up on one line
"""
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image, ImageOps

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")  # avoids OpenMP clash on Windows
os.environ.setdefault("FLAGS_use_mkldnn", "0")          # oneDNN crashes on some Windows CPUs
os.environ.setdefault("FLAGS_enable_mkldnn", "0")


# --------------------------------------------------------------------------- #
# data classes
# --------------------------------------------------------------------------- #
@dataclass
class Line:
    text: str
    conf: float                      # 0..1
    box: List[Tuple[int, int]]       # 4 corners
    engine: str


@dataclass
class OCRResult:
    engine: str
    lines: List[Line] = field(default_factory=list)   # primary, reading order
    extra: List[str] = field(default_factory=list)    # supplementary fragments
    error: Optional[str] = None

    @property
    def text(self) -> str:
        return "\n".join(l.text for l in self.lines)

    @property
    def full_text(self) -> str:
        return "\n".join([l.text for l in self.lines] + self.extra)

    @property
    def mean_conf(self) -> float:
        return float(np.mean([l.conf for l in self.lines])) if self.lines else 0.0


# --------------------------------------------------------------------------- #
# image helpers
# --------------------------------------------------------------------------- #
def load_image(path: str) -> np.ndarray:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)


def rotate(img: np.ndarray, angle: int) -> np.ndarray:
    """Rotate clockwise by 0/90/180/270."""
    if angle % 360 == 0:
        return img
    code = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180,
            270: cv2.ROTATE_90_COUNTERCLOCKWISE}[angle % 360]
    return cv2.rotate(img, code)


def _resize_max(img: np.ndarray, max_side: int) -> np.ndarray:
    h, w = img.shape[:2]
    s = max_side / max(h, w)
    if s >= 1:
        return img
    return cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)


def enhance(img: np.ndarray) -> Tuple[np.ndarray, float]:
    """Grayscale + upscale + CLAHE + denoise. Returns (image, scale_used)."""
    h, w = img.shape[:2]
    scale = 1.0
    if max(h, w) < 1800:
        scale = min(2.5, 1800 / max(h, w))
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    gray = cv2.bilateralFilter(gray, 5, 40, 40)
    return gray, scale


def plain_variant(img: np.ndarray) -> Tuple[np.ndarray, float]:
    """Second pre-processing variant: upscaled grayscale + mild unsharp mask (no CLAHE)."""
    h, w = img.shape[:2]
    scale = min(2.5, 1800 / max(h, w)) if max(h, w) < 1800 else 1.0
    if scale > 1.05:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (0, 0), 3)
    return cv2.addWeighted(gray, 1.5, blur, -0.5, 0), scale


# --------------------------------------------------------------------------- #
# Tesseract
# --------------------------------------------------------------------------- #
def setup_tesseract(cmd: Optional[str] = None):
    import pytesseract

    cmd = cmd or os.environ.get("TESSERACT_CMD") or shutil.which("tesseract")
    if not cmd:
        for p in (r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                  r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"):
            if os.path.exists(p):
                cmd = p
                break
    if not cmd:
        raise RuntimeError(
            "Tesseract executable not found. Install it (see README) or pass "
            "--tesseract-cmd 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe'")
    pytesseract.pytesseract.tesseract_cmd = cmd
    return pytesseract


def _tess_words(ts, img: np.ndarray, psm: int, min_conf: float = 30.0):
    data = ts.image_to_data(img, lang="eng", config=f"--oem 3 --psm {psm}",
                            output_type=ts.Output.DICT)
    words = []
    for i, t in enumerate(data["text"]):
        t = (t or "").strip()
        try:
            c = float(data["conf"][i])
        except (TypeError, ValueError):
            continue
        if not t or c < min_conf:
            continue
        words.append(dict(text=t, conf=c, x=data["left"][i], y=data["top"][i],
                          w=data["width"][i], h=data["height"][i],
                          block=data["block_num"][i], par=data["par_num"][i],
                          line=data["line_num"][i]))
    return words


def _group_tess_lines(words, scale: float) -> List[Line]:
    groups = {}
    for w in words:
        groups.setdefault((w["block"], w["par"], w["line"]), []).append(w)
    lines = []
    for ws in groups.values():
        ws.sort(key=lambda w: w["x"])
        x0 = min(w["x"] for w in ws) / scale
        y0 = min(w["y"] for w in ws) / scale
        x1 = max(w["x"] + w["w"] for w in ws) / scale
        y1 = max(w["y"] + w["h"] for w in ws) / scale
        lines.append(Line(" ".join(w["text"] for w in ws),
                          float(np.mean([w["conf"] for w in ws])) / 100.0,
                          [(int(x0), int(y0)), (int(x1), int(y0)), (int(x1), int(y1)), (int(x0), int(y1))],
                          "tesseract"))
    lines.sort(key=lambda l: ((l.box[0][1] + l.box[2][1]) / 2, l.box[0][0]))
    return lines


def detect_rotation(img: np.ndarray, tesseract_cmd: Optional[str] = None) -> int:
    """Try 4 orientations with Tesseract and keep the one that yields most real words."""
    ts = setup_tesseract(tesseract_cmd)
    gray = cv2.cvtColor(_resize_max(img, 900), cv2.COLOR_BGR2GRAY)
    scores = {}
    for a in (0, 90, 180, 270):
        try:
            words = _tess_words(ts, rotate(gray, a), psm=11, min_conf=50)
        except Exception:
            words = []
        scores[a] = sum(w["conf"] / 100 * len(w["text"]) for w in words
                        if len(w["text"]) >= 3 and w["text"].isalpha())
    best = max(scores, key=scores.get)
    if scores[0] > 0 and scores[best] < scores[0] * 1.15:   # prefer "no rotation" on near-ties
        best = 0
    return best


def _quality(lines: List[Line]) -> float:
    return sum(sum(ch.isalnum() for ch in l.text) * l.conf for l in lines if l.conf >= 0.6)


def run_tesseract(img: np.ndarray, tesseract_cmd: Optional[str] = None) -> OCRResult:
    """Two pre-processing variants x psm 6; best variant = primary, the rest -> supplementary."""
    res = OCRResult("tesseract")
    try:
        ts = setup_tesseract(tesseract_cmd)
        cands = []
        for fn in (enhance, plain_variant):
            g, s = fn(img)
            cands.append((g, s, _group_tess_lines(_tess_words(ts, g, psm=6), s)))
        cands.sort(key=lambda c: _quality(c[2]), reverse=True)
        g, s, res.lines = cands[0]
        seen = {_k(l.text) for l in res.lines}
        pool = list(cands[1][2]) + _group_tess_lines(_tess_words(ts, g, psm=11), s)   # sparse pass
        for ln in pool:
            if len(ln.text) >= 3 and _k(ln.text) not in seen:
                res.extra.append(ln.text)
                seen.add(_k(ln.text))
    except Exception as e:                                               # noqa: BLE001
        res.error = f"{type(e).__name__}: {e}"
    return res


def _k(t: str) -> str:
    return "".join(ch for ch in t.lower() if ch.isalnum())


# --------------------------------------------------------------------------- #
# PaddleOCR
# --------------------------------------------------------------------------- #
_PADDLE = None


def _get_paddle():
    global _PADDLE
    if _PADDLE is None:
        from paddleocr import PaddleOCR
        _PADDLE = PaddleOCR(use_angle_cls=True, lang="en", show_log=False,
                            use_gpu=os.environ.get("IDREADER_GPU", "0") == "1",
                            enable_mkldnn=False,
                            det_limit_side_len=1600)
    return _PADDLE


def _merge_rows(lines: List[Line]) -> List[Line]:
    """Join side-by-side boxes that sit on the same visual row into one text line."""
    if not lines:
        return []

    def cy(l): return (l.box[0][1] + l.box[2][1]) / 2

    def hh(l): return max(4, abs(l.box[2][1] - l.box[0][1]))

    med_h = float(np.median([hh(l) for l in lines]))
    rows: List[List[Line]] = []
    for l in sorted(lines, key=cy):
        if rows and abs(cy(l) - np.mean([cy(r) for r in rows[-1]])) < 0.55 * med_h:
            rows[-1].append(l)
        else:
            rows.append([l])
    merged = []
    for row in rows:
        row.sort(key=lambda l: l.box[0][0])
        xs = [p[0] for l in row for p in l.box]
        ys = [p[1] for l in row for p in l.box]
        box = [(min(xs), min(ys)), (max(xs), min(ys)), (max(xs), max(ys)), (min(xs), max(ys))]
        merged.append(Line(" ".join(l.text for l in row), float(np.mean([l.conf for l in row])), box, "paddle"))
    return merged


def run_paddle(img: np.ndarray) -> OCRResult:
    res = OCRResult("paddle")
    try:
        out = _get_paddle().ocr(img, cls=True)
        items = out[0] if out and out[0] else []
        raw = []
        for box, (text, conf) in items:
            text = (text or "").strip()
            if text:
                raw.append(Line(text, float(conf), [(int(x), int(y)) for x, y in box], "paddle"))
        res.lines = _merge_rows(raw)
        res.extra = [l.text for l in raw]            # un-merged fragments help regex search
    except Exception as e:                                               # noqa: BLE001
        res.error = f"{type(e).__name__}: {e}"
    return res


# --------------------------------------------------------------------------- #
# debug drawing
# --------------------------------------------------------------------------- #
def annotate(img: np.ndarray, result: OCRResult, color=(0, 160, 0)) -> np.ndarray:
    out = img.copy()
    for l in result.lines:
        pts = np.array(l.box, np.int32).reshape(-1, 1, 2)
        cv2.polylines(out, [pts], True, color, 2)
        label = "".join(ch for ch in l.text if ord(ch) < 128)[:40]
        cv2.putText(out, label, (l.box[0][0], max(12, l.box[0][1] - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)
    return out