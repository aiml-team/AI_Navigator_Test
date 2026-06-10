"""
routes/personalization.py
─────────────────────────
Per-user preferences stored in Azure SQL.

GET  /api/user-ai-tools/preferences?user_email=...
    Returns all registry tools with each tool's has_access value.
POST /api/user-ai-tools/preferences
    Upserts tool access preferences.

GET  /api/user-role?user_email=...
    Returns the user's saved default role.
POST /api/user-role
    Saves/updates the user's default role.
"""

import uuid
from datetime import datetime
from typing import List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.database import get_db
from services.registry import AI_TOOLS_REGISTRY
from services import cache

router = APIRouter()


class ToolPreference(BaseModel):
    tool_name: str
    has_access: bool


class SavePreferencesRequest(BaseModel):
    user_email: str
    preferences: List[ToolPreference]


@router.get("/api/user-ai-tools/preferences")
async def get_preferences(user_email: str = Query(...)):
    if not user_email or not user_email.strip():
        raise HTTPException(400, "user_email is required")

    email = user_email.strip().lower()

    # Try Redis cache first
    cached = cache.get_user_tool_prefs(email)
    if cached is not None:
        return cached

    # Cache miss — query DB
    conn = get_db()
    rows = conn.execute(
        "SELECT tool_name, has_access FROM UserToolAccess WHERE user_email = ?",
        (email,),
    ).fetchall()
    conn.close()

    saved = {r["tool_name"]: bool(r["has_access"]) for r in rows}

    result = []
    for name, info in AI_TOOLS_REGISTRY.items():
        result.append({
            "tool_name":   name,
            "has_access":  saved.get(name, True),
            "icon":        info.get("icon", "🤖"),
            "category":    info.get("category", ""),
            "description": info.get("description", ""),
            "url":         info.get("url", ""),
        })

    cache.set_user_tool_prefs(email, result)
    return result


@router.post("/api/user-ai-tools/preferences")
async def save_preferences(req: SavePreferencesRequest):
    if not req.user_email or not req.user_email.strip():
        raise HTTPException(400, "user_email is required")

    email = req.user_email.strip().lower()
    now   = datetime.utcnow().isoformat()

    conn = get_db()
    try:
        for pref in req.preferences:
            tool_name  = (pref.tool_name or "").strip()
            if not tool_name:
                continue
            has_access = 1 if pref.has_access else 0

            existing = conn.execute(
                "SELECT id FROM UserToolAccess WHERE user_email = ? AND tool_name = ?",
                (email, tool_name),
            ).fetchone()

            if existing:
                conn.execute(
                    "UPDATE UserToolAccess SET has_access = ?, updated_at = ? "
                    "WHERE user_email = ? AND tool_name = ?",
                    (has_access, now, email, tool_name),
                )
            else:
                conn.execute(
                    "INSERT INTO UserToolAccess "
                    "(id, user_email, tool_name, has_access, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (str(uuid.uuid4()), email, tool_name, has_access, now, now),
                )

        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(500, f"Failed to save preferences: {e}")

    conn.close()

    # Invalidate user's prefs cache so the next GET reflects the new values
    cache.invalidate_user_tool_prefs(email)

    return {"status": "ok", "saved": len(req.preferences)}


# ── Default Role endpoints ─────────────────────────────────────

class SaveUserRoleRequest(BaseModel):
    user_email:   str
    default_role: str


@router.get("/api/user-role")
async def get_user_role(user_email: str = Query(...)):
    if not user_email or not user_email.strip():
        raise HTTPException(400, "user_email is required")

    email = user_email.strip().lower()

    # Try Redis cache first (None = miss; '' or role string = hit)
    cached_role = cache.get_user_default_role(email)
    if cached_role is not None:
        return {"default_role": cached_role}

    # Cache miss — query DB
    conn = get_db()
    row  = conn.execute(
        "SELECT default_role FROM UserDefaultRole WHERE user_email = ?",
        (email,),
    ).fetchone()
    conn.close()

    role = row["default_role"] if row else ""
    cache.set_user_default_role(email, role)
    return {"default_role": role}


@router.post("/api/user-role")
async def save_user_role(req: SaveUserRoleRequest):
    if not req.user_email or not req.user_email.strip():
        raise HTTPException(400, "user_email is required")

    email = req.user_email.strip().lower()
    role  = (req.default_role or "").strip()
    now   = datetime.utcnow().isoformat()

    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT id FROM UserDefaultRole WHERE user_email = ?",
            (email,),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE UserDefaultRole SET default_role = ?, updated_at = ? WHERE user_email = ?",
                (role, now, email),
            )
        else:
            conn.execute(
                "INSERT INTO UserDefaultRole (user_email, default_role, created_at, updated_at) "
                "VALUES (?, ?, ?, ?)",
                (email, role, now, now),
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(500, f"Failed to save role: {e}")

    conn.close()

    # Update cache immediately so subsequent reads are instant
    cache.set_user_default_role(email, role)

    return {"status": "ok", "default_role": role}
