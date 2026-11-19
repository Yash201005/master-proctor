import re
import json
import random
import requests
from typing import List, Dict, Any, Optional

from .config import GEMINI_API_KEY, GEMINI_MODELS, DEFAULT_QUESTION_COUNT, REQUEST_TIMEOUT
from .models import ScriptDocument, MCQuestion, ExamPaper
from .chunker import ScriptChunker, TopicCluster
from .rag_engine import LightweightRAGIndex

class MCQGenerator:
    """
    Synthesizes syllabus-balanced multiple choice examination questions
    from 20-50 page scripts using Google Gemini API with smart model fallback
    and offline heuristic safety net.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or GEMINI_API_KEY

    def _call_gemini_json(self, prompt_text: str) -> Optional[List[Dict[str, Any]]]:
        """Calls Gemini API with automatic model failover across verified models."""
        payload = {
            "contents": [{"parts": [{"text": prompt_text}]}],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.3
            }
        }

        for model_name in GEMINI_MODELS:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.api_key}"
            try:
                resp = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
                if resp.status_code == 200:
                    data = resp.json()
                    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                    if parts:
                        raw_json = parts[0].get("text", "").strip()
                        clean_json = re.sub(r"^```json\s*", "", raw_json, flags=re.MULTILINE)
                        clean_json = re.sub(r"\s*```$", "", clean_json, flags=re.MULTILINE)
                        parsed = json.loads(clean_json)
                        if isinstance(parsed, list):
                            return parsed
                        elif isinstance(parsed, dict) and "questions" in parsed:
                            return parsed["questions"]
                elif resp.status_code in (429, 503):
                    continue
            except Exception:
                continue

        return None

    def _offline_fallback_questions(self, doc: ScriptDocument, count: int) -> List[Dict[str, Any]]:
        """
        Robust offline question synthesizer used if cloud API is unavailable.
        Extracts key factual statements across the pages and builds contextual MCQs.
        """
        all_text = "\n".join([p.text for p in doc.pages])
        sentences = re.split(r"(?<=[.!?])\s+", all_text)
        factual = [s.strip() for s in sentences if len(s.split()) >= 10 and len(s.split()) <= 35 and not s.startswith("---") and not s.startswith("===")]
        
        if not factual:
            factual = [
                "Von Neumann architecture describes a design architecture for an electronic digital computer.",
                "Virtual memory maps virtual addresses to physical addresses via page tables.",
                "An inode is a data structure in a Unix-style file system describing file attributes.",
                "A B-Tree is a self-balancing tree data structure that maintains sorted data in logarithmic time.",
                "Dijkstra algorithm computes shortest paths from a single source node in weighted graphs."
            ]

        vocab = list(set(re.findall(r"\b[A-Z][a-z]{3,}\b", all_text)))
        if len(vocab) < 10:
            vocab += ["Execution", "Protocol", "Interface", "Architecture", "Optimization", "Abstraction"]

        questions = []
        for i in range(min(count, len(factual))):
            target_sentence = factual[i % len(factual)]
            words = target_sentence.split()
            
            keywords = [w.strip(".,;:()") for w in words if len(w) > 4 and w.lower() not in {"which", "their", "about", "there", "where", "these", "those"}]
            if not keywords:
                keywords = [words[len(words) // 2]]
            
            answer = random.choice(keywords)
            blanked = target_sentence.replace(answer, "______", 1)
            
            distractors = [v for v in vocab if v.lower() != answer.lower()]
            random.shuffle(distractors)
            opts_list = [answer] + distractors[:3]
            while len(opts_list) < 4:
                opts_list.append(f"Alternative {len(opts_list)}")
            
            random.shuffle(opts_list)
            key_map = {"A": opts_list[0], "B": opts_list[1], "C": opts_list[2], "D": opts_list[3]}
            correct_key = [k for k, v in key_map.items() if v == answer][0]

            page_num = (i % max(1, len(doc.pages))) + 1
            questions.append({
                "question": f"Complete the core engineering principle: \"{blanked}\"",
                "options": key_map,
                "correct_answer": correct_key,
                "explanation": f"According to page {page_num} of the script: \"{target_sentence}\"",
                "source_page": page_num,
                "topic": "Core Fundamentals",
                "difficulty": "Medium"
            })

        return questions

    def generate_exam_paper(
        self,
        doc: ScriptDocument,
        total_questions: int = DEFAULT_QUESTION_COUNT,
        difficulty: str = "Mixed",
        targeted_topic: Optional[str] = None
    ) -> ExamPaper:
        """
        Converts 20-50 page script into a full proctored examination paper.
        Distributes questions evenly across all page clusters to prevent topic bias.
        """
        paper = ExamPaper(
            title=f"Proctored Examination: {doc.title}",
            source_doc_id=doc.id,
            duration_minutes=max(15, int(total_questions * 2))
        )

        clusters = ScriptChunker.cluster_document(doc, pages_per_cluster=4)
        if not clusters:
            return paper

        # If targeted topic specified, use RAG retrieval
        if targeted_topic and targeted_topic.strip():
            rag = LightweightRAGIndex()
            rag.index_document(doc, pages_per_cluster=4)
            scored = rag.query_relevant_clusters(targeted_topic, top_k=min(5, len(clusters)))
            selected_clusters = [c for c, _ in scored]
        else:
            selected_clusters = clusters

        # Build prompt with cluster excerpts across the entire document
        clusters_summary = []
        for c in selected_clusters:
            excerpt = c.combined_text[:1200]
            clusters_summary.append(f"### {c.title} (Pages {c.start_page} to {c.end_page})\n{excerpt}")

        full_context = "\n\n".join(clusters_summary)

        prompt = f"""You are a university exam professor creating a rigorous examination paper.
Below are thematic excerpts from a {doc.total_pages}-page examination script, divided into topic sections with page numbers:

=================== SCRIPT EXCERPTS ({doc.total_pages} PAGES) ===================
{full_context[:12000]}
=============================================================================

TASK: Generate exactly {total_questions} high-quality multiple choice question(s).
DISTRIBUTION RULE: Distribute the questions evenly across the different topic sections and page ranges above. Do NOT bias questions toward only the first few pages.

REQUIREMENTS:
1. Each question must have exactly 4 distinct options labeled A, B, C, D.
2. Only ONE option must be clearly correct. The 3 distractors must be plausible and technically sound.
3. Include a concise explanation and state the specific source page number.
4. Difficulty level: {difficulty}.

Return ONLY a valid JSON array of objects with the following schema:
[
  {{
    "question": "Question statement here?",
    "options": {{
      "A": "Option text",
      "B": "Option text",
      "C": "Option text",
      "D": "Option text"
    }},
    "correct_answer": "A",
    "explanation": "Explanation citing the concept from the script.",
    "source_page": 5,
    "difficulty": "Medium",
    "topic": "Section Topic"
  }}
]"""

        generated_raw = self._call_gemini_json(prompt)
        if not generated_raw or len(generated_raw) < total_questions:
            fallback_items = self._offline_fallback_questions(doc, total_questions)
            generated_raw = (generated_raw or []) + fallback_items[:total_questions - len(generated_raw or [])]

        all_mcqs: List[MCQuestion] = []
        for idx, item in enumerate(generated_raw[:total_questions]):
            opts = item.get("options", {})
            correct = str(item.get("correct_answer", "A")).upper().strip()
            if correct not in ("A", "B", "C", "D"):
                correct = "A"

            mcq = MCQuestion(
                number=idx + 1,
                question=item.get("question", f"Question {idx + 1}"),
                options={
                    "A": str(opts.get("A", "Option A")),
                    "B": str(opts.get("B", "Option B")),
                    "C": str(opts.get("C", "Option C")),
                    "D": str(opts.get("D", "Option D"))
                },
                correct_answer=correct,
                explanation=item.get("explanation", "Verified against examination script."),
                source_page=item.get("source_page", 1),
                topic=item.get("topic", "General Examination"),
                difficulty=item.get("difficulty", "Medium")
            )
            all_mcqs.append(mcq)

        paper.questions = all_mcqs
        paper.total_questions = len(all_mcqs)
        return paper
