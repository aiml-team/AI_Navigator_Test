from schemas import OrchestratorState
from services.llm_client import HAS_AZURE, _azure_client, _azure_chat
from services.chromadb_store import policy_collection

_POLICY_CHECKER_SYSTEM_PROMPT = """
You are a strict Enterprise Policy Compliance Agent.

Your job is to carefully review the user's task against the provided POLICY GUIDELINES and determine whether the task contains or relates to any prohibited topics, restricted words, or guideline violations.

-------------------------
INSTRUCTIONS:

1. Read the user's task carefully.
2. Read every POLICY GUIDELINE provided below.
3. Determine if the task touches upon, implies, or relates to ANY prohibited topic or restricted content.
4. Output ONLY one of the following two exact formats — no extra text:

If a violation IS found:
[POLICY_VIOLATED]
Reason: <short explanation of exactly which policy guideline is violated and why>

If NO violation is found:
[POLICY_CLEAR]

-------------------------
CRITICAL RULES:
- Be strict and thorough — err on the side of caution.
- Even indirect or implied references to prohibited topics count as violations.
- Do not add any commentary, explanation, or text outside the two formats above.
- Do not suggest alternatives or ask questions.
"""

_POLICY_TOP_K = 5


def retrieve_policies(state: OrchestratorState) -> OrchestratorState:
    query = f"{state['intent']} {state['industry']} {state['user_input']}"
    try:
        count = policy_collection.count()
        if count == 0:
            return {**state, "policies": []}
        effective_k = min(_POLICY_TOP_K, count)
        results  = policy_collection.query(query_texts=[query], n_results=effective_k)
        docs     = results.get("documents", [[]])[0]
        policies = docs if docs else []
    except Exception:
        policies = []
    return {**state, "policies": policies}


def check_policy_compliance(state: OrchestratorState) -> OrchestratorState:
    policies       = state.get("policies", [])
    user_input     = state["user_input"]
    existing_flags = state.get("policy_flags", [])

    if not policies:
        return {
            **state,
            "policy_summary": (
                "No company policy documents have been uploaded yet. "
                "General enterprise best practices apply."
            ),
            "policy_blocked": False,
            "policy_flags":   existing_flags,
        }

    policy_context = "\n".join(f"- {p}" for p in policies)

    user_msg = (
        f"USER TASK:\n{user_input}\n\n"
        f"POLICY GUIDELINES (most relevant to this task):\n{policy_context}"
    )

    if HAS_AZURE and _azure_client:
        try:
            raw, _ = _azure_chat(
                messages=[
                    {"role": "system", "content": _POLICY_CHECKER_SYSTEM_PROMPT},
                    {"role": "user",   "content": user_msg},
                ],
                max_tokens=300,
                temperature=0.0,
            )
            raw = (raw or "").strip()

            if "[POLICY_VIOLATED]" in raw:
                reason = (
                    raw.replace("[POLICY_VIOLATED]", "")
                       .replace("Reason:", "")
                       .strip()
                )
                return {
                    **state,
                    "policy_summary": reason,
                    "policy_blocked": True,
                    "policy_flags":   list(set(existing_flags + [f"Policy violation: {reason[:120]}"])),
                }

            return {
                **state,
                "policy_summary": "Task reviewed — no policy violations found.",
                "policy_blocked": False,
                "policy_flags":   existing_flags,
            }

        except Exception:
            pass

    return {
        **state,
        "policy_summary": (
            "Policy check could not be completed (LLM unavailable). "
            "Proceeding with general enterprise best practices."
        ),
        "policy_blocked": False,
        "policy_flags":   existing_flags,
    }
