# ExamShield

Browser-based suspicious-activity detection and proctor dashboard (React/Vite/TS/Tailwind + FastAPI/SQLAlchemy/PostgreSQL).
It records objective activity for **human review**; it never declares misconduct.

## Seed accounts (development only)
| Role | Username | Password |
|---|---|---|
| Candidate | candidate1 / candidate2 | candidate123 |
| Proctor | proctor1 | proctor123 |

## Docker
```
docker compose up --build
```
Frontend http://localhost:5173 · API http://localhost:8000/docs

## Windows PowerShell (local)
```powershell
# Backend (uses SQLite unless DATABASE_URL is set)
cd backend
py -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest
uvicorn app.main:app --reload --port 8000
# Frontend (new terminal)
cd frontend
npm install
npm test
npm run build
npm run dev
```
For PostgreSQL set `$env:DATABASE_URL="postgresql+psycopg2://examshield:examshield@localhost:5432/examshield"` and `$env:JWT_SECRET="..."`.

## Layout
`frontend/src/detection/` independent detectors (keyboard, clipboard, contextmenu, drag, fullscreen, focus/visibility, devtools heuristic, navigation, network heartbeat) · `backend/app/main.py` API, auth, WebSocket hub · `database/schema.sql` reference schema.

## Limitations
- Browsers cannot observe most OS/browser-level shortcuts (Alt+Tab, Win+D/L/E/Tab, Ctrl+T/N/W, Alt+F4 are often swallowed). Those are only logged if the key event is actually delivered; otherwise only indirect evidence (focus loss, visibility, fullscreen exit) is recorded, marked INFERRED.
- DevTools detection by window size is a heuristic (DEVTOOLS_SUSPECTED). External cameras, phones and outside screenshots cannot be detected.
- Clipboard content is never stored.
- Tables are created at startup via SQLAlchemy; Alembic is listed in requirements but no migration scripts are included (use `database/schema.sql`).
- Seed passwords and the default JWT secret are for development; change them for any real use.
