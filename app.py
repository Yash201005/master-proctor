#!/usr/bin/env python
"""
Web server for the ID scanner & Proctoring Verification UI.
Runs: python app.py -> http://127.0.0.1:5051

Security Features:
  * Passwords hashed with PBKDF2-HMAC-SHA256 (100,000 iterations + random 16-byte salt).
  * Zero password storage or exposure on the frontend.
  * Ephemeral bearer session tokens with server-side validation.
  * Thread-safe sliding-window rate limiting on login & password reset with automatic lockout cooldowns.
  * Stateless, in-memory image processing with zero disk persistence.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from flask import Flask, jsonify, request, send_from_directory

import ocr_engines as oe
from classifier import classify
from extractor import extract_one, merge

PROJECT_DIR = Path(__file__).resolve().parent
app = Flask(__name__)
LOCK = threading.Lock()  # PaddleOCR is not thread-safe
CFG = {"tess": None}
NO_OCR = "The OCR engine is not available. Retry, upload another file, or use demo data."


# =========================================================================== #
# Security: Sliding-Window Rate Limiter with Automatic Lockout
# =========================================================================== #
class RateLimiter:
    """
    Thread-safe sliding-window rate limiter with temporary lockouts.
    Tracks failed attempts within a rolling window and enforces a cooldown when exceeded.
    """

    def __init__(self, max_attempts: int = 5, window_seconds: int = 60, lockout_seconds: int = 60):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.lockout_seconds = lockout_seconds
        self.history: Dict[str, List[float]] = {}
        self.lockouts: Dict[str, float] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> Tuple[bool, int]:
        """
        Checks if the request is permitted.
        Returns: (is_allowed, retry_after_seconds)
        """
        with self._lock:
            now = time.time()
            # 1. Check active lockout
            if key in self.lockouts:
                unlock_at = self.lockouts[key]
                if now < unlock_at:
                    return False, int(unlock_at - now) + 1
                # Lockout expired -> clean up
                del self.lockouts[key]
                self.history[key] = []

            # 2. Prune old timestamps outside rolling window
            timestamps = [t for t in self.history.get(key, []) if now - t < self.window_seconds]
            self.history[key] = timestamps

            if len(timestamps) >= self.max_attempts:
                # Trigger new lockout
                self.lockouts[key] = now + self.lockout_seconds
                self.history[key] = []
                return False, self.lockout_seconds

            return True, 0

    def record_failure(self, key: str) -> Tuple[bool, int, int]:
        """
        Records a failed attempt.
        Returns: (is_locked_out, remaining_attempts, retry_after_seconds)
        """
        with self._lock:
            now = time.time()
            timestamps = [t for t in self.history.get(key, []) if now - t < self.window_seconds]
            timestamps.append(now)
            self.history[key] = timestamps

            if len(timestamps) >= self.max_attempts:
                self.lockouts[key] = now + self.lockout_seconds
                self.history[key] = []
                return True, 0, self.lockout_seconds

            remaining = max(0, self.max_attempts - len(timestamps))
            return False, remaining, 0

    def record_success(self, key: str) -> None:
        """Clears failure history upon successful authentication."""
        with self._lock:
            self.history.pop(key, None)
            self.lockouts.pop(key, None)


# Instantiate Rate Limiters
# Login: Max 5 failed attempts per 60s -> 60s lockout
LOGIN_LIMITER = RateLimiter(max_attempts=5, window_seconds=60, lockout_seconds=60)
# Password Reset: Max 3 requests per 60s -> 60s lockout
RESET_LIMITER = RateLimiter(max_attempts=3, window_seconds=60, lockout_seconds=60)


# =========================================================================== #
# Security: Password Hashing (PBKDF2-HMAC-SHA256)
# =========================================================================== #
def hash_password(password: str, salt: Optional[bytes] = None) -> Tuple[str, str]:
    """Generates a secure PBKDF2-HMAC-SHA256 hash with a cryptographically random salt."""
    if salt is None:
        salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return derived.hex(), salt.hex()


def verify_password(password: str, stored_hash: str, stored_salt: str) -> bool:
    """Verifies a password against the stored salt & hash in constant time."""
    try:
        salt_bytes = bytes.fromhex(stored_salt)
        derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_bytes, 100_000)
        return hmac.compare_digest(derived.hex(), stored_hash)
    except Exception:
        return False


# In-Memory Authorized User Accounts (Passwords are never sent to the client)
# Default demo user: jane.doe@university.edu / Candidate2026!
_initial_hash, _initial_salt = hash_password("Candidate2026!")
USERS_DB: Dict[str, Dict[str, Any]] = {
    "jane.doe@university.edu": {
        "email": "jane.doe@university.edu",
        "name": "Jane Doe",
        "examCode": "EXAM-2026-CS101",
        "password_hash": _initial_hash,
        "password_salt": _initial_salt,
        "role": "candidate",
    },
    "test.reset@university.edu": {
        "email": "test.reset@university.edu",
        "name": "Test Candidate",
        "examCode": "EXAM-2026-TEST",
        "password_hash": _initial_hash,
        "password_salt": _initial_salt,
        "role": "candidate",
    },
}

# Active Session Store: token -> {email, name, examCode, expires_at}
SESSIONS: Dict[str, Dict[str, Any]] = {}
SESSION_TTL_SECONDS = 12 * 3600  # 12 hours


def get_client_ip() -> str:
    """Extracts client IP respecting proxy headers if available."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "127.0.0.1"


def get_current_user() -> Optional[Dict[str, Any]]:
    """Validates session token from Authorization: Bearer <token> or X-Auth-Token header."""
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    elif request.headers.get("X-Auth-Token"):
        token = request.headers.get("X-Auth-Token", "").strip()

    if not token or token not in SESSIONS:
        return None

    sess = SESSIONS[token]
    if time.time() > sess["expires_at"]:
        del SESSIONS[token]
        return None

    return sess


# =========================================================================== #
# Static & Page Routes & Script Converter Engine
# =========================================================================== #
from script_convertor.api import convert_bp
app.register_blueprint(convert_bp)


@app.get("/")
def index():
    return send_from_directory(PROJECT_DIR, "index.html")


@app.get("/exam-player")
def exam_player_page():
    return send_from_directory(PROJECT_DIR / "script_convertor", "exam_player.html")


@app.get("/script_convertor/<path:filename>")
def script_convertor_static(filename: str):
    return send_from_directory(PROJECT_DIR / "script_convertor", filename)


@app.get("/<path:filename>")
def frontend_file(filename: str):
    return send_from_directory(PROJECT_DIR, filename)


# =========================================================================== #
# Authentication Endpoints (With Rate Limiting & Zero Frontend Password Storage)
# =========================================================================== #
@app.post("/api/auth/login")
def auth_login():
    """
    Authenticates candidate with email & password.
    Enforces rate-limiting: max 5 failed attempts per 60s per client IP / email.
    Returns ephemeral session token on success. Never returns password hashes.
    """
    ip = get_client_ip()
    try:
        data = request.get_json(force=True) or {}
    except Exception:
        return jsonify(error="Invalid JSON request body."), 400

    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not email or not password:
        return jsonify(error="Email address and password are required."), 400

    rate_key = f"{ip}:{email}"

    # 1. Check rate limit
    allowed, retry_after = LOGIN_LIMITER.check(rate_key)
    if not allowed:
        resp = jsonify(
            error="Please try again later.",
            retry_after=retry_after,
            locked=True,
        )
        resp.headers["Retry-After"] = str(retry_after)
        return resp, 429

    # 2. Validate credentials
    user = USERS_DB.get(email)
    if not user or not verify_password(password, user["password_hash"], user["password_salt"]):
        is_locked, remaining, retry_secs = LOGIN_LIMITER.record_failure(rate_key)
        if is_locked:
            resp = jsonify(
                error="Please try again later.",
                retry_after=retry_secs,
                locked=True,
            )
            resp.headers["Retry-After"] = str(retry_secs)
            return resp, 429

        return jsonify(
            error="Email or password is wrong.",
            remaining_attempts=remaining,
            locked=False,
        ), 401

    # 3. Success -> Clear rate limiting history & generate secure token
    LOGIN_LIMITER.record_success(rate_key)
    session_token = secrets.token_urlsafe(32)
    SESSIONS[session_token] = {
        "email": user["email"],
        "name": user["name"],
        "examCode": user["examCode"],
        "role": user["role"],
        "expires_at": time.time() + SESSION_TTL_SECONDS,
    }

    return jsonify(
        success=True,
        message="Authentication successful.",
        token=session_token,
        user={
            "email": user["email"],
            "name": user["name"],
            "examCode": user["examCode"],
            "role": user["role"],
        },
    )


@app.post("/api/auth/reset-password")
def auth_reset_password():
    """
    Rate-limited password reset endpoint.
    Enforces rate-limiting: max 3 requests per 60s per client IP / email.
    Securely re-hashes password on backend with fresh salt.
    """
    ip = get_client_ip()
    try:
        data = request.get_json(force=True) or {}
    except Exception:
        return jsonify(error="Invalid JSON request body."), 400

    email = str(data.get("email", "")).strip().lower()
    new_password = str(data.get("new_password", ""))

    if not email or not new_password:
        return jsonify(error="Email address and new password are required."), 400

    if len(new_password) < 8:
        return jsonify(error="Password must be at least 8 characters in length."), 400

    rate_key = f"reset:{ip}:{email}"

    # 1. Check rate limit
    allowed, retry_after = RESET_LIMITER.check(rate_key)
    if not allowed:
        resp = jsonify(
            error="Please try again later.",
            retry_after=retry_after,
            locked=True,
        )
        resp.headers["Retry-After"] = str(retry_after)
        return resp, 429

    # Record request in rate limiter
    is_locked, remaining, retry_secs = RESET_LIMITER.record_failure(rate_key)
    if is_locked:
        resp = jsonify(
            error="Please try again later.",
            retry_after=retry_secs,
            locked=True,
        )
        resp.headers["Retry-After"] = str(retry_secs)
        return resp, 429

    # 2. Verify user exists
    user = USERS_DB.get(email)
    if not user:
        # Generic safe response to prevent email enumeration
        return jsonify(
            success=True,
            message="If that account exists in the examination directory, the password has been reset.",
        )

    # 3. Update password hash on backend
    new_hash, new_salt = hash_password(new_password)
    user["password_hash"] = new_hash
    user["password_salt"] = new_salt

    # Invalidate existing sessions for this user
    tokens_to_drop = [tok for tok, s in SESSIONS.items() if s.get("email") == email]
    for tok in tokens_to_drop:
        SESSIONS.pop(tok, None)

    return jsonify(
        success=True,
        message="Password has been successfully updated. You may now log in with your new credentials.",
    )


@app.get("/api/auth/session")
def auth_session():
    """Validates the active session token and returns candidate session meta."""
    user = get_current_user()
    if not user:
        return jsonify(authenticated=False, error="Session invalid or expired."), 401

    return jsonify(
        authenticated=True,
        user={
            "email": user["email"],
            "name": user["name"],
            "examCode": user["examCode"],
            "role": user["role"],
        },
    )


@app.post("/api/auth/logout")
def auth_logout():
    """Revokes session token."""
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    elif request.headers.get("X-Auth-Token"):
        token = request.headers.get("X-Auth-Token", "").strip()

    if token in SESSIONS:
        del SESSIONS[token]

    return jsonify(success=True, message="Signed out successfully.")


# =========================================================================== #
# Document OCR & Inspection API (Dual Engine: PaddleOCR + Tesseract)
# =========================================================================== #
@app.post("/api/scan")
def scan():
    try:
        payload = request.get_json(force=True)
        side = payload.get("side", "unknown")
        b64 = payload["image"].split(",", 1)[-1]
        img = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("unreadable image")
    except Exception as e:  # noqa: BLE001
        return jsonify(error=f"Could not read that image ({e}). Try another file."), 400

    warnings = []
    with LOCK:
        angle = 0
        try:
            angle = oe.detect_rotation(img, CFG["tess"])
        except Exception as e:  # noqa: BLE001
            warnings.append(f"rotation skipped: {e}")
        img = oe.rotate(img, angle)
        res = {"paddle": oe.run_paddle(img), "tesseract": oe.run_tesseract(img, CFG["tess"])}

    for k, r in res.items():
        if r.error:
            warnings.append(f"{k}: {r.error}")
    if all(r.error for r in res.values()):
        return jsonify(error=NO_OCR, warnings=warnings), 503

    ok = {k: r for k, r in res.items() if not r.error and r.lines}
    cls = classify("\n".join(r.full_text for r in ok.values()))
    fields = (
        merge({k: extract_one([l.text for l in r.lines], r.extra, cls["doc_type"]) for k, r in ok.items()})
        if ok
        else {}
    )
    return jsonify(
        side=side,
        doc_type=cls["doc_type"],
        doc_type_label=cls["doc_type_label"],
        confidence=cls["confidence"],
        is_hybrid=cls["is_hybrid"],
        secondary_types=cls["secondary_types"],
        side_hint=cls["side_hint"],
        rotation=angle,
        fields=fields,
        text_detected=any(r.lines for r in ok.values()),
        warnings=warnings,
    )


def warm_up():
    try:
        oe.run_paddle(np.full((200, 400, 3), 255, np.uint8))
        print("PaddleOCR ready.")
    except Exception as e:  # noqa: BLE001
        print("PaddleOCR warm-up failed:", e)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tesseract-cmd", default=None)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=5051)
    a = ap.parse_args()
    CFG["tess"] = a.tesseract_cmd
    threading.Thread(target=warm_up, daemon=True).start()
    print(f"Open http://{a.host}:{a.port}")
    app.run(host=a.host, port=a.port, threaded=True)
