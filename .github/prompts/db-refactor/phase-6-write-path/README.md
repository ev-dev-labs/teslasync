# Phase 6 — Telemetry Write Path (Hot/Cold Split)

> **Goal:** Refactor `internal/api/telemetry_handler.go` to implement ADR-002's hot/cold split. Hot signals → typed snapshot columns; compound signals → flatten then route to hot path; everything else → `signal_observations`. Eliminate every `signals jsonb` write.
>
> **Pre-req:** Phase 5 complete — repos exist for all snapshot tables + signal_observations + signal_catalog. Final gate of Phase 5: `phase-5-go-models/71-mod-tidy-and-tidy-check`.
>
> **Post:** Final gate (32) blocks `phase-7-frontend/01`.

## Prompts in this phase (32 atomic prompts)

### Hot Signal Catalog (01–09)
| # | File | Purpose |
|--:|------|---------|
| 01 | `01-define-hot-catalog-types.prompt.md` | Type definitions (HotRoute, Transformer, SignalKind) |
| 02 | `02-implement-lookup-hot-fn.prompt.md` | Empty HotCatalog map + LookupHot accessor |
| 03 | `03-populate-hot-catalog-vehicle-live-state.prompt.md` | vehicle_live_state routes |
| 04 | `04-populate-hot-catalog-positions.prompt.md` | positions routes |
| 05 | `05-populate-hot-catalog-climate.prompt.md` | climate_snapshots routes |
| 06 | `06-populate-hot-catalog-motor.prompt.md` | motor_snapshots routes |
| 07 | `07-populate-hot-catalog-security.prompt.md` | security_events routes (compound-aware) |
| 08 | `08-populate-hot-catalog-charging.prompt.md` | charging_telemetry routes |
| 09 | `09-test-hot-catalog-coverage.prompt.md` | No-orphan-signals coverage test |

### Flatten Compound (10–19)
| # | File | Purpose |
|--:|------|---------|
| 10 | `10-flatten-define-types.prompt.md` | Atomic struct + Flatten() dispatcher shell |
| 11 | `11-flatten-implement-typedoors.prompt.md` | flattenDoors |
| 12 | `12-flatten-implement-typetime.prompt.md` | flattenTime |
| 13 | `13-flatten-implement-typelocation.prompt.md` | flattenLocation |
| 14 | `14-flatten-implement-typeshiftstate.prompt.md` | flattenShiftState |
| 15 | `15-flatten-implement-passthrough.prompt.md` | flattenWindows + verify passthrough |
| 16 | `16-flatten-test-fixtures-typedoors.prompt.md` | Doors fixtures |
| 17 | `17-flatten-test-fixtures-typetime.prompt.md` | Time fixtures |
| 18 | `18-flatten-test-fixtures-typelocation.prompt.md` | Location fixtures |
| 19 | `19-flatten-test-coverage-end-to-end.prompt.md` | E2E flatten on real batch |

### Telemetry Handler Refactor (20–28)
| # | File | Purpose |
|--:|------|---------|
| 20 | `20-extract-normalize-step.prompt.md` | Extract NormalizeFleetUnits → []NamedValue |
| 21 | `21-extract-flatten-loop.prompt.md` | Per-NamedValue Flatten loop in ProcessBatch |
| 22 | `22-extract-bucket-step.prompt.md` | Bucket atomics by table; cold residue |
| 23 | `23-extract-build-hot-rows.prompt.md` | Build per-table row maps + apply Transformers |
| 24 | `24-extract-build-cold-observations.prompt.md` | Convert cold residue to []SignalObservation |
| 25 | `25-extract-catalog-upsert.prompt.md` | Bulk-upsert names to signal_catalog (1 round-trip) |
| 26 | `26-extract-fan-out-bulk-writes.prompt.md` | Per-repo BulkInsert / Upsert dispatch |
| 27 | `27-integrate-fsm-hooks.prompt.md` | Re-wire connFSMs.ProcessSignals on new stream |
| 28 | `28-extract-error-aggregation.prompt.md` | Per-step errors + summary log |

### Cache, SSE, Build (29–32)
| # | File | Purpose |
|--:|------|---------|
| 29 | `29-cache-invalidation-audit.prompt.md` | Cache key invalidation parity for new write path |
| 30 | `30-sse-payload-audit.prompt.md` | SSE payloads switched from raw_state/signals → typed |
| 31 | `31-build-and-vet.prompt.md` | go build + go vet quality gate |
| 32 | `32-integration-test-fleet-batch.prompt.md` | E2E replay test (merge-gate; blocks Phase 7) |

## Reference

- ADR-002
- Phase 5 final gate: `phase-5-go-models/71-mod-tidy-and-tidy-check`
- Old bundled prompts (superseded, removed): `01-build-hot-signal-catalog`, `02-implement-flatten-compound`, `03-rewrite-telemetry-handler`, `04-build-and-integration-test`
