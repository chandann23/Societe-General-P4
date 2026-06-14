"""OpenRouter LLM client for AI-generated investigation narratives.

Three operating modes:
- No OPENROUTER_API_KEY → returns None → callers fall back to template narratives.
- OPENROUTER_DRY_RUN=1  → deterministic mock payload (source:"mock"), no HTTP, no billing.
- Key present           → real API call (source:"llm") with token/cost accounting.

All results should be cached by the caller (store.py) to avoid re-billing on reloads.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

# Auto-load backend/.env if present (python-dotenv, optional)
try:
    from dotenv import load_dotenv
    _env_file = Path(__file__).resolve().parents[2] / ".env"
    if _env_file.exists():
        load_dotenv(_env_file, override=False)
except ImportError:
    pass

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "nvidia/nemotron-nano-9b-v2:free"
TOPN_DEFAULT = 12

PRICE_PER_1K_INPUT = 0.0      # free tier
PRICE_PER_1K_OUTPUT = 0.0


def _api_key() -> str | None:
    return os.getenv("OPENROUTER_API_KEY", "").strip() or None


def _is_dry_run() -> bool:
    return os.getenv("OPENROUTER_DRY_RUN", "").strip() == "1"


def _model() -> str:
    return os.getenv("OPENROUTER_MODEL", DEFAULT_MODEL).strip()


def _topn() -> int:
    try:
        return int(os.getenv("OPENROUTER_LLM_TOPN", str(TOPN_DEFAULT)))
    except ValueError:
        return TOPN_DEFAULT


def batch_enabled() -> bool:
    """Whether pipeline should pre-generate LLM narratives in batch.

    Defaults to False — free-tier models are too slow for batch use.
    Set OPENROUTER_BATCH=1 to enable (e.g. for paid models).
    """
    return os.getenv("OPENROUTER_BATCH", "0").strip() == "1"


def _system_prompt() -> str:
    return (
        "You are a Senior SOC Analyst. Given a data-access anomaly alert, produce a concise "
        "investigation narrative and action list in JSON. "
        "Use ONLY the data provided — do NOT invent HR status, ticket numbers, or facts not given. "
        "If a field is unavailable, say 'not available in source data' rather than guessing."
    )


def _user_prompt(alert: dict) -> str:
    lines = [
        f"Alert ID: {alert.get('alert_id', alert.get('access_id', 'N/A'))}",
        f"User: {alert.get('username', 'N/A')} (ID: {alert.get('user_id', 'N/A')})",
        f"Department / Role: {alert.get('department', 'N/A')} / {alert.get('action', 'N/A')}",
        f"Resource accessed: {alert.get('resource', 'N/A')} (sensitivity: {alert.get('resource_sensitivity', 'N/A')})",
        f"Action: {alert.get('action', 'N/A')}",
        f"Timestamp: {alert.get('timestamp', 'N/A')} ({alert.get('time_bucket', 'N/A')})",
        f"Risk score: {alert.get('risk_score', 'N/A')}/100  Severity: {alert.get('severity', 'N/A')}",
        "",
        "Anomalies detected:",
    ]
    for a in alert.get("anomalies_detected", []):
        lines.append(f"  - {a}")
    lines += [
        "",
        f"Business context: {alert.get('business_context', 'N/A')}",
        "",
        "Respond with JSON exactly matching this schema:",
        '{"narrative": "<2-3 sentence investigation summary>",',
        ' "recommended_actions": ["<action 1>", "<action 2>", "<action 3>"],',
        ' "analyst_priority": "P1"|"P2"|"P3"}',
    ]
    return "\n".join(lines)


def _mock_payload(alert: dict) -> dict:
    sev = alert.get("severity", "MEDIUM")
    priority = {"CRITICAL": "P1", "HIGH": "P1", "MEDIUM": "P2"}.get(sev, "P3")
    return {
        "source": "mock",
        "model": "dry-run-mock",
        "narrative": (
            f"[DRY-RUN] {alert.get('username', 'Unknown')} ({alert.get('department', 'N/A')}) "
            f"performed {alert.get('action', 'N/A')} on {alert.get('resource', 'N/A')} "
            f"during {alert.get('time_bucket', 'N/A')} with risk score {alert.get('risk_score', 'N/A')}/100. "
            "This is a synthetic mock narrative — enable OPENROUTER_API_KEY for real AI analysis."
        ),
        "recommended_actions": [
            "Review recent access logs for this user",
            "Confirm business justification with manager",
            "Escalate to IR team if no justification found",
        ],
        "analyst_priority": priority,
        "tokens": {"prompt": 0, "completion": 0, "total": 0},
        "est_cost_usd": 0.0,
    }


def generate(alert: dict) -> dict | None:
    """Generate an AI investigation narrative for a single alert.

    Returns a payload dict or None (on missing key / error).
    Callers should fall back to template narratives when None is returned.
    """
    if _is_dry_run():
        return _mock_payload(alert)

    key = _api_key()
    if not key:
        return None

    import urllib.request
    import urllib.error

    model = _model()
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": _user_prompt(alert)},
        ],
        "max_tokens": 512,
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    referer = os.getenv("OPENROUTER_REFERER", "")
    title = os.getenv("OPENROUTER_TITLE", "PS4 Insider Threat Sentinel")
    if referer:
        headers["HTTP-Referer"] = referer
    if title:
        headers["X-Title"] = title

    try:
        payload_bytes = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            OPENROUTER_URL,
            data=payload_bytes,
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[llm] OpenRouter request failed: {e}")
        return None

    try:
        content = data["choices"][0]["message"]["content"]
        # Strip markdown fences if model wraps JSON in ```json ... ```
        content = content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        parsed = json.loads(content.strip())
        usage = data.get("usage", {})
        p_tok = usage.get("prompt_tokens", 0)
        c_tok = usage.get("completion_tokens", 0)
        est = round((p_tok / 1000) * PRICE_PER_1K_INPUT + (c_tok / 1000) * PRICE_PER_1K_OUTPUT, 6)
        return {
            "source": "llm",
            "model": model,
            "narrative": parsed["narrative"],
            "recommended_actions": parsed.get("recommended_actions", []),
            "analyst_priority": parsed.get("analyst_priority", "P2"),
            "tokens": {"prompt": p_tok, "completion": c_tok, "total": p_tok + c_tok},
            "est_cost_usd": est,
        }
    except Exception as e:
        print(f"[llm] Response parse failed: {e} | raw: {data}")
        return None


def topn() -> int:
    return _topn()


def enabled() -> bool:
    """True if LLM generation will produce output (key set or dry-run)."""
    return _is_dry_run() or bool(_api_key())
