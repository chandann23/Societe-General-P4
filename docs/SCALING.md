# Scaling to 1M+ data-access events/day

The sample runs on 1,200 events locally in <0.4s. Here is how the same logic maps
to production scale (1M+ events/day ≈ 12 events/sec average, ~100/sec peak).

## Target architecture

```
 sources (DB audit, CloudTrail, BI, file shares, APIs)
        │  agents / log shippers
        ▼
   Kafka topic: raw-access-events   (partitioned by user_id)
        │
        ▼
   Stream processor (Flink / Spark Structured Streaming)
     • enrich with profile + cohort baseline (from state store / cache)
     • evaluate rule signals (stateless, same code as app/core/detector)
     • score with a periodically-retrained IsolationForest (broadcast model)
     • apply context-suppression rules
        │
        ├──► alerts topic ──► alert store (Elasticsearch/OpenSearch) ──► dashboard API
        └──► scored-events ──► data lake (Parquet, partitioned by date/user)
```

## Why this maps cleanly from the local code

| Local component | Production equivalent |
|---|---|
| `loader.derive_log_features` | Stateless map in the stream — pure per-event derivation. |
| `features.add_cohort_baselines` | Precomputed offline (daily batch) → cohort stats in Redis/RocksDB; looked up per event. Baselines change slowly, so refresh daily. |
| `features.build_user_features` | Per-user **stateful** aggregation in Flink keyed state (rolling counts, rates) with TTL. |
| `detector._event_rules` | Identical pure function — ships unchanged into the stream operator. |
| IsolationForest | Train offline on a rolling window, **broadcast** the model; score in-stream. Retrain nightly. |
| `context.legitimate_exception` | Pure function + a small exceptions/allowlist table (on-call calendar, approved jobs) loaded as broadcast state. |
| `scoring` / `narrative` | Stateless per-event. |

## Throughput & partitioning
- **Partition by `user_id`** — keeps each user's rolling state and first-seen-resource
  novelty local to one task; no cross-partition shuffle on the hot path.
- 100/sec peak is trivial for a single Flink task; partitioning is for state locality
  and horizontal headroom, not raw throughput.
- Cohort baseline + IsolationForest are **broadcast** (small), so every task scores
  independently.

## Latency budget (PS target <5 min)
End-to-end p99 well under a minute: ingest→Kafka (<1s), enrichment+scoring (<100ms),
alert index + push. Most budget is shipping/queueing, not compute.

## Storage & cost
- Hot alerts in OpenSearch (30–90 days) for the dashboard.
- All scored events to Parquet in the lake (cheap, partitioned) for retraining,
  audit, and backtesting new rules.
- Model + cohort baselines versioned in object storage for reproducibility.

## Operational concerns
- **Backpressure / replay**: Kafka retention lets us replay after a model bug.
- **Drift**: monitor alert rate per cohort; a spike usually means a baseline needs
  refresh, not a real wave of attacks.
- **Feedback loop**: analyst dispositions (true/false positive) flow back to tune rule
  weights and the exceptions table — closing the loop the PS rubric asks for.
