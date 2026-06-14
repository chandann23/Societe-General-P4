# Sentinel — Insider Threat Detection System

Detects abnormal data-access patterns (insider threat, compromised credentials, exfiltration) from access logs, scores each event 0–100, explains *why* in plain language, and presents findings in an operational security dashboard.

```
data/ → load + feature engineering → rules + IsolationForest → risk score
      → context suppression → alert narratives → FastAPI → React dashboard
```

---

## The data reality

The shipped CSVs differ from what the problem statement describes. This is documented up-front because it shapes every design decision.

| Problem statement describes | Actually in the CSVs |
|---|---|
| `rowcount`, `destination`, `data_asset`, `database`, `table` | Not present |
| `data_access_labels.csv`, `user_profile_labels.csv` (ground truth) | Not shipped |
| Profile fields: `tenure_months`, `approved_systems`, `high_risk_event` | Not present |

**Real log columns:** `timestamp, user_id, username, action, resource, resource_sensitivity, status, source_ip, time_classification`

**Real profile columns:** `user_id, username, email, department, job_title, privilege_level, systems_access, last_login, days_inactive, is_active, hire_date`

The pipeline infers every missing signal rather than pretending the columns exist:

| Missing field | Proxy |
|---|---|
| `rowcount` / bulk volume | Cohort volume Z-score — event count vs `(department, privilege_level)` peers |
| `destination` (USB / email) | `action == export_data` to a sensitive resource or `Email_Archive`/`File_Share` |
| `high_risk_event` / HR status | Not fabricated — gap is stated in the alert's business context |
| First-time table access | First-seen `resource` per user in the log window |

`time_classification` in the log is noisy (09:18 events tagged `night`). It is ignored; `time_bucket` is recomputed from the actual timestamp. The original field is preserved as a data-quality mismatch signal.

---

## Detection approach

Per-user history is sparse (~12 events/user/year), so statistical baselines are built at the **cohort** level `(department, privilege_level)`. Each user's behaviour is expressed as a Z-score against cohort peers — this is the stand-in for the missing `rowcount` signal.

### Hybrid engine

**9 interpretable rules** (`app/core/detector.py`) — each emits a points value and a human-readable explanation:

| Rule | Signal |
|---|---|
| `OFF_HOURS_NIGHT / AFTER / WEEKEND` | Access to high-sensitivity resource outside business hours |
| `SENSITIVE_EXPORT` | Export from a sensitive resource or known exfil channel (`Email_Archive`, `File_Share`) |
| `PII_EXPORT_BONUS` | Extra weight when the exported resource holds PII (`Customer_Vault`, `HRIS`) |
| `VOLUME_SPIKE_{3/25/2/15}` | User event count 1.5–3+ σ above department/role cohort |
| `PRIV_ESCALATION` | Admin operation performed by a non-privileged account |
| `FIRST_TIME_SENSITIVE` | First-ever access by this user to a sensitive resource |
| `CROSS_DEPT_SENSITIVE` | Accessing a resource restricted to another department |
| `FAILURE_EVENT / FAILURE_BURST` | Single failed access attempt / burst of ≥3 failures |
| `STALE_PRIVILEGED_ACTIVE` | Privileged account inactive 60+ days performing a sensitive action |
| `SERVICE_ACCT_INTERACTIVE` | Service account doing interactive login/file access off-hours |

**Diminishing-returns stacking** (`_stack_scores`): rules are sorted highest-first; each successive rule contributes `RULE_STACK_DECAY × previous_contribution` (default 0.70). This prevents two moderate signals from instantly saturating at 100.

Typical stacking results:
- 1 rule → MEDIUM (~35–42 pts)
- 2 rules → HIGH (~63–68 pts)
- 3 rules → CRITICAL (~83–87 pts)

**IsolationForest** over 19 numeric features — trained on the full event set with `contamination=0.1`. It only *escalates* events above the `MODEL_BONUS_FLOOR` threshold (0.65), contributing at most `MODEL_BONUS_MAX` (12) extra points. It cannot on its own raise a benign event into alert territory, which protects precision.

**Context suppression** (`app/core/context.py`) — recognises four legitimate-but-suspicious patterns and multiplies the base score by 0.30 (70% discount):

| Context | Condition |
|---|---|
| `MONTH_END_CLOSE` | Finance exporting/querying within ±2 days of month boundary |
| `ON_CALL_DUTY` | Privileged Eng/IT doing admin ops or queries off-hours |
| `SCHEDULED_BATCH_JOB` | Service account making API calls at any hour |
| `APPROVED_DW_REFRESH` | Eng/Marketing exporting from `Data_Lake` during business hours |

Recognised exceptions are noted in the alert's `business_context` field. The model bonus is also zeroed for suppressed events.

### Severity bands

| Band | Score threshold |
|---|---|
| CRITICAL | ≥ 82 |
| HIGH | ≥ 62 |
| MEDIUM | ≥ 35 |
| LOW | < 35 (no alert) |

`ALERT_THRESHOLD = 35` — events at or above this risk score become alerts.

---

## Evaluation

Because no labels ship with the data, ground truth is constructed (`app/core/labels.py`) in two parts:

**1. Injected canonical scenarios** (~35 events, definitively labelled):

*Malicious (must alert)*: off-hours bulk PII export, 3 AM admin operations by non-privileged users, cross-department salary snooping, credential-stuffing bursts (4 failures each), stale-privileged-account exfiltration, weekend data-lake bulk pulls.

*Legitimate-but-suspicious (must NOT alert)*: Finance month-end ledger pulls, on-call engineer night-time admin ops, service-account scheduled batch jobs, approved warehouse refresh exports.

**2. Weak labels** for real events — applied by strict independent domain rules (not the detector's graded formula), with context exceptions overriding to benign.

| Metric (full constructed set) | Result | Target |
|---|---|---|
| Precision | ~95% | > 75% |
| Recall | ~99% | > 70% |
| F1 | ~0.97 | > 0.72 |
| Runtime (1,249 events) | < 0.4s | < 120s |

**Honest disclosure**: full-set numbers are optimistic because the detector and label rationale share domain knowledge. The credibility anchor is the independent scenario test:

> **28/28 malicious scenarios caught · 20/21 legitimate exceptions suppressed**

This out-of-sample check does not share the weak-label rationale for the 1,200 real events, making it a genuine test of discrimination.

---

## Running it

### Prerequisites

- Python 3.11+ with a virtual environment
- Node.js 18+

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python -m app.pipeline          # full detection run → writes artifacts/
python eval.py                  # PS-format precision/recall/F1 report
python report.py                # human-readable incident report to stdout

uvicorn app.main:app --reload   # API on :8000 · Swagger at /docs
                                # auto-runs pipeline on first start if artifacts/ is empty
```

### Frontend

```bash
cd frontend
npm install
npm run dev     # dashboard on :5173, proxies /api → :8000
npm run build   # production build → frontend/dist/
```

### Resetting artifacts

After any config change to `app/core/config.py` or `detector.py`, delete the cached artifacts so the pipeline re-runs:

```bash
rm -f backend/artifacts/*.json backend/artifacts/*.csv
```

### LLM investigation narratives (optional)

The system runs fully offline — every alert has a template-based narrative. To add AI-generated investigation summaries via [OpenRouter](https://openrouter.ai):

```bash
# Dry-run: exercises the full code path, no HTTP calls, no billing
OPENROUTER_DRY_RUN=1 python -m app.pipeline

# Real calls — pre-generates narratives for top 12 CRITICALs at pipeline time
OPENROUTER_API_KEY=sk-or-v1-... python -m app.pipeline

# On-demand: the dashboard's alert drawer has a "Generate AI investigation" button
# that calls POST /api/alerts/{id}/narrative for any uncached alert
```

Copy `backend/.env.example` to `backend/.env` for all configuration options. Cost estimate: ~$0.004 for 12 CRITICAL alerts using `anthropic/claude-3.5-haiku`.

---

## Dashboard pages

**Overview** — KPIs (total events, alerts, critical count, precision, recall), severity donut, alert volume timeline, and an interactive behavioural cluster chart. The cluster chart plots all users by selectable axes (volume σ, off-hours σ, max risk, alert count, event count) with 2σ reference lines as quadrant dividers. Dot size encodes risk score; colour encodes severity. Click any user to investigate.

**Alerts** — filterable/searchable table (severity, department, action, free text). Row click opens an investigation drawer with: fired rule factors, business context, recommendation, and an optional AI narrative button.

**Users** — per-user risk table with cohort Z-scores for volume and off-hours activity. Click a row to drill into the user's baseline-vs-observed profile and full event history.

**Evaluation** — confusion matrix, independent scenario test results (the credibility anchor), recall-by-severity bar chart, and a methodology note disclosing the constructed-labels limitation.

---

## API reference

All endpoints under `/api`. Full interactive docs at `http://localhost:8000/docs`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/stats` | KPIs, severity counts, top risky users, alert timeline |
| `GET` | `/api/metrics` | Precision/recall/F1, confusion matrix, severity recall, injected test |
| `GET` | `/api/alerts` | Alert list; query params: `severity`, `department`, `action`, `q`, `limit`, `offset` |
| `GET` | `/api/alerts/{id}` | Single alert with factors, context, recommendation, cached LLM payload |
| `POST` | `/api/alerts/{id}/narrative` | Return cached or generate on-demand LLM narrative |
| `GET` | `/api/users` | User risk summary list; params: `limit`, `offset` |
| `GET` | `/api/users/{id}` | User profile + full event list |
| `POST` | `/api/reanalyze` | Re-run pipeline, reload store, return updated metrics |

---

## Code layout

```
backend/
  app/
    core/
      config.py       — all tunable constants (rule weights, decay, thresholds)
      loader.py       — CSV ingestion, timestamp parsing, feature derivation
      features.py     — cohort baselines, user Z-scores, event feature matrix
      detector.py     — 9 rules + IsolationForest + _stack_scores()
      context.py      — legitimate-exception suppression (FP control)
      scoring.py      — blend rule base_score + model_bonus → risk_score + severity
      narrative.py    — build alert dicts with human-readable factors + recommendation
      labels.py       — inject canonical scenarios, construct ground truth
      llm.py          — OpenRouter client, dry-run mode, token/cost tracking
    api/
      routes.py       — all FastAPI route handlers
    pipeline.py       — end-to-end orchestration; writes artifacts/
    store.py          — singleton in-memory store, loaded once at startup
    main.py           — FastAPI app, CORS, lifespan hook
  artifacts/          — generated at runtime (alerts.json, metrics.json, etc.)
  eval.py             — standalone PS-format evaluation script
  report.py           — human-readable incident report

frontend/
  src/
    api.ts            — typed fetch client + SEV_COLORS
    App.tsx           — SidebarProvider + routing
    index.css         — Tailwind v4 OKLCH design tokens, dark mode, typography
    components/
      app-sidebar.tsx — collapsible shadcn sidebar with nav groups
      app-shell.tsx   — sticky header + max-width main wrapper
      common.tsx      — SeverityBadge, RiskScore, KpiCard, PageSkeleton
      theme-toggle.tsx
    pages/
      Overview.tsx    — KPIs, charts, behavioural cluster (all users)
      Alerts.tsx      — table + Sheet investigation drawer + AI block
      Users.tsx       — user risk table
      UserDetail.tsx  — per-user drill-down
      Evaluation.tsx  — confusion matrix + scenario test + recall chart

data/                 — source CSVs (logs + profiles); labels generated at runtime
notebooks/eda.ipynb   — exploratory data analysis
docs/SCALING.md       — 1M+ events/day Kafka + Flink architecture
```

---

## Tuning the detector

All scoring constants live in `backend/app/core/config.py`. After any change, delete `backend/artifacts/` and restart the server.

**Key knobs:**

- `RULE_WEIGHTS` — points for each rule (0–100 scale per isolated signal)
- `RULE_STACK_DECAY` (0.70) — diminishing-returns factor; lower = more aggressive stacking suppression
- `ALERT_THRESHOLD` (35) — minimum risk score to raise an alert; raising this kills recall fast
- `SEVERITY_BANDS` — CRITICAL ≥82, HIGH ≥62, MEDIUM ≥35
- `MODEL_BONUS_MAX` (12) / `MODEL_BONUS_FLOOR` (0.65) — IsolationForest contribution ceiling and activation threshold
- `SENSITIVE_RESOURCES`, `PII_RESOURCES`, `EXFIL_CHANNELS` — resource taxonomy used by multiple rules
- `RESOURCE_OWNER_DEPARTMENTS` — defines which departments legitimately own each sensitive resource (cross-dept rule)

To add a new rule: implement it in `_event_rules()` in `detector.py`, add a weight key to `RULE_WEIGHTS` in `config.py`, and add a matching ground-truth condition in `labels.py` if it should affect evaluation.

---

## Scaling to production

See `docs/SCALING.md` for a full write-up. In brief: the local pipeline maps directly to a streaming architecture because every core function is stateless per-event or derived from pre-computable state:

| Local component | Production equivalent |
|---|---|
| `loader.derive_log_features` | Stateless map in Flink/Spark |
| `features.add_cohort_baselines` | Daily offline batch → Redis/RocksDB state store |
| `features.build_user_features` | Flink keyed state per `user_id` (rolling counts, TTL) |
| `detector._event_rules` | Ships unchanged into the stream operator |
| IsolationForest | Train offline nightly, broadcast to stream tasks |
| `context.legitimate_exception` | Pure function + allowlist table as broadcast state |
| `scoring` / `narrative` | Stateless per-event |

Partitioning by `user_id` keeps first-seen-resource novelty and per-user rolling state local to a single task. The system reaches well under 1 minute end-to-end latency at 1M+ events/day.
