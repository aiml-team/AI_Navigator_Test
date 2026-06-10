"""
services/cache.py
─────────────────
Thin Redis caching layer for AI Navigator.

Connection:  Prefers explicit REDIS_HOST / REDIS_PORT / REDIS_PASSWORD / REDIS_SSL env vars
             (Azure Cache for Redis style). Falls back to REDIS_URL for backward compatibility.

Failure mode: If Redis is unreachable, every function is a no-op / returns None so the app
              continues working using the DB as the source of truth.

Cache domains
─────────────
  tools:registry              → full AI_TOOLS_REGISTRY dict
  tools:registered_list       → list of rows from registered_tools table
  user:tool_prefs:<email>     → list of tool access rows for one user
  user:default_role:<email>   → saved default role string for one user
  audit:list:<email>:<limit>  → paginated audit list (legacy)
  audit:record:<id>           → single audit record (legacy)
"""

import json
import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Singleton Redis client ─────────────────────────────────────
_redis_client = None
_redis_checked = False

# ── TTLs ──────────────────────────────────────────────────────
TTL              = int(os.getenv("REDIS_TTL_SECONDS",    "300"))
AUDIT_LIST_TTL   = int(os.getenv("REDIS_AUDIT_LIST_TTL",  "60"))
AUDIT_RECORD_TTL = int(os.getenv("REDIS_AUDIT_RECORD_TTL","300"))

# ── Cache keys ─────────────────────────────────────────────────
_KEY_TOOL_REGISTRY    = "tools:registry"
_KEY_REGISTERED_LIST  = "tools:registered_list"


def get_redis():
    """
    Return a connected Redis client, or None if Redis is unavailable.
    Initialised once per process; subsequent calls return the cached client.
    """
    global _redis_client, _redis_checked
    if _redis_checked:
        return _redis_client
    _redis_checked = True

    host     = os.getenv("REDIS_HOST", "").strip()
    port     = int(os.getenv("REDIS_PORT", "6380"))
    password = os.getenv("REDIS_PASSWORD", "").strip()
    ssl      = os.getenv("REDIS_SSL", "true").lower() in ("true", "1", "yes")
    db       = int(os.getenv("REDIS_DB", "0"))
    url      = os.getenv("REDIS_URL", "").strip()

    if not host and not url:
        logger.info("[cache] Redis not configured — caching disabled.")
        return None

    try:
        import redis as _redis

        if host:
            _redis_client = _redis.Redis(
                host=host,
                port=port,
                password=password or None,
                ssl=ssl,
                ssl_cert_reqs=None,
                db=db,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
            )
            label = f"{host}:{port}/db{db}"
        else:
            kwargs: dict = dict(decode_responses=True, socket_connect_timeout=5, socket_timeout=5)
            if url.startswith("rediss://"):
                kwargs["ssl_cert_reqs"] = None
            _redis_client = _redis.Redis.from_url(url, **kwargs)
            label = url.split("@")[-1]

        _redis_client.ping()
        logger.info("[cache] Redis connected: %s", label)

    except Exception as exc:
        logger.warning("[cache] Redis unavailable — caching disabled. Reason: %s", exc)
        _redis_client = None

    return _redis_client


# ── Generic helpers ────────────────────────────────────────────

def _get_json(key: str) -> Optional[Any]:
    r = get_redis()
    if not r:
        return None
    try:
        raw = r.get(key)
        return json.loads(raw) if raw is not None else None
    except Exception as exc:
        logger.warning("[cache] GET %s error: %s", key, exc)
        return None


def _set_json(key: str, value: Any, ttl: int = TTL) -> None:
    r = get_redis()
    if not r:
        return
    try:
        r.setex(key, ttl, json.dumps(value, default=str))
    except Exception as exc:
        logger.warning("[cache] SET %s error: %s", key, exc)


def _delete(*keys: str) -> None:
    r = get_redis()
    if not r:
        return
    try:
        r.delete(*keys)
    except Exception as exc:
        logger.warning("[cache] DEL %s error: %s", keys, exc)


def _delete_pattern(pattern: str) -> None:
    r = get_redis()
    if not r:
        return
    try:
        keys = r.keys(pattern)
        if keys:
            r.delete(*keys)
    except Exception as exc:
        logger.warning("[cache] DEL pattern %s error: %s", pattern, exc)


# ── Tool Registry ──────────────────────────────────────────────

def get_tool_registry() -> Optional[dict]:
    return _get_json(_KEY_TOOL_REGISTRY)


def set_tool_registry(data: dict) -> None:
    _set_json(_KEY_TOOL_REGISTRY, data)


def invalidate_tool_registry() -> None:
    _delete(_KEY_TOOL_REGISTRY, _KEY_REGISTERED_LIST)


# ── Registered Tools List ──────────────────────────────────────

def get_registered_list() -> Optional[list]:
    return _get_json(_KEY_REGISTERED_LIST)


def set_registered_list(data: list) -> None:
    _set_json(_KEY_REGISTERED_LIST, data)


def invalidate_registered_list() -> None:
    _delete(_KEY_REGISTERED_LIST)


# ── User Tool Access Preferences ───────────────────────────────

def _key_user_tool_prefs(email: str) -> str:
    return f"user:tool_prefs:{email.strip().lower()}"


def get_user_tool_prefs(email: str) -> Optional[list]:
    return _get_json(_key_user_tool_prefs(email))


def set_user_tool_prefs(email: str, data: list) -> None:
    _set_json(_key_user_tool_prefs(email), data)


def invalidate_user_tool_prefs(email: str) -> None:
    _delete(_key_user_tool_prefs(email))


# ── User Default Role ──────────────────────────────────────────

def _key_user_default_role(email: str) -> str:
    return f"user:default_role:{email.strip().lower()}"


def get_user_default_role(email: str) -> Optional[str]:
    """
    Returns the cached role string, '' if cached as empty, or None if not cached.
    Callers must distinguish None (cache miss → go to DB) from '' (cached empty string).
    """
    r = get_redis()
    if not r:
        return None
    try:
        val = r.get(_key_user_default_role(email))
        return val  # None = miss; '' or role string = hit
    except Exception as exc:
        logger.warning("[cache] GET user_default_role error: %s", exc)
        return None


def set_user_default_role(email: str, role: str) -> None:
    r = get_redis()
    if not r:
        return
    try:
        r.setex(_key_user_default_role(email), TTL, role or "")
    except Exception as exc:
        logger.warning("[cache] SET user_default_role error: %s", exc)


def invalidate_user_default_role(email: str) -> None:
    _delete(_key_user_default_role(email))


# ── Audit List / Record (legacy) ───────────────────────────────

def _key_audit_list(user_email: str, limit: int) -> str:
    safe = user_email.strip().lower() if user_email.strip() else "admin"
    return f"audit:list:{safe}:{limit}"


def _key_audit_record(audit_id: str) -> str:
    return f"audit:record:{audit_id}"


def get_audit_list(user_email: str, limit: int) -> Optional[list]:
    r = get_redis()
    if not r:
        return None
    try:
        raw = r.get(_key_audit_list(user_email, limit))
        return json.loads(raw) if raw else None
    except Exception as exc:
        logger.warning("[cache] get_audit_list error: %s", exc)
        return None


def set_audit_list(user_email: str, limit: int, data: list) -> None:
    r = get_redis()
    if not r:
        return
    try:
        r.setex(_key_audit_list(user_email, limit), AUDIT_LIST_TTL, json.dumps(data, default=str))
    except Exception as exc:
        logger.warning("[cache] set_audit_list error: %s", exc)


def get_audit_record(audit_id: str) -> Optional[dict]:
    r = get_redis()
    if not r:
        return None
    try:
        raw = r.get(_key_audit_record(audit_id))
        return json.loads(raw) if raw else None
    except Exception as exc:
        logger.warning("[cache] get_audit_record error: %s", exc)
        return None


def set_audit_record(audit_id: str, data: dict) -> None:
    r = get_redis()
    if not r:
        return
    try:
        r.setex(_key_audit_record(audit_id), AUDIT_RECORD_TTL, json.dumps(data, default=str))
    except Exception as exc:
        logger.warning("[cache] set_audit_record error: %s", exc)


def invalidate_audit_record(audit_id: str) -> None:
    _delete(_key_audit_record(audit_id))


def invalidate_audit_lists_for_user(user_email: str) -> None:
    safe = user_email.strip().lower() if user_email.strip() else "admin"
    _delete_pattern(f"audit:list:{safe}:*")
    _delete_pattern("audit:list:admin:*")
