import time
from typing import Dict, Any
from flask import Blueprint, request, jsonify

from .models import ScriptDocument, ExamPaper, PageContent
from .extractor import ScriptExtractor
from .chunker import ScriptChunker
from .generator import MCQGenerator

convert_bp = Blueprint("script_convert", __name__)

# In-memory document and exam stores
DOCUMENTS_STORE: Dict[str, ScriptDocument] = {}
EXAMS_STORE: Dict[str, ExamPaper] = {}

def create_sample_25_page_script() -> ScriptDocument:
    """Generates a realistic 25-page Computer Science examination syllabus script for instant testing."""
    topics = [
        ("Computer Architecture", "Von Neumann architecture describes a design architecture for an electronic digital computer with sub-systems consisting of a processing unit, a control unit, memory, external mass storage, and input and output mechanisms."),
        ("Memory Hierarchy", "The memory hierarchy separates computer storage into a hierarchy based on response time. Primary storage consists of registers and cache, followed by main RAM, and secondary storage like SSDs."),
        ("Virtual Memory & Paging", "Virtual memory is a memory management technique that provides an idealized abstraction of the storage resources. It maps virtual addresses to physical addresses via page tables. Page faults occur when data is not in RAM."),
        ("Process Scheduling", "Operating systems employ schedulers like Round Robin, Shortest Job First, and Multi-Level Feedback Queues to allocate CPU time slices to active threads, balancing throughput and turnaround latency."),
        ("Deadlocks & Concurrency", "A deadlock situation arises when four Coffman conditions hold: Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait. Banker's Algorithm is used for deadlock avoidance."),
        ("File Systems & Inodes", "An inode is a data structure in a Unix-style file system that describes a file-system object such as a file or directory. Each inode stores the attributes and disk block locations."),
        ("Networking & OSI Model", "The 7-layer OSI model standardizes communication functions: Physical, Data Link, Network, Transport, Session, Presentation, and Application layers. TCP guarantees reliable byte-stream delivery."),
        ("Data Structures: Trees", "A B-Tree is a self-balancing tree data structure that maintains sorted data and allows searches, sequential access, insertions, and deletions in logarithmic time. Widely used in database indexes."),
        ("Graph Algorithms", "Dijkstra algorithm computes shortest paths from a single source node in a weighted graph with non-negative edge weights. Bellman-Ford can handle negative weight edges."),
        ("Cryptography & Hash Functions", "Cryptographic hash functions like SHA-256 produce deterministic fixed-size digests. They are designed to be pre-image resistant, second pre-image resistant, and collision resistant.")
    ]

    doc = ScriptDocument(title="CS301_Systems_and_Algorithms_Syllabus.pdf", file_type="pdf")
    page_idx = 1
    for topic_name, topic_content in topics:
        # Generate 2 to 3 pages per topic to reach 25 pages total
        for p in range(1, 3 + (1 if page_idx % 2 == 0 else 0)):
            text = f"=== CHAPTER: {topic_name.upper()} (Section {p}) ===\n\n"
            text += f"{topic_content}\n\n"
            text += f"Key Engineering Principle {page_idx}: High reliability systems mandate fault isolation and proactive anomaly detection. "
            text += f"Throughput is defined as work accomplished per unit of time, whereas latency represents the delay before a transfer begins.\n\n"
            text += f"Implementation Note: Sub-system {page_idx} relies on constant-time lookups and structured error boundaries to guarantee 99.99% availability."
            
            doc.pages.append(PageContent(
                page_number=page_idx,
                text=text,
                source_type="pdf_text"
            ))
            page_idx += 1
            if page_idx > 25:
                break
        if page_idx > 25:
            break

    doc.compute_stats()
    return doc

# Pre-populate demo 25-page document
_demo_doc = create_sample_25_page_script()
DOCUMENTS_STORE[_demo_doc.id] = _demo_doc


@convert_bp.post("/api/convert/upload")
def upload_script():
    """Uploads a 20-50 page PDF or notepad text script."""
    if "file" not in request.files:
        # Support raw text payload in JSON
        data = request.get_json(silent=True) or {}
        raw_text = data.get("text", "")
        filename = data.get("filename", "notes.txt")
        if not raw_text.strip():
            return jsonify(error="No file or text payload provided."), 400
        doc = ScriptExtractor.extract_from_text(raw_text, filename=filename)
    else:
        file = request.files["file"]
        filename = file.filename or "document.pdf"
        file_bytes = file.read()
        
        if filename.lower().endswith(".pdf"):
            doc = ScriptExtractor.extract_from_pdf_bytes(file_bytes, filename=filename)
        else:
            try:
                text_content = file_bytes.decode("utf-8")
                doc = ScriptExtractor.extract_from_text(text_content, filename=filename)
            except Exception:
                return jsonify(error="Unsupported file format. Please upload a PDF or text file."), 400

    DOCUMENTS_STORE[doc.id] = doc
    clusters = ScriptChunker.cluster_document(doc, pages_per_cluster=4)

    return jsonify({
        "success": True,
        "doc_id": doc.id,
        "title": doc.title,
        "total_pages": doc.total_pages,
        "total_words": doc.total_words,
        "clusters_count": len(clusters),
        "clusters": [c.to_dict() for c in clusters],
        "is_within_recommendation": (20 <= doc.total_pages <= 50)
    })


@convert_bp.post("/api/convert/generate")
def generate_mcqs():
    """Converts the uploaded script into an ExamShield examination paper."""
    data = request.get_json(force=True) or {}
    doc_id = data.get("doc_id")
    question_count = int(data.get("question_count", 20))
    difficulty = str(data.get("difficulty", "Mixed"))
    targeted_topic = data.get("topic")
    custom_api_key = data.get("api_key")

    doc = DOCUMENTS_STORE.get(doc_id)
    if not doc:
        # If no doc found, use the standard 25-page demo document
        doc = _demo_doc

    generator = MCQGenerator(api_key=custom_api_key)
    exam_paper = generator.generate_exam_paper(
        doc=doc,
        total_questions=question_count,
        difficulty=difficulty,
        targeted_topic=targeted_topic
    )

    EXAMS_STORE[exam_paper.id] = exam_paper

    return jsonify({
        "success": True,
        "exam_id": exam_paper.id,
        "title": exam_paper.title,
        "duration_minutes": exam_paper.duration_minutes,
        "total_questions": exam_paper.total_questions,
        "questions": [q.to_dict(include_answer=False) for q in exam_paper.questions]
    })


@convert_bp.get("/api/convert/exam/<exam_id>")
def get_exam(exam_id: str):
    """Fetches candidate test view (without leaking correct answers)."""
    exam = EXAMS_STORE.get(exam_id)
    if not exam:
        return jsonify(error="Exam paper not found."), 404
    return jsonify(exam.to_candidate_view())


@convert_bp.post("/api/convert/exam/<exam_id>/submit")
def submit_exam(exam_id: str):
    """Submits answers, computes instant score, and returns complete scorecard with explanations."""
    exam = EXAMS_STORE.get(exam_id)
    if not exam:
        return jsonify(error="Exam paper not found."), 404

    payload = request.get_json(force=True) or {}
    user_answers = payload.get("answers", {}) # { "q_id": "A", ... }
    time_spent_seconds = payload.get("time_spent_seconds", 0)

    score = 0
    total = len(exam.questions)
    results = []

    for q in exam.questions:
        selected = str(user_answers.get(q.id, "")).upper().strip()
        is_correct = (selected == q.correct_answer)
        if is_correct:
            score += 1

        results.append({
            "id": q.id,
            "number": q.number,
            "question": q.question,
            "options": q.options,
            "selected_answer": selected or "Not Answered",
            "correct_answer": q.correct_answer,
            "is_correct": is_correct,
            "explanation": q.explanation,
            "source_page": q.source_page,
            "topic": q.topic
        })

    percentage = round((score / total) * 100, 1) if total > 0 else 0

    return jsonify({
        "success": True,
        "exam_id": exam.id,
        "score": score,
        "total": total,
        "percentage": percentage,
        "passed": percentage >= 60.0,
        "time_spent_seconds": time_spent_seconds,
        "review": results
    })


@convert_bp.get("/api/convert/demo-exam")
def get_or_create_demo_exam():
    """Provides an instant ready-to-take exam paper without waiting for upload."""
    demo_exam_id = "exam_demo_cs301"
    if demo_exam_id not in EXAMS_STORE:
        from .models import MCQuestion
        paper = ExamPaper(
            id=demo_exam_id,
            title="CS301 Systems Engineering & Architecture Examination",
            duration_minutes=30,
            questions=[
                MCQuestion(
                    number=1,
                    question="Which sub-system in the Von Neumann computer architecture is responsible for coordinating the execution of instructions?",
                    options={
                        "A": "Control Unit",
                        "B": "Arithmetic Logic Unit",
                        "C": "Primary Cache",
                        "D": "Direct Memory Access Controller"
                    },
                    correct_answer="A",
                    explanation="The control unit orchestrates the fetch, decode, and execute cycle in Von Neumann architecture.",
                    source_page=2,
                    topic="Computer Architecture",
                    difficulty="Medium"
                ),
                MCQuestion(
                    number=2,
                    question="In modern memory hierarchy design, which storage layer provides the lowest access latency?",
                    options={
                        "A": "Main System RAM",
                        "B": "CPU Internal Registers",
                        "C": "L3 Shared Cache",
                        "D": "Solid-State Drive (NVMe)"
                    },
                    correct_answer="B",
                    explanation="CPU registers operate at core processor frequency, offering single-cycle or sub-nanosecond access.",
                    source_page=4,
                    topic="Memory Hierarchy",
                    difficulty="Easy"
                ),
                MCQuestion(
                    number=3,
                    question="What specific event occurs in an operating system when a virtual address reference cannot be found in physical RAM?",
                    options={
                        "A": "Segmentation Fault",
                        "B": "Bus Error",
                        "C": "Page Fault",
                        "D": "Stack Overflow Exception"
                    },
                    correct_answer="C",
                    explanation="A page fault triggers the OS pager to bring the required frame from swap/disk into physical memory.",
                    source_page=6,
                    topic="Virtual Memory & Paging",
                    difficulty="Medium"
                ),
                MCQuestion(
                    number=4,
                    question="Which condition is NOT one of the four essential Coffman conditions necessary for a deadlock to occur?",
                    options={
                        "A": "Mutual Exclusion",
                        "B": "Hold and Wait",
                        "C": "Circular Wait",
                        "D": "Preemptive Resource Reclaiming"
                    },
                    correct_answer="D",
                    explanation="No Preemption (resources cannot be forcibly reclaimed) is required for deadlock; preemption prevents it.",
                    source_page=10,
                    topic="Deadlocks & Concurrency",
                    difficulty="Hard"
                ),
                MCQuestion(
                    number=5,
                    question="Why are B-Trees extensively chosen over standard binary search trees in database file storage engines?",
                    options={
                        "A": "They enforce strict LIFO stack ordering.",
                        "B": "They minimize slow disk I/O operations through a large branching factor.",
                        "C": "They eliminate all key comparison operations.",
                        "D": "They only store data in volatile main memory."
                    },
                    correct_answer="B",
                    explanation="B-Trees fit multiple keys per disk page block, reducing the depth of the tree and number of disk seeks.",
                    source_page=16,
                    topic="Data Structures & Storage",
                    difficulty="Hard"
                )
            ]
        )
        paper.total_questions = len(paper.questions)
        EXAMS_STORE[demo_exam_id] = paper

    return jsonify(EXAMS_STORE[demo_exam_id].to_candidate_view())
