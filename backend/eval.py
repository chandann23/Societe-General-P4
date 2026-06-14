"""Standalone evaluation — mirrors the PS-provided self-evaluation snippet.

Runs against the generated `data/data_access_labels.csv` (produced by the
pipeline) joined to `artifacts/predictions.csv`. Run the pipeline first:

    python -m app.pipeline
    python eval.py
"""
from pathlib import Path

import pandas as pd
from sklearn.metrics import f1_score, precision_score, recall_score

BACKEND = Path(__file__).resolve().parent
DATA = BACKEND.parent / "data"   # repo-root data/ (shared with the pipeline)
ART = BACKEND / "artifacts"


def main():
    labels = pd.read_csv(DATA / "data_access_labels.csv")
    preds = pd.read_csv(ART / "predictions.csv")[["access_id", "predicted_anomaly"]]
    labels = labels.merge(preds, on="access_id", how="left")
    labels["predicted_anomaly"] = labels["predicted_anomaly"].fillna(False)

    y_true = labels["is_anomaly"].astype(int)
    y_pred = labels["predicted_anomaly"].astype(int)

    print("=== PS4 self-evaluation (full constructed label set) ===")
    print(f"Precision: {precision_score(y_true, y_pred):.2%}")
    print(f"Recall:    {recall_score(y_true, y_pred):.2%}")
    print(f"F1 Score:  {f1_score(y_true, y_pred):.2f}")

    print("\nSeverity breakdown (ground truth):")
    for sev in ["CRITICAL", "HIGH", "MEDIUM"]:
        subset = labels[labels["severity"] == sev]
        caught = subset["predicted_anomaly"].astype(bool).sum()
        print(f"  {sev:8s}: {len(subset):4d} in ground truth, {caught:4d} detected")

    print("\nNOTE: labels are constructed (the dataset shipped none). See README — "
          "the injected-scenario test in metrics.json is the independent anchor.")


if __name__ == "__main__":
    main()
