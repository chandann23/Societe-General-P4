"""Blend rule base-score + model score into a 0-100 risk score and severity."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config


def _severity(score: float) -> str:
    for name, floor in config.SEVERITY_BANDS:
        if score >= floor:
            return name
    return "LOW"


def apply_scores(detected: pd.DataFrame) -> pd.DataFrame:
    """Compute final risk_score, severity and predicted_anomaly columns."""
    df = detected.copy()
    # Model only escalates clear outliers: contributes 0 until MODEL_BONUS_FLOOR,
    # then scales up to MODEL_BONUS_MAX. This protects precision.
    norm = (df["model_score"] - config.MODEL_BONUS_FLOOR).clip(lower=0)
    norm = norm / max(1e-9, (1.0 - config.MODEL_BONUS_FLOOR))
    model_bonus = norm * config.MODEL_BONUS_MAX
    # Don't let the model re-inflate an event we've explained as legitimate context.
    if "context_exception" in df.columns:
        model_bonus = model_bonus.where(df["context_exception"].eq(""), 0.0)

    df["risk_score"] = np.minimum(100, df["base_score"] + model_bonus).round().astype(int)
    df["severity"] = df["risk_score"].apply(_severity)
    df["predicted_anomaly"] = df["risk_score"] >= config.ALERT_THRESHOLD
    return df


def recommendation(severity: str) -> str:
    return {
        "CRITICAL": "BLOCK + INVESTIGATE IMMEDIATELY",
        "HIGH": "ESCALATE for security review within 24h",
        "MEDIUM": "REVIEW in next analyst triage cycle",
        "LOW": "MONITOR",
    }.get(severity, "MONITOR")
