import json

from schemas import OrchestratorState
from services.llm_client import HAS_AZURE, _azure_client, _azure_chat

VALID_INTENTS = [
    "proposal", "report", "email", "code", "content",
    "data analysis", "legal", "it support", "hr", "general"
]

VALID_INDUSTRIES = [
    "banking", "healthcare", "retail", "technology", "manufacturing", "general"
]

_INTENT_KEYWORDS = {
    "proposal":      ["proposal", "pitch", "offer", "bid", "rfp", "quotation"],
    "report":        ["report", "summary", "analysis", "findings", "review"],
    "email":         ["email", "mail", "message", "reply", "respond"],
    "code":          ["code", "script", "function", "program", "debug", "fix", "build", "refactor", "test"],
    "content":       ["blog", "article", "post", "content", "write", "draft", "copy"],
    "data analysis": ["analyze", "data", "insights", "chart", "trend", "metric", "dashboard", "kpi"],
    "legal":         ["contract", "legal", "compliance", "agreement", "terms", "policy", "clause"],
    "it support":    ["ticket", "incident", "issue", "support", "itsm", "helpdesk", "outage"],
    "hr":            ["hr", "employee", "leave", "payroll", "onboarding", "performance"],
}

_INDUSTRY_KEYWORDS = {
    "banking":       ["bank", "financial", "finance", "loan", "credit", "investment", "treasury"],
    "healthcare":    ["health", "medical", "hospital", "patient", "clinical", "pharma"],
    "retail":        ["retail", "store", "customer", "ecommerce", "product", "inventory"],
    "technology":    ["tech", "software", "it", "digital", "api", "system", "cloud"],
    "manufacturing": ["manufacturing", "production", "supply chain", "procurement", "warehouse"],
}


def _keyword_fallback_classify(text: str, task_type: str = None):
    text_lower = text.lower()

    TASK_TYPE_TO_INTENT = {
        "research":      "report",
        "writing":       "content",
        "strategy":      "proposal",
        "data":          "data analysis",
        "code":          "code",
        "creative":      "content",
        "communication": "email",
        "learning":      "general",
        "automate":      "code",
        "decision":      "report",
    }
    detected_intent = TASK_TYPE_TO_INTENT.get(task_type, None)

    if not detected_intent:
        detected_intent = "general"
        for intent, keywords in _INTENT_KEYWORDS.items():
            if any(kw in text_lower for kw in keywords):
                detected_intent = intent
                break

    detected_industry = "general"
    for industry, keywords in _INDUSTRY_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            detected_industry = industry
            break

    return detected_intent, detected_industry


def classify_intent(state: OrchestratorState) -> OrchestratorState:
    role        = state.get("role", "general")
    task_type   = state.get("task_type", "general")
    sensitivity = state.get("data_sensitivity", "general")

    if HAS_AZURE and _azure_client:
        try:
            classifier_prompt = f"""You are an enterprise task classifier. Analyze the user's request and return ONLY a JSON object.

USER REQUEST: "{state['user_input']}"

USER CONTEXT (use this to sharpen your classification):
- Role: {role}  (e.g. a developer asking something is likely a 'code' intent; an executive asking something is likely a 'report' or 'proposal')
- Task Type selected by user: {task_type}  (treat this as a strong hint for intent)
- Data Sensitivity: {sensitivity}  (client = confidential work; internal = inside the org; general = public)

CLASSIFY into exactly one INTENT from this list:
- proposal     : creating proposals, pitches, bids, RFPs, client offers, deliverables, presentations for clients
- report       : reports, summaries, analysis documents, findings, executive reviews, status updates
- email        : writing emails, messages, replies, follow-ups, communications
- code         : programming, scripting, debugging, refactoring, testing, DevOps, APIs, automation
- content      : blog posts, articles, marketing copy, social media, product descriptions, creative writing
- data analysis: data insights, dashboards, KPIs, metrics, charts, business intelligence, trend analysis
- legal        : contracts, compliance, legal review, agreements, terms, regulatory, policy documents
- it support   : IT tickets, incidents, outages, helpdesk, ITSM, change requests, infrastructure issues
- hr           : HR tasks, employee management, payroll, onboarding, performance reviews, leave requests
- general      : anything that does not clearly fit the above categories

CLASSIFY into exactly one INDUSTRY from this list:
- banking      : banking, finance, fintech, insurance, investment, wealth management, treasury, capital markets
- healthcare   : healthcare, medical, hospital, pharma, clinical, biotech, patient care, health IT
- retail       : retail, e-commerce, consumer goods, supply chain, merchandise, stores, omnichannel
- technology   : software, tech, IT services, SaaS, cloud, cybersecurity, data engineering, platforms
- manufacturing: manufacturing, production, industrial, automotive, logistics, factory, operations
- general      : cannot determine industry or does not fit above categories

RULES:
- The user's Role and Task Type are strong signals — weight them heavily alongside the request text.
- Read the FULL meaning, not just keywords. "Goldman Sachs integration" = banking. "Patient portal" = healthcare.
- If user mentions company names, infer the industry (SAP = technology, NHS = healthcare, etc.)
- Return ONLY valid JSON. No explanation. No markdown.

JSON FORMAT:
{{
  "intent": "<one of the 10 intents above>",
  "industry": "<one of the 6 industries above>",
  "intent_confidence": "HIGH or MEDIUM or LOW",
  "industry_confidence": "HIGH or MEDIUM or LOW",
  "reasoning": "<one sentence explaining your classification>"
}}"""

            raw, _ = _azure_chat(
                messages=[
                    {"role": "system", "content": "You are a JSON-only enterprise task classifier. Output valid JSON only. No markdown, no preamble, no explanation outside the JSON."},
                    {"role": "user", "content": classifier_prompt}
                ],
                max_tokens=200,
                temperature=0.0,
            )
            raw    = raw.replace("```json", "").replace("```", "").strip()
            data   = json.loads(raw)
            intent   = data.get("intent", "general")
            industry = data.get("industry", "general")
            if intent not in VALID_INTENTS:
                intent = "general"
            if industry not in VALID_INDUSTRIES:
                industry = "general"
            return {**state, "intent": intent, "industry": industry}

        except Exception:
            intent, industry = _keyword_fallback_classify(state["user_input"], state.get("task_type"))
            return {**state, "intent": intent, "industry": industry}
    else:
        intent, industry = _keyword_fallback_classify(state["user_input"], state.get("task_type"))
        return {**state, "intent": intent, "industry": industry}
