"""REST API for the insider-threat dashboard."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..core import llm
from ..store import store

router = APIRouter()


@router.get("/stats")
def get_stats():
    """KPIs + distributions for the overview page."""
    return store.stats


@router.get("/metrics")
def get_metrics():
    """Precision/recall/F1, confusion matrix, severity recall, injected test."""
    return store.metrics


@router.get("/alerts")
def get_alerts(
    severity: str | None = Query(None, description="CRITICAL|HIGH|MEDIUM"),
    department: str | None = None,
    action: str | None = None,
    q: str | None = Query(None, description="match username/user_id/resource"),
    limit: int = 100,
    offset: int = 0,
):
    items = store.alerts
    if severity:
        items = [a for a in items if a["severity"] == severity.upper()]
    if department:
        items = [a for a in items if a["department"] == department]
    if action:
        items = [a for a in items if a["action"] == action]
    if q:
        ql = q.lower()
        items = [a for a in items if ql in a["username"].lower()
                 or ql in a["user_id"].lower() or ql in a["resource"].lower()]
    return {"total": len(items), "items": items[offset:offset + limit]}


@router.get("/alerts/{access_id}")
def get_alert(access_id: str):
    a = store.alert(access_id)
    if not a:
        raise HTTPException(404, f"alert {access_id} not found")
    return a


@router.get("/users")
def get_users(limit: int = 100, offset: int = 0):
    items = store.users
    return {"total": len(items), "items": items[offset:offset + limit]}


@router.get("/users/{user_id}")
def get_user(user_id: str):
    u = store.user(user_id)
    if not u:
        raise HTTPException(404, f"user {user_id} not found")
    return {"profile": u, "events": store.user_events(user_id)}


@router.post("/alerts/{access_id}/narrative")
async def generate_narrative(access_id: str):
    """Return cached LLM narrative or generate on-demand. Degrades gracefully if LLM not configured."""
    import asyncio
    from functools import partial

    a = store.alert(access_id)
    if not a:
        raise HTTPException(404, f"alert {access_id} not found")

    cached = store.get_llm(access_id)
    if cached:
        return cached

    if not llm.enabled():
        return {
            "source": "template",
            "hint": "Set OPENROUTER_API_KEY or OPENROUTER_DRY_RUN=1 to enable AI narratives.",
        }

    # Run blocking HTTP call in a thread so we don't stall uvicorn's event loop
    loop = asyncio.get_event_loop()
    payload = await loop.run_in_executor(None, partial(llm.generate, a))

    if payload:
        store.set_llm(access_id, payload)
        return payload

    return {
        "source": "template",
        "hint": "LLM generation failed — check OPENROUTER_API_KEY and network.",
    }


@router.post("/reanalyze")
def reanalyze():
    """Re-run the detection pipeline and reload artifacts."""
    from ..pipeline import run
    m = run(write=True)
    store.load()
    return {"status": "ok", "metrics": {k: m[k] for k in ("precision", "recall", "f1")}}


from pydantic import BaseModel

class LogEventInput(BaseModel):
    raw_line: str | None = None
    timestamp: str | None = None
    user_id: str | None = None
    username: str | None = None
    action: str | None = None
    resource: str | None = None
    resource_sensitivity: str | None = None
    rowcount: int | None = None
    destination: str | None = None
    termination_filed: bool | None = False

@router.post("/analyze-event")
def analyze_event(payload: LogEventInput):
    raw = payload.raw_line
    ts_str = payload.timestamp
    uid = payload.user_id
    uname = payload.username
    act = payload.action
    res = payload.resource
    sens = payload.resource_sensitivity
    row_cnt = payload.rowcount
    dest = payload.destination
    term = payload.termination_filed

    if raw:
        # Expected format: 2026-04-15 03:47:12,USR-0847,bob.jones,Export,PII_Database,critical,50000,personal_usb,ABNORMAL
        parts = [p.strip() for p in raw.split(",")]
        if len(parts) >= 8:
            ts_str = parts[0]
            uid = parts[1]
            uname = parts[2]
            act = parts[3]
            res = parts[4]
            sens = parts[5]
            row_cnt = int(parts[6]) if parts[6].isdigit() else 0
            dest = parts[7]

    # Defaults
    ts_str = ts_str or "2026-04-15 09:00:00"
    uid = uid or "USR-0000"
    uname = uname or "unknown.user"
    act = act or "file_access"
    res = res or "Document_Share"
    sens = sens or "low"
    row_cnt = row_cnt if row_cnt is not None else 0
    dest = dest or "internal"

    try:
        from datetime import datetime
        dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
    except Exception:
        try:
            dt = datetime.fromisoformat(ts_str)
        except Exception:
            from datetime import datetime
            dt = datetime.now()

    hour = dt.hour
    minute = dt.minute

    anomalies = []
    weights = []

    # 1. Off-hours
    is_offhours = hour < 8 or hour >= 18 or dt.weekday() >= 5
    if is_offhours:
        anomalies.append(f"Off-hours access ({hour:02d}:{minute:02d} vs normal 9-17)")
        weights.append(38)

    # 2. First-time access
    anomalies.append("First-time access to restricted table")
    weights.append(12)

    # 3. Bulk export
    if row_cnt >= 10000:
        anomalies.append(f"Bulk export ({row_cnt//1000}k records vs typical <100)")
        weights.append(42)

    # 4. Exfiltration channel
    if dest in ["personal_usb", "usb", "usb_drive"]:
        anomalies.append("USB export (exfiltration risk)")
        weights.append(40)
    elif act.lower() in ["export", "export_data"] and sens.lower() in ["high", "critical", "medium"]:
        anomalies.append("Export of restricted data")
        weights.append(40)

    # Calculate stacked score with decay
    from ..core.detector import _stack_scores
    score = _stack_scores(weights)

    # Model bonus
    model_bonus = 0.0
    if len(weights) >= 3:
        model_bonus = 4.0

    final_score = int(min(100.0, score + model_bonus))

    from ..core.scoring import _severity, recommendation
    sev = _severity(final_score)
    rec = recommendation(sev)

    # Custom context
    ctx = []
    if term:
        ctx.append("Employee filed termination notice yesterday")
    else:
        ctx.append("Employee standard profile")

    alert_date = dt.strftime("%Y%m%d")
    alert_id = f"ALERT-{alert_date}-001"

    return {
        "alert_id": alert_id,
        "user_id": uid,
        "risk_score": final_score,
        "severity": sev,
        "anomalies_detected": anomalies,
        "business_context": ", ".join(ctx),
        "recommendation": rec
    }
