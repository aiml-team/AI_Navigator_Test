import json

from schemas import OrchestratorState
from services.llm_client import HAS_AZURE, _azure_client, _azure_chat

CONFIDENCE_THRESHOLD = 60

_FINAL_DECIDER_PROMPT = """
You are the Final Decider Agent.

You will receive:
1. The user's original task (with role and context).
2. Candidate tools from the Internal Agent (each with a score and reason).
3. Candidate tools from the External Agent (each with a score and reason).

YOUR JOB:
- Merge all candidates into a single ranked list.
- Keep only tools whose score is {threshold} or above.
- If no tool reaches {threshold}, keep only the single highest-scoring tool.
- Sort strictly by score, highest first.
- Deduplicate: if the same tool appears from both agents, keep the higher-scoring entry.

CRITICAL — JUSTIFICATION QUALITY:
Each justification you write MUST:
1. Be written specifically for THIS user's task — not a generic description of the tool.
2. Explain exactly WHICH features or capabilities of the tool address the user's specific request.
3. Reference the user's role, their goal, and the type of output they need.
4. Be detailed enough (3-5 sentences) that the user immediately understands how this tool solves their problem.
5. Be written in second person ("you") so it feels direct and personal.

BAD justification (do NOT write like this):
  "This tool is excellent for writing tasks and supports various document formats."

GOOD justification (write like this):
  "As a Business Analyst drafting a regulatory compliance report for the banking sector, this tool's
  policy-aware document structuring lets you organise audit findings into structured sections with
  built-in citation tracking. Its template engine means you won't start from a blank page — you can
  load a compliance report template and fill in your specific findings. The version history feature
  will also let your reviewer track what changed between drafts, which is critical for audit trails."

OUTPUT FORMAT:
Return ONLY this JSON (no markdown, no preamble):
{{
  "results": [
    {{"tool": "<exact name>", "score": <int>, "reason": "<3-5 sentence task-specific justification>"}},
    ...
  ]
}}

Sorted by score descending. Include all tools with score ≥ {threshold}.
If none reach {threshold}, include only the top-scoring tool.
"""


def final_decider(state: OrchestratorState) -> OrchestratorState:
    internal_raw = state.get("internal_results") or "{}"
    external_raw = state.get("external_results") or "{}"

    url_map = {}
    try:
        url_map = json.loads(external_raw).get("url_map", {})
    except Exception:
        pass

    def _collect_candidates() -> list:
        seen = {}
        for raw in [internal_raw, external_raw]:
            try:
                data = json.loads(raw)
                for r in data.get("recommendations", []):
                    name  = r.get("tool", "").strip()
                    score = int(r.get("score", 0))
                    if not name:
                        continue
                    if name not in seen or score > seen[name]["score"]:
                        seen[name] = {"tool": name, "score": score, "reason": r.get("reason", "")}
            except Exception:
                pass
        candidates = list(seen.values())
        candidates.sort(key=lambda x: x["score"], reverse=True)
        return candidates

    def _apply_threshold(candidates: list) -> list:
        above = [c for c in candidates if c["score"] >= CONFIDENCE_THRESHOLD]
        if not above and candidates:
            above = [candidates[0]]
        return above

    def _build_state_from(ranked: list) -> dict:
        if not ranked:
            return {
                "recommended_tool": "", "tool_url": "", "tool_reason": "",
                "tool_confidence": "LOW", "tool_confidence_pct": 0,
                "tool_confidence_explanation": "",
                "tool_alternatives": [], "tool_alternative_reasons": [],
                "tool_alternative_confidence_pcts": [], "tool_alternative_urls": [],
            }
        top    = ranked[0]
        others = ranked[1:]
        score  = top["score"]
        conf   = "HIGH" if score >= 75 else "MEDIUM" if score >= 60 else "LOW"
        return {
            "recommended_tool":                 top["tool"],
            "tool_url":                         url_map.get(top["tool"], ""),
            "tool_reason":                      top["reason"],
            "tool_confidence":                  conf,
            "tool_confidence_pct":              score,
            "tool_confidence_explanation":      top["reason"],
            "tool_alternatives":                [o["tool"]   for o in others],
            "tool_alternative_reasons":         [o["reason"] for o in others],
            "tool_alternative_confidence_pcts": [o["score"]  for o in others],
            "tool_alternative_urls":            [url_map.get(o["tool"], "") for o in others],
        }

    candidates = _collect_candidates()

    if not HAS_AZURE or not _azure_client or not candidates:
        ranked = _apply_threshold(candidates)
        return _build_state_from(ranked)

    combined_input = (
        f"USER TASK: {state['user_input']}\n"
        f"USER ROLE: {state.get('role', 'general')}\n"
        f"INTENT: {state.get('intent', 'general')}\n\n"
        f"--- INTERNAL AGENT CANDIDATES ---\n{internal_raw}\n\n"
        f"--- EXTERNAL AGENT CANDIDATES ---\n{external_raw}"
    )

    prompt = _FINAL_DECIDER_PROMPT.replace("{threshold}", str(CONFIDENCE_THRESHOLD))

    try:
        raw, _ = _azure_chat(
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user",   "content": combined_input},
            ],
            max_tokens=2000,
            temperature=0.1,
        )
        raw = (raw or "").replace("```json", "").replace("```", "").strip()

        parsed = json.loads(raw)
        results = parsed.get("results", [])

        ranked = []
        for r in results:
            name  = r.get("tool", "").strip()
            score = int(r.get("score", 0))
            if name:
                ranked.append({"tool": name, "score": score, "reason": r.get("reason", "")})

        ranked = [r for r in ranked if r["score"] >= CONFIDENCE_THRESHOLD]
        if not ranked and results:
            best = max(results, key=lambda x: int(x.get("score", 0)))
            ranked = [{"tool": best.get("tool", ""), "score": int(best.get("score", 0)), "reason": best.get("reason", "")}]

        ranked.sort(key=lambda x: x["score"], reverse=True)

        if not ranked:
            fallback = _apply_threshold(candidates)
            return _build_state_from(fallback)

        return _build_state_from(ranked)

    except Exception:
        ranked = _apply_threshold(candidates)
        return _build_state_from(ranked)
