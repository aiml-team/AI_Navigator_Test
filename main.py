from dotenv import load_dotenv
load_dotenv()

import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.templating import Jinja2Templates
from fastapi import Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from starlette.middleware.sessions import SessionMiddleware

from services.database import init_db
from auth import init_navigator_tables
from routes import router

_log = logging.getLogger("main")

# ── Build stamp for cache-busting static assets ───────────────────────────────
# Regenerated every time the app process boots. On Azure App Service, that
# means every deploy / restart invalidates browser caches for /static/* assets
# (we append ?v=<BUILD_STAMP> to script + css URLs in the template). This is
# what fixes "buttons stopped working after deploy" — stale cached JS.
# Prefer an explicit env var (e.g. set to the git SHA in CI) so multiple
# replicas share the same value; otherwise fall back to process start time.
BUILD_STAMP = os.getenv("BUILD_STAMP") or str(int(time.time()))


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
    except Exception as exc:
        _log.warning("[startup] init_db failed — app will start without DB tables: %s", exc)
    try:
        init_navigator_tables()
    except Exception as exc:
        _log.warning("[startup] init_navigator_tables failed: %s", exc)

    # Persist in-memory AI Tools registry to Azure SQL if not already there.
    # This runs AFTER init_db() so the registered_tools table and source column
    # are guaranteed to exist. Handles first boot, code updates, and Redis expiry.
    try:
        from services.registry import AI_TOOLS_REGISTRY, _save_excel_tools_to_db
        from services.database import get_db
        if AI_TOOLS_REGISTRY:
            conn = get_db()
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM registered_tools WHERE source = 'excel'"
            ).fetchone()
            conn.close()
            if row and int(row.get("c") or 0) == 0:
                # DB has no Excel-sourced tools — persist the in-memory ones now
                excel_tools = {
                    name: info for name, info in AI_TOOLS_REGISTRY.items()
                    if info.get("_source") != "db"
                }
                if excel_tools:
                    saved = _save_excel_tools_to_db(excel_tools)
                    _log.info("[startup] Migrated %d tools from memory to Azure SQL", saved)
    except Exception as exc:
        _log.warning("[startup] Could not persist registry to Azure SQL: %s", exc)

    # Kick off bulk scenario summarization in the background so every tile
    # has a cached summary in the DB. Non-blocking — the app keeps starting
    # while this runs in a worker thread. Already-summarized rows are skipped,
    # so this is safe to invoke on every boot.
    try:
        import asyncio
        from routes.scenarios import _bulk_summarize_missing

        async def _bg_summarize_all():
            try:
                loop = asyncio.get_running_loop()
                counts = await loop.run_in_executor(None, _bulk_summarize_missing)
                _log.info(
                    "[startup] Scenario bulk-summarize done: generated=%s skipped=%s failed=%s scanned=%s",
                    counts.get("generated"), counts.get("skipped"),
                    counts.get("failed"), counts.get("total_scanned"),
                )
            except Exception as exc:
                _log.warning("[startup] Background scenario summarize failed: %s", exc)

        asyncio.create_task(_bg_summarize_all())
    except Exception as exc:
        _log.warning("[startup] Could not schedule scenario bulk-summarize: %s", exc)

    yield


app = FastAPI(title="Enterprise AI Orchestrator v2", lifespan=lifespan)

# ── SessionMiddleware ──────────────────────────────────────────
# OKTA SSO ENABLED — /saml/acs populates request.session["navigator_user"]
# after a successful Okta assertion; /api/auth/me reads it back, and
# /saml/logout clears it. same_site="lax" is required so the browser
# carries this cookie on the POST from Okta back to /saml/acs.
# ----------------------------------------------------------------
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET_KEY", "change-me-in-production"),
    session_cookie="navigator_session",
    max_age=28800,           # 8 hours
    same_site="lax",         # was required so Okta's POST to /saml/acs carried the cookie back
    https_only=False,        # set True in production behind HTTPS only
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")

@app.get("/")
async def serve_index(request: Request):
    response = templates.TemplateResponse(
        "index.html",
        {"request": request, "build_stamp": BUILD_STAMP},
    )
    # Never cache the HTML shell — it references versioned static assets,
    # so the HTML must always be fresh to point at the latest ?v=<stamp>.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["."],
        reload_excludes=["*.venv*", "*MYENV*", "*ASHOK*", "*chroma_db*", "*__pycache__*"],
    )