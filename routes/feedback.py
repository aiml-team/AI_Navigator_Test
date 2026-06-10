import csv
import io
import json
import os
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from services.database import get_db

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

    return {"status": "ok", "feedback_id": feedback_id}


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
