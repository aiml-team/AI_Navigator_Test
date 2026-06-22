import asyncio
import csv
import io
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from services.database import get_db
from services.llm_client import call_llm

_log = logging.getLogger("routes.feedback")


# ── LLM triage helpers ─────────────────────────────────────────

def _title_similarity(a: str, b: str) -> float:
    """Jaccard similarity on meaningful words (ignores stop words)."""
    _stop = {"a","an","the","is","not","and","or","in","on","to","of",
             "with","for","it","i","my","we","our","this","that","was","are"}
    words_a = {w for w in a.lower().split() if w not in _stop}
    words_b = {w for w in b.lower().split() if w not in _stop}
    if not words_a or not words_b:
        return 0.0
    union = words_a | words_b
    return len(words_a & words_b) / len(union)


def _triage_feedback_sync(feedback_id: str, comment: str, issue_type: str, email: str, force_new: bool = False) -> dict:
    """
    Classify the feedback with the LLM, then check for duplicate open issues.
    Creates / updates a row in technical_feedbacks and returns a triage dict.
    Pass force_new=True to skip duplicate detection and always create a fresh issue.
    """
    text = f"Feedback type: {issue_type or 'not specified'}\nUser comment: {comment or '(no comment)'}"

    system = (
        "You are a technical support classifier for an enterprise AI web application called AI Navigator.\n"
        "The app has distinct feature areas: chat (Generate button, chat panel, Continue Conversation), "
        "ai_tools (AI Tools page, Open button, tool cards), personalization (Personalization modal, "
        "Save Preferences button, AI Tools tab, General tab), feedback (Feedback form, submit button), "
        "scenario_library (Scenario Library page), admin (Admin panel, Tech Issues, Feedback Inbox, "
        "Analytics), auth (Login, Sign in), home (Home page, recent runs).\n\n"
        "Decide whether the feedback describes a TECHNICAL problem: broken feature, button not working, "
        "error message, crash, data not loading, wrong display, slow performance, access issue.\n"
        "General complaints about AI output quality or content are NOT technical issues.\n\n"
        "Rules for the title field:\n"
        "  - ALWAYS start with the feature_area label in brackets, e.g. [Personalization] or [Chat]\n"
        "  - Include the EXACT button label or UI component the user mentioned\n"
        "  - 'Save Preferences button' and 'Generate button' are DIFFERENT problems even if both say "
        "'button not working' — they are in different feature areas\n"
        "  - Never generalise to just 'button not working' — be specific\n\n"
        "Return ONLY valid JSON — no markdown, no extra text. Examples:\n"
        '{"is_technical":true,"title":"[Personalization] Save Preferences button unresponsive","category":"UI","feature_area":"personalization"}\n'
        '{"is_technical":true,"title":"[Chat] Generate button not responding","category":"UI","feature_area":"chat"}\n'
        '{"is_technical":true,"title":"[AI Tools] Open button missing for ChatGPT","category":"UI","feature_area":"ai_tools"}\n'
        '{"is_technical":false}\n\n'
        "Categories: UI | API | Performance | Data | Authentication | Output Quality | Other\n"
        "Feature areas: chat | ai_tools | personalization | feedback | scenario_library | admin | auth | home | general"
    )

    try:
        raw = call_llm(system, text, max_tokens=160, temperature=0.05)
        raw = raw.replace("```json", "").replace("```", "").strip()
        classified = json.loads(raw)
    except Exception as e:
        _log.warning("[triage] LLM classify failed: %s", e)
        return {"is_technical": False}

    if not classified.get("is_technical"):
        return {"is_technical": False}

    title        = (classified.get("title")        or "Technical issue").strip()[:500]
    category     = (classified.get("category")     or "Other").strip()[:100]
    feature_area = (classified.get("feature_area") or "general").strip()[:100]
    now          = datetime.utcnow().isoformat()

    try:
        db = get_db()

        # Duplicate detection — skipped when the user explicitly said it's a different problem.
        if not force_new:
            open_issues = db.execute(
                "SELECT id, problem_title, category, feature_area, status, affected_count, reporter_emails "
                "FROM technical_feedbacks WHERE status != 'completed'"
            ).fetchall()

            matched = None
            for issue in open_issues:
                issue_area = (issue["feature_area"] or "").strip().lower()
                # Issues in different feature areas are NEVER duplicates — a broken Save button
                # in Personalization and a broken Generate button in Chat are separate problems.
                if issue_area and feature_area.lower() != issue_area:
                    continue
                sim      = _title_similarity(title, issue["problem_title"] or "")
                same_cat = (category.lower() == (issue["category"] or "").lower())
                if sim > 0.35 or (same_cat and sim > 0.20):
                    matched = issue
                    break

            if matched:
                issue_id = matched["id"]
                existing_status = matched["status"] or "pending"
                try:
                    emails = json.loads(matched["reporter_emails"] or "[]")
                except Exception:
                    emails = []
                if email and email not in emails:
                    emails.append(email)
                db.execute(
                    "UPDATE technical_feedbacks "
                    "SET affected_count = affected_count + 1, last_reported = ?, "
                    "reporter_emails = ?, updated_at = ? WHERE id = ?",
                    (now, json.dumps(emails), now, issue_id),
                )
                db.commit()
                db.close()
                return {
                    "is_technical":  True,
                    "title":         matched["problem_title"],
                    "category":      category,
                    "feature_area":  feature_area,
                    "status":        existing_status,
                    "is_known":      True,
                    "tech_id":       issue_id,
                }

        # New issue (either no duplicate found, or user confirmed it's a different problem)
        tech_id         = str(uuid.uuid4())
        reporter_emails = json.dumps([email] if email else [])
        db.execute(
            "INSERT INTO technical_feedbacks "
            "(id, feedback_id, problem_title, problem_desc, category, feature_area, status, "
            "affected_count, reporter_emails, first_reported, last_reported, "
            "resolved_at, admin_note, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                tech_id, feedback_id, title, comment or "", category, feature_area, "pending",
                1, reporter_emails, now, now, "", "", now, now,
            ),
        )
        db.commit()
        db.close()
        return {
            "is_technical": True,
            "title":        title,
            "category":     category,
            "feature_area": feature_area,
            "status":       "pending",
            "is_known":     False,
            "tech_id":      tech_id,
        }

    except Exception as e:
        _log.warning("[triage] DB step failed: %s", e)
        return {"is_technical": True, "title": title, "category": category,
                "feature_area": feature_area, "status": "pending", "is_known": False}

router = APIRouter()


def _get_blob_container():
    from azure.storage.blob import BlobServiceClient
    account_name = os.getenv("ACCOUNT_NAME", "")
    account_key  = os.getenv("ACCOUNT_KEY", "")
    container    = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "ai-navigator-feedback")
    conn_str = (
        f"DefaultEndpointsProtocol=https;"
        f"AccountName={account_name};"
        f"AccountKey={account_key};"
        f"EndpointSuffix=core.windows.net"
    )
    client = BlobServiceClient.from_connection_string(conn_str)
    return client.get_container_client(container)


def _content_settings(content_type: str):
    from azure.storage.blob import ContentSettings
    return ContentSettings(content_type=content_type)


@router.post("/api/feedback")
async def submit_feedback(
    email:      str  = Form(""),
    rating:     int  = Form(0),
    comment:    str  = Form(""),
    issue_type: str  = Form(""),
    audit_id:   str  = Form(""),
    source:     str  = Form("form"),
    force_new:  str  = Form(""),   # "true" → skip duplicate detection, always create fresh issue
    files:      List[UploadFile] = File(default=[]),
):
    created_at = datetime.utcnow().isoformat()

    # Check for existing feedback to support upsert (edit/update)
    existing_id          = None
    existing_created_at  = None
    existing_folder      = None
    if audit_id:
        try:
            db_check = get_db()
            existing_row = db_check.execute(
                "SELECT id, created_at FROM feedback WHERE audit_id = ? ORDER BY created_at DESC",
                (audit_id,),
            ).fetchone()
            db_check.close()
            if existing_row:
                existing_id         = existing_row["id"]
                existing_created_at = existing_row["created_at"]
                existing_folder     = f"feedback/{existing_created_at[:10]}_{existing_id}"
        except Exception:
            pass

    is_update   = existing_id is not None
    feedback_id = existing_id if is_update else str(uuid.uuid4())
    folder      = existing_folder if is_update else f"feedback/{created_at[:10]}_{feedback_id}"
    record_created_at = existing_created_at if is_update else created_at

    metadata = {
        "id":         feedback_id,
        "audit_id":   audit_id,
        "email":      email,
        "rating":     rating,
        "comment":    comment,
        "issue_type": issue_type,
        "source":     source,
        "created_at": record_created_at,
        "updated_at": created_at if is_update else None,
        "files":      [],
    }

    uploaded_files = []

    try:
        container = _get_blob_container()

        for f in files:
            if not f.filename:
                continue
            raw = await f.read()
            if not raw:
                continue
            safe_name    = f.filename.replace(" ", "_")
            blob_name    = f"{folder}/attachments/{safe_name}"
            content_type = f.content_type or "application/octet-stream"
            container.upload_blob(
                name=blob_name,
                data=raw,
                overwrite=True,
                content_settings=_content_settings(content_type),
            )
            uploaded_files.append(safe_name)

        metadata["files"] = uploaded_files

        meta_blob = f"{folder}/metadata.json"
        container.upload_blob(
            name=meta_blob,
            data=json.dumps(metadata, indent=2).encode("utf-8"),
            overwrite=True,
            content_settings=_content_settings("application/json"),
        )
    except Exception as e:
        raise HTTPException(500, f"Blob upload failed: {str(e)}")

    try:
        db = get_db()
        if is_update:
            db.execute(
                """UPDATE feedback SET rating=?, comment=?, issue_type=?, source=?, files=?
                   WHERE id=?""",
                (rating, comment or "", issue_type or "", source or "form",
                 json.dumps(uploaded_files), feedback_id),
            )
        else:
            db.execute(
                """INSERT INTO feedback (id, audit_id, email, rating, comment, issue_type, created_at, source, files)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    feedback_id,
                    audit_id or "",
                    email or "",
                    rating,
                    comment or "",
                    issue_type or "",
                    created_at,
                    source or "form",
                    json.dumps(uploaded_files),
                ),
            )
        db.commit()
        db.close()
    except Exception as e:
        print(f"[feedback] Azure SQL upsert warning: {e}")

    # ── LLM triage (non-blocking — runs in thread pool so it doesn't slow the response) ──
    triage: dict = {"is_technical": False}
    if (comment or issue_type) and not is_update:
        try:
            triage = await asyncio.to_thread(
                _triage_feedback_sync, feedback_id, comment, issue_type, email or "",
                force_new.strip().lower() == "true"
            )
        except Exception as e:
            _log.warning("[triage] async wrapper failed: %s", e)

    # ── If technical, mark the blob so it's excluded from the Feedback Inbox ──
    if triage.get("is_technical") and not is_update:
        try:
            container = _get_blob_container()
            meta_blob_name = f"{folder}/metadata.json"
            meta_data = json.loads(container.download_blob(meta_blob_name).readall())
            meta_data["is_technical"] = True
            container.upload_blob(
                name=meta_blob_name,
                data=json.dumps(meta_data, indent=2).encode("utf-8"),
                overwrite=True,
                content_settings=_content_settings("application/json"),
            )
        except Exception as e:
            _log.warning("[feedback] Could not mark blob as technical: %s", e)

    return {"status": "ok", "feedback_id": feedback_id, "triage": triage}


@router.get("/api/feedback/by-audit/{audit_id}")
async def get_feedback_by_audit(audit_id: str):
    """Return the most recent feedback record for a given audit_id (or null)."""
    try:
        db  = get_db()
        row = db.execute(
            "SELECT * FROM feedback WHERE audit_id = ? ORDER BY created_at DESC",
            (audit_id,),
        ).fetchone()
        db.close()
    except Exception as e:
        raise HTTPException(500, str(e))

    if not row:
        return {"feedback": None}

    fb = dict(row)
    try:
        fb["files"] = json.loads(fb.get("files") or "[]")
    except Exception:
        fb["files"] = []
    return {"feedback": fb}


# ───────────────────────────────────────────────────────────────
# Shared loader + filter for /api/feedback-list and
# /api/export/feedback.csv. Returns the full *filtered* list of
# feedback metadata dicts (already sorted newest-first).
# ───────────────────────────────────────────────────────────────
def _load_filtered_feedbacks(
    rating: int = 0,
    search: str = "",
    start_date: str = "",
    end_date: str = "",
) -> list[dict]:
    container = _get_blob_container()
    blobs = list(container.list_blobs(name_starts_with="feedback/"))
    meta_blobs = [b for b in blobs if b.name.endswith("/metadata.json")]

    all_feedbacks: list[dict] = []
    for blob in meta_blobs:
        try:
            data = container.download_blob(blob.name).readall()
            all_feedbacks.append(json.loads(data))
        except Exception:
            continue

    all_feedbacks.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    # Exclude technical feedbacks — those belong in Tech Issues only, not the Feedback Inbox.
    # Two checks:
    #   1. Blob flag  — set at submission time for new technical feedbacks (post-fix)
    #   2. SQL lookup — catches historical feedbacks submitted before the flag existed,
    #                   by matching against feedback_id stored in technical_feedbacks
    tech_feedback_ids: set = set()
    try:
        db = get_db()
        rows = db.execute(
            "SELECT feedback_id FROM technical_feedbacks WHERE feedback_id != ''"
        ).fetchall()
        db.close()
        tech_feedback_ids = {r["feedback_id"] for r in rows}
    except Exception:
        pass

    all_feedbacks = [
        f for f in all_feedbacks
        if not f.get("is_technical") and f.get("id") not in tech_feedback_ids
    ]

    filtered = all_feedbacks
    if rating and rating > 0:
        filtered = [f for f in filtered if f.get("rating") == rating]
    if search and search.strip():
        q = search.strip().lower()
        filtered = [
            f for f in filtered
            if q in (f.get("email") or "").lower()
            or q in (f.get("comment") or "").lower()
            or q in (f.get("issue_type") or "").lower()
        ]
    if start_date and start_date.strip():
        filtered = [f for f in filtered if (f.get("created_at") or "") >= start_date.strip()]
    if end_date and end_date.strip():
        end_inclusive = end_date.strip() + "T23:59:59"
        filtered = [f for f in filtered if (f.get("created_at") or "") <= end_inclusive]

    return filtered


@router.get("/api/feedback-list")
async def list_feedback(
    page: int = 1,
    per_page: int = 5,
    rating: int = 0,
    search: str = "",
    start_date: str = "",
    end_date: str = "",
):
    try:
        filtered = _load_filtered_feedbacks(
            rating=rating, search=search,
            start_date=start_date, end_date=end_date,
        )
    except Exception as e:
        raise HTTPException(500, f"Blob list failed: {str(e)}")

    from collections import Counter
    ratings_filtered = [f.get("rating", 0) for f in filtered if f.get("rating")]
    avg_rating       = round(sum(ratings_filtered) / len(ratings_filtered), 1) if ratings_filtered else None
    dist_counter     = Counter(f.get("rating") for f in filtered if f.get("rating"))
    distribution     = [{"rating": r, "count": c} for r, c in sorted(dist_counter.items())]

    total = len(filtered)
    offset = (page - 1) * per_page
    page_items = filtered[offset: offset + per_page]

    return {
        "total":        total,
        "page":         page,
        "per_page":     per_page,
        "pages":        max(1, (total + per_page - 1) // per_page),
        "avg_rating":   avg_rating,
        "distribution": distribution,
        "feedbacks":    page_items,
    }


# ───────────────────────────────────────────────────────────────
# CSV download — exports every feedback row that matches the
# supplied filters. No pagination cap (admin export).
# ───────────────────────────────────────────────────────────────
_FEEDBACK_CSV_COLUMNS = [
    "created_at", "email", "rating", "issue_type",
    "comment", "source", "audit_id", "id",
    "files",
]


def _csv_cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        # files[] is a list of {name,...} dicts — flatten to names.
        names = []
        for f in value:
            if isinstance(f, dict):
                names.append(f.get("name") or f.get("filename") or "")
            else:
                names.append(str(f))
        return "; ".join(n for n in names if n)
    s = str(value)
    return s.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")


@router.get("/api/export/feedback.csv")
async def export_feedback_csv(
    rating: int = 0,
    search: str = "",
    start_date: str = "",
    end_date: str = "",
):
    try:
        filtered = _load_filtered_feedbacks(
            rating=rating, search=search,
            start_date=start_date, end_date=end_date,
        )
    except Exception as e:
        raise HTTPException(500, f"Blob list failed: {str(e)}")

    def _row_stream():
        buf    = io.StringIO()
        writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(_FEEDBACK_CSV_COLUMNS)
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)

        for fb in filtered:
            writer.writerow([_csv_cell(fb.get(c)) for c in _FEEDBACK_CSV_COLUMNS])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    name_bits = ["feedback"]
    if rating and rating > 0:    name_bits.append(f"rating-{rating}")
    if search and search.strip(): name_bits.append(search.strip().lower().replace(" ", "-")[:30])
    name_bits.append(ts)
    fname = "_".join(name_bits) + ".csv"

    return StreamingResponse(
        _row_stream(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/api/feedback-attachments/{feedback_id}")
async def get_feedback_attachments(feedback_id: str):
    try:
        container  = _get_blob_container()
        prefix     = f"feedback/"
        all_blobs  = list(container.list_blobs(name_starts_with=prefix))
        folder_blob = next(
            (b for b in all_blobs if feedback_id in b.name and b.name.endswith("/metadata.json")),
            None
        )
        if not folder_blob:
            raise HTTPException(404, "Feedback not found")

        folder = folder_blob.name.replace("/metadata.json", "")
        attach_prefix = f"{folder}/attachments/"
        attach_blobs  = [b for b in all_blobs if b.name.startswith(attach_prefix)]

        urls = []
        for blob in attach_blobs:
            from azure.storage.blob import generate_blob_sas, BlobSasPermissions
            sas = generate_blob_sas(
                account_name   = os.getenv("ACCOUNT_NAME", ""),
                container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "ai-navigator-feedback"),
                blob_name      = blob.name,
                account_key    = os.getenv("ACCOUNT_KEY", ""),
                permission     = BlobSasPermissions(read=True),
                expiry         = datetime.utcnow().replace(hour=23, minute=59, second=59),
            )
            account_name = os.getenv("ACCOUNT_NAME", "")
            container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "ai-navigator-feedback")
            url = f"https://{account_name}.blob.core.windows.net/{container_name}/{blob.name}?{sas}"
            urls.append({"name": blob.name.split("/")[-1], "url": url})

        return {"files": urls}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
