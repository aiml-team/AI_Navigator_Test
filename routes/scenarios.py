import uuid
from datetime import datetime

from services.scenario_similarity_agent import find_similar_scenarios
from fastapi import APIRouter, HTTPException, UploadFile, File
from schemas import RegisterScenarioRequest
from services.scenario_library import SCENARIO_LIBRARY, reload_scenario_library
from services.database import get_db

router = APIRouter()


@router.get("/api/scenarios")
async def get_scenarios():
    return {"status": "ok", "scenarios": SCENARIO_LIBRARY, "count": len(SCENARIO_LIBRARY)}


@router.post("/api/scenarios/register")
async def register_scenario(req: RegisterScenarioRequest):
    new_scenario = {
        "mega_group": req.mega_group.strip(),
        "category":   req.category.strip() if req.category else "",
        "phase":      req.activate_phase.strip() if req.activate_phase else "",
        "title":      req.title.strip(),
        "persona":    req.persona.strip() if req.persona else "",
        "scenario":   req.scenario.strip(),
        "task_type":  "",
    }
    SCENARIO_LIBRARY.append(new_scenario)

    conn = get_db()
    conn.execute(
        "INSERT INTO scenarios (id, mega_group, category, phase, title, persona, scenario, task_type, source, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (
            str(uuid.uuid4()),
            new_scenario["mega_group"],
            new_scenario["category"],
            new_scenario["phase"],
            new_scenario["title"],
            new_scenario["persona"],
            new_scenario["scenario"],
            new_scenario["task_type"],
            "manual",
            datetime.utcnow().isoformat(),
        ),
    )
    conn.commit()
    conn.close()

    return {"status": "ok", "scenarios_loaded": len(SCENARIO_LIBRARY)}


@router.post("/api/scenario-suggestions/submit")
async def submit_scenario_suggestion(req: RegisterScenarioRequest, submitted_by: str = ""):
    suggestion_id = str(uuid.uuid4())
    submitted_at  = datetime.utcnow().isoformat()
    conn = get_db()
    conn.execute(
        """INSERT INTO scenario_suggestions
           (id, title, mega_group, category, persona, activate_phase, scenario, submitted_by, submitted_at, status, admin_note, reviewed_at)
           VALUES (?,?,?,?,?,?,?,?,?,'pending','','')""",
        (
            suggestion_id,
            req.title.strip(),
            req.mega_group.strip(),
            req.category.strip() if req.category else "",
            req.persona.strip() if req.persona else "",
            req.activate_phase.strip() if req.activate_phase else "",
            req.scenario.strip(),
            submitted_by.strip(),
            submitted_at,
        ),
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "suggestion_id": suggestion_id}


@router.get("/api/scenario-suggestions")
async def list_scenario_suggestions(
    status: str = "all",
    search: str = "",
    page: int = 1,
    per_page: int = 20,
):
    conn = get_db()

    where_parts = []
    params: list = []

    if status != "all":
        where_parts.append("status = ?")
        params.append(status)

    if search.strip():
        q = f"%{search.strip().lower()}%"
        where_parts.append("(LOWER(title) LIKE ? OR LOWER(mega_group) LIKE ? OR LOWER(scenario) LIKE ? OR LOWER(submitted_by) LIKE ?)")
        params.extend([q, q, q, q])

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    total = conn.execute(f"SELECT COUNT(*) as c FROM scenario_suggestions {where_sql}", params).fetchone()["c"]

    offset = (page - 1) * per_page
    rows = conn.execute(
        f"SELECT * FROM scenario_suggestions {where_sql} ORDER BY submitted_at DESC "
        f"OFFSET {int(offset)} ROWS FETCH NEXT {int(per_page)} ROWS ONLY",
        params,
    ).fetchall()
    conn.close()

    return {
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "items":    [dict(r) for r in rows],
    }


@router.get("/api/scenario-suggestions/{suggestion_id}/similarity")
async def check_scenario_similarity(suggestion_id: str):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM scenario_suggestions WHERE id = ?",
        (suggestion_id,)
    ).fetchone()
    conn.close()

    if not row:
        raise HTTPException(404, "Suggestion not found")

    submitted = dict(row)

    matches = find_similar_scenarios(
        submitted=submitted,
        library=SCENARIO_LIBRARY,
        limit=5,
    )

    return {
        "suggestion_id": suggestion_id,
        "submitted": submitted,
        "matches": matches,
        "highest_score": matches[0]["score"] if matches else 0,
    }


@router.post("/api/scenario-suggestions/{suggestion_id}/approve")
async def approve_scenario_suggestion(suggestion_id: str, admin_note: str = ""):
    conn = get_db()
    row = conn.execute("SELECT * FROM scenario_suggestions WHERE id = ?", (suggestion_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Suggestion not found")

    conn.execute(
        "UPDATE scenario_suggestions SET status='approved', admin_note=?, reviewed_at=? WHERE id=?",
        (admin_note, datetime.utcnow().isoformat(), suggestion_id),
    )
    conn.commit()
    conn.close()

    approved_scenario = {
        "mega_group": row["mega_group"] or "",
        "category":   row["category"]   or "",
        "phase":      row["activate_phase"] or "",
        "title":      row["title"]       or "",
        "persona":    row["persona"]     or "",
        "scenario":   row["scenario"]    or "",
        "task_type":  "",
    }
    SCENARIO_LIBRARY.append(approved_scenario)

    conn2 = get_db()
    conn2.execute(
        "INSERT INTO scenarios (id, mega_group, category, phase, title, persona, scenario, task_type, source, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (
            str(uuid.uuid4()),
            approved_scenario["mega_group"],
            approved_scenario["category"],
            approved_scenario["phase"],
            approved_scenario["title"],
            approved_scenario["persona"],
            approved_scenario["scenario"],
            approved_scenario["task_type"],
            "approved_suggestion",
            datetime.utcnow().isoformat(),
        ),
    )
    conn2.commit()
    conn2.close()

    return {"status": "ok", "scenarios_loaded": len(SCENARIO_LIBRARY)}


@router.post("/api/scenario-suggestions/{suggestion_id}/reject")
async def reject_scenario_suggestion(suggestion_id: str, admin_note: str = ""):
    conn = get_db()
    row = conn.execute("SELECT id FROM scenario_suggestions WHERE id = ?", (suggestion_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Suggestion not found")
    conn.execute(
        "UPDATE scenario_suggestions SET status='rejected', admin_note=?, reviewed_at=? WHERE id=?",
        (admin_note, datetime.utcnow().isoformat(), suggestion_id),
    )
    conn.commit()
    conn.close()
    return {"status": "ok"}


@router.post("/api/upload-scenario-library")
async def upload_scenario_library(file: UploadFile = File(...)):
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("xlsx", "xlsm", "xls"):
        raise HTTPException(400, "Only Excel files (.xlsx, .xlsm, .xls) are supported")

    content = await file.read()

    try:
        reload_scenario_library(excel_bytes=content)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"Could not read Excel file: {str(e)}")

    if not SCENARIO_LIBRARY:
        raise HTTPException(400, "File was read but no scenarios were found. Ensure your sheet has a title/scenario column and at least one data row.")

    return {"status": "ok", "scenarios_loaded": len(SCENARIO_LIBRARY)}
