import csv
import io
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from schemas import AuditUpdateRequest
from services.database import get_db
from auth import canonicalize_email, email_aliases

router = APIRouter()


# ───────────────────────────────────────────────────────────────
# Shared WHERE-builder for /api/audit (paginated + flat) and
# /api/export/audit.csv so all three endpoints honour the same
# filter semantics, including email aliasing.
# ───────────────────────────────────────────────────────────────
def _build_audit_filters(
    user_email: str = "",
    intent: str = "",
    tool: str = "",
    role: str = "",
    start_date: str = "",
    end_date: str = "",
) -> tuple[str, list]:
    conditions: list[str] = []
    params: list = []

    if user_email and user_email.strip():
        aliases = email_aliases(user_email)
        placeholders = ",".join("?" * len(aliases))
        conditions.append(f"LOWER(user_email) IN ({placeholders})")
        params.extend(aliases)
    if intent and intent.strip():
        conditions.append("LOWER(intent) = ?")
        params.append(intent.strip().lower())
    if tool and tool.strip():
        conditions.append("LOWER(recommended_tool) = ?")
        params.append(tool.strip().lower())
    if role and role.strip():
        conditions.append("LOWER(role) LIKE ?")
        params.append(f"%{role.strip().lower()}%")
    if start_date and start_date.strip():
        conditions.append("created_at >= ?")
        params.append(start_date.strip())
    if end_date and end_date.strip():
        conditions.append("created_at <= ?")
        params.append(end_date.strip() + "T23:59:59")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return where, params


@router.get("/api/analytics/user-activity")
async def get_user_activity(
    page: int = 1,
    per_page: int = 5,
    start_date: str = "",
    end_date: str = "",
):
    """
    Returns all users (from NavigatorUsers + NavigatorAdmins) joined with
    their run count from audit_log, sorted by run_count DESC then last_seen DESC.
    Users with zero runs are included with run_count = 0.
    Paginated: default 5 per page with total so frontend can do prev/next.

    When start_date / end_date are provided, run_count and last_run are
    computed only over audit_log rows whose created_at falls in that window
    (so the table reflects activity for the selected analytics period).
    """
    conn = get_db()
    offset = (page - 1) * per_page

    total_row = conn.execute("""
        SELECT COUNT(*) AS c FROM (
            SELECT email FROM NavigatorUsers
            UNION
            SELECT email FROM NavigatorAdmins
        ) AS all_users
    """).fetchone()
    total = int(total_row["c"]) if total_row else 0

    # ── Build optional date filter for the audit_log subquery ──
    date_conds: list[str] = []
    date_params: list = []
    if start_date and start_date.strip():
        date_conds.append("created_at >= ?")
        date_params.append(start_date.strip())
    if end_date and end_date.strip():
        date_conds.append("created_at <= ?")
        date_params.append(end_date.strip() + "T23:59:59")
    date_where = (" AND " + " AND ".join(date_conds)) if date_conds else ""

    rows = conn.execute(f"""
        SELECT
            u.email,
            u.name,
            u.last_seen,
            u.first_seen,
            u.role,
            ISNULL(r.run_count, 0) AS run_count,
            r.last_run
        FROM (
            SELECT email, name, last_seen, first_seen, 'user' AS role
            FROM NavigatorUsers
            UNION ALL
            SELECT email, name, added_at AS last_seen, added_at AS first_seen, 'admin' AS role
            FROM NavigatorAdmins
        ) AS u
        LEFT JOIN (
            SELECT LOWER(user_email) AS email,
                   COUNT(*) AS run_count,
                   MAX(created_at) AS last_run
            FROM audit_log
            WHERE user_email IS NOT NULL AND user_email != ''{date_where}
            GROUP BY LOWER(user_email)
        ) AS r ON LOWER(u.email) = r.email
        ORDER BY run_count DESC, u.last_seen DESC
        OFFSET {int(offset)} ROWS FETCH NEXT {int(per_page)} ROWS ONLY
    """, date_params).fetchall()

    conn.close()

    items = []
    for r in rows:
        last_seen  = r["last_seen"]
        first_seen = r["first_seen"]
        last_run   = r["last_run"]
        items.append({
            "email":      r["email"] or "",
            "name":       r["name"] or "",
            "role":       r["role"] or "user",
            "run_count":  int(r["run_count"]),
            "last_seen":  str(last_seen)[:19].replace("T", " ") if last_seen else "—",
            "first_seen": str(first_seen)[:19].replace("T", " ") if first_seen else "—",
            "last_run":   str(last_run)[:19].replace("T", " ") if last_run else "—",
        })

    return {
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    max(1, (total + per_page - 1) // per_page),
        "items":    items,
    }


@router.get("/api/audit")
async def get_audit_log(
    limit: int = 20,
    user_email: str = "",
    intent: str = "",
    tool: str = "",
    role: str = "",
    start_date: str = "",
    end_date: str = "",
    page: int = 0,           # 0 = legacy flat-list mode (backward compatible)
    per_page: int = 30,
):
    """
    GET /api/audit
      - Default mode (page omitted or =0): returns a flat array capped by `limit`.
        Used by the home empty-state, analytics drilldown, and any caller that
        existed before pagination was added.
      - Paginated mode (page >= 1): returns {total, page, per_page, pages, items}.
        Used by the History page (Prev / Next + count).
    """
    where, params = _build_audit_filters(
        user_email=user_email, intent=intent, tool=tool,
        role=role, start_date=start_date, end_date=end_date,
    )

    conn = get_db()

    # Paginated mode — requested by the History page.
    if page and page >= 1:
        per_page = max(1, min(int(per_page), 200))
        offset   = (int(page) - 1) * per_page

        total_row = conn.execute(
            f"SELECT COUNT(*) AS c FROM audit_log {where}",
            params if params else None,
        ).fetchone()
        total = int(total_row["c"]) if total_row else 0

        rows = conn.execute(
            f"""
            SELECT * FROM audit_log {where}
            ORDER BY created_at DESC
            OFFSET {int(offset)} ROWS FETCH NEXT {int(per_page)} ROWS ONLY
            """,
            params if params else None,
        ).fetchall()
        conn.close()

        return {
            "total":    total,
            "page":     int(page),
            "per_page": per_page,
            "pages":    max(1, (total + per_page - 1) // per_page),
            "items":    [dict(r) for r in rows],
        }

    # Legacy flat mode — kept so existing callers don't break.
    rows = conn.execute(
        f"SELECT TOP {int(limit)} * FROM audit_log {where} ORDER BY created_at DESC",
        params if params else None,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ───────────────────────────────────────────────────────────────
# CSV download endpoint — streams ALL matching audit_log rows
# under the supplied filter set. No `limit` cap (admin export).
# Used by the History "Download" button and every Analytics
# drilldown "Download" button (drilldowns pass the same filters
# they already use to fetch the on-screen logs).
# ───────────────────────────────────────────────────────────────
_AUDIT_CSV_COLUMNS = [
    "created_at", "user_email", "role", "intent", "industry",
    "recommended_tool", "tool_confidence", "tool_reason",
    "policy_blocked", "policy_summary", "policy_flags",
    "raw_input", "final_prompt", "comments", "feedback_type",
]


def _stringify_csv_cell(value) -> str:
    """Normalise a DB value for CSV: keeps datetimes ISO-format,
    keeps None as empty string, collapses internal CR/LF in long text
    so the row stays on a single CSV line."""
    if value is None:
        return ""
    if isinstance(value, (datetime,)):
        return value.isoformat(sep=" ", timespec="seconds")
    s = str(value)
    # csv module already escapes embedded quotes / commas; we just
    # normalise newlines so prompts/outputs don't wreck the row count.
    return s.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")


@router.get("/api/export/audit.csv")
async def export_audit_csv(
    user_email: str = "",
    intent: str = "",
    tool: str = "",
    role: str = "",
    start_date: str = "",
    end_date: str = "",
):
    where, params = _build_audit_filters(
        user_email=user_email, intent=intent, tool=tool,
        role=role, start_date=start_date, end_date=end_date,
    )

    conn = get_db()
    rows = conn.execute(
        f"""SELECT audit_log.*,
               (SELECT TOP 1 comment    FROM feedback WHERE feedback.audit_id = audit_log.id ORDER BY feedback.created_at DESC) AS comments,
               (SELECT TOP 1 issue_type FROM feedback WHERE feedback.audit_id = audit_log.id ORDER BY feedback.created_at DESC) AS feedback_type
            FROM audit_log {where}
            ORDER BY created_at DESC""",
        params if params else None,
    ).fetchall()
    conn.close()

    def _row_stream():
        buf    = io.StringIO()
        writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(_AUDIT_CSV_COLUMNS)
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)

        for r in rows:
            d = dict(r)
            writer.writerow([_stringify_csv_cell(d.get(c)) for c in _AUDIT_CSV_COLUMNS])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    # Filename communicates the filter context so admins don't end up
    # with a folder full of "audit.csv" / "audit (1).csv" files.
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    name_bits = ["audit"]
    if user_email.strip(): name_bits.append(user_email.strip().split("@")[0])
    if role.strip():       name_bits.append(role.strip().lower())
    if intent.strip():     name_bits.append(intent.strip().lower())
    if tool.strip():       name_bits.append(tool.strip().lower().replace(" ", "-"))
    name_bits.append(ts)
    fname = "_".join(name_bits) + ".csv"

    return StreamingResponse(
        _row_stream(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.patch("/api/audit/{audit_id}")
async def update_audit_log(audit_id: str, req: AuditUpdateRequest):
    conn = get_db()
    row = conn.execute("SELECT * FROM audit_log WHERE id = ?", (audit_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Audit log not found")

    current = dict(row)

    new_raw_input    = req.raw_input    if req.raw_input is not None else current.get("raw_input", "")
    new_final_prompt = req.final_prompt if req.final_prompt is not None else current.get("final_prompt", "")
    new_output       = req.output       if req.output is not None else current.get("output", "")

    conn.execute(
        "UPDATE audit_log SET raw_input = ?, final_prompt = ?, output = ? WHERE id = ?",
        (new_raw_input, new_final_prompt, new_output, audit_id),
    )
    conn.commit()

    updated = conn.execute("SELECT * FROM audit_log WHERE id = ?", (audit_id,)).fetchone()
    conn.close()
    return dict(updated)


@router.get("/api/analytics")
async def get_analytics():
    conn = get_db()
    total          = conn.execute("SELECT COUNT(*) as c FROM audit_log").fetchone()["c"]
    intents        = conn.execute("SELECT intent, COUNT(*) as c FROM audit_log GROUP BY intent ORDER BY c DESC").fetchall()
    tools          = conn.execute("SELECT recommended_tool, COUNT(*) as c FROM audit_log GROUP BY recommended_tool ORDER BY c DESC").fetchall()
    industries     = conn.execute("SELECT TOP 5 industry, COUNT(*) as c FROM audit_log GROUP BY industry ORDER BY c DESC").fetchall()
    avg_rating     = conn.execute("SELECT AVG(CAST(rating AS FLOAT)) as r FROM feedback").fetchone()["r"]
    feedback_count = conn.execute("SELECT COUNT(*) as c FROM feedback").fetchone()["c"]
    issue_types    = conn.execute(
        "SELECT issue_type, COUNT(*) as c FROM feedback WHERE issue_type != '' GROUP BY issue_type ORDER BY c DESC"
    ).fetchall()
    low_rated = conn.execute("""
        SELECT TOP 10 a.intent, a.recommended_tool, f.issue_type, f.comment
        FROM feedback f JOIN audit_log a ON f.audit_id = a.id
        WHERE f.rating <= 2
        ORDER BY f.created_at DESC
    """).fetchall()
    token_trend = conn.execute(
        "SELECT TOP 10 created_at, token_estimate FROM audit_log ORDER BY created_at DESC"
    ).fetchall()
    by_user = conn.execute(
        "SELECT TOP 20 user_email, COUNT(*) as c FROM audit_log WHERE user_email != '' AND user_email IS NOT NULL "
        "GROUP BY user_email ORDER BY c DESC"
    ).fetchall()
    recent_runs = conn.execute(
        "SELECT TOP 20 id, created_at, user_email, raw_input, recommended_tool, intent, policy_blocked "
        "FROM audit_log ORDER BY created_at DESC"
    ).fetchall()
    conn.close()

    return {
        "total_runs":     total,
        "avg_rating":     round(avg_rating, 1) if avg_rating else None,
        "feedback_count": feedback_count,
        "intents":        [dict(r) for r in intents],
        "tools":          [dict(r) for r in tools],
        "industries":     [dict(r) for r in industries],
        "issue_types":    [dict(r) for r in issue_types],
        "low_rated_runs": [dict(r) for r in low_rated],
        "token_trend":    [dict(r) for r in token_trend],
        "by_user":        [dict(r) for r in by_user],
        "recent_runs":    [dict(r) for r in recent_runs],
    }


def _fill_timeline(rows, since, now, period):
    data = dict(rows)
    result = []
    if period == "day":
        current = since.replace(minute=0, second=0, microsecond=0)
        while current <= now:
            bucket  = current.strftime("%H")
            display = current.strftime("%H:00")
            result.append({"label": display, "count": data.get(bucket, 0)})
            current += timedelta(hours=1)
    else:
        current = since.replace(hour=0, minute=0, second=0, microsecond=0)
        while current <= now:
            bucket  = current.strftime("%Y-%m-%d")
            display = current.strftime("%b %d")
            result.append({"label": display, "count": data.get(bucket, 0)})
            current += timedelta(days=1)
    return result


@router.get("/api/analytics-dashboard")
async def get_analytics_dashboard(
    period: str     = "day",
    role: str       = "all",
    start_date: str = "",
    end_date: str   = "",
):
    now = datetime.utcnow()
    all_time = (period == "all")

    if not all_time:
        if period == "custom" and start_date and end_date:
            try:
                since      = datetime.strptime(start_date, "%Y-%m-%d")
                end_dt     = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
                span       = (end_dt - since).days or 1
                prev_since = since - timedelta(days=span)
            except ValueError:
                raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD.")
            now = end_dt
        elif period == "week":
            since      = now - timedelta(weeks=1)
            prev_since = since - timedelta(weeks=1)
        elif period == "month":
            since      = now - timedelta(days=30)
            prev_since = since - timedelta(days=30)
        else:
            # Today = calendar day, not rolling last 24 hours
            since = now.replace(hour=0, minute=0, second=0, microsecond=0)
            prev_since = since - timedelta(days=1)
            now = now.replace(hour=23, minute=59, second=59, microsecond=0)

        since_str      = since.isoformat()
        prev_since_str = prev_since.isoformat()
        end_str        = now.isoformat()

    conn = get_db()

    role_filter_sql  = ""
    role_filter_args = []
    if role != "all" and role.strip():
        role_filter_sql  = " AND LOWER(role) LIKE ?"
        role_filter_args = [f"%{role.lower()}%"]

    if all_time:
        base_args      = role_filter_args
        prev_base_args = role_filter_args
        date_where     = ""
    else:
        base_args      = [since_str, end_str] + role_filter_args
        prev_base_args = [prev_since_str, since_str] + role_filter_args
        date_where     = " AND created_at >= ? AND created_at <= ?"

    role_only_where = (" WHERE" + role_filter_sql.replace(" AND ", " ", 1)) if (all_time and role_filter_sql) else ""

    def _where(extra=""):
        if all_time:
            parts = []
            if role_filter_sql:
                parts.append(role_filter_sql.lstrip(" AND "))
            if extra:
                parts.append(extra.lstrip(" AND "))
            return (" WHERE " + " AND ".join(parts)) if parts else ""
        else:
            base = f" WHERE created_at >= ? AND created_at <= ?{role_filter_sql}"
            return base + ((" AND " + extra.lstrip(" AND ")) if extra else "")

    if all_time:
        total = conn.execute(
            f"SELECT COUNT(*) as c FROM audit_log{_where()}",
            base_args or None
        ).fetchone()["c"]
        change_pct = None
    else:
        total = conn.execute(
            f"SELECT COUNT(*) as c FROM audit_log WHERE created_at >= ? AND created_at <= ?{role_filter_sql}",
            base_args
        ).fetchone()["c"]
        prev_total = conn.execute(
            f"SELECT COUNT(*) as c FROM audit_log WHERE created_at >= ? AND created_at < ?{role_filter_sql}",
            prev_base_args
        ).fetchone()["c"]
        change_pct = round((total - prev_total) / prev_total * 100) if prev_total else None

    role_not_empty = "role IS NOT NULL AND LTRIM(RTRIM(role)) != ''"
    intent_not_empty = "intent IS NOT NULL AND intent != ''"
    tool_not_empty = "recommended_tool IS NOT NULL AND recommended_tool != ''"

    by_role_rows = conn.execute(
        "SELECT TOP 15 role, COUNT(*) as count FROM audit_log"
        + _where(role_not_empty)
        + " GROUP BY role ORDER BY count DESC",
        base_args or None
    ).fetchall()
    by_role = [{"role": r["role"].strip().title() if r["role"].strip().lower() == "general" else r["role"].strip(), "count": r["count"]} for r in by_role_rows]

    by_intent_rows = conn.execute(
        "SELECT TOP 10 intent, COUNT(*) as count FROM audit_log"
        + _where(intent_not_empty)
        + " GROUP BY intent ORDER BY count DESC",
        base_args or None
    ).fetchall()
    total_intent = sum(r["count"] for r in by_intent_rows) or 1
    by_intent = [
        {"label": r["intent"] or "—", "count": r["count"],
         "total_pct": round(r["count"] / total_intent * 100)}
        for r in by_intent_rows
    ]

    by_tool_rows = conn.execute(
        "SELECT TOP 10 recommended_tool, COUNT(*) as count FROM audit_log"
        + _where(tool_not_empty)
        + " GROUP BY recommended_tool ORDER BY count DESC",
        base_args or None
    ).fetchall()
    total_tool = sum(r["count"] for r in by_tool_rows) or 1
    by_tool = [
        {"label": r["recommended_tool"] or "—", "count": r["count"],
         "total_pct": round(r["count"] / total_tool * 100)}
        for r in by_tool_rows
    ]

    blocked = conn.execute(
        "SELECT COUNT(*) as c FROM audit_log" + _where("policy_blocked = 1"),
        base_args or None
    ).fetchone()["c"]

    tl_fmt_sql = (
        "FORMAT(TRY_CAST(created_at AS DATETIME2), 'HH')"
        if period == "day"
        else "FORMAT(TRY_CAST(created_at AS DATETIME2), 'yyyy-MM-dd')"
    )
    if all_time:
        tl_rows = conn.execute(
            f"SELECT {tl_fmt_sql} as bucket, COUNT(*) as count "
            f"FROM audit_log{_where()} "
            f"GROUP BY {tl_fmt_sql} ORDER BY bucket ASC",
            base_args or None
        ).fetchall()
        timeline = [{"label": r["bucket"], "count": r["count"]} for r in tl_rows if r["bucket"]]
    else:
        tl_rows = conn.execute(
            f"SELECT {tl_fmt_sql} as bucket, COUNT(*) as count "
            f"FROM audit_log WHERE created_at >= ? AND created_at <= ?{role_filter_sql} "
            f"GROUP BY {tl_fmt_sql} ORDER BY bucket ASC",
            base_args
        ).fetchall()
        timeline = _fill_timeline([(r["bucket"], r["count"]) for r in tl_rows], since, now, period)

    conn.close()

    return {
        "period":       period,
        "role_filter":  role,
        "start_date":   "" if all_time else (start_date or since_str[:10]),
        "end_date":     "" if all_time else (end_date   or end_str[:10]),
        "total_runs":   total,
        "change_pct":   change_pct,
        "by_role":      by_role,
        "by_intent":    by_intent,
        "by_tool":      by_tool,
        "blocked_runs": blocked,
        "timeline":     timeline,
    }
