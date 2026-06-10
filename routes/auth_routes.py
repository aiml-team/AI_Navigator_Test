from fastapi import APIRouter, HTTPException, Form
import auth as _auth

router = APIRouter()


@router.post("/api/auth/identify")
async def identify(email: str = Form(...)):
    """Legacy manual-login endpoint — kept for fallback / testing.
    identify_user() handles canonicalization + alias lookup internally,
    so callers passing either @bs.nttdata.com or @nttdata.com resolve
    to the same identity. The primary auth path is now /saml/acs."""
    try:
        result = _auth.identify_user(email)
        result["permissions"] = _auth.get_permissions(result["role"])
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Auth error: {e}")


@router.get("/api/auth/admins")
async def get_admins():
    try:
        return {"admins": _auth.list_admins()}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/api/auth/admins/add")
async def add_admin(email: str = Form(...), name: str = Form("")):
    try:
        return _auth.add_admin(email, name)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/api/auth/admins/remove")
async def remove_admin(email: str = Form(...)):
    try:
        return _auth.remove_admin(email)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/api/auth/users")
async def get_users(page: int = 1, per_page: int = 50):
    try:
        return _auth.list_users(page, per_page)
    except Exception as e:
        raise HTTPException(500, str(e))
