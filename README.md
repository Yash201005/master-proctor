# ID Card Reader (PaddleOCR + Tesseract)

Reads ID cards, **figures out what kind of card it is from keywords**, and extracts the fields.
Both OCR engines run on every card; their answers are compared and merged.

Target: **Python 3.10.11**, Windows / Linux / macOS (CPU).

## 1. Setup (Windows)

1. Install **Python 3.10.11** (tick "Add to PATH").
2. Install the **Tesseract engine** (Windows build by UB Mannheim) to the default path
   `C:\Program Files\Tesseract-OCR\` – https://github.com/UB-Mannheim/tesseract/wiki
3. In this folder run `setup_windows.bat` (creates `.venv` and installs everything), or manually:

```bat
py -3.10 -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Linux/macOS: `sudo apt install tesseract-ocr` (or `brew install tesseract`), then the same pip steps.

> First PaddleOCR run downloads ~15 MB of models into `~/.paddleocr` (needs internet once).

## 2. Run

```bat
python main.py -i card.jpg
python main.py -i C:\cards -o results --annotate
python main.py -i C:\cards --mask --show-text
python main.py -i card.jpg --engines tesseract          :: only one engine
python main.py -i card.jpg --tesseract-cmd "D:\Tools\Tesseract-OCR\tesseract.exe"
```

| Option | Meaning |
|---|---|
| `-i` | image file or folder (jpg/png/bmp/webp/tif) |
| `-o` | output folder (default `output/`) |
| `--engines` | `both` (default), `paddle`, `tesseract` |
| `--annotate` | save a copy of the image with OCR boxes |
| `--mask` | mask card / DL / Aadhaar / PAN numbers in the output |
| `--show-text` | print raw OCR text of each engine |
| `--no-rotate` | skip auto-rotation detection |

## 3. Output

* console summary per card
* `output/<image>.json` – full detail (type, scores, fields, raw text of both engines)
* `output/results.json` and `output/results.csv` – everything in one place

Each field tells you how trustworthy it is:

| tag | meaning |
|---|---|
| `✓ both` | PaddleOCR and Tesseract agree |
| `~ both` | nearly identical (≥90 % similar) |
| `! conflict` | they disagree – best-validated value shown, other under `alternatives` |
| `· paddle` / `· tesseract` | only one engine found it |
| `? guessed from layout` | name inferred from position, not from a label – please verify |

## 4. The keyword intelligence (`classifier.py`)

Every document type has weighted keywords and patterns, e.g.

* **college_id** – "Institute of Technology", VTU, AICTE, USN pattern `4MH23CS052`, Course …
* **school_id** – "School", CBSE/ICSE, "IX-B", Mother's Name …
* **driving_licence** – "Driving Licence", DL No pattern, LMV/MCWG, Licencing Authority …
* **bank_card** – Bank, RuPay, Visa, Prepaid, Valid Thru, IFSC …
* **employee_id** – Emp. ID, Technologies Limited, Issuing Authority …
* **aadhaar / pan_card / passport / voter_id**

Score → best type + confidence. If a second type scores high too, the card is flagged
**hybrid** (e.g. a college ID that is also a RuPay prepaid card). Typos from OCR are tolerated
via fuzzy matching. To add a new type, add an entry to `DOC_TYPES` in `classifier.py`.

## 5. Files

| File | Purpose |
|---|---|
| `main.py` | command-line tool |
| `ocr_engines.py` | Tesseract + PaddleOCR, rotation detection, pre-processing |
| `classifier.py` | keyword-based document type detection |
| `extractor.py` | field extraction + merging both engines |
| `requirements.txt` | pinned dependencies for Python 3.10.11 |
| `setup_windows.bat` | one-click venv + install |

## 6. Troubleshooting

* **"Tesseract executable not found"** → install it, or pass `--tesseract-cmd`, or set env `TESSERACT_CMD`.
* **`numpy` / `cv2` import errors** → keep `numpy==1.26.4` and `opencv-python==4.6.0.66` (Paddle 2.6 is not NumPy-2 compatible).
* **Slow first start** → Paddle model download / initialisation; later cards are faster.
* **GPU** → install `paddlepaddle-gpu` and set `IDREADER_GPU=1`.
* Blurry / glare photos: OCR will miss fields. Retake with even light, card filling the frame.
* Cards hold personal data – keep results private; use `--mask` when sharing outputs.
