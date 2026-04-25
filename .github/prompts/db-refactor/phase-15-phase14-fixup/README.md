# Phase 15 — Phase 14 Fixup: Remaining Dropped-Table References

## Goal

Phase 14 gate found 7 remaining references to dropped tables across 4 files,
plus 1 stale test file and a missing fsm_type migration. This phase cleans
them all up.

## Remaining issues

| # | File | Issue |
|---|---|---|
| 0 | `fsm_transitions` table | Missing `fsm_type` column migration |
| 1 | `energy_repo.go` | 2 refs to `battery_snapshots` (BatterySnapshotRepo) |
| 2 | `maintenance_worker.go` | 3 refs to `battery_snapshots` (health snapshot creation) |
| 3 | `range_projection_handler.go` | 1 ref to `vehicle_live_state` (outside_temp query) |
| 4 | `backup/processor.go` | 1 ref to `battery_snapshots` in backup table list |
| 5 | `rule_engine_test.go` | Stale `Conditions` field on `AlertRule` (go vet fail) |
| 6 | Gate | Build + vet + tsc + zero dropped-table refs |

## Prompt ordering (7 atomic prompts)

```
00 — fsm_type migration (add column to fsm_transitions)
01 — energy_repo: remove BatterySnapshotRepo (derive from signal_log)
02 — maintenance_worker: remove battery_snapshots creation (signal_log has the data)
03 — range_projection_handler: vehicle_live_state → Redis
04 — backup/processor: remove battery_snapshots from table list
05 — rule_engine_test: fix stale AlertRule fields (go vet)
06 — Gate: go build + go vet + tsc + zero dropped-table refs + Docker replay
```
