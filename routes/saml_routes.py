"""
routes/saml_routes.py
━━━━━━━━━━━━━━━━━━━━━
Okta SAML 2.0 SSO endpoints:
  GET  /saml/login    → redirects browser to Okta login page
  POST /saml/acs      → Okta posts assertion here after login
  GET  /saml/logout   → clears session, redirects home
  GET  /saml/metadata → SP metadata (already registered with Okta)
  GET  /api/auth/me   → returns the current session user (used by JS)
"""

# ──────────────────────────────────────────────────────────────────────────
#  OKTA SSO ENABLED — router active and registered in routes/__init__.py.
# ──────────────────────────────────────────────────────────────────────────

import os
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse, Response, HTMLResponse
from onelogin.saml2.auth import OneLogin_Saml2_Auth

import auth as _auth
from services.saml_service import get_saml_settings

router = APIRouter()


# ── helpers ────────────────────────────────────────────────────

def _build_saml_auth(request: Request, body: bytes = b"") -> OneLogin_Saml2_Auth:
    """Build python3-saml Auth object from a FastAPI request."""
    url_data   = request.url
    post_data  = {}

    if body:
        from urllib.parse import parse_qs
        parsed = parse_qs(body.decode("utf-8"), keep_blank_values=True)
        post_data = {k: v[0] for k, v in parsed.items()}

    https_on = url_data.scheme == "https" or \
               request.headers.get("x-forwarded-proto", "") == "https"

    req = {
        "https":           "on" if https_on else "off",
        "http_host":       request.headers.get("host", url_data.hostname),
        "server_port":     url_data.port or (443 if https_on else 80),
        "script_name":     url_data.path,
        "get_data":        dict(request.query_params),
        "post_data":       post_data,
    }

    return OneLogin_Saml2_Auth(req, get_saml_settings())


# ── GET /saml/login ────────────────────────────────────────────

@router.get("/saml/login")
async def saml_login(request: Request):
    """Initiate Okta SSO — redirects user to Okta login page."""
    auth     = _build_saml_auth(request)
    sso_url  = auth.login()
    return RedirectResponse(sso_url, status_code=302)


# ── POST /saml/acs ─────────────────────────────────────────────

@router.post("/saml/acs")
async def saml_acs(request: Request):
    """
    Assertion Consumer Service.
    Okta POSTs the SAML response here.
    We validate it, extract the email, identify/create the user
    against our Azure SQL DB, store them in the server-side session,
    then redirect to /.
    """
    body = await request.body()
    auth = _build_saml_auth(request, body)
    auth.process_response()

    errors = auth.get_errors()
    if errors:
        reason = auth.get_last_error_reason() or str(errors)
        html = f"""
        <html><body style="font-family:sans-serif;padding:40px;color:#c00;">
          <h2>SSO Login Failed</h2>
          <p>{reason}</p>
          <a href="/">Try again</a>
        </body></html>
        """
        return HTMLResponse(html, status_code=400)

    if not auth.is_authenticated():
        return HTMLResponse("<html><body>Not authenticated.</body></html>", status_code=401)

    # Extract email from NameID (Okta sends email as NameID)
    email = auth.get_nameid()
    if not email:
        attrs = auth.get_attributes()
        email = (
            attrs.get("email", [None])[0]
            or attrs.get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", [None])[0]
            or attrs.get("user.email", [None])[0]
        )

    if not email:
        return HTMLResponse("<html><body>Could not extract email from SSO response.</body></html>", status_code=400)

    email = email.strip().lower()

    # identify_user() internally canonicalizes the email and matches
    # any alias form (e.g. @bs.nttdata.com vs @nttdata.com) so users
    # keep their pre-Okta admin status & history.
    try:
        user_data = _auth.identify_user(email)
    except Exception as e:
        return HTMLResponse(f"<html><body>User lookup failed: {e}</body></html>", status_code=500)

    user_data["permissions"] = _auth.get_permissions(user_data["role"])

    request.session["navigator_user"] = user_data

    return RedirectResponse("/?sso=1", status_code=302)


# ── GET /saml/logout ───────────────────────────────────────────

@router.get("/saml/logout")
async def saml_logout(request: Request):
    """Clear session and redirect to login."""
    request.session.clear()
    return RedirectResponse("/", status_code=302)


# ── GET /api/auth/me ───────────────────────────────────────────

@router.get("/api/auth/me")
async def saml_me(request: Request):
    """
    Called by the frontend after SSO redirect (?sso=1).
    Returns the session user so the JS can restore state.
    """
    user = request.session.get("navigator_user")
    if not user:
        from fastapi import HTTPException
        raise HTTPException(401, "No active session")
    return user


# ── GET /saml/metadata ─────────────────────────────────────────

@router.get("/saml/metadata")
async def saml_metadata(request: Request):
    """SP metadata — served to Okta for registration."""
    auth     = _build_saml_auth(request)
    settings = auth.get_settings()
    metadata = settings.get_sp_metadata()
    errors   = settings.validate_metadata(metadata)
    if errors:
        return Response(content=str(errors), status_code=500)
    return Response(content=metadata, media_type="application/xml")
