import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import type { UserProfile, EventItem } from "@/api";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#e53e3e",
  HIGH:     "#dd6b20",
  MEDIUM:   "#d69e2e",
  LOW:      "#718096",
};

function zColor(z: number) {
  return z >= 2 ? "#e53e3e" : z >= 1 ? "#dd6b20" : "#2d7d46";
}

function buildReportHTML(profile: UserProfile, events: EventItem[]): string {
  const now = new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });
  const tenureMonths = Math.round(profile.account_age_days / 30);
  const alertEvents = events.filter((e) => e.predicted_anomaly);
  const topAlerts = [...alertEvents].sort((a, b) => b.risk_score - a.risk_score).slice(0, 20);
  const zStats = [
    { label: "Volume",           z: profile.volume_z },
    { label: "After-hours Rate", z: profile.afterhours_z },
    { label: "Sensitive Access", z: profile.sensitive_z },
    { label: "Export Rate",      z: profile.export_z },
  ];

  const sevSummary = (["CRITICAL", "HIGH", "MEDIUM"] as const)
    .map((s) => {
      const n = alertEvents.filter((e) => e.severity === s).length;
      return n > 0
        ? `<span style="color:${SEV_COLOR[s]};font-weight:700">${n} ${s}</span>`
        : "";
    })
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ") || '<span style="color:#a0aec0">—</span>';

  const alertRate = profile.events > 0
    ? ((profile.alerts / profile.events) * 100).toFixed(0)
    : "0";

  return `
<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a202c;background:#fff;padding:32px 40px;width:900px">

  <!-- Header -->
  <div style="border-bottom:2px solid #e2e8f0;padding-bottom:16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#718096;margin-bottom:4px">Insider Threat Detection · User Risk Report</div>
      <div style="font-size:22px;font-weight:700">${profile.username}</div>
      <div style="font-size:11px;color:#718096;margin-top:3px">${profile.user_id} &nbsp;·&nbsp; ${profile.department} &nbsp;·&nbsp; ${profile.job_title} &nbsp;·&nbsp; ${profile.privilege_level}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:10px;color:#718096">Generated</div>
      <div style="font-size:12px;font-weight:600">${now}</div>
      ${profile.account_risk
        ? `<div style="margin-top:6px;display:inline-block;padding:2px 10px;background:#e53e3e;color:#fff;border-radius:3px;font-size:11px;font-weight:700">⚠ ACCOUNT RISK</div>`
        : `<div style="margin-top:6px;font-size:11px;color:#2d7d46">✓ No account-level risk flag</div>`}
    </div>
  </div>

  <!-- KPI Grid -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
    ${[
      { label: "Max Risk Score",   value: `<span style="color:${profile.max_risk>=82?"#e53e3e":profile.max_risk>=62?"#dd6b20":"#1a202c"};font-size:22px;font-weight:700">${profile.max_risk}</span><span style="font-size:12px;color:#718096">/100</span>`, sub: "Highest single-event score" },
      { label: "Alerts / Events",  value: `<span style="font-size:22px;font-weight:700">${profile.alerts}</span> <span style="font-size:13px;color:#718096">/ ${profile.events}</span>`, sub: `${alertRate}% alert rate` },
      { label: "Account Status",   value: `<span style="font-size:16px;font-weight:700">${profile.is_active ? "Active" : "Inactive"}</span>`, sub: `${profile.days_inactive}d inactive · ~${tenureMonths}mo tenure` },
      { label: "Severity Breakdown", value: sevSummary, sub: `${alertEvents.length} alert events total` },
    ].map(k => `
    <div style="border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#718096;margin-bottom:5px">${k.label}</div>
      <div style="line-height:1.4">${k.value}</div>
      <div style="font-size:10px;color:#a0aec0;margin-top:3px">${k.sub}</div>
    </div>`).join("")}
  </div>

  <!-- Z-score Bars -->
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#4a5568;margin-bottom:10px">Behaviour vs Cohort (Z-scores)</div>
  ${zStats.map(({ label, z }) => `
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:9px">
    <div style="width:140px;font-size:12px;color:#4a5568">${label}</div>
    <div style="flex:1;height:8px;background:#edf2f7;border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${Math.min(100, Math.max(4, ((z + 1) / 4) * 100))}%;background:${zColor(z)};border-radius:4px"></div>
    </div>
    <div style="width:52px;text-align:right;font-size:12px;font-weight:700;font-family:monospace;color:${zColor(z)}">${z >= 0 ? "+" : ""}${z}σ</div>
  </div>`).join("")}

  <!-- Alert Events Table -->
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#4a5568;margin:20px 0 10px">
    Alert Events${topAlerts.length < alertEvents.length ? ` (top ${topAlerts.length} of ${alertEvents.length})` : ` (${alertEvents.length})`}
  </div>
  ${topAlerts.length === 0
    ? `<div style="color:#718096;font-style:italic;font-size:12px">No alert-level events detected for this user.</div>`
    : `<table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr style="background:#f7fafc">
            ${["Risk","Severity","Action","Resource","Sensitivity","Timestamp","Rules Fired"]
              .map(h => `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e2e8f0;font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#718096">${h}</th>`)
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${topAlerts.map((e, i) => `
          <tr style="background:${i % 2 === 0 ? "#fff" : "#f9fafb"}">
            <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">
              <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-weight:700;font-size:11px;font-family:monospace;color:#fff;background:${e.risk_score>=82?"#e53e3e":e.risk_score>=62?"#dd6b20":e.risk_score>=35?"#d69e2e":"#718096"}">${e.risk_score}</span>
            </td>
            <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">
              <span style="display:inline-block;padding:1px 7px;border-radius:3px;font-size:10px;font-weight:700;color:#fff;background:${SEV_COLOR[e.severity]??"#718096"}">${e.severity}</span>
            </td>
            <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-family:monospace">${e.action}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${e.resource}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;color:#718096">${e.resource_sensitivity}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;color:#718096;white-space:nowrap">${new Date(e.timestamp).toLocaleString("en-IN",{dateStyle:"short",timeStyle:"short"})}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:9px;color:#718096">${e.rules_fired || "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>`}

  <!-- Footer -->
  <div style="margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#a0aec0;display:flex;justify-content:space-between">
    <span>Sentinel — Insider Threat Detection · PS4</span>
    <span>${profile.username} · ${profile.user_id}</span>
  </div>
</div>`;
}

export async function downloadUserReport(profile: UserProfile, events: EventItem[]) {
  console.log("Starting PDF generation for:", profile.username);

  // 1. Create an off-screen iframe to isolate the report document from the main app's oklch-containing stylesheets.
  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;top:0;left:-9999px;width:960px;height:1200px;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) {
    console.error("Failed to access iframe document");
    document.body.removeChild(iframe);
    return;
  }

  // Write HTML into the iframe
  iframeDoc.open();
  iframeDoc.write(buildReportHTML(profile, events));
  iframeDoc.close();

  // Give a tiny frame to layout
  await new Promise((resolve) => setTimeout(resolve, 100));

  const target = iframeDoc.body.firstElementChild as HTMLElement;
  console.log("Iframe target mounted. scrollHeight:", target.scrollHeight, "scrollWidth:", target.scrollWidth);

  try {
    // 2. Render target to canvas
    console.log("Calling html2canvas on iframe element...");
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: true,
      width: 960,
      windowWidth: 960,
    });
    console.log("html2canvas finished. Canvas size:", canvas.width, "x", canvas.height);

    // 3. Build A4 PDF and paginate
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const usableW = pageW - margin * 2;
    const imgH = (canvas.height * usableW) / canvas.width;
    const imgData = canvas.toDataURL("image/png");

    let remainingH = imgH;
    let srcY = 0;
    const sliceH = pageH - margin * 2;

    console.log("Generating PDF pages. Total height in mm:", imgH, "Slice height:", sliceH);

    while (remainingH > 0) {
      if (srcY > 0) {
        pdf.addPage();
      }
      pdf.addImage(imgData, "PNG", margin, margin - srcY, usableW, imgH, undefined, "FAST");
      remainingH -= sliceH;
      srcY += sliceH;
    }

    // Filename = username (sanitised)
    const safeName = profile.username.replace(/[^a-z0-9_.-]/gi, "_");
    console.log("Saving PDF as:", `${safeName}.pdf`);
    pdf.save(`${safeName}.pdf`);
  } catch (err) {
    console.error("PDF generation failed with error:", err);
    alert("PDF generation failed. Check console for details.");
  } finally {
    console.log("Removing iframe from DOM");
    document.body.removeChild(iframe);
  }
}
