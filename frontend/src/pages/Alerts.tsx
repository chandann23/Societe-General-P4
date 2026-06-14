import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { api, type AlertItem, type AlertsResponse, type LlmResult } from "@/api";
import { SeverityBadge, RiskScore } from "@/components/common";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtTime } from "@/lib/utils";

interface Filters {
  severity: string;
  action: string;
  q: string;
}

export default function Alerts() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [filters, setFilters] = useState<Filters>({ severity: "", action: "", q: "" });
  const [selected, setSelected] = useState<AlertItem | null>(null);

  useEffect(() => {
    setData(null);
    const t = setTimeout(() => {
      api.alerts({ ...filters, limit: 300 }).then(setData);
    }, 250);
    return () => clearTimeout(t);
  }, [filters]);

  return (
    <AppShell title="Alerts">
      <p className="mb-4 text-sm text-muted-foreground">
        Risk-scored access events, highest first. Click a row for the investigation view.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={filters.severity || "all"}
          onValueChange={(v) => setFilters({ ...filters, severity: v === "all" ? "" : v })}
        >
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="All severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="CRITICAL">CRITICAL</SelectItem>
            <SelectItem value="HIGH">HIGH</SelectItem>
            <SelectItem value="MEDIUM">MEDIUM</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.action || "all"}
          onValueChange={(v) => setFilters({ ...filters, action: v === "all" ? "" : v })}
        >
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {["export_data", "admin_operation", "sql_query", "api_call", "file_access", "login"].map(
              (a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>

        <Input
          className="h-9 w-56"
          placeholder="Search user / resource…"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
      </div>

      {!data ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="rounded-none border border-border">
          <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
            {data.total} matching alerts — showing {data.items.length}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Risk</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Dept</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Sens.</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((a) => (
                <TableRow
                  key={a.access_id}
                  className="cursor-pointer"
                  onClick={() => setSelected(a)}
                >
                  <TableCell>
                    <RiskScore score={a.risk_score} />
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={a.severity} />
                  </TableCell>
                  <TableCell className="font-medium">{a.username}</TableCell>
                  <TableCell className="text-muted-foreground">{a.department}</TableCell>
                  <TableCell className="font-mono text-xs">{a.action}</TableCell>
                  <TableCell>{a.resource}</TableCell>
                  <TableCell className="text-muted-foreground">{a.resource_sensitivity}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtTime(a.timestamp)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
          {selected && <AlertDrawerContent alert={selected} />}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

function AlertDrawerContent({ alert }: { alert: AlertItem }) {
  const [llm, setLlm] = useState<LlmResult | null>(alert.llm ?? null);
  const [loadingLlm, setLoadingLlm] = useState(false);

  function handleGenerate() {
    setLoadingLlm(true);
    api
      .generateNarrative(alert.access_id)
      .then(setLlm)
      .catch(() => setLlm({ source: "error", hint: "Request failed — check console." }))
      .finally(() => setLoadingLlm(false));
  }

  return (
    <>
      {/* Sticky header */}
      <SheetHeader className="shrink-0 border-b border-border px-6 pb-4 pt-5">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={alert.severity} />
          <span className="font-mono text-xs text-muted-foreground">{alert.alert_id}</span>
        </div>
        <SheetTitle className="text-left">
          Risk score: <span className="tabular-nums">{alert.risk_score}</span>/100
        </SheetTitle>
      </SheetHeader>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
          <span className="text-muted-foreground">User</span>
          <span>
            <Link to={`/users/${alert.user_id}`} className="font-medium underline underline-offset-2">
              {alert.username}
            </Link>{" "}
            <span className="font-mono text-xs text-muted-foreground">({alert.user_id})</span>
          </span>
          <span className="text-muted-foreground">Department</span>
          <span>{alert.department}</span>
          <span className="text-muted-foreground">Action</span>
          <span className="font-mono text-xs">{alert.action}</span>
          <span className="text-muted-foreground">Resource</span>
          <span>
            {alert.resource}{" "}
            <span className="text-muted-foreground">({alert.resource_sensitivity})</span>
          </span>
          <span className="text-muted-foreground">Time</span>
          <span>
            {fmtTime(alert.timestamp)}{" "}
            <span className="text-muted-foreground">&middot; {alert.time_bucket}</span>
          </span>
        </div>

        <Separator className="my-5" />

        <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Anomalies Detected
        </p>
        <ul className="space-y-2 text-sm">
          {alert.anomalies_detected.map((f, i) => (
            <li
              key={i}
              className={`border-l-2 py-0.5 pl-3 leading-relaxed ${
                f.startsWith("[context")
                  ? "border-muted-foreground/30 text-muted-foreground"
                  : "border-primary"
              }`}
            >
              {f}
            </li>
          ))}
        </ul>

        <Separator className="my-5" />

        <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Business Context
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">{alert.business_context}</p>

        <Separator className="my-5" />

        <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Recommendation
        </p>
        <div
          className="py-2.5 pl-3 text-sm leading-relaxed"
          style={{
            borderLeft: "2px solid var(--severity-critical)",
            background:
              alert.severity === "CRITICAL"
                ? "color-mix(in oklch, var(--severity-critical) 8%, transparent)"
                : alert.severity === "HIGH"
                  ? "color-mix(in oklch, var(--severity-high) 8%, transparent)"
                  : "color-mix(in oklch, var(--severity-medium) 8%, transparent)",
            borderLeftColor:
              alert.severity === "CRITICAL"
                ? "var(--severity-critical)"
                : alert.severity === "HIGH"
                  ? "var(--severity-high)"
                  : "var(--severity-medium)",
          }}
        >
          {alert.recommendation}
        </div>

        <Separator className="my-5" />

        <AiBlock llm={llm} loading={loadingLlm} onGenerate={handleGenerate} />
      </div>
    </>
  );
}

function AiBlock({
  llm,
  loading,
  onGenerate,
}: {
  llm: LlmResult | null;
  loading: boolean;
  onGenerate: () => void;
}) {
  const [secs, setSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (loading) {
      setSecs(0);
      timerRef.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loading]);

  const header = (
    <div className="mb-3 flex items-center gap-2">
      <Sparkles className="h-3.5 w-3.5 text-primary" />
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        AI Investigation
      </span>
    </div>
  );

  if (loading) {
    return (
      <div>
        {header}
        <p className="text-sm text-muted-foreground">
          Calling Nemotron… {secs}s
          <span className="mt-1 block text-xs">
            Free tier can take 20–60s. Request is in-flight.
          </span>
        </p>
      </div>
    );
  }

  if (!llm) {
    return (
      <div>
        {header}
        <Button variant="outline" size="sm" onClick={onGenerate}>
          <Sparkles className="mr-2 h-3.5 w-3.5" />
          Generate AI investigation
        </Button>
      </div>
    );
  }

  if (llm.source === "template" || llm.source === "error") {
    return (
      <div>
        {header}
        <p className="text-xs text-muted-foreground">
          {llm.hint ?? "LLM not configured — showing rule-based analysis above."}
        </p>
      </div>
    );
  }

  const priorityColor =
    llm.analyst_priority === "P1"
      ? "text-red-500"
      : llm.analyst_priority === "P2"
        ? "text-orange-500"
        : "text-yellow-600";

  return (
    <div>
      {header}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {llm.model && (
          <span className="border border-border px-1.5 py-0.5 font-mono text-xs">
            {llm.model}
          </span>
        )}
        {llm.est_cost_usd != null && llm.est_cost_usd > 0 && (
          <span className="border border-border px-1.5 py-0.5 font-mono text-xs">
            ${llm.est_cost_usd.toFixed(4)}
          </span>
        )}
        {llm.analyst_priority && (
          <span className={`border px-1.5 py-0.5 font-mono text-xs font-semibold ${priorityColor}`}>
            {llm.analyst_priority}
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed">{llm.narrative}</p>
      {llm.recommended_actions && llm.recommended_actions.length > 0 && (
        <>
          <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Recommended Actions
          </p>
          <ul className="space-y-1 text-sm">
            {llm.recommended_actions.map((a, i) => (
              <li key={i} className="border-l-2 border-primary pl-3">
                {a}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
