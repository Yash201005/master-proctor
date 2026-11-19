import os
from pathlib import Path

# Automatically load environment variables from root .env file if it exists
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    try:
        with open(_env_path, "r", encoding="utf-8") as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.split("=", 1)
                    os.environ.setdefault(_k.strip(), _v.strip().strip("'\""))
    except Exception:
        pass

# Google Gemini API Key (loaded securely from environment or .env)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# Active Gemini models in order of priority (verified working)
GEMINI_MODELS = [
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview"
]

REQUEST_TIMEOUT = 12

# Script constraints & defaults
MIN_PAGES = 20
MAX_PAGES = 50
DEFAULT_CHUNK_PAGES = 4     # 4 pages per cluster (approx 5-12 clusters for 20-50 pages)
DEFAULT_QUESTION_COUNT = 10 # 10 questions standard exam paper
DEFAULT_EXAM_DURATION_MINUTES = 30
