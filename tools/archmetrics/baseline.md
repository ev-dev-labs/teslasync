# TeslaSync architecture metrics ΓÇö baseline

_Generated 2026-05-08T20:30:41Z, Go go1.26.1, commit f83f2c2dffb0e7e743c3d77178a49aacd667f7e0_

## Summary

- Packages: 104
- doc.go coverage: 100.0%
- Forbidden edges detected: 0
- Total non-blank LOC under cmd/+internal/+tools/: 197279

## cmd/* main.go LOC

| cmd | LOC |
|---|---:|
| cmd/automation-worker/main.go | 272 |
| cmd/export-worker/main.go | 172 |
| cmd/metric-coverage-audit/main.go | 126 |
| cmd/notification-worker/main.go | 373 |
| cmd/protogen-tesla/main.go | 73 |
| cmd/pub-test-signal/main.go | 625 |
| cmd/resubscribe/main.go | 363 |
| cmd/slo-coverage-audit/main.go | 199 |
| cmd/slogen/main.go | 356 |
| cmd/teslasync/main.go | 71 |
| cmd/trace-coverage-audit/main.go | 219 |
| cmd/unit-drift-validator/main.go | 154 |

## Forbidden edges

_None._

## Per-package metrics

| Package | .go | _test.go | LOC | doc.go | Layer |
|---|---:|---:|---:|:---:|---|
| cmd/automation-worker | 2 | 0 | 276 | yes | cmd-internal |
| cmd/export-worker | 2 | 0 | 176 | yes | cmd-internal |
| cmd/metric-coverage-audit | 2 | 0 | 130 | yes | cmd-internal |
| cmd/notification-worker | 2 | 0 | 377 | yes | cmd-internal |
| cmd/protogen-tesla | 4 | 1 | 2156 | yes | cmd-internal |
| cmd/protogen-tesla/testdata/golden | 4 | 0 | 265 | yes | cmd-internal |
| cmd/pub-test-signal | 2 | 0 | 629 | yes | cmd-internal |
| cmd/resubscribe | 2 | 1 | 588 | yes | cmd-internal |
| cmd/slo-coverage-audit | 2 | 0 | 203 | yes | cmd-internal |
| cmd/slogen | 5 | 4 | 1342 | yes | cmd-internal |
| cmd/teslasync | 6 | 1 | 144 | yes | cmd-internal |
| cmd/trace-coverage-audit | 2 | 0 | 223 | yes | cmd-internal |
| cmd/unit-drift-validator | 2 | 1 | 296 | yes | cmd-internal |
| internal/adapter/gasprices | 2 | 1 | 358 | yes | adapter |
| internal/adapter/geocoding | 2 | 0 | 34 | yes | adapter |
| internal/adapter/mqtt | 2 | 0 | 82 | yes | adapter |
| internal/adapter/postgres | 8 | 0 | 460 | yes | adapter |
| internal/adapter/postgres/queries | 8 | 0 | 316 | yes | adapter |
| internal/adapter/redis | 2 | 0 | 58 | yes | adapter |
| internal/adapter/storage | 2 | 0 | 64 | yes | adapter |
| internal/adapter/tesla | 3 | 0 | 199 | yes | adapter |
| internal/api | 197 | 93 | 77662 | yes | handler |
| internal/apilog | 4 | 1 | 505 | yes | platform |
| internal/app | 6 | 1 | 1207 | yes | app |
| internal/app/chargingsvc | 2 | 1 | 295 | yes | app |
| internal/app/dashboardsvc | 2 | 1 | 322 | yes | app |
| internal/app/exportsvc | 2 | 1 | 274 | yes | app |
| internal/app/notificationsvc | 2 | 1 | 305 | yes | app |
| internal/app/tripsvc | 2 | 1 | 308 | yes | app |
| internal/app/vehiclesvc | 3 | 1 | 342 | yes | app |
| internal/arch | 2 | 1 | 428 | yes | tool |
| internal/auth | 6 | 4 | 2384 | yes | platform |
| internal/automation | 6 | 2 | 1560 | yes | platform |
| internal/automation/action | 6 | 5 | 3822 | yes | platform |
| internal/automation/condition | 9 | 8 | 3651 | yes | platform |
| internal/automation/presets | 3 | 1 | 595 | yes | platform |
| internal/automation/safety | 7 | 6 | 3565 | yes | platform |
| internal/automation/trigger | 7 | 0 | 946 | yes | platform |
| internal/backup | 3 | 1 | 668 | yes | platform |
| internal/cache | 3 | 1 | 262 | yes | platform |
| internal/config | 3 | 1 | 595 | yes | platform |
| internal/crypto | 3 | 2 | 666 | yes | platform |
| internal/database | 96 | 27 | 23271 | yes | platform |
| internal/domain | 2 | 1 | 114 | yes | domain |
| internal/domain/charging | 6 | 1 | 351 | yes | domain |
| internal/domain/export | 3 | 1 | 120 | yes | domain |
| internal/domain/fsm | 6 | 1 | 928 | yes | domain |
| internal/domain/notification | 3 | 1 | 110 | yes | domain |
| internal/domain/trip | 4 | 1 | 140 | yes | domain |
| internal/domain/user | 3 | 1 | 92 | yes | domain |
| internal/domain/vehicle | 5 | 1 | 344 | yes | domain |
| internal/enums | 5 | 1 | 304 | yes | platform |
| internal/events | 2 | 1 | 145 | yes | platform |
| internal/export | 9 | 3 | 2998 | yes | platform |
| internal/fsm | 11 | 3 | 2512 | yes | platform |
| internal/fsm/automation | 2 | 1 | 798 | yes | platform |
| internal/fsm/charge | 3 | 1 | 621 | yes | platform |
| internal/fsm/command | 2 | 1 | 410 | yes | platform |
| internal/fsm/drive | 4 | 1 | 706 | yes | platform |
| internal/fsm/notification | 3 | 2 | 523 | yes | platform |
| internal/fsm/telemetry | 3 | 1 | 720 | yes | platform |
| internal/geocoding | 6 | 1 | 532 | yes | platform |
| internal/handler/dto | 6 | 0 | 94 | yes | handler |
| internal/handler/middleware | 10 | 1 | 742 | yes | handler |
| internal/handler/v1 | 8 | 0 | 340 | yes | handler |
| internal/imaging | 2 | 1 | 510 | yes | platform |
| internal/integrations | 2 | 0 | 134 | yes | platform |
| internal/metrics | 5 | 1 | 751 | yes | platform |
| internal/models | 34 | 1 | 2825 | yes | domain |
| internal/mqtt | 4 | 4 | 2175 | yes | platform |
| internal/notification | 4 | 2 | 1092 | yes | platform |
| internal/notification/computed | 4 | 1 | 1004 | yes | platform |
| internal/notifier | 2 | 1 | 450 | yes | platform |
| internal/platform | 3 | 2 | 702 | yes | platform |
| internal/platform/buildinfo | 2 | 1 | 86 | yes | platform |
| internal/platform/cache | 2 | 0 | 96 | yes | platform |
| internal/platform/config | 2 | 1 | 321 | yes | platform |
| internal/platform/database | 3 | 0 | 132 | yes | platform |
| internal/platform/httputil | 10 | 8 | 2251 | yes | platform |
| internal/platform/telemetry | 4 | 0 | 138 | yes | platform |
| internal/polling | 11 | 1 | 1413 | yes | platform |
| internal/port/external | 5 | 0 | 86 | yes | port |
| internal/port/messaging | 3 | 1 | 271 | yes | port |
| internal/port/repository | 8 | 0 | 109 | yes | port |
| internal/resilience | 2 | 4 | 722 | yes | platform |
| internal/service | 4 | 1 | 1377 | yes | platform |
| internal/signal | 11 | 11 | 7233 | yes | platform |
| internal/signal/signaltest | 2 | 0 | 103 | yes | platform |
| internal/tesla | 11 | 3 | 2267 | yes | platform |
| internal/tesla/bootstrap | 3 | 1 | 1037 | yes | platform |
| internal/tesla/codec | 4 | 2 | 941 | yes | platform |
| internal/tesla/config | 3 | 1 | 473 | yes | platform |
| internal/tesla/normalize | 7 | 5 | 2170 | yes | platform |
| internal/tesla/protomodel | 7 | 3 | 5006 | yes | platform |
| internal/tesla/router | 4 | 2 | 877 | yes | platform |
| internal/tesla/router/writers | 14 | 13 | 6749 | yes | platform |
| internal/tesla/unit_history | 4 | 2 | 1646 | yes | platform |
| internal/tesla/units | 4 | 1 | 477 | yes | platform |
| internal/tesla_pipeline | 2 | 3 | 2238 | yes | platform |
| internal/tracing | 3 | 1 | 242 | yes | platform |
| internal/units | 2 | 0 | 63 | yes | platform |
| internal/webpush | 2 | 1 | 455 | yes | platform |
| internal/worker | 8 | 3 | 2520 | yes | platform |
| tools/archmetrics | 2 | 0 | 484 | yes | tool |

## doc.go adoption

- Packages WITHOUT doc.go: 0
