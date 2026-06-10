import re
from difflib import SequenceMatcher


ACTION_GROUPS = {
    "create": ["create", "draft", "write", "generate", "build", "prepare", "produce"],
    "analyze": ["analyze", "analyse", "evaluate", "assess", "review", "compare", "identify"],
    "summarize": ["summarize", "summarise", "condense", "extract", "brief"],
    "plan": ["plan", "roadmap", "strategy", "timeline", "schedule"],
    "communicate": ["email", "message", "respond", "reply", "communicate"],
    "code": ["code", "debug", "script", "api", "develop", "fix", "test"],
    "research": ["research", "find", "investigate", "discover", "benchmark"],
}

OUTPUT_GROUPS = {
    "proposal": ["proposal", "pitch", "rfp", "sow", "business case"],
    "report": ["report", "summary", "analysis", "findings", "brief"],
    "email": ["email", "message", "communication"],
    "code": ["code", "script", "function", "api"],
    "presentation": ["presentation", "slides", "deck"],
    "plan": ["plan", "roadmap", "timeline", "strategy"],
    "document": ["document", "template", "guide", "manual"],
}


def _norm(text: str) -> str:
    text = (text or "").lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _detect_group(text: str, groups: dict) -> str:
    t = _norm(text)
    for label, words in groups.items():
        if any(w in t for w in words):
            return label
    return "general"


def _token_set(text: str) -> set:
    stop = {
        "the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "with",
        "from", "by", "using", "that", "this", "please", "need", "want", "help",
        "scenario", "task"
    }
    return {w for w in _norm(text).split() if len(w) > 2 and w not in stop}


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _profile(item: dict) -> dict:
    text = " ".join([
        item.get("title", ""),
        item.get("scenario", ""),
        item.get("category", ""),
        item.get("persona", ""),
        item.get("mega_group", ""),
        item.get("activate_phase", "") or item.get("phase", ""),
        item.get("task_type", ""),
    ])

    return {
        "action": _detect_group(text, ACTION_GROUPS),
        "output": _detect_group(text, OUTPUT_GROUPS),
        "tokens": _token_set(text),
        "persona": _norm(item.get("persona", "")),
        "category": _norm(item.get("category", "")),
        "mega_group": _norm(item.get("mega_group", "")),
        "phase": _norm(item.get("activate_phase", "") or item.get("phase", "")),
        "text": _norm(text),
    }


def score_similarity(submitted: dict, existing: dict) -> dict:
    a = _profile(submitted)
    b = _profile(existing)

    score = 0

    if a["action"] != "general" and a["action"] == b["action"]:
        score += 28

    if a["output"] != "general" and a["output"] == b["output"]:
        score += 24

    token_score = _jaccard(a["tokens"], b["tokens"])
    score += round(token_score * 22)

    if a["persona"] and b["persona"] and (a["persona"] in b["persona"] or b["persona"] in a["persona"]):
        score += 10

    if a["category"] and b["category"] and a["category"] == b["category"]:
        score += 8

    if a["mega_group"] and b["mega_group"] and a["mega_group"] == b["mega_group"]:
        score += 5

    if a["phase"] and b["phase"] and a["phase"] == b["phase"]:
        score += 3

    title_ratio = SequenceMatcher(
        None,
        _norm(submitted.get("title", "")),
        _norm(existing.get("title", ""))
    ).ratio()
    score += round(title_ratio * 8)

    return {
        "score": min(100, score),
        "intent_action": a["action"],
        "intent_output": a["output"],
        "matched_action": b["action"],
        "matched_output": b["output"],
    }


def find_similar_scenarios(submitted: dict, library: list, limit: int = 5) -> list:
    matches = []

    for idx, scenario in enumerate(library or []):
        result = score_similarity(submitted, scenario)
        matches.append({
            "index": idx,
            "score": result["score"],
            "title": scenario.get("title", ""),
            "mega_group": scenario.get("mega_group", ""),
            "category": scenario.get("category", ""),
            "persona": scenario.get("persona", ""),
            "phase": scenario.get("phase", "") or scenario.get("activate_phase", ""),
            "scenario": scenario.get("scenario", ""),
            "intent_action": result["intent_action"],
            "intent_output": result["intent_output"],
            "matched_action": result["matched_action"],
            "matched_output": result["matched_output"],
        })

    matches.sort(key=lambda x: x["score"], reverse=True)
    return matches[:limit]