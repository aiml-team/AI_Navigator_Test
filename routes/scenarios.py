import uuid
from datetime import datetime

from services.scenario_similarity_agent import find_similar_scenarios
from services.agents.scenario_summarizer import summarize_scenario
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from schemas import RegisterScenarioRequest
from services.scenario_library import SCENARIO_LIBRARY, reload_scenario_library
from services.database import get_db

router = APIRouter()


@router.get("/api/scenarios")
async def get_scenarios():
    return {"status": "ok", "scenarios": SCENARIO_LIBRARY, "count": len(SCENARIO_LIBRARY)}


class SummarizeScenarioRequest(BaseModel):
    id: str = ""
    title: str = ""
    scenario: str = ""
    persona: str = ""
    force: bool = False  # set true to regenerate even if a cached summary exists


@router.post("/api/scenarios/summarize")
async def summarize_scenario_endpoint(req: SummarizeScenarioRequest):
    """
    Generate (or return cached) summary for a scenario.

    Lookup order:
      1. If `id` is provided, match the DB row by id.
      2. Otherwise, match by title (case-insensitive, first match wins).

    Behaviour:
      - If a cached `summary` exists in the DB and `force` is False, return it.
      - Otherwise generate via the LLM, persist to DB, update the in-memory
        SCENARIO_LIBRARY entry, and return it.
      - If the scenario is not found in the DB, generate from the request
        payload but do NOT persist (returns `persisted: false`).
    """
    scenario_id = (req.id or "").strip()
    title       = (req.title or "").strip()
    scenario    = (req.scenario or "").strip()
    persona     = (req.persona or "").strip()

    if not scenario_id and not title and not scenario:
        raise HTTPException(400, "Must provide at least one of: id, title, scenario.")

    conn = get_db()
    row = None
    try:
        if scenario_id:
            row = conn.execute(
                "SELECT id, title, persona, scenario, ISNULL(summary, '') AS summary "
                "FROM scenarios WHERE id = ?",
                (scenario_id,),
            ).fetchone()
        if not row and title:
            row = conn.execute(
                "SELECT TOP 1 id, title, persona, scenario, ISNULL(summary, '') AS summary "
                "FROM scenarios WHERE LOWER(title) = LOWER(?)",
                (title,),
            ).fetchone()
    except Exception as e:
        conn.close()
        raise HTTPException(500, f"DB lookup failed: {e}")

    db_row = dict(row) if row else None

    # Return cached summary if present and not forcing regeneration
    if db_row and db_row.get("summary") and not req.force:
        conn.close()
        return {
            "status":    "ok",
            "summary":   db_row["summary"],
            "cached":    True,
            "persisted": True,
            "id":        db_row["id"],
        }

    # Build inputs for the LLM
    scenario_text = (db_row["scenario"] if db_row else "") or scenario
    title_text    = (db_row["title"]    if db_row else "") or title
    persona_text  = (db_row["persona"]  if db_row else "") or persona

    if not scenario_text:
        conn.close()
        raise HTTPException(400, "Scenario text is empty; cannot summarize.")

    summary = summarize_scenario(
        scenario_text=scenario_text,
        title=title_text,
        persona=persona_text,
    )

    persisted = False
    if db_row and summary:
        try:
            conn.execute(
                "UPDATE scenarios SET summary = ? WHERE id = ?",
                (summary, db_row["id"]),
            )
            conn.commit()
            persisted = True

            # Update the in-memory library so subsequent /api/scenarios calls
            # serve the cached summary without another round-trip.
            for s in SCENARIO_LIBRARY:
                if (s.get("id") and s["id"] == db_row["id"]) or \
                   (not s.get("id") and (s.get("title") or "").lower() == (db_row["title"] or "").lower()):
                    s["summary"] = summary
                    break
        except Exception as e:
            # Persistence failure shouldn't block returning the summary
            print(f"[scenarios] Failed to persist summary: {e}")

    conn.close()

    return {
        "status":    "ok",
        "summary":   summary,
        "cached":    False,
        "persisted": persisted,
        "id":        (db_row["id"] if db_row else ""),
    }


def _bulk_summarize_missing(limit: int = 0, force: bool = False) -> dict:
    """
    Generate + persist summaries for every scenario in the DB whose
    `summary` column is empty (or all of them when force=True).

    Args:
        limit: 0 = no cap; otherwise stop after this many generations.
        force: regenerate summaries even when one already exists.

    Returns counts: { processed, generated, skipped, failed, total_scanned }.
    Updates the in-memory SCENARIO_LIBRARY entries as it goes.
    """
    counts = {"processed": 0, "generated": 0, "skipped": 0, "failed": 0, "total_scanned": 0}

    try:
        conn = get_db()
        if force:
            rows = conn.execute(
                "SELECT id, title, persona, scenario, ISNULL(summary, '') AS summary FROM scenarios"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, title, persona, scenario, ISNULL(summary, '') AS summary "
                "FROM scenarios WHERE summary IS NULL OR summary = ''"
            ).fetchall()
        rows = [dict(r) for r in rows]
        counts["total_scanned"] = len(rows)
    except Exception as e:
        print(f"[scenarios.bulk] DB read failed: {e}")
        return counts

    for row in rows:
        counts["processed"] += 1
        if limit and counts["generated"] >= limit:
            break

        scenario_text = (row.get("scenario") or "").strip()
        if not scenario_text:
            counts["skipped"] += 1
            continue

        if row.get("summary") and not force:
            counts["skipped"] += 1
            continue

        try:
            summary = summarize_scenario(
                scenario_text=scenario_text,
                title=row.get("title") or "",
                persona=row.get("persona") or "",
            )
        except Exception as e:
            print(f"[scenarios.bulk] summarize failed for id={row.get('id')}: {e}")
            counts["failed"] += 1
            continue

        if not summary:
            counts["failed"] += 1
            continue

        try:
            conn.execute(
                "UPDATE scenarios SET summary = ? WHERE id = ?",
                (summary, row["id"]),
            )
            conn.commit()
            counts["generated"] += 1

            # Sync the in-memory library entry too
            for s in SCENARIO_LIBRARY:
                if (s.get("id") and s["id"] == row["id"]) or \
                   (not s.get("id") and (s.get("title") or "").lower() == (row.get("title") or "").lower()):
                    s["summary"] = summary
                    break
        except Exception as e:
            print(f"[scenarios.bulk] persist failed for id={row.get('id')}: {e}")
            counts["failed"] += 1

    try:
        conn.close()
    except Exception:
        pass

    return counts


@router.post("/api/scenarios/summarize-all")
async def summarize_all_scenarios(force: bool = False, limit: int = 0):
    """
    Generate summaries for every scenario missing one (or all when force=true).
    Returns counts. Safe to call multiple times — already-summarized rows are
    skipped unless force=true.
    """
    counts = _bulk_summarize_missing(limit=limit, force=force)
    return {"status": "ok", **counts}


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


# ─────────────────────────────────────────────────────────────────────────────
# Beta "is_tested" toggle
#
# Temporary admin-only endpoint that flips the `is_tested` flag on a live
# scenario. Called from the Scenario Library card when an admin clicks the
# "Untested" / "Tested" chip. Mirrors the summary-persist pattern above:
#   1. UPDATE the DB row
#   2. Sync the in-memory SCENARIO_LIBRARY entry so subsequent /api/scenarios
#      calls return the fresh value without a reload.
#
# No auth guard here — the frontend hides the click affordance for non-admins,
# and this endpoint is stateless / idempotent. Add server-side role check if
# strict enforcement is needed later.
# ─────────────────────────────────────────────────────────────────────────────
class ScenarioTestedRequest(BaseModel):
    is_tested: int = 0   # 0 = untested, 1 = tested


@router.post("/api/admin/scenarios/{scenario_id}/tested")
async def set_scenario_tested(scenario_id: str, req: ScenarioTestedRequest):
    scenario_id = (scenario_id or "").strip()
    if not scenario_id:
        raise HTTPException(400, "scenario_id is required")

    new_val = 1 if int(req.is_tested or 0) == 1 else 0

    conn = get_db()
    try:
        # Confirm the row exists before updating so we can return 404 cleanly.
        row = conn.execute(
            "SELECT id FROM scenarios WHERE id = ?", (scenario_id,)
        ).fetchone()
        if not row:
            conn.close()
            raise HTTPException(404, f"Scenario '{scenario_id}' not found")

        conn.execute(
            "UPDATE scenarios SET is_tested = ? WHERE id = ?",
            (new_val, scenario_id),
        )
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        conn.close()
        raise HTTPException(500, f"Failed to update is_tested: {e}")
    conn.close()

    # Sync the in-memory library so the next /api/scenarios call reflects the
    # change without a full reload.
    for s in SCENARIO_LIBRARY:
        if s.get("id") == scenario_id:
            s["is_tested"] = new_val
            break

    return {"status": "ok", "id": scenario_id, "is_tested": new_val}
