"""Synthetic labeled evaluation set.

WHY THIS EXISTS: the shipped dataset ships NO label files (the promised
`data_access_labels.csv` is absent), so there is no out-of-the-box ground truth.
To report precision/recall/F1 we construct one in two parts:

1. INJECTED canonical insider-threat events — unambiguous, textbook scenarios
   (off-hours bulk export of PII, 3 AM admin ops, salary snooping, credential
   stuffing bursts, stale-account exfil). These are definitively is_anomaly=1.

2. WEAK LABELS for the real events, from an INDEPENDENT domain rationale using
   strict, hard conditions — deliberately different in form from the detector's
   graded risk score (which blends rule points + an IsolationForest component and
   uses a tuned threshold). Genuinely ambiguous events are left as 0.

LIMITATION (disclosed in README): because the label rationale and the detector
share domain knowledge, absolute metrics are optimistic versus a true held-out
human-labeled set. We report them as a sanity check, not ground truth.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config, context

RNG = np.random.default_rng(7)
_IPS = [f"203.0.113.{i}" for i in range(2, 60)]  # "external-looking" addresses


def _pick_users(profiles: pd.DataFrame, n: int, **pred) -> list:
    """Pick n user_ids matching simple equality predicates (with fallback)."""
    df = profiles
    for col, val in pred.items():
        df = df[df[col] == val]
    if len(df) == 0:
        df = profiles
    n = min(n, len(df))
    return df.sample(n, random_state=int(RNG.integers(1e6)))["user_id"].tolist()


def _ts(month_range=(4, 13), night=True, weekend=False) -> pd.Timestamp:
    """Random timestamp within the data span, biased to off-hours/weekend."""
    year = 2025
    month = int(RNG.integers(*month_range))
    if month > 12:
        month -= 12
        year = 2026
    day = int(RNG.integers(1, 28))
    base = pd.Timestamp(year=year, month=month, day=day)
    if weekend:
        base += pd.Timedelta(days=(5 - base.dayofweek) % 7)  # push to Saturday
    hour = int(RNG.integers(0, 5)) if night else int(RNG.integers(9, 17))
    return base + pd.Timedelta(hours=hour, minutes=int(RNG.integers(0, 60)))


def inject_canonical(raw_logs: pd.DataFrame, profiles: pd.DataFrame) -> pd.DataFrame:
    """Append ~35 canonical insider-threat events (flagged injected=True)."""
    rows = []

    def add(user_id, action, resource, sens, scenario, night=True, weekend=False,
            status="success", benign=False, ts=None):
        uname = profiles.loc[profiles.user_id == user_id, "username"]
        rows.append({
            "timestamp": ts if ts is not None else _ts(night=night, weekend=weekend),
            "user_id": user_id,
            "username": uname.iloc[0] if len(uname) else user_id,
            "action": action,
            "resource": resource,
            "resource_sensitivity": sens,
            "status": status,
            "source_ip": RNG.choice(_IPS) if not benign else f"192.168.{RNG.integers(1,255)}.{RNG.integers(1,255)}",
            "time_classification": "business_hours",  # intentionally mislabeled
            "injected": True,
            "scenario": scenario,
            "benign": benign,
        })

    def _monthend_ts():
        m = int(RNG.integers(5, 13))
        y = 2025
        return pd.Timestamp(year=y, month=m, day=30 if m != 6 else 30,
                            hour=int(RNG.integers(17, 21)), minute=int(RNG.integers(0, 60)))

    # 1) Off-hours bulk export of PII by junior/standard users (exfil)
    for u in _pick_users(profiles, 6, privilege_level="user"):
        add(u, "export_data", RNG.choice(["Customer_Vault", "HRIS"]), "high",
            "bulk_pii_export_offhours")
    # 2) 3 AM admin operations by non-privileged accounts (priv escalation)
    for u in _pick_users(profiles, 5, privilege_level="user"):
        add(u, "admin_operation", RNG.choice(["Admin_Console", "SIEM"]), "high",
            "offhours_admin_escalation")
    # 3) Salary snooping — non-HR user hitting HRIS
    non_hr = profiles[~profiles.department.isin(config.RESOURCE_OWNER_DEPARTMENTS["HRIS"])]
    for u in non_hr.sample(min(6, len(non_hr)), random_state=3)["user_id"]:
        add(u, "sql_query", "HRIS", "high", "cross_dept_salary_snoop", night=False)
    # 4) Credential-stuffing burst: 4 failed logins each for 2 users
    for u in _pick_users(profiles, 2, privilege_level="user"):
        for _ in range(4):
            add(u, "login", "Admin_Console", "high", "failed_login_burst",
                status="failure")
    # 5) Stale privileged account exfil
    stale = profiles[(profiles.days_inactive >= config.VERY_STALE_INACTIVE_DAYS)
                     & (profiles.privilege_level.isin(config.PRIVILEGED_LEVELS))]
    for u in stale.sample(min(4, len(stale)), random_state=5)["user_id"]:
        add(u, "export_data", "GL_System", "high", "stale_privileged_exfil")
    # 6) Weekend data-lake bulk pull
    for u in _pick_users(profiles, 3, privilege_level="user"):
        add(u, "export_data", "Data_Lake", "high", "weekend_bulk_pull", weekend=True)

    # --- BENIGN exceptions: look suspicious, but are legitimate (must NOT alert) ---
    # B1) Finance month-end ledger pulls (off-hours export of high-sensitivity data)
    fin = _pick_users(profiles, 6, department="Finance")
    for u in fin:
        add(u, "export_data", "GL_System", "high", "month_end_close",
            benign=True, ts=_monthend_ts())
    # B2) On-call engineers doing night-time admin ops
    eng = profiles[(profiles.department.isin(["Engineering", "IT"]))
                   & (profiles.privilege_level.isin(["admin", "power-user"]))]
    for u in eng.sample(min(6, len(eng)), random_state=11)["user_id"]:
        add(u, "admin_operation", "PROD_DB", "high", "oncall_duty", night=True, benign=True)
    # B3) Service-account scheduled batch API jobs at night
    svc = profiles[profiles.privilege_level == "service-account"]
    for u in svc.sample(min(5, len(svc)), random_state=13)["user_id"]:
        add(u, "api_call", "Data_Lake", "high", "scheduled_batch", night=True, benign=True)
    # B4) Approved warehouse refresh (in-hours Data Lake export by Eng/Marketing)
    dw = profiles[profiles.department.isin(["Engineering", "Marketing"])]
    for u in dw.sample(min(5, len(dw)), random_state=17)["user_id"]:
        add(u, "export_data", "Data_Lake", "high", "approved_dw_refresh",
            night=False, benign=True)

    injected = pd.DataFrame(rows)
    combined = pd.concat([raw_logs, injected], ignore_index=True)
    combined["benign"] = combined["benign"].fillna(False)
    return combined


def make_ground_truth(events: pd.DataFrame) -> pd.DataFrame:
    """Independent strict-rule ground truth for every event (real + injected).

    Context exceptions (month-end, on-call, batch, approved refresh) OVERRIDE
    surface risk conditions to benign — this is the discriminating signal the
    detector must also learn, and where realistic FP/FN come from.
    """
    df = events
    high = df["resource_sensitivity"] == "high"
    offhours = df["time_bucket"].isin(config.OFF_HOURS_BUCKETS)
    sensitive_res = df["resource"].isin(config.SENSITIVE_RESOURCES)
    pii = df["resource"].isin(config.PII_RESOURCES)
    is_user = ~df["privilege_level"].isin(config.PRIVILEGED_LEVELS)

    owner_ok = df.apply(
        lambda r: r["department"] in config.RESOURCE_OWNER_DEPARTMENTS.get(r["resource"], {r["department"]}),
        axis=1,
    )
    is_exception = df.apply(lambda r: context.legitimate_exception(r) is not None, axis=1)
    exc_label = df.apply(lambda r: context.legitimate_exception(r) or "", axis=1)
    benign_inj = df.get("benign", pd.Series(False, index=df.index)).fillna(False).astype(bool)
    injected = df["injected"].astype(bool)
    malicious_inj = injected & (~benign_inj)
    legit = is_exception | benign_inj  # legitimate despite surface risk

    conds = {
        "DATA_EXFILTRATION": (df["action"] == "export_data") & (high | pii),
        "OFF_HOURS_SENSITIVE": offhours & high & sensitive_res,
        "PRIVILEGE_ESCALATION": (df["action"] == "admin_operation") & is_user,
        "CROSS_DEPARTMENT_ACCESS": sensitive_res & (~owner_ok) & (df["department"] != "UNKNOWN"),
        "VOLUME_ANOMALY": df["volume_z"] >= 2.5,
        "CREDENTIAL_ABUSE": (df["status"] == "failure") & (df["failure_count"] >= 3),
        "STALE_ACCOUNT_ABUSE": (df["days_inactive"] >= config.VERY_STALE_INACTIVE_DAYS)
                                & (df["action"].isin(["export_data", "admin_operation"])),
    }
    # Conditions only count for non-legitimate events.
    conds = {k: (m & (~legit)) for k, m in conds.items()}

    is_anom = malicious_inj.copy()
    anomaly_type = np.where(malicious_inj, df["scenario"], "")
    severity = np.where(malicious_inj, "CRITICAL", "")
    for name, mask in conds.items():
        newly = mask & (~is_anom)
        anomaly_type = np.where(newly, name, anomaly_type)
        is_anom = is_anom | mask

    # Legitimate events are explicitly benign and labelled with their context.
    anomaly_type = np.where(legit, "LEGITIMATE_" + np.where(benign_inj, df["scenario"], exc_label),
                            anomaly_type)

    fired_count = sum(m.astype(int) for m in conds.values()) + malicious_inj.astype(int)
    severity = np.where(is_anom & (severity == ""),
                        np.where(fired_count >= 3, "CRITICAL",
                                 np.where(fired_count == 2, "HIGH", "MEDIUM")),
                        severity)

    out = pd.DataFrame({
        "access_id": df["access_id"],
        "user_id": df["user_id"],
        "timestamp": df["timestamp"],
        "is_anomaly": is_anom.astype(bool).values,
        "anomaly_type": anomaly_type,
        "severity": severity,
        "injected": df["injected"].values,
    })
    def _explain(r):
        if r["injected"]:
            kind = "malicious" if r["is_anomaly"] else "legitimate-but-suspicious"
            return f"Injected {kind} scenario '{r['anomaly_type']}'"
        if r["is_anomaly"]:
            return f"Matched {r['anomaly_type']} risk condition"
        if str(r["anomaly_type"]).startswith("LEGITIMATE_"):
            return f"Benign — explained by context ({r['anomaly_type']})"
        return "No risk condition met"

    out["explanation"] = out.apply(_explain, axis=1)
    return out


def user_ground_truth(profiles: pd.DataFrame) -> pd.DataFrame:
    """User-level risk labels (secondary): stale-privileged / over-privileged."""
    df = profiles
    stale_priv = (df["days_inactive"] >= config.VERY_STALE_INACTIVE_DAYS) & \
                 (df["privilege_level"].isin(config.PRIVILEGED_LEVELS))
    over_priv = (df["privilege_level"] == "admin") & (df["account_age_days"] < 90)
    is_anom = stale_priv | over_priv
    return pd.DataFrame({
        "user_id": df["user_id"],
        "is_anomaly": is_anom.astype(bool),
        "account_risk": np.where(stale_priv, "STALE_PRIVILEGED",
                          np.where(over_priv, "OVER_PRIVILEGED_NEW", "")),
        "severity": np.where(is_anom, "HIGH", ""),
    })
