import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Severity } from "@/api";

const SEV_STYLE: Record<Severity, React.CSSProperties> = {
  CRITICAL: {
    borderColor: "color-mix(in oklch, var(--severity-critical) 30%, transparent)",
    background: "color-mix(in oklch, var(--severity-critical) 12%, transparent)",
    color: "var(--severity-critical)",
  },
  HIGH: {
    borderColor: "color-mix(in oklch, var(--severity-high) 30%, transparent)",
    background: "color-mix(in oklch, var(--severity-high) 12%, transparent)",
    color: "var(--severity-high)",
  },
  MEDIUM: {
    borderColor: "color-mix(in oklch, var(--severity-medium) 30%, transparent)",
    background: "color-mix(in oklch, var(--severity-medium) 12%, transparent)",
    color: "var(--severity-medium)",
  },
  LOW: {
    borderColor: "var(--border)",
    background: "var(--muted)",
    color: "var(--severity-low)",
  },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge
      variant="outline"
      className="font-mono text-xs"
      style={SEV_STYLE[severity]}
    >
      {severity}
    </Badge>
  );
}

export function RiskScore({ score }: { score: number }) {
  const cssVar =
    score >= 80
      ? "var(--severity-critical)"
      : score >= 60
        ? "var(--severity-high)"
        : score >= 35
          ? "var(--severity-medium)"
          : "var(--severity-low)";
  return (
    <span
      className="font-mono font-semibold tabular-nums"
      style={{ color: cssVar }}
    >
      {score}
    </span>
  );
}

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}

export function KpiCard({ label, value, sub, tone }: KpiCardProps) {
  const subColor =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad"
        ? "text-red-500"
        : "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <p className={cn("mt-1 text-xs", subColor)}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
