"""End-to-end detection pipeline.

Run:  python -m app.pipeline      (from the backend/ directory)

Steps: load -> inject canonical eval anomalies -> features + cohort baselines ->
detect (rules + IsolationForest) -> score -> build alerts -> construct ground
truth -> evaluate -> write artifacts (alerts.json, predictions.csv, metrics.json,
data/data_access_labels.csv, data/user_profile_labels.csv).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import pandas as pd
from sklearn.metrics import (confusion_matrix, f1_score, precision_score,
                             recall_score)

from .core import detector, features, labels, llm, loader, narrative, scoring

BACKEND_DIR = Path(__file__).resolve().parents[1]
ARTIFACTS = BACKEND_DIR / "artifacts"
DATA_DIR = loader.DATA_DIR


def run(write: bool = True) -> dict:
    t0 = time.perf_counter()
    profiles = loader.load_profiles()
    raw = loader.load_logs_raw()

    # Inject canonical eval anomalies, then derive features over the full set.
    raw_aug = labels.inject_canonical(raw, profiles)
    logs = loader.derive_log_features(raw_aug)
    events = loader.join_profiles(logs, profiles)

    # Features + cohort baselines.
    user_feats = features.add_cohort_baselines(features.build_user_features(events))
    events = features.attach_event_features(events, user_feats)

    # Detect + score.
    detected = detector.detect(events)
    scored = scoring.apply_scores(detected)

    # Ground truth + evaluation.
    gt = labels.make_ground_truth(scored)
    merged = scored.merge(gt[["access_id", "is_anomaly", "anomaly_type", "severity"]]
                          .rename(columns={"severity": "gt_severity"}),
                          on="access_id", how="left")
    y_true = merged["is_anomaly"].astype(int)
    y_pred = merged["predicted_anomaly"].astype(int)
    metrics = _metrics(y_true, y_pred, merged)
    metrics["injected_test"] = _injected_test(merged)
    metrics["runtime_sec"] = round(time.perf_counter() - t0, 3)
    metrics["n_events"] = int(len(merged))
    metrics["n_injected"] = int(merged["injected"].sum())

    alerts = narrative.build_alerts(scored)
    stats = _stats(scored, alerts)
    users = _users(scored, user_feats, profiles)

    llm_results, llm_meta = _batch_llm(alerts)
    if llm_meta:
        metrics["llm"] = llm_meta

    if write:
        _write(scored, merged, alerts, metrics, stats, gt, profiles, users, llm_results)

    metrics["n_alerts"] = len(alerts)
    return metrics


def _metrics(y_true, y_pred, merged) -> dict:
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    sev_break = {}
    for sev in ["CRITICAL", "HIGH", "MEDIUM"]:
        sub = merged[merged["gt_severity"] == sev]
        sev_break[sev] = {
            "ground_truth": int(len(sub)),
            "detected": int(sub["predicted_anomaly"].sum()),
        }
    return {
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "severity_recall": sev_break,
    }


def _injected_test(merged: pd.DataFrame) -> dict:
    """Independent test on the hand-designed scenarios: malicious must alert,
    legitimate-but-suspicious exceptions must NOT. This is the credibility anchor
    (it does not share the weak-label rationale used for the 1,200 real events).
    """
    inj = merged[merged["injected"]].copy()
    if inj.empty:
        return {}
    y_true = inj["is_anomaly"].astype(int)   # malicious=1, benign exception=0
    y_pred = inj["predicted_anomaly"].astype(int)
    n_mal = int(y_true.sum())
    return {
        "n_injected": int(len(inj)),
        "n_malicious": n_mal,
        "n_legit_exceptions": int(len(inj) - n_mal),
        "malicious_caught": int(((y_true == 1) & (y_pred == 1)).sum()),
        "exceptions_suppressed": int(((y_true == 0) & (y_pred == 0)).sum()),
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
    }


def _stats(scored: pd.DataFrame, alerts: list[dict]) -> dict:
    sev_counts = scored[scored["predicted_anomaly"]]["severity"].value_counts().to_dict()
    by_dept = (scored[scored["predicted_anomaly"]].groupby("department").size()
               .sort_values(ascending=False).to_dict())
    top_users = (pd.DataFrame(alerts).groupby(["user_id", "username"])["risk_score"]
                 .agg(["max", "count"]).reset_index()
                 .sort_values("max", ascending=False).head(10)
                 .to_dict(orient="records")) if alerts else []
    timeline = (scored[scored["predicted_anomaly"]]
                .assign(day=lambda d: d["timestamp"].dt.date.astype(str))
                .groupby("day").size().reset_index(name="alerts")
                .to_dict(orient="records"))
    return {
        "total_events": int(len(scored)),
        "total_alerts": int(scored["predicted_anomaly"].sum()),
        "severity_counts": {k: int(v) for k, v in sev_counts.items()},
        "alerts_by_department": {k: int(v) for k, v in by_dept.items()},
        "top_risky_users": top_users,
        "timeline": timeline,
    }


def _users(scored: pd.DataFrame, user_feats: pd.DataFrame, profiles: pd.DataFrame) -> list[dict]:
    """Per-user risk summary for the dashboard's user table + drill-down."""
    risk = scored.groupby("user_id").agg(
        events=("access_id", "count"),
        alerts=("predicted_anomaly", "sum"),
        max_risk=("risk_score", "max"),
        avg_risk=("risk_score", "mean"),
    ).reset_index()
    ulabels = labels.user_ground_truth(profiles)
    df = (profiles[["user_id", "username", "department", "job_title", "privilege_level",
                    "days_inactive", "account_age_days", "is_active"]]
          .merge(user_feats[["user_id", "volume_z", "afterhours_z", "sensitive_z", "export_z"]],
                 on="user_id", how="left")
          .merge(risk, on="user_id", how="left")
          .merge(ulabels[["user_id", "account_risk"]], on="user_id", how="left"))
    df = df.fillna({"events": 0, "alerts": 0, "max_risk": 0, "avg_risk": 0,
                    "volume_z": 0, "afterhours_z": 0, "sensitive_z": 0, "export_z": 0,
                    "account_risk": ""})
    for c in ["events", "alerts", "max_risk"]:
        df[c] = df[c].astype(int)
    df["avg_risk"] = df["avg_risk"].round(1)
    for c in ["volume_z", "afterhours_z", "sensitive_z", "export_z"]:
        df[c] = df[c].round(2)
    df = df.sort_values(["max_risk", "alerts"], ascending=False)
    return df.to_dict(orient="records")


def _batch_llm(alerts: list[dict]) -> tuple[dict, dict | None]:
    """Generate LLM narratives for the top-N CRITICAL alerts if LLM is enabled and batch is on.

    Batch is off by default — free-tier models are too slow. Enable with OPENROUTER_BATCH=1.
    On-demand generation is always available via POST /api/alerts/{id}/narrative.

    Returns (access_id -> llm_payload cache dict, meta dict | None).
    """
    if not llm.enabled() or not llm.batch_enabled():
        return {}, None

    topn = llm.topn()
    candidates = [a for a in alerts if a["severity"] == "CRITICAL"][:topn]
    if not candidates:
        candidates = alerts[:topn]

    cache: dict = {}
    total_tokens = 0
    total_cost = 0.0
    n_ok = 0
    model_used = "dry-run-mock"

    for alert in candidates:
        payload = llm.generate(alert)
        if payload:
            cache[alert["access_id"]] = payload
            total_tokens += payload["tokens"]["total"]
            total_cost += payload["est_cost_usd"]
            n_ok += 1
            model_used = payload["model"]

    meta = {
        "n_llm_calls": n_ok,
        "total_tokens": total_tokens,
        "est_cost_usd": round(total_cost, 6),
        "model": model_used,
    }
    return cache, meta


def _write(scored, merged, alerts, metrics, stats, gt, profiles, users, llm_cache: dict | None = None):
    ARTIFACTS.mkdir(exist_ok=True)
    (ARTIFACTS / "alerts.json").write_text(json.dumps(alerts, indent=2))
    if llm_cache:
        (ARTIFACTS / "llm_narratives.json").write_text(json.dumps(llm_cache, indent=2))
    (ARTIFACTS / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (ARTIFACTS / "stats.json").write_text(json.dumps(stats, indent=2))
    (ARTIFACTS / "users.json").write_text(json.dumps(users, indent=2))

    pred_cols = ["access_id", "timestamp", "user_id", "username", "department",
                 "action", "resource", "resource_sensitivity", "time_bucket",
                 "risk_score", "severity", "predicted_anomaly", "rules_fired",
                 "is_anomaly"]
    out = merged[pred_cols].copy()
    out["rules_fired"] = out["rules_fired"].apply(lambda x: "|".join(x))
    out.to_csv(ARTIFACTS / "predictions.csv", index=False)

    # PS-format label files so the provided self-eval script runs unmodified.
    gt.to_csv(DATA_DIR / "data_access_labels.csv", index=False)
    labels.user_ground_truth(profiles).to_csv(
        DATA_DIR / "user_profile_labels.csv", index=False)


def main():
    m = run(write=True)
    print("\n=== PS4 Insider-Threat Detection — pipeline complete ===")
    print(f"events analysed : {m['n_events']}  (injected canonical: {m['n_injected']})")
    print(f"alerts raised   : {m['n_alerts']}")
    print(f"runtime         : {m['runtime_sec']}s  (PS budget: <120s)")
    print(f"precision       : {m['precision']:.2%}  (target >75%)")
    print(f"recall          : {m['recall']:.2%}  (target >70%)")
    print(f"F1              : {m['f1']:.3f}  (target >0.72)")
    print(f"confusion       : {m['confusion_matrix']}")
    print(f"severity recall : {m['severity_recall']}")
    it = m["injected_test"]
    print("\n--- independent scenario test (credibility anchor) ---")
    print(f"malicious caught     : {it['malicious_caught']}/{it['n_malicious']}")
    print(f"exceptions suppressed: {it['exceptions_suppressed']}/{it['n_legit_exceptions']}")
    print(f"scenario F1          : {it['f1']:.3f}")
    if "llm" in m:
        lm = m["llm"]
        print(f"\n--- LLM narratives ({lm['model']}) ---")
        print(f"generated : {lm['n_llm_calls']}  tokens: {lm['total_tokens']}  "
              f"est cost: ${lm['est_cost_usd']:.4f}")


if __name__ == "__main__":
    main()
