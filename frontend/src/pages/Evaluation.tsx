import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, SEV_COLORS, type MetricsResponse } from "@/api";
import { KpiCard, PageSkeleton } from "@/components/common";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CHART_TOOLTIP_STYLE = {
  background: "var(--foreground)",
  border: "none",
  borderRadius: 0,
  color: "var(--background)",
  fontSize: 12,
  padding: "6px 10px",
  fontFamily: "var(--font-sans)",
};

const AXIS_STYLE = { fill: "var(--muted-foreground)", fontSize: 11 };

export default function Evaluation() {
  const [m, setM] = useState<MetricsResponse | null>(null);

  useEffect(() => {
    api.metrics().then(setM);
  }, []);

  if (!m) return <PageSkeleton />;

  const cm = m.confusion_matrix;
  const it = m.injected_test;
  const sevData = Object.entries(m.severity_recall).map(([k, v]) => ({
    name: k,
    ground_truth: v.ground_truth,
    detected: v.detected,
  }));

  return (
    <AppShell title="Evaluation">
      <p className="mb-4 text-sm text-muted-foreground">
        Detection performance against the constructed ground-truth label set.
      </p>

      <Card className="mb-4 bg-muted/40">
        <CardContent className="pt-4 text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Methodology &amp; honesty note.</span> The
          shipped dataset includes no label files, so ground truth is{" "}
          <span className="font-semibold text-foreground">constructed</span> (canonical injected
          scenarios + strict independent rule labels). Full-set numbers are therefore optimistic vs
          a true human-labelled hold-out. The{" "}
          <span className="font-semibold text-foreground">independent scenario test</span> below —
          does the system catch textbook malicious activity while suppressing
          legitimate-but-suspicious activity — is the credibility anchor.
        </CardContent>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Precision"
          value={`${(m.precision * 100).toFixed(1)}%`}
          sub="target > 75%"
          tone="good"
        />
        <KpiCard
          label="Recall"
          value={`${(m.recall * 100).toFixed(1)}%`}
          sub="target > 70%"
          tone="good"
        />
        <KpiCard
          label="F1 Score"
          value={m.f1.toFixed(3)}
          sub="target > 0.72"
          tone="good"
        />
        <KpiCard
          label="Runtime"
          value={`${m.runtime_sec}s`}
          sub={`${m.n_events} events · budget <120s`}
          tone="good"
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Confusion Matrix</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
                <div className="text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {cm.tp}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">True Positive</div>
              </div>
              <div className="border border-red-500/30 bg-red-500/10 p-4 text-center">
                <div className="text-3xl font-bold tabular-nums text-red-500">{cm.fp}</div>
                <div className="mt-1 text-xs text-muted-foreground">False Positive</div>
              </div>
              <div className="border border-orange-500/30 bg-orange-500/10 p-4 text-center">
                <div className="text-3xl font-bold tabular-nums text-orange-500">{cm.fn}</div>
                <div className="mt-1 text-xs text-muted-foreground">False Negative</div>
              </div>
              <div className="border border-border bg-muted/40 p-4 text-center">
                <div className="text-3xl font-bold tabular-nums text-muted-foreground">
                  {cm.tn}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">True Negative</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Independent Scenario Test (anchor)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              <span className="text-muted-foreground">Malicious caught</span>
              <span>
                <span className="font-semibold tabular-nums">{it.malicious_caught}</span>
                <span className="text-muted-foreground"> / {it.n_malicious}</span>
              </span>
              <span className="text-muted-foreground">Exceptions suppressed</span>
              <span>
                <span className="font-semibold tabular-nums">{it.exceptions_suppressed}</span>
                <span className="text-muted-foreground"> / {it.n_legit_exceptions}</span>
              </span>
              <span className="text-muted-foreground">Scenario F1</span>
              <span className="font-semibold tabular-nums">{it.f1.toFixed(3)}</span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Tests detection of hand-designed insider-threat scenarios against
              legitimate-but-suspicious activity (month-end close, on-call, batch jobs). This does
              not share the weak-label rationale used for the real events, so it is a genuine
              out-of-sample check of discrimination.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recall by Severity</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sevData} margin={{ left: -10, right: 10 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={AXIS_STYLE} />
              <YAxis tick={AXIS_STYLE} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "color-mix(in oklch, var(--foreground) 8%, transparent)" }} />
              <Bar dataKey="ground_truth" fill="var(--muted-foreground)" name="Ground truth" />
              <Bar dataKey="detected" name="Detected">
                {sevData.map((d) => (
                  <Cell key={d.name} fill={SEV_COLORS[d.name] || "var(--primary)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </AppShell>
  );
}
