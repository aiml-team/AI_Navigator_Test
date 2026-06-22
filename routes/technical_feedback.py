"""
routes/technical_feedback.py
─────────────────────────────
Admin endpoints for the technical_feedbacks triage table.

GET  /api/admin/technical-feedbacks          — paginated list with optional status filter
PATCH /api/admin/technical-feedbacks/{id}    — update status / admin note
GET  /api/admin/technical-feedbacks/summary  — counts per status (for badge)
"""

import json
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.database import get_db

router = APIRouter()


class TechFeedbackUpdate(BaseModel):
    status: str | None = None
    admin_note: str | None = None


def _row_to_dict(row) -> dict:
    d = dict(row)
    try:
        d["reporter_emails"] = json.loads(d.get("reporter_emails") or "[]")
    except Exception:
        d["reporter_emails"] = []
    return d


@router.get("/api/admin/technical-feedbacks/summary")
async def tech_feedback_summary():
    """Return counts for pending / in_progress / completed."""
    try:
        db   = get_db()
        rows = db.execute(
            "SELECT status, COUNT(*) AS cnt FROM technical_feedbacks GROUP BY status"
        ).fetchall()
        db.close()
    except Exception as e:
        raise HTTPException(500, str(e))

    counts = {"pending": 0, "in_progress": 0, "completed": 0}
    for r in rows:
        key = (r["status"] or "pending").lower().replace(" ", "_")
        if key in counts:
            counts[key] = r["cnt"]
    counts["open"] = counts["pending"] + counts["in_progress"]
    return counts


@router.get("/api/admin/technical-feedbacks")
async def list_tech_feedbacks(
    status: str = "",
    page: int = 1,
    per_page: int = 20,
):
    try:
        db      = get_db()
        where   = "WHERE 1=1"
        params: list = []

        if status and status.lower() not in ("", "all"):
            where += " AND status = ?"
            params.append(status)

        total_row = db.execute(
            f"SELECT COUNT(*) AS cnt FROM technical_feedbacks {where}", params
        ).fetchone()
        total  = (total_row["cnt"] if total_row else 0) or 0
        offset = (page - 1) * per_page

        rows = db.execute(
            f"SELECT * FROM technical_feedbacks {where} "
            f"ORDER BY last_reported DESC "
            f"OFFSET ? ROWS FETCH NEXT ? ROWS ONLY",
            params + [offset, per_page],
        ).fetchall()
        db.close()
    except Exception as e:
        raise HTTPException(500, str(e))

    return {
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    max(1, (total + per_page - 1) // per_page),
        "items":    [_row_to_dict(r) for r in rows],
    }


@router.patch("/api/admin/technical-feedbacks/{item_id}")
async def update_tech_feedback(item_id: str, req: TechFeedbackUpdate):
    if req.status is not None:
        allowed = {"pending", "in_progress", "completed"}
        if req.status not in allowed:
            raise HTTPException(400, f"status must be one of {allowed}")

    try:
        db   = get_db()
        now  = datetime.utcnow().isoformat()
        sets = ["updated_at = ?"]
        vals: list = [now]

        if req.status is not None:
            sets.append("status = ?")
            vals.append(req.status)
            if req.status == "completed":
                sets.append("resolved_at = ?")
                vals.append(now)

        if req.admin_note is not None:
            sets.append("admin_note = ?")
            vals.append(req.admin_note)

        vals.append(item_id)
        db.execute(
            f"UPDATE technical_feedbacks SET {', '.join(sets)} WHERE id = ?", vals
        )
        db.commit()

        row = db.execute(
            "SELECT * FROM technical_feedbacks WHERE id = ?", (item_id,)
        ).fetchone()
        db.close()
    except Exception as e:
        raise HTTPException(500, str(e))

    if not row:
        raise HTTPException(404, "Record not found")
    return _row_to_dict(row)
