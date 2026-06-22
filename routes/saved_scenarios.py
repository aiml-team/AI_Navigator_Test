"""
routes/saved_scenarios.py
─────────────────────────
Per-user saved (bookmarked) scenario favorites stored in Azure SQL.

GET    /api/user-saved-scenarios?user_email=...  → list user's favorites
POST   /api/user-saved-scenarios                 → save a scenario
DELETE /api/user-saved-scenarios                 → remove by email + title
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.database import get_db

router = APIRouter()


class SaveScenarioRequest(BaseModel):
    user_email: str
    title: str
    scenario: str = ""
    persona: str = ""
    mega_group: str = ""
    category: str = ""


class RemoveScenarioRequest(BaseModel):
    user_email: str
    title: str


@router.get("/api/user-saved-scenarios")
async def get_saved_scenarios(user_email: str = Query(...)):
    if not user_email or not user_email.strip():
        raise HTTPException(400, "user_email is required")

    email = user_email.strip().lower()
    conn = get_db()
    rows = conn.execute(
        "SELECT id, title, scenario, persona, mega_group, category, saved_at "
        "FROM user_saved_scenarios WHERE user_email = ? ORDER BY saved_at DESC",
        (email,),
    ).fetchall()
    conn.close()
    return {"favorites": [dict(r) for r in rows]}


@router.post("/api/user-saved-scenarios")
async def save_scenario(req: SaveScenarioRequest):
    if not req.user_email or not req.user_email.strip():
        raise HTTPException(400, "user_email is required")
    if not req.title or not req.title.strip():
        raise HTTPException(400, "title is required")

    email = req.user_email.strip().lower()
    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT id FROM user_saved_scenarios WHERE user_email = ? AND title = ?",
            (email, req.title.strip()),
        ).fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO user_saved_scenarios "
                "(id, user_email, title, scenario, persona, mega_group, category, saved_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    email,
                    req.title.strip(),
                    req.scenario or "",
                    req.persona or "",
                    req.mega_group or "",
                    req.category or "",
                    datetime.utcnow().isoformat(),
                ),
            )
            conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(500, f"Failed to save scenario: {e}")
    conn.close()
    return {"status": "ok"}


@router.delete("/api/user-saved-scenarios")
async def remove_saved_scenario(req: RemoveScenarioRequest):
    if not req.user_email or not req.user_email.strip():
        raise HTTPException(400, "user_email is required")

    email = req.user_email.strip().lower()
    conn = get_db()
    try:
        conn.execute(
            "DELETE FROM user_saved_scenarios WHERE user_email = ? AND title = ?",
            (email, req.title.strip()),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(500, f"Failed to remove scenario: {e}")
    conn.close()
    return {"status": "ok"}
