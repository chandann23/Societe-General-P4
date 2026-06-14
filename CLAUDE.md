# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend
```bash
cd backend
source .venv/bin/activate

python -m app.pipeline          # run full detection pipeline → writes artifacts/
python eval.py                  # PS-format precision/recall/F1 evaluation
python report.py                # human-readable incident report

uvicorn app.main:app --reload   # API on :8000; auto-runs pipeline if artifacts missing
```

### Frontend
```bash
cd frontend
npm install
npm run dev     # :5173, proxies /api → :8000
npm run build   # output → frontend/dist/
```

### Resetting pipeline artifacts
Delete any stale artifacts before a config change takes effect — the server serves them from cache:
```bash
rm -f backend/artifacts/*.json backend/artifacts/*.csv
```

### LLM narratives (optional)
```bash
OPENROUTER_DRY_RUN=1 python -m app.pipeline    # exercises LLM path, no billing
OPENROUTER_API_KEY=sk-or-v1-... python -m app.pipeline  # real calls (top 12 CRITICALs)
```

---

## Architecture

### Data flow
```
data/data_access_logs.csv + data/user_profiles.csv
  → loader.py (load + derive features: time_bucket, is_export, is_failure, …)
  → labels.inject_canonical() (adds hand-designed malicious + legit-exception events)
  → features.py (cohort baselines + per-user z-scores: volume_z, afterhours_z, …)
  → detector.py (9 rules + IsolationForest → base_score per event)
  → scoring.py (base_score + model_bonus → risk_score 0–100, severity, predicted_anomaly)
  → narrative.py (build alert dicts with factors + recommendation)
  → labels.make_ground_truth() (construct labels since none ship in the data)
  → artifacts/ (alerts.json, metrics.json, stats.json, users.json, predictions.csv)
  → store.py (loaded once at startup, served by FastAPI)
```

### Backend (`backend/app/`)
- **`core/config.py`** — all tunable constants: `RULE_WEIGHTS`, `RULE_STACK_DECAY` (0.70), `MODEL_BONUS_MAX`, `SEVERITY_BANDS`, `ALERT_THRESHOLD`. Change scoring here.
- **`core/detector.py`** — `_stack_scores()` applies diminishing-returns stacking (sorted highest-first, each successive rule × RULE_STACK_DECAY). `detect()` evaluates 9 rules per event + IsolationForest.
- **`core/scoring.py`** — blends rule base_score + model_bonus. Model only escalates events above `MODEL_BONUS_FLOOR` (0.65) to protect precision.
- **`core/context.py`** — suppresses scores for legitimate-but-suspicious patterns (month-end finance, on-call ops, batch jobs). This is the false-positive-control layer.
- **`core/labels.py`** — constructs ground truth (no labels ship with the data): injects canonical scenarios, applies weak-label rules for real events.
- **`store.py`** — singleton `store` loaded once at FastAPI startup. If `artifacts/alerts.json` is missing, it auto-runs the pipeline. All route handlers read from this store.
- **`api/routes.py`** — all FastAPI endpoints under `/api` prefix.

### Scoring calibration
Single rule fires → MEDIUM (~35–42 pts). Two rules stack → HIGH (~63–68 pts). Three rules → CRITICAL (~83–87 pts). Key thresholds: CRITICAL ≥82, HIGH ≥62, MEDIUM ≥35, ALERT ≥35.

### Frontend (`frontend/src/`)
- **`api.ts`** — all fetch calls, TypeScript types. `SEV_COLORS` uses OKLCH strings matching `--severity-*` CSS vars.
- **`App.tsx`** — `SidebarProvider > AppSidebar + SidebarInset > Routes`. Includes `<Toaster />`.
- **`components/app-shell.tsx`** — sticky header (`SidebarTrigger` + title) + `max-w-[1600px]` main wrapper.
- **`components/common.tsx`** — `SeverityBadge`, `RiskScore`, `KpiCard`, `PageSkeleton`. Use `color-mix(in oklch, var(--severity-*) %, transparent)` for tinted backgrounds.
- **`pages/`** — Overview, Alerts (Sheet drawer), Users (table), UserDetail, Evaluation.

### Design system
- Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.js` — config lives in `src/index.css`).
- OKLCH color tokens in `src/index.css` under `:root` and `.dark`. Theme toggle sets `.dark` class on `<html>` + `localStorage`.
- `--radius: 0rem` — square corners everywhere. `--font-sans: Geist Mono, ui-monospace, monospace`.
- Chart tooltips use inverted colors (`background: var(--foreground); color: var(--background)`) for dark-mode legibility.
- shadcn/ui New York style, RSC=false, tsx=true. Components in `src/components/ui/`.

### Data reality note
The shipped CSVs lack `rowcount`, `destination`, `data_asset`, and label files. The pipeline infers these: volume via cohort z-scores, exfiltration via action+resource, ground truth constructed in `labels.py`. The `time_classification` column in the logs is noisy — `loader.py` recomputes `time_bucket` from the actual timestamp.
