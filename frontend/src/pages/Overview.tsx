import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import {
  api,
  SEV_COLORS,
  type MetricsResponse,
  type StatsResponse,
  type UserSummary,
} from "@/api";
import { KpiCard, PageSkeleton } from "@/components/common";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

// Metric definitions for the cluster chart axes
const METRICS = [
  { key: "volume_z",     label: "Volume σ",       desc: "activity volume vs cohort" },
  { key: "afterhours_z", label: "Off-hours σ",     desc: "off-hours rate vs cohort" },
  { key: "max_risk",     label: "Max Risk",         desc: "highest risk score (0–100)" },
  { key: "alerts",       label: "Alert Count",      desc: "number of raised alerts" },
  { key: "events",       label: "Event Count",      desc: "total access events" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

function userColor(u: UserSummary) {
  return u.max_risk >= 82
    ? SEV_COLORS.CRITICAL
    : u.max_risk >= 62
      ? SEV_COLORS.HIGH
      : u.max_risk >= 35
        ? SEV_COLORS.MEDIUM
        : SEV_COLORS.LOW;
}

function ClusterTooltip({
  active,
  payload,
  xKey,
  yKey,
  onNavigate,
}: TooltipProps<number, string> & {
  xKey: MetricKey;
  yKey: MetricKey;
  onNavigate: (id: string) => void;
}) {
  if (!active || !payload?.length) return null;
  const u = payload[0].payload as UserSummary;
  const color = userColor(u);
  const xMeta = METRICS.find((m) => m.key === xKey)!;
  const yMeta = METRICS.find((m) => m.key === yKey)!;

  return (
    <div className="border border-border bg-popover p-3 text-xs shadow-lg" style={{ minWidth: 180 }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-block h-2 w-2 shrink-0" style={{ background: color }} />
        <span className="font-semibold text-foreground">{u.username}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
        <span>{xMeta.label}</span>
        <span className="font-mono font-semibold text-foreground tabular-nums">
          {typeof u[xKey] === "number" ? (u[xKey] as number).toFixed(2) : u[xKey]}
        </span>
        <span>{yMeta.label}</span>
        <span className="font-mono font-semibold text-foreground tabular-nums">
          {typeof u[yKey] === "number" ? (u[yKey] as number).toFixed(2) : u[yKey]}
        </span>
        <span>Dept</span>
        <span className="text-foreground">{u.department}</span>
        <span>Max risk</span>
        <span className="font-mono font-semibold tabular-nums" style={{ color }}>{u.max_risk}</span>
      </div>
      <button
        className="mt-2 text-xs text-primary underline underline-offset-2 hover:opacity-80"
        onClick={() => onNavigate(u.user_id)}
      >
        Investigate →
      </button>
    </div>
  );
}

function SevLegend({ items }: { items: Array<{ name: string; value: number }> }) {
  return (
    <div className="flex items-center justify-center gap-4 pt-2">
      {items.map((s) => (
        <span key={s.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5" style={{ background: SEV_COLORS[s.name] }} />
          {s.name} ({s.value})
        </span>
      ))}
    </div>
  );
}

const CLUSTER_LEGEND = [
  { label: "CRITICAL", color: SEV_COLORS.CRITICAL },
  { label: "HIGH",     color: SEV_COLORS.HIGH },
  { label: "MEDIUM",   color: SEV_COLORS.MEDIUM },
  { label: "LOW",      color: SEV_COLORS.LOW },
];

export default function Overview() {
  const [stats, setStats]     = useState<StatsResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [users, setUsers]     = useState<UserSummary[]>([]);
  const [xKey, setXKey]       = useState<MetricKey>("volume_z");
  const [yKey, setYKey]       = useState<MetricKey>("afterhours_z");
  const nav = useNavigate();

  useEffect(() => {
    api.stats().then(setStats);
    api.metrics().then(setMetrics);
    api.users({ limit: 500 }).then((r) => setUsers(r.items));
  }, []);

  if (!stats || !metrics) return <PageSkeleton />;

  const sev = ["CRITICAL", "HIGH", "MEDIUM"].map((k) => ({
    name: k,
    value: stats.severity_counts[k] || 0,
  }));

  // Axis domain: z-scores get a symmetric domain; counts start at 0
  function axisDomain(key: MetricKey): [number | "auto", number | "auto"] {
    if (key.endsWith("_z")) {
      const vals = users.map((u) => u[key] as number);
      const max = Math.ceil(Math.max(...vals, 3) + 0.5);
      return [-max, max];
    }
    return [0, "auto"];
  }

  const xDomain = axisDomain(xKey);
  const yDomain = axisDomain(yKey);
  const showXRef = xKey.endsWith("_z");
  const showYRef = yKey.endsWith("_z");
  const xMeta = METRICS.find((m) => m.key === xKey)!;
  const yMeta = METRICS.find((m) => m.key === yKey)!;

  return (
    <AppShell title="Security Operations Overview">
      <div className="mb-1 text-sm text-muted-foreground">
        {stats.total_events.toLocaleString()} access events analysed &bull;{" "}
        {stats.total_alerts.toLocaleString()} alerts raised
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Total Events" value={stats.total_events.toLocaleString()} />
        <KpiCard
          label="Alerts Raised"
          value={stats.total_alerts.toLocaleString()}
          sub={`${((stats.total_alerts / stats.total_events) * 100).toFixed(0)}% of events`}
        />
        <KpiCard
          label="Critical"
          value={stats.severity_counts.CRITICAL || 0}
          sub="immediate investigation"
          tone="bad"
        />
        <KpiCard
          label="Precision"
          value={`${(metrics.precision * 100).toFixed(1)}%`}
          sub="target > 75%"
          tone="good"
        />
        <KpiCard
          label="Recall"
          value={`${(metrics.recall * 100).toFixed(1)}%`}
          sub="target > 70%"
          tone="good"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Alerts by Severity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={sev}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={88}
                  paddingAngle={3}
                >
                  {sev.map((s) => (
                    <Cell key={s.name} fill={SEV_COLORS[s.name]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
            <SevLegend items={sev} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Alert Volume Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={stats.timeline} margin={{ left: -18, right: 10, top: 10 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={AXIS_STYLE} hide={stats.timeline.length > 30} />
                <YAxis tick={AXIS_STYLE} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Line
                  type="monotone"
                  dataKey="alerts"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* User Behaviour Cluster */}
      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-sm font-medium">
                User Behaviour Cluster
                <span className="ml-2 font-normal text-muted-foreground">
                  — {users.length} users · click to investigate
                </span>
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {xMeta.desc} (X) vs {yMeta.desc} (Y) · dot size = max risk score ·
                {showXRef || showYRef ? " dashed lines = 2σ anomaly threshold" : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Select value={xKey} onValueChange={(v) => setXKey(v as MetricKey)}>
                <SelectTrigger className="h-7 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m.key} value={m.key} className="text-xs">
                      X: {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={yKey} onValueChange={(v) => setYKey(v as MetricKey)}>
                <SelectTrigger className="h-7 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m.key} value={m.key} className="text-xs">
                      Y: {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ left: 4, right: 16, top: 8, bottom: 24 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey={xKey}
                type="number"
                domain={xDomain}
                tick={AXIS_STYLE}
                label={{
                  value: xMeta.label,
                  position: "insideBottom",
                  offset: -12,
                  fill: "var(--muted-foreground)",
                  fontSize: 11,
                }}
                height={40}
              />
              <YAxis
                dataKey={yKey}
                type="number"
                domain={yDomain}
                tick={AXIS_STYLE}
                label={{
                  value: yMeta.label,
                  angle: -90,
                  position: "insideLeft",
                  offset: 10,
                  fill: "var(--muted-foreground)",
                  fontSize: 11,
                }}
                width={46}
              />
              <ZAxis dataKey="max_risk" range={[18, 120]} />
              {showXRef && (
                <>
                  <ReferenceLine
                    x={2} stroke="var(--border)" strokeDasharray="4 3" strokeWidth={1.5}
                    label={{ value: "2σ", position: "top", fill: "var(--muted-foreground)", fontSize: 10 }}
                  />
                  <ReferenceLine
                    x={-2} stroke="var(--border)" strokeDasharray="4 3" strokeWidth={1}
                  />
                </>
              )}
              {showYRef && (
                <>
                  <ReferenceLine
                    y={2} stroke="var(--border)" strokeDasharray="4 3" strokeWidth={1.5}
                    label={{ value: "2σ", position: "right", fill: "var(--muted-foreground)", fontSize: 10 }}
                  />
                  <ReferenceLine
                    y={-2} stroke="var(--border)" strokeDasharray="4 3" strokeWidth={1}
                  />
                </>
              )}
              <Tooltip
                content={
                  <ClusterTooltip
                    xKey={xKey}
                    yKey={yKey}
                    onNavigate={(id) => nav(`/users/${id}`)}
                  />
                }
                cursor={{ strokeDasharray: "3 3", stroke: "var(--border)" }}
              />
              <Scatter data={users} style={{ cursor: "pointer" }}>
                {users.map((u) => (
                  <Cell
                    key={u.user_id}
                    fill={userColor(u)}
                    fillOpacity={u.max_risk >= 62 ? 0.9 : 0.55}
                    stroke={userColor(u)}
                    strokeOpacity={0.2}
                    strokeWidth={1}
                    onClick={() => nav(`/users/${u.user_id}`)}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>

          <div className="mt-2 flex items-center justify-center gap-5">
            {CLUSTER_LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block h-2.5 w-2.5" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
            <span className="text-xs text-muted-foreground">· size = max risk</span>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
