"""Shared domain constants for the insider-threat detector.

NOTE ON DATA REALITY: the shipped CSVs do NOT contain `rowcount`, `destination`,
`data_asset`, `tenure_months`, etc. that the problem statement's images describe.
Volume and exfil-destination are therefore *inferred* from what we actually have
(action + resource + per-user/cohort frequency). See README for the full mapping.
"""

# ---- Resource taxonomy -------------------------------------------------------
# Resources that hold sensitive / high-value data. Access to these is weighted.
SENSITIVE_RESOURCES = {
    "Customer_Vault",   # customer PII
    "HRIS",             # HR / salary data
    "GL_System",        # financial ledger
    "SIEM",             # security telemetry
    "PROD_DB",          # production database
    "Admin_Console",    # privileged control plane
}

# Resources that are effectively an exfiltration channel when data is exported.
EXFIL_CHANNELS = {"Email_Archive", "File_Share"}

# PII-bearing resources (extra weight — breach of these is most damaging).
PII_RESOURCES = {"Customer_Vault", "HRIS"}

# Which departments are legitimately expected to touch each sensitive resource.
# Anything outside this set accessing the resource is a cross-department signal.
RESOURCE_OWNER_DEPARTMENTS = {
    "HRIS": {"HR", "Compliance", "Legal", "Executive"},
    "GL_System": {"Finance", "Executive", "Compliance"},
    "Customer_Vault": {"Sales", "Support", "Marketing", "Compliance"},
    "SIEM": {"Security", "IT"},
    "Admin_Console": {"IT", "Engineering", "Security"},
    "PROD_DB": {"Engineering", "IT"},
}

# ---- Ordinal encodings -------------------------------------------------------
SENSITIVITY_ORD = {"low": 0, "medium": 1, "high": 2}
PRIVILEGE_ORD = {"user": 0, "power-user": 1, "service-account": 2, "admin": 3}
PRIVILEGED_LEVELS = {"admin", "power-user", "service-account"}

# Time buckets considered "outside normal business activity".
OFF_HOURS_BUCKETS = {"night", "after_hours", "weekend"}

# ---- Detector rule weights (points 0-100 scale) ------------------------------
# Each weight is for a single isolated signal. When multiple rules fire, scores
# are combined with diminishing returns (see detector.py) so that 2 rules produce
# a HIGH alert, not an instant CRITICAL.
RULE_WEIGHTS = {
    "OFF_HOURS_NIGHT": 38,
    "OFF_HOURS_AFTER": 36,
    "OFF_HOURS_WEEKEND": 36,   # raised: weekend+sensitive is a real signal; must clear threshold
    "SENSITIVE_EXPORT": 40,
    "PII_EXPORT_BONUS": 8,
    "VOLUME_SPIKE_3": 42,
    "VOLUME_SPIKE_25": 36,
    "VOLUME_SPIKE_2": 26,
    "VOLUME_SPIKE_15": 14,
    "PRIV_ESCALATION": 40,
    "FIRST_TIME_SENSITIVE": 12,
    "CROSS_DEPT_SENSITIVE": 36, # raised: single cross-dept access must clear threshold on its own
    "FAILURE_EVENT": 6,
    "FAILURE_BURST": 38,   # raised: burst alone must clear threshold (6 + 38×0.7 = 32.6; 38 alone = 38 > 35)
    "STALE_PRIVILEGED_ACTIVE": 38,
    "SERVICE_ACCT_INTERACTIVE": 14,
}

# Diminishing-returns factor: each additional fired rule contributes this fraction
# of the previous one's points (sorted highest first).
RULE_STACK_DECAY = 0.70

# Blend: rules drive interpretability, IsolationForest escalates clear outliers.
MODEL_BONUS_MAX = 12.0      # max points the unsupervised model can add
MODEL_BONUS_FLOOR = 0.65    # only strong outliers above this threshold get a boost

# ---- Severity thresholds -----------------------------------------------------
# MEDIUM/ALERT start at 35 so single-signal events are still caught.
# HIGH requires 2 meaningful signals; CRITICAL requires 3+.
SEVERITY_BANDS = [("CRITICAL", 82), ("HIGH", 62), ("MEDIUM", 35), ("LOW", 0)]
ALERT_THRESHOLD = 35        # events at/above this risk become alerts

# Profile thresholds
STALE_INACTIVE_DAYS = 45
VERY_STALE_INACTIVE_DAYS = 60
