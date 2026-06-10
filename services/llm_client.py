import os

try:
    from openai import AzureOpenAI

    _azure_client = AzureOpenAI(
        api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
        azure_endpoint=os.getenv("AZURE_OPENAI_BASE_URL", ""),
        api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01"),
    )
    _AZURE_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "")
    HAS_AZURE = bool(
        os.getenv("AZURE_OPENAI_API_KEY") and
        os.getenv("AZURE_OPENAI_BASE_URL") and
        _AZURE_DEPLOYMENT
    )
except Exception:
    _azure_client = None
    _AZURE_DEPLOYMENT = ""
    HAS_AZURE = False


def _azure_chat(messages: list, max_tokens: int = 512, temperature: float = 0.0) -> tuple:
    resp = _azure_client.chat.completions.create(
        model=_AZURE_DEPLOYMENT,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    content = resp.choices[0].message.content or ""
    tokens  = resp.usage.total_tokens if resp.usage else 0
    return content, tokens


def call_llm(system_prompt: str, user_prompt: str, max_tokens: int = 1024, temperature: float = 0.4) -> str:
    if HAS_AZURE and _azure_client:
        content, _ = _azure_chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return content
    else:
        return (
            "[Demo Mode — Azure OpenAI not configured]\n\n"
            "Refinement requires AZURE_OPENAI_API_KEY, AZURE_OPENAI_BASE_URL, and "
            "AZURE_OPENAI_DEPLOYMENT environment variables to be set.\n\n"
            f"Your comment was received: \"{user_prompt[:200]}...\""
        )


def call_llm_messages(messages: list, max_tokens: int = 1024, temperature: float = 0.3) -> str:
    if HAS_AZURE and _azure_client:
        content, _ = _azure_chat(
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return content
    else:
        return "[Demo Mode — Azure OpenAI not configured]"
