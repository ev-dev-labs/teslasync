# Phase 6 — Telemetry Write Path (Hot/Cold Split)

> **Goal:** Refactor `internal/api/telemetry_handler.go` to implement ADR-002's hot/cold split. Hot signals → typed snapshot columns; compound signals → flatten then route to hot path; everything else → `signal_observations`. Eliminate every `signals jsonb` write.
>
> **Pre-req:** Phase 5 complete — repos exist for all snapshot tables + signal_observations + signal_catalog.

## Prompts in this phase

| # | File | Purpose |
|--:|------|---------|
| 01 | `01-build-hot-signal-catalog.prompt.md` | New `internal/telemetry/hot_signals.go` with the in-memory `HotSignalCatalog` map keyed by Tesla signal name |
| 02 | `02-implement-flatten-compound.prompt.md` | New `internal/telemetry/flatten.go` — DoorState/WindowState/TimeOfDay/Location compound expanders |
| 03 | `03-rewrite-telemetry-handler.prompt.md` | Rewrite `telemetry_handler.go` ProcessBatch path using catalog + flatten + bulk repos |
| 04 | `04-build-and-integration-test.prompt.md` | Replay-test against captured Fleet Telemetry payloads; verify 0 jsonb writes, expected hot-col counts, cold catalog grows |

## Reference

- ADR-002
- Old monolith: `prompts/04-update-telemetry-write-path.prompt.md` (superseded)
