const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string): Promise<T> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(BASE + path, { method: "POST", signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(tid);
  }
}

export const api = {
  stats: () => get<StatsResponse>("/stats"),
  metrics: () => get<MetricsResponse>("/metrics"),
  alerts: (params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== "" && v != null)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return get<AlertsResponse>("/alerts" + (qs ? `?${qs}` : ""));
  },
  alert: (id: string) => get<AlertDetail>(`/alerts/${id}`),
  users: (params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();
    return get<UsersResponse>("/users" + (qs ? `?${qs}` : ""));
  },
  user: (id: string) => get<UserDetailResponse>(`/users/${id}`),
  generateNarrative: (id: string) => post<LlmResult>(`/alerts/${id}/narrative`),
};

export const SEV_COLORS: Record<string, string> = {
  CRITICAL: "oklch(0.6368 0.2078 25.3313)",
  HIGH: "oklch(0.6772 0.1866 47.40)",
  MEDIUM: "oklch(0.7953 0.1535 91.00)",
  LOW: "oklch(0.5510 0.0234 264.3637)",
};

// Types
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface StatsResponse {
  total_events: number;
  total_alerts: number;
  severity_counts: Record<string, number>;
  top_risky_users: Array<{ username: string; max: number; count: number; user_id: string }>;
  timeline: Array<{ day: string; alerts: number }>;
}

export interface MetricsResponse {
  precision: number;
  recall: number;
  f1: number;
  runtime_sec: number;
  n_events: number;
  confusion_matrix: { tp: number; fp: number; fn: number; tn: number };
  severity_recall: Record<string, { ground_truth: number; detected: number }>;
  injected_test: {
    malicious_caught: number;
    n_malicious: number;
    exceptions_suppressed: number;
    n_legit_exceptions: number;
    f1: number;
  };
}

export interface AlertItem {
  access_id: string;
  alert_id: string;
  user_id: string;
  username: string;
  department: string;
  action: string;
  resource: string;
  resource_sensitivity: string;
  severity: Severity;
  risk_score: number;
  timestamp: string;
  time_bucket: string;
  anomalies_detected: string[];
  business_context: string;
  recommendation: string;
  llm?: LlmResult | null;
}

export interface AlertsResponse {
  total: number;
  items: AlertItem[];
}

export type AlertDetail = AlertItem;

export interface LlmResult {
  source: string;
  hint?: string;
  model?: string;
  est_cost_usd?: number;
  analyst_priority?: string;
  narrative?: string;
  recommended_actions?: string[];
}

export interface UserSummary {
  user_id: string;
  username: string;
  department: string;
  job_title: string;
  privilege_level: string;
  max_risk: number;
  alerts: number;
  events: number;
  volume_z: number;
  afterhours_z: number;
  account_risk: string | null;
}

export interface UsersResponse {
  items: UserSummary[];
}

export interface UserProfile {
  user_id: string;
  username: string;
  department: string;
  job_title: string;
  privilege_level: string;
  max_risk: number;
  alerts: number;
  events: number;
  volume_z: number;
  afterhours_z: number;
  sensitive_z: number;
  export_z: number;
  account_risk: string | null;
  is_active: boolean;
  days_inactive: number;
  account_age_days: number;
}

export interface EventItem {
  access_id: string;
  action: string;
  resource: string;
  resource_sensitivity: string;
  severity: Severity;
  risk_score: number;
  timestamp: string;
  predicted_anomaly: boolean;
  rules_fired?: string;
}

export interface UserDetailResponse {
  profile: UserProfile;
  events: EventItem[];
}
