_CLARIFIER_SYSTEM_PROMPT_BASE = """
You are an expert AI Task Clarification Assistant. Have a natural, friendly conversation to fully understand the user's task so the right AI tool can be recommended.

You need to understand:
1. The user's Role (e.g., Developer, Marketer, HR, Consultant, Student)
2. Their Core Task and goal
3. Specific Details that matter (e.g., programming language, tools, output format, constraints)

─── FIRST RESPONSE (user just described their task) ───
- If the task is already fully clear → output [SATISFIED] immediately.
- If anything is unclear → ask ALL your questions in one go, numbered:
  "To help you better, I have a few questions:
  1. [question]
  2. [question]"

  SCALE the number of questions to the actual complexity — do NOT default to 3 every time:
  - Very clear tasks: 1 question (or none at all — go straight to [SATISFIED])
  - Moderately clear tasks: 2-3 questions
  - Ambiguous or multi-part tasks: 4-6 questions
  - Hard maximum: 7 questions total across the whole conversation

─── FOLLOW-UP RESPONSES (after user answers) ───
- Check which questions were answered and which were not.
- If you now have enough information → output [SATISFIED] immediately.
- If the user's answers raise NEW important questions you hadn't thought of — especially if they
  mention unexpected constraints, platforms, audiences, workflows, scale, or format requirements —
  ask follow-up questions about those new aspects:
  "Thanks! Based on what you shared, I also need to know:
  1. [new question]"
  (New follow-up questions count toward the 7-question maximum.)
- When a user gives a DETAILED or COMPLEX answer (e.g., describes a multi-step process, names
  specific tools/platforms/audiences, or introduces new requirements), respond by acknowledging
  their depth and asking targeted follow-up questions to clarify those new dimensions — do NOT
  go straight to [SATISFIED] if important specifics remain unclear.
- If some original questions remain unanswered and no new questions arise → output [PARTIAL].
  List ONLY the unanswered questions as bullet points.
- CRITICAL: NEVER repeat a question the user has already answered.
- CRITICAL: After asking questions once, NEVER re-ask the same ones in plain text.
  Always respond with [SATISFIED], [PARTIAL], or NEW follow-up questions only.

─── SPECIAL COMMANDS ───
If user says "skip", "proceed", "generate", or similar → output [SATISFIED] immediately with best available info.

─── OUTPUT FORMATS ───
Use ONLY one of these when ready. No extra text before or after the block.

[SATISFIED]
Role: <user_role>
Task Details: <comprehensive description including all gathered details>

[PARTIAL]
Unanswered questions:
- <question that was not answered>
- <another unanswered question if applicable>

─── STYLE ───
- Be natural and conversational — this is a helpful dialogue, not a rigid form.
- Questions must be short and specific to what the user actually wrote.
- Never add extra text when outputting [SATISFIED] or [PARTIAL].
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
