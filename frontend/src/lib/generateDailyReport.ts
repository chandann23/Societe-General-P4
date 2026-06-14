import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import type { AlertItem } from "@/api";

function buildReportHTML(dateStr: string, alerts: AlertItem[]): string {
  const criticals = alerts.filter(a => a.severity === "CRITICAL");
  const reviews = alerts.filter(a => a.severity === "HIGH" || a.severity === "MEDIUM");

  const now = new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });

  const renderAlertCard = (a: AlertItem, index: number) => {
    const tenureMonths = Math.round(a.account_age_days / 30);
    return `
    <div style="margin-bottom: 24px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <div style="font-weight: 700; font-size: 14px; color: #1a202c;">
          Alert ${index + 1}: ${a.anomalies_detected[0]?.replace(/^\[context: .*\]\s*/, "") || "UNUSUAL ACTIVITY"}
        </div>
        <div style="padding: 2px 8px; border-radius: 3px; font-weight: 700; font-size: 11px; color: #fff; background: ${a.severity === "CRITICAL" ? "#e53e3e" : a.severity === "HIGH" ? "#dd6b20" : "#d69e2e"}">
          ${a.severity} (${a.risk_score}/100)
        </div>
      </div>

      <div style="font-family: monospace; font-size: 12px; color: #4a5568; line-height: 1.6; margin-bottom: 12px;">
        <div><strong>User:</strong> ${a.username} (${a.department}, ${tenureMonths} months tenure)</div>
        <div><strong>Action:</strong> ${a.action}</div>
        <div><strong>Resource:</strong> ${a.resource} (${a.resource_sensitivity} sensitivity)</div>
        <div><strong>Time:</strong> ${new Date(a.timestamp).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })} (${a.time_bucket})</div>
      </div>

      <div style="margin-bottom: 10px;">
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #718096; margin-bottom: 4px;">Context & Anomalies</div>
        <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #2d3748; line-height: 1.5;">
          ${a.anomalies_detected.map(f => `<li style="margin-bottom: 3px;">${f}</li>`).join("")}
        </ul>
      </div>

      <div style="padding: 8px 12px; background: #f7fafc; border-left: 3px solid ${a.severity === "CRITICAL" ? "#e53e3e" : "#dd6b20"}; font-size: 12px; font-weight: 600; color: #2d3748;">
        Recommendation: ${a.recommendation}
      </div>
    </div>
    `;
  };

  return `
<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a202c;background:#fff;padding:40px;width:900px">
  <!-- Header -->
  <div style="border-bottom: 3px double #cbd5e0; padding-bottom: 16px; margin-bottom: 24px;">
    <div style="font-family: monospace; font-size: 20px; font-weight: 700; letter-spacing: 0.05em; color: #1a202c;">
      DATA ACCESS ANOMALY REPORT — ${dateStr}
    </div>
    <div style="font-family: monospace; color: #718096; font-size: 11px; margin-top: 4px;">
      Generated on ${now} &nbsp;·&nbsp; Sentinel Security Information and Event Management (SIEM)
    </div>
  </div>

  <!-- Critical Alerts Section -->
  <div style="margin-bottom: 32px;">
    <div style="font-family: monospace; font-size: 15px; font-weight: 700; text-transform: uppercase; color: #e53e3e; border-bottom: 1px solid #fed7d7; padding-bottom: 6px; margin-bottom: 16px;">
      Critical Alerts (Immediate Investigation required) — ${criticals.length}
    </div>
    ${criticals.length === 0 
      ? `<div style="font-style: italic; color: #718096; padding: 12px;">No critical anomalies detected for this date.</div>` 
      : criticals.map((a, i) => renderAlertCard(a, i)).join("")
    }
  </div>

  <!-- Medium/High Alerts Section -->
  <div style="margin-bottom: 32px;">
    <div style="font-family: monospace; font-size: 15px; font-weight: 700; text-transform: uppercase; color: #dd6b20; border-bottom: 1px solid #feebc8; padding-bottom: 6px; margin-bottom: 16px;">
      Medium & High Alerts (Review required) — ${reviews.length}
    </div>
    ${reviews.length === 0 
      ? `<div style="font-style: italic; color: #718096; padding: 12px;">No medium or high anomalies detected for this date.</div>` 
      : reviews.map((a, i) => renderAlertCard(a, i + criticals.length)).join("")
    }
  </div>

  <!-- Footer -->
  <div style="margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-family: monospace; font-size: 10px; color: #a0aec0; display: flex; justify-content: space-between;">
    <span>CONFIDENTIAL &middot; INTERNAL SECURITY USE ONLY</span>
    <span>Page 1 of 1</span>
  </div>
</div>
  `;
}

export async function downloadDailyReport(dateStr: string, alerts: AlertItem[]) {
  console.log("Starting daily report PDF generation for:", dateStr);

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

  iframeDoc.open();
  iframeDoc.write(buildReportHTML(dateStr, alerts));
  iframeDoc.close();

  await new Promise((resolve) => setTimeout(resolve, 100));

  const target = iframeDoc.body.firstElementChild as HTMLElement;

  try {
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      width: 960,
      windowWidth: 960,
    });

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

    while (remainingH > 0) {
      if (srcY > 0) {
        pdf.addPage();
      }
      pdf.addImage(imgData, "PNG", margin, margin - srcY, usableW, imgH, undefined, "FAST");
      remainingH -= sliceH;
      srcY += sliceH;
    }

    pdf.save(`anomaly-report-${dateStr}.pdf`);
  } catch (err) {
    console.error("Daily report PDF generation failed:", err);
    alert("Failed to generate report. Check console for details.");
  } finally {
    document.body.removeChild(iframe);
  }
}
