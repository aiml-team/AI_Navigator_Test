"""
services/database.py
━━━━━━━━━━━━━━━━━━━━
Azure SQL database layer (replaces SQLite).
Uses pyodbc with ODBC Driver 18 for SQL Server.

get_db()          → returns an open AzureSqlConn wrapper
log_tool_change() → audit trail for tool registry changes
init_db()         → creates all tables if they don't exist (called at startup)
"""

import json
import logging
import os
import re
import uuid
from datetime import datetime

import pyodbc

_log = logging.getLogger("services.database")


# ── raw connection ─────────────────────────────────────────────

def _get_raw_conn() -> pyodbc.Connection:
    server   = os.getenv("AZURE_SQL_SERVER",   "")
    database = os.getenv("AZURE_SQL_DATABASE", "")
    username = os.getenv("AZURE_SQL_USERNAME", "")
    password = os.getenv("AZURE_SQL_PASSWORD", "")

    conn_str = (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER=tcp:{server},1433;"
        f"DATABASE={database};"
        f"UID={username};"
        f"PWD={password};"
        "Encrypt=yes;"
        "TrustServerCertificate=no;"
        "Connection Timeout=10;"
    )
    conn = pyodbc.connect(conn_str)
    conn.autocommit = False
    return conn


# ── row wrapper — makes pyodbc rows behave like sqlite3.Row ───

class _Row(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)

    def __getattr__(self, key):
        try:
            return self[key]
        except KeyError:
            raise AttributeError(key)


def _fetchall(cursor) -> list:
    if cursor.description is None:
        return []
    cols = [d[0] for d in cursor.description]
    return [_Row(zip(cols, row)) for row in cursor.fetchall()]


def _fetchone(cursor):
    if cursor.description is None:
        return None
    cols = [d[0] for d in cursor.description]
    row  = cursor.fetchone()
    return None if row is None else _Row(zip(cols, row))


# ── cursor wrapper ─────────────────────────────────────────────

class _CursorWrapper:
    def __init__(self, cursor):
        self._cur = cursor

    def fetchone(self):
        return _fetchone(self._cur)

    def fetchall(self):
        return _fetchall(self._cur)

    @property
    def description(self):
        return self._cur.description


# ── SQL dialect helpers ────────────────────────────────────────

def _adapt_sql(sql: str) -> str:
    """Convert SQLite-isms to T-SQL equivalents."""
    sql = sql.replace("AUTOINCREMENT", "")

    sql = re.sub(
        r"strftime\s*\(\s*'%Y-%m-%d'\s*,\s*([^)]+)\)",
        r"FORMAT(TRY_CAST(\1 AS DATETIME2), 'yyyy-MM-dd')",
        sql, flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"strftime\s*\(\s*'%H'\s*,\s*([^)]+)\)",
        r"FORMAT(TRY_CAST(\1 AS DATETIME2), 'HH')",
        sql, flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"strftime\s*\(\s*'([^']+)'\s*,\s*([^)]+)\)",
        lambda m: f"FORMAT(TRY_CAST({m.group(2).strip()} AS DATETIME2), '{m.group(1)}')",
        sql, flags=re.IGNORECASE,
    )

    def _convert_limit(m):
        limit_val = m.group(2).strip()
        select_part = m.group(1)
        return re.sub(r'(?i)\bSELECT\b', f'SELECT TOP {limit_val}', select_part, count=1)

    sql = re.sub(
        r'(SELECT\b.*?)\bLIMIT\s+(\d+)',
        _convert_limit,
        sql,
        flags=re.IGNORECASE | re.DOTALL,
    )

    return sql


def _split_script(script: str) -> list[str]:
    return [s.strip() for s in script.split(";") if s.strip()]


# ── connection wrapper ─────────────────────────────────────────

class AzureSqlConn:
    """
    Wraps pyodbc.Connection to mimic the sqlite3 interface used
    throughout all routes (execute / commit / close).
    """

    def __init__(self, conn: pyodbc.Connection):
        self._conn   = conn
        self._cursor = conn.cursor()

    def execute(self, sql: str, params=None) -> _CursorWrapper:
        sql = _adapt_sql(sql)
        if params:
            self._cursor.execute(sql, list(params))
        else:
            self._cursor.execute(sql)
        return _CursorWrapper(self._cursor)

    def executescript(self, script: str):
        for stmt in _split_script(script):
            adapted = _adapt_sql(stmt)
            try:
                self._cursor.execute(adapted)
                self._conn.commit()
            except Exception as e:
                self._conn.rollback()
                print(f"[db] executescript warning: {e}")

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        try:
            self._cursor.close()
        except Exception:
            pass
        try:
            self._conn.close()
        except Exception:
            pass


# ── public API ─────────────────────────────────────────────────

def get_db() -> AzureSqlConn:
    return AzureSqlConn(_get_raw_conn())


def log_tool_change(tool_name: str, action: str, changed_fields: dict = None, note: str = ""):
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO tool_change_log (id, tool_name, action, changed_fields, changed_by, note, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                str(uuid.uuid4()),
                tool_name,
                action,
                json.dumps(changed_fields or {}),
                "admin",
                note,
                datetime.utcnow().isoformat(),
            ),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[db] log_tool_change error: {e}")


# ── init_db — idempotent table creation in Azure SQL ──────────

def init_db():
    try:
        conn = get_db()
    except Exception as exc:
        _log.warning(
            "[db] Could not connect to Azure SQL at startup — skipping table init. "
            "The app will start, but database-backed features will fail until the "
            "connection is restored. Error: %s", exc
        )
        return

    ddl_statements = [
        """
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'audit_log')
        CREATE TABLE audit_log (
            id                  NVARCHAR(64)   NOT NULL PRIMARY KEY,
            created_at          NVARCHAR(50)   NULL,
            raw_input           NVARCHAR(MAX)  NULL,
            intent              NVARCHAR(255)  NULL,
            industry            NVARCHAR(255)  NULL,
            recommended_tool    NVARCHAR(255)  NULL,
            tool_reason         NVARCHAR(MAX)  NULL,
            tool_confidence     NVARCHAR(50)   NULL,
            policy_flags        NVARCHAR(MAX)  NULL,
            retrieved_policies  NVARCHAR(MAX)  NULL,
            final_prompt        NVARCHAR(MAX)  NULL,
            prompt_version      NVARCHAR(50)   NULL,
            model_used          NVARCHAR(255)  NULL,
            output              NVARCHAR(MAX)  NULL,
            token_estimate      INT            NULL DEFAULT 0,
            system_version      NVARCHAR(50)   NULL,
            policy_blocked      INT            NULL DEFAULT 0,
            policy_summary      NVARCHAR(MAX)  NULL DEFAULT '',
            role                NVARCHAR(255)  NULL DEFAULT 'general',
            user_email          NVARCHAR(255)  NULL DEFAULT '',
            task_source         NVARCHAR(50)   NULL DEFAULT 'typed',
            scenario_id         NVARCHAR(64)   NULL DEFAULT '',
            scenario_title      NVARCHAR(500)  NULL DEFAULT ''
        )
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'feedback')
        CREATE TABLE feedback (
            id          NVARCHAR(64)   NOT NULL PRIMARY KEY,
            audit_id    NVARCHAR(64)   NULL,
            email       NVARCHAR(255)  NULL DEFAULT '',
            rating      INT            NULL,
            comment     NVARCHAR(MAX)  NULL,
            issue_type  NVARCHAR(255)  NULL,
            created_at  NVARCHAR(50)   NULL,
            source      NVARCHAR(50)   NULL DEFAULT 'form',
            files       NVARCHAR(MAX)  NULL DEFAULT '[]',
            task_source NVARCHAR(50)   NULL DEFAULT ''
        )
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'prompt_versions')
        CREATE TABLE prompt_versions (
            id          NVARCHAR(64)   NOT NULL PRIMARY KEY,
            version     NVARCHAR(50)   NOT NULL,
            intent      NVARCHAR(255)  NULL,
            industry    NVARCHAR(255)  NULL,
            template    NVARCHAR(MAX)  NOT NULL,
            change_note NVARCHAR(MAX)  NULL,
            created_at  NVARCHAR(50)   NULL,
            created_by  NVARCHAR(255)  NULL DEFAULT 'system'
        )
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'registered_tools')
        CREATE TABLE registered_tools (
            id              NVARCHAR(64)   NOT NULL PRIMARY KEY,
            tool_name       NVARCHAR(255)  NOT NULL,
            description     NVARCHAR(MAX)  NULL DEFAULT '',
            category        NVARCHAR(255)  NULL DEFAULT '',
            url             NVARCHAR(500)  NULL DEFAULT '',
            icon            NVARCHAR(10)   NULL DEFAULT N'🤖',
            best_for        NVARCHAR(MAX)  NULL DEFAULT '[]',
            strong_signals  NVARCHAR(MAX)  NULL DEFAULT '[]',
            weak_signals    NVARCHAR(MAX)  NULL DEFAULT '[]',
            not_for         NVARCHAR(MAX)  NULL DEFAULT '[]',
            roles           NVARCHAR(MAX)  NULL DEFAULT '[]',
            output_type     NVARCHAR(255)  NULL DEFAULT '',
            is_internal     INT            NULL DEFAULT 0,
            raw_data        NVARCHAR(MAX)  NULL DEFAULT '{}',
            source          NVARCHAR(50)   NULL DEFAULT 'manual',
            created_at      NVARCHAR(50)   NULL,
            updated_at      NVARCHAR(50)   NULL,
            CONSTRAINT uq_registered_tools_name UNIQUE (tool_name)
        )
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'tool_change_log')
        CREATE TABLE tool_change_log (
            id              NVARCHAR(64)   NOT NULL PRIMARY KEY,
            tool_name       NVARCHAR(255)  NOT NULL,
            action          NVARCHAR(100)  NOT NULL,
            changed_fields  NVARCHAR(MAX)  NULL DEFAULT '{}',
            changed_by      NVARCHAR(255)  NULL DEFAULT 'admin',
            note            NVARCHAR(MAX)  NULL DEFAULT '',
            created_at      NVARCHAR(50)   NULL
        )
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'scenario_suggestions')
        CREATE TABLE scenario_suggestions (
            id              NVARCHAR(64)   NOT NULL PRIMARY KEY,
            title           NVARCHAR(500)  NOT NULL,
            mega_group      NVARCHAR(255)  NOT NULL,
            category        NVARCHAR(255)  NULL DEFAULT '',
            persona         NVARCHAR(255)  NULL DEFAULT '',
            activate_phase  NVARCHAR(255)  NULL DEFAULT '',
            scenario        NVARCHAR(MAX)  NOT NULL,
            submitted_by    NVARCHAR(255)  NULL DEFAULT '',
            submitted_at    NVARCHAR(50)   NOT NULL,
            status          NVARCHAR(50)   NULL DEFAULT 'pending',
            admin_note      NVARCHAR(MAX)  NULL DEFAULT '',
            reviewed_at     NVARCHAR(50)   NULL DEFAULT ''
        )
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserToolAccess')
        CREATE TABLE UserToolAccess (
            id         NVARCHAR(64)   NOT NULL PRIMARY KEY,
            user_email NVARCHAR(255)  NOT NULL,
            tool_name  NVARCHAR(255)  NOT NULL,
            has_access BIT            NOT NULL DEFAULT 0,
            created_at NVARCHAR(50)   NULL,
            updated_at NVARCHAR(50)   NULL,
            CONSTRAINT uq_user_tool_access UNIQUE (user_email, tool_name)
        )
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'technical_feedbacks')
        CREATE TABLE technical_feedbacks (
            id              NVARCHAR(64)   NOT NULL PRIMARY KEY,
            feedback_id     NVARCHAR(64)   NULL DEFAULT '',
            problem_title   NVARCHAR(500)  NOT NULL,
            problem_desc    NVARCHAR(MAX)  NULL DEFAULT '',
            category        NVARCHAR(100)  NULL DEFAULT '',
            feature_area    NVARCHAR(100)  NULL DEFAULT '',
            status          NVARCHAR(50)   NOT NULL DEFAULT 'pending',
            affected_count  INT            NOT NULL DEFAULT 1,
            reporter_emails NVARCHAR(MAX)  NULL DEFAULT '[]',
            first_reported  NVARCHAR(50)   NULL DEFAULT '',
            last_reported   NVARCHAR(50)   NULL DEFAULT '',
            resolved_at     NVARCHAR(50)   NULL DEFAULT '',
            admin_note      NVARCHAR(MAX)  NULL DEFAULT '',
            created_at      NVARCHAR(50)   NULL DEFAULT '',
            updated_at      NVARCHAR(50)   NULL DEFAULT ''
        )
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserDefaultRole')
        CREATE TABLE UserDefaultRole (
            id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            user_email   NVARCHAR(255)     NOT NULL,
            default_role NVARCHAR(255)     NOT NULL DEFAULT '',
            created_at   NVARCHAR(50)      NULL,
            updated_at   NVARCHAR(50)      NULL,
            CONSTRAINT uq_user_default_role UNIQUE (user_email)
        )
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_saved_scenarios')
        CREATE TABLE user_saved_scenarios (
            id          NVARCHAR(64)   NOT NULL PRIMARY KEY,
            user_email  NVARCHAR(255)  NOT NULL,
            title       NVARCHAR(500)  NOT NULL,
            scenario    NVARCHAR(MAX)  NULL DEFAULT '',
            persona     NVARCHAR(255)  NULL DEFAULT '',
            mega_group  NVARCHAR(255)  NULL DEFAULT '',
            category    NVARCHAR(255)  NULL DEFAULT '',
            saved_at    NVARCHAR(50)   NULL DEFAULT '',
            CONSTRAINT uq_user_saved_scenario UNIQUE (user_email, title)
        )
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'scenarios')
        CREATE TABLE scenarios (
            id          NVARCHAR(64)   NOT NULL PRIMARY KEY,
            mega_group  NVARCHAR(255)  NULL DEFAULT '',
            category    NVARCHAR(255)  NULL DEFAULT '',
            phase       NVARCHAR(255)  NULL DEFAULT '',
            title       NVARCHAR(500)  NULL DEFAULT '',
            persona     NVARCHAR(255)  NULL DEFAULT '',
            scenario    NVARCHAR(MAX)  NULL DEFAULT '',
            task_type   NVARCHAR(255)  NULL DEFAULT '',
            source      NVARCHAR(50)   NULL DEFAULT 'excel',
            created_at  NVARCHAR(50)   NULL DEFAULT '',
            summary     NVARCHAR(MAX)  NULL DEFAULT '',
            is_tested   INT            NULL DEFAULT 0
        )
        """,
    ]

    for ddl in ddl_statements:
        try:
            conn.execute(ddl)
            conn.commit()
        except Exception as e:
            print(f"[db] Table creation warning: {e}")

    _add_columns_if_missing(conn)
    _seed_default_prompt_version(conn)
    conn.close()
    print("[db] Azure SQL database ready.")


def _add_columns_if_missing(conn: AzureSqlConn):
    additions = [
        ("audit_log",           "policy_blocked", "INT NULL DEFAULT 0"),
        ("audit_log",           "policy_summary",  "NVARCHAR(MAX) NULL DEFAULT ''"),
        ("audit_log",           "role",            "NVARCHAR(255) NULL DEFAULT 'general'"),
        ("audit_log",           "user_email",      "NVARCHAR(255) NULL DEFAULT ''"),
        ("feedback",            "email",           "NVARCHAR(255) NULL DEFAULT ''"),
        ("feedback",            "source",          "NVARCHAR(50) NULL DEFAULT 'form'"),
        ("feedback",            "files",           "NVARCHAR(MAX) NULL DEFAULT '[]'"),
        ("technical_feedbacks", "feature_area",    "NVARCHAR(100) NULL DEFAULT ''"),
        ("registered_tools",    "source",          "NVARCHAR(50) NULL DEFAULT 'manual'"),
        ("scenarios",           "summary",         "NVARCHAR(MAX) NULL DEFAULT ''"),
        ("audit_log",           "task_source",     "NVARCHAR(50) NULL DEFAULT 'typed'"),
        ("feedback",            "task_source",     "NVARCHAR(50) NULL DEFAULT ''"),
        # Scenario Library provenance — populated on runs that originate from
        # the Scenario Library so the View modal can show which scenario the
        # user selected. Both nullable/blank for typed runs and for historical
        # rows that pre-date this column.
        ("audit_log",           "scenario_id",     "NVARCHAR(64) NULL DEFAULT ''"),
        ("audit_log",           "scenario_title",  "NVARCHAR(500) NULL DEFAULT ''"),
        # Temporary beta-tracking flag on live scenarios so admins can mark a
        # scenario Tested / Untested from the Scenario Library card. Default 0
        # (Untested) so every existing row shows the beta chip until an admin
        # flips it. See routes/scenarios.py toggle endpoint.
        ("scenarios",           "is_tested",       "INT NULL DEFAULT 0"),
    ]
    for table, col, definition in additions:
        try:
            conn.execute(
                f"IF NOT EXISTS ("
                f"  SELECT 1 FROM sys.columns "
                f"  WHERE object_id = OBJECT_ID(N'{table}') AND name = N'{col}'"
                f") ALTER TABLE {table} ADD {col} {definition}"
            )
            conn.commit()
        except Exception as e:
            print(f"[db] Column check '{table}.{col}': {e}")


def _seed_default_prompt_version(conn: AzureSqlConn):
    try:
        row = conn.execute("SELECT COUNT(*) AS c FROM prompt_versions").fetchone()
        if row and int(row["c"]) == 0:
            conn.execute(
                "INSERT INTO prompt_versions VALUES (?,?,?,?,?,?,?,?)",
                (
                    str(uuid.uuid4()), "1.0", "general", "general",
                    "## ROLE\nYou are an expert {industry} professional specializing in {intent} tasks.\n\n"
                    "## CONTEXT\nUser Request: {user_input}\nIndustry: {industry} | Task Type: {intent}\nTarget Tool: {tool}\n\n"
                    "## OBJECTIVE\nProduce a high-quality, professional {intent} that directly addresses the user's need.\n\n"
                    "## LIMITATIONS & COMPLIANCE POLICIES\n{policy_block}\n  - No confidential or PII data\n  - Follow {industry} industry standards\n\n"
                    "## OUTPUT FORMAT\n1. Executive Summary\n2. Main Content\n3. Key Recommendations\n4. Compliance Notes",
                    "Initial CORLO template", datetime.utcnow().isoformat(), "system"
                )
            )
            conn.commit()
    except Exception as e:
        print(f"[db] Seed prompt_versions: {e}")
