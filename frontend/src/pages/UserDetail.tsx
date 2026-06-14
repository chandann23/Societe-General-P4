import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, type UserDetailResponse } from "@/api";
import { KpiCard, RiskScore, SeverityBadge } from "@/components/common";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtTime } from "@/lib/utils";

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<UserDetailResponse | null>(null);

  useEffect(() => {
    if (id) api.user(id).then(setData);
  }, [id]);

  if (!data) {
    return (
      <AppShell title="User Detail">
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      </AppShell>
    );
  }

  const p = data.profile;
  const zs = [
    { label: "Volume", z: p.volume_z },
    { label: "Off-hours", z: p.afterhours_z },
    { label: "Sensitive access", z: p.sensitive_z },
    { label: "Data exports", z: p.export_z },
  ];

  return (
    <AppShell title={p.username}>
      <div className="mb-4">
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
          <Link to="/users">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Users
          </Link>
        </Button>
        <p className="font-mono text-xs text-muted-foreground">
          {p.user_id} &middot; {p.department} &middot; {p.job_title} &middot; {p.privilege_level}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Max Risk Score"
          value={<RiskScore score={p.max_risk} />}
          sub={`${p.alerts} alerts across ${p.events} events`}
        />
        <KpiCard
          label="Account"
          value={p.is_active ? "Active" : "Inactive"}
          sub={`${p.days_inactive}d inactive · ~${Math.round(p.account_age_days / 30)}mo tenure`}
        />
        <KpiCard
          label="Account Risk"
          value={p.account_risk ? <SeverityBadge severity="HIGH" /> : "—"}
          sub="user-level baseline label"
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Behaviour vs Cohort (department + role peers)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {zs.map((z) => (
            <div key={z.label}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{z.label}</span>
                <span
                  className="font-mono font-semibold tabular-nums"
                  style={{
                    color:
                      z.z >= 2
                        ? "var(--severity-critical)"
                        : z.z >= 1
                          ? "var(--severity-high)"
                          : "var(--severity-low)",
                  }}
                >
                  {z.z >= 0 ? "+" : ""}
                  {z.z}σ
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(4, ((z.z + 1) / 4) * 100))}%`,
                    background:
                      z.z >= 2
                        ? "var(--severity-critical)"
                        : z.z >= 1
                          ? "var(--severity-high)"
                          : "var(--primary)",
                  }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Access Events{" "}
            <span className="font-normal text-muted-foreground">({data.events.length})</span>
          </CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Risk</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Sens.</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Rules</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.events.map((e) => (
              <TableRow key={e.access_id}>
                <TableCell>
                  <RiskScore score={e.risk_score} />
                </TableCell>
                <TableCell>
                  {e.predicted_anomaly ? (
                    <SeverityBadge severity={e.severity} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{e.action}</TableCell>
                <TableCell>{e.resource}</TableCell>
                <TableCell className="text-muted-foreground">{e.resource_sensitivity}</TableCell>
                <TableCell className="text-muted-foreground">{fmtTime(e.timestamp)}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {e.rules_fired || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </AppShell>
  );
}
