"""
One-shot migration — clear `task_source` on ALL existing rows in
`audit_log` and `feedback`.

Why: the task_source column was populated for every historical row as
"typed" (or nothing) before we finished wiring the frontend flag. The
label on old rows is meaningless, so we wipe them. Going forward, new
runs will get an accurate value from the frontend flag ("scenario_library"
or "typed"), and the UI is set up to render NO badge for empty values.

Usage:
    python scripts/clear_task_source.py

Safe to re-run — the UPDATE statements are idempotent (setting already-empty
rows to '' is a no-op).
"""

import os
import sys

# Make sure the project root is on sys.path so we can import services.*
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from services.database import get_db  # noqa: E402


def _clear_column(conn, table: str, column: str) -> tuple[int, int]:
    """
    Returns (before_non_empty, after_non_empty) — number of rows whose
    value was non-empty before/after the UPDATE.
    """
    try:
        before_row = conn.execute(
            f"SELECT COUNT(*) AS c FROM {table} "
            f"WHERE {column} IS NOT NULL AND {column} <> ''"
        ).fetchone()
        before = int(before_row["c"]) if before_row else 0
    except Exception as e:
        print(f"[ERROR] Could not count non-empty rows in {table}.{column}: {e}")
        return (0, 0)

    if before == 0:
        print(f"  {table}.{column}: already all empty — nothing to do.")
        return (0, 0)

    try:
        conn.execute(
            f"UPDATE {table} SET {column} = '' "
            f"WHERE {column} IS NOT NULL AND {column} <> ''"
        )
        conn.commit()
    except Exception as e:
        print(f"[ERROR] UPDATE failed for {table}.{column}: {e}")
        return (before, before)

    try:
        after_row = conn.execute(
            f"SELECT COUNT(*) AS c FROM {table} "
            f"WHERE {column} IS NOT NULL AND {column} <> ''"
        ).fetchone()
        after = int(after_row["c"]) if after_row else 0
    except Exception:
        after = 0

    cleared = before - after
    print(f"  {table}.{column}: cleared {cleared} rows (before={before}, after={after})")
    return (before, after)


def main() -> int:
    print("[clear_task_source] Connecting to database…")
    try:
        conn = get_db()
    except Exception as e:
        print(f"[FATAL] Could not open DB connection: {e}")
        return 1

    try:
        print("[clear_task_source] Clearing task_source on historical rows:")
        _clear_column(conn, "audit_log", "task_source")
        _clear_column(conn, "feedback",  "task_source")
    finally:
        try:
            conn.close()
        except Exception:
            pass

    print("[clear_task_source] Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
