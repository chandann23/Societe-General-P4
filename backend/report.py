"""Generate a human-readable incident report from the latest alerts.

Matches the PS expected report format (Critical / Medium sections with context
bullets + recommendation). Writes artifacts/incident_report.txt and a 15-alert
JSON sample to artifacts/sample_incident_report.json.

Run:  python report.py   (after python -m app.pipeline)
"""
import json
from pathlib import Path

ART = Path(__file__).resolve().parent / "artifacts"


def _block(a: int, al: dict) -> str:
    lines = [
        f"Alert {a}: {al['action'].upper().replace('_', ' ')} — {al['resource']}",
        "",
        f"User:        {al['username']} ({al['department']}, {al['user_id']})",
        f"Action:      {al['action']} on {al['resource']} ({al['resource_sensitivity']} sensitivity)",
        f"Time:        {al['timestamp'].replace('T', ' ')}  [{al['time_bucket']}]",
        f"Risk Score:  {al['risk_score']}/100  {al['severity']}",
        "",
        "Anomalies detected:",
    ]
    lines += [f"  - {f}" for f in al["anomalies_detected"]]
    lines += ["", f"Context: {al['business_context']}",
              f"Recommendation: {al['recommendation']}", "", "-" * 70]
    return "\n".join(lines)


def main():
    alerts = json.loads((ART / "alerts.json").read_text())
    crit = [a for a in alerts if a["severity"] == "CRITICAL"][:8]
    med = [a for a in alerts if a["severity"] in ("HIGH", "MEDIUM")][:7]

    out = ["=" * 70, "DATA ACCESS ANOMALY REPORT", "=" * 70,
           f"Total alerts: {len(alerts)}  |  Critical: "
           f"{sum(a['severity'] == 'CRITICAL' for a in alerts)}", "",
           "CRITICAL ALERTS (Immediate Investigation)", "=" * 70, ""]
    for i, a in enumerate(crit, 1):
        out.append(_block(i, a))
    out += ["", "HIGH / MEDIUM ALERTS (Review)", "=" * 70, ""]
    for i, a in enumerate(med, len(crit) + 1):
        out.append(_block(i, a))

    text = "\n".join(out)
    (ART / "incident_report.txt").write_text(text)
    (ART / "sample_incident_report.json").write_text(json.dumps(crit + med, indent=2))
    print(text)
    print(f"\nWrote {ART/'incident_report.txt'} and sample_incident_report.json "
          f"({len(crit) + len(med)} alerts).")


if __name__ == "__main__":
    main()
