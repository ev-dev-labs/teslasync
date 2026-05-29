# TeslaSync architecture metrics — baseline

_Generated 2026-05-29T08:21:02Z, Go go1.26.1, commit 444f1182853849c1889c5af331f783d7d0eb3abe_

## Summary

- Packages: 478
- doc.go coverage: 100.0%
- Forbidden edges detected: 1
- Total non-blank LOC under cmd/+internal/+tools/: 383059

## cmd/* main.go LOC

| cmd | LOC |
|---|---:|
| cmd/ai-eval/main.go | 151 |
| cmd/audit-signal-types/main.go | 498 |
| cmd/automation-worker/main.go | 356 |
| cmd/backup-verify/main.go | 96 |
| cmd/chaos-runner/main.go | 144 |
| cmd/export-worker/main.go | 252 |
| cmd/fleet-config-validator/main.go | 327 |
| cmd/metric-coverage-audit/main.go | 126 |
| cmd/notification-worker/main.go | 524 |
| cmd/ocpp-server/main.go | 91 |
| cmd/protogen-tesla/main.go | 73 |
| cmd/pub-test-signal/main.go | 655 |
| cmd/resubscribe/main.go | 447 |
| cmd/slo-coverage-audit/main.go | 199 |
| cmd/slogen/main.go | 356 |
| cmd/teslasync/main.go | 71 |
| cmd/trace-coverage-audit/main.go | 381 |
| cmd/unit-drift-validator/main.go | 155 |

## Forbidden edges

- internal/handler/middleware -> internal/database (rule: internal/handler/* -> internal/database)

## Per-package metrics

| Package | .go | _test.go | LOC | doc.go | Layer |
|---|---:|---:|---:|:---:|---|
| cmd/ai-eval | 2 | 0 | 155 | yes | cmd-internal |
| cmd/audit-signal-types | 2 | 0 | 521 | yes | cmd-internal |
| cmd/automation-worker | 2 | 0 | 360 | yes | cmd-internal |
| cmd/backup-verify | 2 | 0 | 110 | yes | cmd-internal |
| cmd/chaos-runner | 2 | 0 | 156 | yes | cmd-internal |
| cmd/export-worker | 2 | 0 | 256 | yes | cmd-internal |
| cmd/fleet-config-validator | 2 | 1 | 491 | yes | cmd-internal |
| cmd/metric-coverage-audit | 2 | 0 | 130 | yes | cmd-internal |
| cmd/notification-worker | 2 | 0 | 528 | yes | cmd-internal |
| cmd/ocpp-server | 2 | 0 | 103 | yes | cmd-internal |
| cmd/protogen-tesla | 4 | 1 | 2297 | yes | cmd-internal |
| cmd/protogen-tesla/testdata/golden | 4 | 0 | 265 | yes | cmd-internal |
| cmd/pub-test-signal | 2 | 0 | 659 | yes | cmd-internal |
| cmd/resubscribe | 2 | 1 | 672 | yes | cmd-internal |
| cmd/slo-coverage-audit | 2 | 0 | 203 | yes | cmd-internal |
| cmd/slogen | 5 | 4 | 1342 | yes | cmd-internal |
| cmd/teslasync | 6 | 1 | 144 | yes | cmd-internal |
| cmd/trace-coverage-audit | 2 | 0 | 385 | yes | cmd-internal |
| cmd/unit-drift-validator | 2 | 1 | 297 | yes | cmd-internal |
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
| internal/ai/tools | 11 | 7 | 4231 | yes | platform |
| internal/ai/tools/alert | 3 | 2 | 1752 | yes | adapter |
| internal/ai/tools/anomaly | 2 | 1 | 571 | yes | domain |
| internal/ai/tools/automation | 2 | 1 | 1059 | yes | domain |
| internal/ai/tools/charge | 2 | 1 | 611 | yes | domain |
| internal/ai/tools/coaching | 2 | 1 | 677 | yes | domain |
| internal/ai/tools/curve | 2 | 1 | 1194 | yes | domain |
| internal/ai/tools/diagnosis | 2 | 1 | 1097 | yes | domain |
| internal/ai/tools/diagnostic | 4 | 3 | 4366 | yes | domain |
| internal/ai/tools/digest | 2 | 1 | 565 | yes | domain |
| internal/ai/tools/export | 2 | 1 | 1268 | yes | domain |
| internal/ai/tools/feedback | 2 | 1 | 1601 | yes | domain |
| internal/ai/tools/forecast | 4 | 3 | 1893 | yes |  |
| internal/ai/tools/lifetime | 4 | 3 | 2384 | yes | domain |
| internal/ai/tools/location | 3 | 2 | 1722 | yes | adapter |
| internal/ai/tools/maintenance | 3 | 1 | 1401 | yes | domain |
| internal/ai/tools/nl | 4 | 3 | 3176 | yes | domain |
| internal/ai/tools/nlq | 4 | 0 | 1921 | yes | domain |
| internal/ai/tools/paint | 2 | 1 | 558 | yes | domain |
| internal/ai/tools/predict | 4 | 3 | 1531 | yes | domain |
| internal/ai/tools/route | 2 | 1 | 1166 | yes | domain |
| internal/ai/tools/safety | 2 | 1 | 558 | yes | adapter |
| internal/ai/tools/schedule | 4 | 3 | 2821 | yes | domain |
| internal/ai/tools/speed | 2 | 1 | 995 | yes | domain |
| internal/ai/tools/summary | 5 | 4 | 4219 | yes | domain |
| internal/ai/tools/toolstest | 2 | 0 | 176 | yes | domain |
| internal/ai/tools/trip | 4 | 4 | 2511 | yes | domain |
| internal/ai/tools/tripplan | 2 | 1 | 1354 | yes | domain |
| internal/ai/tools/voice | 2 | 0 | 476 | yes | domain |
| internal/ai/tools/yir | 2 | 1 | 568 | yes | domain |
| internal/alertmsg | 3 | 1 | 981 | yes | domain |
| internal/api | 38 | 29 | 19463 | yes | handler |
| internal/api/adminfeedback | 2 | 1 | 680 | yes | handler |
| internal/api/adminlogstream | 2 | 1 | 688 | yes | handler |
| internal/api/adminmaintenance | 2 | 1 | 604 | yes | handler |
| internal/api/aialert | 2 | 1 | 539 | yes | handler |
| internal/api/aialerttune | 2 | 1 | 843 | yes | handler |
| internal/api/aianomaly | 2 | 1 | 453 | yes | handler |
| internal/api/aiautomation | 2 | 1 | 552 | yes | handler |
| internal/api/aiautoname | 2 | 1 | 654 | yes | handler |
| internal/api/aiautotripname | 2 | 1 | 597 | yes | handler |
| internal/api/aibatthealth | 2 | 1 | 1059 | yes | handler |
| internal/api/aichargcurve | 2 | 1 | 446 | yes | handler |
| internal/api/aichargdiag | 2 | 1 | 485 | yes | handler |
| internal/api/aichatbot | 2 | 1 | 489 | yes | handler |
| internal/api/aiclimate | 2 | 1 | 772 | yes | handler |
| internal/api/aicostfcst | 2 | 1 | 492 | yes | handler |
| internal/api/aicrossrule | 2 | 1 | 715 | yes | handler |
| internal/api/aidatarep | 2 | 1 | 842 | yes | handler |
| internal/api/aidigest | 2 | 2 | 398 | yes | handler |
| internal/api/aidrivecoach | 2 | 1 | 451 | yes | handler |
| internal/api/aidrivesearch | 3 | 1 | 725 | yes | handler |
| internal/api/aifeedtri | 2 | 1 | 607 | yes | handler |
| internal/api/aifsmnar | 2 | 1 | 731 | yes | handler |
| internal/api/aigeofautom | 2 | 1 | 693 | yes | handler |
| internal/api/aiinboxcat | 2 | 1 | 775 | yes | handler |
| internal/api/aiincident | 2 | 1 | 593 | yes | handler |
| internal/api/ailifetime | 2 | 1 | 599 | yes | handler |
| internal/api/ailogtrace | 2 | 1 | 697 | yes | handler |
| internal/api/aimlanom | 2 | 1 | 507 | yes | handler |
| internal/api/aimlchargcv | 2 | 1 | 501 | yes | handler |
| internal/api/aimlrange | 2 | 1 | 517 | yes | handler |
| internal/api/aimqttsse | 2 | 1 | 708 | yes | handler |
| internal/api/ainldash | 2 | 1 | 875 | yes | handler |
| internal/api/ainlgrafana | 2 | 1 | 1120 | yes | handler |
| internal/api/ainlsql | 2 | 2 | 961 | yes | handler |
| internal/api/aiperiodcmp | 2 | 1 | 667 | yes | handler |
| internal/api/aipiiredact | 2 | 1 | 565 | yes | handler |
| internal/api/aipostcard | 2 | 1 | 502 | yes | handler |
| internal/api/aipredmaint | 2 | 1 | 906 | yes | handler |
| internal/api/aiquiethrs | 2 | 1 | 784 | yes | handler |
| internal/api/airaghelp | 2 | 1 | 483 | yes | handler |
| internal/api/airouteeff | 2 | 1 | 490 | yes | handler |
| internal/api/aisafetyexp | 2 | 1 | 818 | yes | handler |
| internal/api/aisearch | 3 | 1 | 704 | yes | handler |
| internal/api/aisettingsvalidate | 2 | 1 | 832 | yes | handler |
| internal/api/aisignalnl | 2 | 1 | 829 | yes | handler |
| internal/api/aismartcharge | 2 | 1 | 568 | yes | handler |
| internal/api/aispeedprof | 2 | 1 | 474 | yes | handler |
| internal/api/aisuggeo | 2 | 1 | 630 | yes | handler |
| internal/api/aiswupd | 2 | 1 | 963 | yes | handler |
| internal/api/aitconar | 2 | 1 | 592 | yes | handler |
| internal/api/aitempimpact | 2 | 1 | 793 | yes | handler |
| internal/api/aitirepress | 2 | 1 | 1223 | yes | handler |
| internal/api/aitripplanllm | 2 | 1 | 654 | yes | handler |
| internal/api/aiusage | 3 | 2 | 760 | yes | handler |
| internal/api/aivampire | 2 | 1 | 599 | yes | handler |
| internal/api/aivehpaint | 2 | 1 | 547 | yes | handler |
| internal/api/aivoice | 2 | 1 | 1078 | yes | handler |
| internal/api/aiwatchnl | 2 | 1 | 1149 | yes | handler |
| internal/api/aiyir | 2 | 1 | 413 | yes | handler |
| internal/api/alertmsg | 2 | 0 | 245 | yes | handler |
| internal/api/alerts | 7 | 4 | 3611 | yes | handler |
| internal/api/analytics | 4 | 1 | 764 | yes | handler |
| internal/api/anomaly | 2 | 2 | 801 | yes | handler |
| internal/api/apibulk | 2 | 1 | 460 | yes | handler |
| internal/api/apicalllog | 2 | 0 | 69 | yes | handler |
| internal/api/apiflagsh | 2 | 1 | 442 | yes | handler |
| internal/api/apikey | 2 | 0 | 165 | yes | handler |
| internal/api/apiparams | 2 | 1 | 363 | yes | handler |
| internal/api/apitest | 2 | 0 | 137 | yes | handler |
| internal/api/apperror | 3 | 1 | 508 | yes | handler |
| internal/api/audit | 2 | 0 | 180 | yes | handler |
| internal/api/auth | 2 | 0 | 152 | yes | handler |
| internal/api/authsession | 2 | 1 | 365 | yes | handler |
| internal/api/automation | 11 | 1 | 4620 | yes | handler |
| internal/api/backup | 3 | 1 | 530 | yes | handler |
| internal/api/battery | 2 | 1 | 418 | yes | handler |
| internal/api/batterycells | 2 | 1 | 459 | yes | handler |
| internal/api/batterydegradation | 4 | 2 | 1171 | yes | handler |
| internal/api/chargeheatmap | 2 | 0 | 161 | yes | handler |
| internal/api/chargeopt | 4 | 0 | 578 | yes | handler |
| internal/api/chargeplanner | 5 | 3 | 996 | yes | handler |
| internal/api/chargetelem | 2 | 1 | 319 | yes | handler |
| internal/api/charging | 3 | 1 | 767 | yes | handler |
| internal/api/chartannotation | 2 | 1 | 827 | yes | handler |
| internal/api/chatbot | 5 | 1 | 851 | yes | handler |
| internal/api/climate | 2 | 1 | 413 | yes | handler |
| internal/api/command | 2 | 1 | 343 | yes | handler |
| internal/api/costforecast | 2 | 1 | 640 | yes | handler |
| internal/api/dashboardlayout | 2 | 1 | 754 | yes | handler |
| internal/api/dataquality | 2 | 0 | 65 | yes | handler |
| internal/api/datarepair | 2 | 0 | 244 | yes | handler |
| internal/api/devtools | 5 | 1 | 1714 | yes | handler |
| internal/api/diagnostic | 2 | 1 | 933 | yes | handler |
| internal/api/dlq | 2 | 1 | 515 | yes | handler |
| internal/api/drivediagnostic | 2 | 1 | 458 | yes | handler |
| internal/api/drivedyn | 2 | 1 | 485 | yes | handler |
| internal/api/drives | 5 | 2 | 1818 | yes | handler |
| internal/api/drivetrain | 2 | 1 | 331 | yes | handler |
| internal/api/drivingcoach | 2 | 0 | 385 | yes | handler |
| internal/api/energy | 2 | 0 | 100 | yes | handler |
| internal/api/energyflow | 2 | 1 | 224 | yes | handler |
| internal/api/energysite | 2 | 0 | 274 | yes | handler |
| internal/api/exportcolumns | 2 | 1 | 167 | yes | handler |
| internal/api/exports | 3 | 1 | 864 | yes | handler |
| internal/api/feedback | 2 | 1 | 392 | yes | handler |
| internal/api/fleettelemetry | 3 | 1 | 627 | yes | handler |
| internal/api/gasprice | 2 | 0 | 138 | yes | handler |
| internal/api/geocode | 2 | 0 | 77 | yes | handler |
| internal/api/geofence | 3 | 1 | 846 | yes | handler |
| internal/api/guard | 2 | 1 | 1090 | yes | handler |
| internal/api/httpx | 3 | 2 | 360 | yes | handler |
| internal/api/impersonate | 2 | 1 | 910 | yes | handler |
| internal/api/importer | 2 | 0 | 240 | yes | handler |
| internal/api/inboundwebhook | 2 | 0 | 57 | yes | handler |
| internal/api/ingestxray | 2 | 1 | 429 | yes | handler |
| internal/api/lifetime | 2 | 1 | 878 | yes | handler |
| internal/api/locsnap | 2 | 1 | 538 | yes | handler |
| internal/api/maintenance | 2 | 0 | 119 | yes | handler |
| internal/api/media | 2 | 1 | 427 | yes | handler |
| internal/api/middleware | 4 | 2 | 763 | yes | handler |
| internal/api/mileage | 2 | 1 | 1267 | yes | handler |
| internal/api/motor | 2 | 1 | 842 | yes | handler |
| internal/api/notification | 5 | 2 | 2380 | yes | handler |
| internal/api/onboarding | 2 | 1 | 253 | yes | handler |
| internal/api/openapi | 2 | 0 | 38 | yes | handler |
| internal/api/periodstats | 2 | 0 | 157 | yes | handler |
| internal/api/pinned | 2 | 1 | 673 | yes | handler |
| internal/api/polling | 2 | 0 | 213 | yes | handler |
| internal/api/push | 2 | 1 | 608 | yes | handler |
| internal/api/queuestatus | 2 | 1 | 628 | yes | handler |
| internal/api/quiethours | 2 | 1 | 589 | yes | handler |
| internal/api/rangeproj | 4 | 2 | 1175 | yes | handler |
| internal/api/ratelimit | 2 | 1 | 533 | yes | handler |
| internal/api/rbac | 2 | 1 | 684 | yes | handler |
| internal/api/regen | 2 | 0 | 260 | yes | handler |
| internal/api/routeeff | 2 | 0 | 283 | yes | handler |
| internal/api/safety | 2 | 1 | 446 | yes | handler |
| internal/api/savedviews | 2 | 1 | 896 | yes | handler |
| internal/api/scheduledexports | 2 | 1 | 737 | yes | handler |
| internal/api/search | 2 | 1 | 1157 | yes | handler |
| internal/api/search/searchtest | 2 | 0 | 132 | yes | platform |
| internal/api/security | 2 | 1 | 496 | yes | handler |
| internal/api/session | 2 | 1 | 544 | yes | handler |
| internal/api/settings | 4 | 2 | 1221 | yes | handler |
| internal/api/settingsreset | 2 | 1 | 391 | yes | handler |
| internal/api/share | 2 | 0 | 345 | yes | handler |
| internal/api/signalinspect | 3 | 1 | 1228 | yes | handler |
| internal/api/signalscatalog | 2 | 1 | 976 | yes | handler |
| internal/api/sleep | 2 | 0 | 230 | yes | handler |
| internal/api/slo | 2 | 0 | 46 | yes | handler |
| internal/api/softwareupdate | 2 | 0 | 63 | yes | handler |
| internal/api/speedprofile | 2 | 0 | 355 | yes | handler |
| internal/api/sse | 2 | 2 | 455 | yes | handler |
| internal/api/status | 3 | 1 | 830 | yes | handler |
| internal/api/synthetic | 2 | 0 | 40 | yes | handler |
| internal/api/sysauthmode | 2 | 1 | 339 | yes | handler |
| internal/api/system | 2 | 1 | 588 | yes | handler |
| internal/api/tco | 3 | 1 | 506 | yes | handler |
| internal/api/tempimpact | 2 | 0 | 240 | yes | handler |
| internal/api/teslachargehist | 2 | 0 | 269 | yes | handler |
| internal/api/teslachargesess | 2 | 0 | 221 | yes | handler |
| internal/api/teslaenergyhist | 4 | 0 | 468 | yes | handler |
| internal/api/teslaenergylivestatus | 2 | 0 | 194 | yes | handler |
| internal/api/teslauserconfig | 2 | 0 | 116 | yes | handler |
| internal/api/teslauserorder | 2 | 0 | 123 | yes | handler |
| internal/api/teslauserprofile | 2 | 0 | 96 | yes | handler |
| internal/api/tirepressure | 2 | 1 | 379 | yes | handler |
| internal/api/totp | 2 | 1 | 1268 | yes | handler |
| internal/api/trip | 2 | 0 | 106 | yes | handler |
| internal/api/tripplanner | 4 | 1 | 839 | yes | handler |
| internal/api/tripsdetail | 2 | 1 | 458 | yes | handler |
| internal/api/user | 2 | 0 | 170 | yes | handler |
| internal/api/userpref | 2 | 1 | 474 | yes | handler |
| internal/api/vampiredrain | 2 | 1 | 726 | yes | handler |
| internal/api/vehicle | 2 | 1 | 616 | yes | handler |
| internal/api/vehicleaccess | 2 | 0 | 448 | yes | handler |
| internal/api/vehicleconfig | 2 | 1 | 527 | yes | handler |
| internal/api/vehiclefsm | 4 | 0 | 585 | yes | handler |
| internal/api/vehicleinfo | 2 | 0 | 318 | yes | handler |
| internal/api/vehiclephoto | 2 | 1 | 1421 | yes | handler |
| internal/api/vehiclesettings | 2 | 1 | 850 | yes | handler |
| internal/api/vehiclestates | 2 | 1 | 758 | yes | handler |
| internal/api/visitedlocation | 2 | 0 | 64 | yes | handler |
| internal/api/watch | 2 | 0 | 343 | yes | handler |
| internal/api/weberrors | 2 | 1 | 483 | yes | handler |
| internal/api/webhookreceiver | 2 | 1 | 291 | yes | handler |
| internal/api/webvitals | 2 | 1 | 356 | yes | handler |
| internal/api/weeklydigest | 2 | 0 | 92 | yes | handler |
| internal/api/yearreview | 2 | 0 | 455 | yes | handler |
| internal/apilog | 4 | 1 | 496 | yes | platform |
| internal/app | 6 | 1 | 1850 | yes | app |
| internal/app/adminobssvc | 3 | 0 | 169 | yes | app |
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
| internal/backup | 3 | 1 | 669 | yes | platform |
| internal/backupverify | 2 | 1 | 314 | yes | platform |
| internal/cache | 3 | 1 | 262 | yes | platform |
| internal/chaos | 3 | 1 | 423 | yes | tool |
| internal/config | 3 | 1 | 722 | yes | platform |
| internal/crypto | 3 | 2 | 666 | yes | platform |
| internal/database | 12 | 9 | 2167 | yes | platform |
| internal/database/achievement | 2 | 0 | 93 | yes | adapter |
| internal/database/admin | 6 | 0 | 873 | yes | adapter |
| internal/database/ai | 3 | 2 | 928 | yes | adapter |
| internal/database/alert | 4 | 4 | 1136 | yes | adapter |
| internal/database/audit | 5 | 0 | 905 | yes | adapter |
| internal/database/auth | 7 | 4 | 1788 | yes | adapter |
| internal/database/automation | 11 | 1 | 1684 | yes | adapter |
| internal/database/backup | 3 | 0 | 246 | yes | adapter |
| internal/database/charging | 3 | 1 | 401 | yes | adapter |
| internal/database/drive | 5 | 4 | 2022 | yes | adapter |
| internal/database/energy | 5 | 0 | 623 | yes | adapter |
| internal/database/export | 5 | 1 | 1403 | yes | adapter |
| internal/database/gdpr | 2 | 0 | 206 | yes | adapter |
| internal/database/geofence | 4 | 0 | 202 | yes | adapter |
| internal/database/notification | 5 | 1 | 1950 | yes | adapter |
| internal/database/observability | 7 | 0 | 1396 | yes | adapter |
| internal/database/position | 3 | 0 | 270 | yes | adapter |
| internal/database/quiethours | 3 | 1 | 438 | yes | adapter |
| internal/database/settings | 7 | 2 | 3115 | yes | adapter |
| internal/database/sharing | 2 | 0 | 127 | yes | adapter |
| internal/database/signal | 8 | 1 | 1381 | yes | adapter |
| internal/database/system | 5 | 3 | 1431 | yes | adapter |
| internal/database/telemetry | 3 | 0 | 287 | yes | adapter |
| internal/database/tesla | 7 | 0 | 625 | yes | adapter |
| internal/database/trip | 4 | 1 | 775 | yes | adapter |
| internal/database/user | 3 | 1 | 806 | yes | adapter |
| internal/database/vehicle | 5 | 1 | 853 | yes | adapter |
| internal/database/worker | 3 | 0 | 523 | yes | adapter |
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
| internal/export | 9 | 3 | 3065 | yes | platform |
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
| internal/handler/v1 | 11 | 1 | 844 | yes | handler |
| internal/imaging | 2 | 1 | 510 | yes | platform |
| internal/integrations | 2 | 0 | 134 | yes | platform |
| internal/integrations/homeassistant | 3 | 1 | 515 | yes | adapter |
| internal/jobs | 1 | 0 | 21 | yes | platform |
| internal/jobs/digests | 3 | 2 | 579 | yes | app |
| internal/jobs/embeddings | 2 | 1 | 262 | yes | platform |
| internal/jobs/indexers | 8 | 7 | 2108 | yes | app |
| internal/jobs/triage | 3 | 2 | 621 | yes | app |
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
| internal/notification | 4 | 2 | 1245 | yes | platform |
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
| internal/service | 4 | 1 | 1385 | yes | platform |
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
| internal/worker | 8 | 3 | 2604 | yes | platform |
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
| `internal/ai/tools` | R6 | 109 | 11 / 7 | 13 | 8 | 5 |
| `internal/database` | R4 | 143 | 12 / 9 | 22 | 17 | 5 |
| `internal/handler/v1` | R3 | 12 | 11 / 1 | 9 | 0 | 9 |
| `internal/api` | R2 (waves R2a-R2e) | 434 | 38 / 29 | 59 | 36 | 23 |

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
- `internal/ai/tools/automation`
- `internal/ai/tools/feedback`
- `internal/ai/tools/forecast`
- `internal/ai/tools/location`
- `internal/ai/tools/nl`
- `internal/ai/tools/safety`
- `internal/ai/tools/summary`

**Planned but not yet on disk:**
- `internal/ai/tools/battery`
- `internal/ai/tools/charging`
- `internal/ai/tools/diagnostics`
- `internal/ai/tools/drive`
- `internal/ai/tools/share`

### `internal/database` detail

> 22 subpkgs from R1 audit. Touches many internal/api/* callers — accept R2 double-touch budget (no temp compat layer).

**Existing subpackages on disk:**
- `internal/database/achievement`
- `internal/database/ai`
- `internal/database/alert`
- `internal/database/audit`
- `internal/database/auth`
- `internal/database/automation`
- `internal/database/backup`
- `internal/database/charging`
- `internal/database/drive`
- `internal/database/energy`
- `internal/database/export`
- `internal/database/notification`
- `internal/database/settings`
- `internal/database/signal`
- `internal/database/system`
- `internal/database/tesla`
- `internal/database/vehicle`

**Planned but not yet on disk:**
- `internal/database/dashboard`
- `internal/database/feedback`
- `internal/database/geo`
- `internal/database/ingest`
- `internal/database/onboarding`

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

**Existing subpackages on disk:**
- `internal/api/system`
- `internal/api/sse`
- `internal/api/openapi`
- `internal/api/devtools`
- `internal/api/analytics`
- `internal/api/anomaly`
- `internal/api/lifetime`
- `internal/api/mileage`
- `internal/api/sleep`
- `internal/api/regen`
- `internal/api/vampiredrain`
- `internal/api/tco`
- `internal/api/tempimpact`
- `internal/api/routeeff`
- `internal/api/dataquality`
- `internal/api/search`
- `internal/api/diagnostic`
- `internal/api/vehicle`
- `internal/api/charging`
- `internal/api/trip`
- `internal/api/energy`
- `internal/api/automation`
- `internal/api/notification`
- `internal/api/chatbot`
- `internal/api/feedback`
- `internal/api/auth`
- `internal/api/onboarding`
- `internal/api/user`
- `internal/api/settings`
- `internal/api/share`
- `internal/api/exports`
- `internal/api/safety`
- `internal/api/audit`
- `internal/api/maintenance`
- `internal/api/watch`
- `internal/api/webvitals`

**Planned but not yet on disk:**
- `internal/api/health`
- `internal/api/observability`
- `internal/api/speed`
- `internal/api/signal`
- `internal/api/fsm`
- `internal/api/cost`
- `internal/api/vehiclesys`
- `internal/api/drive`
- `internal/api/telemetry`
- `internal/api/fleet`
- `internal/api/teslaapi`
- `internal/api/ai`
- `internal/api/admin`
- `internal/api/alert`
- `internal/api/data_repair`
- `internal/api/dashboard`
- `internal/api/saved_views`
- `internal/api/ingest`
- `internal/api/geo`
- `internal/api/bulk`
- `internal/api/api_call_log`
- `internal/api/software_update`
- `internal/api/webhook`

**Shared-helper subpackages (extracted in prep sub-phase):**
- `internal/api/httpx`
- `internal/api/apiparams`
- `internal/api/apitest`
- `internal/api/middleware`

