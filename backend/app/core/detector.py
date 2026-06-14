"""Hybrid detection engine: interpretable rule signals + IsolationForest.

Each event accumulates a list of fired rules (id, points, human factor). The rule
points drive an interpretable base score; the unsupervised model only *escalates*
clear statistical outliers, which keeps false positives down (it cannot, on its
own, raise a benign event into alert territory).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from . import config, context, features

W = config.RULE_WEIGHTS


def _event_rules(ev: pd.Series) -> list[tuple[str, int, str]]:
    """Evaluate all rule signals for a single event row."""
    fired: list[tuple[str, int, str]] = []
    res = ev["resource"]
    sens = ev["resource_sensitivity"]
    high = sens == "high"
    sensitive_res = res in config.SENSITIVE_RESOURCES
    dept = ev["department"]
    priv = ev["privilege_level"]

    # R1 — off-hours access to sensitive data (high-sensitivity sensitive resource)
    if high and sensitive_res:
        if ev["time_bucket"] == "night":
            fired.append(("OFF_HOURS_NIGHT", W["OFF_HOURS_NIGHT"],
                          f"Night-time access ({ev['hour']:02d}:00) to {sens}-sensitivity {res}"))
        elif ev["time_bucket"] == "after_hours":
            fired.append(("OFF_HOURS_AFTER", W["OFF_HOURS_AFTER"],
                          f"After-hours access ({ev['hour']:02d}:00) to {sens}-sensitivity {res}"))
        elif ev["time_bucket"] == "weekend":
            fired.append(("OFF_HOURS_WEEKEND", W["OFF_HOURS_WEEKEND"],
                          f"Weekend access to {sens}-sensitivity {res}"))

    # R2 — sensitive export (exfil proxy, since no destination column exists)
    if ev["is_export"] and (high or res in config.EXFIL_CHANNELS):
        pts = W["SENSITIVE_EXPORT"]
        msg = f"Export of {sens}-sensitivity data from {res}"
        if res in config.PII_RESOURCES:
            pts += W["PII_EXPORT_BONUS"]
            msg += " (PII)"
        fired.append(("SENSITIVE_EXPORT", pts, msg))

    # R3 — volume spike vs cohort (bulk proxy, since no rowcount column exists)
    vz = ev.get("volume_z", 0.0)
    if vz >= 3:
        fired.append(("VOLUME_SPIKE", W["VOLUME_SPIKE_3"],
                      f"Activity volume {vz:.1f}σ above department/role peers"))
    elif vz >= 2.5:
        fired.append(("VOLUME_SPIKE", W["VOLUME_SPIKE_25"],
                      f"Activity volume {vz:.1f}σ above peers"))
    elif vz >= 2:
        fired.append(("VOLUME_SPIKE", W["VOLUME_SPIKE_2"],
                      f"Activity volume {vz:.1f}σ above peers"))
    elif vz >= 1.5:
        fired.append(("VOLUME_SPIKE", W["VOLUME_SPIKE_15"],
                      f"Elevated activity volume ({vz:.1f}σ above peers)"))

    # R4 — privilege escalation: admin op by a non-privileged account
    if ev["is_admin_op"] and priv not in config.PRIVILEGED_LEVELS:
        fired.append(("PRIV_ESCALATION", W["PRIV_ESCALATION"],
                      f"Admin operation performed by non-privileged '{priv}' account"))

    # R5 — first-time access to a sensitive resource (novelty)
    if ev.get("first_time_resource", False) and sensitive_res:
        fired.append(("FIRST_TIME_SENSITIVE", W["FIRST_TIME_SENSITIVE"],
                      f"First-ever access to sensitive resource {res}"))

    # R6 — cross-department access to a sensitive resource
    owners = config.RESOURCE_OWNER_DEPARTMENTS.get(res)
    if owners is not None and dept not in owners and dept != "UNKNOWN":
        fired.append(("CROSS_DEPT_SENSITIVE", W["CROSS_DEPT_SENSITIVE"],
                      f"{dept} user accessing {res} (typically restricted to {', '.join(sorted(owners))})"))

    # R7 — failures (single + burst)
    if ev["is_failure"]:
        fired.append(("FAILURE_EVENT", W["FAILURE_EVENT"], "Access attempt failed"))
        if ev.get("failure_count", 0) >= 3:
            fired.append(("FAILURE_BURST", W["FAILURE_BURST"],
                          f"Part of a burst of {int(ev['failure_count'])} failed attempts by this user"))

    # R8 — stale-but-active privileged account doing something sensitive
    if (ev["days_inactive"] >= config.VERY_STALE_INACTIVE_DAYS
            and priv in config.PRIVILEGED_LEVELS
            and (ev["is_export"] or ev["is_admin_op"] or high)):
        fired.append(("STALE_PRIVILEGED_ACTIVE", W["STALE_PRIVILEGED_ACTIVE"],
                      f"Privileged account inactive {int(ev['days_inactive'])}d yet performing sensitive action"))

    # R9 — service account behaving interactively off-hours
    if priv == "service-account" and ev["action"] in {"login", "file_access"} and ev["is_offhours"]:
        fired.append(("SERVICE_ACCT_INTERACTIVE", W["SERVICE_ACCT_INTERACTIVE"],
                      f"Service account performing interactive '{ev['action']}' off-hours"))

    return fired


def _stack_scores(points: list[int]) -> float:
    """Combine rule points with diminishing returns so stacking is realistic.

    Rules are sorted highest-first; each successive rule contributes
    RULE_STACK_DECAY times the previous contribution, preventing 2-3 moderate
    signals from instantly saturating at 100.
    """
    if not points:
        return 0.0
    decay = config.RULE_STACK_DECAY
    total = 0.0
    factor = 1.0
    for p in sorted(points, reverse=True):
        total += p * factor
        factor *= decay
    return min(100.0, total)


def _model_scores(events: pd.DataFrame, random_state: int = 42) -> np.ndarray:
    """IsolationForest anomaly score per event, normalized to 0..1 (1 = outlier)."""
    X = features.model_feature_matrix(events)
    iso = IsolationForest(
        n_estimators=200, contamination=0.1, random_state=random_state, n_jobs=-1
    )
    iso.fit(X)
    raw = -iso.score_samples(X)  # higher = more anomalous
    lo, hi = raw.min(), raw.max()
    return (raw - lo) / (hi - lo) if hi > lo else np.zeros_like(raw)


def detect(events: pd.DataFrame) -> pd.DataFrame:
    """Run rules + model, return events with rule lists, factors and model score."""
    base_scores, factor_lists, rule_id_lists, exceptions = [], [], [], []
    for _, ev in events.iterrows():
        fired = _event_rules(ev)
        raw = _stack_scores([p for _, p, _ in fired])
        exc = context.legitimate_exception(ev)
        factors = [f for _, _, f in fired]
        if exc and raw > 0:
            raw = raw * context.SUPPRESSION_FACTOR
            factors.append(f"[context: {exc} — score suppressed as likely legitimate]")
        base_scores.append(raw)
        factor_lists.append(factors)
        rule_id_lists.append([rid for rid, _, _ in fired])
        exceptions.append(exc or "")

    out = events.copy()
    out["rules_fired"] = rule_id_lists
    out["factors"] = factor_lists
    out["base_score"] = base_scores
    out["context_exception"] = exceptions
    out["model_score"] = _model_scores(events)
    return out
