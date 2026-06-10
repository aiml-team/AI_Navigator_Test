_CLARIFIER_SYSTEM_PROMPT_BASE = """
You are an expert AI Requirements Gatherer. Your job is to help users clarify their task so you can recommend the right AI tools later.
You MUST ensure you have three pieces of information from the user:
1. Their Role (e.g., Developer, Marketer, HR, Student)
2. Their Core Task (e.g., Write code, summarize documents, analyze data)
3. Specific Parameters (e.g., How many documents? What programming language? What expected output format?)

INSTRUCTIONS:
- If ANY of these 3 elements are missing or vague, politely ask ONE clear follow-up question to get the missing info. Do not ask multiple questions at once.
- Be professional, conversational, and helpful.
- Keep responses SHORT and SCANNABLE — no long paragraphs.
- If the user says 'skip', 'proceed', 'generate', or similar — treat the available info as sufficient and output the [SATISFIED] block immediately.
- If ALL 3 elements are clearly provided, you are satisfied. You must then output ONLY the following format:
[SATISFIED]
Role: <user_role>
Task Details: <detailed_task_description_with_parameters>

Do not add any conversational text if you are satisfied. Just output the [SATISFIED] block.
"""

# Keep the original name as an alias so existing imports still work
_CLARIFIER_SYSTEM_PROMPT = _CLARIFIER_SYSTEM_PROMPT_BASE


def build_clarifier_prompt(default_role: str = "") -> str:
    """Return the system prompt, injecting the known default role when set."""
    dr = (default_role or "").strip()
    if dr and dr.lower() not in ("", "general"):
        prefix = (
            f'IMPORTANT: The user\'s role is already known as "{dr}". '
            "Do NOT ask the user about their role — treat it as already provided. "
            "Focus only on clarifying their core task and specific parameters.\n\n"
        )
        return prefix + _CLARIFIER_SYSTEM_PROMPT_BASE
    return _CLARIFIER_SYSTEM_PROMPT_BASE


def _parse_satisfied_block(text: str, fallback_role: str, fallback_task: str) -> dict:
    lines = text.replace("[SATISFIED]", "").strip().splitlines()
    role_val = fallback_role or "general"
    task_val = fallback_task or ""

    for line in lines:
        if line.lower().startswith("role:"):
            role_val = line.split(":", 1)[1].strip() or role_val
        elif line.lower().startswith("task details:"):
            task_val = line.split(":", 1)[1].strip() or task_val

    TASK_TYPE_KEYWORDS = {
        "Research & Analysis":  ["research", "analys", "findings", "review", "report"],
        "Writing & Docs":       ["write", "document", "draft", "proposal", "summary"],
        "Strategy & Planning":  ["strategy", "plan", "roadmap", "decision"],
        "Data Analysis":        ["data", "dashboard", "kpi", "metric", "chart", "insight"],
        "Code & Dev":           ["code", "script", "debug", "develop", "program", "api", "automate"],
        "Creative Content":     ["blog", "article", "creative", "post", "copy", "marketing"],
        "Communication":        ["email", "message", "communicate", "reply"],
        "Learning & Training":  ["learn", "training", "tutorial", "course"],
        "Process Automation":   ["automate", "workflow", "process", "pipeline"],
        "Decision Support":     ["decide", "compare", "evaluate", "recommend"],
    }
    detected_task_type = "general"
    task_lower = task_val.lower()
    for tt, kws in TASK_TYPE_KEYWORDS.items():
        if any(kw in task_lower for kw in kws):
            detected_task_type = tt
            break

    return {
        "role":             role_val,
        "task_type":        detected_task_type,
        "task_description": task_val,
    }
