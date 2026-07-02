from pydantic import BaseModel
from typing import Optional, List, TypedDict



# ── LangGraph State ───────────────────────────────────────────────────────────
class OrchestratorState(TypedDict):
    user_input: str
    role: str
    task_type: str
    data_sensitivity: str
    intent: str
    industry: str
    recommended_tool: str
    tool_reason: str
    tool_confidence: str
    tool_alternatives: List[str]
    tool_alternative_reasons: List[str]
    tool_alternative_confidence_pcts: List[int]
    tool_alternative_urls: List[str]
    tool_confidence_pct: int
    tool_confidence_explanation: str
    policy_flags: List[str]
    policies: List[str]
    policy_summary: str
    policy_blocked: bool
    internal_results: Optional[str]
    external_results: Optional[str]
    corlo_prompt: str
    prompt_version: str
    llm_output: str
    token_estimate: int
    error: Optional[str]
    skip_tool_recommendation: bool


# ── Request / Response Models ─────────────────────────────────────────────────
class RunRequest(BaseModel):
    user_input: str
    role: Optional[str] = "general"
    task_type: Optional[str] = "general"
    data_sensitivity: Optional[str] = "general"
    user_email: Optional[str] = ""
    skip_tool_recommendation: Optional[bool] = False
    # "scenario_library" when the task originated from the Scenario Library;
    # "typed" (default) when the user wrote it themselves. Used to render a
    # source badge in History + Feedback views.
    task_source: Optional[str] = "typed"
    # When task_source == "scenario_library", these carry the picked
    # scenario's id + title so the View modal can display the scenario name
    # alongside the "Provide Feedback on this Response" button. Empty for
    # typed runs. Backend stores them verbatim on audit_log.
    scenario_id: Optional[str] = ""
    scenario_title: Optional[str] = ""


class FeedbackRequest(BaseModel):
    audit_id:   Optional[str] = ""
    email:      Optional[str] = ""
    rating:     int
    comment:    Optional[str] = ""
    issue_type: Optional[str] = ""
    source:     Optional[str] = "form"


class PromptVersionRequest(BaseModel):
    intent:      Optional[str] = "general"
    industry:    Optional[str] = "general"
    template:    str
    change_note: Optional[str] = ""


class RefinementRequest(BaseModel):
    audit_id:         str
    user_input:       str           # the original question the user asked
    corlo_prompt:     str           # the full CORLO prompt used to generate the response
    llm_output:       str           # the previous AI response being revised
    comment:          str           # what the user wants changed / added / focused on
    role:             Optional[str] = "general"
    task_type:        Optional[str] = "general"
    data_sensitivity: Optional[str] = "general"
    intent:           Optional[str] = "general"
    industry:         Optional[str] = "general"
    recommended_tool: Optional[str] = ""


class AuditUpdateRequest(BaseModel):
    raw_input:   Optional[str] = None
    final_prompt: Optional[str] = None
    output:      Optional[str] = None


class ClarifyRequest(BaseModel):
    user_input:  str
    role:        Optional[str] = "general"
    task_type:   Optional[str] = "general"


class ClarifyAnswerRequest(BaseModel):
    user_input:       str
    role:             Optional[str] = "general"
    task_type:        Optional[str] = "general"
    questions:        List[str]
    answers:          List[str]


class ChatGatherMessage(BaseModel):
    role:    str
    content: str


class ChatGatherRequest(BaseModel):
    messages:         List[ChatGatherMessage]
    user_input:       Optional[str] = ""
    role:             Optional[str] = "general"
    task_type:        Optional[str] = "general"
    default_role:     Optional[str] = ""


class ChatSummarizeRequest(BaseModel):
    messages:         List[ChatGatherMessage]
    user_input:       Optional[str] = ""
    role:             Optional[str] = "general"
    task_type:        Optional[str] = "general"
    default_role:     Optional[str] = ""


class RegisterToolRequest(BaseModel):
    tool_name:       str
    description:     Optional[str] = ""
    category:        Optional[str] = ""
    url:             Optional[str] = ""
    icon:            Optional[str] = "🤖"
    best_for:        Optional[List[str]] = []
    strong_signals:  Optional[List[str]] = []
    weak_signals:    Optional[List[str]] = []
    not_for:         Optional[List[str]] = []
    roles:           Optional[List[str]] = []
    output_type:     Optional[str] = ""
    is_internal:     Optional[bool] = False
    explicit_edit:   Optional[bool] = False
    raw_data:        Optional[dict] = {}


class RegisterScenarioRequest(BaseModel):
    title:          str
    mega_group:     str
    category:       Optional[str] = ""
    persona:        Optional[str] = ""
    activate_phase: Optional[str] = ""
    scenario:       str