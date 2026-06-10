import warnings

import pandas as pd

SCENARIO_LIBRARY: list = []


def _norm(s: str) -> str:
    return s.lower().strip().replace(" ", "_").replace("-", "_")


def _safe_val(val) -> str:
    if val is None:
        return ""
    if isinstance(val, float) and pd.isna(val):
        return ""
    return str(val).strip()


def _load_scenario_library_from_bytes(excel_bytes: bytes) -> list:
    import io as _io
    try:
        xl = pd.ExcelFile(_io.BytesIO(excel_bytes), engine="openpyxl")
    except Exception as e:
        raise ValueError(f"Could not open Excel file: {e}")

    target_sheet = xl.sheet_names[0]
    for sh in xl.sheet_names:
        if _norm(sh) in ("scenario_library", "scenarios", "scenario", "library"):
            target_sheet = sh
            break

    try:
        df = xl.parse(target_sheet)
    except Exception as e:
        raise ValueError(f"Could not parse sheet '{target_sheet}': {e}")

    df = df.dropna(how="all").reset_index(drop=True)
    df.columns = [str(c) for c in df.columns]

    col_lookup = {_norm(c): c for c in df.columns}

    _scenario_aliases = {
        "mega_group": ["mega_group", "mega-group", "mega group", "group", "mega"],
        "category":   ["category", "cat", "sub_group", "sub-group", "subgroup"],
        "phase":      ["activate_phase", "activate phase", "phase", "sap_phase", "sap phase"],
        "title":      ["scenario_title", "title", "scenario title", "name"],
        "persona":    ["persona_/_role", "persona", "role", "persona_role", "persona / role"],
        "scenario":   ["scenarios", "scenario", "description", "prompt", "task", "body"],
        "task_type":  ["task_type", "task type", "tasktype", "type", "task_category", "task category"],
    }

    def _find_col(key):
        for alias in _scenario_aliases[key]:
            n = _norm(alias)
            if n in col_lookup:
                return col_lookup[n]
        return None

    col_mega      = _find_col("mega_group")
    col_category  = _find_col("category")
    col_phase     = _find_col("phase")
    col_title     = _find_col("title")
    col_persona   = _find_col("persona")
    col_scenario  = _find_col("scenario")
    col_task_type = _find_col("task_type")

    if not col_title and not col_scenario:
        raise ValueError(
            f"Sheet '{target_sheet}' has no recognisable title/scenario column. "
            f"Columns found: {list(df.columns)}"
        )

    scenarios = []
    last_mega = ""
    last_cat  = ""

    for _, row in df.iterrows():
        mega      = _safe_val(row[col_mega])      if col_mega      else ""
        category  = _safe_val(row[col_category])  if col_category  else ""
        phase     = _safe_val(row[col_phase])     if col_phase     else ""
        title     = _safe_val(row[col_title])     if col_title     else ""
        persona   = _safe_val(row[col_persona])   if col_persona   else ""
        scenario  = _safe_val(row[col_scenario])  if col_scenario  else ""
        task_type = _safe_val(row[col_task_type]) if col_task_type else ""

        if mega:
            last_mega = mega
        else:
            mega = last_mega

        if category:
            last_cat = category
        else:
            category = last_cat

        if not title and not scenario:
            continue
        if title.lower() in ("scenario title", "title", "name"):
            continue

        phase_clean = phase if phase and phase not in ("-", "—", "–") else ""
        scenarios.append({
            "mega_group": mega,
            "category":   category,
            "phase":      phase_clean,
            "title":      title,
            "persona":    persona,
            "scenario":   scenario,
            "task_type":  task_type,
        })

    return scenarios


def reload_scenario_library(excel_bytes: bytes = None,
                             excel_path: str = "AI_Navigator_Scenario_Library_Refined.xlsx"):
    global SCENARIO_LIBRARY

    if excel_bytes:
        new = _load_scenario_library_from_bytes(excel_bytes)
    else:
        with open(excel_path, "rb") as fh:
            new = _load_scenario_library_from_bytes(fh.read())

    SCENARIO_LIBRARY.clear()
    SCENARIO_LIBRARY.extend(new)


try:
    reload_scenario_library()
except Exception as _e:
    warnings.warn(
        f"[SCENARIO_LIBRARY] Failed to load Excel on startup: {_e}. "
        "Upload via the Scenario Library upload button in the UI.",
        RuntimeWarning,
        stacklevel=1,
    )
