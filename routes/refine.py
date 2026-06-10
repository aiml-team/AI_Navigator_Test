from fastapi import APIRouter, HTTPException
from schemas import RefinementRequest
from services.llm_client import call_llm

router = APIRouter()


@router.post("/api/refine")
async def refine_output(req: RefinementRequest):
    if not req.comment.strip():
        raise HTTPException(400, "Comment cannot be empty")

    system_msg = (
        f"You are an expert prompt engineer helping a {req.role} working on a "
        f"{req.task_type} task in the {req.industry} industry. "
        f"Data sensitivity: {req.data_sensitivity}. "
        f"Target tool: {req.recommended_tool}. "
        "Your job is to revise an existing CORLO prompt based on the user's feedback. "
        "The CORLO prompt is structured in 5 sections: ROLE, CONTEXT, OBJECTIVE, LIMITATIONS, OUTPUT. "
        "Apply the user's comment precisely — change only what they ask, keep everything else. "
        "Return only the complete revised CORLO prompt — no preamble, no explanation."
    )
    user_msg = (
        f"ORIGINAL USER REQUEST:\n{req.user_input}\n\n"
        f"CURRENT CORLO PROMPT (what you are revising):\n{req.corlo_prompt}\n\n"
        f"USER FEEDBACK / REVISION COMMENT:\n{req.comment}\n\n"
        "Instructions:\n"
        "- Read the comment carefully — it tells you exactly what to change in the prompt.\n"
        "- If they say 'make it shorter' → tighten the OBJECTIVE and OUTPUT sections.\n"
        "- If they say 'add X' → insert it in the most appropriate section.\n"
        "- If they say 'focus on Y' → adjust the OBJECTIVE and OUTPUT accordingly.\n"
        "- Keep the 5-section structure (ROLE, CONTEXT, OBJECTIVE, LIMITATIONS, OUTPUT).\n"
        "- Return the complete revised prompt only."
    )

    try:
        revised = call_llm(system_msg, user_msg, max_tokens=2000)
    except Exception as e:
        raise HTTPException(500, f"LLM refinement failed: {str(e)}")

    return {
        "audit_id":       req.audit_id,
        "revised_output": revised,
    }
