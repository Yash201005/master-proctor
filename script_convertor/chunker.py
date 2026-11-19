import math
from typing import List, Dict, Any
from .models import ScriptDocument, PageContent
from .config import DEFAULT_CHUNK_PAGES

class TopicCluster:
    def __init__(self, cluster_id: int, start_page: int, end_page: int, pages: List[PageContent]):
        self.cluster_id = cluster_id
        self.start_page = start_page
        self.end_page = end_page
        self.pages = pages
        self.combined_text = "\n\n".join([f"--- [Page {p.page_number}] ---\n{p.text}" for p in pages])
        self.word_count = sum(p.word_count for p in pages)
        self.title = f"Topic Section {cluster_id} (Pages {start_page}–{end_page})"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cluster_id": self.cluster_id,
            "title": self.title,
            "start_page": self.start_page,
            "end_page": self.end_page,
            "word_count": self.word_count,
            "page_count": len(self.pages)
        }

class ScriptChunker:
    """
    Groups 20 to 50 pages into coherent multi-page clusters so questions
    are evenly distributed across the entire document without topic bias.
    """

    @staticmethod
    def cluster_document(doc: ScriptDocument, pages_per_cluster: int = DEFAULT_CHUNK_PAGES) -> List[TopicCluster]:
        if not doc.pages:
            return []

        clusters: List[TopicCluster] = []
        total = len(doc.pages)
        
        # Determine number of clusters
        num_clusters = max(1, math.ceil(total / pages_per_cluster))
        
        for i in range(num_clusters):
            start_idx = i * pages_per_cluster
            end_idx = min(total, (i + 1) * pages_per_cluster)
            sub_pages = doc.pages[start_idx:end_idx]
            if sub_pages:
                cluster = TopicCluster(
                    cluster_id=i + 1,
                    start_page=sub_pages[0].page_number,
                    end_page=sub_pages[-1].page_number,
                    pages=sub_pages
                )
                clusters.append(cluster)

        return clusters
