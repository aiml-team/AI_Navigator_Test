import json

from schemas import OrchestratorState
from services.llm_client import HAS_AZURE, _azure_client, _azure_chat
from services.registry import AI_TOOLS_REGISTRY, _get_enriched_summary
from services.chromadb_store import query_tool_knowledge

CONFIDENCE_THRESHOLD = 60


def _role_matches(user_role: str, tool_roles: list) -> bool:
    if not tool_roles:
        return True
    u = user_role.lower()
    return any(u in r.lower() or r.lower() in u for r in tool_roles)


def _filter_eligible_tools(user_input: str, intent: str) -> set:
    text = (user_input + " " + intent).lower()
    eligible: set = set()

    for name, info in AI_TOOLS_REGISTRY.items():
        kw_list = info.get("output_type_keywords", [])
        if not kw_list:
            eligible.add(name)
            continue
        for kw in kw_list:
            if kw.lower() in text:
                eligible.add(name)
                break

    if not eligible:
        return set(AI_TOOLS_REGISTRY.keys())

    return eligible


def _score_tools_from_registry(user_input: str, intent: str, role: str) -> str:
    if not AI_TOOLS_REGISTRY:
        return ""

    eligible     = _filter_eligible_tools(user_input, intent)
    text_lower   = user_input.lower()
    intent_lower = intent.lower()
    scores       = {}

    for name, info in AI_TOOLS_REGISTRY.items():
        if name not in eligible:
            continue
        score = 0

        if _role_matches(role, info.get("roles", [])):
            score += 3

        for kw in info.get("strong_signals", []):
            if kw.lower() in text_lower:
                score += 3

        for kw in info.get("best_for", []):
            if kw.lower() in text_lower:
                score += 2

        enriched  = _get_enriched_summary(name).lower()
        searchable = (
            info.get("category", "") + " " +
            info.get("description", "") + " " +
            enriched
        ).lower()
        if intent_lower in searchable:
            score += 1

        for nf in info.get("not_for", []):
            kw = nf.lower()
            if kw and (kw in text_lower or kw in intent_lower):
                score -= 99

        scores[name] = score

    best_name  = max(scores, key=scores.get)
    best_score = scores[best_name]

    if best_score <= 0:
        role_matched = [
            n for n, info in AI_TOOLS_REGISTRY.items()
            if _role_matches(role, info.get("roles", []))
        ]
        if role_matched:
            return role_matched[0]
        return next(iter(AI_TOOLS_REGISTRY))

    return best_name


def _build_internal_agent_prompt(relevant_tools_json: str, user_input: str, user_role: str, intent: str) -> str:
    return f"""
You are the Internal Tool Recommender Agent.

USER TASK: {user_input}
USER ROLE: {user_role}
TASK INTENT: {intent}

Your job is to evaluate every tool in the INTERNAL TOOL CATALOG below and score each one for how well it fits this specific task.

-------------------------
STEP 1 — UNDERSTAND THE TASK DEEPLY:
- What is the user actually trying to produce or achieve?
- What specific actions, workflows, or outputs does their task require?
- What role-specific needs apply (e.g., a developer needs code output, an analyst needs data insights)?
- What parameters or constraints did they mention?

STEP 2 — EVALUATE EACH TOOL:
For every tool in the catalog, ask:
- Does this tool directly support what the user is trying to do?
- Does it produce the right type of output for this task?
- Does it fit the user's role and context?
- Score it 0–100 based on true relevance to THIS task specifically.

STEP 3 — RETURN ALL TOOLS WITH SCORE ≥ {CONFIDENCE_THRESHOLD}:
- Include every tool that scores {CONFIDENCE_THRESHOLD} or above.
- Do NOT artificially cap at 3. If 5 tools score above {CONFIDENCE_THRESHOLD}, return all 5.
- If fewer than 1 tool scores above {CONFIDENCE_THRESHOLD}, return the single highest-scoring tool regardless.
- Sort results from highest score to lowest.

JUSTIFICATION RULES (critical):
- Each justification MUST explain specifically how this tool helps complete THIS user's task.
- Reference the user's actual task details — their role, their goal, their specific request.
- Do NOT write generic descriptions of what the tool does in general.
- BAD example: "This tool is great for writing and content creation tasks."
- GOOD example: "As a Business Analyst drafting a regulatory compliance report for the banking sector, this tool's structured document generation and policy-aware formatting will let you produce audit-ready sections with citation support, directly cutting the manual formatting time on your compliance deliverable."
- The justification should be 2-4 sentences, specific enough that the user understands exactly how this tool solves their problem.

-------------------------
INTERNAL TOOL CATALOG:
{relevant_tools_json}

Return ONLY this JSON (no markdown, no extra text):
{{
  "recommendations": [
    {{"tool": "<exact tool name>", "score": <0-100>, "reason": "<task-specific justification, 2-4 sentences>"}},
    ...
  ]
}}
"""


def internal_agent(state: OrchestratorState) -> OrchestratorState:
    user_input = state["user_input"]
    user_role  = state.get("role", "general").strip()
    intent     = state.get("intent", "general").strip()

    internal_tools = {
        name: info for name, info in AI_TOOLS_REGISTRY.items()
        if info.get("is_internal", False)
    }

    if not internal_tools:
        return {**state, "internal_results": json.dumps({"recommendations": []})}

    eligible = _filter_eligible_tools(user_input, intent)
    eligible_internal = {
        name: info for name, info in internal_tools.items()
        if name in eligible and _role_matches(user_role, info.get("roles", []))
    } or internal_tools

    tool_names = list(eligible_internal.keys())

    knowledge = {}
    try:
        knowledge = query_tool_knowledge(user_input, tool_names, n_results=5)
    except Exception:
        pass

    catalog_entries = []
    for name, info in eligible_internal.items():
        entry = {
            "tool_name":   name,
            "description": info.get("description", ""),
            "category":    info.get("category", ""),
            "best_for":    info.get("best_for", []),
            "strong_signals": info.get("strong_signals", []),
            "not_for":     info.get("not_for", []),
            "knowledge_excerpts": knowledge.get(name, [])[:2],
        }
        catalog_entries.append(entry)

    relevant_tools_json = json.dumps(catalog_entries, indent=2)
    system_prompt = _build_internal_agent_prompt(relevant_tools_json, user_input, user_role, intent)

    if HAS_AZURE and _azure_client:
        try:
            raw, _ = _azure_chat(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": (
                        f"Evaluate and score all tools from the catalog for this task.\n"
                        f"Task: {user_input}\nRole: {user_role}\nIntent: {intent}\n\n"
                        f"Return all tools scoring {CONFIDENCE_THRESHOLD} or above, sorted descending by score."
                    )},
                ],
                max_tokens=1200,
                temperature=0.1,
            )
            raw = (raw or "").replace("```json", "").replace("```", "").strip()
            parsed = json.loads(raw)
            recs = parsed.get("recommendations", [])
            above = [r for r in recs if int(r.get("score", 0)) >= CONFIDENCE_THRESHOLD]
            if not above and recs:
                above = [max(recs, key=lambda r: int(r.get("score", 0)))]
            above.sort(key=lambda r: int(r.get("score", 0)), reverse=True)
            return {"internal_results": json.dumps({"recommendations": above})}
        except Exception as e:
            fallback = _score_tools_from_registry(user_input, intent, user_role)
            return {"internal_results": json.dumps({
                "recommendations": [
                    {"tool": fallback, "score": 70, "reason": f"Selected via registry scoring (LLM error: {str(e)[:60]})."}
                ]
            })}

    fallback = _score_tools_from_registry(user_input, intent, user_role)
    return {"internal_results": json.dumps({
        "recommendations": [
            {"tool": fallback, "score": 60, "reason": "Selected via keyword registry scoring (no LLM configured)."}
        ]
    })}
