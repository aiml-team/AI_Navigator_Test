import json
import logging

from fastapi import APIRouter, HTTPException
from schemas import ClarifyRequest, ClarifyAnswerRequest, ChatGatherRequest, ChatSummarizeRequest
from services.llm_client import call_llm, call_llm_messages
from services.agents.clarifier import build_clarifier_prompt, _parse_satisfied_block

router = APIRouter()


@router.post("/api/clarify")
async def check_clarity(req: ClarifyRequest):
    if not req.user_input.strip():
        raise HTTPException(400, "Input cannot be empty")

    system_msg = (
        "You are a helpful assistant trying to understand what a user wants to do "
        "so you can recommend the right AI tool for them. "
        "Return ONLY valid JSON — no markdown, no extra text."
    )

    user_msg = (
        f"A user described their task as:\n\"{req.user_input}\"\n\n"
        "Analyse the task carefully and ask ONLY the questions that are genuinely needed "
        "to recommend the right tool. Use your judgement:\n"
        "- If the task is simple and clear, ask 1 question or none at all.\n"
        "- If the task is moderately ambiguous, ask 2-3 questions.\n"
        "- Only ask more if there are truly that many distinct unclear parts.\n\n"
        "For each unclear part you find, write one short question asking the user to clarify "
        "that specific part. Only ask about things they actually wrote — never bring up new topics.\n\n"
        "If everything they wrote is already clear, return needs_clarification=false and no questions.\n\n"
        "Return ONLY this JSON:\n"
        "{\"needs_clarification\": true or false, \"questions\": []}"
    )

    try:
        raw = call_llm(system_msg, user_msg, max_tokens=300, temperature=0.2)
        raw = raw.replace("```json", "").replace("```", "").strip()
        data = json.loads(raw)
        needs = bool(data.get("needs_clarification", False))
        questions = [str(q).strip() for q in (data.get("questions") or []) if str(q).strip()]
        return {"needs_clarification": needs, "questions": questions}
    except Exception:
        return {"needs_clarification": False, "questions": []}


@router.post("/api/clarify-merge")
async def merge_clarification(req: ClarifyAnswerRequest):
    if not req.user_input.strip():
        raise HTTPException(400, "Input cannot be empty")

    qa_pairs = "\n".join(
        f"Q: {q}\nA: {a}"
        for q, a in zip(req.questions, req.answers)
        if q.strip() and a.strip()
    )

    system_msg = (
        "You are a task description enricher for an enterprise AI tool recommender. "
        "Combine the original task description with the user's clarification answers "
        "into a single, clear, specific task description. "
        "Output ONLY the enriched description — no preamble, no explanation, no JSON."
    )
    user_msg = (
        f"ORIGINAL TASK DESCRIPTION:\n{req.user_input}\n\n"
        f"CLARIFICATION Q&A:\n{qa_pairs}\n\n"
        "Write a single enriched task description that incorporates all the above details. "
        "Keep it natural and concise (2-4 sentences max)."
    )

    try:
        enriched = call_llm(system_msg, user_msg, max_tokens=300, temperature=0.1)
        return {"enriched_input": enriched.strip()}
    except Exception:
        combined = req.user_input
        if qa_pairs:
            combined += " " + " ".join(req.answers)
        return {"enriched_input": combined.strip()}


@router.post("/api/chat-gather")
async def chat_gather(req: ChatGatherRequest):
    # Build system prompt — suppresses role question when a default role is saved
    default_role = (req.default_role or "").strip()
    system_prompt = build_clarifier_prompt(default_role)
    messages = [{"role": "system", "content": system_prompt}]

    def _normalise_role(r: str) -> str:
        return "assistant" if r in ("agent", "assistant", "bot") else "user"

    if req.messages:
        for m in req.messages:
            messages.append({"role": _normalise_role(m.role), "content": m.content})
    elif req.user_input:
        messages.append({"role": "user", "content": req.user_input})

    # Use default_role as the fallback role for parsing the [SATISFIED] block
    fallback_role = default_role or req.role or "general"

    def _parse_partial_block(text: str) -> list:
        questions = []
        for line in text.replace("[PARTIAL]", "").strip().splitlines():
            stripped = line.strip()
            if stripped.startswith("- ") or stripped.startswith("• "):
                q = stripped.lstrip("-•").strip()
                if q:
                    questions.append(q)
        return questions

    try:
        raw = call_llm_messages(messages, max_tokens=500, temperature=0.2)
        raw = (raw or "").strip()

        if not raw:
            raise ValueError("Empty LLM response")

        if "[SATISFIED]" in raw:
            parsed = _parse_satisfied_block(raw, fallback_role, req.user_input or "")

            # Detect if SATISFIED was triggered by a skip/proceed command
            # while questions were still pending → flag as partial_info
            _SKIP_PHRASES = [
                "skip", "proceed", "generate", "don't have", "dont have",
                "no answer", "i don't know", "not sure", "just proceed",
                "move on", "go ahead", "don't know",
            ]
            user_msgs  = [m for m in req.messages if m.role == "user"]
            last_user  = (user_msgs[-1].content if user_msgs else "").lower()
            was_skip   = any(p in last_user for p in _SKIP_PHRASES)
            agent_msgs = [m for m in req.messages if m.role in ("agent", "assistant", "bot")]
            had_questions = any(
                ("1." in m.content and len(m.content) > 40) or
                "to help you better" in m.content.lower() or
                "i have a few questions" in m.content.lower() or
                "few questions:" in m.content.lower()
                for m in agent_msgs
            )
            partial_info = was_skip and had_questions

            return {
                "action":               "ready",
                "role":                 parsed["role"],
                "task_type":            parsed["task_type"],
                "task_description":     parsed["task_description"],
                "message":              None,
                "unanswered_questions": [],
                "partial_info":         partial_info,
            }

        if "[PARTIAL]" in raw:
            unanswered = _parse_partial_block(raw)
            return {
                "action":               "partial",
                "message":              None,
                "unanswered_questions": unanswered,
                "role":                 None,
                "task_type":            None,
                "task_description":     None,
            }

        return {
            "action":               "question",
            "message":              raw,
            "role":                 None,
            "task_type":            None,
            "task_description":     None,
            "unanswered_questions": [],
        }
    except Exception as e:
        logging.getLogger("routes.clarifier").error("Clarifier Agent error: %s", e, exc_info=True)
        return {
            "action":               "question",
            "message":              "I'm here to help! Could you describe what you'd like to accomplish today?",
            "role":                 None,
            "task_type":            None,
            "task_description":     None,
            "unanswered_questions": [],
        }


@router.post("/api/chat-summarize")
async def chat_summarize(req: ChatSummarizeRequest):
    default_role = (req.default_role or "").strip()
    messages = [{"role": "system", "content": build_clarifier_prompt(default_role)}]

    def _normalise_role(r: str) -> str:
        return "assistant" if r in ("agent", "assistant", "bot") else "user"

    if req.user_input:
        messages.append({"role": "user", "content": req.user_input})

    for m in req.messages:
        messages.append({"role": _normalise_role(m.role), "content": m.content})

    messages.append({
        "role": "user",
        "content": (
            "I'd like to skip further questions. "
            "Please output the [SATISFIED] block now using the best available information."
        ),
    })

    try:
        raw = call_llm_messages(messages, max_tokens=300, temperature=0.1)
        raw = raw.strip()

        fallback_role_s = default_role or req.role or "general"
        if "[SATISFIED]" in raw:
            parsed = _parse_satisfied_block(raw, fallback_role_s, req.user_input or "")
            return parsed

        raw_json = call_llm(
            "You are a task summarizer. Return ONLY valid JSON — no markdown, no extra text.",
            (
                (f"Initial description: \"{req.user_input}\"\n\n" if req.user_input else "") +
                "Conversation:\n" +
                "\n".join(f"{'User' if m['role'] == 'user' else 'Agent'}: {m['content']}" for m in messages[1:]) +
                "\n\nExtract and return JSON:\n"
                "{\"role\": \"...\", \"task_type\": \"...\", \"task_description\": \"...\"}"
            ),
            max_tokens=300,
            temperature=0.1,
        )
        raw_json = raw_json.replace("```json", "").replace("```", "").strip()
        data = json.loads(raw_json)
        return {
            "role":             data.get("role", fallback_role_s),
            "task_type":        data.get("task_type", req.task_type or "general"),
            "task_description": data.get("task_description", req.user_input or ""),
        }
    except Exception:
        return {
            "role":             req.role or "general",
            "task_type":        req.task_type or "general",
            "task_description": req.user_input or "",
        }
