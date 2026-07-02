"""
Scenario Summarizer Agent
─────────────────────────
Generates a concise, plain-English summary of a Scenario Library entry so
users can quickly understand what a scenario is about before clicking
"Edit & Generate".

The summary is intended for display directly on the Scenario Library tile
(2-3 line preview) and in the Scenario Summary modal opened via "...More".
Summaries are generated once (lazy on first click OR in bulk on app
startup) and persisted in the `scenarios.summary` column for instant
subsequent loads.
"""

import re

from services.llm_client import call_llm


_SYSTEM_PROMPT = (
    "You write short, plain-English summaries of business scenarios for SAP "
    "consultants and enterprise users.\n\n"
    "RULES — follow strictly:\n"
    "  • 2 to 4 sentences, total under 60 words.\n"
    "  • Clear, jargon-light language.\n"
    "  • Focus on the goal and the value it delivers.\n"
    "  • No bullet points, no headings, no markdown, no quotes.\n"
    "  • Do NOT restate the title or persona verbatim.\n"
    "  • Do NOT begin with phrases like 'The user aims to', 'The user wants', "
    "'This scenario describes', 'This scenario covers', 'In this scenario', "
    "'The scenario explains', 'The goal is', 'The objective is', 'This is about'. "
    "Start with the action or topic itself.\n\n"
    "GOOD: 'Streamlines vendor invoice processing by automatically matching "
    "purchase orders, flagging mismatches, and reducing manual review time.'\n"
    "BAD: 'The user aims to streamline vendor invoice processing...'\n"
    "BAD: 'This scenario describes how to streamline vendor invoice processing...'"
)


# Patterns we strip from the start of the LLM output as a safety net,
# in case it slips a preamble through despite the prompt instructions.
_PREAMBLE_PATTERNS = [
    r"^the\s+user\s+(?:aims|wants|needs|intends|tries|seeks|is\s+trying|is\s+aiming|would\s+like)\s+to\s+",
    r"^the\s+user\s+(?:will|can|may|should)\s+",
    r"^this\s+scenario\s+(?:describes|covers|explains|outlines|shows|focuses\s+on|is\s+about|deals\s+with|involves)\s+",
    r"^in\s+this\s+scenario[, ]\s*",
    r"^the\s+scenario\s+(?:describes|covers|explains|outlines|shows|focuses\s+on|is\s+about|deals\s+with|involves)\s+",
    r"^the\s+(?:goal|objective|purpose|aim|intent)\s+(?:is|of\s+this\s+scenario\s+is)\s+to\s+",
    r"^this\s+is\s+about\s+",
    r"^here[, ]\s*the\s+user\s+",
    r"^a\s+(?:consultant|user|manager|analyst|developer)\s+(?:aims|wants|needs|will|can|is\s+trying)\s+to\s+",
]


def _strip_preamble(text: str) -> str:
    """Remove common preamble phrases that the LLM occasionally produces."""
    t = (text or "").strip()
    if not t:
        return t

    # Strip surrounding quotes if the LLM wrapped its response.
    if (t.startswith('"') and t.endswith('"')) or (t.startswith("'") and t.endswith("'")):
        t = t[1:-1].strip()

    # Run up to 2 passes so we catch chained preambles like
    # "This scenario describes how the user aims to ...".
    for _ in range(2):
        original = t
        for pat in _PREAMBLE_PATTERNS:
            m = re.match(pat, t, flags=re.IGNORECASE)
            if m:
                t = t[m.end():].lstrip()
                # Re-capitalize the first letter of the remaining sentence.
                if t:
                    t = t[0].upper() + t[1:]
                break
        if t == original:
            break

    return t.strip()


def summarize_scenario(scenario_text: str, title: str = "", persona: str = "") -> str:
    """
    Generate a 2-4 sentence summary for the given scenario.

    Args:
        scenario_text: The full scenario / task body text.
        title:         Optional scenario title (used as context for the LLM).
        persona:       Optional persona / role (used as context for the LLM).

    Returns:
        Plain-text summary string. If the LLM is not configured, returns
        a graceful fallback (truncated scenario text + notice).
    """
    text = (scenario_text or "").strip()
    if not text:
        return ""

    title   = (title   or "").strip()
    persona = (persona or "").strip()

    context_parts = []
    if title:
        context_parts.append(f"Scenario title: {title}")
    if persona:
        context_parts.append(f"Target persona / role: {persona}")
    context_parts.append(f"Scenario body:\n{text}")

    user_prompt = (
        "Please write a concise 2-4 sentence summary of the following "
        "business scenario.\n\n" + "\n\n".join(context_parts)
    )

    try:
        summary = call_llm(
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            max_tokens=220,
            temperature=0.3,
        ) or ""
        summary = summary.strip()

        # If the LLM is in demo mode, fall back to a simple preview rather
        # than persisting the demo-mode boilerplate.
        if summary.startswith("[Demo Mode"):
            preview = text if len(text) <= 280 else text[:280].rstrip() + "…"
            return preview

        # Safety net — strip any leading preamble the LLM may have produced
        # despite the system prompt instructions.
        summary = _strip_preamble(summary)
        return summary
    except Exception:
        # On any failure, return a truncated preview so the UI still has
        # something useful to show. The caller will NOT persist this.
        preview = text if len(text) <= 280 else text[:280].rstrip() + "…"
        return preview
