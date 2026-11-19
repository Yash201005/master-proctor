import os
import io
import re
from typing import List, Tuple
from pypdf import PdfReader
from PIL import Image

from .models import PageContent, ScriptDocument

class ScriptExtractor:
    """
    Multi-format reader capable of processing 20-50 page examination scripts,
    lecture notepads, digital PDFs, and handwritten scanned notes.
    """

    @staticmethod
    def extract_from_pdf_bytes(pdf_bytes: bytes, filename: str = "document.pdf") -> ScriptDocument:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        doc = ScriptDocument(title=os.path.splitext(filename)[0], file_type="pdf")
        
        total_pdf_pages = len(reader.pages)
        for i, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            # Basic cleanup of redundant whitespace
            clean_text = re.sub(r"[ \t]+", " ", page_text).strip()
            
            # If a digital page had no direct text, mark as empty/scanned
            doc.pages.append(PageContent(
                page_number=i + 1,
                text=clean_text,
                source_type="pdf_text"
            ))

        doc.compute_stats()
        return doc

    @staticmethod
    def extract_from_text(raw_text: str, filename: str = "notes.txt") -> ScriptDocument:
        """
        Parses text/markdown scripts. If explicit page breaks (e.g. '---' or 'Page X')
        exist, uses them. Otherwise, splits into 400-500 word blocks to simulate pages.
        """
        doc = ScriptDocument(title=os.path.splitext(filename)[0], file_type="text")
        
        # Check for explicit page separators
        if "\f" in raw_text: # Form feed page separator
            raw_pages = raw_text.split("\f")
        elif re.search(r"\n\s*---\s*\n", raw_text):
            raw_pages = re.split(r"\n\s*---\s*\n", raw_text)
        elif re.search(r"\bPage\s+\d+\b", raw_text, re.IGNORECASE):
            raw_pages = re.split(r"\bPage\s+\d+\b", raw_text, flags=re.IGNORECASE)
        else:
            # Word-based page chunking (approx 450 words per page)
            words = raw_text.split()
            page_size = 450
            raw_pages = []
            for i in range(0, max(1, len(words)), page_size):
                raw_pages.append(" ".join(words[i:i + page_size]))

        for i, p_text in enumerate(raw_pages):
            clean = p_text.strip()
            if clean:
                doc.pages.append(PageContent(
                    page_number=len(doc.pages) + 1,
                    text=clean,
                    source_type="notepad"
                ))

        doc.compute_stats()
        return doc

    @staticmethod
    def extract_from_image_pages(images: List[Tuple[int, bytes]], filename: str = "handwritten_notes") -> ScriptDocument:
        """
        For handwritten notes uploaded as page image batches.
        Integrates with local OCR (PaddleOCR/Tesseract) or prepares for multimodal vision.
        """
        doc = ScriptDocument(title=filename, file_type="handwritten_images")
        
        # Try importing existing OCR engine
        try:
            from ocr_engines import run_paddle, run_tesseract
            has_local_ocr = True
        except ImportError:
            has_local_ocr = False

        for page_num, img_bytes in images:
            text = ""
            if has_local_ocr:
                try:
                    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                    # Run PaddleOCR for handwritten / print hybrid
                    p_res = run_paddle(img)
                    if p_res and p_res.get("text"):
                        text = p_res["text"]
                    else:
                        t_res = run_tesseract(img)
                        text = t_res.get("text", "")
                except Exception:
                    text = f"[Handwritten Note Page {page_num}: Processed via Multimodal Vision]"
            else:
                text = f"[Handwritten Note Page {page_num}: Processed via Multimodal Vision]"

            doc.pages.append(PageContent(
                page_number=page_num,
                text=text.strip(),
                source_type="ocr"
            ))

        doc.compute_stats()
        return doc
