from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
import time
import uuid

@dataclass
class PageContent:
    page_number: int
    text: str
    source_type: str = "text" # "pdf_text", "ocr", "notepad", "image"
    word_count: int = 0

    def __post_init__(self):
        self.word_count = len(self.text.split())

@dataclass
class ScriptDocument:
    id: str = field(default_factory=lambda: f"doc_{uuid.uuid4().hex[:10]}")
    title: str = "Untitled Examination Script"
    file_type: str = "pdf"
    pages: List[PageContent] = field(default_factory=list)
    total_pages: int = 0
    total_words: int = 0
    created_at: float = field(default_factory=time.time)

    def compute_stats(self):
        self.total_pages = len(self.pages)
        self.total_words = sum(p.word_count for p in self.pages)

@dataclass
class MCQuestion:
    id: str = field(default_factory=lambda: f"q_{uuid.uuid4().hex[:8]}")
    number: int = 1
    question: str = ""
    options: Dict[str, str] = field(default_factory=lambda: {"A": "", "B": "", "C": "", "D": ""})
    correct_answer: str = "A" # A, B, C, or D
    explanation: str = ""
    source_page: Optional[int] = None
    topic: str = "General"
    difficulty: str = "Medium" # Easy, Medium, Hard

    def to_dict(self, include_answer: bool = True) -> Dict[str, Any]:
        d = {
            "id": self.id,
            "number": self.number,
            "question": self.question,
            "options": self.options,
            "topic": self.topic,
            "difficulty": self.difficulty
        }
        if include_answer:
            d["correct_answer"] = self.correct_answer
            d["explanation"] = self.explanation
            d["source_page"] = self.source_page
        return d

@dataclass
class ExamPaper:
    id: str = field(default_factory=lambda: f"exam_{uuid.uuid4().hex[:10]}")
    title: str = "Automated Proctor Examination"
    source_doc_id: str = ""
    duration_minutes: int = 30
    total_questions: int = 0
    questions: List[MCQuestion] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)

    def to_candidate_view(self) -> Dict[str, Any]:
        """Returns exam paper without leaking correct answers to candidate during test."""
        return {
            "id": self.id,
            "title": self.title,
            "duration_minutes": self.duration_minutes,
            "total_questions": len(self.questions),
            "questions": [q.to_dict(include_answer=False) for q in self.questions]
        }

    def to_full_view(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "duration_minutes": self.duration_minutes,
            "total_questions": len(self.questions),
            "questions": [q.to_dict(include_answer=True) for q in self.questions],
            "created_at": self.created_at
        }
