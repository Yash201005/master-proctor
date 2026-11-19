import re
import math
from typing import List, Dict, Tuple, Any
from collections import Counter
from .models import ScriptDocument
from .chunker import TopicCluster, ScriptChunker

class LightweightRAGIndex:
    """
    In-memory vector retrieval index for 20-50 page examination scripts.
    Computes sub-linear term frequency / inverse document frequency (TF-IDF)
    vectors and cosine similarity to quickly match queries with specific pages.
    """

    def __init__(self):
        self.doc_id: str = ""
        self.clusters: List[TopicCluster] = []
        self.vocabulary: Dict[str, int] = {}
        self.idf: Dict[str, float] = {}
        self.cluster_vectors: List[Dict[str, float]] = []

    def _tokenize(self, text: str) -> List[str]:
        words = re.findall(r"[a-zA-Z0-9_\-\+]+", text.lower())
        # Filter short noise
        return [w for w in words if len(w) > 2 and not w.isdigit()]

    def index_document(self, doc: ScriptDocument, pages_per_cluster: int = 4):
        self.doc_id = doc.id
        self.clusters = ScriptChunker.cluster_document(doc, pages_per_cluster=pages_per_cluster)
        
        N = len(self.clusters)
        if N == 0:
            return

        # 1. Compute Document Frequencies
        df: Counter = Counter()
        cluster_tokens = []
        for c in self.clusters:
            tokens = set(self._tokenize(c.combined_text))
            cluster_tokens.append(tokens)
            df.update(tokens)

        # 2. Compute IDF
        self.idf = {word: math.log((N + 1.0) / (freq + 1.0)) + 1.0 for word, freq in df.items()}

        # 3. Compute TF-IDF vectors
        self.cluster_vectors = []
        for c in self.clusters:
            words = self._tokenize(c.combined_text)
            tf = Counter(words)
            vec: Dict[str, float] = {}
            norm = 0.0
            for w, count in tf.items():
                tfidf = (1.0 + math.log(count)) * self.idf.get(w, 1.0)
                vec[w] = tfidf
                norm += tfidf * tfidf
            norm = math.sqrt(norm) if norm > 0 else 1.0
            # Normalize vector
            for w in vec:
                vec[w] /= norm
            self.cluster_vectors.append(vec)

    def query_relevant_clusters(self, query: str, top_k: int = 3) -> List[Tuple[TopicCluster, float]]:
        """
        Ranks clusters against a search query using cosine similarity.
        """
        if not self.cluster_vectors or not query.strip():
            return [(c, 1.0) for c in self.clusters[:top_k]]

        q_words = self._tokenize(query)
        if not q_words:
            return [(c, 1.0) for c in self.clusters[:top_k]]

        # Compute query vector
        q_tf = Counter(q_words)
        q_vec: Dict[str, float] = {}
        q_norm = 0.0
        for w, count in q_tf.items():
            tfidf = (1.0 + math.log(count)) * self.idf.get(w, 1.0)
            q_vec[w] = tfidf
            q_norm += tfidf * tfidf
        q_norm = math.sqrt(q_norm) if q_norm > 0 else 1.0
        for w in q_vec:
            q_vec[w] /= q_norm

        # Score clusters
        scores: List[Tuple[int, float]] = []
        for idx, c_vec in enumerate(self.cluster_vectors):
            dot_product = sum(weight * c_vec.get(w, 0.0) for w, weight in q_vec.items())
            scores.append((idx, dot_product))

        scores.sort(key=lambda x: x[1], reverse=True)
        results = []
        for idx, score in scores[:top_k]:
            results.append((self.clusters[idx], round(score, 4)))

        return results
