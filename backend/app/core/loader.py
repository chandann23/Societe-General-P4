"""Load + clean the access logs and user profiles.

Key cleaning step: the shipped `time_classification` column is noisy/inconsistent
(e.g. a 09:18 event tagged "night" — the timezone messiness the PS calls out). We
ignore it for logic and instead recompute a trustworthy `time_bucket` from the raw
timestamp, while keeping the original so we can surface the mismatch as a signal.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parents[3] / "data"

LOG_COLUMNS = [
    "timestamp", "user_id", "username", "action", "resource",
    "resource_sensitivity", "status", "source_ip", "time_classification",
]


def _time_bucket(ts: pd.Timestamp) -> str:
    """Recompute a reliable time bucket from the timestamp itself."""
    if ts.dayofweek >= 5:  # Sat/Sun
        return "weekend"
    h = ts.hour
    if 0 <= h < 6:
        return "night"
    if 8 <= h < 18:
        return "business_hours"
    return "after_hours"  # 06-08 and 18-24


def load_profiles(data_dir: Path | None = None) -> pd.DataFrame:
    data_dir = data_dir or DATA_DIR
    df = pd.read_csv(data_dir / "user_profiles.csv")
    df["last_login"] = pd.to_datetime(df["last_login"], errors="coerce")
    df["hire_date"] = pd.to_datetime(df["hire_date"], errors="coerce")
    now = df["last_login"].max()
    df["account_age_days"] = (now - df["hire_date"]).dt.days.clip(lower=0)
    df["days_inactive"] = pd.to_numeric(df["days_inactive"], errors="coerce").fillna(0)
    df["is_active"] = df["is_active"].astype(str).str.lower().eq("true")
    df["privilege_level"] = df["privilege_level"].fillna("user")
    df["job_title"] = df["job_title"].fillna("Unknown")
    df["systems_set"] = (
        df["systems_access"].fillna("").str.split("|").apply(lambda xs: {s for s in xs if s})
    )
    return df


def load_logs_raw(data_dir: Path | None = None) -> pd.DataFrame:
    """Read + parse raw logs (no derived features yet, so rows can be injected)."""
    data_dir = data_dir or DATA_DIR
    df = pd.read_csv(data_dir / "data_access_logs.csv")
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df = df.dropna(subset=["timestamp"]).reset_index(drop=True)
    df["resource_sensitivity"] = df["resource_sensitivity"].fillna("low").str.lower()
    df["status"] = df["status"].fillna("success").str.lower()
    df["injected"] = False
    df["scenario"] = ""
    return df


def derive_log_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add access_id + time-derived columns. Call AFTER any row injection."""
    df = df.sort_values("timestamp").reset_index(drop=True)
    df["access_id"] = ["ACC-%06d" % i for i in range(len(df))]
    df["hour"] = df["timestamp"].dt.hour
    df["dow"] = df["timestamp"].dt.dayofweek
    df["date"] = df["timestamp"].dt.date
    df["time_bucket"] = df["timestamp"].apply(_time_bucket)
    df["time_label_mismatch"] = df["time_classification"].fillna("") != df["time_bucket"]
    return df


def join_profiles(logs: pd.DataFrame, profiles: pd.DataFrame) -> pd.DataFrame:
    pcols = [
        "user_id", "department", "job_title", "privilege_level",
        "days_inactive", "account_age_days", "is_active", "systems_set",
    ]
    events = logs.merge(profiles[pcols], on="user_id", how="left")
    events["department"] = events["department"].fillna("UNKNOWN")
    events["job_title"] = events["job_title"].fillna("Unknown")
    events["privilege_level"] = events["privilege_level"].fillna("user")
    events["days_inactive"] = events["days_inactive"].fillna(0)
    events["account_age_days"] = events["account_age_days"].fillna(0)
    events["systems_set"] = events["systems_set"].apply(
        lambda x: x if isinstance(x, set) else set()
    )
    return events


def load_logs(data_dir: Path | None = None) -> pd.DataFrame:
    """Convenience: raw logs + derived features (no injection)."""
    return derive_log_features(load_logs_raw(data_dir))


def load_joined(data_dir: Path | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (events, profiles) with profile fields joined onto each event."""
    profiles = load_profiles(data_dir)
    logs = load_logs(data_dir)
    return join_profiles(logs, profiles), profiles
