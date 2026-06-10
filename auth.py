"""
auth.py
═══════════════════════════════════════════════════════════════
Manages user identity and role resolution against Azure SQL.

Tables (all prefixed with "Navigator"):
  NavigatorAdmins  — pre-seeded by the admin; anyone whose email
                     appears here is treated as ADMIN.
  NavigatorUsers   — auto-populated on first login for anyone
                     whose email is NOT in NavigatorAdmins.

Flow:
  identify_user(email)
    1. Look up email in NavigatorAdmins  → role = "admin"
    2. Look up email in NavigatorUsers   → role = "user"
    3. If not found anywhere             → insert into NavigatorUsers
                                           role = "user"
    Returns: { "email": ..., "role": "admin"|"user", "name": ... }

Permissions (used by the frontend):
  ADMIN  can see: Scenario Review, Scenario Log, Analytics,
                  View Feedback, Tools Change Log, Upload Policy,
                  Register Scenario
  USER   can see: Scenario Library, Suggest a Scenario,
                  Feedback Form, Home
═══════════════════════════════════════════════════════════════
"""

import os
import struct
import pyodbc
from datetime import datetime, timezone


# ═══════════════════════════════════════════════════════════════
# Email canonicalization (Okta SSO compatibility)
# ───────────────────────────────────────────────────────────────
# Before Okta SSO, users were keyed on `<name>@bs.nttdata.com`.
# Okta now sends NameID as the bare `<name>@nttdata.com` (no `bs.`
# subdomain), so the same person appears under two different
# addresses. canonicalize_email() strips the `bs.` subdomain so
# both forms map to the same canonical identity, and email_aliases()
# returns every variant — used in SQL `WHERE … IN (?, ?)` to find
# historical rows under any alias form.
# ═══════════════════════════════════════════════════════════════

# Subdomain prefixes to collapse, scoped per root-domain so we don't
# generate nonsense aliases for external emails (e.g. @gmail.com).
# Format: { "root.domain.com": ("prefix1.", "prefix2.", ...) }
_DOMAIN_ALIAS_RULES = {
    "nttdata.com": ("bs.",),
}


def _split_domain(email: str) -> tuple[str, str]:
    """Return (local_part, domain). Both lowercased. ('', '') if malformed."""
    if not email or "@" not in email:
        return ("", "")
    local, _, domain = email.strip().lower().partition("@")
    return (local, domain)


def canonicalize_email(email: str) -> str:
    """Return the canonical lowercase form of `email`.

    Historical data uses the prefixed form (e.g. `alice@bs.nttdata.com`),
    so we canonicalize TO that form. Okta sends `alice@nttdata.com` —
    we rewrite it to `alice@bs.nttdata.com` so display, session, and
    new audit rows all match the existing DB convention. External
    (non-NTT) emails are returned unchanged (just lowercased + trimmed).
    """
    if not email:
        return ""
    local, domain = _split_domain(email)
    if not domain:
        return email.strip().lower()

    for root, prefixes in _DOMAIN_ALIAS_RULES.items():
        # Canonical form is the FIRST prefix attached to the root.
        canonical_prefix = prefixes[0] if prefixes else ""
        canonical_domain = f"{canonical_prefix}{root}"

        # Already in canonical (prefixed) form.
        if domain == canonical_domain:
            return f"{local}@{canonical_domain}"
        # Bare root → add the prefix.
        if domain == root:
            return f"{local}@{canonical_domain}"
        # Other known prefix variant → normalize to canonical prefix.
        for prefix in prefixes:
            if domain == f"{prefix}{root}":
                return f"{local}@{canonical_domain}"

    return f"{local}@{domain}"


def email_aliases(email: str) -> list[str]:
    """Return every lowercase email variant that maps to the same
    identity as `email` — i.e. the canonical (prefixed) form, the
    bare-root form, and every other known prefix variant. Used in
    SQL `WHERE … IN (?, ?, …)` clauses so rows stored under any
    alias form are matched.
    """
    canonical = canonicalize_email(email)
    local, domain = _split_domain(canonical)
    if not domain:
        return [canonical] if canonical else []

    variants = {canonical}
    for root, prefixes in _DOMAIN_ALIAS_RULES.items():
        # If the canonical domain is one of our managed (root/prefix)
        # domains, emit every known variant for this identity.
        if domain == root or any(domain == f"{p}{root}" for p in prefixes):
            variants.add(f"{local}@{root}")
            for prefix in prefixes:
                variants.add(f"{local}@{prefix}{root}")
    return sorted(variants)


# ── connection string built from .env vars ─────────────────────
def _get_conn() -> pyodbc.Connection:
    server   = os.getenv("AZURE_SQL_SERVER",   "")
    database = os.getenv("AZURE_SQL_DATABASE", "")
    username = os.getenv("AZURE_SQL_USERNAME", "")
    password = os.getenv("AZURE_SQL_PASSWORD", "")

    conn_str = (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"UID={username};"
        f"PWD={password};"
        "Encrypt=yes;"
        "TrustServerCertificate=no;"
        "Connection Timeout=30;"
    )
    return pyodbc.connect(conn_str)


# ── create tables if they don't exist ─────────────────────────
def init_navigator_tables() -> None:
    """
    Called once at startup (from main.py lifespan).
    Creates NavigatorAdmins and NavigatorUsers if they don't exist.
    """
    try:
        conn = _get_conn()
        cur  = conn.cursor()

        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables WHERE name = 'NavigatorAdmins'
            )
            CREATE TABLE NavigatorAdmins (
                id          INT IDENTITY(1,1) PRIMARY KEY,
                email       NVARCHAR(255) NOT NULL UNIQUE,
                name        NVARCHAR(255) DEFAULT '',
                added_at    DATETIME2     DEFAULT GETUTCDATE()
            );
        """)

        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables WHERE name = 'NavigatorUsers'
            )
            CREATE TABLE NavigatorUsers (
                id         INT IDENTITY(1,1) PRIMARY KEY,
                email      NVARCHAR(255) NOT NULL UNIQUE,
                name       NVARCHAR(255) DEFAULT '',
                first_seen DATETIME2     DEFAULT GETUTCDATE(),
                last_seen  DATETIME2     DEFAULT GETUTCDATE()
            );
        """)

        conn.commit()
        conn.close()
        print("[auth] NavigatorAdmins and NavigatorUsers tables ready.")
    except Exception as e:
        print(f"[auth] WARNING: Could not initialise Azure SQL tables: {e}")


# ── core identify function ─────────────────────────────────────
def identify_user(email: str) -> dict:
    """
    Resolve role for the given email.

    Returns:
        {
            "email": "...",
            "role":  "admin" | "user",
            "name":  "...",         # empty string if not recorded
        }

    Raises:
        Exception — caller should handle and return 500.
    """
    raw_email = (email or "").strip().lower()
    if not raw_email:
        raise ValueError("Email must not be empty.")

    # Build the alias set so we match historical rows that were
    # keyed on @bs.nttdata.com before Okta started sending @nttdata.com.
    aliases   = email_aliases(raw_email)
    canonical = canonicalize_email(raw_email)
    placeholders = ",".join("?" * len(aliases))

    conn = _get_conn()
    cur  = conn.cursor()

    try:
        # 1. Check admin table — match ANY alias of this identity.
        cur.execute(
            f"SELECT email, name FROM NavigatorAdmins WHERE LOWER(email) IN ({placeholders})",
            aliases,
        )
        row = cur.fetchone()
        if row:
            return {"email": canonical, "role": "admin", "name": row[1] or ""}

        # 2. Check user table — match ANY alias.
        cur.execute(
            f"SELECT email, name FROM NavigatorUsers WHERE LOWER(email) IN ({placeholders})",
            aliases,
        )
        row = cur.fetchone()
        if row:
            cur.execute(
                f"UPDATE NavigatorUsers SET last_seen = ? WHERE LOWER(email) IN ({placeholders})",
                [datetime.now(timezone.utc), *aliases],
            )
            conn.commit()
            return {"email": canonical, "role": "user", "name": row[1] or ""}

        # 3. Brand new identity — store under the canonical form so
        # all future lookups are stable.
        now = datetime.now(timezone.utc)
        cur.execute(
            """
            INSERT INTO NavigatorUsers (email, name, first_seen, last_seen)
            VALUES (?, '', ?, ?)
            """,
            (canonical, now, now),
        )
        conn.commit()
        return {"email": canonical, "role": "user", "name": ""}

    finally:
        conn.close()


# ── admin management helpers ───────────────────────────────────
def list_admins() -> list[dict]:
    """Return all rows in NavigatorAdmins."""
    conn = _get_conn()
    cur  = conn.cursor()
    cur.execute("SELECT id, email, name, added_at FROM NavigatorAdmins ORDER BY added_at DESC")
    rows = cur.fetchall()
    conn.close()
    return [
        {"id": r[0], "email": r[1], "name": r[2], "added_at": str(r[3])}
        for r in rows
    ]


def add_admin(email: str, name: str = "") -> dict:
    """Insert a new admin (or ignore if any alias form already exists).
    The canonical form is stored so future logins match regardless of
    which domain alias Okta sends."""
    canonical = canonicalize_email(email)
    aliases   = email_aliases(email)
    placeholders = ",".join("?" * len(aliases))

    conn  = _get_conn()
    cur   = conn.cursor()
    cur.execute(
        f"""
        IF NOT EXISTS (SELECT 1 FROM NavigatorAdmins WHERE LOWER(email) IN ({placeholders}))
            INSERT INTO NavigatorAdmins (email, name) VALUES (?, ?)
        """,
        [*aliases, canonical, name.strip()],
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "email": canonical}


def remove_admin(email: str) -> dict:
    """Remove an admin — deletes ANY alias form of the given email."""
    aliases = email_aliases(email)
    placeholders = ",".join("?" * len(aliases))

    conn  = _get_conn()
    cur   = conn.cursor()
    cur.execute(
        f"DELETE FROM NavigatorAdmins WHERE LOWER(email) IN ({placeholders})",
        aliases,
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "email": canonicalize_email(email)}


def list_users(page: int = 1, per_page: int = 50) -> dict:
    """Return paginated NavigatorUsers rows."""
    conn   = _get_conn()
    cur    = conn.cursor()
    offset = (page - 1) * per_page
    cur.execute("SELECT COUNT(*) FROM NavigatorUsers")
    total = cur.fetchone()[0]
    cur.execute(
        """
        SELECT id, email, name, first_seen, last_seen
        FROM NavigatorUsers
        ORDER BY last_seen DESC
        OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
        """,
        (offset, per_page)
    )
    rows = cur.fetchall()
    conn.close()
    return {
        "total": total,
        "page":  page,
        "items": [
            {
                "id":            r[0],
                "email":         r[1],
                "name":          r[2],
                "first_seen_at": str(r[3]),
                "last_seen_at":  str(r[4]),
            }
            for r in rows
        ],
    }


# ── permission map (used by the frontend) ─────────────────────
PERMISSIONS = {
    "admin": [
        "home",
        "promptlibrary",
        "tools",
        "history",
        "analytics",
        "policies",
        "admin-scenarios",
        "feedback-view",
        "register-scenario",
        "register-tool",
        "suggest-scenario",
        "feedback-form",
        "toggle-menu",
    ],
    "user": [
        "home",
        "promptlibrary",
        "tools",
        "history",
        "suggest-scenario",
        "feedback-form",
    ],
}


def get_permissions(role: str) -> list[str]:
    return PERMISSIONS.get(role, PERMISSIONS["user"])
