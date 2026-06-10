import json
import os

from schemas import OrchestratorState
from services.llm_client import HAS_AZURE, _azure_client, _azure_chat
from services.registry import AI_TOOLS_REGISTRY

CONFIDENCE_THRESHOLD = 60


def _build_external_agent_prompt(tool_names: list, user_input: str, user_role: str) -> str:
    if not tool_names:
        numbered = "(no external tools configured)"
    else:
        numbered = "\n".join(f"{i+1}. {name}" for i, name in enumerate(tool_names))

    return f"""
You are the External Tool Recommendation Agent.

USER TASK: {user_input}
USER ROLE: {user_role}

Your job is to evaluate EVERY tool in the list below and score each one based on how well it fits this specific task.

-------------------------
AVAILABLE TOOLS (evaluate all of them):
{numbered}

Do NOT recommend any tool outside this list.

-------------------------
EVALUATION PROCESS:

1. UNDERSTAND THE TASK DEEPLY:
   - What is the user actually trying to produce or accomplish?
   - What type of output does their task require (document, code, analysis, communication, etc.)?
   - What is their role and how does that shape what they need from a tool?
   - What domain or industry context applies?

2. SCORE EVERY TOOL (0–100):
   - Use your knowledge of each tool's real capabilities and use cases.
   - Score reflects how directly and effectively this tool addresses THIS specific task.
   - A tool that can do the task well = high score. A tool that is tangentially relevant = low score.
   - Be honest — not every tool will be relevant.

3. RETURN ALL TOOLS SCORING {CONFIDENCE_THRESHOLD} OR ABOVE:
   - Do NOT cap at 3. If 6 tools score above {CONFIDENCE_THRESHOLD}, return all 6.
   - If no tool reaches {CONFIDENCE_THRESHOLD}, return the single highest-scoring tool.
   - Sort from highest score to lowest.

JUSTIFICATION RULES (critical):
- Each justification MUST explain specifically how this tool helps complete THIS user's task.
- Reference the user's actual task details — their role, their goal, the specific deliverable.
- Do NOT write generic descriptions of what the tool does in general.
- BAD: "ChatGPT is a powerful AI assistant for many tasks."
- GOOD: "As a {user_role} needing to {user_input[:80]}..., ChatGPT's ability to draft structured content with custom tone and format means you can iterate the deliverable directly in the chat, using follow-up prompts to refine sections without switching tools."
- Justification should be 2-4 sentences, concrete, and specific to what the user described.

OUTPUT FORMAT (strict JSON — no markdown, no extra text):
{{
  "user_role": "<identified role>",
  "task_summary": "<one sentence summary of what the user wants to achieve>",
  "recommendations": [
    {{"tool": "<exact tool name>", "score": <number>, "reason": "<task-specific justification, 2-4 sentences>"}},
    ...
  ]
}}

RULES:
- Only output valid JSON
- Only tools from the provided list
- Include all tools with score ≥ {CONFIDENCE_THRESHOLD}, sorted descending
"""


def _load_external_tools_json() -> list:
    json_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "external_tools.json")
    try:
        with open(json_path, "r") as f:
            data = json.load(f)
        tools = data.get("tools", [])
        if tools:
            normalised = []
            for t in tools:
                if isinstance(t, dict):
                    normalised.append({"name": t.get("name", ""), "url": t.get("url", "")})
                else:
                    normalised.append({"name": str(t), "url": ""})
            return [t for t in normalised if t["name"]]
    except Exception:
        pass
    return [
        {"name": name, "url": info.get("url", "")}
        for name, info in AI_TOOLS_REGISTRY.items()
        if not info.get("is_internal", False)
    ]


def external_agent(state: OrchestratorState) -> OrchestratorState:
    user_input  = state["user_input"]
    user_role   = state.get("role", "general").strip()

    tools       = _load_external_tools_json()
    url_map     = {t["name"]: t["url"] for t in tools}
    names_only  = [t["name"] for t in tools]

    if not names_only:
        return {"external_results": json.dumps({"recommendations": [], "url_map": {}})}

    system_prompt = _build_external_agent_prompt(names_only, user_input, user_role)

    def _inject_urls(raw_json: str) -> str:
        try:
            data = json.loads(raw_json)
            for rec in data.get("recommendations", []):
                rec["url"] = url_map.get(rec.get("tool", ""), "")
            data["url_map"] = url_map
            return json.dumps(data)
        except Exception:
            return raw_json

    def _apply_threshold(parsed: dict) -> dict:
        recs = parsed.get("recommendations", [])
        above = [r for r in recs if int(r.get("score", 0)) >= CONFIDENCE_THRESHOLD]
        if not above and recs:
            above = [max(recs, key=lambda r: int(r.get("score", 0)))]
        above.sort(key=lambda r: int(r.get("score", 0)), reverse=True)
        parsed["recommendations"] = above
        return parsed

    if HAS_AZURE and _azure_client:
        try:
            raw, _ = _azure_chat(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": (
                        f"Evaluate all tools for this task and return all scoring {CONFIDENCE_THRESHOLD}+.\n"
                        f"Task: {user_input}\nRole: {user_role}"
                    )},
                ],
                max_tokens=1500,
                temperature=0.1,
            )
            raw = (raw or "").replace("```json", "").replace("```", "").strip()
            parsed = json.loads(raw)
            parsed = _apply_threshold(parsed)
            return {"external_results": _inject_urls(json.dumps(parsed))}
        except Exception as e:
            first = names_only[0] if names_only else "ChatGPT"
            return {"external_results": _inject_urls(json.dumps({
                "recommendations": [
                    {"tool": first, "score": 65,
                     "reason": f"Selected as best available external tool (LLM error: {str(e)[:60]})."}
                ]
            }))}

    first = names_only[0] if names_only else "ChatGPT"
    return {"external_results": _inject_urls(json.dumps({
        "recommendations": [
            {"tool": first, "score": 55, "reason": "Selected via registry (no LLM configured)."}
        ]
    }))}
