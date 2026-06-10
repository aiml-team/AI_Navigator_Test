from dotenv import load_dotenv
load_dotenv()

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.templating import Jinja2Templates
from fastapi import Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
# ── OKTA-DISABLED ─ uncomment the next line to re-enable Okta SSO session cookie
# from starlette.middleware.sessions import SessionMiddleware

from services.database import init_db
from auth import init_navigator_tables
from routes import router



@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    init_navigator_tables()
    yield


app = FastAPI(title="Enterprise AI Orchestrator v2", lifespan=lifespan)

# ── OKTA-DISABLED ──────────────────────────────────────────────
# SessionMiddleware — stores the authenticated user (set by /saml/acs)
# in a signed cookie. Must be added BEFORE the router so request.session
# is available inside the SAML endpoints.
# To re-enable Okta SSO: uncomment this whole block AND the
# `from starlette.middleware.sessions import SessionMiddleware` import above.
# ----------------------------------------------------------------
# app.add_middleware(
#     SessionMiddleware,
#     secret_key=os.getenv("SESSION_SECRET_KEY", "change-me-in-production"),
#     session_cookie="navigator_session",
#     max_age=28800,           # 8 hours
#     same_site="lax",         # required so Okta's POST to /saml/acs carries the cookie back
#     https_only=False,        # set True in production behind HTTPS only
# )

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
    return templates.TemplateResponse("index.html", {"request": request})


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