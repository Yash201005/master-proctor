@echo off
REM One-click setup for ID Card Reader (needs Python 3.10.x and Tesseract installed)
setlocal

where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher "py" not found. Install Python 3.10.11 first.
  exit /b 1
)

py -3.10 --version || (echo Python 3.10 not found. Install 3.10.11. & exit /b 1)

if not exist .venv (
  py -3.10 -m venv .venv || exit /b 1
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt || exit /b 1

if not exist "C:\Program Files\Tesseract-OCR\tesseract.exe" (
  echo.
  echo [!] Tesseract not found at the default location.
  echo     Install it from https://github.com/UB-Mannheim/tesseract/wiki
  echo     or pass --tesseract-cmd "path\to\tesseract.exe" when running.
)

echo.
echo Setup done. Try:
echo   .venv\Scripts\activate
echo   python main.py -i path\to\card.jpg --show-text
endlocal
