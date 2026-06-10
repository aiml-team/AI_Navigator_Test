from langgraph.graph import StateGraph, END

from schemas import OrchestratorState
from services.llm_client import HAS_AZURE, _azure_client, _azure_chat
from services.registry import AI_TOOLS_REGISTRY
from services.intent_classifier import classify_intent
from services.agents.policy_checker import retrieve_policies, check_policy_compliance
from services.agents.internal_agent import internal_agent
from services.agents.external_agent import external_agent
from services.agents.final_decider import final_decider
from services.prompt_builder import build_corlo_prompt


def execute_llm(state: OrchestratorState) -> OrchestratorState:
    if HAS_AZURE and _azure_client:
        try:
            output, tokens = _azure_chat(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a helpful enterprise AI assistant. "
                            "Follow the user's instructions precisely and produce a high-quality, "
                            "professional response. Return only the final output — no meta-commentary."
                        ),
                    },
                    {"role": "user", "content": state["corlo_prompt"]},
                ],
                max_tokens=1500,
                temperature=0.4,
            )
            if not tokens:
                tokens = len(state["corlo_prompt"].split())
        except Exception as e:
            output = _mock_response(state, error=str(e))
            tokens = len(state["corlo_prompt"].split())
    else:
        output = _mock_response(state)
        tokens = len(state["corlo_prompt"].split())

    return {**state, "llm_output": output, "token_estimate": tokens}


def _mock_response(state: OrchestratorState, error: str = "") -> str:
    err       = f"\n⚠️ Error: {error}" if error else ""
    tool_info = AI_TOOLS_REGISTRY.get(state["recommended_tool"], {})
    role        = state.get("role", "general")
    task_type   = state.get("task_type", "general")
    sensitivity = state.get("data_sensitivity", "general")
    return f"""## Executive Summary
Demo response for **{state['intent']}** in **{state['industry']}**.
Recommended tool: **{state['recommended_tool']}** ({tool_info.get('category', '')}).
Set AZURE_OPENAI_* environment variables for live output.{err}

## Main Content
Request: "{state['user_input']}"
- Intent: {state['intent'].title()} | Industry: {state['industry'].title()}
- Role: {role.title()} | Task Type: {task_type.title()} | Sensitivity: {sensitivity.title()}
- Tool: {state['recommended_tool']} | Confidence: {state['tool_confidence']}
- Policies applied: {len(state['policies'])}

### Why {state['recommended_tool']}?
{state['tool_reason']}

## Key Recommendations
1. Open {state['recommended_tool']} using the link provided
2. Use the generated CORLO prompt above as your input
3. Review compliance notes before using the output
4. Archive output in your document management system

## Compliance Notes
{'⚠️ Flags: ' + ' | '.join(state['policy_flags']) if state['policy_flags'] else '✅ No policy violations'}
✅ All retrieved policies applied to this prompt
*[Demo Mode — configure AZURE_OPENAI_* env vars to enable live responses]*"""


def _skip_if_blocked(state: OrchestratorState) -> str:
    if state.get("policy_blocked", False):
        return "blocked"
    return "allowed"


def _noop_blocked(state: OrchestratorState) -> OrchestratorState:
    return {
        **state,
        "corlo_prompt": "",
        "llm_output":   "",
        "token_estimate": 0,
    }


def run_agents_and_decide(state: OrchestratorState) -> OrchestratorState:
    internal_update  = internal_agent(state)
    state_after_int  = {**state, **internal_update}

    external_update  = external_agent(state_after_int)
    state_after_ext  = {**state_after_int, **external_update}

    final_update     = final_decider(state_after_ext)
    return {**state_after_ext, **final_update}


graph = StateGraph(OrchestratorState)
graph.add_node("classify_intent",         classify_intent)
graph.add_node("retrieve_policies",       retrieve_policies)
graph.add_node("check_policy_compliance", check_policy_compliance)
graph.add_node("blocked_end",             _noop_blocked)
graph.add_node("run_agents_and_decide",   run_agents_and_decide)
graph.add_node("build_corlo_prompt",      build_corlo_prompt)
graph.add_node("execute_llm",             execute_llm)

graph.set_entry_point("classify_intent")
graph.add_edge("classify_intent",   "retrieve_policies")
graph.add_edge("retrieve_policies", "check_policy_compliance")

graph.add_conditional_edges(
    "check_policy_compliance",
    _skip_if_blocked,
    {"blocked": "blocked_end", "allowed": "run_agents_and_decide"},
)

graph.add_edge("blocked_end",           END)
graph.add_edge("run_agents_and_decide", "build_corlo_prompt")
graph.add_edge("build_corlo_prompt",    "execute_llm")
graph.add_edge("execute_llm",           END)

orchestrator = graph.compile()
