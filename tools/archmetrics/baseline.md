# TeslaSync architecture metrics — baseline

_Generated 2026-05-08T19:30:17Z, Go go1.26.1, commit fb4e6699f533d9a9e36e30714c11b72ec1b2180e_

## Summary

- Packages: 100
- doc.go coverage: 14.0%
- Forbidden edges detected: 2
- Total non-blank LOC under cmd/+internal/+tools/: 195871

## cmd/* main.go LOC

| cmd | LOC |
|---|---:|
| cmd/automation-worker/main.go | 272 |
| cmd/export-worker/main.go | 172 |
| cmd/metric-coverage-audit/main.go | 126 |
| cmd/notification-worker/main.go | 372 |
| cmd/protogen-tesla/main.go | 73 |
| cmd/pub-test-signal/main.go | 625 |
| cmd/resubscribe/main.go | 363 |
| cmd/slo-coverage-audit/main.go | 199 |
| cmd/slogen/main.go | 356 |
| cmd/teslasync/main.go | 923 |
| cmd/trace-coverage-audit/main.go | 219 |
| cmd/unit-drift-validator/main.go | 154 |

## Forbidden edges

- cmd/automation-worker -> internal/api (rule: cmd/automation-worker -> internal/api)
- cmd/notification-worker -> internal/api (rule: cmd/notification-worker -> internal/api)

## Per-package metrics

| Package | .go | _test.go | LOC | doc.go | Layer |
|---|---:|---:|---:|:---:|---|
| cmd/automation-worker | 1 | 0 | 272 |   |  |
| cmd/export-worker | 1 | 0 | 172 |   |  |
| cmd/metric-coverage-audit | 1 | 0 | 126 |   |  |
| cmd/notification-worker | 1 | 0 | 372 |   |  |
| cmd/protogen-tesla | 3 | 1 | 2152 |   |  |
| cmd/protogen-tesla/testdata/golden | 3 | 0 | 261 |   |  |
| cmd/pub-test-signal | 1 | 0 | 625 |   |  |
| cmd/resubscribe | 1 | 1 | 584 |   |  |
| cmd/slo-coverage-audit | 1 | 0 | 199 |   |  |
| cmd/slogen | 4 | 4 | 1338 |   |  |
| cmd/teslasync | 5 | 1 | 1153 |   |  |
| cmd/trace-coverage-audit | 1 | 0 | 219 |   |  |
| cmd/unit-drift-validator | 1 | 1 | 292 |   |  |
| internal/adapter/gasprices | 2 | 1 | 356 | yes |  |
| internal/adapter/geocoding | 1 | 0 | 30 |   |  |
| internal/adapter/mqtt | 1 | 0 | 78 |   |  |
| internal/adapter/postgres | 7 | 0 | 456 |   |  |
| internal/adapter/postgres/queries | 7 | 0 | 312 |   |  |
| internal/adapter/redis | 1 | 0 | 54 |   |  |
| internal/adapter/storage | 1 | 0 | 60 |   |  |
| internal/adapter/tesla | 2 | 0 | 195 |   |  |
| internal/api | 197 | 94 | 78818 | yes |  |
| internal/app/chargingsvc | 1 | 1 | 291 |   |  |
| internal/app/dashboardsvc | 1 | 1 | 318 |   |  |
| internal/app/exportsvc | 1 | 1 | 270 |   |  |
| internal/app/notificationsvc | 1 | 1 | 301 |   |  |
| internal/app/tripsvc | 1 | 1 | 304 |   |  |
| internal/app/vehiclesvc | 2 | 1 | 338 |   |  |
| internal/auth | 5 | 4 | 2380 |   |  |
| internal/automation | 5 | 2 | 1556 |   |  |
| internal/automation/action | 5 | 5 | 3818 |   |  |
| internal/automation/condition | 8 | 8 | 3647 |   |  |
| internal/automation/presets | 2 | 1 | 591 |   |  |
| internal/automation/safety | 6 | 6 | 3561 |   |  |
| internal/automation/trigger | 6 | 0 | 942 |   |  |
| internal/backup | 2 | 1 | 664 |   |  |
| internal/cache | 2 | 1 | 258 |   |  |
| internal/config | 3 | 1 | 593 | yes |  |
| internal/crypto | 2 | 2 | 662 |   |  |
| internal/database | 96 | 27 | 23269 | yes |  |
| internal/domain | 1 | 1 | 110 |   |  |
| internal/domain/charging | 5 | 1 | 347 |   |  |
| internal/domain/export | 2 | 1 | 116 |   |  |
| internal/domain/fsm | 6 | 1 | 926 | yes |  |
| internal/domain/notification | 2 | 1 | 106 |   |  |
| internal/domain/trip | 3 | 1 | 136 |   |  |
| internal/domain/user | 2 | 1 | 88 |   |  |
| internal/domain/vehicle | 4 | 1 | 340 |   |  |
| internal/enums | 4 | 1 | 300 |   |  |
| internal/events | 1 | 1 | 141 |   |  |
| internal/export | 8 | 3 | 2994 |   |  |
| internal/fsm | 10 | 3 | 2508 |   |  |
| internal/fsm/automation | 1 | 1 | 794 |   |  |
| internal/fsm/charge | 2 | 1 | 617 |   |  |
| internal/fsm/command | 1 | 1 | 406 |   |  |
| internal/fsm/drive | 3 | 1 | 702 |   |  |
| internal/fsm/notification | 2 | 2 | 519 |   |  |
| internal/fsm/telemetry | 2 | 1 | 716 |   |  |
| internal/geocoding | 5 | 1 | 528 |   |  |
| internal/handler/dto | 5 | 0 | 90 |   |  |
| internal/handler/middleware | 9 | 1 | 738 |   |  |
| internal/handler/v1 | 7 | 0 | 330 |   |  |
| internal/imaging | 1 | 1 | 506 |   |  |
| internal/integrations | 1 | 0 | 130 |   |  |
| internal/metrics | 4 | 1 | 747 |   |  |
| internal/models | 34 | 1 | 2823 | yes |  |
| internal/mqtt | 4 | 4 | 2173 | yes |  |
| internal/notification | 3 | 2 | 1088 |   |  |
| internal/notifier | 1 | 1 | 446 |   |  |
| internal/platform | 2 | 2 | 698 |   |  |
| internal/platform/buildinfo | 1 | 1 | 82 |   |  |
| internal/platform/cache | 1 | 0 | 92 |   |  |
| internal/platform/config | 1 | 1 | 317 |   |  |
| internal/platform/database | 2 | 0 | 128 |   |  |
| internal/platform/httputil | 10 | 8 | 2249 | yes |  |
| internal/platform/telemetry | 3 | 0 | 134 |   |  |
| internal/polling | 10 | 1 | 1409 |   |  |
| internal/port/external | 4 | 0 | 82 |   |  |
| internal/port/messaging | 2 | 1 | 267 |   |  |
| internal/port/repository | 7 | 0 | 105 |   |  |
| internal/resilience | 2 | 4 | 720 | yes |  |
| internal/service | 4 | 1 | 1375 | yes |  |
| internal/signal | 10 | 11 | 7226 |   |  |
| internal/signal/signaltest | 1 | 0 | 96 |   |  |
| internal/tesla | 11 | 3 | 2265 | yes |  |
| internal/tesla/bootstrap | 2 | 1 | 1030 |   |  |
| internal/tesla/codec | 3 | 2 | 934 |   |  |
| internal/tesla/config | 2 | 1 | 466 |   |  |
| internal/tesla/normalize | 6 | 5 | 2163 |   |  |
| internal/tesla/protomodel | 7 | 3 | 5004 | yes |  |
| internal/tesla/router | 3 | 2 | 870 |   |  |
| internal/tesla/router/writers | 14 | 13 | 6747 | yes |  |
| internal/tesla/unit_history | 3 | 2 | 1639 |   |  |
| internal/tesla/units | 3 | 1 | 470 |   |  |
| internal/tesla_pipeline | 1 | 3 | 2231 |   |  |
| internal/tracing | 2 | 1 | 238 |   |  |
| internal/units | 1 | 0 | 59 |   |  |
| internal/webpush | 1 | 1 | 451 |   |  |
| internal/worker | 8 | 3 | 2518 | yes |  |
| tools/archmetrics | 1 | 0 | 454 |   |  |

## doc.go adoption

- Packages WITHOUT doc.go: 86

<details><summary>List</summary>

- `cmd/automation-worker`
- `cmd/export-worker`
- `cmd/metric-coverage-audit`
- `cmd/notification-worker`
- `cmd/protogen-tesla`
- `cmd/protogen-tesla/testdata/golden`
- `cmd/pub-test-signal`
- `cmd/resubscribe`
- `cmd/slo-coverage-audit`
- `cmd/slogen`
- `cmd/teslasync`
- `cmd/trace-coverage-audit`
- `cmd/unit-drift-validator`
- `internal/adapter/geocoding`
- `internal/adapter/mqtt`
- `internal/adapter/postgres`
- `internal/adapter/postgres/queries`
- `internal/adapter/redis`
- `internal/adapter/storage`
- `internal/adapter/tesla`
- `internal/app/chargingsvc`
- `internal/app/dashboardsvc`
- `internal/app/exportsvc`
- `internal/app/notificationsvc`
- `internal/app/tripsvc`
- `internal/app/vehiclesvc`
- `internal/auth`
- `internal/automation`
- `internal/automation/action`
- `internal/automation/condition`
- `internal/automation/presets`
- `internal/automation/safety`
- `internal/automation/trigger`
- `internal/backup`
- `internal/cache`
- `internal/crypto`
- `internal/domain`
- `internal/domain/charging`
- `internal/domain/export`
- `internal/domain/notification`
- `internal/domain/trip`
- `internal/domain/user`
- `internal/domain/vehicle`
- `internal/enums`
- `internal/events`
- `internal/export`
- `internal/fsm`
- `internal/fsm/automation`
- `internal/fsm/charge`
- `internal/fsm/command`
- `internal/fsm/drive`
- `internal/fsm/notification`
- `internal/fsm/telemetry`
- `internal/geocoding`
- `internal/handler/dto`
- `internal/handler/middleware`
- `internal/handler/v1`
- `internal/imaging`
- `internal/integrations`
- `internal/metrics`
- `internal/notification`
- `internal/notifier`
- `internal/platform`
- `internal/platform/buildinfo`
- `internal/platform/cache`
- `internal/platform/config`
- `internal/platform/database`
- `internal/platform/telemetry`
- `internal/polling`
- `internal/port/external`
- `internal/port/messaging`
- `internal/port/repository`
- `internal/signal`
- `internal/signal/signaltest`
- `internal/tesla/bootstrap`
- `internal/tesla/codec`
- `internal/tesla/config`
- `internal/tesla/normalize`
- `internal/tesla/router`
- `internal/tesla/unit_history`
- `internal/tesla/units`
- `internal/tesla_pipeline`
- `internal/tracing`
- `internal/units`
- `internal/webpush`
- `tools/archmetrics`

</details>
