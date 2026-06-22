import logging
import os
import json
import threading
import uuid
import warnings
from datetime import datetime

import pandas as pd

SYSTEM_VERSION = "2.0"

try:
    from tavily import TavilyClient as _TavilyClient
    _tavily    = _TavilyClient(api_key=os.getenv("TAVILY_API_KEY", ""))
    HAS_TAVILY = bool(os.getenv("TAVILY_API_KEY"))
except Exception:
    _tavily    = None
    HAS_TAVILY = False

_TOOL_ENRICHMENT_CACHE: dict = {}

_FIELD_ALIASES: dict = {
    "tool_name":            ["tool_name", "name", "tool", "ai_tool", "toolname", "tool_names"],
    "description":          ["description", "desc", "primary_job", "summary", "overview", "about", "what_it_does"],
    "category":             ["category", "cat", "tool_category", "tool_family", "family", "type", "group"],
    "url":                  ["url", "url_or_note", "link", "tool_url", "access_url", "url_link", "endpoint"],
    "best_for":             ["best_for", "use_when", "use_case", "good_for", "when_to_use", "ideal_for"],
    "strong_signals":       ["strong_signals", "signals", "keywords", "match_keywords", "trigger_keywords"],
    "not_for":              ["not_for", "avoid_when", "avoid", "do_not_use", "dont_use", "not_suitable"],
    "weak_signals":         ["weak_signals", "weak", "secondary_signals"],
    "roles":                ["roles", "role", "target_roles", "audience", "user_roles", "who", "for_roles"],
    "icon":                 ["icon", "emoji", "symbol"],
    "search_query":         ["search_query", "search", "query"],
    "is_internal":          ["is_internal", "internal", "internal_only", "allows_client_data"],
    "output_type":          ["output_type", "output", "produces", "delivers", "tool_output"],
    "output_type_keywords": ["output_type_keywords", "output_keywords", "output_signals"],
}

AI_TOOLS_REGISTRY: dict = {}


def _split_list(val) -> list:
    if val is None:
        return []
    s = str(val).strip()
    if not s or s.lower() in ("nan", "none", ""):
        return []
    sep = ";" if ";" in s else ","
    return [x.strip() for x in s.split(sep) if x.strip()]


def _norm(s: str) -> str:
    return s.lower().strip().replace(" ", "_").replace("-", "_")


def _safe_val(val) -> str:
    if val is None:
        return ""
    if isinstance(val, float) and pd.isna(val):
        return ""
    return str(val).strip()


def _find_tool_sheet(xl: pd.ExcelFile) -> str:
    canonical = {
        "ai_tools_registry", "registry_all_tools", "tools_registry",
        "tool_registry", "ai_tools", "registry", "tools", "tool_list",
    }
    for sheet in xl.sheet_names:
        if _norm(sheet) in canonical:
            return sheet

    for sheet in xl.sheet_names:
        try:
            df_peek = xl.parse(sheet, nrows=1)
            normed  = [_norm(c) for c in df_peek.columns]
            if any(
                alias in normed
                for alias in _FIELD_ALIASES["tool_name"]
            ):
                return sheet
        except Exception:
            continue

    raise ValueError(
        f"No tools registry sheet found. Sheets in this file: {xl.sheet_names}. "
        "Ensure one sheet has a column named 'tool_name' (or similar)."
    )


def _resolve_aliases(col_lookup: dict) -> dict:
    resolved = {}
    for field, aliases in _FIELD_ALIASES.items():
        resolved[field] = next(
            (col_lookup[a] for a in aliases if a in col_lookup),
            None
        )
    return resolved


def _load_from_bytes(excel_bytes: bytes) -> dict:
    import io

    try:
        xl = pd.ExcelFile(io.BytesIO(excel_bytes), engine="openpyxl")
    except Exception as e:
        raise ValueError(f"Could not open Excel file: {e}")

    sheet = _find_tool_sheet(xl)

    try:
        df = xl.parse(sheet)
    except Exception as e:
        raise ValueError(f"Could not parse sheet '{sheet}': {e}")

    df = df.dropna(how="all").reset_index(drop=True)
    df.columns = [str(c) for c in df.columns]

    col_lookup = {_norm(c): c for c in df.columns}
    alias_map  = _resolve_aliases(col_lookup)

    if not alias_map["tool_name"]:
        raise ValueError(
            f"Sheet '{sheet}' has no recognisable tool-name column. "
            f"Columns found: {list(df.columns)}. "
            f"Rename the tool name column to 'tool_name'."
        )

    registry = {}

    for _, row in df.iterrows():
        tool_name = _safe_val(row[alias_map["tool_name"]])
        if not tool_name or tool_name.lower() in ("nan", "none", "tool_name", "tool name"):
            continue

        raw_data = {}
        for orig_col in df.columns:
            v = row[orig_col]
            if v is None or (isinstance(v, float) and pd.isna(v)):
                raw_data[orig_col] = None
            elif isinstance(v, (int, float, bool)):
                raw_data[orig_col] = v
            else:
                raw_data[orig_col] = str(v).strip()

        def _get(field: str) -> str:
            col = alias_map.get(field)
            return _safe_val(row[col]) if col else ""

        is_internal = False
        is_internal_col = alias_map.get("is_internal")
        if is_internal_col:
            raw_flag = _safe_val(row[is_internal_col]).lower()
            if _norm(is_internal_col) == "allows_client_data":
                is_internal = raw_flag not in ("yes", "true", "1")
            else:
                is_internal = raw_flag in ("true", "yes", "1", "internal")

        registry[tool_name] = {
            "description":          _get("description"),
            "category":             _get("category"),
            "url":                  _get("url"),
            "icon":                 _get("icon"),
            "search_query":         _get("search_query"),
            "is_internal":          is_internal,
            "best_for":             _split_list(_get("best_for")),
            "strong_signals":       _split_list(_get("strong_signals")),
            "not_for":              _split_list(_get("not_for")),
            "weak_signals":         _split_list(_get("weak_signals")),
            "roles":                _split_list(_get("roles")),
            "output_type":          _get("output_type"),
            "output_type_keywords": _split_list(_get("output_type_keywords")),
            "raw_data":             raw_data,
        }

    if not registry:
        raise ValueError(
            f"Sheet '{sheet}' was parsed but contains no valid tool rows. "
            "Ensure the sheet has at least one data row with a tool name."
        )

    return registry


def load_tools_registry_from_excel(
    excel_path: str = "AI_TOOLS.xlsx",
    sheet_name: str = None,
) -> dict:
    with open(excel_path, "rb") as fh:
        return _load_from_bytes(fh.read())


_registry_log = logging.getLogger("services.registry")


def _save_excel_tools_to_db(tools: dict) -> int:
    """Persist Excel-loaded tools to Azure SQL registered_tools (source='excel').
    Manually registered tools (source='manual') are never touched.
    Uses per-row commits so a single bad row never rolls back the whole batch.
    Returns the number of tools saved.
    """
    from services.database import get_db

    print(f"[registry] _save_excel_tools_to_db: saving {len(tools)} tools to Azure SQL")

    # ── Step 1: prepare schema ────────────────────────────────────
    try:
        prep = get_db()
        # Ensure source column exists (missing in older schemas)
        prep.execute(
            "IF NOT EXISTS ("
            "  SELECT 1 FROM sys.columns "
            "  WHERE object_id = OBJECT_ID(N'registered_tools') AND name = N'source'"
            ") ALTER TABLE registered_tools ADD source NVARCHAR(50) NULL DEFAULT 'manual'"
        )
        prep.commit()
        # Widen icon column if it is still the original narrow NVARCHAR(10)
        prep.execute(
            "IF EXISTS ("
            "  SELECT 1 FROM sys.columns "
            "  WHERE object_id = OBJECT_ID(N'registered_tools') AND name = N'icon' AND max_length < 100"
            ") ALTER TABLE registered_tools ALTER COLUMN icon NVARCHAR(255) NULL"
        )
        prep.commit()
        prep.close()
    except Exception as schema_e:
        print(f"[registry] WARNING: schema prep failed (continuing anyway): {schema_e}")
        _registry_log.warning("[registry] schema prep error: %s", schema_e)

    # ── Step 2: clear old Excel-sourced rows ──────────────────────
    try:
        del_conn = get_db()
        del_conn.execute("DELETE FROM registered_tools WHERE source = 'excel'")
        del_conn.commit()
        del_conn.close()
    except Exception as del_e:
        print(f"[registry] WARNING: could not clear old Excel rows: {del_e}")
        _registry_log.warning("[registry] delete Excel rows error: %s", del_e)

    # ── Step 3: insert each tool (per-row commit + try/except) ────
    now = datetime.utcnow().isoformat()
    saved = 0
    failed = 0

    for tool_name, info in tools.items():
        try:
            # Use a fresh connection per row to avoid shared-cursor issues
            row_conn = get_db()

            # Skip if a manual registration already exists for this tool name
            existing = row_conn.execute(
                "SELECT id FROM registered_tools WHERE tool_name = ?", (tool_name,)
            ).fetchone()

            if not existing:
                # Truncate fields to their column lengths
                icon_val  = (str(info.get("icon") or "🤖"))[:50]
                cat_val   = (str(info.get("category") or ""))[:255]
                url_val   = (str(info.get("url") or ""))[:500]
                otype_val = (str(info.get("output_type") or ""))[:255]

                row_conn.execute(
                    """INSERT INTO registered_tools
                       (id, tool_name, description, category, url, icon,
                        best_for, strong_signals, weak_signals, not_for,
                        roles, output_type, is_internal, raw_data, source,
                        created_at, updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        str(uuid.uuid4()),
                        tool_name,
                        str(info.get("description") or ""),
                        cat_val,
                        url_val,
                        icon_val,
                        json.dumps(info.get("best_for", []) or []),
                        json.dumps(info.get("strong_signals", []) or []),
                        json.dumps(info.get("weak_signals", []) or []),
                        json.dumps(info.get("not_for", []) or []),
                        json.dumps(info.get("roles", []) or []),
                        otype_val,
                        1 if info.get("is_internal") else 0,
                        json.dumps(info.get("raw_data", {}) or {}),
                        "excel",
                        now, now,
                    ),
                )
                row_conn.commit()
                saved += 1

            row_conn.close()

        except Exception as row_e:
            failed += 1
            print(f"[registry] FAILED to save tool '{tool_name}': {row_e}")
            _registry_log.error("[registry] Failed to save tool '%s': %s", tool_name, row_e)

    print(f"[registry] DB save done: {saved} saved, {failed} failed out of {len(tools)} tools")
    _registry_log.info("[registry] DB save: %d saved, %d failed / %d total", saved, failed, len(tools))
    return saved


def _merge_db_tools_into_registry():
    from services.database import get_db
    try:
        conn = get_db()
        rows = conn.execute("SELECT * FROM registered_tools").fetchall()
        conn.close()
        for row in rows:
            r = dict(row)
            tool_name = r["tool_name"]
            AI_TOOLS_REGISTRY[tool_name] = {
                "description":         r.get("description", ""),
                "category":            r.get("category", ""),
                "url":                 r.get("url", ""),
                "icon":                r.get("icon", "🤖"),
                "best_for":            json.loads(r.get("best_for", "[]") or "[]"),
                "strong_signals":      json.loads(r.get("strong_signals", "[]") or "[]"),
                "weak_signals":        json.loads(r.get("weak_signals", "[]") or "[]"),
                "not_for":             json.loads(r.get("not_for", "[]") or "[]"),
                "roles":               json.loads(r.get("roles", "[]") or "[]"),
                "output_type":         r.get("output_type", ""),
                "output_type_keywords": [],
                "is_internal":         bool(r.get("is_internal", 0)),
                "search_query":        "",
                "raw_data":            json.loads(r.get("raw_data", "{}") or "{}"),
                "_source":             "db",
            }
    except Exception:
        pass
    # Write updated registry to Redis so all processes stay in sync
    try:
        from services import cache
        cache.set_tool_registry(dict(AI_TOOLS_REGISTRY))
        cache.invalidate_registered_list()
    except Exception:
        pass


def reload_tools_registry(excel_bytes: bytes = None,
                           excel_path:  str   = "AI_TOOLS.xlsx"):
    global AI_TOOLS_REGISTRY

    if excel_bytes:
        new = _load_from_bytes(excel_bytes)
    else:
        new = load_tools_registry_from_excel(excel_path=excel_path)

    if not new:
        raise ValueError(
            "Excel file was parsed but no tools were found. "
            "Ensure your sheet has a 'tool_name' column and at least one data row."
        )

    AI_TOOLS_REGISTRY.clear()
    AI_TOOLS_REGISTRY.update(new)
    _save_excel_tools_to_db(new)      # persist Excel tools to Azure SQL
    _merge_db_tools_into_registry()   # also writes to Redis
    _TOOL_ENRICHMENT_CACHE.clear()


def _build_search_query(tool_name: str, info: dict) -> str:
    explicit = info.get("search_query", "").strip()
    if explicit:
        return explicit
    category = info.get("category", "").strip()
    if category:
        return f"{tool_name} {category} features capabilities use cases enterprise"
    return f"{tool_name} AI tool features capabilities what it does"


def _enrich_single_tool(tool_name: str, info: dict) -> str:
    if not HAS_TAVILY or _tavily is None:
        return info.get("description", "")

    query = _build_search_query(tool_name, info)
    result_holder = [None]

    def _do_search():
        try:
            result_holder[0] = _tavily.search(
                query=query,
                search_depth="basic",
                max_results=3,
                include_answer=True,
            )
        except Exception:
            result_holder[0] = {}

    t = threading.Thread(target=_do_search, daemon=True)
    t.start()
    t.join(timeout=8)

    result = result_holder[0] or {}
    answer = (result.get("answer") or "").strip()
    if answer:
        return answer[:600]

    snippets = [
        r.get("content", "")[:150]
        for r in (result.get("results") or [])[:3]
        if r.get("content")
    ]
    combined = " ".join(snippets).strip()
    return combined[:600] if combined else info.get("description", "")


def enrich_tools_registry() -> None:
    if not AI_TOOLS_REGISTRY:
        return

    new_tools = [
        name for name in AI_TOOLS_REGISTRY
        if name not in _TOOL_ENRICHMENT_CACHE
    ]

    if not new_tools:
        return

    def _run():
        for name in new_tools:
            if name in _TOOL_ENRICHMENT_CACHE:
                continue
            info    = AI_TOOLS_REGISTRY.get(name, {})
            summary = _enrich_single_tool(name, info)
            _TOOL_ENRICHMENT_CACHE[name] = {
                "summary":    summary,
                "fetched_at": datetime.utcnow().isoformat(),
            }

    threading.Thread(target=_run, daemon=True).start()


def _get_enriched_summary(tool_name: str) -> str:
    cached = _TOOL_ENRICHMENT_CACHE.get(tool_name)
    if cached and cached.get("summary"):
        return cached["summary"]
    info = AI_TOOLS_REGISTRY.get(tool_name, {})
    return info.get("description", "")


def _bootstrap_registry():
    """
    Load AI_TOOLS_REGISTRY at process startup.
    Order: Redis cache → Excel file → DB merge.
    """
    global AI_TOOLS_REGISTRY

    # 1. Try Redis first (fastest, cross-process consistent)
    try:
        from services import cache as _cache
        cached = _cache.get_tool_registry()
        if cached:
            AI_TOOLS_REGISTRY.update(cached)
            return  # Redis had up-to-date data; skip disk I/O
    except Exception:
        pass

    # 2. Load from Excel on disk — try common filenames
    _excel_loaded: dict = {}
    _candidate_paths = ["AI_TOOLS.xlsx", "AI_TOOLS_Roles.xlsx", "AI_Tools.xlsx"]
    for _path in _candidate_paths:
        try:
            _excel_loaded = load_tools_registry_from_excel(excel_path=_path)
            if _excel_loaded:
                AI_TOOLS_REGISTRY.update(_excel_loaded)
                break
        except Exception:
            continue
    if not _excel_loaded:
        warnings.warn(
            "[AI_TOOLS_REGISTRY] No Excel file found on disk at startup. "
            "Upload a registry via the UI header dropdown before using the tool recommender.",
            RuntimeWarning,
            stacklevel=1,
        )

    # 3. Overlay DB-registered tools (they take precedence over Excel)
    try:
        _merge_db_tools_into_registry()   # also writes result back to Redis
    except Exception:
        pass
    # NOTE: Persisting Excel tools to Azure SQL is done in main.py lifespan
    # AFTER init_db() runs — not here, because tables may not exist yet at import time.


_bootstrap_registry()

threading.Thread(target=enrich_tools_registry, daemon=True).start()
