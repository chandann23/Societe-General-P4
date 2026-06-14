"""Business-context exceptions: activity that looks risky on the surface but is
legitimate. Recognising these is what separates a usable system from a noisy one
(PS rubric: False-Positive Control / context understood — month-end, on-call,
batch jobs, approved refreshes).

`legitimate_exception(row)` returns a short label when an event is explained by a
known benign pattern, else None. The detector uses it to SUPPRESS score; the
ground-truth builder uses it to OVERRIDE a surface risk condition to benign.
"""
from __future__ import annotations

import calendar

import pandas as pd

# How strongly a recognised exception discounts the risk score in the detector.
SUPPRESSION_FACTOR = 0.30


def _is_month_end(ts: pd.Timestamp) -> bool:
    last = calendar.monthrange(ts.year, ts.month)[1]
    return ts.day >= last - 2 or ts.day <= 2  # close window: last 3 + first 2 days


def legitimate_exception(row) -> str | None:
    dept = row["department"]
    priv = row["privilege_level"]
    action = row["action"]
    res = row["resource"]
    bucket = row["time_bucket"]
    ts = row["timestamp"]

    # E1 — month-end financial close: Finance pulling ledgers around month boundary.
    if dept == "Finance" and action in ("export_data", "sql_query") and _is_month_end(ts):
        return "MONTH_END_CLOSE"

    # E2 — on-call engineer: privileged Eng/IT doing admin/queries off-hours.
    if (dept in ("Engineering", "IT") and priv in ("admin", "power-user")
            and action in ("admin_operation", "sql_query")
            and bucket in ("night", "after_hours", "weekend")):
        return "ON_CALL_DUTY"

    # E3 — scheduled batch: service accounts making API calls at any hour.
    if priv == "service-account" and action == "api_call":
        return "SCHEDULED_BATCH_JOB"

    # E4 — approved warehouse refresh: Eng/Marketing exporting the Data Lake in hours.
    if (action == "export_data" and res == "Data_Lake"
            and dept in ("Engineering", "Marketing") and bucket == "business_hours"):
        return "APPROVED_DW_REFRESH"

    return None
