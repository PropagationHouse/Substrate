"""
Substrate Authentication Module
================================
Handles username/password auth, session tokens, and OTP for QR login.
Uses only stdlib — no new dependencies (hashlib.scrypt, secrets, time).
"""

import hashlib
import secrets
import time
import threading
import os
import json
import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Password hashing (scrypt — stdlib, no bcrypt needed)
# ---------------------------------------------------------------------------

def hash_password(password: str, salt: bytes = None) -> tuple:
    """Hash a password with scrypt. Returns (hash_hex, salt_hex)."""
    if salt is None:
        salt = os.urandom(32)
    dk = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=16384, r=8, p=1, dklen=64)
    return dk.hex(), salt.hex()


def verify_password(password: str, stored_hash: str, stored_salt: str) -> bool:
    """Verify a password against a stored scrypt hash."""
    try:
        salt = bytes.fromhex(stored_salt)
        dk = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=16384, r=8, p=1, dklen=64)
        return secrets.compare_digest(dk.hex(), stored_hash)
    except Exception as e:
        logger.error(f"Password verification error: {e}")
        return False


# ---------------------------------------------------------------------------
# Session store (in-memory, thread-safe)
# ---------------------------------------------------------------------------

_SESSION_TTL = 86400  # 24 hours
_sessions = {}  # token -> { "username": str, "created": float, "last_seen": float }
_sessions_lock = threading.Lock()


def create_session(username: str) -> str:
    """Create a new session token for a user. Returns the token string."""
    token = secrets.token_hex(32)
    now = time.time()
    with _sessions_lock:
        _sessions[token] = {
            "username": username,
            "created": now,
            "last_seen": now,
        }
    return token


def validate_session(token: str) -> bool:
    """Check if a session token is valid and not expired. Updates last_seen on success."""
    if not token:
        return False
    with _sessions_lock:
        session = _sessions.get(token)
        if not session:
            return False
        now = time.time()
        if now - session["last_seen"] > _SESSION_TTL:
            del _sessions[token]
            return False
        session["last_seen"] = now
        return True


def destroy_session(token: str):
    """Invalidate a session token."""
    with _sessions_lock:
        _sessions.pop(token, None)


def cleanup_expired_sessions():
    """Remove all expired sessions."""
    now = time.time()
    with _sessions_lock:
        expired = [t for t, s in _sessions.items() if now - s["last_seen"] > _SESSION_TTL]
        for t in expired:
            del _sessions[t]


# ---------------------------------------------------------------------------
# OTP store (for QR-code mobile login)
# ---------------------------------------------------------------------------

_OTP_TTL = 60  # seconds
_otps = {}  # code -> { "created": float }
_otps_lock = threading.Lock()


def create_otp() -> str:
    """Generate a one-time password (6 chars, alphanumeric) valid for 60 seconds."""
    code = secrets.token_urlsafe(6)[:6].upper()
    with _otps_lock:
        _otps[code] = {"created": time.time()}
    return code


def validate_otp(code: str) -> bool:
    """Validate and consume a one-time password. Returns True if valid."""
    if not code:
        return False
    code = code.upper()
    with _otps_lock:
        entry = _otps.pop(code, None)
        if not entry:
            return False
        if time.time() - entry["created"] > _OTP_TTL:
            return False
        return True


def cleanup_expired_otps():
    """Remove expired OTPs."""
    now = time.time()
    with _otps_lock:
        expired = [c for c, e in _otps.items() if now - e["created"] > _OTP_TTL]
        for c in expired:
            del _otps[c]


# ---------------------------------------------------------------------------
# Config helpers — read/write auth credentials in custom_settings.json
# ---------------------------------------------------------------------------

def get_auth_config(config: dict) -> dict:
    """Extract auth section from config. Returns {} if not set."""
    if isinstance(config, dict):
        return config.get("auth", {})
    return {}


def has_credentials(config: dict) -> bool:
    """Check if auth credentials have been configured."""
    auth = get_auth_config(config)
    return bool(auth.get("username") and auth.get("password_hash") and auth.get("password_salt"))


def set_credentials(config: dict, username: str, password: str) -> dict:
    """Set username/password in config dict. Returns the updated config."""
    pw_hash, pw_salt = hash_password(password)
    if not isinstance(config, dict):
        config = {}
    config["auth"] = {
        "username": username,
        "password_hash": pw_hash,
        "password_salt": pw_salt,
    }
    return config


def authenticate(config: dict, username: str, password: str) -> bool:
    """Validate username/password against stored credentials."""
    auth = get_auth_config(config)
    stored_user = auth.get("username", "")
    stored_hash = auth.get("password_hash", "")
    stored_salt = auth.get("password_salt", "")
    if not stored_user or not stored_hash or not stored_salt:
        return False
    if not secrets.compare_digest(username, stored_user):
        return False
    return verify_password(password, stored_hash, stored_salt)
