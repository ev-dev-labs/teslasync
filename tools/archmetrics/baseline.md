# TeslaSync architecture metrics — baseline

_Generated 2026-05-28T07:44:15Z, Go go1.26.1, commit 79478baa16fcab329f67b60279a0d0c275c9946a_

## Summary

- Packages: 256
- doc.go coverage: 100.0%
- Forbidden edges detected: 1
- Total non-blank LOC under cmd/+internal/+tools/: 373678

## cmd/* main.go LOC

| cmd | LOC |
|---|---:|
| cmd/ai-eval/main.go | 151 |
| cmd/audit-signal-types/main.go | 498 |
| cmd/automation-worker/main.go | 350 |
| cmd/backup-verify/main.go | 95 |
| cmd/chaos-runner/main.go | 144 |
| cmd/export-worker/main.go | 250 |
| cmd/fleet-config-validator/main.go | 327 |
| cmd/metric-coverage-audit/main.go | 126 |
| cmd/notification-worker/main.go | 519 |
| cmd/ocpp-server/main.go | 91 |
| cmd/protogen-tesla/main.go | 73 |
| cmd/pub-test-signal/main.go | 655 |
| cmd/resubscribe/main.go | 446 |
| cmd/slo-coverage-audit/main.go | 199 |
| cmd/slogen/main.go | 356 |
| cmd/teslasync/main.go | 71 |
| cmd/trace-coverage-audit/main.go | 381 |
| cmd/unit-drift-validator/main.go | 154 |

## Forbidden edges

- internal/handler/middleware -> internal/database (rule: internal/handler/* -> internal/database)

## Per-package metrics

| Package | .go | _test.go | LOC | doc.go | Layer |
|---|---:|---:|---:|:---:|---|
| cmd/ai-eval | 2 | 0 | 155 | yes | cmd-internal |
| cmd/audit-signal-types | 2 | 0 | 521 | yes | cmd-internal |
| cmd/automation-worker | 2 | 0 | 354 | yes | cmd-internal |
| cmd/backup-verify | 2 | 0 | 109 | yes | cmd-internal |
| cmd/chaos-runner | 2 | 0 | 156 | yes | cmd-internal |
| cmd/export-worker | 2 | 0 | 254 | yes | cmd-internal |
| cmd/fleet-config-validator | 2 | 1 | 491 | yes | cmd-internal |
| cmd/metric-coverage-audit | 2 | 0 | 130 | yes | cmd-internal |
| cmd/notification-worker | 2 | 0 | 523 | yes | cmd-internal |
| cmd/ocpp-server | 2 | 0 | 103 | yes | cmd-internal |
| cmd/protogen-tesla | 4 | 1 | 2297 | yes | cmd-internal |
| cmd/protogen-tesla/testdata/golden | 4 | 0 | 265 | yes | cmd-internal |
| cmd/pub-test-signal | 2 | 0 | 659 | yes | cmd-internal |
| cmd/resubscribe | 2 | 1 | 671 | yes | cmd-internal |
| cmd/slo-coverage-audit | 2 | 0 | 203 | yes | cmd-internal |
| cmd/slogen | 5 | 4 | 1342 | yes | cmd-internal |
| cmd/teslasync | 6 | 1 | 144 | yes | cmd-internal |
| cmd/trace-coverage-audit | 2 | 0 | 385 | yes | cmd-internal |
| cmd/unit-drift-validator | 2 | 1 | 296 | yes | cmd-internal |
| internal/adapter/gasprices | 2 | 1 | 358 | yes | adapter |
| internal/adapter/geocoding | 2 | 0 | 35 | yes | adapter |
| internal/adapter/mqtt | 2 | 0 | 83 | yes | adapter |
| internal/adapter/postgres | 8 | 0 | 461 | yes | adapter |
| internal/adapter/postgres/queries | 8 | 0 | 317 | yes | adapter |
| internal/adapter/redis | 2 | 0 | 59 | yes | adapter |
| internal/adapter/storage | 2 | 0 | 65 | yes | adapter |
| internal/adapter/tesla | 3 | 0 | 200 | yes | adapter |
| internal/ai/cost | 2 | 1 | 475 | yes | platform |
| internal/ai/dispatch | 5 | 2 | 1439 | yes | platform |
| internal/ai/eval | 8 | 6 | 1918 | yes | tool |
| internal/ai/features | 3 | 2 | 4703 | yes | platform |
| internal/ai/guard | 2 | 1 | 281 | yes | platform |
| internal/ai/health | 2 | 1 | 560 | yes | platform |
| internal/ai/limit | 6 | 5 | 1839 | yes | platform |
| internal/ai/provider | 12 | 10 | 4011 | yes | port |
| internal/ai/provider/anthropic | 2 | 1 | 547 | yes | adapter |
| internal/ai/provider/azure | 2 | 1 | 1134 | yes | adapter |
| internal/ai/provider/mock | 3 | 2 | 872 | yes | adapter |
| internal/ai/provider/ollama | 2 | 1 | 666 | yes | adapter |
| internal/ai/provider/openai | 2 | 1 | 595 | yes | adapter |
| internal/ai/rag | 9 | 7 | 2164 | yes | platform |
| internal/ai/redact | 8 | 5 | 2445 | yes | platform |
| internal/ai/strategies/alert-tuning-suggestions | 2 | 1 | 433 | yes | adapter |
| internal/ai/strategies/anomaly-explanations | 2 | 1 | 335 | yes | adapter |
| internal/ai/strategies/auto-name-unnamed-locations | 2 | 1 | 413 | yes | adapter |
| internal/ai/strategies/auto-trip-naming | 2 | 1 | 404 | yes | adapter |
| internal/ai/strategies/battery-health-forecast-narrative | 2 | 1 | 401 | yes | adapter |
| internal/ai/strategies/cabin-temperature-impact-narrative | 2 | 1 | 423 | yes | adapter |
| internal/ai/strategies/charging-curve-fingerprint-clustering | 2 | 1 | 410 | yes | adapter |
| internal/ai/strategies/charging-diagnosis | 2 | 1 | 393 | yes | adapter |
| internal/ai/strategies/chatbot-llm | 2 | 1 | 294 | yes | adapter |
| internal/ai/strategies/cost-forecast-narration | 2 | 1 | 428 | yes | adapter |
| internal/ai/strategies/cross-rule-conflict-detection | 2 | 1 | 469 | yes | adapter |
| internal/ai/strategies/data-repair-suggestions | 2 | 1 | 388 | yes | adapter |
| internal/ai/strategies/digest-narration | 2 | 1 | 304 | yes | adapter |
| internal/ai/strategies/drive-coaching | 2 | 1 | 365 | yes | adapter |
| internal/ai/strategies/feedback-queue-triage | 2 | 1 | 419 | yes | adapter |
| internal/ai/strategies/geofence-aware-automation-suggestions | 2 | 1 | 408 | yes | adapter |
| internal/ai/strategies/inbox-auto-categorization | 2 | 1 | 454 | yes | adapter |
| internal/ai/strategies/incident-timeline-summarizer | 2 | 1 | 401 | yes | adapter |
| internal/ai/strategies/learned-per-vehicle-anomaly-baselines | 2 | 1 | 392 | yes | adapter |
| internal/ai/strategies/lifetime-stats-qa | 2 | 1 | 422 | yes | adapter |
| internal/ai/strategies/log-trace-summarization | 2 | 1 | 380 | yes | adapter |
| internal/ai/strategies/ml-charging-curve-clustering | 2 | 1 | 418 | yes | adapter |
| internal/ai/strategies/mqtt-sse-inspector-explanations | 2 | 1 | 389 | yes | adapter |
| internal/ai/strategies/nl-alert-builder | 2 | 1 | 350 | yes | adapter |
| internal/ai/strategies/nl-automation-builder | 2 | 1 | 357 | yes | adapter |
| internal/ai/strategies/nl-dashboard-composer | 2 | 1 | 414 | yes | adapter |
| internal/ai/strategies/nl-drive-search-replay | 2 | 1 | 357 | yes | adapter |
| internal/ai/strategies/nl-grafana-panel | 2 | 1 | 430 | yes | adapter |
| internal/ai/strategies/nl-search | 2 | 1 | 378 | yes | adapter |
| internal/ai/strategies/nl-sql-playground | 2 | 1 | 398 | yes | adapter |
| internal/ai/strategies/period-compare-narration | 2 | 1 | 411 | yes | adapter |
| internal/ai/strategies/pii-redaction-shared-exports | 2 | 1 | 435 | yes | adapter |
| internal/ai/strategies/predictive-maintenance | 2 | 1 | 398 | yes | adapter |
| internal/ai/strategies/preheat-precool-recommender | 2 | 1 | 440 | yes | adapter |
| internal/ai/strategies/quiet-hours-suggestion | 2 | 1 | 458 | yes | adapter |
| internal/ai/strategies/rag-help | 2 | 1 | 389 | yes | adapter |
| internal/ai/strategies/range-prediction-model | 2 | 1 | 406 | yes | adapter |
| internal/ai/strategies/route-efficiency-suggestions | 2 | 1 | 382 | yes | adapter |
| internal/ai/strategies/safety-setting-explainer | 2 | 1 | 405 | yes | adapter |
| internal/ai/strategies/signal-explorer-nl-filter | 2 | 1 | 392 | yes | adapter |
| internal/ai/strategies/smart-charge-schedule-suggestion | 2 | 1 | 418 | yes | adapter |
| internal/ai/strategies/software-update-changelog-summarizer | 2 | 1 | 429 | yes | adapter |
| internal/ai/strategies/speed-profile-insights | 2 | 1 | 392 | yes | adapter |
| internal/ai/strategies/state-machine-debugger-narrator | 2 | 1 | 398 | yes | adapter |
| internal/ai/strategies/suggest-new-geofences | 2 | 1 | 406 | yes | adapter |
| internal/ai/strategies/tco-narration | 2 | 1 | 456 | yes | adapter |
| internal/ai/strategies/tire-pressure-trend-reasoning | 2 | 1 | 433 | yes | adapter |
| internal/ai/strategies/trip-planner-llm-agent | 2 | 1 | 423 | yes | adapter |
| internal/ai/strategies/trip-postcard-share-card-image-generation | 2 | 1 | 258 | yes | adapter |
| internal/ai/strategies/vampire-drain-explanation | 2 | 1 | 450 | yes | adapter |
| internal/ai/strategies/vehicle-paint-preview | 2 | 1 | 242 | yes | adapter |
| internal/ai/strategies/voice-mode | 2 | 1 | 406 | yes | adapter |
| internal/ai/strategies/watch-face-nl-response | 2 | 1 | 422 | yes | adapter |
| internal/ai/strategies/yir-narration | 2 | 1 | 311 | yes | adapter |
| internal/ai/strategy | 2 | 1 | 160 | yes | port |
| internal/ai/strategy/redactadapter | 2 | 1 | 134 | yes | adapter |
| internal/ai/stream | 2 | 1 | 1188 | yes | platform |
| internal/ai/tools | 16 | 12 | 9731 | yes | platform |
| internal/ai/tools/alert | 3 | 2 | 1754 | yes |  |
| internal/ai/tools/anomaly | 2 | 1 | 571 | yes | domain |
| internal/ai/tools/charge | 2 | 1 | 611 | yes | domain |
| internal/ai/tools/coaching | 2 | 1 | 677 | yes | domain |
| internal/ai/tools/diagnosis | 2 | 1 | 1097 | yes | domain |
| internal/ai/tools/diagnostic | 4 | 3 | 4366 | yes | domain |
| internal/ai/tools/digest | 2 | 1 | 565 | yes | domain |
| internal/ai/tools/export | 2 | 1 | 1268 | yes | domain |
| internal/ai/tools/feedback | 2 | 1 | 1601 | yes |  |
| internal/ai/tools/forecast | 4 | 3 | 1893 | yes |  |
| internal/ai/tools/lifetime | 4 | 3 | 2384 | yes | domain |
| internal/ai/tools/location | 3 | 2 | 1724 | yes |  |
| internal/ai/tools/maintenance | 3 | 1 | 1401 | yes | domain |
| internal/ai/tools/nl | 4 | 3 | 3176 | yes | domain |
| internal/ai/tools/nlq | 4 | 0 | 1921 | yes | domain |
| internal/ai/tools/paint | 2 | 1 | 558 | yes | domain |
| internal/ai/tools/predict | 4 | 3 | 1531 | yes | domain |
| internal/ai/tools/safety | 2 | 1 | 560 | yes |  |
| internal/ai/tools/schedule | 4 | 3 | 2821 | yes | domain |
| internal/ai/tools/summary | 5 | 4 | 4219 | yes | domain |
| internal/ai/tools/toolstest | 2 | 0 | 176 | yes | domain |
| internal/ai/tools/trip | 4 | 4 | 2511 | yes | domain |
| internal/ai/tools/voice | 2 | 0 | 476 | yes | domain |
| internal/ai/tools/yir | 2 | 1 | 568 | yes | domain |
| internal/alertmsg | 3 | 1 | 981 | yes | domain |
| internal/api | 271 | 163 | 126547 | yes | handler |
| internal/apilog | 4 | 1 | 496 | yes | platform |
| internal/app | 6 | 1 | 1832 | yes | app |
| internal/app/adminobssvc | 3 | 0 | 167 | yes | app |
| internal/app/auditviewersvc | 3 | 0 | 77 | yes | app |
| internal/app/chargingsvc | 2 | 1 | 301 | yes | app |
| internal/app/dashboardsvc | 2 | 1 | 322 | yes | app |
| internal/app/exportsvc | 2 | 1 | 280 | yes | app |
| internal/app/gdprexportsvc | 2 | 0 | 68 | yes | app |
| internal/app/notificationsvc | 2 | 1 | 311 | yes | app |
| internal/app/tripsvc | 2 | 1 | 314 | yes | app |
| internal/app/vehiclesvc | 3 | 1 | 350 | yes | app |
| internal/arch | 2 | 1 | 1117 | yes | tool |
| internal/audit | 2 | 1 | 375 | yes | platform |
| internal/auth | 6 | 4 | 2384 | yes | platform |
| internal/automation | 6 | 2 | 1611 | yes | platform |
| internal/automation/action | 6 | 5 | 3827 | yes | platform |
| internal/automation/condition | 9 | 8 | 3653 | yes | platform |
| internal/automation/presets | 3 | 1 | 595 | yes | platform |
| internal/automation/safety | 7 | 6 | 3565 | yes | platform |
| internal/automation/trigger | 7 | 0 | 947 | yes | platform |
| internal/backup | 3 | 1 | 668 | yes | platform |
| internal/backupverify | 2 | 1 | 314 | yes | platform |
| internal/cache | 3 | 1 | 262 | yes | platform |
| internal/chaos | 3 | 1 | 423 | yes | tool |
| internal/config | 3 | 1 | 722 | yes | platform |
| internal/crypto | 3 | 2 | 666 | yes | platform |
| internal/database | 108 | 35 | 27851 | yes | platform |
| internal/dataquality | 4 | 0 | 347 | yes | platform |
| internal/domain | 2 | 1 | 114 | yes | domain |
| internal/domain/charging | 6 | 1 | 357 | yes | domain |
| internal/domain/export | 3 | 1 | 126 | yes | domain |
| internal/domain/fsm | 6 | 1 | 992 | yes | domain |
| internal/domain/notification | 3 | 1 | 116 | yes | domain |
| internal/domain/trip | 4 | 1 | 146 | yes | domain |
| internal/domain/user | 3 | 1 | 98 | yes | domain |
| internal/domain/vehicle | 5 | 1 | 350 | yes | domain |
| internal/enums | 5 | 1 | 304 | yes | platform |
| internal/events | 2 | 1 | 145 | yes | platform |
| internal/export | 9 | 3 | 3060 | yes | platform |
| internal/export/gdpr | 2 | 0 | 254 | yes | platform |
| internal/flags | 2 | 1 | 556 | yes | platform |
| internal/fsm | 11 | 3 | 2507 | yes | platform |
| internal/fsm/automation | 2 | 1 | 798 | yes | platform |
| internal/fsm/charge | 3 | 1 | 621 | yes | platform |
| internal/fsm/command | 2 | 1 | 410 | yes | platform |
| internal/fsm/drive | 4 | 1 | 706 | yes | platform |
| internal/fsm/notification | 2 | 1 | 280 | yes | platform |
| internal/fsm/telemetry | 3 | 1 | 734 | yes | platform |
| internal/geocoding | 6 | 1 | 532 | yes | platform |
| internal/handler/dto | 6 | 0 | 94 | yes | handler |
| internal/handler/middleware | 11 | 1 | 829 | yes | handler |
| internal/handler/v1 | 11 | 1 | 828 | yes | handler |
| internal/imaging | 2 | 1 | 510 | yes | platform |
| internal/integrations | 2 | 0 | 134 | yes | platform |
| internal/integrations/homeassistant | 3 | 1 | 515 | yes | adapter |
| internal/jobs | 1 | 0 | 21 | yes | platform |
| internal/jobs/digests | 3 | 2 | 579 | yes |  |
| internal/jobs/embeddings | 2 | 1 | 262 | yes | platform |
| internal/jobs/indexers | 8 | 7 | 2108 | yes |  |
| internal/jobs/triage | 3 | 2 | 621 | yes |  |
| internal/metrics | 6 | 2 | 1073 | yes | platform |
| internal/ml/anomaly | 3 | 1 | 746 | yes | platform |
| internal/ml/chargingcurves | 2 | 1 | 928 | yes | platform |
| internal/ml/range | 3 | 1 | 1017 | yes | platform |
| internal/models | 18 | 1 | 849 | yes | domain |
| internal/models/alert | 2 | 1 | 259 | yes | domain |
| internal/models/auth | 2 | 1 | 66 | yes | domain |
| internal/models/automation | 2 | 0 | 55 | yes | domain |
| internal/models/backup | 2 | 0 | 59 | yes | domain |
| internal/models/charging | 2 | 1 | 109 | yes | domain |
| internal/models/chatbot | 2 | 0 | 38 | yes | domain |
| internal/models/dashboard | 5 | 0 | 190 | yes | domain |
| internal/models/drive | 2 | 1 | 142 | yes | domain |
| internal/models/energy | 2 | 0 | 27 | yes | domain |
| internal/models/export | 2 | 0 | 59 | yes | domain |
| internal/models/geo | 2 | 0 | 44 | yes | domain |
| internal/models/notification | 3 | 0 | 129 | yes | domain |
| internal/models/security | 2 | 0 | 41 | yes | domain |
| internal/models/settings | 2 | 0 | 177 | yes | domain |
| internal/models/signal | 3 | 0 | 111 | yes | domain |
| internal/models/system | 2 | 0 | 479 | yes | domain |
| internal/models/telemetry | 3 | 0 | 77 | yes | domain |
| internal/models/tesla | 3 | 0 | 268 | yes | domain |
| internal/models/vehicle | 2 | 1 | 273 | yes | domain |
| internal/mqtt | 7 | 7 | 4273 | yes | platform |
| internal/notification | 4 | 2 | 1244 | yes | platform |
| internal/notification/computed | 4 | 1 | 1004 | yes | platform |
| internal/notifier | 2 | 1 | 450 | yes | platform |
| internal/ocpp | 5 | 1 | 972 | yes | adapter |
| internal/outbox | 4 | 1 | 846 | yes | platform |
| internal/platform | 3 | 2 | 702 | yes | platform |
| internal/platform/buildinfo | 2 | 1 | 91 | yes | platform |
| internal/platform/cache | 2 | 0 | 101 | yes | platform |
| internal/platform/config | 2 | 1 | 326 | yes | platform |
| internal/platform/database | 3 | 0 | 138 | yes | platform |
| internal/platform/httputil | 10 | 8 | 2242 | yes | platform |
| internal/platform/telemetry | 3 | 0 | 87 | yes | platform |
| internal/polling | 11 | 1 | 1413 | yes | platform |
| internal/port/external | 5 | 0 | 87 | yes | port |
| internal/port/messaging | 3 | 1 | 272 | yes | port |
| internal/port/repository | 8 | 0 | 110 | yes | port |
| internal/resilience | 2 | 4 | 721 | yes | platform |
| internal/rotation | 2 | 1 | 360 | yes | platform |
| internal/schemacheck | 2 | 1 | 234 | yes | platform |
| internal/service | 4 | 1 | 1378 | yes | platform |
| internal/signal | 11 | 11 | 7540 | yes | platform |
| internal/signal/signaltest | 2 | 0 | 103 | yes | platform |
| internal/slo | 3 | 1 | 727 | yes | platform |
| internal/synthetic | 3 | 1 | 393 | yes | platform |
| internal/tesla | 11 | 3 | 2266 | yes | platform |
| internal/tesla/bootstrap | 3 | 1 | 1037 | yes | platform |
| internal/tesla/codec | 6 | 4 | 2932 | yes | platform |
| internal/tesla/config | 3 | 1 | 473 | yes | platform |
| internal/tesla/normalize | 7 | 5 | 2359 | yes | platform |
| internal/tesla/protomodel | 7 | 3 | 5071 | yes | platform |
| internal/tesla/router | 5 | 3 | 1180 | yes | platform |
| internal/tesla/router/writers | 15 | 13 | 6855 | yes | platform |
| internal/tesla/unit_history | 4 | 2 | 1673 | yes | platform |
| internal/tesla/units | 4 | 1 | 573 | yes | platform |
| internal/tesla_pipeline | 3 | 6 | 3222 | yes | platform |
| internal/tracing | 5 | 3 | 607 | yes | platform |
| internal/units | 2 | 0 | 63 | yes | platform |
| internal/v2h | 2 | 1 | 554 | yes | platform |
| internal/webpush | 2 | 1 | 519 | yes | platform |
| internal/worker | 8 | 3 | 2596 | yes | platform |
| tools/aigen | 2 | 1 | 338 | yes | tool |
| tools/aistream-contract | 2 | 0 | 227 | yes | tool |
| tools/aivet | 2 | 1 | 792 | yes | tool |
| tools/archmetrics | 2 | 0 | 860 | yes | tool |
| tools/eval-schema-check | 2 | 0 | 57 | yes | tool |

## doc.go adoption

- Packages WITHOUT doc.go: 0

## Phase R — bounded-context restructure progress (REPORT-ONLY)

_Per ADR-011 (`docs/architecture/adr/011-bounded-context-subpackages.md`). This section is informational only — it never fails the gate. The DAG flip to enforced per-subpkg rules happens in Phase R13._

| Hot-spot | Owner | Files@R0 | Flat parent now (.go / _test.go) | Planned | Existing | Missing |
|---|---|---:|---|---:|---:|---:|
| `internal/models` | R5 | 36 | 18 / 1 | 19 | 19 | 0 |
| `internal/jobs` | R6 | 23 | 1 / 0 | 4 | 4 | 0 |
| `internal/ai/tools` | R6 | 109 | 16 / 12 | 13 | 7 | 6 |
| `internal/database` | R4 | 143 | 108 / 35 | 22 | 0 | 22 |
| `internal/handler/v1` | R3 | 12 | 11 / 1 | 9 | 0 | 9 |
| `internal/api` | R2 (waves R2a-R2e) | 434 | 271 / 163 | 59 | 0 | 59 |

### `internal/models` detail

> 19 subpkgs (R5.0 expanded from 12 after models.go classification: +auth, +backup, +chatbot, +energy, +export, +geo, +settings). models.go split into its targets; unused DerefFloat64/String/Bool helpers deleted per no-tech-debt mandate. Smallest-first execution; parent retains only doc.go after R5 completes.

**Existing subpackages on disk:**
- `internal/models/alert`
- `internal/models/auth`
- `internal/models/automation`
- `internal/models/backup`
- `internal/models/charging`
- `internal/models/chatbot`
- `internal/models/dashboard`
- `internal/models/drive`
- `internal/models/energy`
- `internal/models/export`
- `internal/models/geo`
- `internal/models/notification`
- `internal/models/security`
- `internal/models/settings`
- `internal/models/signal`
- `internal/models/system`
- `internal/models/telemetry`
- `internal/models/tesla`
- `internal/models/vehicle`

### `internal/jobs` detail

> 4 subpkgs: embeddings (done R0.5), indexers (7 ai_*_indexer + tests), triage (alert+feedback), digests (weekly+yir).

**Existing subpackages on disk:**
- `internal/jobs/embeddings`
- `internal/jobs/indexers`
- `internal/jobs/triage`
- `internal/jobs/digests`

### `internal/ai/tools` detail

> 13 subpkgs from R1 audit. Per ADR-015 amendment, pure file-move only. Registry/schema/builtins/tool/validate stay at parent.

**Existing subpackages on disk:**
- `internal/ai/tools/alert`
- `internal/ai/tools/feedback`
- `internal/ai/tools/forecast`
- `internal/ai/tools/location`
- `internal/ai/tools/nl`
- `internal/ai/tools/safety`
- `internal/ai/tools/summary`

**Planned but not yet on disk:**
- `internal/ai/tools/automation`
- `internal/ai/tools/battery`
- `internal/ai/tools/charging`
- `internal/ai/tools/diagnostics`
- `internal/ai/tools/drive`
- `internal/ai/tools/share`

### `internal/database` detail

> 22 subpkgs from R1 audit. Touches many internal/api/* callers — accept R2 double-touch budget (no temp compat layer).

**Planned but not yet on disk:**
- `internal/database/achievement`
- `internal/database/ai`
- `internal/database/alert`
- `internal/database/audit`
- `internal/database/auth`
- `internal/database/automation`
- `internal/database/backup`
- `internal/database/charging`
- `internal/database/dashboard`
- `internal/database/drive`
- `internal/database/energy`
- `internal/database/export`
- `internal/database/feedback`
- `internal/database/geo`
- `internal/database/ingest`
- `internal/database/notification`
- `internal/database/onboarding`
- `internal/database/settings`
- `internal/database/signal`
- `internal/database/system`
- `internal/database/tesla`
- `internal/database/vehicle`

### `internal/handler/v1` detail

> 9 subpkgs from R1 audit. Tiny but critical — defines destination shape (Mount(r,deps) pattern) for R2 to adopt 1:1.

**Planned but not yet on disk:**
- `internal/handler/v1/admin`
- `internal/handler/v1/charging`
- `internal/handler/v1/dashboard`
- `internal/handler/v1/export`
- `internal/handler/v1/gdpr`
- `internal/handler/v1/trip`
- `internal/handler/v1/user`
- `internal/handler/v1/vehicle`
- `internal/handler/v1/shared`

### `internal/api` detail

> 55 subpkgs + 4 shared infra from R1 audit. Largest cluster. Extracted in 5 waves (R2a-R2e). R2.0 prep extracts httpx/apiparams/apitest/middleware first. ai/ has 14 sub-subpkgs (see cluster-map.md).

**Planned but not yet on disk:**
- `internal/api/system`
- `internal/api/health`
- `internal/api/sse`
- `internal/api/openapi`
- `internal/api/devtools`
- `internal/api/observability`
- `internal/api/analytics`
- `internal/api/anomaly`
- `internal/api/lifetime`
- `internal/api/mileage`
- `internal/api/sleep`
- `internal/api/regen`
- `internal/api/vampiredrain`
- `internal/api/tco`
- `internal/api/tempimpact`
- `internal/api/speed`
- `internal/api/routeeff`
- `internal/api/signal`
- `internal/api/dataquality`
- `internal/api/fsm`
- `internal/api/search`
- `internal/api/diagnostic`
- `internal/api/cost`
- `internal/api/vehicle`
- `internal/api/vehiclesys`
- `internal/api/charging`
- `internal/api/drive`
- `internal/api/trip`
- `internal/api/telemetry`
- `internal/api/fleet`
- `internal/api/energy`
- `internal/api/teslaapi`
- `internal/api/ai`
- `internal/api/admin`
- `internal/api/automation`
- `internal/api/alert`
- `internal/api/notification`
- `internal/api/chatbot`
- `internal/api/feedback`
- `internal/api/data_repair`
- `internal/api/dashboard`
- `internal/api/saved_views`
- `internal/api/auth`
- `internal/api/onboarding`
- `internal/api/user`
- `internal/api/settings`
- `internal/api/share`
- `internal/api/exports`
- `internal/api/ingest`
- `internal/api/geo`
- `internal/api/safety`
- `internal/api/bulk`
- `internal/api/api_call_log`
- `internal/api/audit`
- `internal/api/maintenance`
- `internal/api/software_update`
- `internal/api/watch`
- `internal/api/webhook`
- `internal/api/webvitals`

**Shared-helper subpackages (extracted in prep sub-phase):**
- `internal/api/httpx`
- `internal/api/apiparams`
- `internal/api/apitest`
- `internal/api/middleware`

