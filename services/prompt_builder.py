from schemas import OrchestratorState
from services.llm_client import HAS_AZURE, _azure_client, _azure_chat
from services.registry import AI_TOOLS_REGISTRY
from services.database import get_db


def _build_system_prompt(role: str, task_type: str, sensitivity: str,
                          industry: str, intent: str, tool_name: str = "",
                          tool_info: dict = None) -> str:
    if tool_info is None:
        tool_info = {}
    effective_role = role.strip() if role and role != "general" else "expert enterprise professional"

    role_behaviour = {
        "Executive / Director": (
            "Present insights at a strategic level. Be concise and outcome-focused. "
            "Lead with key decisions, business impact, and ROI. Avoid deep technical detail. "
            "Use executive-friendly language: bullet summaries, clear headers, no jargon."
        ),
        "Business Analyst": (
            "Provide structured, data-backed analysis. Use tables, bullet points, and numbered lists. "
            "Highlight assumptions, gaps, and recommendations clearly. "
            "Balance business context with analytical rigour."
        ),
        "Developer / Technical": (
            "Be technically precise and detailed. Include code snippets, commands, configurations, "
            "or architecture diagrams where relevant. Assume strong technical literacy. "
            "Use correct technical terminology. Format code in proper blocks."
        ),
        "Consultant / Manager": (
            "Balance technical accuracy with business clarity. Highlight risks, timelines, "
            "dependencies, and stakeholder considerations. Structure output for client-ready delivery. "
            "Use professional consulting language."
        ),
        "Finance / Accounting": (
            "Prioritise numerical accuracy and compliance. Use structured tabular formats where possible. "
            "Flag any figures that require validation. Align with accounting standards. "
            "Avoid ambiguous language around financial figures."
        ),
        "HR / People Ops": (
            "Use empathetic, people-first language. Ensure tone is inclusive and policy-compliant. "
            "Avoid jargon. Structure content to be accessible to all employee levels. "
            "Highlight any legal or HR compliance considerations."
        ),
        "Sales / BD": (
            "Emphasise value propositions, client benefits, and competitive differentiators. "
            "Keep tone persuasive, confident, and professional. "
            "Focus on outcomes, ROI, and solving client pain points. "
            "Structure for use in client-facing communications."
        ),
        "Marketing / Comms": (
            "Prioritise clarity, brand voice, and audience engagement. "
            "Structure content for readability and impact. "
            "Use compelling language appropriate for the target audience. "
            "Adapt tone based on channel (internal vs. external, formal vs. casual)."
        ),
    }.get(effective_role,
          "Provide a clear, professional, well-structured response appropriate for the user's context.")

    sensitivity_rules = {
        "client": (
            "⚠️ CONFIDENTIAL / CLIENT DATA RULES:\n"
            "- Replace all real names with [CLIENT NAME], [CONTACT NAME]\n"
            "- Replace specific figures with [VALUE] or [AMOUNT]\n"
            "- Do NOT reproduce any PII, account numbers, or contract specifics\n"
            "- Flag any section that requires human review before sharing externally"
        ),
        "internal": (
            "🔒 INTERNAL DATA RULES:\n"
            "- Use general terms for sensitive internal metrics\n"
            "- Do not disclose specific internal figures that could be sensitive if leaked\n"
            "- Mark any section intended for internal use only"
        ),
        "general": (
            "✅ GENERAL DATA: Standard professional best practices apply. "
            "No special masking required."
        ),
    }.get(sensitivity, "Standard data handling applies.")

    return f"""You are a {effective_role} operating in the {industry} industry.

BEHAVIOURAL INSTRUCTIONS FOR THIS ROLE:
{role_behaviour}

DATA HANDLING RULES:
{sensitivity_rules}

GENERAL RULES:
- Return ONLY the final response — no meta-commentary, no preamble, no "here is your response"
- Always define clear sections with headers
- Always include a Compliance / Risk note at the end
- Tailor depth and tone exactly to the role described above
- Flag any area that requires human expert review"""


def _build_user_prompt(state: OrchestratorState, tool_info: dict, policy_block: str,
                        prompt_version: str) -> str:
    role        = state.get("role",      "general").strip()
    task_type   = state.get("task_type", "general").strip()
    industry    = state["industry"]
    intent      = state["intent"]
    tool_name   = state["recommended_tool"]
    user_input  = state["user_input"]
    effective_role = role if role and role != "general" else "Enterprise Professional"

    has_policies = bool(
        policy_block and policy_block.strip()
        and "No specific policies" not in policy_block
        and "Policy retrieval unavailable" not in policy_block
    )
    policy_section = (
        f"The following company policies apply. Do not produce output that conflicts "
        f"with them:\n\n{policy_block}"
        if has_policies
        else f"No specific company policies were retrieved. Apply {industry} industry best practices."
    )

    if intent == "code" or task_type == "code":
        return f"""You are a senior {effective_role} and software engineer working in the {industry} industry.
You write clean, production-ready code with proper error handling and comments.

**TASK**
{user_input}

**TECHNICAL REQUIREMENTS**
- Language/framework: infer from the request, or ask if ambiguous
- Code quality: production-grade — no pseudocode, no placeholders
- Include: working implementation + inline comments explaining key decisions
- Include: usage example showing how to call/run the code
- Include: any dependencies, prerequisites, or setup steps needed
- Consider: edge cases, error handling, and security implications

**CONSTRAINTS**
{policy_section}

**OUTPUT STRUCTURE**
1. Brief explanation of your approach (2-3 sentences)
2. Complete, runnable code in properly labelled code blocks
3. Usage example
4. Notes on edge cases, limitations, or things the developer should watch out for
5. Any follow-up steps (e.g. tests to write, configs to set)

Write the response now."""

    if intent == "email" or task_type == "communication":
        return f"""You are a {effective_role} in the {industry} industry drafting a professional communication.
Your output must be ready to copy and send — no placeholders, no rewrites needed.

**TASK**
{user_input}

**COMMUNICATION REQUIREMENTS**
- Tone: professional, appropriate for the relationship and context implied in the request
- Length: as long as the message needs to be — not a word more
- Subject line: include one (infer from context)
- Opening: gets to the point quickly — no filler openers
- Body: clear, well-structured, purpose-driven
- Closing: appropriate call to action or next step

**CONSTRAINTS**
{policy_section}

**OUTPUT**
Provide:
- Subject: [subject line]
- [The complete email/message body, ready to send]
- Optional: one-line note on tone choices if the context is nuanced

Write the communication now."""

    if intent == "data analysis" or task_type == "data":
        return f"""You are a {effective_role} and data analyst working in the {industry} industry.
Your job is to turn data and observations into clear, actionable intelligence.

**ANALYTICAL TASK**
{user_input}

**ANALYSIS REQUIREMENTS**
- Lead with the most important insight — what does this data actually mean?
- Identify patterns, trends, anomalies, and their likely causes
- Quantify where possible; flag where data is missing or assumptions are made
- Separate facts (what the data shows) from interpretation (what it might mean)
- Recommend concrete next steps based on the findings

**CONSTRAINTS**
{policy_section}

**OUTPUT STRUCTURE**
1. **Key Finding** — the single most important insight (1-2 sentences)
2. **Analysis** — detailed breakdown with supporting points
3. **Data Gaps / Assumptions** — what's missing, what was assumed
4. **Visualisation Suggestions** — chart types or views that would communicate this well
5. **Recommendations** — 3-5 specific, actionable next steps
6. **Risks / Caveats** — where the analysis could be wrong or misleading

Produce the analysis now."""

    if intent == "report" or task_type in ("research", "decision"):
        depth_instruction = {
            "research": "Be thorough and evidence-based. Surface insights beyond the obvious.",
            "decision": "Frame as a decision document: options → evaluation → recommendation.",
        }.get(task_type, "Produce a professional report with clear structure and actionable findings.")

        return f"""You are a {effective_role} producing a formal report for the {industry} sector.
{depth_instruction}

**REPORT BRIEF**
{user_input}

**REPORT REQUIREMENTS**
- Audience: {effective_role} and their stakeholders
- Depth: sufficient to inform a decision or communicate findings — not academic
- Structure: clear numbered sections with informative headers
- Evidence: support claims with reasoning; flag where expert validation is needed
- Recommendations: specific and actionable, not generic
- Length: as long as the brief requires — no padding, no omissions

**CONSTRAINTS**
{policy_section}

**OUTPUT STRUCTURE**
1. **Executive Summary** — key findings and recommendation in under 150 words
2. **Background / Context** — why this matters
3. **Main Findings** — the substance of the report
4. **Analysis** — what the findings mean
5. **Recommendations** — numbered, specific, owner-assignable
6. **Risks & Mitigations** — what could go wrong
7. **Next Steps** — immediate actions with suggested owners/timelines
8. **Compliance Note** — any areas requiring specialist review

Produce the report now."""

    if intent == "proposal" or task_type == "strategy":
        return f"""You are a {effective_role} creating a high-impact proposal for the {industry} industry.
Your output must be persuasive, professional, and immediately presentable.

**PROPOSAL BRIEF**
{user_input}

**PROPOSAL REQUIREMENTS**
- Open with a compelling problem statement — make the reader feel the pain
- Articulate the proposed solution clearly and specifically
- Show the value: quantify benefits where possible (time saved, cost reduced, risk mitigated)
- Address likely objections or concerns pre-emptively
- Close with a clear, confident ask or call to action
- Tone: authoritative, client-ready, outcome-focused

**CONSTRAINTS**
{policy_section}

**OUTPUT STRUCTURE**
1. **Executive Summary** — the proposal in 3-4 sentences
2. **Problem Statement** — the challenge being solved
3. **Proposed Solution** — what you're offering and how it works
4. **Value & Benefits** — concrete outcomes and ROI
5. **Approach / Methodology** — how you'll deliver it
6. **Timeline & Milestones** — key phases and dates
7. **Investment / Ask** — what's required (resource, budget, decision)
8. **Why Us / Why Now** — differentiation and urgency
9. **Next Steps** — clear call to action

Produce the proposal now."""

    if intent == "content" or task_type in ("creative", "writing"):
        audience_hint = f"for a {industry} industry audience" if industry != "general" else "for a professional audience"
        return f"""You are a {effective_role} and content specialist creating original content {audience_hint}.
Your writing is clear, engaging, and purposeful — it earns the reader's attention from the first line.

**CONTENT BRIEF**
{user_input}

**CONTENT REQUIREMENTS**
- Hook: open with something that makes the reader want to continue
- Voice: professional yet human — authoritative without being stiff
- Structure: logical flow, easy to scan, with subheadings where appropriate
- Specificity: concrete details and examples beat vague generalisations
- Length: exactly as long as the content needs to be
- Finish: end with purpose — a takeaway, a question, or a clear next step

**CONSTRAINTS**
{policy_section}

**OUTPUT**
Produce the complete, publication-ready content piece.
Do not include meta-commentary about the content — just write it.

Write the content now."""

    if intent == "legal":
        return f"""You are a {effective_role} with expertise in legal and compliance matters in the {industry} sector.
Note: This output is a professional starting point — it must be reviewed by a qualified legal professional before use.

**LEGAL TASK**
{user_input}

**REQUIREMENTS**
- Accuracy: use correct legal terminology for the {industry} context
- Clarity: make the document understandable to non-lawyers where possible
- Completeness: cover the key clauses/provisions typically needed for this document type
- Flagging: clearly mark any clause that carries significant risk or needs specialist input
- Disclaimers: include appropriate review-required notices

**CONSTRAINTS**
{policy_section}

**OUTPUT STRUCTURE**
1. **Document / Clause** — the complete draft
2. **Key Provisions Explained** — plain-English summary of major clauses
3. **Risk Flags** — sections that need legal review highlighted explicitly
4. **⚠️ Legal Disclaimer** — this is a draft only; qualified legal review is required before use

Produce the legal document now."""

    if intent == "hr":
        return f"""You are a {effective_role} and HR professional working in the {industry} sector.
You combine deep HR expertise with empathy and clarity, producing people-first documents that are also legally sound.

**HR TASK**
{user_input}

**REQUIREMENTS**
- Tone: inclusive, fair, empathetic — professional but human
- Legal awareness: flag any aspect that may have legal/employment law implications
- Clarity: accessible to all employees, not just HR professionals
- Policy alignment: consistent with standard HR best practices for {industry}

**CONSTRAINTS**
{policy_section}

**OUTPUT STRUCTURE**
1. **Main Document / Communication** — the deliverable
2. **Usage Notes** — how and when to use this document
3. **Legal / Compliance Flags** — anything requiring HR or legal review
4. **Recommended Next Steps** — follow-up actions

Produce the HR document now."""

    if intent == "it support":
        return f"""You are a {effective_role} and IT support specialist working in the {industry} sector.
You provide precise, step-by-step technical guidance that resolves issues efficiently.

**IT SUPPORT TASK**
{user_input}

**REQUIREMENTS**
- Diagnose first: identify the most likely root cause(s)
- Be specific: exact commands, settings, or steps — no vague instructions
- Escalation path: when and how to escalate if the primary fix fails
- Prevention: note what can be done to prevent recurrence

**CONSTRAINTS**
{policy_section}

**OUTPUT STRUCTURE**
1. **Problem Assessment** — likely root cause
2. **Resolution Steps** — numbered, exact steps to resolve
3. **Verification** — how to confirm the fix worked
4. **Escalation Path** — when and how to escalate
5. **Prevention** — steps to avoid recurrence
6. **Impact / Risk Note** — any risks in applying the fix

Produce the IT support response now."""

    general_context = {
        "learning": f"You are an expert tutor and {effective_role} explaining this topic clearly and progressively.",
        "automate": f"You are a {effective_role} and process automation expert designing an efficient, implementable workflow.",
    }.get(task_type, f"You are a {effective_role} with deep expertise in the {industry} industry.")

    task_framing = {
        "learning": (
            "Start from first principles if needed. Use concrete analogies and worked examples. "
            "Build from foundational to advanced, checking in with 'here's why this matters' at key points."
        ),
        "automate": (
            "Map the current process, identify automation opportunities, design the solution, "
            "and provide implementation guidance with specific tools and steps."
        ),
    }.get(task_type, "Produce a high-quality, immediately usable professional response.")

    return f"""{general_context}

**TASK**
{user_input}

**CONTEXT**
- Role: {effective_role} | Industry: {industry} | Intent: {intent}

**REQUIREMENTS**
{task_framing}
- Be specific and concrete — avoid generic advice
- Structure your response clearly with headers
- Flag anything that requires specialist review

**CONSTRAINTS**
{policy_section}

**OUTPUT**
Produce a comprehensive, well-structured response that directly addresses the task.
End with clear next steps or recommendations.

Produce the response now."""


def _build_fallback_prompt(
    user_input: str, role: str, task_type: str, industry: str, intent: str,
    tool_name: str, tool_info: dict, policy_block: str, sensitivity: str
) -> str:
    policy_section = (
        f"\n\nPolicy constraints to follow:\n{policy_block}"
        if policy_block else ""
    )
    sensitivity_note = {
        "client": "\n\nReplace all real client names with [CLIENT NAME] and figures with [VALUE]. Flag sections needing review before external use.",
        "internal": "\n\nThis is for internal use only. Avoid exposing sensitive internal metrics.",
    }.get(sensitivity, "")

    return (
        f"You are a {role} working in the {industry} industry on a {task_type} task.\n\n"
        f"Task: {user_input}\n\n"
        f"Please provide a well-structured, professional response. "
        f"Format the output clearly with headers and sections where appropriate. "
        f"Tailor the depth and tone for a {role} audience."
        f"{sensitivity_note}"
        f"{policy_section}"
    )


def _build_fallback_corlo_prompt(
    user_input: str, role: str, task_type: str, industry: str, intent: str,
    tool_name: str, tool_info: dict, policy_block: str, sensitivity: str
) -> str:
    effective_role = role.strip() if role and role != "general" else "Enterprise Professional"
    
    policy_section = ""
    if policy_block:
        policy_section = f"- Respect all company policies: {policy_block}"
    
    sensitivity_section = ""
    if sensitivity == "client":
        sensitivity_section = "- Replace real names with [CLIENT NAME] and figures with [VALUE]\n- Flag sections needing review before external sharing"
    elif sensitivity == "internal":
        sensitivity_section = "- Mark outputs as internal use only\n- Avoid disclosing sensitive internal metrics"
    
    limitations = []
    if policy_section:
        limitations.append(policy_section)
    if sensitivity_section:
        limitations.extend(sensitivity_section.split('\n'))
    limitations_str = '\n'.join(limitations) if limitations else "- Apply standard professional practices"

    return f"""ROLE: You are a {effective_role} working in the {industry} industry.

CONTEXT: You are completing a {task_type} task in the {industry} industry.

OBJECTIVE: {user_input}

LIMITATIONS:
{limitations_str}

OUTPUT: Provide a well-structured, professional response tailored for a {effective_role} audience. Format clearly with headers and sections where appropriate."""


def build_corlo_prompt(state: OrchestratorState) -> OrchestratorState:
    conn = get_db()
    row  = conn.execute(
        "SELECT version FROM prompt_versions ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    conn.close()

    prompt_version = row["version"] if row else "1.0"
    policy_summary = state.get("policy_summary", "")
    policy_block   = (
        policy_summary
        if policy_summary and "No company policy documents" not in policy_summary
        else ""
    )
    tool_info  = AI_TOOLS_REGISTRY.get(state["recommended_tool"], {})
    role       = state.get("role", "general")
    task_type  = state.get("task_type", "general")
    sensitivity = state.get("data_sensitivity", "general")
    industry   = state["industry"]
    intent     = state["intent"]
    tool_name  = state["recommended_tool"]
    user_input = state["user_input"]

    if HAS_AZURE and _azure_client:
        try:
            system_msg = (
                "You are an expert prompt engineer. Your job is to write a clear, effective, "
                "task-specific AI prompt structured in CORLO format. The CORLO format has 5 sections: "
                "ROLE, CONTEXT, OBJECTIVE, LIMITATIONS, OUTPUT. "
                "The prompt must be immediately usable — no meta-commentary, no placeholders, "
                "no explanations about the prompt itself. Just the CORLO-structured prompt."
            )

            policy_instruction = (
                f"\n\nApplicable company policies that must be respected:\n{policy_block}"
                if policy_block else ""
            )

            sensitivity_instruction = {
                "client": (
                    "\n\nDATA SENSITIVITY — CLIENT CONFIDENTIAL: "
                    "Instruct the AI to replace real names with [CLIENT NAME], figures with [VALUE], "
                    "and flag sections needing human review before external sharing."
                ),
                "internal": (
                    "\n\nDATA SENSITIVITY — INTERNAL: "
                    "Instruct the AI to avoid disclosing specific internal metrics and mark outputs "
                    "as internal use only."
                ),
            }.get(sensitivity, "")

            user_msg = (
                f"Write a CORLO-formatted AI prompt for the following task.\n\n"
                f"USER REQUEST: {user_input}\n\n"
                f"CONTEXT:\n"
                f"- User role    : {role}\n"
                f"- Task type    : {task_type}\n"
                f"- Industry     : {industry}\n"
                f"- Intent       : {intent}\n"
                f"- Sensitivity  : {sensitivity}"
                f"{sensitivity_instruction}"
                f"{policy_instruction}\n\n"
                f"Requirements for the CORLO prompt you write:\n"
                f"1. Structure the prompt in exactly 5 sections: ROLE, CONTEXT, OBJECTIVE, LIMITATIONS, OUTPUT\n"
                f"2. ROLE: Define the AI's role based on the user role and industry context\n"
                f"3. CONTEXT: Provide background information and tool context\n"
                f"4. OBJECTIVE: Clearly state what the AI should accomplish\n"
                f"5. LIMITATIONS: Include any constraints, sensitivity rules, and policy requirements\n"
                f"6. OUTPUT: Specify the desired output format and structure\n"
                f"7. Be concise but complete — remove any filler or boilerplate\n"
                f"8. Do NOT wrap the prompt in quotes or add any preamble like 'Here is your prompt:'\n"
                f"9. Write the prompt as if you are the user talking directly to the AI tool"
            )

            corlo_prompt, _ = _azure_chat(
                messages=[
                    {"role": "system", "content": system_msg},
                    {"role": "user",   "content": user_msg},
                ],
                max_tokens=1200,
                temperature=0.3,
            )
        except Exception:
            corlo_prompt = _build_fallback_corlo_prompt(
                user_input, role, task_type, industry, intent,
                tool_name, tool_info, policy_block, sensitivity
            )
    else:
        corlo_prompt = _build_fallback_corlo_prompt(
            user_input, role, task_type, industry, intent,
            tool_name, tool_info, policy_block, sensitivity
        )

    return {**state, "corlo_prompt": corlo_prompt, "prompt_version": prompt_version}
