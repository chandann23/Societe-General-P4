"""Feature engineering + cohort baselines.

Per-user history is sparse (~12 events/user over a year), so robust per-user
statistical baselines are unreliable. We therefore build baselines at the
(department, privilege_level) COHORT level and express each user's behaviour as a
Z-score against their cohort. This Z-score is our stand-in for the missing
`rowcount`/volume signal (a "bulk" user does far more than their peers).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config


def build_user_features(events: pd.DataFrame) -> pd.DataFrame:
    """Aggregate per-user behavioural features from the event log."""
    g = events.groupby("user_id")
    feats = pd.DataFrame({
        "event_count": g.size(),
        "distinct_resources": g["resource"].nunique(),
        "distinct_ips": g["source_ip"].nunique(),
        "export_count": g["action"].apply(lambda s: (s == "export_data").sum()),
        "admin_op_count": g["action"].apply(lambda s: (s == "admin_operation").sum()),
        "sensitive_count": g["resource_sensitivity"].apply(lambda s: (s == "high").sum()),
        "afterhours_count": g["time_bucket"].apply(lambda s: s.isin(config.OFF_HOURS_BUCKETS).sum()),
        "failure_count": g["status"].apply(lambda s: (s == "failure").sum()),
        "active_days": g["date"].nunique(),
    })
    feats["export_rate"] = feats["export_count"] / feats["event_count"]
    feats["afterhours_rate"] = feats["afterhours_count"] / feats["event_count"]
    feats["sensitive_rate"] = feats["sensitive_count"] / feats["event_count"]
    feats["events_per_active_day"] = feats["event_count"] / feats["active_days"].clip(lower=1)
    # Static profile attributes (one row per user).
    static = events.groupby("user_id").agg(
        department=("department", "first"),
        privilege_level=("privilege_level", "first"),
        days_inactive=("days_inactive", "first"),
        account_age_days=("account_age_days", "first"),
    )
    return feats.join(static).reset_index()


def add_cohort_baselines(user_feats: pd.DataFrame) -> pd.DataFrame:
    """Z-score each user's volume / after-hours / sensitivity vs their cohort."""
    uf = user_feats.copy()
    cohort_keys = ["department", "privilege_level"]
    for col, zname in [
        ("event_count", "volume_z"),
        ("afterhours_rate", "afterhours_z"),
        ("sensitive_rate", "sensitive_z"),
        ("export_rate", "export_z"),
    ]:
        grp = uf.groupby(cohort_keys)[col]
        mean = grp.transform("mean")
        std = grp.transform("std").replace(0, np.nan)
        # Fall back to global std when a cohort is too small/uniform.
        std = std.fillna(uf[col].std() or 1.0)
        uf[zname] = ((uf[col] - mean) / std).fillna(0.0)
    return uf


def attach_event_features(events: pd.DataFrame, user_feats: pd.DataFrame) -> pd.DataFrame:
    """Join per-user features onto each event + add per-event derived columns."""
    ucols = [
        "user_id", "event_count", "export_rate", "afterhours_rate", "sensitive_rate",
        "distinct_resources", "failure_count", "volume_z", "afterhours_z",
        "sensitive_z", "export_z",
    ]
    df = events.merge(user_feats[ucols], on="user_id", how="left")

    # First-time access to a resource for this user (novelty proxy for
    # "first-time access to table" in the PS example).
    df = df.sort_values("timestamp").reset_index(drop=True)
    df["first_time_resource"] = ~df.duplicated(subset=["user_id", "resource"], keep="first")

    df["sensitivity_ord"] = df["resource_sensitivity"].map(config.SENSITIVITY_ORD).fillna(0)
    df["priv_ord"] = df["privilege_level"].map(config.PRIVILEGE_ORD).fillna(0)
    df["is_export"] = (df["action"] == "export_data").astype(int)
    df["is_admin_op"] = (df["action"] == "admin_operation").astype(int)
    df["is_failure"] = (df["status"] == "failure").astype(int)
    df["is_offhours"] = df["time_bucket"].isin(config.OFF_HOURS_BUCKETS).astype(int)
    df["is_night"] = (df["time_bucket"] == "night").astype(int)
    df["is_sensitive_res"] = df["resource"].isin(config.SENSITIVE_RESOURCES).astype(int)
    return df


def model_feature_matrix(events: pd.DataFrame) -> np.ndarray:
    """Numeric matrix for IsolationForest (unsupervised outlier detection)."""
    cols = [
        "hour", "is_night", "is_offhours", "sensitivity_ord", "is_export",
        "is_admin_op", "is_failure", "is_sensitive_res", "priv_ord",
        "event_count", "export_rate", "afterhours_rate", "sensitive_rate",
        "distinct_resources", "volume_z", "afterhours_z", "sensitive_z",
        "days_inactive", "account_age_days",
    ]
    return events[cols].fillna(0.0).to_numpy(dtype=float)
