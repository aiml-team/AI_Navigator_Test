import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException
from schemas import PromptVersionRequest
from services.database import get_db

router = APIRouter()


@router.get("/api/prompt-versions")
async def get_prompt_versions():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, version, intent, industry, change_note, created_at, created_by FROM prompt_versions ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.get("/api/prompt-versions/{version_id}")
async def get_prompt_version(version_id: str):
    conn = get_db()
    row  = conn.execute("SELECT * FROM prompt_versions WHERE id = ?", (version_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Version not found")
    return dict(row)


@router.post("/api/prompt-versions")
async def create_prompt_version(req: PromptVersionRequest):
    conn = get_db()
    last = conn.execute("SELECT version FROM prompt_versions ORDER BY created_at DESC LIMIT 1").fetchone()
    if last:
        try:
            major, minor = last["version"].split(".")
            new_version  = f"{major}.{int(minor) + 1}"
        except Exception:
            new_version = "1.1"
    else:
        new_version = "1.0"

    vid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO prompt_versions VALUES (?,?,?,?,?,?,?,?)",
        (vid, new_version, req.intent, req.industry, req.template,
         req.change_note, datetime.utcnow().isoformat(), "user")
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "id": vid, "version": new_version}
