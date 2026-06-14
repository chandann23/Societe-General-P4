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
