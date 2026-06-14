"""Template-based (no-LLM) explanations and investigation context.

Output shape matches the PS expected-output image:
  {alert_id, user_id, risk_score, severity, anomalies_detected[],
   business_context, recommendation}
plus extra fields the dashboard consumes.

Business context is built ONLY from fields we actually have (department, tenure/
account age, inactivity, privilege). We do NOT fabricate HR signals like
"termination filed yesterday" — that data isn't in the shipped dataset, and we
say so rather than invent it.
"""
from __future__ import annotations

import pandas as pd

from . import config, scoring


def _business_context(ev: pd.Series) -> str:
    bits = []
    dept = ev["department"]
    priv = ev["privilege_level"]
    age_months = int(ev["account_age_days"] // 30) if ev["account_age_days"] else 0
    bits.append(f"{dept} / {ev['job_title']} ({priv}), ~{age_months}mo tenure")

    inactive = int(ev["days_inactive"])
    if inactive >= config.VERY_STALE_INACTIVE_DAYS:
        bits.append(f"account inactive {inactive}d before this activity (possible stale/compromised credential)")
    elif inactive >= config.STALE_INACTIVE_DAYS:
        bits.append(f"account relatively idle ({inactive}d inactive)")

    if ev.get("time_label_mismatch"):
        bits.append(f"source log mis-tagged time as '{ev['time_classification']}' (recomputed: {ev['time_bucket']})")

    if "VOLUME_SPIKE" in ev["rules_fired"]:
        bits.append("activity well above department/role baseline")

    # Honest gap note for the highest-risk alerts.
    if ev["severity"] in ("CRITICAL", "HIGH"):
        bits.append("note: no rowcount/destination/HR-status fields in source data — volume & exfil inferred")
    return "; ".join(bits)


def build_alert(ev: pd.Series) -> dict:
    sev = ev["severity"]
    return {
        "alert_id": f"ALERT-{ev['timestamp']:%Y%m%d}-{ev['access_id']}",
        "access_id": ev["access_id"],
        "user_id": ev["user_id"],
        "username": ev["username"],
        "department": ev["department"],
        "timestamp": ev["timestamp"].isoformat(),
        "resource": ev["resource"],
        "action": ev["action"],
        "resource_sensitivity": ev["resource_sensitivity"],
        "time_bucket": ev["time_bucket"],
        "risk_score": int(ev["risk_score"]),
        "severity": sev,
        "account_age_days": int(ev["account_age_days"]),
        "anomalies_detected": list(ev["factors"]),
        "rules_fired": list(ev["rules_fired"]),
        "business_context": _business_context(ev),
        "recommendation": scoring.recommendation(sev),
    }


def build_alerts(scored: pd.DataFrame) -> list[dict]:
    """All alerting events (MEDIUM+), highest risk first."""
    alerts = scored[scored["predicted_anomaly"]].copy()
    alerts = alerts.sort_values("risk_score", ascending=False)
    return [build_alert(ev) for _, ev in alerts.iterrows()]


def enrich(alert: dict, llm_payload: dict) -> dict:
    """Attach an LLM payload to an alert dict (non-destructive — template fields untouched)."""
    return {**alert, "llm": llm_payload}
