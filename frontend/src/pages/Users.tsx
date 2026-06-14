import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type UsersResponse } from "@/api";
import { RiskScore, SeverityBadge } from "@/components/common";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function Users() {
  const [data, setData] = useState<UsersResponse | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    api.users({ limit: 100 }).then(setData);
  }, []);

  return (
    <AppShell title="Users">
      <p className="mb-4 text-sm text-muted-foreground">
        Per-user risk summary. Z-scores are vs the user&apos;s department/role cohort.
      </p>

      {!data ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Max Risk</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Dept</TableHead>
                <TableHead>Role / Tier</TableHead>
                <TableHead className="text-right">Alerts</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Vol σ</TableHead>
                <TableHead className="text-right">Off-hrs σ</TableHead>
                <TableHead>Account Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((u) => (
                <TableRow
                  key={u.user_id}
                  className="cursor-pointer"
                  onClick={() => nav(`/users/${u.user_id}`)}
                >
                  <TableCell>
                    <RiskScore score={u.max_risk} />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{u.username}</div>
                    <div className="font-mono text-xs text-muted-foreground">{u.user_id}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.department}</TableCell>
                  <TableCell>
                    <div>{u.job_title}</div>
                    <div className="text-xs text-muted-foreground">{u.privilege_level}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{u.alerts}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.events}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span style={{ color: u.volume_z >= 2 ? "var(--severity-high)" : "var(--severity-low)" }}>
                      {u.volume_z}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span style={{ color: u.afterhours_z >= 2 ? "var(--severity-high)" : "var(--severity-low)" }}>
                      {u.afterhours_z}
                    </span>
                  </TableCell>
                  <TableCell>
                    {u.account_risk ? (
                      <SeverityBadge severity="HIGH" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppShell>
  );
}
