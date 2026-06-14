import { useState } from "react";
import { api, type SandboxResult } from "@/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Play, Sparkles, Terminal, FileCode, AlertTriangle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export default function Sandbox() {
  const [rawLine, setRawLine] = useState("");
  const [termFiled, setTermFiled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SandboxResult | null>(null);

  const samples = [
    {
      name: "Problem Statement Walkthrough",
      line: "2026-04-15 03:47:12,USR-0847,bob.jones,Export,PII_Database,critical,50000,personal_usb,ABNORMAL",
      term: true,
    },
    {
      name: "Standard Off-Hours Query",
      line: "2026-06-10 23:15:00,USR-1200,alice.smith,sql_query,Customer_Vault,high,150,internal,NORMAL",
      term: false,
    },
    {
      name: "Bulk Database Dump (Exfiltration)",
      line: "2026-07-02 11:30:45,USR-0391,john.doe,Export,GL_System,critical,150000,personal_usb,ABNORMAL",
      term: false,
    },
  ];

  async function handleAnalyze() {
    if (!rawLine.trim()) {
      toast.error("Please enter a raw log line or load a sample.");
      return;
    }
    setLoading(true);
    try {
      const data = await api.analyzeEvent({
        raw_line: rawLine,
        termination_filed: termFiled,
      });
      setResult(data);
      toast.success("Log event analyzed successfully.");
    } catch (err) {
      console.error(err);
      toast.error("Analysis failed. Verify backend service is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell title="Threat Simulator Sandbox">
      <p className="mb-6 text-sm text-muted-foreground">
        Simulate custom data-access events, check dynamic risk scores, triggered rule sets, and recommendations.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left Column: Input Panel */}
        <div className="space-y-6">
          <Card className="rounded-none border border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Terminal className="h-4.5 w-4.5 text-primary" />
                Event Simulator Input
              </CardTitle>
              <CardDescription>
                Input a raw log line (CSV format) or choose a predefined walkthrough scenario.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="raw-log" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Raw Access Log Line
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    Timestamp, User ID, Username, Action, Resource, Sensitivity, Rows, Destination, Label
                  </span>
                </div>
                <textarea
                  id="raw-log"
                  className="flex min-h-[90px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono text-xs leading-relaxed"
                  placeholder="2026-04-15 03:47:12,USR-0847,bob.jones,Export,PII_Database,critical,50000,personal_usb,ABNORMAL"
                  value={rawLine}
                  onChange={(e) => setRawLine(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between rounded-none border border-border/60 bg-muted/30 p-3">
                <div className="space-y-0.5">
                  <label htmlFor="term-switch" className="text-sm font-medium">
                    HR Escalation Flag
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Simulate: User has filed a termination notice recently.
                  </p>
                </div>
                <input
                  id="term-switch"
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary accent-primary cursor-pointer"
                  checked={termFiled}
                  onChange={(e) => setTermFiled(e.target.checked)}
                />
              </div>

              <Button className="w-full" disabled={loading} onClick={handleAnalyze}>
                {loading ? (
                  "Analyzing Event..."
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4 fill-current" />
                    Analyze Log Event
                  </>
                )}
              </Button>

              <div className="pt-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Quick Load Walkthrough Presets
                </span>
                <div className="mt-2 flex flex-col gap-2">
                  {samples.map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setRawLine(s.line);
                        setTermFiled(s.term);
                      }}
                      className="flex items-center justify-between border border-border/80 bg-muted/40 p-2.5 text-left text-xs transition-colors hover:bg-muted/80 hover:text-foreground"
                    >
                      <span className="font-medium">{s.name}</span>
                      <Sparkles className="h-3 w-3 text-primary/75" />
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Output Panel */}
        <div className="space-y-6">
          {!result ? (
            <Card className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-none border border-dashed border-border bg-card p-6 text-center">
              <Terminal className="mb-4 h-12 w-12 text-muted-foreground/40 animate-pulse" />
              <h3 className="text-sm font-semibold text-muted-foreground">Awaiting Input Data</h3>
              <p className="mt-1 text-xs text-muted-foreground/85 max-w-[280px]">
                Input a log line on the left and click analyze to view the parsed detection engine outputs.
              </p>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Parse UI Card */}
              <Card className="rounded-none border border-border bg-card">
                <CardHeader className="border-b border-border pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">Security Alert Analysis</CardTitle>
                    <div
                      className="px-2 py-0.5 text-xs font-bold text-white uppercase"
                      style={{
                        backgroundColor:
                          result.severity === "CRITICAL"
                            ? "var(--severity-critical)"
                            : result.severity === "HIGH"
                              ? "var(--severity-high)"
                              : result.severity === "MEDIUM"
                                ? "var(--severity-medium)"
                                : "var(--severity-low)",
                      }}
                    >
                      {result.severity}
                    </div>
                  </div>
                  <CardDescription className="font-mono text-xs">{result.alert_id}</CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col items-center justify-center border border-border bg-muted/40 p-3 h-20 w-24">
                      <span className="text-2xl font-bold tabular-nums">{result.risk_score}</span>
                      <span className="text-[10px] font-semibold text-muted-foreground">RISK</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      <span className="text-muted-foreground">Subject ID</span>
                      <span className="font-mono">{result.user_id}</span>
                      <span className="text-muted-foreground">Business Context</span>
                      <span className="font-medium">{result.business_context}</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Anomalies Detected
                    </span>
                    <ul className="mt-2 space-y-2">
                      {result.anomalies_detected.map((a, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="border-t border-border pt-4">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Analyst Playbook Recommendation
                    </span>
                    <div className="mt-2 flex items-start gap-2.5 bg-red-500/10 border-l-2 border-red-500 p-3 text-xs font-medium text-foreground">
                      <ShieldAlert className="h-4.5 w-4.5 text-red-500 shrink-0" />
                      <span>{result.recommendation}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* JSON Output Block */}
              <Card className="rounded-none border border-border bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <FileCode className="h-4 w-4" />
                    Expected JSON Output
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto rounded-none border border-border/80 bg-zinc-950 p-4 font-mono text-xs text-zinc-200 leading-relaxed">
                    <code>{JSON.stringify(result, null, 2)}</code>
                  </pre>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
