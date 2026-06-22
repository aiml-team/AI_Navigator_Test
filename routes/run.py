import json
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException
from schemas import RunRequest
from services.orchestrator import orchestrator
from services.database import get_db
from services.registry import AI_TOOLS_REGISTRY, SYSTEM_VERSION
from auth import canonicalize_email

router = APIRouter()


@router.post("/api/run")
async def run_orchestrator(req: RunRequest):
    if not req.user_input.strip():
        raise HTTPException(400, "Input cannot be empty")

    result = orchestrator.invoke({
        "user_input":       req.user_input,
        "role":             req.role or "general",
        "task_type":        req.task_type or "general",
        "data_sensitivity": req.data_sensitivity or "general",
        "intent": "", "industry": "",
        "recommended_tool": "", "tool_reason": "",
        "tool_confidence": "", "tool_confidence_pct": 0,
        "tool_confidence_explanation": "",
        "tool_alternatives": [], "tool_alternative_reasons": [],
        "tool_alternative_confidence_pcts": [], "tool_alternative_urls": [],
        "policy_flags": [], "policies": [],
        "policy_summary": "", "policy_blocked": False,
        "internal_results": None, "external_results": None,
        "corlo_prompt": "", "prompt_version": "1.0",
        "llm_output": "", "token_estimate": 0, "error": None,
        "skip_tool_recommendation": bool(req.skip_tool_recommendation),
    })

    audit_id  = str(uuid.uuid4())
    tool_info = AI_TOOLS_REGISTRY.get(result["recommended_tool"], {})

    is_blocked     = result.get("policy_blocked", False)
    policy_summary = result.get("policy_summary", "")

    stored_role  = (req.role or "").strip() or "general"
    # Always store the canonical email so every new audit row has a
    # uniform key — eliminates @bs.nttdata.com vs @nttdata.com drift.
    stored_email = canonicalize_email(req.user_email or "")

    conn = get_db()
    conn.execute(
        """INSERT INTO audit_log
            (id, created_at, raw_input, intent, industry,
             recommended_tool, tool_reason, tool_confidence,
             policy_flags, retrieved_policies, final_prompt,
             prompt_version, model_used, output, token_estimate,
             system_version, policy_blocked, policy_summary, role, user_email)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            audit_id, datetime.utcnow().isoformat(),
            result["user_input"], result["intent"], result["industry"],
            result["recommended_tool"], result["tool_reason"],
            result["tool_confidence"], json.dumps(result["policy_flags"]),
            json.dumps(result["policies"]), result["corlo_prompt"],
            result.get("prompt_version", "1.0"),
            result["recommended_tool"], result["llm_output"],
            result["token_estimate"], SYSTEM_VERSION,
            1 if is_blocked else 0,
            policy_summary,
            stored_role,
            stored_email,
        ),
    )
    conn.commit()
    conn.close()

    return {
        "audit_id":          audit_id,
        "intent":            result["intent"],
        "industry":          result["industry"],
        "recommended_tool":  result["recommended_tool"],
        "tool_reason":       result["tool_reason"],
        "tool_confidence":   result["tool_confidence"],
        "tool_alternatives":                result["tool_alternatives"],
        "tool_alternative_reasons":         result.get("tool_alternative_reasons", []),
        "tool_alternative_confidence_pcts": result.get("tool_alternative_confidence_pcts", []),
        "tool_alternative_urls":            result.get("tool_alternative_urls", []),
        "tool_confidence_pct":              result.get("tool_confidence_pct", 0),
        "tool_confidence_explanation":      result.get("tool_confidence_explanation", ""),
        "tool_icon":         tool_info.get("icon", "🤖"),
        "tool_category":     tool_info.get("category", ""),
        "tool_url":          result.get("tool_url") or tool_info.get("url", ""),
        "tool_is_internal":  tool_info.get("is_internal", False),
        "policy_flags":      result["policy_flags"],
        "policies":          result["policies"],
        "policy_summary":    policy_summary,
        "policy_blocked":    is_blocked,
        "corlo_prompt":      result["corlo_prompt"],
        "prompt_version":    result.get("prompt_version", "1.0"),
        "output":            result["llm_output"],
        "token_estimate":    result["token_estimate"],
        "role":              req.role,
        "task_type":         req.task_type,
        "data_sensitivity":  req.data_sensitivity,
    }
